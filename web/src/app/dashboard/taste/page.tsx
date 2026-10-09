import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import { TastePicker } from "./taste-picker";

export default async function DashboardTastePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard/taste");
  }

  if (!isDatabaseConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-zinc-400">Base de données non configurée.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-cyan-400">
          ← Tableau de bord
        </Link>
      </div>
    );
  }

  const prisma = getPrisma();
  const [animes, osts, games, interests, opinions, favoriteOsts, favoriteGames] = await Promise.all([
    prisma.catalogAnime.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        characters: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
      },
    }),
    prisma.catalogOst.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, title: true, series: true },
    }),
    prisma.catalogAnimeGame.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, title: true, series: true },
    }),
    prisma.userAnimeInterest.findMany({
      where: { userId: session.user.id },
      select: { animeId: true, kind: true },
    }),
    prisma.userCharacterOpinion.findMany({
      where: { userId: session.user.id },
      select: { characterId: true, sentiment: true },
    }),
    prisma.userFavoriteOst.findMany({
      where: { userId: session.user.id },
      select: { ostId: true },
    }),
    prisma.userFavoriteAnimeGame.findMany({
      where: { userId: session.user.id },
      select: { gameId: true },
    }),
  ]);

  const initialFavoriteIds = interests.filter((i) => i.kind === "FAVORITE").map((i) => i.animeId);
  const initialPlanIds = interests.filter((i) => i.kind === "PLAN_TO_WATCH").map((i) => i.animeId);
  const initialCharacterOpinions = Object.fromEntries(
    opinions.map((o) => [o.characterId, o.sentiment] as const),
  ) as Record<string, "LIKE" | "DISLIKE">;
  const initialFavoriteOstIds = favoriteOsts.map((f) => f.ostId);
  const initialFavoriteGameIds = favoriteGames.map((f) => f.gameId);
  const catalogEmpty = animes.length === 0 && osts.length === 0 && games.length === 0;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-1 flex-col gap-8 px-4 py-16">
      <div>
        <p className="text-sm font-medium text-rose-300">Goûts</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">Animes, OST &amp; personnages</h1>
        <p className="muted mt-2 text-sm">
          Choisis tes OST préférées, indique les séries que tu adores ou que tu veux découvrir, puis ouvre chaque bloc
          pour noter les personnages (j’aime / je déteste / neutre).
        </p>
      </div>

      {catalogEmpty ? (
        <div className="glass-panel rounded-xl border border-amber-500/30 p-5">
          <p className="text-sm text-amber-100">
            Le catalogue n’est pas encore chargé. Un administrateur doit synchroniser les animes, personnages, OST et
            jeux depuis l’espace admin.
          </p>
          {session.user.role === "ADMIN" ? (
            <Link href="/admin" className="mt-3 inline-block text-sm text-cyan-400 hover:text-cyan-300">
              → Espace administrateur
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="glass-panel rounded-xl p-5">
          <TastePicker
            animes={animes.map((a) => ({
              id: a.id,
              title: a.title,
              characters: a.characters,
            }))}
            osts={osts}
            games={games}
            initialFavoriteIds={initialFavoriteIds}
            initialPlanIds={initialPlanIds}
            initialCharacterOpinions={initialCharacterOpinions}
            initialFavoriteOstIds={initialFavoriteOstIds}
            initialFavoriteGameIds={initialFavoriteGameIds}
          />
        </div>
      )}

      <div className="flex flex-col gap-2 text-sm">
        <Link href="/dashboard/profile" className="text-cyan-400 hover:text-cyan-300">
          → Profil &amp; confidentialité
        </Link>
        <Link href="/dashboard" className="text-zinc-500 hover:text-zinc-400">
          ← Tableau de bord
        </Link>
      </div>
    </div>
  );
}
