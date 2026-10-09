"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ANIMEBEAT_MUSIC_PLAY_ONCE_EVENT,
  canPlayInSitePlayer,
  getSpotifyEmbed,
  getYoutubeEmbed,
  parseYoutubeEmbed,
} from "@/lib/music-embed";

type Source = "spotify" | "youtube";

type ParsedMusic = {
  src: string;
  source: Source;
  /** Hauteur iframe : assez grande pour liste / file dans le widget. */
  iframeHeight: number;
  variant: "spotify-track" | "spotify-collection" | "youtube-video" | "youtube-playlist";
};

function embedNavHint(v: ParsedMusic["variant"]): string {
  switch (v) {
    case "spotify-track":
      return "Dans Spotify : un seul morceau dans le widget. Pour une suite de titres, choisis une playlist ou un album Spotify (menu ◀ ▶ ou liste).";
    case "spotify-collection":
      return "Dans Spotify : la liste des morceaux est à droite dans le cadre — fais défiler et clique. Sur petit écran, pivote en paysage ou utilise « Ouvrir dans Spotify ».";
    case "youtube-playlist":
      return "Dans YouTube (cadre ci-dessous) : touche le menu ☰ ou « Playlist » pour voir toutes les vidéos ; les boutons Précédent / Suivant du lecteur YouTube passent à la vidéo suivante ou précédente de cette même playlist.";
    case "youtube-video":
      return "Une seule vidéo. Pour une liste à enchaîner, colle une URL de playlist YouTube (page « playlist » ou lien avec &list=…).";
    default:
      return "";
  }
}

type Preset = {
  id: string;
  label: string;
  url: string;
};

const SESSION_PLAYLISTS_KEY = "music-banner-session-playlists";

const presets: Preset[] = [
  {
    id: "spotify-main",
    label: "Playlist Spotify - AnimeBeat Arena",
    url: "https://open.spotify.com/playlist/37i9dQZF1DX0hAXqBDwvn9",
  },
  {
    id: "spotify-chill",
    label: "Playlist Spotify - Chill Anime",
    url: "https://open.spotify.com/playlist/37i9dQZF1DX3YSRoSdA634",
  },
  {
    id: "youtube-mix",
    label: "Mix YouTube - Anime OST",
    url: "https://www.youtube.com/watch?v=4i7M4gV6RYk",
  },
];

export function MusicBanner() {
  const { data: session } = useSession();
  const isConnected = Boolean(session?.user);
  const isAdmin = session?.user?.role === "ADMIN";
  const [mounted, setMounted] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [savedUrl, setSavedUrl] = useState(presets[0].url);
  const [customPlaylists, setCustomPlaylists] = useState<Preset[]>([]);
  const [dbPlaylists, setDbPlaylists] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(presets[0].id);
  const [open, setOpen] = useState(false);
  const [dockLow, setDockLow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Incrémenté pour remonter l’iframe (autoplay + son après geste utilisateur). */
  const [embedRemountKey, setEmbedRemountKey] = useState(0);
  const allPlaylists = useMemo(
    () => [...presets, ...dbPlaylists, ...customPlaylists],
    [customPlaylists, dbPlaylists],
  );

  const savedUrlRef = useRef(savedUrl);
  const selectedPresetRef = useRef(selectedPreset);
  const interruptionRef = useRef<{ url: string; presetId: string } | null>(null);
  const [hasInterruption, setHasInterruption] = useState(false);

  useEffect(() => {
    savedUrlRef.current = savedUrl;
  }, [savedUrl]);
  useEffect(() => {
    selectedPresetRef.current = selectedPreset;
  }, [selectedPreset]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const storedDock = window.localStorage.getItem("music-banner-dock-low");
    setDockLow(storedDock === "1");

    const customRaw = window.sessionStorage.getItem(SESSION_PLAYLISTS_KEY);
    let customList: Preset[] = [];
    if (customRaw) {
      try {
        const parsed = JSON.parse(customRaw) as Preset[];
        if (Array.isArray(parsed)) {
          customList = parsed;
          setCustomPlaylists(parsed);
        }
      } catch {
        // ignore broken local data
      }
    }
    const stored = window.localStorage.getItem("music-banner-url");
    if (stored) {
      setSavedUrl(stored);
      const preset = [...presets, ...customList].find((p) => p.url === stored);
      setSelectedPreset(preset?.id ?? "custom");
    } else {
      window.localStorage.setItem("music-banner-url", presets[0].url);
    }
  }, []);

  const loadDbPlaylists = useCallback(async () => {
    try {
      const res = await fetch("/api/music-playlists", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as {
        playlists?: Array<{ id: string; label: string; url: string }>;
      };
      const mapped = (payload.playlists ?? []).map((p) => ({
        id: `db-${p.id}`,
        label: p.label,
        url: p.url,
      }));
      setDbPlaylists(mapped);
    } catch {
      // ignore loading issues
    }
  }, []);

  useEffect(() => {
    loadDbPlaylists();
  }, [loadDbPlaylists]);

  useEffect(() => {
    const onFocus = () => loadDbPlaylists();
    const onVis = () => {
      if (document.visibilityState === "visible") loadDbPlaylists();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [loadDbPlaylists]);

  useEffect(() => {
    if (!savedUrl.trim() || dbPlaylists.length === 0) return;
    const match = dbPlaylists.find((p) => p.url.trim() === savedUrl.trim());
    if (!match) return;
    setSelectedPreset((prev) => (prev === match.id ? prev : match.id));
  }, [dbPlaylists, savedUrl]);

  const remountPlayer = useCallback(() => {
    setEmbedRemountKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<{ url?: string }>;
      const next = e.detail?.url?.trim();
      if (!next || !canPlayInSitePlayer(next)) return;
      if (!interruptionRef.current) {
        interruptionRef.current = {
          url: savedUrlRef.current,
          presetId: selectedPresetRef.current,
        };
        setHasInterruption(true);
      }
      setError(null);
      setSavedUrl(next);
      window.localStorage.setItem("music-banner-url", next);
      setSelectedPreset("custom");
      setOpen(true);
      remountPlayer();
    };
    window.addEventListener(ANIMEBEAT_MUSIC_PLAY_ONCE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ANIMEBEAT_MUSIC_PLAY_ONCE_EVENT, handler as EventListener);
  }, [remountPlayer]);

  /** Premier clic / toucher sur la page : beaucoup de navigateurs n’autorisent le son qu’après un geste. */
  useEffect(() => {
    const onFirstPointer = () => remountPlayer();
    document.addEventListener("pointerdown", onFirstPointer, { once: true, capture: true });
    return () => document.removeEventListener("pointerdown", onFirstPointer, { capture: true });
  }, [savedUrl, remountPlayer]);

  const parsed = useMemo((): ParsedMusic | null => {
    const trimmed = savedUrl.trim();
    const spotifySrc = getSpotifyEmbed(trimmed);
    if (spotifySrc) {
      const isTrack = /\/embed\/track\//.test(spotifySrc);
      return {
        src: spotifySrc,
        source: "spotify",
        /** Playlists / albums : hauteur suffisante pour la liste des titres dans le widget Spotify. */
        iframeHeight: isTrack ? 232 : 520,
        variant: isTrack ? "spotify-track" : "spotify-collection",
      };
    }
    const yt = parseYoutubeEmbed(trimmed);
    if (yt) {
      return {
        src: yt.src,
        source: "youtube",
        iframeHeight: yt.variant === "playlist" ? 560 : 320,
        variant: yt.variant === "playlist" ? "youtube-playlist" : "youtube-video",
      };
    }
    return null;
  }, [savedUrl]);

  const currentPlaylistIndex = useMemo(() => {
    let idx = allPlaylists.findIndex((p) => p.id === selectedPreset);
    if (idx < 0) {
      idx = allPlaylists.findIndex((p) => p.url.trim() === savedUrl.trim());
    }
    return idx >= 0 ? idx : 0;
  }, [allPlaylists, selectedPreset, savedUrl]);

  function applyUrl(raw?: string) {
    const next = (raw ?? urlInput).trim();
    if (!next) {
      setError("Colle un lien Spotify ou YouTube.");
      return;
    }
    const spotify = getSpotifyEmbed(next);
    const youtube = getYoutubeEmbed(next);
    if (!spotify && !youtube) {
      setError(
        "Lien non reconnu. Utilise un lien Spotify (morceau / playlist / album) ou YouTube (vidéo ou page playlist ?list=…).",
      );
      return;
    }
    interruptionRef.current = null;
    setHasInterruption(false);
    setError(null);
    setSavedUrl(next);
    window.localStorage.setItem("music-banner-url", next);
    setUrlInput("");
    setOpen(true);
    remountPlayer();
  }

  function clearUrl() {
    setSavedUrl("");
    window.localStorage.removeItem("music-banner-url");
    setError(null);
  }

  async function addCustomPlaylist() {
    const label = nameInput.trim();
    const link = urlInput.trim();
    if (!label) {
      setError("Ajoute un nom de playlist.");
      return;
    }
    if (!link) {
      setError("Ajoute un lien Spotify ou YouTube.");
      return;
    }
    const spotify = getSpotifyEmbed(link);
    const youtube = getYoutubeEmbed(link);
    if (!spotify && !youtube) {
      setError(
        "Lien non reconnu. Utilise un lien Spotify (morceau / playlist / album) ou YouTube (vidéo ou page playlist ?list=…).",
      );
      return;
    }
    if (!isConnected) {
      setError("Connecte-toi pour ajouter une playlist.");
      return;
    }

    if (isAdmin) {
      try {
        const res = await fetch("/api/music-playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, url: link }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Impossible d'enregistrer en base.");
        }
        const payload = (await res.json()) as { playlist: { id: string; label: string; url: string } };
        const created = {
          id: `db-${payload.playlist.id}`,
          label: payload.playlist.label,
          url: payload.playlist.url,
        };
        setDbPlaylists((prev) => {
          const withoutDup = prev.filter((p) => p.id !== created.id);
          return [created, ...withoutDup];
        });
        setSelectedPreset(created.id);
        void loadDbPlaylists();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur serveur.");
        return;
      }
    } else {
      const id = `session-${Date.now()}`;
      const next: Preset[] = [...customPlaylists, { id, label, url: link }];
      setCustomPlaylists(next);
      window.sessionStorage.setItem(SESSION_PLAYLISTS_KEY, JSON.stringify(next));
      setSelectedPreset(id);
    }

    setError(null);
    setNameInput("");
    applyUrl(link);
  }

  function removeCurrentCustomPlaylist() {
    if (!selectedPreset.startsWith("session-")) return;
    const next = customPlaylists.filter((p) => p.id !== selectedPreset);
    setCustomPlaylists(next);
    window.sessionStorage.setItem(SESSION_PLAYLISTS_KEY, JSON.stringify(next));
    setSelectedPreset(presets[0].id);
    applyUrl(presets[0].url);
  }

  function goAdjacentPlaylist(delta: -1 | 1) {
    if (allPlaylists.length === 0) return;
    const len = allPlaylists.length;
    const nextIndex = (currentPlaylistIndex + delta + len) % len;
    const preset = allPlaylists[nextIndex];
    setSelectedPreset(preset.id);
    applyUrl(preset.url);
  }

  const resumeAfterTierListListen = useCallback(() => {
    const snap = interruptionRef.current;
    if (!snap) return;
    interruptionRef.current = null;
    setHasInterruption(false);
    const preset = allPlaylists.find((p) => p.id === snap.presetId);
    const snapUrl = snap.url.trim();
    const urlOk = snapUrl && (getSpotifyEmbed(snapUrl) || getYoutubeEmbed(snapUrl));
    const targetUrl = urlOk ? snapUrl : (preset?.url ?? presets[0].url);
    const targetPresetId = preset?.id ?? presets[0].id;
    setSelectedPreset(targetPresetId);
    setSavedUrl(targetUrl);
    window.localStorage.setItem("music-banner-url", targetUrl);
    setError(null);
    setOpen(true);
    remountPlayer();
  }, [allPlaylists, remountPlayer]);

  if (!mounted) {
    return null;
  }

  return (
    <div
      className={`fixed inset-x-0 z-50 px-3 sm:px-4 ${dockLow ? "bottom-0 pb-0" : "bottom-0 pb-3 sm:pb-4"}`}
    >
      <div className="glass-panel-strong mx-auto w-full max-w-[96rem] rounded-xl p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="mr-2 font-semibold text-emerald-300">Lecteur musique</p>
          {hasInterruption ? (
            <button
              type="button"
              onClick={resumeAfterTierListListen}
              className="shrink-0 rounded-md border border-amber-400/55 bg-amber-950/55 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-900/45"
              title="Recharge la playlist qui jouait avant un lien tier list"
            >
              Reprendre la playlist
            </button>
          ) : null}
          <div className="flex min-w-0 max-w-full flex-[1_1_280px] items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={() => goAdjacentPlaylist(-1)}
              disabled={allPlaylists.length < 2}
              title="Playlist précédente"
              aria-label="Playlist précédente"
              className="shrink-0 rounded-md border border-slate-500 bg-slate-800/90 px-2 py-1.5 text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ◀
            </button>
            <select
              value={allPlaylists.some((p) => p.id === selectedPreset) ? selectedPreset : "custom"}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedPreset(value);
                if (value !== "custom") {
                  const preset = allPlaylists.find((p) => p.id === value);
                  if (preset) applyUrl(preset.url);
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100"
              aria-label="Choisir une playlist"
            >
              {allPlaylists.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Lien personnalisé</option>
            </select>
            <button
              type="button"
              onClick={() => goAdjacentPlaylist(1)}
              disabled={allPlaylists.length < 2}
              title="Playlist suivante"
              aria-label="Playlist suivante"
              className="shrink-0 rounded-md border border-slate-500 bg-slate-800/90 px-2 py-1.5 text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ▶
            </button>
            {allPlaylists.length > 0 ? (
              <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400" title="Position dans la liste">
                {currentPlaylistIndex + 1}/{allPlaylists.length}
              </span>
            ) : null}
          </div>
          <a
            href={savedUrl || presets[0].url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Ouvrir dans Spotify/YouTube
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-slate-500 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
            title={open ? "Replier le lecteur (la musique continue)" : "Afficher le lecteur"}
          >
            {open ? "Masquer le lecteur" : "Afficher le lecteur"}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !dockLow;
              setDockLow(next);
              window.localStorage.setItem("music-banner-dock-low", next ? "1" : "0");
            }}
            className="rounded-md border border-slate-500 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            {dockLow ? "Position normale" : "Descendre"}
          </button>
        </div>

        <p className="mt-1 text-xs text-slate-300/85">
          Lecture lancée automatiquement quand le navigateur l’autorise. Sinon, un clic sur la page ou sur « Démarrer le
          son » active le lecteur. « Masquer le lecteur » replie l’iframe mais{" "}
          <strong className="text-slate-200">la lecture continue</strong> en arrière-plan.
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Nom playlist"
            className="w-40 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400"
          />
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Colle un lien Spotify ou YouTube"
            className="min-w-[220px] flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-400"
          />
          <button
            type="button"
            onClick={() => {
              setSelectedPreset("custom");
              applyUrl();
            }}
            className="rounded-md bg-cyan-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-cyan-500"
          >
            Charger
          </button>
          <button
            type="button"
            onClick={addCustomPlaylist}
            className="rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
          >
            {isAdmin ? "Ajouter playlist (base admin)" : "Ajouter playlist (session)"}
          </button>
          {selectedPreset.startsWith("session-") ? (
            <button
              type="button"
              onClick={removeCurrentCustomPlaylist}
              className="rounded-md border border-rose-500/60 px-2.5 py-1.5 text-xs text-rose-200 hover:bg-rose-900/30"
            >
              Supprimer playlist
            </button>
          ) : null}
          <button
            type="button"
            onClick={clearUrl}
            className="rounded-md border border-slate-500 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
          >
            Vider
          </button>
        </div>

        {error ? <p className="mt-2 text-xs text-amber-300">{error}</p> : null}
        <p className="mt-1 text-[11px] text-slate-300/85">
          Les playlists enregistrées par un admin en base sont listées ici pour{" "}
          <strong className="text-slate-200">tous les visiteurs</strong> (sans compte).
        </p>
        {isConnected ? (
          <p className="mt-1 text-[11px] text-slate-300/85">
            {isAdmin
              ? "En tant qu’admin, « Ajouter playlist » enregistre aussi en base (comme sur la page Admin)."
              : "Tes propres ajouts restent en session (ce navigateur) jusqu’à fermeture."}
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-slate-300/85">
            Connecte-toi pour ajouter des playlists personnelles (session).
          </p>
        )}

        {parsed ? (
          <>
            {open ? (
              <div className="mt-3 space-y-2 rounded-lg border border-emerald-800/50 bg-emerald-950/25 p-3 text-[11px] leading-relaxed">
                <p className="text-slate-200">
                  <span className="font-semibold text-emerald-300">Sur AnimeBeat Arena</span> — les boutons{" "}
                  <span className="font-mono text-slate-100">◀</span> <span className="font-mono text-slate-100">▶</span>{" "}
                  et le menu déroulant servent à changer de <strong className="text-white">playlist</strong> (une autre
                  liste chargée sur le site).
                </p>
                <p className="text-slate-400">{embedNavHint(parsed.variant)}</p>
              </div>
            ) : null}
            <div
              className={
                open
                  ? "mt-2 overflow-hidden rounded-lg border border-slate-600 bg-slate-800/70"
                  : "pointer-events-none fixed top-0 -left-[2400px] z-0 w-[min(100vw,420px)] opacity-0"
              }
              style={!open ? { height: parsed.iframeHeight } : undefined}
            >
              <iframe
                key={`${savedUrl}-${embedRemountKey}`}
                src={parsed.src}
                title={`Lecteur ${parsed.source}`}
                width="100%"
                height={parsed.iframeHeight}
                tabIndex={open ? 0 : -1}
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="eager"
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

