"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "next-themes";
import type { PoolTrendPoint } from "@/lib/api";

interface LiquidityUtilizationChartProps {
  trend: PoolTrendPoint[];
}

function toChartPoints(trend: PoolTrendPoint[]) {
  return trend.map((point) => ({
    time: new Date(point.capturedAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    idle: Number(point.idle) / 1_000_000,
    utilization: point.utilizationBps / 100,
  }));
}

export function LiquidityUtilizationChart({
  trend,
}: LiquidityUtilizationChartProps) {
  const data = toChartPoints(trend);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const gridColor = dark ? "#27272a" : "#e4e4e7";
  const axisColor = dark ? "#71717a" : "#a1a1aa";
  const tooltipBg = dark ? "#18181b" : "#ffffff";
  const tooltipBorder = dark ? "#3f3f46" : "#d4d4d8";
  const tooltipColor = dark ? "#f4f4f5" : "#18181b";

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <defs>
            <linearGradient id="idleGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="time"
            stroke={axisColor}
            fontSize={12}
            tickLine={false}
          />
          <YAxis
            yAxisId="left"
            stroke={axisColor}
            fontSize={12}
            tickLine={false}
            width={70}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke={axisColor}
            fontSize={12}
            tickLine={false}
            width={44}
            domain={[0, 100]}
            tickFormatter={(value) => `${value}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: tooltipBg,
              border: `1px solid ${tooltipBorder}`,
              borderRadius: 8,
              color: tooltipColor,
            }}
            formatter={(value, name) =>
              name === "Utilization"
                ? [`${Number(value).toFixed(1)}%`, name]
                : [`$${Number(value).toLocaleString()}`, "Idle Liquidity"]
            }
          />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="idle"
            name="Idle Liquidity"
            stroke="#a78bfa"
            fill="url(#idleGradient)"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="utilization"
            name="Utilization"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
