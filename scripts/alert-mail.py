#!/usr/bin/env python3
"""告警邮件发送器：优先 Resend API，其次 SMTP，最后 dry-run。
用法: alert-mail.py "主题" "正文"
配置: /etc/supply-chain-alert.env
  RESEND_API_KEY / RESEND_FROM / ALERT_RECIPIENT   (Resend 优先)
  SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS    (SMTP 回退)
"""
import datetime
import json
import os
import smtplib
import ssl
import sys
import urllib.request
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path

ENV_PATH = Path("/etc/supply-chain-alert.env")
LOG_PATH = Path("/var/log/supply-chain-alert.log")
RESEND_API = "https://api.resend.com/emails"


def load_env():
    cfg = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            cfg[k.strip()] = v.strip()
    return cfg


def log(msg):
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.datetime.now():%F %T} {msg}\n")


def send_resend(api_key, sender, recipient, subject, body):
    # 用 curl 发送：Resend API 前置的 Cloudflare 会拦 Python-urllib 的 UA（403/1010）
    import subprocess
    payload = json.dumps({
        "from": sender,
        "to": [recipient],
        "subject": subject,
        "text": body,
    })
    proc = subprocess.run(
        [
            "curl", "-sS", "-m", "20", "-X", "POST", RESEND_API,
            "-H", f"Authorization: Bearer {api_key}",
            "-H", "Content-Type: application/json",
            "-d", payload,
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"curl exit {proc.returncode}")
    try:
        resp = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        raise RuntimeError(proc.stdout[:200])
    return "id" in resp


def send_smtp(cfg, recipient, subject, body):
    host = cfg.get("SMTP_HOST", "")
    user = cfg.get("SMTP_USER", "")
    pwd = cfg.get("SMTP_PASS", "")
    port = int(cfg.get("SMTP_PORT", "465"))
    sender = cfg.get("SMTP_FROM") or user
    if not (host and user and pwd):
        return None
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = formataddr((str(Header("供应链系统告警", "utf-8")), sender))
    msg["To"] = recipient
    if port == 587:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(user, pwd)
            s.sendmail(sender, [recipient], msg.as_string())
    else:
        with smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context()) as s:
            s.login(user, pwd)
            s.sendmail(sender, [recipient], msg.as_string())
    return True


def main():
    subject = sys.argv[1] if len(sys.argv) > 1 else "[告警] 无主题"
    body = sys.argv[2] if len(sys.argv) > 2 else ""
    cfg = load_env()
    recipient = cfg.get("ALERT_RECIPIENT", "")
    if not recipient:
        log("[error] ALERT_RECIPIENT 未配置")
        return 1

    # 1) Resend 优先
    api_key = cfg.get("RESEND_API_KEY", "")
    sender = cfg.get("RESEND_FROM", "")
    if api_key and sender:
        try:
            if send_resend(api_key, sender, recipient, subject, body):
                log(f"[sent/resend] to={recipient} subject={subject}")
                return 0
            log("[error] Resend 返回非成功状态")
        except Exception as e:  # noqa: BLE001
            log(f"[error] Resend 发送异常: {e}")
        return 1

    # 2) SMTP 回退
    try:
        ok = send_smtp(cfg, recipient, subject, body)
        if ok:
            log(f"[sent/smtp] to={recipient} subject={subject}")
            return 0
    except Exception as e:  # noqa: BLE001
        log(f"[error] SMTP 发送失败: {e}")

    # 3) dry-run
    log(f"[dry-run] 未配置发件渠道，跳过。收件人={recipient} 主题={subject}")
    log(f"[dry-run] 正文: {body[:300]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
