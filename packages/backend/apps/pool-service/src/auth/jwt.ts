import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "sha256";
const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const DEV_SECRET = process.env.JWT_SECRET || randomBytes(32).toString("hex");

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production");
  }
  return DEV_SECRET;
}

function base64urlEncode(data: Buffer): string {
  return data.toString("base64url");
}

function base64urlDecode(text: string): Buffer {
  return Buffer.from(text, "base64url");
}

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  iat: number;
  exp: number;
}

export function signJwt(payload: Omit<JwtPayload, "iat" | "exp">, expiresInSeconds = 86_400): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: JwtPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(claims)));
  const signature = createHmac(ALGORITHM, getSecret())
    .update(`${HEADER}.${payloadB64}`)
    .digest("base64url");
  return `${HEADER}.${payloadB64}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    if (headerB64 !== HEADER) return null;
    const expectedSig = createHmac(ALGORITHM, getSecret())
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");
    const actualSig = base64urlDecode(signatureB64);
    const expectedBuf = base64urlDecode(expectedSig);
    if (actualSig.length !== expectedBuf.length || !timingSafeEqual(actualSig, expectedBuf)) {
      return null;
    }
    const payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8")) as JwtPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}
