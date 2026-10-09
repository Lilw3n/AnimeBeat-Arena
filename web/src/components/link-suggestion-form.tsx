"use client";

import { useState } from "react";

type ItemOption = {
  id: string;
  label: string;
};

type LinkSuggestionFormProps = {
  tierListId: string;
  items: ItemOption[];
  disabled?: boolean;
};

export function LinkSuggestionForm({ tierListId, items, disabled }: LinkSuggestionFormProps) {
  const [targetItemId, setTargetItemId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [isError, setIsError] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || loading) return;
    setLoading(true);
    setMessage("");
    setIsError(false);

    try {
      const res = await fetch("/api/link-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tierListId,
          tierListItemId: targetItemId || undefined,
          kind: targetItemId ? "LIST_ITEM" : "LIST_FULL",
          title: title || undefined,
          note: note || undefined,
          url,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Impossible d'envoyer la suggestion.");
      }

      setTargetItemId("");
      setTitle("");
      setUrl("");
      setNote("");
      setMessage("Suggestion envoyee. En attente de validation admin.");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-3">
      <p className="text-xs font-medium text-zinc-200">Proposer un lien (validation admin)</p>
      <div className="mt-2 grid gap-2">
        <select
          value={targetItemId}
          onChange={(e) => setTargetItemId(e.target.value)}
          disabled={disabled || loading}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
        >
          <option value="">Cible : tier list entiere</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              Item: {item.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={disabled || loading}
          placeholder="Titre (optionnel)"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500"
        />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={disabled || loading}
          required
          placeholder="https://..."
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={disabled || loading}
          placeholder="Note (optionnel)"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500"
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="submit"
          disabled={disabled || loading}
          className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Envoi..." : "Envoyer"}
        </button>
        {message ? (
          <span className={`text-[11px] ${isError ? "text-rose-300" : "text-emerald-300"}`}>{message}</span>
        ) : null}
      </div>
    </form>
  );
}

