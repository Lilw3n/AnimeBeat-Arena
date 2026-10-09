"use client";

import { useState } from "react";
import { importSocialSuggestionsAction } from "@/app/admin/actions";

export type AdminImportTierList = {
  id: string;
  title: string;
  category: string;
  items: { id: string; label: string }[];
};

type TargetKind = "list_full" | "list_item" | "home_teaser";

export function AdminSocialImportForm({ tierLists }: { tierLists: AdminImportTierList[] }) {
  const hasLists = tierLists.length > 0;
  const [targetKind, setTargetKind] = useState<TargetKind>(() =>
    hasLists ? "list_full" : "home_teaser",
  );
  const [listId, setListId] = useState(tierLists[0]?.id ?? "");
  const items = tierLists.find((t) => t.id === listId)?.items ?? [];

  return (
    <form action={importSocialSuggestionsAction} className="mt-4 space-y-3">
      <fieldset className="space-y-2 rounded-lg border border-zinc-700/80 p-3">
        <legend className="px-1 text-xs font-medium text-zinc-300">Cible des liens</legend>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
          <input
            type="radio"
            name="targetKind"
            value="list_full"
            checked={targetKind === "list_full"}
            onChange={() => setTargetKind("list_full")}
            disabled={!hasLists}
            className="h-4 w-4 accent-indigo-600"
          />
          Tier list entiere
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
          <input
            type="radio"
            name="targetKind"
            value="list_item"
            checked={targetKind === "list_item"}
            onChange={() => setTargetKind("list_item")}
            disabled={!hasLists}
            className="h-4 w-4 accent-indigo-600"
          />
          Element precis (rang / ligne)
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-200">
          <input
            type="radio"
            name="targetKind"
            value="home_teaser"
            checked={targetKind === "home_teaser"}
            onChange={() => setTargetKind("home_teaser")}
            className="h-4 w-4 accent-indigo-600"
          />
          Teaser page d&apos;accueil (hors tier list)
        </label>
      </fieldset>

      {!hasLists ? (
        <p className="text-xs text-amber-200/90">
          Aucune tier list : tu peux importer uniquement des <strong className="text-amber-100">teasers accueil</strong>.
          Sinon, cree des listes via le bouton ci-dessus.
        </p>
      ) : null}

      <select
        name="tierListId"
        value={targetKind === "home_teaser" ? "" : listId}
        onChange={(e) => setListId(e.target.value)}
        required={targetKind !== "home_teaser"}
        disabled={!hasLists || targetKind === "home_teaser"}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 disabled:opacity-50"
      >
        {targetKind === "home_teaser" ? (
          <option value="">— Teaser accueil (pas de liste)</option>
        ) : (
          <>
            <option value="">Choisir une tier list</option>
            {tierLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.title} ({list.category})
              </option>
            ))}
          </>
        )}
      </select>

      <select
        name="tierListItemId"
        required={targetKind === "list_item"}
        disabled={targetKind !== "list_item" || !listId}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 disabled:opacity-50"
      >
        <option value="">Choisir un element</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>

      <textarea
        name="rawUrls"
        rows={4}
        placeholder="Colle tes URLs ici (1 URL par ligne) puis choisis import perso."
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="source"
          value="seed"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          Import examples social
        </button>
        <button
          type="submit"
          name="source"
          value="custom"
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
        >
          Import mes URLs
        </button>
      </div>
    </form>
  );
}
