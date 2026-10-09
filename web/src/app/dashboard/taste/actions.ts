"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { UserAnimeInterestKind, UserCharacterSentiment } from "@/generated/prisma";
import { getPrisma } from "@/lib/prisma";

const KINDS: UserAnimeInterestKind[] = ["FAVORITE", "PLAN_TO_WATCH"];

export async function toggleUserAnimeInterestAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Connexion requise." };
  }
  const animeId = String(formData.get("animeId") ?? "").trim();
  const rawKind = String(formData.get("kind") ?? "").trim();
  if (!animeId || !KINDS.includes(rawKind as UserAnimeInterestKind)) {
    return { ok: false, error: "Paramètres invalides." };
  }
  const kind = rawKind as UserAnimeInterestKind;

  try {
    const prisma = getPrisma();
    const anime = await prisma.catalogAnime.findUnique({ where: { id: animeId } });
    if (!anime) {
      return { ok: false, error: "Anime inconnu." };
    }

    const existing = await prisma.userAnimeInterest.findUnique({
      where: {
        userId_animeId_kind: {
          userId: session.user.id,
          animeId,
          kind,
        },
      },
    });

    if (existing) {
      await prisma.userAnimeInterest.delete({ where: { id: existing.id } });
    } else {
      await prisma.userAnimeInterest.create({
        data: {
          userId: session.user.id,
          animeId,
          kind,
        },
      });
    }
    revalidatePath("/dashboard/taste");
    return { ok: true };
  } catch {
    return { ok: false, error: "Erreur serveur." };
  }
}

const SENTIMENTS: UserCharacterSentiment[] = ["LIKE", "DISLIKE"];

export async function setUserCharacterOpinionAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Connexion requise." };
  }
  const characterId = String(formData.get("characterId") ?? "").trim();
  const raw = String(formData.get("sentiment") ?? "").trim();

  if (!characterId) {
    return { ok: false, error: "Paramètres invalides." };
  }

  try {
    const prisma = getPrisma();
    const character = await prisma.catalogCharacter.findUnique({ where: { id: characterId } });
    if (!character) {
      return { ok: false, error: "Personnage inconnu." };
    }

    if (raw === "" || raw === "CLEAR") {
      await prisma.userCharacterOpinion.deleteMany({
        where: { userId: session.user.id, characterId },
      });
      revalidatePath("/dashboard/taste");
      return { ok: true };
    }

    if (!SENTIMENTS.includes(raw as UserCharacterSentiment)) {
      return { ok: false, error: "Paramètres invalides." };
    }
    const sentiment = raw as UserCharacterSentiment;

    await prisma.userCharacterOpinion.upsert({
      where: {
        userId_characterId: {
          userId: session.user.id,
          characterId,
        },
      },
      create: {
        userId: session.user.id,
        characterId,
        sentiment,
      },
      update: { sentiment },
    });
    revalidatePath("/dashboard/taste");
    return { ok: true };
  } catch {
    return { ok: false, error: "Erreur serveur." };
  }
}

export async function toggleUserFavoriteOstAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Connexion requise." };
  }
  const ostId = String(formData.get("ostId") ?? "").trim();
  if (!ostId) {
    return { ok: false, error: "Paramètres invalides." };
  }

  try {
    const prisma = getPrisma();
    const ost = await prisma.catalogOst.findUnique({ where: { id: ostId } });
    if (!ost) {
      return { ok: false, error: "OST inconnue." };
    }

    const existing = await prisma.userFavoriteOst.findUnique({
      where: {
        userId_ostId: {
          userId: session.user.id,
          ostId,
        },
      },
    });

    if (existing) {
      await prisma.userFavoriteOst.delete({ where: { id: existing.id } });
    } else {
      await prisma.userFavoriteOst.create({
        data: {
          userId: session.user.id,
          ostId,
        },
      });
    }
    revalidatePath("/dashboard/taste");
    return { ok: true };
  } catch {
    return { ok: false, error: "Erreur serveur." };
  }
}

export async function toggleUserFavoriteAnimeGameAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Connexion requise." };
  }
  const gameId = String(formData.get("gameId") ?? "").trim();
  if (!gameId) {
    return { ok: false, error: "Paramètres invalides." };
  }

  try {
    const prisma = getPrisma();
    const game = await prisma.catalogAnimeGame.findUnique({ where: { id: gameId } });
    if (!game) {
      return { ok: false, error: "Jeu inconnu." };
    }

    const existing = await prisma.userFavoriteAnimeGame.findUnique({
      where: {
        userId_gameId: {
          userId: session.user.id,
          gameId,
        },
      },
    });

    if (existing) {
      await prisma.userFavoriteAnimeGame.delete({ where: { id: existing.id } });
    } else {
      await prisma.userFavoriteAnimeGame.create({
        data: {
          userId: session.user.id,
          gameId,
        },
      });
    }
    revalidatePath("/dashboard/taste");
    return { ok: true };
  } catch {
    return { ok: false, error: "Erreur serveur." };
  }
}
