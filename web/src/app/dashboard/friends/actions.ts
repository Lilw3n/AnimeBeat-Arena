"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { FriendshipStatus } from "@/generated/prisma";
import { getPrisma } from "@/lib/prisma";

export type FriendRequestResult = { ok: true } | { ok: false; error: string };

export async function sendFriendRequestAction(formData: FormData): Promise<FriendRequestResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Connexion requise." };
  }
  const raw = String(formData.get("friendEmail") ?? "").trim().toLowerCase();
  if (!raw || !raw.includes("@")) {
    return { ok: false, error: "Email invalide." };
  }

  try {
    const prisma = getPrisma();
    const target = await prisma.user.findUnique({ where: { email: raw } });
    if (!target) {
      return { ok: false, error: "Aucun compte avec cet email." };
    }
    if (target.id === session.user.id) {
      return { ok: false, error: "Tu ne peux pas t’ajouter toi-même." };
    }

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: session.user.id, addresseeId: target.id },
          { requesterId: target.id, addresseeId: session.user.id },
        ],
      },
    });

    if (!existing) {
      await prisma.friendship.create({
        data: {
          requesterId: session.user.id,
          addresseeId: target.id,
          status: FriendshipStatus.PENDING,
        },
      });
      revalidatePath("/dashboard/friends");
      return { ok: true };
    }

    if (existing.status === FriendshipStatus.ACCEPTED) {
      return { ok: false, error: "Vous êtes déjà ami·e·s." };
    }

    if (existing.status === FriendshipStatus.PENDING) {
      if (existing.requesterId === session.user.id) {
        return { ok: false, error: "Invitation déjà envoyée." };
      }
      return {
        ok: false,
        error: "Cette personne t’a déjà invité·e — regarde les demandes reçues.",
      };
    }

    return { ok: false, error: "Situation inattendue." };
  } catch {
    return { ok: false, error: "Erreur serveur." };
  }
}

export async function acceptFriendshipAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;
  const id = String(formData.get("friendshipId") ?? "").trim();
  if (!id) return;

  try {
    const prisma = getPrisma();
    const f = await prisma.friendship.findUnique({ where: { id } });
    if (!f || f.addresseeId !== session.user.id || f.status !== FriendshipStatus.PENDING) return;
    await prisma.friendship.update({
      where: { id },
      data: { status: FriendshipStatus.ACCEPTED },
    });
    revalidatePath("/dashboard/friends");
  } catch {
    /* ignore */
  }
}

export async function declineFriendshipAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;
  const id = String(formData.get("friendshipId") ?? "").trim();
  if (!id) return;

  try {
    const prisma = getPrisma();
    const f = await prisma.friendship.findUnique({ where: { id } });
    if (!f || f.addresseeId !== session.user.id || f.status !== FriendshipStatus.PENDING) return;
    await prisma.friendship.delete({ where: { id } });
    revalidatePath("/dashboard/friends");
  } catch {
    /* ignore */
  }
}

export async function cancelFriendRequestAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;
  const id = String(formData.get("friendshipId") ?? "").trim();
  if (!id) return;

  try {
    const prisma = getPrisma();
    const f = await prisma.friendship.findUnique({ where: { id } });
    if (!f || f.requesterId !== session.user.id || f.status !== FriendshipStatus.PENDING) return;
    await prisma.friendship.delete({ where: { id } });
    revalidatePath("/dashboard/friends");
  } catch {
    /* ignore */
  }
}

export async function removeFriendAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return;
  const id = String(formData.get("friendshipId") ?? "").trim();
  if (!id) return;

  try {
    const prisma = getPrisma();
    const f = await prisma.friendship.findUnique({ where: { id } });
    if (!f || f.status !== FriendshipStatus.ACCEPTED) return;
    if (f.requesterId !== session.user.id && f.addresseeId !== session.user.id) return;
    await prisma.friendship.delete({ where: { id } });
    revalidatePath("/dashboard/friends");
  } catch {
    /* ignore */
  }
}
