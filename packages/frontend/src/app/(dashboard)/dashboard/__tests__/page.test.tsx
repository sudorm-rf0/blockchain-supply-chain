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
});
