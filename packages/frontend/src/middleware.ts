import { NextRequest, NextResponse } from "next/server";

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "").replace(/\/+$/, "");
  const tradeUrl = (process.env.NEXT_PUBLIC_TRADE_API_URL ?? "").replace(/\/+$/, "");
  const poolUrl = (process.env.NEXT_PUBLIC_POOL_API_URL ?? "").replace(/\/+$/, "");
  const indexerUrl = (process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "").replace(/\/+$/, "");
  const rpcUrl = (process.env.NEXT_PUBLIC_RPC_URL ?? "").replace(/\/+$/, "");
  const connectSrcs = [
    "'self'",
    backendUrl,
    tradeUrl,
    poolUrl,
    indexerUrl,
    rpcUrl,
  ];
  if (isDev) {
    connectSrcs.push("http://localhost:*", "ws://localhost:*", "wss://localhost:*");
  }
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' blob: data:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSrcs.filter(Boolean).join(" ")}`,
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "worker-src 'self' blob:",
  ];
  const explicitReportUri = process.env.NEXT_PUBLIC_CSP_REPORT_URI;
  const reportUri = explicitReportUri || (backendUrl ? `${backendUrl}/api/csp-report` : "");
  if (reportUri) directives.push(`report-uri ${reportUri}`);
  return directives.join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("x-nonce", nonce);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|sw.js).*)",
  ],
};
