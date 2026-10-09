import type { PrismaClient } from "@/generated/prisma";
import { ANIME_GAME_CATALOG } from "./anime-game-catalog-data";
import { ANIME_CATALOG } from "./anime-catalog-data";
import { OST_CATALOG } from "./ost-catalog-data";

/** Upsert animes + personnages (idempotent). Ne supprime pas les entrées retirées du catalogue. */
export async function upsertAnimeCatalog(prisma: PrismaClient): Promise<{ animeCount: number; characterCount: number }> {
  let characterCount = 0;
  for (const row of ANIME_CATALOG) {
    const anime = await prisma.catalogAnime.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        title: row.title,
        sortOrder: row.sortOrder,
      },
      update: {
        title: row.title,
        sortOrder: row.sortOrder,
      },
    });
    for (let i = 0; i < row.characters.length; i++) {
      const name = row.characters[i];
      await prisma.catalogCharacter.upsert({
        where: {
          animeId_name: { animeId: anime.id, name },
        },
        create: {
          animeId: anime.id,
          name,
          sortOrder: i,
        },
        update: {
          sortOrder: i,
        },
      });
      characterCount += 1;
    }
  }
  return { animeCount: ANIME_CATALOG.length, characterCount };
}

/** Upsert OST du catalogue (idempotent). */
export async function upsertOstCatalog(prisma: PrismaClient): Promise<number> {
  for (const row of OST_CATALOG) {
    await prisma.catalogOst.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        title: row.title,
        series: row.series ?? null,
        sortOrder: row.sortOrder,
      },
      update: {
        title: row.title,
        series: row.series ?? null,
        sortOrder: row.sortOrder,
      },
    });
  }
  return OST_CATALOG.length;
}

/** Upsert jeux dérivés anime (idempotent). */
export async function upsertAnimeGameCatalog(prisma: PrismaClient): Promise<number> {
  for (const row of ANIME_GAME_CATALOG) {
    await prisma.catalogAnimeGame.upsert({
      where: { slug: row.slug },
      create: {
        slug: row.slug,
        title: row.title,
        series: row.series ?? null,
        sortOrder: row.sortOrder,
      },
      update: {
        title: row.title,
        series: row.series ?? null,
        sortOrder: row.sortOrder,
      },
    });
  }
  return ANIME_GAME_CATALOG.length;
}
