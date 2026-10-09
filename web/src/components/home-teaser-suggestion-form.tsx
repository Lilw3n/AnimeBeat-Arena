"use client";

import { useState } from "react";

export function HomeTeaserSuggestionForm() {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/link-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "HOME_TEASER",
          title: title || undefined,
          note: note || undefined,
          url,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Impossible d'envoyer la suggestion.");
      }
      setTitle("");
      setUrl("");
      setNote("");
      setMessage("Teaser proposé. En attente de validation admin.");
    } catch (error) {
      setIsError(true);
      setMessage(error instanceof Error ? error.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 rounded-lg border border-cyan-500/25 bg-zinc-950/50 p-3"
    >
      <p className="text-xs font-medium text-cyan-100/90">Proposer un teaser pour l&apos;accueil</p>
      <p className="muted mt-1 text-[11px] text-zinc-400">
        Shorts / Reels / TikTok — visibles sur la page d&apos;accueil une fois approuvés par un admin.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={loading}
          placeholder="Titre (optionnel)"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500"
        />
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          required
          placeholder="https://..."
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500"
        />
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={loading}
          placeholder="Note (optionnel)"
          className="sm:col-span-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-500"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-cyan-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-60"
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
