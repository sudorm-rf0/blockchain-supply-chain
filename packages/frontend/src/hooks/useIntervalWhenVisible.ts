"use client";

import { useEffect } from "react";

/**
 * 仅在页面可见时运行的轮询 hook（性能优化）：
 * - 页面隐藏（切后台/切标签）时暂停轮询，节省网络与 CPU；
 * - 从「隐藏 → 可见」时立即刷新一次，保证回到页面数据是最新的；
 * - 挂载时仅建立 interval，不额外触发（首载请求由页面自身负责，避免重复）。
 */
export function useIntervalWhenVisible(
  callback: () => void,
  delayMs: number | null,
): void {
  useEffect(() => {
    if (delayMs === null) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let wasVisible =
      typeof document === "undefined" || document.visibilityState === "visible";

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      const visible = document.visibilityState === "visible";
      if (visible && !wasVisible) {
        callback(); // 恢复可见：立即拉一次最新数据
      }
      wasVisible = visible;
      if (visible) {
        if (!timer) timer = setInterval(callback, delayMs);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [callback, delayMs]);
}
