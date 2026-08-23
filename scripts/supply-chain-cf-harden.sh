#!/usr/bin/env bash
# 源站收紧：DOCKER-USER 链只允许 Cloudflare 网段访问 80/443，
# 其余 Docker 发布端口（如 escrow 前端 8080）一律禁止外部访问。
# 注意：ufw 对 Docker 发布端口无效（Docker 的 FORWARD/DNAT 规则先于 ufw INPUT），
# 必须用 DOCKER-USER 链才能真正封禁。新增需公网访问的容器端口时，
# 需在此显式添加 ACCEPT（或用其它白名单机制），否则会被兜底 DROP 拦截。
set -euo pipefail

iptables -F DOCKER-USER
ip6tables -F DOCKER-USER

# ---- IPv4：仅放行 Cloudflare 网段访问 80/443 ----
for ip in $(cat /root/cf-ips-v4.txt); do
  iptables -A DOCKER-USER -i ens18 -p tcp --dport 80  -s "$ip" -j ACCEPT
  iptables -A DOCKER-USER -i ens18 -p tcp --dport 443 -s "$ip" -j ACCEPT
done
iptables -A DOCKER-USER -i ens18 -p tcp --dport 80  -j DROP
iptables -A DOCKER-USER -i ens18 -p tcp --dport 443 -j DROP
# 显式封禁 escrow 前端直连（8080，明文 HTTP）；仅保留 nginx sslip.io 443 反代入口
iptables -A DOCKER-USER -i ens18 -p tcp --dport 8080 -j DROP
# 兜底：外部来源访问任何其它 Docker 发布端口一律 DROP（最小权限）
iptables -A DOCKER-USER -i ens18 -j DROP

# ---- IPv6 同上 ----
for ip in $(cat /root/cf-ips-v6.txt); do
  ip6tables -A DOCKER-USER -i ens18 -p tcp --dport 80  -s "$ip" -j ACCEPT
  ip6tables -A DOCKER-USER -i ens18 -p tcp --dport 443 -s "$ip" -j ACCEPT
done
ip6tables -A DOCKER-USER -i ens18 -p tcp --dport 80  -j DROP
ip6tables -A DOCKER-USER -i ens18 -p tcp --dport 443 -j DROP
ip6tables -A DOCKER-USER -i ens18 -p tcp --dport 8080 -j DROP
ip6tables -A DOCKER-USER -i ens18 -j DROP
