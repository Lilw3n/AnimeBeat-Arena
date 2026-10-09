"use client";

import { useMemo, useState } from "react";
import { KICK_URL, TIKTOK_URL, TWITCH_URL } from "@/lib/constants";

type Platform = "tiktok" | "kick" | "twitch";

type ChatMessage = {
  id: string;
  platform: Platform;
  author: string;
  text: string;
  at: string;
};

const demoMessages: ChatMessage[] = [
  { id: "m1", platform: "kick", author: "otaku_lite", text: "Live propre! arc Cell ce soir?", at: "20:11" },
  { id: "m2", platform: "tiktok", author: "mangaqueen", text: "Le montage est insane 🔥", at: "20:12" },
  { id: "m3", platform: "twitch", author: "anime_night", text: "On peut faire un top OST ?", at: "20:12" },
  { id: "m4", platform: "kick", author: "buu_saga", text: "Go tier list openings", at: "20:13" },
  { id: "m5", platform: "tiktok", author: "newfan97", text: "Quel anime pour debuter ?", at: "20:14" },
];

const platformMeta: Record<Platform, { label: string; url: string; tone: string }> = {
  tiktok: { label: "TikTok", url: TIKTOK_URL, tone: "text-pink-200" },
  kick: { label: "Kick", url: KICK_URL, tone: "text-emerald-200" },
  twitch: { label: "Twitch", url: TWITCH_URL, tone: "text-violet-200" },
};

function ChatColumn({
  title,
  messages,
  tone,
}: {
  title: string;
  messages: ChatMessage[];
  tone: string;
}) {
  return (
    <article className="glass-panel rounded-xl p-3">
      <h3 className={`text-sm font-semibold ${tone}`}>{title}</h3>
      <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
        {messages.length === 0 ? (
          <p className="muted text-xs">Aucun message pour le moment.</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-2.5 py-2">
              <p className="text-xs font-semibold text-zinc-100">{msg.author}</p>
              <p className="mt-1 text-xs text-zinc-200">{msg.text}</p>
              <p className="muted mt-1 text-[10px]">{msg.at}</p>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

export function StreamChatHub() {
  const [view, setView] = useState<"separate" | "merged">("separate");
  const byPlatform = useMemo(() => {
    return {
      tiktok: demoMessages.filter((m) => m.platform === "tiktok"),
      kick: demoMessages.filter((m) => m.platform === "kick"),
      twitch: demoMessages.filter((m) => m.platform === "twitch"),
    };
  }, []);

  const merged = useMemo(
    () =>
      [...demoMessages].sort((a, b) => {
        if (a.at === b.at) return a.id.localeCompare(b.id);
        return a.at.localeCompare(b.at);
      }),
    [],
  );

  return (
    <section className="glass-panel mt-6 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Hub Chat Multi-plateforme</h2>
          <p className="muted mt-1 text-xs">
            3 chats distincts (TikTok/Kick/Twitch) et vue fusionnée. Architecture prête pour brancher les APIs
            live réelles.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setView("separate")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${view === "separate" ? "btn-primary" : "btn-secondary"}`}
          >
            3 chats séparés
          </button>
          <button
            type="button"
            onClick={() => setView("merged")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${view === "merged" ? "btn-primary" : "btn-secondary"}`}
          >
            Chat regroupé
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {(Object.keys(platformMeta) as Platform[]).map((platform) => (
          <a
            key={`connect-${platform}`}
            href={platformMeta[platform].url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary rounded-lg px-3 py-2 text-xs font-medium"
          >
            Connecter / ouvrir {platformMeta[platform].label}
          </a>
        ))}
      </div>

      {view === "separate" ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <ChatColumn title="TikTok Chat" messages={byPlatform.tiktok} tone={platformMeta.tiktok.tone} />
          <ChatColumn title="Kick Chat" messages={byPlatform.kick} tone={platformMeta.kick.tone} />
          <ChatColumn title="Twitch Chat" messages={byPlatform.twitch} tone={platformMeta.twitch.tone} />
        </div>
      ) : (
        <article className="glass-panel mt-4 rounded-xl p-3">
          <h3 className="text-sm font-semibold text-zinc-100">Chat fusionné</h3>
          <div className="mt-3 max-h-80 space-y-2 overflow-auto pr-1">
            {merged.map((msg) => (
              <div key={`merged-${msg.id}`} className="rounded-md border border-zinc-700/60 bg-zinc-900/60 px-3 py-2">
                <p className="text-xs">
                  <span className={`font-semibold ${platformMeta[msg.platform].tone}`}>
                    [{platformMeta[msg.platform].label}]
                  </span>{" "}
                  <span className="font-semibold text-zinc-100">{msg.author}</span>
                </p>
                <p className="mt-1 text-xs text-zinc-200">{msg.text}</p>
                <p className="muted mt-1 text-[10px]">{msg.at}</p>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

