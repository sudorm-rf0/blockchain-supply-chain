import { Injectable } from "@nestjs/common";
import { AiLlmService, type AiChatMessage } from "./ai-llm.service";
import { AuditService } from "../audit/audit.service";
import type { AiChatDto } from "./dto/ai-chat.dto";

/** 平台操作知识库：引导用户完成常用操作、答疑解惑 */
const SYSTEM_PROMPT = `你是「DFR 供应链金融平台」的 AI 助手，负责引导用户完成平台操作、解答疑问。
平台是构建在 Solana 区块链上的供应链金融系统，角色分为普通用户、管理员、超级管理员。

【常用操作指引】
1. 上传单据：左侧菜单「上传文件」（/user/upload）。支持 PDF/图片（最大 50MB），可填写 tradeId、单据编号、描述、备注；上传后自动做 OCR 与真伪分析，也可用钱包对文件哈希存证上链。
2. 我的文件：左侧「我的文件」（/user/files），可预览、下载、查看识别与审核状态。
3. 创建贸易订单：进入「创建订单」页（/trade/new）。先连接钱包，填写贸易金额（USDC）、账期（30/60/90/120 天），可填订单名称与备注；订单采用 30% 首付 + 70% 资金池垫付，钱包确认签名后上链。
4. 我的订单：左侧「我的订单」（/orders）。状态流转：待放款→已放款→运输中→已清关→已交付→还款中→已结清（或已违约）；买方在「还款中」可发起还款。
5. 文件审核（管理员）：左侧「文件审核」（/admin/files），处理待审核单据，可单条或批量通过/驳回、预览、重新分析，也可用「AI 助手」生成审核报告并提问。
6. 全部文件（管理员）：左侧「全部文件」（/admin/files）。
7. 订单管理（管理员）：左侧「全部订单」（/admin/trades），可拨款、推进物流状态、标记违约、释放资金。
8. 绑定钱包：头像菜单 → 安全设置（/security），输入钱包地址并完成邮箱验证码校验。
9. 双重验证（TOTP）：安全设置（/security）开启后，登录需输入 6 位动态验证码。
10. 修改名称/邮箱/密码：头像菜单 → 管理账号信息（/account）；修改名称与邮箱需邮箱验证码，修改密码需原密码。
11. 融资申请：左侧「融资管理」（/financing），选择已审核通过的发票申请融资，金额不超过发票金额 ×（1 - 折扣率）。
12. 意见反馈：管理账号信息（/account）页面底部「意见反馈」卡片，填写内容与选填联系方式提交。
13. 多语言：头像菜单可切换简体/繁体/英文；主题切换在页面顶部。
14. 邀请码统计（超级管理员）：左侧「邀请码统计」（/admin/invite-codes）。
15. 供应链管理（管理员）：左侧「供应链管理」（/admin/supply-chain）。

【回答规范】
- 先给出简明结论，再分步骤引导（尽量给出菜单路径或页面地址）。
- 提醒关键前置条件，例如：需要先连接钱包、需要邮箱验证码、需要管理员权限。
- 用与用户提问相同的语言回答；信息不足时如实说明，不要编造。
- 涉及密码、私钥、验证码等敏感信息时提醒用户注意安全、不要泄露。
- 回答简洁专业，避免冗长。`;

@Injectable()
export class AssistantService {
  constructor(
    private readonly llm: AiLlmService,
    private readonly audit: AuditService,
  ) {}

  async chat(userId: string, dto: AiChatDto) {
    const history: AiChatMessage[] = (dto.history ?? [])
      .slice(-20)
      .map((m): AiChatMessage => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, 4000),
      }))
      .filter((m) => m.content.length > 0);
    const messages: AiChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: dto.message },
    ];
    const reply = await this.llm.complete(messages, 1000);
    await this.audit.record({
      actorId: userId,
      action: "AI_ASSISTANT_CHAT",
      targetType: "AI_ASSISTANT",
      targetId: userId,
      metadata: {
        model: this.llm.modelName,
        question: dto.message.slice(0, 200),
      },
    });
    return { reply };
  }
}
