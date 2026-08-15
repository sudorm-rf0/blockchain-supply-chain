#!/usr/bin/env python3
"""SMTP 邮件告警发送器。
用法: alert-mail.py "主题" "正文"
配置: /etc/supply-chain-alert.env (SMTP_HOST/PORT/USER/PASS/FROM/ALERT_RECIPIENT)
未配置 SMTP 时仅写本地日志（dry-run），不报错。
"""
import os
import smtplib
import ssl
import sys
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path

ENV_PATH = Path("/etc/supply-chain-alert.env")
LOG_PATH = Path("/var/log/supply-chain-alert.log")


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
        f.write(f"{__import__('datetime').datetime.now():%F %T} {msg}\n")


def main():
    subject = sys.argv[1] if len(sys.argv) > 1 else "[告警] 无主题"
    body = sys.argv[2] if len(sys.argv) > 2 else ""
    cfg = load_env()
    host = cfg.get("SMTP_HOST", "")
    user = cfg.get("SMTP_USER", "")
    pwd = cfg.get("SMTP_PASS", "")
    port = int(cfg.get("SMTP_PORT", "465"))
    sender = cfg.get("SMTP_FROM") or user
    recipient = cfg.get("ALERT_RECIPIENT", "")
    if not (host and user and pwd and recipient):
        log(f"[dry-run] SMTP 未配置，跳过发送。收件人={recipient} 主题={subject}")
        log(f"[dry-run] 正文: {body[:300]}")
        return 0
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = formataddr((str(Header("供应链系统告警", "utf-8")), sender))
    msg["To"] = recipient
    try:
        if port == 587:
            with smtplib.SMTP(host, port, timeout=20) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(user, pwd)
                s.sendmail(sender, [recipient], msg.as_string())
        else:
            with smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context()) as s:
                s.login(user, pwd)
                s.sendmail(sender, [recipient], msg.as_string())
        log(f"[sent] to={recipient} subject={subject}")
        return 0
    except Exception as e:  # noqa: BLE001
        log(f"[error] 发送失败: {e} subject={subject}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
