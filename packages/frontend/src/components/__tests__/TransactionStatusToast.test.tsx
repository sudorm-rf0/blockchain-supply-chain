import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionStatusToast } from "../TransactionStatusToast";

vi.mock("@/lib/solana", () => ({
  confirmTransactionWithTimeout: vi.fn(),
}));

import { confirmTransactionWithTimeout } from "@/lib/solana";

const mockedConfirm = vi.mocked(confirmTransactionWithTimeout);

describe("TransactionStatusToast", () => {
  beforeEach(() => {
    mockedConfirm.mockReset();
  });

  it("renders nothing without a signature", () => {
    const { container } = render(
      <TransactionStatusToast signature={null} connection={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows pending then confirmed", async () => {
    mockedConfirm.mockResolvedValue(undefined);
    render(
      <TransactionStatusToast
        signature="sig-123"
        connection={{} as never}
      />,
    );
    expect(screen.getByText("交易 处理中")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("交易 已确认")).toBeInTheDocument(),
    );
  });

  it("shows failed when confirmation rejects", async () => {
    mockedConfirm.mockRejectedValue(new Error("timed out"));
    render(
      <TransactionStatusToast
        signature="sig-123"
        connection={{} as never}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("交易 失败")).toBeInTheDocument(),
    );
  });
});
