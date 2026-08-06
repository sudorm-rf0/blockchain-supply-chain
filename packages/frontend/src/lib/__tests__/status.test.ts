import { describe, expect, it } from "vitest";
import {
  CAN_DEFAULT_TRADE,
  fileStatusClass,
  NEXT_TRADE_STATUS,
  TRADE_LIFECYCLE,
} from "../status";

describe("fileStatusClass", () => {
  it("maps known statuses to tailwind classes", () => {
    expect(fileStatusClass("PENDING")).toContain("bg-yellow-200");
    expect(fileStatusClass("APPROVED")).toContain("bg-green-200");
    expect(fileStatusClass("REJECTED")).toContain("bg-red-200");
  });

  it("returns empty string for unknown statuses", () => {
    expect(fileStatusClass("UNKNOWN")).toBe("");
  });
});

describe("trade status helpers", () => {
  it("exposes next-status transitions for the four logistics states", () => {
    expect(NEXT_TRADE_STATUS.FUNDED?.code).toBe(2);
    expect(NEXT_TRADE_STATUS.IN_TRANSIT?.code).toBe(3);
    expect(NEXT_TRADE_STATUS.CUSTOMS_CLEAR?.code).toBe(4);
    expect(NEXT_TRADE_STATUS.DELIVERED).toBeUndefined();
  });

  it("allows defaulting all states from FUNDED through REPAYING", () => {
    for (const state of ["FUNDED", "IN_TRANSIT", "CUSTOMS_CLEAR", "DELIVERED", "REPAYING"]) {
      expect(CAN_DEFAULT_TRADE.has(state)).toBe(true);
    }
    expect(CAN_DEFAULT_TRADE.has("PENDING")).toBe(false);
    expect(CAN_DEFAULT_TRADE.has("SETTLED")).toBe(false);
  });

  it("keeps a full lifecycle from PENDING to SETTLED", () => {
    expect(TRADE_LIFECYCLE).toEqual([
      "PENDING",
      "FUNDED",
      "IN_TRANSIT",
      "CUSTOMS_CLEAR",
      "DELIVERED",
      "REPAYING",
      "SETTLED",
    ]);
  });
});
