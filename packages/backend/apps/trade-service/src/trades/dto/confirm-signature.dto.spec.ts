import { validate } from "class-validator";
import { ConfirmSignatureDto } from "./confirm-signature.dto";

/**
 * H-1 回归测试：前端订单确认接口（拨款/放款推进/还款/违约/释放）会附带
 * `confirm: true` 字段；全局 ValidationPipe 为 whitelist + forbidNonWhitelisted，
 * 若 DTO 未声明该字段会直接 400。此测试锁定 confirm 字段必须被接受且类型校验正确。
 */
function makeDto(body: Record<string, unknown>): ConfirmSignatureDto {
  const dto = new ConfirmSignatureDto();
  Object.assign(dto, body);
  return dto;
}

const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

describe("ConfirmSignatureDto (H-1 confirm 字段)", () => {
  it("接受前端携带 confirm:true 的确认请求（不 400）", async () => {
    const dto = makeDto({ txSignature: "4xYJabc", confirm: true });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it("接受不带 confirm 的请求（向后兼容）", async () => {
    const dto = makeDto({ txSignature: "4xYJabc" });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(errors).toHaveLength(0);
  });

  it("拒绝 confirm 为非布尔值", async () => {
    const dto = makeDto({ txSignature: "4xYJabc", confirm: "yes" });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(errors.some((e) => e.property === "confirm")).toBe(true);
  });

  it("拒绝缺少 txSignature", async () => {
    const dto = makeDto({ confirm: true });
    const errors = await validate(dto, PIPE_OPTIONS);
    expect(errors.some((e) => e.property === "txSignature")).toBe(true);
  });
});
