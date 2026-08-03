"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "next-themes";

export interface AssetTrendChartProps {
  trend: Array<{
    capturedAt: string;
    nav: string;
    totalAssets: string;
  }>;
}

function toChartPoints(
  trend: AssetTrendChartProps["trend"],
): Array<{ time: string; nav: number; totalAssets: number }> {
  return trend.map((point) => ({
    time: new Date(point.capturedAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    nav: Number(point.nav) / 1_000_000,
    totalAssets: Number(point.totalAssets) / 1_000_000,
  }));
}

export function AssetTrendChart({ trend }: AssetTrendChartProps) {
  const data = toChartPoints(trend);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const gridColor = dark ? "#27272a" : "#e4e4e7";
  const axisColor = dark ? "#71717a" : "#a1a1aa";
  const tooltipBg = dark ? "#18181b" : "#ffffff";
  const tooltipBorder = dark ? "#3f3f46" : "#d4d4d8";
  const tooltipColor = dark ? "#f4f4f5" : "#18181b";
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="navGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#34d399" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="time"
            stroke={axisColor}
            fontSize={12}
            tickLine={false}
          />
          <YAxis stroke={axisColor} fontSize={12} tickLine={false} width={70} />
          <Tooltip
            contentStyle={{
              backgroundColor: tooltipBg,
              border: `1px solid ${tooltipBorder}`,
              borderRadius: 8,
              color: tooltipColor,
            }}
            formatter={(value) => `$${Number(value).toLocaleString()}`}
          />
          <Area
            type="monotone"
            dataKey="totalAssets"
            name="Total Assets"
            stroke="#38bdf8"
            fill="#38bdf8"
            fillOpacity={0.15}
          />
          <Area
            type="monotone"
            dataKey="nav"
            name="NAV"
            stroke="#34d399"
            fill="url(#navGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
