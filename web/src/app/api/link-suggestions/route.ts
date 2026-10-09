import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/prisma";
import { LinkSuggestionKind } from "@/generated/prisma";

const bodySchema = z.object({
  kind: z.enum(["LIST_FULL", "LIST_ITEM", "HOME_TEASER"]).optional(),
  tierListId: z.string().min(1).max(100).optional(),
  tierListItemId: z.string().min(1).max(100).optional(),
  title: z.string().max(120).optional(),
  note: z.string().max(300).optional(),
  url: z.string().url().max(500),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Connexion requise." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides." }, { status: 400 });
  }

  const data = parsed.data;
  let kind = data.kind;
  if (!kind) {
    if (data.tierListItemId) kind = "LIST_ITEM";
    else if (data.tierListId) kind = "LIST_FULL";
  }

  if (kind === "HOME_TEASER") {
    if (data.tierListId || data.tierListItemId) {
      return NextResponse.json(
        { error: "Teaser accueil : ne pas envoyer de tier list." },
        { status: 400 },
      );
    }
  } else if (!data.tierListId) {
    return NextResponse.json({ error: "tierListId requis (ou kind HOME_TEASER)." }, { status: 400 });
  } else if (kind === "LIST_ITEM" && !data.tierListItemId) {
    return NextResponse.json({ error: "tierListItemId requis pour un element." }, { status: 400 });
  } else if (kind === "LIST_FULL" && data.tierListItemId) {
    return NextResponse.json(
      { error: "Pour une liste entiere, ne pas envoyer tierListItemId." },
      { status: 400 },
    );
  } else if (!kind) {
    return NextResponse.json({ error: "Cible invalide." }, { status: 400 });
  }

  const prisma = getPrisma();

  if (kind === "HOME_TEASER") {
    await prisma.linkSuggestion.create({
      data: {
        kind: LinkSuggestionKind.HOME_TEASER,
        tierListId: null,
        tierListItemId: null,
        url: data.url.trim(),
        title: data.title?.trim() || null,
        note: data.note?.trim() || null,
        submittedById: session.user.id,
      },
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const tierListId = data.tierListId!;
  const tierList = await prisma.tierList.findUnique({
    where: { id: tierListId },
    select: { id: true },
  });
  if (!tierList) {
    return NextResponse.json({ error: "Tier list introuvable." }, { status: 404 });
  }

  const prismaKind =
    kind === "LIST_ITEM" ? LinkSuggestionKind.LIST_ITEM : LinkSuggestionKind.LIST_FULL;

  if (kind === "LIST_ITEM") {
    const item = await prisma.tierListItem.findFirst({
      where: { id: data.tierListItemId!, tierListId },
      select: { id: true },
    });
    if (!item) {
      return NextResponse.json({ error: "Item introuvable." }, { status: 404 });
    }
  }

  await prisma.linkSuggestion.create({
    data: {
      kind: prismaKind,
      tierListId,
      tierListItemId: kind === "LIST_ITEM" ? data.tierListItemId! : null,
      url: data.url.trim(),
      title: data.title?.trim() || null,
      note: data.note?.trim() || null,
      submittedById: session.user.id,
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
