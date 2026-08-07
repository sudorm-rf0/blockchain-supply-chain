import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "../page";

const { overviewMock, indexerMock, toastError } = vi.hoisted(() => ({
  overviewMock: vi.fn(),
  indexerMock: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));

vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="dynamic-chart" />,
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: () => ({ connection: null }),
  useWallet: () => ({
    connected: false,
    connecting: false,
    publicKey: null,
    disconnect: vi.fn(),
  }),
}));

vi.mock("@solana/wallet-adapter-react-ui", () => ({
  useWalletModal: () => ({ setVisible: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  fetchPoolOverview: (...args: unknown[]) => overviewMock(...args),
  fetchIndexerStatus: (...args: unknown[]) => indexerMock(...args),
  buildRedeemLp: vi.fn(),
  confirmRedeemLp: vi.fn(),
  formatUsdc: (raw: string) =>
    (Number(raw) / 1_000_000).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError },
}));

function makeOverview() {
  return {
    poolAddress: "pool-pda",
    nav: "99000000",
    totalAssets: "100000000",
    activeCapital: "50000000",
    reserveFund: "1000000",
    insuranceFund: "1000000",
    pendingDividends: "500000",
    utilizationBps: 5000,
    aprPct: 5.25,
    downPaymentSharePct: 30,
    poolPortionSharePct: 70,
    totalDeals: 5,
    activeDeals: 2,
    settledDeals: 2,
    defaultedDeals: 1,
    outstandingAmount: "30000000",
    paused: false,
    escrowFunded: "0",
    redemptionPrice: "1000000",
    feeApyBps: "350",
    overdueFeeApyBps: "500",
    firstLossReserve: "200000000",
    lpShareBps: "4000",
    platformShareBps: "5000",
    rebateShareBps: "1000",
    pendingAdmin: null,
    trend: [],
  };
}

function makeIndexer() {
  return {
    lastPoolSnapshotAt: "2026-08-06T10:00:00.000Z",
    queue: { failed: 0, active: 1, waiting: 0, delayed: 0 },
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overviewMock.mockResolvedValue(makeOverview());
    indexerMock.mockResolvedValue(makeIndexer());
  });

  it("renders pool overview stats after loading", async () => {
    render(<DashboardPage />);
    expect(await screen.findByText("Pool Size")).toBeTruthy();
    expect(screen.getByText("$100.00")).toBeTruthy(); // 100_000_000 / 1e6
    expect(screen.getByText("Current NAV")).toBeTruthy();
    expect(screen.getByText("$99.00")).toBeTruthy(); // 99_000_000 / 1e6
  });

  it("shows indexer sync status", async () => {
    render(<DashboardPage />);
    await waitFor(() => {
      expect(indexerMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/synced · last snapshot/)).toBeTruthy();
  });

  it("marks indexer as unreachable when status fetch fails", async () => {
    indexerMock.mockRejectedValue(new Error("down"));
    render(<DashboardPage />);
    expect(await screen.findByText("unreachable")).toBeTruthy();
  });

  it("shows an emergency-pause banner when the pool is paused on chain", async () => {
    overviewMock.mockResolvedValue({ ...makeOverview(), paused: true });
    render(<DashboardPage />);
    expect(await screen.findByText(/资金池已紧急暂停/)).toBeTruthy();
  });

  it("does not show the pause banner when the pool is not paused", async () => {
    render(<DashboardPage />);
    await screen.findByText("Pool Size");
    expect(screen.queryByText(/资金池已紧急暂停/)).toBeNull();
  });

  it("renders on-chain governance parameters", async () => {
    render(<DashboardPage />);
    expect(await screen.findByText("链上治理参数")).toBeTruthy();
    expect(screen.getByText(/3.50%/)).toBeTruthy(); // feeApyBps 350 / 100
    expect(screen.getByText("$200.00")).toBeTruthy(); // firstLossReserve 200_000_000 / 1e6
    expect(screen.getByText(/40% \/ 50% \/ 10%/)).toBeTruthy(); // LP/平台/返利
    expect(screen.getByText("无待转移")).toBeTruthy();
  });

  it("shows the pending admin address when a transfer is in flight", async () => {
    overviewMock.mockResolvedValue({
      ...makeOverview(),
      pendingAdmin: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    });
    render(<DashboardPage />);
    expect(await screen.findByText("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin")).toBeTruthy();
  });
});
