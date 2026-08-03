export const TRADE_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-yellow-200 text-yellow-800",
  FUNDED: "bg-blue-200 text-blue-800",
  IN_TRANSIT: "bg-indigo-200 text-indigo-800",
  CUSTOMS_CLEAR: "bg-cyan-200 text-cyan-800",
  DELIVERED: "bg-teal-200 text-teal-800",
  REPAYING: "bg-orange-200 text-orange-800",
  SETTLED: "bg-green-200 text-green-800",
  DEFAULTED: "bg-red-200 text-red-800",
};

export const WITHDRAW_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-yellow-200 text-yellow-800",
  READY: "bg-blue-200 text-blue-800",
  EXECUTED: "bg-green-200 text-green-800",
};

const FILE_STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-yellow-200 text-yellow-800",
  APPROVED: "bg-green-200 text-green-800",
  REJECTED: "bg-red-200 text-red-800",
};

export function fileStatusClass(status: string): string {
  return FILE_STATUS_STYLE[status] ?? "";
}

export const NEXT_TRADE_STATUS: Record<
  string,
  { code: number; label: string } | null
> = {
  FUNDED: { code: 2, label: "推进至运输中" },
  IN_TRANSIT: { code: 3, label: "推进至清关" },
  CUSTOMS_CLEAR: { code: 4, label: "推进至已交付" },
};

export const CAN_DEFAULT_TRADE = new Set([
  "FUNDED",
  "IN_TRANSIT",
  "CUSTOMS_CLEAR",
  "DELIVERED",
  "REPAYING",
]);

export const TRADE_LIFECYCLE = [
  "PENDING",
  "FUNDED",
  "IN_TRANSIT",
  "CUSTOMS_CLEAR",
  "DELIVERED",
  "REPAYING",
  "SETTLED",
];
