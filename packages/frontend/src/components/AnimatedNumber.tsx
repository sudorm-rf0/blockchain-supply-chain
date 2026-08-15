"use client";

import { useEffect, useState } from "react";

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  duration?: number;
}

/** 数字滚动动画：进入视图时从 0 缓动到目标值（尊重 prefers-reduced-motion） */
export function AnimatedNumber({
  value,
  decimals = 2,
  prefix = "",
  duration = 700,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof requestAnimationFrame !== "function") {
      // 系统减弱动态 / 无 rAF（如部分测试环境）→ 直接显示终值
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setDisplay(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <>
      {prefix}
      {display.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </>
  );
}
