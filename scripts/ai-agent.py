#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""AI 运维自愈代理（VPS 版）

触发方式：由 alert-lib.sh 的 alert() 在发出告警时后台调用：
    printf '%s' "$body" | python3 ai-agent.py "$key" "$subject"

流程：
  1) 冷却去重（与告警同状态目录 /var/lib/supply-chain-alerts/ai-<key>）
  2) 收集上下文（docker ps / 磁盘 / 内存 / 关键日志 / 服务状态）
  3) 确定性安全自愈（无需 LLM）：fail2ban 失活重启、CF 收紧规则缺失重建
  4) 若配置了 AI_API_KEY 且 AI_AGENT_ENABLED=1：调用 LLM 做诊断，返回结构化动作
  5) 动作白名单执行（仅安全枚举；改 iptables/ufw/配置文件/重建容器/删数据一律 needs_human）
  6) 有修复或需人工时，用 alert-mail.py 通知；全程写 /var/log/supply-chain-ai-agent.log

配置：/etc/supply-chain-ai.env
  AI_API_KEY=        # LLM API Key（留空则只做确定性自愈）
  AI_BASE_URL=       # OpenAI 兼容地址，默认 https://api.deepseek.com
  AI_MODEL=          # 默认 deepseek-chat
  AI_AGENT_ENABLED=  # 1 才调用 LLM；默认关闭
  AI_AUTO_RESTART=   # 1 允许 AI 重启 supply-chain 应用容器；默认 0 只报告
  AI_DRY_RUN=        # 1 只记录不执行
  AI_COOLDOWN=       # 同 key 最小间隔秒，默认 1800
  AI_TIMEOUT=        # LLM 调用超时秒，默认 45
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

ENV_PATH = Path("/etc/supply-chain-ai.env")
STATE_DIR = Path("/var/lib/supply-chain-alerts")
LOG_PATH = Path("/var/log/supply-chain-ai-agent.log")
ALERT_MAIL = "/opt/supply-chain/scripts/alert-mail.py"

# 允许 AI 重启的容器（排除数据库/备份/中继等关键或数据容器）
SAFE_RESTART_CONTAINERS = {
    "supply-chain-backend", "supply-chain-frontend", "supply-chain-indexer",
    "supply-chain-pool", "supply-chain-trade", "supply-chain-nginx",
    "supply-chain-clamav", "supply-chain-cf-relay",
}
SAFE_SERVICES = {"fail2ban"}
# 永远不允许自动执行的动作类型 -> 一律 needs_human
NEVER_AUTO = {"iptables", "ufw", "config_edit", "container_recreate", "data_delete", "docker_prune_all"}


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
    # 环境变量可覆盖（便于临时演练）
    for k in ("AI_API_KEY", "AI_BASE_URL", "AI_MODEL", "AI_AGENT_ENABLED",
              "AI_AUTO_RESTART", "AI_DRY_RUN", "AI_COOLDOWN", "AI_TIMEOUT"):
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
        "issue_key": key,
        "subject": subject,
        "body": body[:4000],
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
    ctx["fail2ban_log"] = sh("tail -n 6 /var/log/fail2ban.log 2>/dev/null | grep -E 'Ban|Unban' | tail -6")
    return ctx


def deterministic_heal(cfg, ctx):
    """无需 LLM 的安全自愈；返回 (fixes, findings)。"""
    fixes, findings = [], []
    if ctx.get("fail2ban_state", "") != "active":
        if cfg.get("AI_DRY_RUN") == "1":
            fixes.append("fail2ban 失活 -> 将执行 systemctl restart fail2ban（dry-run）")
        else:
            sh("systemctl restart fail2ban")
            fixes.append("fail2ban 失活 -> 已执行 systemctl restart fail2ban")
    if "MISSING" in ctx.get("cf_harden", ""):
        if cfg.get("AI_DRY_RUN") == "1":
            fixes.append("DOCKER-USER 收紧规则缺失 -> 将重建（dry-run）")
        else:
            sh("/usr/local/bin/supply-chain-cf-harden.sh")
            fixes.append("DOCKER-USER 收紧规则缺失 -> 已重建")
    # 磁盘/内存只报告
    try:
        disk_pct = int(ctx["disk"].split()[-2].rstrip("%")) if len(ctx["disk"].split()) >= 5 else 0
        if disk_pct >= 90:
            findings.append(f"磁盘使用率 {disk_pct}% 偏高，需人工评估清理（不自动删数据/镜像）")
    except Exception:
        pass
    return fixes, findings


SYSTEM_PROMPT = """你是部署在香港 VPS（Ubuntu 22.04 + Docker）上的供应链金融平台的资深运维 AI。
任务：根据告警与上下文做诊断，并给出**最小、安全**的处置建议。
规则（必须遵守）：
1. 只返回一个 JSON 对象，不要任何额外文字。
2. JSON 结构：{"diagnosis":"中文诊断","severity":"info|warning|critical","summary":"给用户的一句话摘要","actions":[{"type":"...","target":"...","reason":"..."}],"needs_human":bool}
3. actions 的 type 只能是这些枚举：
   - docker_restart：重启 supply-chain 应用容器（target 必须是 supply-chain-backend/frontend/indexer/pool/trade/nginx/clamav/cf-relay 之一）
   - restart_service：重启系统服务（target=fail2ban）
   - reapply_cf_harden：重建源站收紧规则
   - docker_prune_dangling：清理悬空镜像/构建缓存
   - report_only：仅报告
4. 严禁建议改 iptables/ufw/防火墙、改配置文件、重建或重装容器、删除数据/数据库——这类一律 needs_human=true 并说明原因。
5. 不确定时 needs_human=true。"""


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
    timeout = int(cfg.get("AI_TIMEOUT", "45"))
    with urllib.request.urlopen(req, timeout=timeout) as r:
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


def execute_actions(cfg, actions, fixes, findings):
    """执行白名单动作；返回是否做了事 / 是否需人工。"""
    did_something, needs_human = False, False
    dry = cfg.get("AI_DRY_RUN") == "1"
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
                findings.append(f"[需人工] 容器 {tgt} 不在允许重启名单，拒绝自动执行")
                continue
            if dry:
                fixes.append(f"[dry-run] 将重启容器 {tgt}")
            else:
                r = sh(f"docker restart {tgt}")
                fixes.append(f"已重启容器 {tgt}：{r[:120]}")
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
                fixes.append("[dry-run] 将重建 DOCKER-USER 收紧规则")
            else:
                sh("/usr/local/bin/supply-chain-cf-harden.sh")
                fixes.append("已重建 DOCKER-USER 收紧规则")
            did_something = True
        elif typ == "docker_prune_dangling":
            if dry:
                fixes.append("[dry-run] 将清理悬空镜像与构建缓存")
            else:
                sh("docker image prune -f >/dev/null 2>&1; docker builder prune -f >/dev/null 2>&1")
                fixes.append("已清理悬空镜像与构建缓存")
            did_something = True
        else:  # report_only
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

    # 冷却去重
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
    fixes, findings = deterministic_heal(cfg, ctx)
    ai_summary, needs_human, ai_enabled = "", False, False

    if cfg.get("AI_API_KEY") and cfg.get("AI_AGENT_ENABLED") == "1":
        ai_enabled = True
        try:
            raw = call_llm(cfg, ctx)
            parsed = parse_json_response(raw)
            ai_summary = str(parsed.get("summary") or parsed.get("diagnosis") or "")[:500]
            needs_human = bool(parsed.get("needs_human")) or needs_human
            did, nh = execute_actions(cfg, parsed.get("actions") or [], fixes, findings)
            needs_human = needs_human or nh
            log(f"[{key}] LLM 诊断: {ai_summary}")
        except Exception as e:
            findings.append(f"LLM 调用失败（已跳过 AI 诊断）: {e}")
            log(f"[{key}] LLM 调用失败: {e}")
    else:
        log(f"[{key}] LLM 未启用（无 AI_API_KEY 或 AI_AGENT_ENABLED!=1），仅确定性自愈")

    # 写状态（冷却）
    try:
        state.write_text(str(time.time()))
    except Exception:
        pass

    # 汇总
    lines = [f"问题: {subject}", f"诊断: {ai_summary or '（AI 未启用，仅确定性自愈）'}"]
    if fixes:
        lines.append("已执行/建议修复:")
        lines += [f"  - {f}" for f in fixes]
    if findings:
        lines.append("备注/需人工:")
        lines += [f"  - {f}" for f in findings]
    lines.append(f"（详细日志: /var/log/supply-chain-ai-agent.log）")
    report = "\n".join(lines)
    log(f"[{key}] 完成。fixes={len(fixes)} needs_human={needs_human}")
    log(report)

    if fixes or needs_human:
        if cfg.get("AI_DRY_RUN") == "1":
            log("[dry-run] 跳过通知发送")
        elif needs_human:
            notify("[AI 自愈] 需人工介入", report)
        else:
            notify("[AI 自愈] 已自动处理", report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
