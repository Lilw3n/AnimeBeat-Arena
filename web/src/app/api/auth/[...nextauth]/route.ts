import { handlers } from "@/auth";

/** Node.js requis : Prisma / adaptateurs natifs ne sont pas supportés sur Edge. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST } = handlers;
