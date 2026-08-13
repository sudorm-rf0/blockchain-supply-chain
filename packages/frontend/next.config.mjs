// CSP 由 src/middleware.ts 统一下发（nonce + strict-dynamic）。
// 审计 M8：此处不再配置 CSP，避免与 middleware 双源冲突（此前并存时浏览器取交集）。
// 其余静态安全头保留；X-Frame-Options 由 nginx 提供。

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
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
