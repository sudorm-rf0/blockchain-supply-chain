#!/usr/bin/env python3
"""告警邮件发送器：优先 Resend API，其次 SMTP，最后 dry-run。
用法: alert-mail.py "主题" "正文"
配置: /etc/supply-chain-alert.env
  RESEND_API_KEY / RESEND_FROM / ALERT_RECIPIENT   (Resend 优先)
  SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS    (SMTP 回退)
"""
import datetime
import fcntl
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
ALERT_STATE_DIR = Path("/var/lib/supply-chain-alerts")
ALERT_STATE_DIR.mkdir(parents=True, exist_ok=True)


def daily_count_path() -> Path:
    return ALERT_STATE_DIR / f"mail-count-{datetime.date.today():%Y%m%d}"


def current_daily_count() -> int:
    try:
        return int(daily_count_path().read_text(encoding="utf-8").strip() or "0")
    except (FileNotFoundError, ValueError):
        return 0


def increment_daily_count() -> int:
    """原子累加当日已发邮件数（fcntl 文件锁保证并发安全）。"""
    p = daily_count_path()
    with p.open("a+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            f.seek(0)
            cur = int(f.read().strip() or "0")
        except ValueError:
            cur = 0
        nxt = cur + 1
        f.seek(0)
        f.truncate()
        f.write(str(nxt))
        f.flush()
        fcntl.flock(f, fcntl.LOCK_UN)
    return nxt


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
    # 严重性：第 3 个参数或环境变量 ALERT_SEVERITY。仅 critical 允许发邮件；
    # 不传时保持兼容（默认允许发送，由调用方自行把关，如 alert-lib.sh 白名单）。
    severity = (sys.argv[3] if len(sys.argv) > 3 else "").strip() or os.environ.get("ALERT_SEVERITY", "").strip()
    cfg = load_env()
    recipient = cfg.get("ALERT_RECIPIENT", "")
    if not recipient:
        log("[error] ALERT_RECIPIENT 未配置")
        return 1

    # 严重性过滤：warning/info 一律不发送（仅记录日志）
    if severity and severity != "critical":
        log(f"[skip/severity] severity={severity} subject={subject}（仅 critical 发邮件）")
        return 0

    # 每日全局上限（默认 10 封；可用 ALERT_DAILY_LIMIT 覆盖）
    limit_raw = os.environ.get("ALERT_DAILY_LIMIT", "") or cfg.get("ALERT_DAILY_LIMIT", "") or "10"
    try:
        daily_limit = int(limit_raw)
    except ValueError:
        daily_limit = 10
    if current_daily_count() >= daily_limit:
        log(f"[skip/limit] 今日已达上限 {daily_limit} 封，跳过 subject={subject}")
        return 0

    # 1) Resend 优先
    api_key = cfg.get("RESEND_API_KEY", "")
    sender = cfg.get("RESEND_FROM", "")
    if api_key and sender:
        try:
            if send_resend(api_key, sender, recipient, subject, body):
                count = increment_daily_count()
                log(f"[sent/resend] to={recipient} subject={subject} daily={count}/{daily_limit}")
                return 0
            log("[error] Resend 返回非成功状态")
        except Exception as e:  # noqa: BLE001
            log(f"[error] Resend 发送异常: {e}")
        return 1

    # 2) SMTP 回退
    try:
        ok = send_smtp(cfg, recipient, subject, body)
        if ok:
            count = increment_daily_count()
            log(f"[sent/smtp] to={recipient} subject={subject} daily={count}/{daily_limit}")
            return 0
    except Exception as e:  # noqa: BLE001
        log(f"[error] SMTP 发送失败: {e}")

    # 3) dry-run（未配置发件渠道，不算真实发送，不计数）
    log(f"[dry-run] 未配置发件渠道，跳过。收件人={recipient} 主题={subject}")
    log(f"[dry-run] 正文: {body[:300]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
