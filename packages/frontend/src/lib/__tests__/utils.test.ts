import { describe, expect, it } from "vitest";
import { cn } from "../utils";

describe("cn", () => {
  it("joins class names and filters falsy values", () => {
    const falsy = false;
    expect(cn("a", "b", falsy && "c", undefined, null, "d")).toBe("a b d");
  });

  it("merges conflicting tailwind classes (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
