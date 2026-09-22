#!/bin/bash
set -u
echo "===== 1) ufw 放行 IPv6 SSH（2409::/16 中国移动；2400:f880::/32 本机段）====="
ufw allow from 2409::/16 to any port 22 proto tcp comment 'trusted-admin-ipv6' 2>&1 | tail -1
ufw allow from 2409::/16 to any port 2222 proto tcp comment 'trusted-admin-ipv6' 2>&1 | tail -1

echo
echo "===== 2) fail2ban 忽略该 IPv6 段（避免误封自己）====="
if ! grep -q '2409::/16' /etc/fail2ban/jail.local; then
  sed -i 's|^ignoreip = .*|& 2409::/16|' /etc/fail2ban/jail.local
fi
fail2ban-client reload >/dev/null 2>&1
sleep 2
fail2ban-client get sshd ignoreip 2>/dev/null | tail -4

echo
echo "===== 3) sshd 监听确认 ====="
ss -tlnp 2>/dev/null | grep -E ':22 |:2222 ' | awk '{print "  "$1, $4}'
