import { AiLlmService } from "./ai-llm.service";
import { AuditService } from "../audit/audit.service";
import { AssistantService } from "./assistant.service";

describe("AssistantService", () => {
  it("replies using the LLM and records an audit entry", async () => {
    const llm = {
      complete: jest.fn(async () => "步骤：进入创建订单页，连接钱包后填写金额…"),
      modelName: "deepseek-v4-flash",
    } as unknown as AiLlmService;
    const audit = { record: jest.fn(async () => undefined) };
    const service = new AssistantService(
      llm as AiLlmService,
      audit as unknown as AuditService,
    );
    const result = await service.chat("user-1", { message: "如何创建订单？" });
    expect(result.reply).toContain("创建订单");
    expect(llm.complete).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user", content: "如何创建订单？" }),
      ]),
      1000,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "AI_ASSISTANT_CHAT" }),
    );
  });
});
