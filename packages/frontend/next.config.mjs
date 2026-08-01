/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: [
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-wallets",
  ],
};

export default nextConfig;
