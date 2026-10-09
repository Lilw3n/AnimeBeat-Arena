import type { DefaultSession } from "next-auth";

export type AppRole = "USER" | "ADMIN";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: AppRole;
      discordUsername?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
    discordUsername?: string | null;
  }
}
