"use client";

import { useEffect, useState } from "react";
import { Connection } from "@solana/web3.js";

type ToastStatus = "pending" | "confirmed" | "failed";

interface TransactionStatusToastProps {
  signature: string | null;
  connection: Connection | null;
  onDismiss?: () => void;
}

export function TransactionStatusToast({
  signature,
  connection,
  onDismiss,
}: TransactionStatusToastProps) {
  const [status, setStatus] = useState<ToastStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signature || !connection) {
      setStatus(null);
      return;
    }

    let cancelled = false;
    setStatus("pending");
    setError(null);

    void (async () => {
      try {
        const result = await connection.confirmTransaction(
          signature,
          "confirmed",
        );
        if (cancelled) return;
        if (result.value.err) {
          setStatus("failed");
          setError("Transaction was rejected by the cluster");
        } else {
          setStatus("confirmed");
        }
      } catch (cause) {
        if (cancelled) return;
        setStatus("failed");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signature, connection]);

  if (!signature || !status) return null;

  const palette =
    status === "confirmed"
      ? "border-emerald-500/60 bg-emerald-950/90"
      : status === "failed"
        ? "border-red-500/60 bg-red-950/90"
        : "border-amber-500/60 bg-amber-950/90";
  const label =
    status === "confirmed"
      ? "Confirmed"
      : status === "failed"
        ? "Failed"
        : "Pending";

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 w-80 rounded-lg border p-4 shadow-xl ${palette}`}
      role="status"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100">
            Transaction {label}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-zinc-400">
            {signature}
          </p>
          {status === "pending" && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded bg-amber-900/50">
              <div className="h-full w-1/2 animate-pulse rounded bg-amber-400" />
            </div>
          )}
          {status === "failed" && error && (
            <p className="mt-1 text-xs text-red-300">{error}</p>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
