interface LogoMarkProps {
  className?: string;
}

/** DFR 区块链 · 供应链系统 —— 工业风品牌标识（黑色底 + 信号绿链环） */
export function LogoMark({ className = "h-8 w-8" }: LogoMarkProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" fill="#0B0C0A" />
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.28"
        strokeWidth="1"
      />
      <g fill="none" stroke="#00E676" strokeWidth="2.5" strokeLinejoin="round">
        <polygon points="27,32 21.5,41.5 10.5,41.5 5,32 10.5,22.5 21.5,22.5" />
        <polygon points="43,32 37.5,41.5 26.5,41.5 21,32 26.5,22.5 37.5,22.5" />
        <polygon points="59,32 53.5,41.5 42.5,41.5 37,32 42.5,22.5 53.5,22.5" />
      </g>
    </svg>
  );
}
