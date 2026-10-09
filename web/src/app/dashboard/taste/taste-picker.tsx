"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  setUserCharacterOpinionAction,
  toggleUserAnimeInterestAction,
  toggleUserFavoriteAnimeGameAction,
  toggleUserFavoriteOstAction,
} from "./actions";

export type TasteAnimePayload = {
  id: string;
  title: string;
  characters: { id: string; name: string }[];
};

export type TasteOstPayload = {
  id: string;
  title: string;
  series: string | null;
};

export type TasteGamePayload = {
  id: string;
  title: string;
  series: string | null;
};

export function TastePicker({
  animes,
  osts,
  games,
  initialFavoriteIds,
  initialPlanIds,
  initialCharacterOpinions,
  initialFavoriteOstIds,
  initialFavoriteGameIds,
}: {
  animes: TasteAnimePayload[];
  osts: TasteOstPayload[];
  games: TasteGamePayload[];
  initialFavoriteIds: string[];
  initialPlanIds: string[];
  initialCharacterOpinions: Record<string, "LIKE" | "DISLIKE">;
  initialFavoriteOstIds: string[];
  initialFavoriteGameIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const favorites = new Set(initialFavoriteIds);
  const plans = new Set(initialPlanIds);
  const opinions = initialCharacterOpinions;
  const favoriteOsts = new Set(initialFavoriteOstIds);
  const favoriteGames = new Set(initialFavoriteGameIds);

  function runGameToggle(gameId: string) {
    setErr(null);
    const fd = new FormData();
    fd.set("gameId", gameId);
    startTransition(async () => {
      const r = await toggleUserFavoriteAnimeGameAction(fd);
      if (!r.ok) {
        setErr(r.error ?? "Erreur");
        return;
      }
      router.refresh();
    });
  }

  function runOstToggle(ostId: string) {
    setErr(null);
    const fd = new FormData();
    fd.set("ostId", ostId);
    startTransition(async () => {
      const r = await toggleUserFavoriteOstAction(fd);
      if (!r.ok) {
        setErr(r.error ?? "Erreur");
        return;
      }
      router.refresh();
    });
  }

  function runToggle(animeId: string, kind: "FAVORITE" | "PLAN_TO_WATCH") {
    setErr(null);
    const fd = new FormData();
    fd.set("animeId", animeId);
    fd.set("kind", kind);
    startTransition(async () => {
      const r = await toggleUserAnimeInterestAction(fd);
      if (!r.ok) {
        setErr(r.error ?? "Erreur");
        return;
      }
      router.refresh();
    });
  }

  function runOpinion(characterId: string, sentiment: "" | "LIKE" | "DISLIKE") {
    setErr(null);
    const fd = new FormData();
    fd.set("characterId", characterId);
    fd.set("sentiment", sentiment === "" ? "CLEAR" : sentiment);
    startTransition(async () => {
      const r = await setUserCharacterOpinionAction(fd);
      if (!r.ok) {
        setErr(r.error ?? "Erreur");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      {err ? <p className="text-sm text-amber-300">{err}</p> : null}

      {games.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold text-zinc-100">Jeux d’anime préférés</h2>
          <p className="muted mt-1 text-sm">
            Jeux dérivés de séries, gacha ou JRPG au style anime — coche ceux auxquels tu joues ou que tu adores.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {games.map((g) => (
              <li key={g.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3 hover:border-violet-600/30">
                  <input
                    type="checkbox"
                    checked={favoriteGames.has(g.id)}
                    disabled={pending}
                    onChange={() => runGameToggle(g.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600 accent-violet-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-100">{g.title}</span>
                    {g.series ? (
                      <span className="mt-0.5 block text-xs text-zinc-500">{g.series}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {osts.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold text-zinc-100">OST préférées</h2>
          <p className="muted mt-1 text-sm">
            Coche les musiques d’anime que tu écoutes en boucle — tu peux en choisir autant que tu veux.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {osts.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-700/60 bg-zinc-950/40 p-3 hover:border-amber-600/30">
                  <input
                    type="checkbox"
                    checked={favoriteOsts.has(o.id)}
                    disabled={pending}
                    onChange={() => runOstToggle(o.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-600 accent-amber-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-100">{o.title}</span>
                    {o.series ? (
                      <span className="mt-0.5 block text-xs text-zinc-500">{o.series}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {animes.length > 0 ? (
      <section>
        <h2 className="text-lg font-semibold text-zinc-100">Animes</h2>
        <p className="muted mt-1 text-sm">
          Coche ce que tu aimes déjà et ce que tu comptes regarder — les deux peuvent coexister pour le même titre.
        </p>
        <ul className="mt-4 space-y-4">
          {animes.map((a) => (
            <li key={a.id} className="rounded-xl border border-zinc-700/60 bg-zinc-950/30 p-4">
              <p className="font-medium text-zinc-50">{a.title}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={favorites.has(a.id)}
                    disabled={pending}
                    onChange={() => runToggle(a.id, "FAVORITE")}
                    className="h-4 w-4 rounded border-zinc-600 accent-rose-500"
                  />
                  J’aime / coup de cœur
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={plans.has(a.id)}
                    disabled={pending}
                    onChange={() => runToggle(a.id, "PLAN_TO_WATCH")}
                    className="h-4 w-4 rounded border-zinc-600 accent-sky-500"
                  />
                  Je compte voir
                </label>
              </div>

              <details className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-violet-300">
                  Personnages ({a.characters.length})
                </summary>
                <ul className="mt-3 space-y-3">
                  {a.characters.map((c) => {
                    const cur = opinions[c.id];
                    return (
                      <li
                        key={c.id}
                        className="flex flex-col gap-2 rounded-lg border border-zinc-800/80 p-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="text-sm text-zinc-200">{c.name}</span>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => runOpinion(c.id, cur === "LIKE" ? "" : "LIKE")}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                              cur === "LIKE"
                                ? "bg-emerald-600 text-white"
                                : "border border-zinc-600 text-zinc-400 hover:border-emerald-600/50 hover:text-emerald-200"
                            }`}
                          >
                            J’aime
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => runOpinion(c.id, cur === "DISLIKE" ? "" : "DISLIKE")}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                              cur === "DISLIKE"
                                ? "bg-rose-700 text-white"
                                : "border border-zinc-600 text-zinc-400 hover:border-rose-600/50 hover:text-rose-200"
                            }`}
                          >
                            Je déteste
                          </button>
                          {cur ? (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => runOpinion(c.id, "")}
                              className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
                            >
                              Neutre
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </section>
      ) : null}
    </div>
  );
}
