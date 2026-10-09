"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { ProfileLocationVisibility } from "@/generated/prisma";
import { getPrisma } from "@/lib/prisma";

const VIS: ProfileLocationVisibility[] = ["PRIVATE", "FRIENDS_ONLY", "PUBLIC"];

export type ProfileSaveResult = { ok: true } | { ok: false; error: string };

export async function saveUserProfileAction(formData: FormData): Promise<ProfileSaveResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Connexion requise." };
  }

  const bio = String(formData.get("bio") ?? "").trim().slice(0, 500) || null;
  const locationCountry = String(formData.get("locationCountry") ?? "").trim().slice(0, 120) || null;
  const locationDepartment = String(formData.get("locationDepartment") ?? "").trim().slice(0, 120) || null;
  const locationCity = String(formData.get("locationCity") ?? "").trim().slice(0, 120) || null;
  const locationDetail = String(formData.get("locationDetail") ?? "").trim().slice(0, 500) || null;

  const rawVis = String(formData.get("locationVisibility") ?? "PRIVATE");
  const locationVisibility = VIS.includes(rawVis as ProfileLocationVisibility)
    ? (rawVis as ProfileLocationVisibility)
    : ProfileLocationVisibility.PRIVATE;

  const showEmailToFriends = formData.get("showEmailToFriends") === "on";
  const showDiscordToFriends = formData.get("showDiscordToFriends") === "on";
  const showDiscordOnPublicProfile = formData.get("showDiscordOnPublicProfile") === "on";

  try {
    const prisma = getPrisma();
    await prisma.userProfile.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        bio,
        locationCountry,
        locationDepartment,
        locationCity,
        locationDetail,
        locationVisibility,
        showEmailToFriends,
        showDiscordToFriends,
        showDiscordOnPublicProfile,
      },
      update: {
        bio,
        locationCountry,
        locationDepartment,
        locationCity,
        locationDetail,
        locationVisibility,
        showEmailToFriends,
        showDiscordToFriends,
        showDiscordOnPublicProfile,
      },
    });
    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard/friends");
    return { ok: true };
  } catch {
    return { ok: false, error: "Impossible d’enregistrer (base indisponible ?)." };
  }
}
