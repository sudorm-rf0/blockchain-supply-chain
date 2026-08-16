#!/usr/bin/env bash
set -euo pipefail
iptables -F DOCKER-USER
ip6tables -F DOCKER-USER
for ip in $(cat /root/cf-ips-v4.txt); do
  iptables -A DOCKER-USER -i ens18 -p tcp --dport 80  -s "$ip" -j ACCEPT
  iptables -A DOCKER-USER -i ens18 -p tcp --dport 443 -s "$ip" -j ACCEPT
done
iptables -A DOCKER-USER -i ens18 -p tcp --dport 80  -j DROP
iptables -A DOCKER-USER -i ens18 -p tcp --dport 443 -j DROP
for ip in $(cat /root/cf-ips-v6.txt); do
  ip6tables -A DOCKER-USER -i ens18 -p tcp --dport 80  -s "$ip" -j ACCEPT
  ip6tables -A DOCKER-USER -i ens18 -p tcp --dport 443 -s "$ip" -j ACCEPT
done
ip6tables -A DOCKER-USER -i ens18 -p tcp --dport 80  -j DROP
ip6tables -A DOCKER-USER -i ens18 -p tcp --dport 443 -j DROP
