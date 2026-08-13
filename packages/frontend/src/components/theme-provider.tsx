"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  nonce,
}: {
  children: ReactNode;
  nonce?: string;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
