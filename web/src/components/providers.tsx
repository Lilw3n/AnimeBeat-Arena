"use client";

import { SessionProvider } from "next-auth/react";

/** basePath explicite : aligné sur `app/api/auth/[...nextauth]/route.ts`. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath="/api/auth">{children}</SessionProvider>;
}
