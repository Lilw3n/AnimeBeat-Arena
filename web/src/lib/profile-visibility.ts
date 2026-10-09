import type { ProfileLocationVisibility } from "@/generated/prisma";

export type ProfileLocationFields = {
  locationCountry: string | null;
  locationDepartment: string | null;
  locationCity: string | null;
  locationDetail: string | null;
  locationVisibility: ProfileLocationVisibility;
};

export type ViewerContext = {
  isSelf: boolean;
  isFriend: boolean;
};

/** Lignes de localisation visibles selon confidentialité. Tu remplis seulement ce que tu veux (partiel ou complet). */
export function visibleLocationLines(
  profile: ProfileLocationFields | null | undefined,
  ctx: ViewerContext,
): string[] {
  if (!profile) return [];
  if (ctx.isSelf) {
    return [
      profile.locationCountry,
      profile.locationDepartment,
      profile.locationCity,
      profile.locationDetail,
    ].filter(Boolean) as string[];
  }

  const v = profile.locationVisibility;
  if (v === "PRIVATE") return [];
  if (v === "FRIENDS_ONLY" && !ctx.isFriend) return [];
  if (v === "PUBLIC" || (v === "FRIENDS_ONLY" && ctx.isFriend)) {
    return [
      profile.locationCountry,
      profile.locationDepartment,
      profile.locationCity,
      profile.locationDetail,
    ].filter(Boolean) as string[];
  }
  return [];
}

export function visibleDiscordUsername(
  discordUsername: string | null | undefined,
  profile: { showDiscordToFriends: boolean; showDiscordOnPublicProfile: boolean } | null | undefined,
  ctx: ViewerContext,
): string | null {
  if (!discordUsername?.trim()) return null;
  if (ctx.isSelf) return discordUsername;
  const p = profile;
  if (!p) return null;
  if (ctx.isFriend && p.showDiscordToFriends) return discordUsername;
  if (!ctx.isFriend && p.showDiscordOnPublicProfile) return discordUsername;
  return null;
}

export function visibleEmailForFriend(
  email: string,
  profile: { showEmailToFriends: boolean } | null | undefined,
  ctx: ViewerContext,
): string | null {
  if (ctx.isSelf) return email;
  if (ctx.isFriend && profile?.showEmailToFriends) return email;
  return null;
}

export const LOCATION_VISIBILITY_LABELS: Record<ProfileLocationVisibility, string> = {
  PRIVATE: "Personne (sauf moi)",
  FRIENDS_ONLY: "Ami·e·s uniquement",
  PUBLIC: "Tout le monde (profil)",
};
