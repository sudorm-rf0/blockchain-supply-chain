#!/usr/bin/env node
/**
 * DeepSeek Responses↔Chat 本地翻译代理
 * ------------------------------------------------------------------
 * 用途：Codex CLI 只支持 OpenAI `Responses` API（wire_api = "responses"），
 * 而 DeepSeek 官方只支持 OpenAI `Chat Completions` API。
 * 本代理在本地监听 127.0.0.1:15723，把 Codex 发来的 Responses 请求
 * 翻译成 Chat Completions 转发给 DeepSeek，再把响应（含流式）翻译回
 * Responses 格式返回给 Codex。
 *
 * 用法：
 *   node codex-deepseek-proxy.js
 * 然后用 `~/.codex/config.toml`：
 *   [model_providers.custom]
 *   wire_api = "responses"
 *   base_url = "http://127.0.0.1:15723/v1"
 *
 * 鉴权：从 ~/.codex/auth.json 的 OPENAI_API_KEY 读取 DeepSeek Key，转发时注入。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const UPSTREAM_HOST = 'api.deepseek.com';
const UPSTREAM_PATH = '/v1/chat/completions';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 15723;

const AUTH_FILE = path.join(os.homedir(), '.codex', 'auth.json');
const MODEL = 'deepseek-v4-flash';

function getKey() {
  try {
    const raw = fs.readFileSync(AUTH_FILE, 'utf8');
    return (JSON.parse(raw).OPENAI_API_KEY || '').trim();
  } catch (e) {
    return '';
  }
}

/* ---------------- Logging ---------------- */
function log(...a) {
  console.log(new Date().toISOString(), ...a);
}
function err(...a) {
  console.error(new Date().toISOString(), ...a);
}

/* ---------------- Models ---------------- */
const MODELS = {
  object: 'list',
  data: [{ id: MODEL, object: 'model', owned_by: 'deepseek' }],
};

const RESPONSE_OK = {
  id: 'resp-ok',
  object: 'response',
  created_at: Math.floor(Date.now() / 1000),
  status: 'completed',
  error: null,
  incomplete_details: null,
  instructions: null,
  max_output_tokens: null,
  model: MODEL,
  output: [],
  parallel_tool_calls: true,
  previous_response_id: null,
  reasoning: { effort: null, summary: [] },
  store: true,
  temperature: null,
  text: { format: { type: 'text' } },
  tool_choice: 'auto',
  tools: [],
  top_p: null,
  truncation: 'disabled',
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  metadata: {},
  user: null,
};

/* ---------------- Request body helpers ---------------- */

// Extract the last user text/input from a Responses request body.
function extractMessages(respBody) {
  if (!respBody || !Array.isArray(respBody.input)) return [];

  const messages = [];
  // Buffers reasoning text from a `reasoning` item until the NEXT assistant
  // message arrives. Codex emits reasoning BEFORE the assistant message it
  // belongs to, and stores the text in content[].text (type 'reasoning_text').
  let pendingReasoning = null;
  // The assistant message most recently pushed by a `message` item. A run of
  // `function_call` items immediately after it belongs to the SAME turn, and
  // must be merged into it (not produce a duplicate assistant message).
  let lastFromMessageMsg = null;
  function flushReasoningTo(msg) {
    if (pendingReasoning && msg && msg.role === 'assistant') {
      msg.reasoning_content = (msg.reasoning_content || '') + pendingReasoning;
      pendingReasoning = null;
    }
  }

  // history may be an array of previous responses (each has .output items) –
  // they carry the same item shapes as input, so append them as items too.
  const items = [];
  if (Array.isArray(respBody.history)) {
    respBody.history.forEach((prev) => {
      if (prev && prev.output && Array.isArray(prev.output)) prev.output.forEach((it) => items.push(it));
    });
  }
  respBody.input.forEach((it) => items.push(it));

  // Peek type helper (skip error-prone empty items).
  function itemType(it) {
    if (typeof it === 'string') return 'string';
    if (!it || typeof it !== 'object') return 'noop';
    return it.type || 'noop';
  }
  function nextIsMessageAt(arr, idx) {
    return idx >= 0 && itemType(arr[idx]) === 'message' && arr[idx].role === 'assistant';
  }

  // Push an assistant(or user/system) message into `messages`. If an assistant
  // message follows immediately after another assistant that carries tool_calls
  // but was NOT answered by tool messages yet, DeepSeek rejects it. We guard the
  // common shapes below, but the call/response run-coalescing is what keeps the
  // order legal.
  function pushMessage(role, text, extra) {
    const msg = Object.assign({ role, content: text }, extra);
    messages.push(msg);
    return msg;
  }

  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const type = itemType(item);

    if (type === 'message') {
      const role = item.role === 'developer' ? 'system' : item.role;
      const text = extractText(item.content);
      if (role === 'assistant' || (role === 'system' && text)) {
        const msg = pushMessage(role, text, {});
        lastFromMessageMsg = msg; // remember: a following function_call run belongs to this same turn
        if (role === 'assistant' && item.reasoning_content) msg.reasoning_content = item.reasoning_content;
        flushReasoningTo(msg);
      } else if (role === 'user' && text) {
        pushMessage('user', text, {});
      } // tool role messages come via function_call_output; skip bare tool messages
      i++;
      continue;
    }

    if (type === 'function_call') {
      // A function_call run belongs to the SAME assistant turn as an IMMEDIATELY
      // preceding message item (assistant). Merge tool_calls + pending reasoning
      // into that already-pushed assistant message instead of creating a
      // duplicate (which DeepSeek rejects). If no preceding turn message, create
      // a fresh tool-calls-only assistant message.
      const prevIsTurnMsg =
        lastFromMessageMsg && nextIsMessageAt(items, i - 1) && (items[i - 1].role === 'assistant' || items[i - 1].role === 'developer');
      const msg = prevIsTurnMsg
        ? lastFromMessageMsg
        : { role: 'assistant', content: null, tool_calls: [] };
      if (!Array.isArray(msg.tool_calls)) msg.tool_calls = [];
      while (i < items.length && itemType(items[i]) === 'function_call') {
        const fc = items[i];
        msg.tool_calls.push({
          id: fc.call_id || fc.id || 'call_' + Math.random().toString(36).slice(2, 10),
          type: 'function',
          function: { name: fc.name || fc.function_name || '', arguments: fc.arguments || '{}' },
        });
        i++;
      }
      flushReasoningTo(msg);
      if (!prevIsTurnMsg) messages.push(msg);
      lastFromMessageMsg = null;
      continue;
    }

    if (type === 'function_call_output') {
      // Coalesce the run of contiguous outputs into tool messages, in order.
      while (i < items.length && itemType(items[i]) === 'function_call_output') {
        const o = items[i];
        messages.push({ role: 'tool', tool_call_id: o.call_id || o.id || '', content: String(o.output != null ? o.output : '') });
        i++;
      }
      // Remove an assistant message that immediately preceded but only carried
      // tool_calls with no text and is already answered: it stays. No-op.
      continue;
    }

    if (type === 'reasoning') {
      // OpenAI Responses stores reasoning text in EITHER summary[].text OR
      // content[].text (type 'reasoning_text'). Codex uses content[].text.
      let text = '';
      if (Array.isArray(item.summary) && item.summary.length) {
        text = item.summary.map((s) => (s && s.text) || '').join('');
      }
      if (!text && Array.isArray(item.content)) {
        text = item.content
          .filter((c) => c && (c.text || c.type === 'reasoning_text'))
          .map((c) => (c && c.text) || '')
          .join('');
      }
      if (!text && typeof item.text === 'string') text = item.text;
      if (text) pendingReasoning = (pendingReasoning || '') + text;
      i++;
      continue;
    }

    if (typeof item === 'string') {
      messages.push({ role: 'user', content: item });
      i++;
      continue;
    }

    // Fallback: item with role+content
    if (item.role && item.content) {
      const role = item.role === 'developer' ? 'system' : item.role;
      if (role === 'user' || role === 'assistant' || role === 'system') {
        const text = extractText(item.content);
        if (text) pushMessage(role, text, {});
      }
    }
    i++;
  }

  if (messages.length === 0) {
    messages.push({ role: 'user', content: '(no input)' });
  }
  return messages;
}

// Extract a plain-text string from Responses content (array of parts or string).
function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p.text === 'string') return p.text;
        if (p && typeof p.content === 'string') return p.content;
        return '';
      })
      .join('');
  }
  return '';
}

function numTokens(s) {
  const words = s ? s.split(/\s+/).filter(Boolean).length : 0;
  return Math.max(1, Math.ceil(words * 1.3));
}

function buildChatBody(respBody) {
  const messages = extractMessages(respBody);
  const body = {
    model: respBody.model || MODEL,
    messages,
    stream: respBody.stream === true,
  };
  const m = body.model.toLowerCase();
  if (m.includes('reasoner') || m.includes('v4')) {
    // DeepSeek reasoning model (v4-flash/v4-pro) supports reasoning_content.
    // Keep default; do not set max_tokens too low or it may fail.
  }
  if (respBody.max_output_tokens) body.max_tokens = respBody.max_output_tokens;
  if (respBody.temperature !== undefined && respBody.temperature !== null) body.temperature = respBody.temperature;
  // Convert Responses-format tools → DeepSeek Chat-format tools, and drop tool
  // kinds DeepSeek's Chat API does not understand (custom/namespace/tool_search/web_search).
  const tools = convertTools(respBody.tools);
  if (tools.length) body.tools = tools;
  return body;
}

// OpenAI Responses tools come flat: {type:"function", name, description, parameters, strict}
// DeepSeek Chat Completions needs the wrapped shape:
//   {type:"function", function:{name, description, parameters}}
// Any non-`function` tool kind is dropped (DeepSeek only models `function` tools).
function convertTools(tools) {
  if (!Array.isArray(tools)) return [];
  const out = [];
  for (const t of tools) {
    if (!t || t.type !== 'function') continue;
    const isWrapped = t.function && typeof t.function === 'object';
    const fn = isWrapped ? t.function : t;
    const parameters = fn.parameters || undefined;
    if (!parameters || parameters.type !== 'object') continue; // DeepSeek requires object params
    const chatTool = {
      type: 'function',
      function: {
        name: fn.name,
        description: fn.description || '',
      },
    };
    if (parameters) chatTool.function.parameters = parameters;
    out.push(chatTool);
  }
  return out;
}

function makeResponsePayload(chatMsg, usage) {
  const now = Math.floor(Date.now() / 1000);
  const text = chatMsg && chatMsg.content ? chatMsg.content : '';
  const reasoning = chatMsg && chatMsg.reasoning_content ? chatMsg.reasoning_content : '';
  const calls = chatMsg && Array.isArray(chatMsg.tool_calls) ? chatMsg.tool_calls : [];
  const output = [];
  if (reasoning) {
    output.push({
      id: 'reasoning-1',
      type: 'reasoning',
      status: 'completed',
      summary: [{ type: 'summary_text', text: reasoning.slice(0, 400) }],
      content: [{ type: 'output_text', text: reasoning, annotations: [] }],
    });
  }
  if (text) {
    output.push({
      id: 'msg-' + now,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    });
  }
  calls.forEach((c, i) => {
    output.push({
      id: 'fc-' + now + '-' + i,
      type: 'function_call',
      status: 'completed',
      call_id: c.id || 'call_' + now + '_' + i,
      name: (c.function && c.function.name) || '',
      arguments: (c.function && c.function.arguments) || '{}',
    });
  });
  const inputTokens = usage ? usage.prompt_tokens || 0 : numTokens('');
  const outputTokens = usage ? usage.completion_tokens || numTokens(text) : numTokens(text);
  return {
    ...RESPONSE_OK,
    id: 'resp-' + now + '-' + Math.floor(Math.random() * 1e6),
    created_at: now,
    model: MODEL,
    output,
    usage: {
      input_tokens: inputTokens,
      input_tokens_details: { cached_tokens: usage && usage.prompt_cache_hit_tokens ? usage.prompt_cache_hit_tokens : 0 },
      output_tokens: outputTokens,
      output_tokens_details: { reasoning_tokens: usage && usage.completion_tokens_details ? usage.completion_tokens_details.reasoning_tokens : 0 },
      total_tokens: inputTokens + outputTokens,
    },
  };
}

/* ---------------- Upstream HTTPS request ---------------- */

function upstreamRequest(chatBody) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(chatBody);
    const req = https.request(
      {
        host: UPSTREAM_HOST,
        path: UPSTREAM_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + getKey(),
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              reject(new Error('bad JSON from upstream: ' + raw.slice(0, 300)));
            }
          } else {
            reject(new Error(`upstream HTTP ${res.statusCode}: ${raw.slice(0, 400)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/* ---------------- Response JSON (non-stream) ---------------- */

function handleResponsesNonStream(req, res, body) {
  upstreamRequest(buildChatBody(body))
    .then((chat) => {
      const first = chat && chat.choices && chat.choices[0] ? chat.choices[0].message : { content: '' };
      const payload = makeResponsePayload(first, chat && chat.usage);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    })
    .catch((e) => {
      err('non-stream upstream error:', e.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: e.message, type: 'upstream_error' } }));
    });
}

/* ---------------- Response streaming (SSE) ---------------- */

function handleResponsesStreaming(req, res, body) {
  const chatBody = buildChatBody(body);
  chatBody.stream = true;

  const data = JSON.stringify(chatBody);
  const roleCounts = {};
  for (const m of chatBody.messages) roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
  log('>> responses stream request, model=', chatBody.model, 'msgs=', chatBody.messages.length, 'roles=', JSON.stringify(roleCounts));
  log('   body keys=', Object.keys(body).join(','), 'tools=', Array.isArray(body.tools) ? body.tools.length : 0, 'maxout=', body.max_output_tokens, 'hasTemp=', body.temperature !== undefined);
  // dump raw incoming for diagnosis
  try { require('fs').writeFileSync('/tmp/codex-in-last.json', JSON.stringify(body)); } catch (e) {}

  const up = https.request(
    {
      host: UPSTREAM_HOST,
      path: UPSTREAM_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + getKey(),
        'Content-Length': Buffer.byteLength(data),
      },
    }
  );

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  let buffer = '';
  const created = Math.floor(Date.now() / 1000);
  const respId = 'resp_' + created;
  const itemId = 'msg_' + created;
  const partId = 'part_' + created;
  let seq = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningText = '';
  let textBuf = '';
  let itemAddedSent = false;
  let partAddedSent = false;
  // tool-call translation state
  const toolItems = {};   // index -> {id, call_id, name, args, parts, emitted_index}
  let toolIndexSeq = 0;   // monotonic for indexes across invocations
  let nextOutputIndex = -1; // next free output index for message/function items
  let reasoningClosed = false;
  let finalMsgItemPresent = false; // true once a real message text item was emitted
  function finalMsgIndexPresent() { return finalMsgItemPresent; }

  function sendSse(payload) {
    payload.sequence_number = seq++;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (payload.type === 'response.completed' || payload.type === 'response.created' || payload.type === 'response.output_item.added') {
      log('<< sse', payload.type);
    }
  }

  // core response skeleton without output
  function baseResponse(extra) {
    return {
      id: respId,
      object: 'response',
      created_at: created,
      status: 'in_progress',
      error: null,
      incomplete_details: null,
      instructions: null,
      max_output_tokens: null,
      model: MODEL,
      output: [],
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { effort: null, summary: [] },
      store: true,
      temperature: null,
      text: { format: { type: 'text' } },
      tool_choice: 'auto',
      tools: [],
      top_p: null,
      truncation: 'disabled',
      usage: null,
      metadata: {},
      user: null,
      ...extra,
    };
  }

  const rItemId = 'reasoning_' + created;
  let reasoningEmitted = false;
  let msgIndex = 0;

  function outputItem(status = 'in_progress') {
    return {
      id: itemId,
      type: 'message',
      status,
      role: 'assistant',
      content: [{ type: 'output_text', text: textBuf, annotations: [] }],
    };
  }
  function reasoningItem(status = 'in_progress') {
    return {
      id: rItemId,
      type: 'reasoning',
      status,
      summary: [{ type: 'summary_text', text: reasoningText.slice(0, 1500) }],
      content: [{ type: 'output_text', text: reasoningText.slice(0, 4000), annotations: [] }],
    };
  }

  // Emit reasoning item + summary deltas once reasoning appears.
  function emitReasoningFirst(initialDelta) {
    if (reasoningEmitted) {
      sendSse({
        type: 'response.reasoning_summary_text.delta',
        item_id: rItemId,
        output_index: 0,
        delta: initialDelta,
      });
      return;
    }
    reasoningEmitted = true;
    sendSse({ type: 'response.output_item.added', output_index: 0, item: reasoningItem() });
    sendSse({
      type: 'response.reasoning_summary_text.delta',
      item_id: rItemId,
      output_index: 0,
      delta: initialDelta,
    });
  }

  function emitMsgItemAdded() {
    if (itemAddedSent) return;
    itemAddedSent = true;
    finalMsgItemPresent = true;
    msgIndex = reasoningEmitted ? 1 : 0;
    // function_call items reuse dedicated indexes; msgIndex is the message text item index.
    sendSse({ type: 'response.output_item.added', output_index: msgIndex, item: outputItem() });
  }
  function emitMsgPartAdded() {
    if (partAddedSent) return;
    partAddedSent = true;
    sendSse({
      type: 'response.content_part.added',
      item_id: itemId,
      output_index: msgIndex,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    });
  }

  sendSse({ type: 'response.created', response: baseResponse({ status: 'in_progress' }) });

  up.on('response', (upRes) => {
    log('  upstream response status=', upRes.statusCode);
    upRes.setEncoding('utf8');
    if (upRes.statusCode >= 400) {
      // Capture the full error body from DeepSeek to diagnose 400s.
      let errBody = '';
      upRes.on('data', (c) => (errBody += c));
      upRes.on('end', () => {
        err('  UPSTREAM ERROR', upRes.statusCode, 'body=', errBody.slice(0, 2000));
        // Dump the outgoing chat messages to diagnose 400s (e.g. reasoning_content pass-back).
        try {
          const fs = require('fs');
          const dump = chatBody.messages.map((m) => ({
            role: m.role,
            content: (m.content || '').slice(0, 120),
            reasoning: (m.reasoning_content || '').slice(0, 120),
            tool_calls: Array.isArray(m.tool_calls) ? m.tool_calls.map((t) => t.function.name) : undefined,
            tool_call_id: m.tool_call_id || undefined,
            tc_count: m.tool_calls ? m.tool_calls.length : undefined,
          }));
          fs.writeFileSync('/tmp/chatbody-on-400.json', JSON.stringify({ status: upRes.statusCode, body: errBody, messages: dump }, null, 1));
        } catch (e) {}
        try {
          sendSse({ type: 'response.error', code: upRes.statusCode, message: 'upstream ' + upRes.statusCode, param: null, error: { type: 'upstream_error', code: upRes.statusCode, message: errBody.slice(0, 500) } });
          res.end();
        } catch (e) {}
      });
      return;
    }
    upRes.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const ch = JSON.parse(payload);
          if (ch.usage) {
            if (ch.usage.prompt_tokens) inputTokens = ch.usage.prompt_tokens;
            if (ch.usage.completion_tokens) outputTokens = ch.usage.completion_tokens;
          }
          const choice = ch.choices && ch.choices[0];
          if (!choice) continue;
          const delta = choice.delta || {};
          if (delta.reasoning_content) {
            reasoningText += delta.reasoning_content;
            emitReasoningFirst(delta.reasoning_content);
          }
          if (delta.content !== undefined && delta.content !== null && delta.content !== '') {
            emitMsgItemAdded();
            emitMsgPartAdded();
            sendSse({
              type: 'response.output_text.delta',
              item_id: itemId,
              output_index: msgIndex,
              delta: delta.content,
            });
            textBuf += delta.content;
          }
          // Tool calls: translate DeepSeek delta.tool_calls → Responses function_call items.
          if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index != null ? tc.index : toolIndexSeq;
              if (toolIndexSeq <= idx) toolIndexSeq = idx + 1;
              if (!toolItems[idx]) {
                toolItems[idx] = {
                  id: 'fc_' + created + '_' + idx,
                  call_id: (tc.id || 'call_' + created + '_' + idx),
                  name: (tc.function && tc.function.name) || '',
                  args: '',
                  emittedIndex: -1,
                };
              }
              const ti = toolItems[idx];
              if (tc.id) ti.call_id = tc.id;
              if (tc.function && tc.function.name !== undefined) ti.name = tc.function.name;
              if (tc.function && tc.function.arguments) ti.args += tc.function.arguments;

              if (ti.emittedIndex < 0) {
                // Allocate a dedicated output_index that never collides with the
                // reasoning item (0) or the message text item (msgIndex).
                let fcIndex;
                if (nextOutputIndex < 0) {
                  // first allocation: start above any reasoning/message item index
                  fcIndex = (reasoningEmitted ? 1 : 0);
                  if (itemAddedSent) fcIndex = Math.max(fcIndex, msgIndex + 1);
                  nextOutputIndex = fcIndex;
                } else {
                  fcIndex = ++nextOutputIndex;
                }
                ti.emittedIndex = fcIndex;
                sendSse({
                  type: 'response.output_item.added',
                  output_index: fcIndex,
                  item: {
                    id: ti.id,
                    type: 'function_call',
                    status: 'in_progress',
                    call_id: ti.call_id,
                    name: ti.name,
                    arguments: ti.args,
                  },
                });
              }
              if (tc.function && tc.function.arguments) {
                sendSse({
                  type: 'response.function_call_arguments.delta',
                  item_id: ti.id,
                  output_index: ti.emittedIndex,
                  delta: tc.function.arguments,
                });
              }
            }
          }
          if (choice.finish_reason) {
            // If this turn was purely a tool call (no assistant text), don't fabricate an empty
            // message text item. Only emit a message item if there is actual text.
            const hasToolCalls = Object.keys(toolItems).length > 0;
            const finalMsgIndex = hasToolCalls && textBuf.length === 0 ? -1 : msgIndex;
            if (finalMsgIndex >= 0) {
              if (textBuf.length === 0) {
                emitMsgItemAdded();
                emitMsgPartAdded();
              }
              sendSse({
                type: 'response.output_text.done',
                item_id: itemId,
                output_index: msgIndex,
                text: textBuf,
              });
              sendSse({
                type: 'response.content_part.done',
                item_id: itemId,
                output_index: msgIndex,
                content_index: 0,
                part: { type: 'output_text', text: textBuf, annotations: [] },
              });
              sendSse({ type: 'response.output_item.done', output_index: msgIndex, item: outputItem('completed') });
            }
            if (reasoningEmitted) {
              sendSse({ type: 'response.reasoning_summary_text.done', item_id: rItemId, output_index: 0, text: reasoningText });
              sendSse({ type: 'response.output_item.done', output_index: 0, item: reasoningItem('completed') });
              reasoningClosed = true;
            }
            // Finalize each tool call item.
            for (const idx of Object.keys(toolItems)) {
              const ti = toolItems[idx];
              if (ti.finalized) continue;
              ti.finalized = true;
              sendSse({
                type: 'response.function_call_arguments.done',
                item_id: ti.id,
                output_index: ti.emittedIndex,
                arguments: ti.args,
              });
              sendSse({
                type: 'response.output_item.done',
                output_index: ti.emittedIndex,
                item: {
                  id: ti.id,
                  type: 'function_call',
                  status: 'completed',
                  call_id: ti.call_id,
                  name: ti.name,
                  arguments: ti.args,
                },
              });
            }
          }
        } catch (e) {
          err('stream parse err:', e.message);
        }
      }
    });
    upRes.on('end', () => {
      log('  upstream end; textBuf len=', textBuf.length);
      try {
        // Safety net for the case where no finish_reason was observed (upstream cut), or
        // to finalize reasoning if it was emitted but never closed.
        const hasToolCalls = Object.keys(toolItems).length > 0;
        if (reasoningEmitted && !reasoningClosed) {
          sendSse({ type: 'response.reasoning_summary_text.done', item_id: rItemId, output_index: 0, text: reasoningText });
          sendSse({ type: 'response.output_item.done', output_index: 0, item: reasoningItem('completed') });
          reasoningClosed = true;
        }
        if (hasToolCalls) {
          // If the turn emitted tool calls but we never saw finish_reason, finalize them.
          for (const idx of Object.keys(toolItems)) {
            const ti = toolItems[idx];
            if (!ti.finalized) {
              ti.finalized = true;
              sendSse({
                type: 'response.function_call_arguments.done',
                item_id: ti.id,
                output_index: ti.emittedIndex,
                arguments: ti.args,
              });
              sendSse({
                type: 'response.output_item.done',
                output_index: ti.emittedIndex,
                item: {
                  id: ti.id,
                  type: 'function_call',
                  status: 'completed',
                  call_id: ti.call_id,
                  name: ti.name,
                  arguments: ti.args,
                },
              });
            }
          }
        } else if (textBuf.length === 0) {
          // Neither text nor tools: emit an empty message item so Codex has a closed turn.
          emitMsgItemAdded();
          emitMsgPartAdded();
          sendSse({ type: 'response.output_text.done', item_id: itemId, output_index: msgIndex, text: '' });
          sendSse({
            type: 'response.content_part.done',
            item_id: itemId,
            output_index: msgIndex,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] },
          });
          sendSse({ type: 'response.output_item.done', output_index: msgIndex, item: outputItem('completed') });
        }
        const finalOutput = [];
        if (reasoningEmitted) finalOutput.push(reasoningItem('completed'));
        if (finalMsgIndexPresent()) finalOutput.push(outputItem('completed'));
        for (const idx of Object.keys(toolItems)) {
          const ti = toolItems[idx];
          finalOutput.push({
            id: ti.id,
            type: 'function_call',
            status: 'completed',
            call_id: ti.call_id,
            name: ti.name,
            arguments: ti.args,
          });
        }
        const outTokens = outputTokens || textBuf.split(/\s+/).filter(Boolean).length;
        sendSse({
          type: 'response.completed',
          response: baseResponse({
            id: respId,
            created_at: created,
            status: 'completed',
            output: finalOutput,
            usage: { input_tokens: inputTokens, output_tokens: outTokens, total_tokens: inputTokens + outTokens },
          }),
        });
        res.end();
        log('  stream finalized + closed');
      } catch (e) {
        err('final sse error:', e.message);
        try { res.end(); } catch (e2) {}
      }
    });
  });

  up.on('error', (e) => {
    err('stream upstream error:', e.message);
    try {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: e.message, type: 'upstream_error' } }));
    } catch (e2) {
      /* ignore */
    }
  });

  up.write(data);
  up.end();
}

/* ---------------- HTTP server ---------------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;

  // Read body (with a sane size cap so a runaway/oversized body can't OOM us)
  let raw = '';
  let tooBig = false;
  const MAX_BODY = 16 * 1024 * 1024; // 16 MB
  req.on('data', (c) => {
    if (tooBig) return;
    raw += c;
    if (raw.length > MAX_BODY) {
      tooBig = true;
      raw = '';
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'request body too large' } }));
      req.destroy();
      return;
    }
  });
  req.on('end', () => {
    if (tooBig) return;
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch (e) {
      body = {};
    }

    // Models endpoint
    if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(MODELS));
      return;
    }

    // Responses endpoint
    if (req.method === 'POST' && (path === '/v1/responses' || path === '/responses')) {
      if (body.stream === true) {
        handleResponsesStreaming(req, res, body);
      } else {
        handleResponsesNonStream(req, res, body);
      }
      return;
    }

    // Optional: pass-through chat completions for diagnostics
    if (req.method === 'POST' && (path === '/v1/chat/completions' || path === '/chat/completions')) {
      upstreamRequest(body)
        .then((chat) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(chat));
        })
        .catch((e) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: e.message } }));
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found: ' + path } }));
  });
  req.on('error', () => {});
  res.on('error', () => {});
});

// HTTP server hardening: avoid silently hung sockets; keep-alive for perf.
server.requestTimeout = 10 * 60 * 1000; // 10 min cap on receiving a full request
server.headersTimeout = 60 * 1000;
server.keepAliveTimeout = 5000;

server.on('clientError', (e, socket) => {
  err('server clientError:', e && e.message);
  try { socket.destroy(); } catch (_) {}
});

server.on('error', (e) => {
  err('SERVER ERROR:', e && e.code, e && e.message);
  if (e && e.code === 'EADDRINUSE') {
    err('Port ' + PORT + ' already in use — is another codex-deepseek-proxy instance running?');
    err('Find it: lsof -nP -iTCP:' + PORT + ' -sTCP:LISTEN');
  }
});

// Crash diagnostics: if the process ever dies unexpectedly (e.g. inside an async
// handler), log the stack to stderr so launchd KeepAlive restarts are traceable.
process.on('uncaughtException', (e) => {
  err('UNCAUGHT EXCEPTION, will exit for restart:', e && e.stack ? e.stack : e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  err('UNHANDLED REJECTION:', e && e.stack ? e.stack : e);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`DeepSeek responses proxy listening on http://127.0.0.1:${PORT}/v1`);
  log(`Upstream: ${UPSTREAM_HOST}${UPSTREAM_PATH} model=${MODEL}`);
  log(`Key loaded: ${getKey() ? 'yes (from ' + AUTH_FILE + ')' : 'NO KEY'}`);
});
