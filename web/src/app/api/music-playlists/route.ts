import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/prisma";

/** Toujours lire la base : playlists admin visibles par tous les utilisateurs. */
export const dynamic = "force-dynamic";

const createSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.string().url().max(500),
});

export async function GET() {
  const prisma = getPrisma();
  const playlists = await prisma.musicPlaylist.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, label: true, url: true },
  });
  return NextResponse.json(
    { playlists },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    },
  );
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Acces reserve admin." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides." }, { status: 400 });
  }

  const prisma = getPrisma();
  const created = await prisma.musicPlaylist.create({
    data: {
      label: parsed.data.label.trim(),
      url: parsed.data.url.trim(),
      createdById: session.user.id,
    },
    select: { id: true, label: true, url: true },
  });

  return NextResponse.json({ playlist: created }, { status: 201 });
}

