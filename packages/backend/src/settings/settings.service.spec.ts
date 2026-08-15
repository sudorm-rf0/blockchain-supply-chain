import { SettingsService, DEFAULT_SETTINGS } from "./settings.service";

function makeRedis() {
  return {
    get: jest.fn(async () => null),
    setWithExpiry: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
  };
}

function makeAudit() {
  return { record: jest.fn(async () => undefined) };
}

describe("SettingsService", () => {
  it("returns defaults when nothing is stored", async () => {
    const redis = makeRedis();
    const service = new SettingsService(redis as never, makeAudit() as never);
    await expect(service.get()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("merges a partial update over defaults", async () => {
    const redis = makeRedis();
    const service = new SettingsService(redis as never, makeAudit() as never);
    const next = await service.update(
      { security: { maxLoginFailures: 10, lockoutMinutes: 30 } },
      { id: "u1", email: "root@x.io" },
    );
    expect(next.security.maxLoginFailures).toBe(10);
    expect(next.security.lockoutMinutes).toBe(30);
    expect(next.security.sessionMaxAgeHours).toBe(
      DEFAULT_SETTINGS.security.sessionMaxAgeHours,
    );
    expect(next.registration.allowRegister).toBe(true);
    expect(redis.setWithExpiry).toHaveBeenCalled();
  });

  it("clamps invalid numeric values", async () => {
    const redis = makeRedis();
    const service = new SettingsService(redis as never, makeAudit() as never);
    const next = await service.update(
      {
        security: { maxLoginFailures: 999, lockoutMinutes: 0 },
        upload: { maxSizeMB: -5 },
      },
      { id: "u1" },
    );
    expect(next.security.maxLoginFailures).toBe(50);
    expect(next.security.lockoutMinutes).toBe(1);
    expect(next.upload.maxSizeMB).toBe(1);
  });

  it("records an audit entry on update", async () => {
    const audit = makeAudit();
    const service = new SettingsService(
      makeRedis() as never,
      audit as never,
    );
    await service.update({ platform: { name: "X" } }, { id: "u1" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SETTINGS_UPDATED" }),
    );
  });

  it("resets to defaults", async () => {
    const redis = makeRedis();
    const service = new SettingsService(redis as never, makeAudit() as never);
    const next = await service.reset({ id: "u1" });
    expect(next).toEqual(DEFAULT_SETTINGS);
    expect(redis.del).toHaveBeenCalled();
  });
});
