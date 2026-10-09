"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/prisma";
import {
  applyKindnessXp,
  profileFirstCompletionXp,
  syncPeriodBuckets,
  type MotivationGoalId,
} from "@/lib/motivation";

function rowFromDb(m: {
  zodiacSign: string | null;
  personality: string | null;
  goals: unknown;
  totalXp: number;
  dailyXp: number;
  dailyPeriod: string;
  weeklyXp: number;
  weeklyPeriod: string;
  monthlyXp: number;
  monthlyPeriod: string;
  lastKindnessDay: string | null;
  profileFilledAt: Date | null;
}) {
  return {
    zodiacSign: m.zodiacSign,
    personality: m.personality,
    goals: m.goals,
    totalXp: m.totalXp,
    dailyXp: m.dailyXp,
    dailyPeriod: m.dailyPeriod,
    weeklyXp: m.weeklyXp,
    weeklyPeriod: m.weeklyPeriod,
    monthlyXp: m.monthlyXp,
    monthlyPeriod: m.monthlyPeriod,
    lastKindnessDay: m.lastKindnessDay,
    profileFilledAt: m.profileFilledAt,
  };
}

export async function saveMotivationProfileAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Connexion requise.");
  }

  const zodiacSign = String(formData.get("zodiacSign") ?? "").trim() || null;
  const personality = String(formData.get("personality") ?? "").trim() || null;
  const rawGoals = formData.getAll("goals").map(String);
  const goals = rawGoals.filter(Boolean) as MotivationGoalId[];

  const prisma = getPrisma();
  const existing = await prisma.userMotivation.findUnique({
    where: { userId: session.user.id },
  });

  if (!existing) {
    const empty = {
      zodiacSign: null,
      personality: null,
      goals: [],
      totalXp: 0,
      dailyXp: 0,
      dailyPeriod: "",
      weeklyXp: 0,
      weeklyPeriod: "",
      monthlyXp: 0,
      monthlyPeriod: "",
      lastKindnessDay: null,
      profileFilledAt: null,
    };
    const synced = syncPeriodBuckets(empty);
    const xp = profileFirstCompletionXp(empty);
    await prisma.userMotivation.create({
      data: {
        userId: session.user.id,
        zodiacSign,
        personality,
        goals: goals.length ? goals : [],
        totalXp: xp,
        dailyXp: xp,
        weeklyXp: xp,
        monthlyXp: xp,
        dailyPeriod: synced.dailyPeriod,
        weeklyPeriod: synced.weeklyPeriod,
        monthlyPeriod: synced.monthlyPeriod,
        profileFilledAt: new Date(),
      },
    });
    revalidatePath("/motivation");
    return;
  }

  const synced = syncPeriodBuckets(rowFromDb(existing));
  const isFirstFill = !existing.profileFilledAt;
  const bonus = isFirstFill ? profileFirstCompletionXp(rowFromDb(existing)) : 0;

  await prisma.userMotivation.update({
    where: { userId: session.user.id },
    data: {
      zodiacSign,
      personality,
      goals: goals.length ? goals : [],
      totalXp: synced.totalXp + bonus,
      dailyXp: synced.dailyXp + bonus,
      weeklyXp: synced.weeklyXp + bonus,
      monthlyXp: synced.monthlyXp + bonus,
      dailyPeriod: synced.dailyPeriod,
      weeklyPeriod: synced.weeklyPeriod,
      monthlyPeriod: synced.monthlyPeriod,
      ...(isFirstFill ? { profileFilledAt: new Date() } : {}),
    },
  });

  revalidatePath("/motivation");
}

export async function kindnessCheckInAction(): Promise<{ ok: boolean; reason?: "already" | "no_profile" }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Connexion requise.");
  }

  const prisma = getPrisma();
  const m = await prisma.userMotivation.findUnique({
    where: { userId: session.user.id },
  });

  if (!m) {
    return { ok: false, reason: "no_profile" };
  }

  const syncedBase = syncPeriodBuckets(rowFromDb(m));
  const updated = applyKindnessXp(syncedBase);
  if (!updated) {
    return { ok: false, reason: "already" };
  }

  await prisma.userMotivation.update({
    where: { userId: session.user.id },
    data: {
      totalXp: updated.totalXp,
      dailyXp: updated.dailyXp,
      weeklyXp: updated.weeklyXp,
      monthlyXp: updated.monthlyXp,
      dailyPeriod: updated.dailyPeriod,
      weeklyPeriod: updated.weeklyPeriod,
      monthlyPeriod: updated.monthlyPeriod,
      lastKindnessDay: updated.lastKindnessDay,
    },
  });

  revalidatePath("/motivation");
  return { ok: true };
}
