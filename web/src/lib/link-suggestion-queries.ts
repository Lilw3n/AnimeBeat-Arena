import type { PrismaClient } from "@/generated/prisma";

function isPostgresUrl(url: string): boolean {
  return /^(postgres(ql)?:\/\/)/i.test(url.trim());
}

/**
 * SQL brut : évite le validateur Prisma sur `kind` dans findMany.
 * Deux dialectes selon DATABASE_URL (aligné avec getPrisma).
 */
export async function findApprovedHomeTeasers(
  prisma: PrismaClient,
): Promise<{ url: string; title: string | null }[]> {
  const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
  try {
    if (isPostgresUrl(dbUrl)) {
      return await prisma.$queryRawUnsafe<{ url: string; title: string | null }[]>(
        `SELECT url, title FROM "LinkSuggestion"
         WHERE status = $1 AND CAST(kind AS TEXT) = $2
         ORDER BY "createdAt" DESC
         LIMIT 16`,
        "APPROVED",
        "HOME_TEASER",
      );
    }
    return await prisma.$queryRawUnsafe<{ url: string; title: string | null }[]>(
      `SELECT url, title FROM LinkSuggestion
       WHERE status = ? AND kind = ?
       ORDER BY createdAt DESC
       LIMIT 16`,
      "APPROVED",
      "HOME_TEASER",
    );
  } catch {
    return [];
  }
}

export type TierListSuggestionRow = {
  tierListId: string | null;
  tierListItemId: string | null;
  url: string;
  title: string | null;
};

export async function findApprovedTierListSuggestions(prisma: PrismaClient): Promise<TierListSuggestionRow[]> {
  const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
  try {
    if (isPostgresUrl(dbUrl)) {
      return await prisma.$queryRawUnsafe<TierListSuggestionRow[]>(
        `SELECT "tierListId", "tierListItemId", url, title
         FROM "LinkSuggestion"
         WHERE status = $1
           AND CAST(kind AS TEXT) IN ($2, $3)
         ORDER BY "createdAt" DESC
         LIMIT 300`,
        "APPROVED",
        "LIST_FULL",
        "LIST_ITEM",
      );
    }
    return await prisma.$queryRawUnsafe<TierListSuggestionRow[]>(
      `SELECT tierListId, tierListItemId, url, title
       FROM LinkSuggestion
       WHERE status = ? AND kind IN (?, ?)
       ORDER BY createdAt DESC
       LIMIT 300`,
      "APPROVED",
      "LIST_FULL",
      "LIST_ITEM",
    );
  } catch {
    return prisma.linkSuggestion.findMany({
      where: { status: "APPROVED" },
      select: { tierListId: true, tierListItemId: true, url: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
  }
}
