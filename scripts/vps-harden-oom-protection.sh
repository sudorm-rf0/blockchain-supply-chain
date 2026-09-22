#!/bin/bash
set -u
echo "===== 1) journald 持久化 ====="
mkdir -p /var/log/journal
sed -i 's/^#\?Storage=.*/Storage=persistent/' /etc/systemd/journald.conf
grep -q '^Storage=' /etc/systemd/journald.conf || echo 'Storage=persistent' >> /etc/systemd/journald.conf
systemctl restart systemd-journald
echo "Storage: $(grep '^Storage=' /etc/systemd/journald.conf)"

echo
echo "===== 2) earlyoom ====="
DEBIAN_FRONTEND=noninteractive apt-get install -y earlyoom >/tmp/earlyoom-install.log 2>&1 && echo "✅ 安装成功" || { echo "❌ 失败"; tail -3 /tmp/earlyoom-install.log; }
cat > /etc/default/earlyoom <<'EOF'
# 2026-09-22：内存/交换低于阈值时主动终止最大内存进程，防止整机冻结
EARLYOOM_ARGS="-r 60 -m 10 -s 10 --avoid '(^|/)(sshd|systemd|dockerd|containerd)$' --prefer '(^|/)(node|gitea|java|clamd|next-server)$'"
EOF
systemctl enable earlyoom >/dev/null 2>&1
systemctl restart earlyoom
sleep 2
echo "状态: $(systemctl is-active earlyoom)"
echo "策略: $(grep -o 'EARLYOOM_ARGS=.*' /etc/default/earlyoom | cut -c1-100)"

echo
echo "===== 3) sshd OOM 保护 ====="
mkdir -p /etc/systemd/system/ssh.service.d
cat > /etc/systemd/system/ssh.service.d/oom-protect.conf <<'EOF'
[Service]
OOMScoreAdjust=-1000
EOF
systemctl daemon-reload
systemctl restart ssh
sleep 1
echo "ssh OOMScoreAdjust: $(systemctl show ssh -p OOMScoreAdjust --value)"
echo "sshd: $(systemctl is-active ssh) | 监听端口数: $(ss -tlnp 2>/dev/null | grep -cE ':22 |:2222 ')"
