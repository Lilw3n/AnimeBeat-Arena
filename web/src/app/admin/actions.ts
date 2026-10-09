"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/prisma";
import { upsertAnimeCatalog, upsertAnimeGameCatalog, upsertOstCatalog } from "@/lib/seed-anime-catalog";
import { setDiscordCommunityFields, setLiveTvEnabled } from "@/lib/site-config";
import { LinkSuggestionKind, TierRank } from "@/generated/prisma";

/** Exemples d’URLs (formats Shorts / Reels / TikTok / X) — à valider ou remplacer par les tiennes. */
const socialSeedUrls = [
  "https://www.youtube.com/shorts/SXHMnicI6Pg",
  "https://www.youtube.com/shorts/9bZkp7q19f0",
  "https://www.youtube.com/shorts/jNQXAC9IVRw",
  "https://www.youtube.com/shorts/L_jWHffIx5E",
  "https://www.tiktok.com/@tiktok/video/7300000000000000000",
  "https://www.tiktok.com/@anime/video/7310000000000000000",
  "https://www.instagram.com/reel/C0abcdefghijklmnopqrstuvwxyz1234567890ab/",
  "https://www.instagram.com/reel/D0abcdefghijklmnopqrstuvwxyz1234567890ab/",
  "https://x.com/i/status/1900000000000000000",
  "https://x.com/i/status/1900000000000000001",
  "https://www.youtube.com/shorts/60ItHLz5WEA",
  "https://www.youtube.com/shorts/uelHwf8o7_U",
];

function inferPlatform(url: string): "YouTube Shorts" | "TikTok" | "Instagram" | "X" | "Web" {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com/shorts") || lower.includes("youtu.be")) return "YouTube Shorts";
  if (lower.includes("tiktok.com")) return "TikTok";
  if (lower.includes("instagram.com/reel")) return "Instagram";
  if (lower.includes("x.com") || lower.includes("twitter.com")) return "X";
  return "Web";
}

export async function updateLiveTvAction(formData: FormData) {
  const enabled = formData.get("liveTvEnabled") === "on";
  await setLiveTvEnabled(enabled);
}

export async function updateDiscordCommunityAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Acces refuse.");
  }
  const invite = String(formData.get("discordInviteUrl") ?? "").trim() || null;
  const channel = String(formData.get("discordCommunityChannelUrl") ?? "").trim() || null;
  const widget = String(formData.get("discordWidgetServerId") ?? "").trim() || null;
  await setDiscordCommunityFields({
    discordInviteUrl: invite,
    discordCommunityChannelUrl: channel,
    discordWidgetServerId: widget,
  });
  revalidatePath("/community");
  revalidatePath("/admin");
}

export async function seedAnimeCatalogAction() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Acces refuse.");
  }
  const prisma = getPrisma();
  await upsertAnimeCatalog(prisma);
  await upsertOstCatalog(prisma);
  await upsertAnimeGameCatalog(prisma);
  revalidatePath("/admin");
  revalidatePath("/dashboard/taste");
  redirect("/admin?catalog=synced");
}

export async function seedDefaultTierListsAction() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Acces refuse.");
  }
  const prisma = getPrisma();
  const existing = await prisma.tierList.count();
  if (existing > 0) {
    throw new Error("Des tier lists existent deja. Importe des suggestions sur une liste existante.");
  }
  await prisma.tierList.create({
    data: {
      title: "Dragon Ball Z — Arc Cell",
      category: "Arc",
      anime: "Dragon Ball Z",
      resourceUrl: "https://www.youtube.com/results?search_query=dragon+ball+z+arc+cell",
      createdById: session.user.id,
      items: {
        create: [
          {
            label: "Gohan SSJ2",
            rank: TierRank.S,
            linkUrl: "https://www.youtube.com/results?search_query=gohan+ssj2",
            sortOrder: 0,
          },
          {
            label: "Cell parfait",
            rank: TierRank.A,
            linkUrl: "https://www.youtube.com/results?search_query=perfect+cell",
            sortOrder: 1,
          },
          {
            label: "Cell Juniors",
            rank: TierRank.B,
            linkUrl: "https://www.youtube.com/results?search_query=cell+juniors",
            sortOrder: 2,
          },
        ],
      },
    },
  });
  await prisma.tierList.create({
    data: {
      title: "Top OST motivation anime",
      category: "OST",
      anime: "Multi-anime",
      resourceUrl: "https://www.youtube.com/results?search_query=anime+ost+motivation",
      createdById: session.user.id,
      items: {
        create: [
          {
            label: "You Say Run",
            rank: TierRank.S,
            linkUrl: "https://www.youtube.com/results?search_query=you+say+run",
            sortOrder: 0,
          },
          {
            label: "Unravel",
            rank: TierRank.A,
            linkUrl: "https://www.youtube.com/results?search_query=unravel+tokyo+ghoul",
            sortOrder: 1,
          },
          {
            label: "Guren no Yumiya",
            rank: TierRank.A,
            linkUrl: "https://www.youtube.com/results?search_query=guren+no+yumiya",
            sortOrder: 2,
          },
        ],
      },
    },
  });
}

export async function reviewSuggestionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Acces refuse.");
  }

  const suggestionId = String(formData.get("suggestionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!suggestionId || (decision !== "APPROVED" && decision !== "REJECTED")) {
    throw new Error("Parametres invalides.");
  }

  const prisma = getPrisma();
  await prisma.linkSuggestion.update({
    where: { id: suggestionId },
    data: {
      status: decision,
      reviewedById: session.user.id,
      reviewedAt: new Date(),
    },
  });
  revalidatePath("/admin");
  revalidatePath("/tier-lists");
}

export async function importSocialSuggestionsAction(formData: FormData) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Acces refuse.");
  }

  const targetKind = String(formData.get("targetKind") ?? "list_full").trim();
  const tierListId = String(formData.get("tierListId") ?? "").trim();
  const tierListItemId = String(formData.get("tierListItemId") ?? "").trim();

  const rawUrls = String(formData.get("rawUrls") ?? "").trim();
  const source = String(formData.get("source") ?? "seed");
  const urls = (source === "seed" ? socialSeedUrls : rawUrls.split(/\r?\n/))
    .map((u) => u.trim())
    .filter(Boolean)
    .filter((u, i, arr) => arr.indexOf(u) === i)
    .slice(0, 50);

  if (urls.length === 0) {
    throw new Error("Aucune URL a importer.");
  }

  const prisma = getPrisma();

  if (targetKind === "home_teaser") {
    await prisma.linkSuggestion.createMany({
      data: urls.map((url) => ({
        kind: LinkSuggestionKind.HOME_TEASER,
        tierListId: null,
        tierListItemId: null,
        url,
        title: `${inferPlatform(url)} — teaser accueil`,
        note: "Import admin — teaser page d'accueil",
        submittedById: session.user.id,
        status: "PENDING",
      })),
    });
    return;
  }

  if (!tierListId) {
    throw new Error("Tier list obligatoire pour une cible liste ou element.");
  }

  const tierList = await prisma.tierList.findUnique({
    where: { id: tierListId },
    select: { id: true },
  });
  if (!tierList) {
    throw new Error("Tier list introuvable.");
  }

  if (targetKind === "list_item") {
    if (!tierListItemId) {
      throw new Error("Choisis un element de la tier list.");
    }
    const item = await prisma.tierListItem.findFirst({
      where: { id: tierListItemId, tierListId },
      select: { id: true },
    });
    if (!item) {
      throw new Error("Item introuvable.");
    }
    await prisma.linkSuggestion.createMany({
      data: urls.map((url) => ({
        kind: LinkSuggestionKind.LIST_ITEM,
        tierListId,
        tierListItemId,
        url,
        title: `${inferPlatform(url)} — element`,
        note: "Import admin — lien rattache a un element",
        submittedById: session.user.id,
        status: "PENDING",
      })),
    });
    return;
  }

  await prisma.linkSuggestion.createMany({
    data: urls.map((url) => ({
      kind: LinkSuggestionKind.LIST_FULL,
      tierListId,
      tierListItemId: null,
      url,
      title: `${inferPlatform(url)} — liste complete`,
      note: "Import admin — tier list complete",
      submittedById: session.user.id,
      status: "PENDING",
    })),
  });
}

/** Playlists musique globales : visibles par tous les visiteurs (lecteur en bas de page). */
export async function createGlobalMusicPlaylistAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Acces refuse.");
  }
  const label = String(formData.get("label") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  if (!label || !url) {
    throw new Error("Nom et URL obligatoires.");
  }
  if (url.length > 500) {
    throw new Error("URL trop longue.");
  }
  try {
    new URL(url);
  } catch {
    throw new Error("URL invalide.");
  }
  const prisma = getPrisma();
  await prisma.musicPlaylist.create({
    data: {
      label,
      url,
      createdById: session.user.id,
    },
  });
  revalidatePath("/admin");
}

export async function deleteGlobalMusicPlaylistAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Acces refuse.");
  }
  const playlistId = String(formData.get("playlistId") ?? "").trim();
  if (!playlistId) {
    throw new Error("Playlist introuvable.");
  }
  const prisma = getPrisma();
  await prisma.musicPlaylist.delete({ where: { id: playlistId } });
  revalidatePath("/admin");
}

