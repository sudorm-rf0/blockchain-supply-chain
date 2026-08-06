"use client";

import { useTheme } from "next-themes";

// 图表主题配色（审计 F-03）：AssetTrendChart / LiquidityUtilizationChart 共用，
// 避免重复的 dark/light 颜色映射。
export function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return {
    dark,
    gridColor: dark ? "#27272a" : "#e4e4e7",
    axisColor: dark ? "#71717a" : "#a1a1aa",
    tooltipBg: dark ? "#18181b" : "#ffffff",
    tooltipBorder: dark ? "#3f3f46" : "#d4d4d8",
    tooltipColor: dark ? "#f4f4f5" : "#18181b",
  };
}
