import { NotFoundException } from "@nestjs/common";
import { RedisService } from "@supply-chain/common";
import { AiLlmService } from "./ai-llm.service";
import { AuditService } from "../audit/audit.service";
import { AssistantService } from "./assistant.service";

function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    setEx: jest.fn(async (key: string, _seconds: number, value: string) => {
      store.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    expire: jest.fn(async () => undefined),
  };
}

function makeService() {
  const llm = {
    complete: jest.fn(async () => "步骤：进入创建订单页，连接钱包后填写金额…"),
    modelName: "deepseek-v4-flash",
  };
  const audit = { record: jest.fn(async () => undefined) };
  const redis = makeRedis();
  const service = new AssistantService(
    llm as unknown as AiLlmService,
    audit as unknown as AuditService,
    redis as unknown as RedisService,
  );
  return { service, llm, audit, redis };
}

describe("AssistantService", () => {
  it("replies using the LLM and records an audit entry", async () => {
    const { service, llm, audit } = makeService();
    const result = await service.chat("user-1", { message: "如何创建订单？" });
    expect(result.reply).toContain("创建订单");
    expect(result.sessionId).toBeTruthy();
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

  it("persists the conversation and lists it in history", async () => {
    const { service, llm, redis } = makeService();
    llm.complete.mockResolvedValueOnce("第一轮回答");
    const first = await service.chat("user-1", { message: "你好" });
    llm.complete.mockResolvedValueOnce("第二轮回答");
    const second = await service.chat("user-1", {
      message: "继续",
      sessionId: first.sessionId,
    });

    const history = await service.listHistory("user-1");
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(first.sessionId);
    expect(history[0].messageCount).toBe(4);

    const session = await service.getHistory("user-1", first.sessionId);
    expect(session.messages.map((m) => m.content)).toEqual([
      "你好",
      "第一轮回答",
      "继续",
      "第二轮回答",
    ]);
    expect(second.sessionId).toBe(first.sessionId);
    expect(redis.store.size).toBeGreaterThan(0);
  });

  it("returns 404 for a missing session and supports delete", async () => {
    const { service } = makeService();
    await expect(service.getHistory("user-1", "nope")).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.chat("user-1", { message: "hi", sessionId: "nope" }),
    ).rejects.toThrow(NotFoundException);

    const first = await service.chat("user-1", { message: "a" });
    await service.deleteHistory("user-1", first.sessionId);
    await expect(service.listHistory("user-1")).resolves.toEqual([]);
  });
});
