# Codex 连接 DeepSeek —— 修复记录与回滚指南

> 更新时间：2026-08-29（最终版）
> 状态：**已修复并验证 —— Codex 通过本地 Responses↔Chat 翻译代理连接 DeepSeek，实测可用（HTTP 200）**。

---

## 一、你遇到的问题

用 Codex 搭配 CC Switch 连接 DeepSeek，**连接时总是超时**。
尝试过 CC Switch 转发 + 其它翻译工具，希望修复。

---

## 二、根因（三个关键事实）

### 事实 1：端口不对 → 「连接超时」的直接原因 ✅ 已修复

- `~/.codex/config.toml` 里 `base_url` 原本指向 **`http://127.0.0.1:57321/v1`**。
- 但 CC Switch 本地代理实际监听在 **`http://127.0.0.1:15721/v1`**（数据库 `~/.cc-switch/cc-switch.db` 的 `proxy_config` 印证）。
- 端口 `57321` 上**根本没有服务** → Codex 一连就超时。

### 事实 2：当前 Codex 只支持 `Responses` 协议，不支持 `chat`

- Codex CLI（本机为 `codex-cli 0.146.0`）已**移除 `chat/completions` 支持**。
- 配置里写 `wire_api = "chat"` 会导致 `config.toml` **无法加载**，报错：
  `wire_api = "chat" is no longer supported. set wire_api = "responses"`。
- 官方公告：[openai/codex Discussion #7782](https://github.com/openai/codex/discussions/7782)。

### 事实 3：DeepSeek 只支持 `Chat Completions`，不支持 `Responses`

- 实测 `https://api.deepseek.com/v1/responses` 返回 **400**，`/v1/chat/completions` 返回 **200**。
- 因此 **Codex（Responses）不能直连 DeepSeek（Chat）**，中间必须有一个把 Responses 翻译成 Chat 的一层。
- CC Switch 本应做这个翻译，但存在已知 bug：它把 Codex 的 `/responses` 直接转发到 DeepSeek 根路径（`https://api.deepseek.com/`）→ **404**。
  - [GitHub Issue #4539：Codex + DeepSeek 返回 404 — responses 未翻译成 Chat](https://github.com/farion1231/cc-switch/issues/4539)
  - 该 bug 的界面层修复需在 CC Switch「API 高级选项 → 上游格式 → Chat Completions」手动设置，无法用改配置文件/数据库替代，且当前版本 3.20.1 仍不生效。

---

## 三、采用的方案：本地「Responses↔Chat」翻译代理（已验证）

为了既不依赖 CC Switch 的翻译 bug，又能让只支持 Responses 的 Codex 用上仅支持 Chat 的 DeepSeek，我写了一个零依赖的 **Node 本地翻译代理**，跑在 `127.0.0.1:15723`。

链路：
```
Codex  ──(Responses API)──▶  本地代理 127.0.0.1:15723  ──(Chat Completions)──▶  https://api.deepseek.com/v1
        wire_api="responses"      翻译 Responses→Chat                           注入 auth.json 里的 Key
```

### 当前生效配置（`~/.codex/config.toml` 的 `[model_providers.custom]` 段）

```toml
[model_providers.custom]
name = "deepseek-local"
wire_api = "responses"
requires_openai_auth = true
base_url = "http://127.0.0.1:15723/v1"
```

### 认证（`~/.codex/auth.json`）

```json
{ "OPENAI_API_KEY": "sk-fb580..." }   // 具体密钥在此文件中，这里脱敏；由代理注入上游
```

### 代理文件

- 脚本：`/Users/fangfang/Documents/区块链供应链/codex-deepseek-proxy.js`
- 运行方式：由 macOS `launchd` 开机自启并保活
- 常驻端口：`127.0.0.1:15723`
- 日志：`~/Library/Logs/codex-deepseek-proxy.log` 与 `.error.log`

### 验证结果（经本地代理，Responses 协议）

- `GET /v1/models` → 返回 `deepseek-v4-flash`
- `POST /v1/responses`（非流式）→ HTTP 200，返回标准 Responses 结构，assistant 回复中包含中文答案
- `POST /v1/responses`（**流式 SSE**，Codex 实际用的方式）→ 完整事件序列，HTTP 200，约 1.6 秒返回：
  `response.created` → `response.output_item.added`(reasoning) → `response.reasoning_summary_text.delta*` → `response.output_item.added`(message) → `response.content_part.added` → `response.output_text.delta*` → `response.output_text.done` → `response.content_part.done` → `response.output_item.done` → `response.completed`，然后正常关闭连接。
- 结论：**重启 Codex 即可正常对话。**

### 曾经遇到、并已修复的流式坑（“发消息没回复、也没报错”）

第一次实现漏了两个关键点，导致 Codex 客户端“吞掉”整个流、表面上看没有任何回复也没有错误：

1. **缺少 `response.output_item.added` 和 `response.content_part.added`**：Responses 流式协议要求先声明输出项再加入文本 delta，否则 Codex 会丢弃这些 delta。
2. **没有在 `response.completed` 之后调用 `res.end()`，反而多发了一条 `response.failed`**：导致连接迟迟不关闭（客户端挂起 → 超时）。已改为发送 `response.completed` 后立刻 `res.end()` 并正常关闭。

### 真正的最终拦路虎：Codex 工具与 DeepSeek 格式不兼容（400 `missing field function`）

上面修好后，代理日志显示 Codex **已经能连上来**，但 DeepSeek 上游对真实对话返回 **HTTP 400**，代理此前把这个 400 吞掉了 → 表现为“没回复、没报错”。

抓取 DeepSeek 400 响应体（往代理里加了上游错误体日志后）得到确切原因：

```
"tools[0]: missing field `function`"
```

- **Codex 0.146 发的是 Responses 格式工具**：`{"type":"function","name":"exec_command","description":...,"parameters":...}`（扁平，没有 `function` 包装），还包含 DeepSeek 不认识的 `custom` / `namespace` / `tool_search` / `web_search` 等工具类型。
- **DeepSeek Chat Completions 只认 Chat 格式**：`{"type":"function","function":{"name":...,"description":...,"parameters":...}}`（必须有 `function` 包装），且只支持 `type=function`。

修复：在 `codex-deepseek-proxy.js` 新增 `convertTools()`——
1. 只保留 `type===function` 的工具（丢弃 custom/namespace/tool_search/web_search）；
2. 把扁平工具包装成 `function:{...}` 结构；
3. 忽略无合法 object `parameters` 的工具。

用**真实抓取的 Codex 请求体回放**验证：修复前 400 → 修复后 HTTP 200，返回完整中文回复，流式 `response.completed` 正常结束。

### 又一次新症状：“说了一句话就没”——原因是工具调用（tool_calls）没被翻译

400 修掉后，Codex 能回复了，但出现“说完一句话就截断、没有任何工具调用”。日志显示 DeepSeek 返回 HTTP 200 且文本只有短短一段，`upstream end`.

直接向 DeepSeek 发一条“请调用 exec_command ls”的探测请求，得到真相：**DeepSeek v4-flash 会主动发出工具调用**——返回 `finish_reason: tool_calls`、`message.tool_calls=[{name:"exec_command", arguments:"{\"cmd\":\"ls -la\"}"}]`、`content:""`。

而代理当时的流式处理**只转发 `delta.content` 和 `delta.reasoning_content`，完全丢弃了 `delta.tool_calls`**。于是 Codex 只看到一句短的文本（甚至空文本），却收不到工具调用 → 回合戛然而止，看起来像“说了一句就没了”。

修复（三处，均在 `codex-deepseek-proxy.js`）：

1. **流式出站 `delta.tool_calls` → Responses `function_call` 输出项**：按序号累积 `delta.tool_calls[i].function.arguments` 片段，依次发 `response.output_item.added`(function_call) → `response.function_call_arguments.delta*` → `response.function_call_arguments.done` → `response.output_item.done`；`finish_reason` 时若纯工具调用则不伪造空文本消息项，并在 `response.completed.output` 里带上 `function_call` 项。
2. **流式 `response.completed` 组装**：`output` 数组 = reasoning（如有）+ message（如有文本）+ function_call（每个工具调用）。
3. **非流式 `makeResponsePayload`**：同样支持 `chatMsg.tool_calls` → 加入 `function_call` 输出项。

另把 `extractMessages` 重写为能正确处理 Codex 的**交错工具历史**：
- `{type:"message", role:"assistant"}` → Chat assistant 消息
- `{type:"function_call"}` → 合并进紧邻的 assistant 消息的 `tool_calls`（Chat 格式要求工具调用挂在 assistant 消息上）
- `{type:"function_call_output"}` → `{role:"tool", tool_call_id, content}`
- `{type:"reasoning"}` → 提取到后续 assistant 消息的 `reasoning_content`（DeepSeek 多轮要求回传 reasoning_content）
- `role:"developer"` → `role:"system"`

验证（全部 HTTP 200、错误日志为空）：
- 文本回复流式 → `你好`
- 流式工具调用 → `function_call_arguments.done` 携带 `{"cmd":"ls -la"}`，有 `output_item.added`(function_call)
- 非流式工具调用 → `output=[reasoning, function_call]` 携带 `{"cmd":"pwd"}`
- 交错工具历史（assistant(tool_calls) + tool 结果）翻译后 DeepSeek 接受，角色序列 `user,assistant,tool,assistant,user` 正确

### 排查过程的关键：捕获上游 400 响应体

为实现“代理想装看不见 400”，在流式/非流式上游响应处加了 `>=400` 时收集响应体并写入错误日志的逻辑。这一步是定位工具格式问题的决定性手段——否则只能看到 `status= 400` 却不知为何。

---

## 四、复述：修复步骤清单

1. 找出 CC Switch 实际代理端口：数据库 `proxy_config` → `listen_port = 15721`（解决超时问题）。
2. 由于 Codex 0.146 弃用 `chat`、DeepSeek 只支持 chat，确认必须用 **Responses 翻译层**。
3. 编写并启动零依赖 Node 本地翻译代理（`codex-deepseek-proxy.js`），监听 `127.0.0.1:15723`。
4. 把 `~/.codex/config.toml` 设为 `wire_api = "responses"` + `base_url = "http://127.0.0.1:15723/v1"`。
5. 用 `launchd` 让代理开机自启、进程退出自动拉起。
6. 重启 Codex。

---

## 五、备份与回滚

### 备份文件

| 备份 | 内容 |
|------|------|
| `~/.codex/config.toml.bak-portfix-20260829-132158` | 仅改端口的中间态（`wire_api=responses`，base_url=`127.0.0.1:15721`，即仍想走 CC Switch 转发时的配置） |
| `~/.codex/config.toml.bak-proxy-20260829-133424` | 直连切换前的 CC Switch 转发配置 |
| `~/.codex/config.toml.bak-brokenChat-20260829-***` | 不可加载的 `wire_api="chat"` 直连配置（仅存档） |
| `~/.cc-switch/cc-switch.db.bak-preswap-20260829-132730` | CC Switch 数据库改动前备份 |

### 回滚 Codex 配置

```bash
cp ~/.codex/config.toml.bak-portfix-20260829-132158 ~/.codex/config.toml
```

### 停止 / 移除本地翻译代理

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ccswitch-deepseek.proxy.plist
rm ~/Library/LaunchAgents/com.ccswitch-deepseek.proxy.plist
```

---

## 六、管理本地翻译代理（手动命令）

```bash
# 查看进程
launchctl list | grep ccswitch-deepseek

# 手动重启（改完代码后）
launchctl kickstart gui/$(id -u)/com.ccswitch-deepseek.proxy

# 查看日志
tail -f ~/Library/Logs/codex-deepseek-proxy.log
```

窗口内也可手动前台跑（调试用，会占用 15723）：
```bash
cd /Users/fangfang/Documents/区块链供应链 && node codex-deepseek-proxy.js
```

---

## 七、若日后想改用「CC Switch 转发 + 翻译」通道

前提：CC Switch 的 DeepSeek 供应商「上游格式」确实设为 **Chat Completions（需开启路由）** 后，再切回才是 404 之外的正常路径。

Codex 切回代理（用 CC Switch 15721）：
```toml
[model_providers.custom]
name = "custom"
wire_api = "responses"
requires_openai_auth = true
base_url = "http://127.0.0.1:15721/v1"
```

---

## 八、被确认、但未改动的项

- `~/.zshrc` 引用的 `~/.strix/env.sh` 导出 `LLM_API_KEY` / `STRIX_LLM`，**不影响 Codex**（无 `OPENAI_BASE_URL` 覆盖）。
- CC Switch 版本 `3.20.1`：本地转发存在已知 Translation bug，本方案不依赖 CC Switch 运行状态（代理独立常驻）。CC Switch 的 DeepSeek 供应商、15721 代理仍保留，可随时改回。

---

## 九、最终根因：流式事件里 item 状态违反 Responses SSE 规范（引发 Codex 主动断开）

**现象**（在工具调用修复后仍复发）：Codex 报 `stream disconnected before completion: stream closed before response.completed`。代理日志显示流已完整发送（HTTP 200 + `stream finalized + closed`），错误日志无 400 —— 即问题是代理发给 Codex 的流，"Codex 客户端不接受而主动掐断"，而非上游。

**根因**：`handleResponsesStreaming` 里，`response.output_item.added` 事件发出的 item 硬编码为 `status: "completed"`（`outputItem()`/`reasoningItem()` 默认值），但同一 item 之后仍继续推送 deltas（`reasoning_summary_text.delta` / `output_text.delta` / `function_call_arguments.delta`）。

OpenAI Responses API 流式规范要求：
- **`response.output_item.added` 的 item `status` 必须是 `in_progress`**
- 只有 **`response.output_item.done`** 才带 `status: "completed"`

Codex 的流式解析器校验到"已 completed 的 item 仍接收 delta"，判定流非法，于是主动断开连接 → 表现就是 "stream closed before response.completed"。

**修复**：给 `outputItem()` / `reasoningItem()` 增加 status 参数（默认 `'in_progress'`），`added` 事件用默认值（in_progress），`output_item.done` 与 `response.completed.output[]` 用 `'completed'`。

**验证**：录制实际 SSE 序列并做严格规范校验，`ERRORS: 0, WARNS: 0`。`added` 三类型（reasoning/message/function_call）全部 `in_progress`，`completed` 后全部 `completed`。

校验脚本：`/tmp/record_stream.py`（向 127.0.0.1:15723 回放真实 1143 项历史 `/tmp/codex-in-last.json`，录制每个 `data:` 事件到 `/tmp/captured_stream.json` 并逐条校验 added/delta/done/completed 的 item_id、output_index、状态和顺序）。

---

## 2026-08-29 最终根因修复(& reasoning_content 回传 & 消除重复 assistant) — 已验证生效

### 症状
用户:发一句话就没了,无工具调用,输出截断,Codex 提示 `stream disconnected before completion: stream closed before response.completed`。
此前推测是 SSE/protocol 问题,实为上游 400。

### 真正根因(extractMessages 两个 bug)
1. **Bug A — reasoning_content 从未被捕获**:Codex 把推理文本存在 reasoning item 的 `content[].text`(type=reasoning_text),
   不在 `summary`(恒为空 `[]`)也不在顶层 `item.text`。旧代码 `const text = item.summary ? extractText(item.summary) : item.text ? ...` 恒得空串
   → 所有 271 条 reasoning_content 被丢弃 → DeepSeek 400
   `The reasoning_content in the thinking mode must be passed back to the API.`(thinking 模式强制回传)
2. **Bug B — 重复 assistant 消息**:真实序列 `reasoning → message(assistant文本) → function_call` 是**同一轮**。
   旧代码 message handler 推一条带文本的 assistant,function_call handler 又建第二条带相同文本+tool_calls 的 assistant
   → 每轮 2 条重复 assistant → DeepSeek 400(重复会破坏 reasoning_content 归属)。

### 修复(codex-deepseek-proxy.js 的 extractMessages)
- 从 `item.content[].text`(回退 summary[].text,再回退 item.text)提取推理文本;用 `pendingReasoning` 缓冲,
  经 `flushReasoningTo(msg)` 刷到**下一条** assistant 消息(推理总是先于其所属 assistant)。
- 加 `lastFromMessageMsg` tracker + `nextIsMessageAt(arr,idx)`;function_call handler 把 tool_calls+待刷推理
  **合并进紧邻的前一条 assistant**(同一轮),不再生成重复 assistant;仅当前面无轮次消息时才新建。
- 此前已加:outputItem()/reasoningItem() 带 status 参数(默认 in_progress),added 事件用 in_progress,done/completed 用 completed。

### 验证结果
- extractMessages 于真实 /tmp/codex-in-last.json:messages 842→745(去重),重复 assistant 文本=0,assistant-with-tool_calls=334 配对问题=0,assistant-with-reasoning_content=271。
- 真实历史经 127.0.0.1:15723 回放:HTTP 200,response.completed 结束,1 次工具调用;严格 SSE 校验 ERRORS:0 WARNS:0。
- 线上日志证实:修复后真实 Codex 请求 msgs 742 → upstream 200 → response.completed → `stream finalized + closed`(07:04 起稳定)。
- 400 调试辅助:代理在 400 时把请求体结构 dump 到 /tmp/chatbody-on-400.json。

### 运维命令
- 重启:`launchctl kickstart -k gui/$(id -u)/com.ccswitch-deepseek.proxy`
- 语法检查:`/Users/fangfang/.local/bin/node --check codex-deepseek-proxy.js`
- 日志:`~/Library/Logs/codex-deepseek-proxy.log` / `.error.log`

---

## 2026-08-29 收尾优化(用户确认已修复后)

### 代码健壮性优化(codex-deepseek-proxy.js)
- **日志治理**:超长 roles 列表改为角色统计计数(如 `roles={"system":5,"user":21,"assistant":358,"tool":376}`),日志不再刷屏。
- **requestTimeout / headersTimeout / keepAliveTimeout**:避免 socket 静默挂起;keep-alive 提升性能。
- **clientError / server 'error' handler**:HTTP 客户端错误干净销毁;端口占用(EADDRINUSE)时给出清晰指引(`lsof -nP -iTCP:15723`)。
- **process 级崩溃诊断**:`uncaughtException` 打印完整堆栈后退出(launchd KeepAlive 自动拉起);`unhandledRejection` 打印堆栈不退出。崩溃可追溯。
- **body 大小上限 16MB**:请求体超限返回 413,防 OOM。
- 这些改动均未触碰核心翻译逻辑(extractMessages/buildChatBody/streaming)。已用真实历史回放回归验证:HTTP 200 + response.completed + 1 工具调用,功能无损。

### 运维辅助
- 健康检查脚本 **check-codex-deepseek.sh**(本目录):一键检查 launchd 任务/端口/API key/models/上游连通/错误日志,6 项全绿。
- 优化版备份至 **backups/codex-deepseek-proxy.optimized.js**。
- 注意:向 /v1/responses 发请求时 **input 必须是数组**(item 列表,Codex 原生格式),传字符串会导致 "Empty input messages" 400(测试陷阱,非 bug)。

### 当前最终状态(已验证可用)
- ~/.codex/config.toml [model_providers.custom]:wire_api="responses",base_url="http://127.0.0.1:15723/v1",requires_openai_auth=true。
- 代理监听 127.0.0.1:15723,launchd KeepAlive 保活,重启命令 `launchctl kickstart -k gui/$(id -u)/com.ccswitch-deepseek.proxy`。
- 历史会话(~/.codex/sessions 等)全程未被改动。
