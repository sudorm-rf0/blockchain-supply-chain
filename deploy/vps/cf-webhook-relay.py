#!/usr/bin/env python3
"""Cloudflare 告警 Webhook 接收转发器
Cloudflare 通知 webhook -> 本服务 -> Resend API -> 邮件（139 邮箱等）
- 校验 cf-webhook-auth 头（与 WEBHOOK_SECRET 常量时间比较）
- 配置来源：/etc/supply-chain-alert.env（RESEND_API_KEY / RESEND_FROM / ALERT_RECIPIENT）
- 监听 0.0.0.0:8099（容器内），nginx 反代 /cf-alert-webhook
"""
import datetime
import hmac
import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LISTEN = os.environ.get("RELAY_LISTEN", "0.0.0.0")
PORT = int(os.environ.get("RELAY_PORT", "8099"))
ENV_PATH = Path(os.environ.get("ALERT_ENV", "/etc/supply-chain-alert.env"))
WEBHOOK_SECRET = os.environ.get("CF_WEBHOOK_SECRET", "").strip()
RESEND_API = "https://api.resend.com/emails"


def load_cfg():
    cfg = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            cfg[k.strip()] = v.strip()
    return cfg


def now_str():
    return datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %z")


def send_resend(cfg, subject, body):
    """用 curl 发 Resend：Python-urllib UA 会被 Resend 前置 CF 拦 403/1010"""
    payload = json.dumps({
        "from": cfg.get("RESEND_FROM", "DFR 供应链金融平台 <noreply@supplychain.de5.net>"),
        "to": [cfg.get("ALERT_RECIPIENT", "")],
        "subject": subject,
        "text": body,
    })
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write(payload)
        tmp = f.name
    try:
        res = subprocess.run(
            ["curl", "-sS", "-m", "30", "-X", "POST", RESEND_API,
             "-H", f"Authorization: Bearer {cfg.get('RESEND_API_KEY', '')}",
             "-H", "Content-Type: application/json", "--data", f"@{tmp}"],
            capture_output=True, text=True)
        return res.returncode, res.stdout[:500]
    finally:
        os.unlink(tmp)


def build_email(payload):
    name = payload.get("name", "未知告警")
    text = payload.get("text", "")
    data = payload.get("data", {})
    ts = payload.get("ts")
    if ts:
        try:
            ts = datetime.datetime.fromtimestamp(int(ts)).astimezone().strftime("%Y-%m-%d %H:%M:%S %z")
        except Exception:
            ts = str(ts)
    lines = []
    lines.append(f"告警策略：{name}")
    if ts:
        lines.append(f"触发时间：{ts}")
    lines.append("")
    if text:
        lines.append(text)
        lines.append("")
    if data:
        lines.append("---- 详细信息 ----")
        lines.append(json.dumps(data, ensure_ascii=False, indent=2))
    return f"[Cloudflare 告警] {name}", "\n".join(lines)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # 走 stdout 供 docker logs
        sys.stdout.write("%s %s\n" % (now_str(), fmt % args))
        sys.stdout.flush()

    def _reply(self, code, body=b"ok\n"):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._reply(200, b"ok\n")
            return
        self._reply(404)

    def do_POST(self):
        cfg = load_cfg()
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            # 校验签名
            auth = self.headers.get("cf-webhook-auth", "")
            secret = WEBHOOK_SECRET or cfg.get("CF_WEBHOOK_SECRET", "")
            if not secret or not hmac.compare_digest(auth.strip(), secret.strip()):
                print(f"{now_str()} 签名校验失败 auth={auth[:8]!r} len={len(auth)}", flush=True)
                self._reply(401, b"unauthorized\n")
                return
            payload = json.loads(raw.decode("utf-8", errors="replace"))
            subject, body = build_email(payload)
            rc, out = send_resend(cfg, subject, body)
            if rc == 0 and '"id"' in out:
                print(f"{now_str()} 已转发邮件: {subject} (resend={out[:120]})", flush=True)
                self._reply(200, b"ok\n")
            else:
                print(f"{now_str()} Resend 发送失败 rc={rc} out={out[:300]}", flush=True)
                self._reply(502, b"resend failed\n")
        except Exception as e:
            print(f"{now_str()} 处理异常: {e}", flush=True)
            self._reply(400, f"bad request: {e}\n".encode())


if __name__ == "__main__":
    if not WEBHOOK_SECRET:
        cfg = load_cfg()
        WEBHOOK_SECRET = cfg.get("CF_WEBHOOK_SECRET", "")
    print(f"{now_str()} cf-alert-relay 启动于 {LISTEN}:{PORT}", flush=True)
    ThreadingHTTPServer((LISTEN, PORT), Handler).serve_forever()
