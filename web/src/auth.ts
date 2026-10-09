import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Discord from "next-auth/providers/discord";
import { isConfiguredAdminEmail } from "@/lib/admin-env";
import { Role } from "@/generated/prisma";
import { getPrisma } from "@/lib/prisma";

const ADMIN = "ADMIN" as const;
const USER = "USER" as const;

type DiscordProfile = {
  email?: string;
  username?: string;
  global_name?: string | null;
};

function resolveAuthSecret(): string | undefined {
  const s =
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === "development") {
    return "dev-only-animebeat-auth-secret-min-32-chars!!";
  }
  return undefined;
}

if (process.env.VERCEL === "1" && process.env.NODE_ENV === "production") {
  if (!process.env.AUTH_SECRET?.trim() && !process.env.NEXTAUTH_SECRET?.trim()) {
    console.warn(
      "[AnimeBeat Arena] Vercel : AUTH_SECRET ou NEXTAUTH_SECRET manquant — Project → Settings → Environment Variables → Production.",
    );
  }
}

const discordProviders =
  process.env.DISCORD_CLIENT_ID?.trim() && process.env.DISCORD_CLIENT_SECRET?.trim()
    ? [
        Discord({
          clientId: process.env.DISCORD_CLIENT_ID.trim(),
          clientSecret: process.env.DISCORD_CLIENT_SECRET.trim(),
          authorization: { params: { scope: "identify email" } },
        }),
      ]
    : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: resolveAuthSecret(),
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  providers: [
    ...discordProviders,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const [{ compare }] = await Promise.all([import("bcryptjs")]);
          const prisma = getPrisma();
          const email = String(credentials.email).toLowerCase().trim();
          let user = await prisma.user.findUnique({ where: { email } });
          if (!user?.passwordHash) return null;
          const valid = await compare(String(credentials.password), user.passwordHash);
          if (!valid) return null;

          if (isConfiguredAdminEmail(user.email) && user.role !== ADMIN) {
            user = await prisma.user.update({
              where: { id: user.id },
              data: { role: ADMIN },
            });
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
        } catch (err) {
          console.error("[auth] authorize", err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "discord") return true;

      const discordId = account.providerAccountId;
      const prof = profile as DiscordProfile;
      const email = prof.email?.toLowerCase().trim();
      if (!email) {
        console.error("[auth] Discord sans email (active le scope email sur l’app Discord).");
        return false;
      }

      try {
        const prisma = getPrisma();
        let dbUser = await prisma.user.findUnique({ where: { discordId } });

        if (dbUser) {
          await prisma.user.update({
            where: { id: dbUser.id },
            data: {
              discordUsername: prof.username ?? null,
              name: dbUser.name ?? prof.global_name ?? prof.username ?? null,
            },
          });
          dbUser = await prisma.user.findUniqueOrThrow({ where: { id: dbUser.id } });
        } else {
          const byEmail = await prisma.user.findUnique({ where: { email } });
          if (byEmail) {
            if (byEmail.discordId && byEmail.discordId !== discordId) {
              return false;
            }
            dbUser = await prisma.user.update({
              where: { id: byEmail.id },
              data: {
                discordId,
                discordUsername: prof.username ?? null,
              },
            });
          } else {
            dbUser = await prisma.user.create({
              data: {
                email,
                name: prof.global_name || prof.username || null,
                passwordHash: null,
                discordId,
                discordUsername: prof.username ?? null,
                role: isConfiguredAdminEmail(email) ? Role.ADMIN : Role.USER,
              },
            });
          }
        }

        if (isConfiguredAdminEmail(dbUser.email) && dbUser.role !== ADMIN) {
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { role: Role.ADMIN },
          });
        }
        return true;
      } catch (err) {
        console.error("[auth] Discord signIn", err);
        return false;
      }
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "discord") {
        try {
          const prisma = getPrisma();
          const db = await prisma.user.findUnique({
            where: { discordId: account.providerAccountId },
            select: { id: true, email: true, name: true, role: true, discordUsername: true },
          });
          if (db) {
            token.sub = db.id;
            token.email = db.email;
            token.name = db.name;
            token.role = db.role;
            token.discordUsername = db.discordUsername;
          }
        } catch {
          /* ignore */
        }
        return token;
      }

      if (user) {
        token.sub = user.id;
        if (user.email) token.email = user.email;
        if (user.name !== undefined) token.name = user.name;
        const r = (user as { role?: typeof ADMIN | typeof USER }).role;
        token.role = r === ADMIN || r === USER ? r : USER;

        if (account?.provider === "credentials" && user.id) {
          try {
            const prisma = getPrisma();
            const db = await prisma.user.findUnique({
              where: { id: user.id },
              select: { discordUsername: true },
            });
            token.discordUsername = db?.discordUsername ?? null;
          } catch {
            token.discordUsername = null;
          }
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        if (token.email) session.user.email = token.email as string;
        if (token.name !== undefined) session.user.name = token.name as string | null;
        const r = token.role;
        session.user.role = r === ADMIN || r === USER ? r : USER;
        session.user.discordUsername =
          typeof token.discordUsername === "string" || token.discordUsername === null
            ? token.discordUsername
            : null;
      }
      return session;
    },
  },
});
