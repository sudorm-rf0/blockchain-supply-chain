import * as Sentry from "@sentry/node";

let enabled = false;

export function initSentry(service = "backend") {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.APP_VERSION ?? "0.1.0",
    serverName: service,
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
  });
  enabled = true;
}

export function isSentryEnabled(): boolean {
  return enabled;
}

export function captureException(error: unknown): void {
  if (!enabled) return;
  Sentry.captureException(error);
}

