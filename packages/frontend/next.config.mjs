// CSP：connect-src 由构建期环境变量拼装；后端地址 / RPC 需在构建时传入。
const CSP_SELF = "'self'";
const CSP_API_HOSTS = [
  process.env.NEXT_PUBLIC_BACKEND_URL,
  process.env.NEXT_PUBLIC_TRADE_API_URL,
  process.env.NEXT_PUBLIC_POOL_API_URL,
  process.env.NEXT_PUBLIC_INDEXER_API_URL,
].filter(Boolean);
const CSP_RPC = process.env.NEXT_PUBLIC_RPC_URL;
const CSP_CONNECT = [CSP_SELF, ...CSP_API_HOSTS, CSP_RPC].filter(Boolean).join(" ");
const CSP_REPORT_URI =
  process.env.NEXT_PUBLIC_CSP_REPORT_URI ||
  (process.env.NEXT_PUBLIC_BACKEND_URL
    ? `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/csp-report`
    : "");
const CONTENT_SECURITY_POLICY = [
  `default-src ${CSP_SELF}`,
  // Next App Router hydration 需要内联脚本；升级到 nonce 前保留 unsafe-inline。
  `script-src ${CSP_SELF} 'unsafe-inline'`,
  `style-src ${CSP_SELF} 'unsafe-inline'`,
  `img-src ${CSP_SELF} data: blob:`,
  `font-src ${CSP_SELF} data:`,
  `connect-src ${CSP_CONNECT}`,
  `frame-src ${CSP_SELF} https: data:`,
  `object-src 'none'`,
  `base-uri ${CSP_SELF}`,
  `frame-ancestors 'none'`,
  `form-action ${CSP_SELF}`,
  CSP_REPORT_URI ? `report-uri ${CSP_REPORT_URI}` : "",
]
  .filter(Boolean)
  .join("; ");

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
        ],
      },
    ];
  },
  transpilePackages: [
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-wallets",
  ],
};

export default nextConfig;
