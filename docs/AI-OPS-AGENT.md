# AI 运维自愈代理（VPS）

> 目的：VPS 一出问题（告警触发时），由 AI 代理自动诊断并修复安全范围内的问题，并把结果通知你。

## 工作方式

```
监控脚本发现问题 → alert() 发出告警邮件（原有行为不变）
                          └→ 后台触发 /opt/supply-chain/scripts/ai-agent.py
                                1) 冷却去重（同问题 30 分钟内不重复处理）
                                2) 收集上下文（docker ps / 磁盘 / 内存 / fail2ban / CF 规则 / 日志）
                                3) 确定性自愈（无需 LLM，永远生效）
                                4) 若配置了 API Key → LLM 诊断，返回结构化动作
                                5) 白名单动作执行
                                6) 有修复/需人工 → alert-mail.py 通知你
```

## 安全设计（重点）

- **AI 永远不能直接执行任意 shell 命令**：LLM 只能返回枚举动作，由本地白名单引擎翻译成具体命令。
- **可自动执行的动作（白名单）**：
  - 重启 `supply-chain-*` 应用容器（backend/frontend/indexer/pool/trade/nginx/clamav/cf-relay；**不含数据库/备份**），且需 `AI_AUTO_RESTART=1`（默认 0 = 只报告）
  - 重启 `fail2ban` 服务
  - 重建源站收紧规则（`supply-chain-cf-harden.sh`）
  - 清理悬空镜像/构建缓存
- **永不自动执行（一律 needs_human 通知你）**：改 iptables/ufw、改配置文件、重建/重装容器、删除数据或数据库、`docker prune -a`。
- **默认关闭 LLM**：不填 Key 时只做确定性自愈，不调用任何外部 API，零成本零风险。
- 有 `AI_DRY_RUN=1` 演练模式；有冷却与日志；AI 调用失败不影响原告警流程。

## 配置（启用 LLM）

```bash
# 编辑 VPS 上的 /etc/supply-chain-ai.env（默认已生成，全部关闭）
AI_API_KEY=sk-xxxx            # 填入你的 LLM Key
AI_BASE_URL=https://api.deepseek.com   # 任意 OpenAI 兼容地址
AI_MODEL=deepseek-chat
AI_AGENT_ENABLED=1            # 1=启用 LLM 诊断
AI_AUTO_RESTART=0             # 建议先保持 0（AI 只诊断+建议，重启需人工）；确认稳定后再开 1
AI_DRY_RUN=0
AI_COOLDOWN=1800
AI_TIMEOUT=45
```

改完重启验证：`printf '测试' | python3 /opt/supply-chain/scripts/ai-agent.py test "测试"`，看
`/var/log/supply-chain-ai-agent.log`。

## 已实现/验证

- `alert-lib.sh` 挂钩：所有告警（内存/磁盘/容器/证书/应用健康等）触发时后台调用代理（不阻塞、不影响原有邮件）
- 确定性自愈：fail2ban 失活→重启；CF 收紧规则缺失→重建（已实测）
- LLM 诊断路径：OpenAI 兼容接口，严格 JSON 解析 + 动作白名单（已修复误判 bug：`Total failed` 子串误触发）
- 配置模板：`deploy/vps/ai.env.example`
