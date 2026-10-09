/** Parsing Spotify / YouTube pour le lecteur du site (MusicBanner, tier lists, etc.). */

const YT_BASE =
  "autoplay=1&mute=0&playsinline=1&rel=0&modestbranding=1&enablejsapi=1";

export function getSpotifyEmbed(url: string): string | null {
  const clean = url.trim();
  if (!clean) return null;
  const track = clean.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/);
  if (track) {
    return `https://open.spotify.com/embed/track/${track[1]}?utm_source=generator&autoplay=true`;
  }
  const playlist = clean.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (playlist) {
    return `https://open.spotify.com/embed/playlist/${playlist[1]}?utm_source=generator&autoplay=true`;
  }
  const album = clean.match(/spotify\.com\/album\/([a-zA-Z0-9]+)/);
  if (album) {
    return `https://open.spotify.com/embed/album/${album[1]}?utm_source=generator&autoplay=true`;
  }
  return null;
}

/** Playlist YouTube → lecteur avec file (videoseries). Sinon vidéo seule. */
export function parseYoutubeEmbed(url: string): {
  src: string;
  variant: "playlist" | "video";
} | null {
  const clean = url.trim();
  if (!clean) return null;

  try {
    const u = new URL(clean);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/playlist") {
        const list = u.searchParams.get("list");
        if (list) {
          return {
            src: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&${YT_BASE}`,
            variant: "playlist",
          };
        }
      }
      if (u.pathname === "/watch") {
        const list = u.searchParams.get("list");
        if (list && /^PL|^UU|^OL|^FL|^RD/.test(list)) {
          return {
            src: `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&${YT_BASE}`,
            variant: "playlist",
          };
        }
      }
    }
  } catch {
    /* URL() invalide : fallback regex */
  }

  let id: string | null = null;
  const watch = clean.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
  if (watch) id = watch[1];
  else {
    const short = clean.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
    if (short) id = short[1];
    else {
      const embed = clean.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/);
      if (embed) id = embed[1];
    }
  }
  if (!id) return null;
  return {
    src: `https://www.youtube.com/embed/${id}?${YT_BASE}`,
    variant: "video",
  };
}

export function getYoutubeEmbed(url: string): string | null {
  return parseYoutubeEmbed(url)?.src ?? null;
}

export function canPlayInSitePlayer(url: string): boolean {
  const t = url.trim();
  return Boolean(getSpotifyEmbed(t) || getYoutubeEmbed(t));
}

/** Événement global : jouer une URL dans le lecteur (interruption playlist). */
export const ANIMEBEAT_MUSIC_PLAY_ONCE_EVENT = "animebeat-music:playOnce";
