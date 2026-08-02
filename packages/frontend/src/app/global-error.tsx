"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold">系统异常</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
