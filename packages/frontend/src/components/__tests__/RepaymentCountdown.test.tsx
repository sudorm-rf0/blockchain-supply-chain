import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepaymentCountdown } from "../RepaymentCountdown";

describe("RepaymentCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders remaining time and deadline for REPAYING deals", () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    render(
      <RepaymentCountdown
        createdAt={createdAt}
        tenorSeconds={3600}
        status="REPAYING"
      />,
    );
    expect(screen.getByText(/剩余/)).toBeInTheDocument();
    expect(screen.getByText(/截止/)).toBeInTheDocument();
  });

  it("renders nothing for non-REPAYING statuses", () => {
    const { container } = render(
      <RepaymentCountdown
        createdAt={new Date().toISOString()}
        tenorSeconds={3600}
        status="FUNDED"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("marks an expired deal as due", () => {
    const createdAt = new Date(Date.now() - 7_200_000).toISOString();
    render(
      <RepaymentCountdown
        createdAt={createdAt}
        tenorSeconds={3600}
        status="REPAYING"
      />,
    );
    expect(screen.getByText("还款已到期")).toBeInTheDocument();
  });
});
