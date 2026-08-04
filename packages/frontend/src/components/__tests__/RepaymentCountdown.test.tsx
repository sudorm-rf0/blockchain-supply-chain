import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
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

  it("marks a deal as urgent within three days", () => {
    const createdAt = new Date(Date.now() - 86_400_000).toISOString();
    render(
      <RepaymentCountdown
        createdAt={createdAt}
        tenorSeconds={2 * 86_400}
        status="REPAYING"
      />,
    );
    expect(screen.getByText(/即将到期/)).toBeInTheDocument();
  });

  it("uses normal styling for distant deadlines", () => {
    const createdAt = new Date().toISOString();
    const { container } = render(
      <RepaymentCountdown
        createdAt={createdAt}
        tenorSeconds={30 * 86_400}
        status="REPAYING"
      />,
    );
    expect(screen.queryByText(/即将到期/)).not.toBeInTheDocument();
    expect(container.querySelector(".bg-emerald-500")).not.toBeNull();
  });
});
