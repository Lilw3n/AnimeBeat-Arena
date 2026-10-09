import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { z } from "zod";
import { Role } from "@/generated/prisma";
import { isConfiguredAdminEmail } from "@/lib/admin-env";
import { getPrisma } from "@/lib/prisma";

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Données invalides.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { email, password, name } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return NextResponse.json({ error: "Cet email est déjà utilisé." }, { status: 409 });
  }

  const passwordHash = await hash(password, 12);
  const role = isConfiguredAdminEmail(normalizedEmail) ? Role.ADMIN : Role.USER;

  await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      name: name?.trim() || null,
      role,
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
