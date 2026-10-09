"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DESKTOP_APP_DOWNLOAD_URL,
  KICK_URL,
  TIKTOK_ALT_URL,
  TIKTOK_URL,
} from "@/lib/constants";

const TWITCH_CHANNEL = "lilwen54";
const KICK_CHANNEL = "lilwen54";
const TIKTOK_HANDLE = "@idontlikeuspam";
const TIKTOK_ALT_HANDLE = "@kanekiakadiddy";

type TvChannel = {
  id: "kick" | "twitch" | "tiktok" | "tiktok-alt";
  name: string;
  note: string;
  buildSrc: (host: string) => string;
  profileUrl: string;
  embeddable: boolean;
};

function normalizeHost(host: string): string {
  if (host === "127.0.0.1") return "localhost";
  return host;
}

export function LiveTvWall() {
  const [active, setActive] = useState<Set<TvChannel["id"]>>(new Set(["kick"]));
  const [layout, setLayout] = useState<"single" | "split2" | "split3">("single");
  const [chatMode, setChatMode] = useState<"mix" | TvChannel["id"]>("mix");
  const [mainChannel, setMainChannel] = useState<TvChannel["id"]>("kick");
  const [host, setHost] = useState("localhost");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHost(normalizeHost(window.location.hostname));
    }
  }, []);

  const channels = useMemo<TvChannel[]>(() => {
    return [
      {
        id: "kick",
        name: "Kick Live",
        note: "Live principal",
        buildSrc: () => `https://player.kick.com/${KICK_CHANNEL}`,
        profileUrl: KICK_URL,
        embeddable: true,
      },
      {
        id: "twitch",
        name: "Twitch Live",
        note: "Nécessite paramètre parent",
        buildSrc: (currentHost: string) =>
          `https://player.twitch.tv/?channel=${TWITCH_CHANNEL}&parent=${encodeURIComponent(currentHost)}&muted=true`,
        profileUrl: `https://www.twitch.tv/${TWITCH_CHANNEL}`,
        embeddable: true,
      },
      {
        id: "tiktok",
        name: "TikTok Live 1",
        note: "Lecture directe sur TikTok (embed souvent bloqué)",
        buildSrc: () => `https://www.tiktok.com/${TIKTOK_HANDLE}/live`,
        profileUrl: TIKTOK_URL,
        embeddable: false,
      },
      {
        id: "tiktok-alt",
        name: "TikTok Live 2",
        note: "Lecture directe sur TikTok (embed souvent bloqué)",
        buildSrc: () => `https://www.tiktok.com/${TIKTOK_ALT_HANDLE}/live`,
        profileUrl: TIKTOK_ALT_URL,
        embeddable: false,
      },
    ];
  }, [host]);

  function toggle(id: TvChannel["id"]) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMainChannel(id);
  }

  async function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

  function openFloatingWindow(channel: TvChannel) {
    const width = 460;
    const height = 860;
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    window.open(
      channel.profileUrl,
      `tiktok-live-${channel.id}`,
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
  }

  const activeChannels = channels.filter((c) => active.has(c.id));
  const effectiveMain =
    activeChannels.find((c) => c.id === mainChannel)?.id ?? activeChannels[0]?.id ?? null;
  const primaryChannel = activeChannels.find((c) => c.id === effectiveMain) ?? null;
  const secondaryChannels = activeChannels.filter((c) => c.id !== effectiveMain);
  const splitChannels =
    layout === "split2" ? activeChannels.slice(0, 2) : layout === "split3" ? activeChannels.slice(0, 3) : [];
  const twitchChatUrl = `https://www.twitch.tv/embed/${TWITCH_CHANNEL}/chat?parent=${encodeURIComponent(host)}&darkpopout`;
  const kickChatUrl = `https://kick.com/${KICK_CHANNEL}`;

  function renderChannelFrame(channel: TvChannel, titleSuffix: string) {
    if (!channel.embeddable) {
      return (
        <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-zinc-700/70 bg-zinc-950/70 p-4 text-center">
          <p className="text-sm font-medium text-zinc-100">{channel.name}</p>
          <p className="muted max-w-md text-xs">
            Cette plateforme bloque l'iframe live. Ouvre le flux directement dans un nouvel onglet.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <a
              href={channel.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary rounded-md px-3 py-1.5 text-xs font-medium"
            >
              Ouvrir le live {channel.name}
            </a>
            <button
              type="button"
              onClick={() => openFloatingWindow(channel)}
              className="btn-secondary rounded-md px-3 py-1.5 text-xs font-medium"
            >
              Ouvrir en fenêtre flottante
            </button>
          </div>
        </div>
      );
    }

    return (
      <iframe
        title={`${channel.name} ${titleSuffix}`}
        src={channel.buildSrc(host)}
        className="h-full w-full"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      />
    );
  }

  function renderChatPanel() {
    const showTwitch = chatMode === "mix" || chatMode === "twitch";
    const showKick = chatMode === "mix" || chatMode === "kick";
    const showTiktok = chatMode === "mix" || chatMode === "tiktok" || chatMode === "tiktok-alt";

    return (
      <section className="glass-panel mt-4 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">Chat multi-plateforme</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setChatMode("mix")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${chatMode === "mix" ? "btn-primary" : "btn-secondary"}`}
            >
              Mix
            </button>
            <button
              type="button"
              onClick={() => setChatMode("kick")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${chatMode === "kick" ? "btn-primary" : "btn-secondary"}`}
            >
              Kick
            </button>
            <button
              type="button"
              onClick={() => setChatMode("twitch")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${chatMode === "twitch" ? "btn-primary" : "btn-secondary"}`}
            >
              Twitch
            </button>
            <button
              type="button"
              onClick={() => setChatMode("tiktok")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${chatMode === "tiktok" ? "btn-primary" : "btn-secondary"}`}
            >
              TikTok
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {showTwitch ? (
            <article className="overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-950/70">
              <div className="border-b border-zinc-700/60 px-3 py-2 text-xs font-medium text-violet-200">Twitch chat</div>
              <iframe title="Twitch chat" src={twitchChatUrl} className="h-[360px] w-full" />
            </article>
          ) : null}
          {showKick ? (
            <article className="overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-950/70">
              <div className="border-b border-zinc-700/60 px-3 py-2 text-xs font-medium text-emerald-200">Kick chat</div>
              <iframe title="Kick chat" src={kickChatUrl} className="h-[360px] w-full" />
            </article>
          ) : null}
        </div>

        {showTiktok ? (
          <div className="mt-3 rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-3">
            <p className="text-xs text-zinc-200">
              Le chat TikTok est souvent bloqué en iframe. Ouvre directement les chats :
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={TIKTOK_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary rounded-md px-3 py-1.5 text-xs">
                Ouvrir chat TikTok 1
              </a>
              <a href={TIKTOK_ALT_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary rounded-md px-3 py-1.5 text-xs">
                Ouvrir chat TikTok 2
              </a>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="glass-panel mt-6 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">TV Live</h2>
        <p className="muted text-xs">Allume/éteins Kick, Twitch, TikTok 1 et TikTok 2 directement depuis le site.</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="muted text-xs">Mode d'affichage :</span>
        <button
          type="button"
          onClick={() => setLayout("single")}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${layout === "single" ? "btn-primary" : "btn-secondary"}`}
        >
          Grande TV
        </button>
        <button
          type="button"
          onClick={() => setLayout("split2")}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${layout === "split2" ? "btn-primary" : "btn-secondary"}`}
        >
          2 écrans
        </button>
        <button
          type="button"
          onClick={() => setLayout("split3")}
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${layout === "split3" ? "btn-primary" : "btn-secondary"}`}
        >
          3 écrans
        </button>
        <button type="button" onClick={toggleFullscreen} className="btn-secondary rounded-md px-3 py-1.5 text-xs font-medium">
          Plein écran
        </button>
        <a
          href={DESKTOP_APP_DOWNLOAD_URL}
          className="btn-primary rounded-md px-3 py-1.5 text-xs font-medium"
          download
        >
          Télécharger l'app PC (.exe)
        </a>
      </div>
      <p className="muted mt-2 text-[11px]">
        Astuce: si le téléchargement ne démarre pas, configure NEXT_PUBLIC_DESKTOP_APP_URL vers ton release .exe.
      </p>

      <div ref={containerRef} className="mt-4">
        {layout === "single" && primaryChannel ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-950/70 min-h-[320px] md:h-[520px]">
              {renderChannelFrame(primaryChannel, "player")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="muted text-xs">TV principale :</span>
              {activeChannels.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setMainChannel(c.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    effectiveMain === c.id ? "btn-primary" : "btn-secondary"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            {secondaryChannels.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {secondaryChannels.map((c) => (
                  <div key={`mini-${c.id}`} className="overflow-hidden rounded-lg border border-zinc-700/70 min-h-[220px] md:h-[230px]">
                    {renderChannelFrame(c, "mini player")}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {(layout === "split2" || layout === "split3") && splitChannels.length > 0 ? (
          <div className={`grid gap-3 ${layout === "split2" ? "md:grid-cols-2" : "md:grid-cols-2"}`}>
            {splitChannels.map((channel, index) => (
              <div
                key={`split-${channel.id}`}
                className={`overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-950/70 ${
                  layout === "split3" && index === 0 ? "md:col-span-2" : ""
                } ${
                  layout === "split3" && index === 0 ? "aspect-[21/9] min-h-[240px]" : "aspect-video min-h-[220px]"
                }`}
              >
                {renderChannelFrame(channel, "split player")}
              </div>
            ))}
          </div>
        ) : null}

        {activeChannels.length === 0 ? (
          <div className="muted rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-3 py-4 text-xs">
            Aucune TV allumée. Active au moins une chaîne ci-dessous.
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {channels.map((channel) => {
          const isOn = active.has(channel.id);
          return (
            <article key={channel.id} className="glass-panel rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{channel.name}</h3>
                  <p className="muted text-xs">{channel.note}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(channel.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    isOn ? "btn-primary" : "btn-secondary"
                  }`}
                >
                  {isOn ? "Éteindre" : "Allumer"}
                </button>
              </div>

              <div className="muted mt-3 rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-3 py-4 text-xs">
                {isOn ? "Chaîne active" : "Chaîne en veille"}
              </div>

              <a
                href={channel.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex text-xs font-medium text-indigo-200 hover:text-indigo-100"
              >
                Ouvrir {channel.name} dans un onglet →
              </a>
              {!channel.embeddable ? (
                <button
                  type="button"
                  onClick={() => openFloatingWindow(channel)}
                  className="btn-secondary mt-2 inline-flex rounded-md px-3 py-1.5 text-xs font-medium"
                >
                  Ouvrir {channel.name} en fenêtre flottante
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      {renderChatPanel()}
    </section>
  );
}

