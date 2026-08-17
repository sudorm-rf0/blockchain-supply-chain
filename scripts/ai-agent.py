#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 运维自愈代理（VPS 版）

触发方式：由 alert-lib.sh 的 alert() 在发出告警时后台调用：
    printf '%s' "$body" | python3 ai-agent.py "$key" "$subject"

策略（重要）：
- **只在“严重且必要”的问题上自动动手**（默认 severity 达到 critical）：
  核心服务/站点不可用、磁盘将满(>=90%)、安全防线失效（fail2ban 挂、CF 收紧规则缺失）。
- 非严重问题（内存偏低、证书快到期、小告警等）：只做诊断记录，**不执行任何修复、不发额外邮件**。
- 动作白名单：AI 永远不能执行任意 shell；改 iptables/ufw/配置/重建容器/删数据一律需人工。

流程：
  1) 冷却去重 → 2) 收集上下文 → 3) 严重度初判
  4) 严重才做确定性自愈（fail2ban/CF 规则）
  5) 有 Key 则 LLM 诊断（返回 severity + 枚举动作）
  6) 最终严重度达标才执行白名单动作；否则只记录
  7) 需人工介入 → alert-mail.py 通知；自动处理完成 → 仅写日志（AI_EMAIL_AUTO_FIX=1 才发邮件）；全程写 /var/log/supply-chain-ai-agent.log

配置：/etc/supply-chain-ai.env
  AI_API_KEY=          # LLM Key（留空则只做确定性判断）
  AI_BASE_URL=         # OpenAI 兼容地址，默认 https://api.deepseek.com
  AI_MODEL=            # 默认 deepseek-chat
  AI_AGENT_ENABLED=    # 1 才调用 LLM
  AI_AUTO_RESTART=     # 1 允许重启 supply-chain 应用容器；默认 0
  AI_ACT_SEVERITY=     # 自动动手的最低严重度：info|warning|critical，默认 critical
  AI_DRY_RUN=          # 1 只记录不执行不发通知
  AI_COOLDOWN=         # 同 key 最小间隔秒，默认 1800
  AI_EMAIL_AUTO_FIX=   # 1=自动处理完成也发邮件；默认 0=仅记录日志
  AI_TIMEOUT=          # LLM 超时秒，默认 45
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

ENV_PATH = Path("/etc/supply-chain-ai.env")
STATE_DIR = Path("/var/lib/supply-chain-alerts")
LOG_PATH = Path("/var/log/supply-chain-ai-agent.log")
ALERT_MAIL = "/opt/supply-chain/scripts/alert-mail.py"

SAFE_RESTART_CONTAINERS = {
    "supply-chain-backend", "supply-chain-frontend", "supply-chain-indexer",
    "supply-chain-pool", "supply-chain-trade", "supply-chain-nginx",
    "supply-chain-clamav", "supply-chain-cf-relay",
}
SAFE_SERVICES = {"fail2ban"}
NEVER_AUTO = {"iptables", "ufw", "config_edit", "container_recreate", "data_delete", "docker_prune_all"}
SEV_ORDER = {"info": 0, "warning": 1, "critical": 2}


def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(f"{ts} {msg}\n")
    except Exception:
        pass


def load_env():
    cfg = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            cfg[k.strip()] = v.strip()
    for k in ("AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "AI_AGENT_ENABLED",
              "AI_AUTO_RESTART", "AI_ACT_SEVERITY", "AI_DRY_RUN", "AI_COOLDOWN", "AI_TIMEOUT"):
        if os.environ.get(k):
            cfg[k] = os.environ[k].strip()
    return cfg


def sh(cmd, timeout=20):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        out = (r.stdout or "").strip()
        err = (r.stderr or "").strip()
        return out + ("\n" + err if err else "")
    except Exception as e:
        return f"<cmd error: {e}>"


def collect_context(key, subject, body):
    ctx = {
        "issue_key": key, "subject": subject, "body": body[:4000],
        "now": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    ctx["docker_ps"] = sh("docker ps -a --format '{{.Names}}\t{{.Status}}' | grep -E 'supply-chain|escrow' | head -30")
    ctx["disk"] = sh("df -h / | tail -1")
    ctx["mem"] = sh("free -m | head -2")
    ctx["fail2ban_state"] = sh("systemctl is-active fail2ban 2>/dev/null").strip()
    ctx["fail2ban"] = sh("fail2ban-client status sshd 2>/dev/null | grep -E 'Currently banned|Total failed'")
    ctx["cf_harden"] = sh("iptables -C DOCKER-USER -i ens18 -p tcp --dport 443 -j DROP 2>/dev/null && echo 'DOCKER-USER 443 DROP: OK' || echo 'DOCKER-USER 443 DROP: MISSING'")
    ctx["monitor_log"] = sh("tail -n 12 /var/log/supply-chain-monitor.log 2>/dev/null")
    ctx["alert_log"] = sh("tail -n 6 /var/log/supply-chain-alert.log 2>/dev/null")
    return ctx


def assess_severity(cfg, ctx, subject):
    """无 LLM 时的严重度初判（critical=必须处理）。"""
    s = "info"
    ps = ctx.get("docker_ps", "")
    for line in ps.splitlines():
        for c in ("supply-chain-backend", "supply-chain-frontend", "supply-chain-nginx"):
            if c in line and ("unhealthy" in line or "Restarting" in line):
                s = "critical"
    subj = subject or ""
    if any(k in subj for k in ("vps-app", "应用健康", "/health", "vps-containers", "容器异常")):
        s = "critical"
    try:
        disk_pct = int(ctx["disk"].split()[-2].rstrip("%")) if len(ctx["disk"].split()) >= 5 else 0
        if disk_pct >= 90:
            s = "critical"
        elif disk_pct >= 80:
            s = "warning"
    except Exception:
        pass
    if ctx.get("fail2ban_state", "") != "active":
        s = "critical"
    if "MISSING" in ctx.get("cf_harden", ""):
        s = "critical"
    return s


def deterministic_heal(cfg, ctx, allow_act):
    fixes, findings = [], []
    if not allow_act:
        findings.append("非严重问题：按策略仅诊断，不自动处置")
        return fixes, findings
    if ctx.get("fail2ban_state", "") != "active":
        if cfg.get("AI_DRY_RUN") == "1":
            fixes.append("[dry-run] fail2ban 失活 -> 将重启")
        else:
            sh("systemctl restart fail2ban")
            fixes.append("fail2ban 失活 -> 已重启")
    if "MISSING" in ctx.get("cf_harden", ""):
        if cfg.get("AI_DRY_RUN") == "1":
            fixes.append("[dry-run] CF 收紧规则缺失 -> 将重建")
        else:
            sh("/usr/local/bin/supply-chain-cf-harden.sh")
            fixes.append("CF 收紧规则缺失 -> 已重建")
    return fixes, findings


SYSTEM_PROMPT = """你是部署在香港 VPS（Ubuntu 22.04 + Docker）上的供应链金融平台的资深运维 AI。
任务：根据告警与上下文做诊断，并给出**最小、安全**的处置建议。
规则（必须遵守）：
1. 只返回一个 JSON 对象，不要任何额外文字。
2. JSON 结构：{"diagnosis":"中文诊断","severity":"info|warning|critical","summary":"给用户的一句话摘要","actions":[{"type":"...","target":"...","reason":"..."}],"needs_human":bool}
3. severity 判定：核心服务/站点不可用、磁盘>=90%、安全防线失效=critical；接近阈值/即将到期=warning；其他=info。
4. actions 的 type 只能是：docker_restart（target 必须是 supply-chain-backend/frontend/indexer/pool/trade/nginx/clamav/cf-relay 之一）、restart_service（target=fail2ban）、reapply_cf_harden、docker_prune_dangling、report_only。
5. 严禁建议改 iptables/ufw/防火墙、改配置文件、重建或重装容器、删除数据/数据库——这类一律 needs_human=true 并说明原因。
6. 不确定时 needs_human=true。"""


def call_llm(cfg, ctx):
    base = cfg.get("AI_BASE_URL", "https://api.deepseek.com").rstrip("/")
    model = cfg.get("AI_MODEL", "deepseek-chat")
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "【告警】\n主题: {}\n内容:\n{}\n\n【服务器上下文】\n{}".format(
                ctx["subject"], ctx["body"],
                json.dumps({k: v for k, v in ctx.items() if k not in ("subject", "body")}, ensure_ascii=False, indent=1))},
        ],
        "temperature": 0.2,
        "max_tokens": 800,
    }
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {cfg.get('AI_API_KEY', '')}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=int(cfg.get("AI_TIMEOUT", "45"))) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def parse_json_response(text):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("LLM 未返回 JSON")
    return json.loads(text[start:end + 1])


def execute_actions(cfg, actions, fixes, findings, allow_act):
    did_something, needs_human = False, False
    dry = cfg.get("AI_DRY_RUN") == "1"
    if not allow_act:
        for a in actions:
            findings.append("[不执行] {} {}：{}（非严重问题，按策略仅诊断）".format(
                a.get("type", "?"), a.get("target", ""), a.get("reason", ""))[:300])
        return did_something, needs_human
    for a in actions:
        typ = (a.get("type") or "report_only").strip()
        tgt = (a.get("target") or "").strip()
        reason = (a.get("reason") or "").strip()[:200]
        if typ in NEVER_AUTO or (typ == "docker_restart" and cfg.get("AI_AUTO_RESTART") != "1"):
            needs_human = True
            findings.append(f"[需人工] {typ} {tgt}：{reason}")
            continue
        if typ == "docker_restart":
            if tgt not in SAFE_RESTART_CONTAINERS:
                needs_human = True
                findings.append(f"[需人工] 容器 {tgt} 不在允许重启名单")
                continue
            if dry:
                fixes.append(f"[dry-run] 将重启容器 {tgt}")
            else:
                fixes.append(f"已重启容器 {tgt}：{sh(f'docker restart {tgt}')[:120]}")
            did_something = True
        elif typ == "restart_service":
            if tgt not in SAFE_SERVICES:
                needs_human = True
                findings.append(f"[需人工] 服务 {tgt} 不在允许名单")
                continue
            if dry:
                fixes.append(f"[dry-run] 将重启服务 {tgt}")
            else:
                sh(f"systemctl restart {tgt}")
                fixes.append(f"已重启服务 {tgt}")
            did_something = True
        elif typ == "reapply_cf_harden":
            if dry:
                fixes.append("[dry-run] 将重建 CF 收紧规则")
            else:
                sh("/usr/local/bin/supply-chain-cf-harden.sh")
                fixes.append("已重建 CF 收紧规则")
            did_something = True
        elif typ == "docker_prune_dangling":
            if dry:
                fixes.append("[dry-run] 将清理悬空镜像/构建缓存")
            else:
                sh("docker image prune -f >/dev/null 2>&1; docker builder prune -f >/dev/null 2>&1")
                fixes.append("已清理悬空镜像/构建缓存")
            did_something = True
        else:
            findings.append(f"[观察] {tgt or reason or '无操作'}")
    return did_something, needs_human


def notify(subject, body):
    try:
        subprocess.run([ALERT_MAIL, subject, body], timeout=25,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        log(f"notify 失败: {e}")


def main():
    if len(sys.argv) < 3:
        log("用法: ai-agent.py <issue_key> <subject>  < body")
        return 0
    key, subject = sys.argv[1], sys.argv[2]
    body = sys.stdin.read() if not sys.stdin.isatty() else ""
    cfg = load_env()

    cooldown = int(cfg.get("AI_COOLDOWN", "1800"))
    state = STATE_DIR / f"ai-{key}"
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        if state.exists():
            last = float(state.read_text().strip() or 0)
            if time.time() - last < cooldown:
                log(f"[{key}] 冷却期内，跳过")
                return 0
    except Exception:
        pass

    ctx = collect_context(key, subject, body)
    threshold = cfg.get("AI_ACT_SEVERITY", "critical")
    det_sev = assess_severity(cfg, ctx, subject)
    allow_act = SEV_ORDER.get(det_sev, 0) >= SEV_ORDER.get(threshold, 2)

    fixes, findings = deterministic_heal(cfg, ctx, allow_act)
    ai_sev, ai_summary, needs_human, final_sev = "", "", False, det_sev

    if cfg.get("AI_API_KEY") and cfg.get("AI_AGENT_ENABLED") == "1":
        try:
            raw = call_llm(cfg, ctx)
            parsed = parse_json_response(raw)
            ai_sev = str(parsed.get("severity") or "info")
            ai_summary = str(parsed.get("summary") or parsed.get("diagnosis") or "")[:500]
            needs_human = bool(parsed.get("needs_human"))
            final_sev = ai_sev if SEV_ORDER.get(ai_sev, 0) > SEV_ORDER.get(final_sev, 0) else final_sev
            allow_act = SEV_ORDER.get(final_sev, 0) >= SEV_ORDER.get(threshold, 2)
            if not allow_act:
                findings.append(f"AI 判定严重度 {final_sev} < 门槛 {threshold}：仅诊断，不执行")
            did, nh = execute_actions(cfg, parsed.get("actions") or [], fixes, findings, allow_act)
            needs_human = needs_human or nh
            log(f"[{key}] LLM 诊断: {ai_summary}")
        except Exception as e:
            findings.append(f"LLM 调用失败（仅确定性自愈）: {e}")
            log(f"[{key}] LLM 调用失败: {e}")
    else:
        log(f"[{key}] LLM 未启用，仅确定性判断")

    try:
        state.write_text(str(time.time()))
    except Exception:
        pass

    lines = [f"问题: {subject}", f"严重度: {final_sev}（门槛 {threshold}）",
             f"诊断: {ai_summary or '（AI 未启用）'}"]
    if fixes:
        lines.append("已执行/建议修复:")
        lines += [f"  - {f}" for f in fixes]
    if findings:
        lines.append("备注/需人工:")
        lines += [f"  - {f}" for f in findings]
    lines.append("（详细日志: /var/log/supply-chain-ai-agent.log）")
    report = "\n".join(lines)
    log(f"[{key}] 完成。severity={final_sev} fixes={len(fixes)} needs_human={needs_human}")
    log(report)

    if fixes or needs_human:
        if cfg.get("AI_DRY_RUN") == "1":
            log("[dry-run] 跳过通知发送")
        elif needs_human:
            # 需人工介入：影响生产运营，必须邮件
            notify("[AI 自愈] 需人工介入", report)
        elif cfg.get("AI_EMAIL_AUTO_FIX") == "1":
            notify("[AI 自愈] 已自动处理", report)
        else:
            # 已自动处理完成，不影响生产运营：仅写日志，不发送邮件
            log("[AI 自愈] 已自动处理（仅日志，不发送邮件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
