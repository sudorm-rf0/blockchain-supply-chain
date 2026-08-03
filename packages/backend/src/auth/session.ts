import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}

export function setAuthCookies(
  response: Response,
  accessToken: string,
  refreshToken: string,
): void {
  response.cookie(
    ACCESS_TOKEN_COOKIE,
    accessToken,
    cookieOptions(ACCESS_TOKEN_TTL_SECONDS),
  );
  response.cookie(
    REFRESH_TOKEN_COOKIE,
    refreshToken,
    cookieOptions(REFRESH_TOKEN_TTL_SECONDS),
  );
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(ACCESS_TOKEN_COOKIE, { path: "/" });
  response.clearCookie(REFRESH_TOKEN_COOKIE, { path: "/" });
}
