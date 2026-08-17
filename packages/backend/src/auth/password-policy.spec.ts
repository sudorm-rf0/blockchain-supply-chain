import { passwordPolicyError } from "./auth.service";

describe("passwordPolicyError（注册/改密密码强度）", () => {
  it("通过：≥8 位含大小写数字特殊符号", () => {
    expect(passwordPolicyError("Abc123!@")).toBeNull();
    expect(passwordPolicyError("Str0ng#Pass9")).toBeNull();
  });
  it("拒绝：少于 8 位", () => {
    expect(passwordPolicyError("Ab1!a")).toMatch(/8 位/);
  });
  it("拒绝：缺大写", () => {
    expect(passwordPolicyError("abc123!@")).toMatch(/大写/);
  });
  it("拒绝：缺小写", () => {
    expect(passwordPolicyError("ABC123!@")).toMatch(/小写/);
  });
  it("拒绝：缺数字", () => {
    expect(passwordPolicyError("Abcdef!@")).toMatch(/数字/);
  });
  it("拒绝：缺特殊符号", () => {
    expect(passwordPolicyError("Abcdef12")).toMatch(/特殊符号/);
  });
  it("拒绝：空", () => {
    expect(passwordPolicyError("")).toMatch(/8 位/);
    expect(passwordPolicyError(undefined as unknown as string)).toMatch(/8 位/);
  });
});
