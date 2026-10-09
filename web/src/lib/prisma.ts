import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma";

/**
 * Ne pas importer `@prisma/adapter-better-sqlite3` en haut du fichier : il charge `better-sqlite3`
 * (binaire natif). Sur Vercel / Node Linux, ça peut faire échouer le démarrage même si on utilise
 * uniquement PostgreSQL. Chargement différé uniquement pour SQLite local.
 */
function createSqliteAdapter(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- chargement conditionnel, pas d’import statique
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3") as typeof import("@prisma/adapter-better-sqlite3");
  return new PrismaBetterSqlite3({ url: url as ":memory:" | (string & {}) });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/** Après `prisma generate`, l’ancien client peut rester en mémoire (HMR / long-running dev) sans les nouveaux modèles. */
function isStalePrismaClient(client: PrismaClient): boolean {
  const c = client as unknown as {
    userMotivation?: { findUnique?: unknown };
    userProfile?: { findUnique?: unknown };
    catalogAnime?: { findUnique?: unknown };
    catalogOst?: { findUnique?: unknown };
    catalogAnimeGame?: { findUnique?: unknown };
  };
  return (
    typeof c.userMotivation?.findUnique !== "function" ||
    typeof c.userProfile?.findUnique !== "function" ||
    typeof c.catalogAnime?.findUnique !== "function" ||
    typeof c.catalogOst?.findUnique !== "function" ||
    typeof c.catalogAnimeGame?.findUnique !== "function"
  );
}

function isPostgresUrl(url: string): boolean {
  return /^(postgres(ql)?:\/\/)/i.test(url.trim());
}

/** False sur Vercel si `DATABASE_URL` n’est pas défini dans les variables d’environnement du projet. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Local : `DATABASE_URL=file:./prisma/dev.db` → SQLite + client généré depuis schema.sqlite.prisma.
 * Vercel / Neon : `postgresql://...` → Postgres + client généré depuis schema.postgresql.prisma.
 * Le script `scripts/sync-prisma-schema.cjs` copie le bon schéma avant chaque `prisma generate`.
 */
export function getPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    if (process.env.VERCEL === "1") {
      console.error(
        "[AnimeBeat Arena] Vercel : DATABASE_URL manquant — ajoute l’URL Neon (postgresql://…) dans Environment Variables et coche « Production », puis redéploie.",
      );
    }
    throw new Error(
      "DATABASE_URL manquant. Local : file:./prisma/dev.db — Prod : postgresql://… (Neon)",
    );
  }
  if (process.env.VERCEL === "1" && !isPostgresUrl(url)) {
    throw new Error(
      "Sur Vercel, DATABASE_URL doit être une URL PostgreSQL (ex. Neon). Un chemin file:… SQLite ne fonctionne pas en production serverless.",
    );
  }
  const mustRecreate = !globalForPrisma.prisma || isStalePrismaClient(globalForPrisma.prisma);

  if (mustRecreate) {
    globalForPrisma.prisma = undefined;
    if (isPostgresUrl(url)) {
      const adapter = new PrismaPg({
        connectionString: url,
        max: Number(process.env.PG_POOL_MAX ?? 10),
        idleTimeoutMillis: 20_000,
        connectionTimeoutMillis: 10_000,
      });
      globalForPrisma.prisma = new PrismaClient({ adapter });
    } else {
      const adapter = createSqliteAdapter(url);
      globalForPrisma.prisma = new PrismaClient({ adapter });
    }
  }
  const client = globalForPrisma.prisma;
  if (!client) {
    throw new Error("Prisma client non initialisé.");
  }
  return client;
}
