export type SocialPreview =
  | {
      kind: "youtube";
      videoId: string;
      thumbnailUrl: string;
      embedUrl: string;
    }
  | { kind: "tiktok"; url: string }
  | { kind: "instagram"; url: string }
  | { kind: "x"; url: string }
  | { kind: "generic"; url: string };

/** ID vidéo YouTube (11 caractères) pour shorts, watch, embed, youtu.be. */
export function extractYouTubeVideoId(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0]?.split("?")[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (!host.includes("youtube.com") && !host.includes("youtube-nocookie.com")) {
      return null;
    }
    if (u.pathname.startsWith("/shorts/")) {
      const id = u.pathname.split("/").filter(Boolean)[1]?.split("?")[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const embed = u.pathname.match(/^\/embed\/([\w-]{11})/);
    if (embed) return embed[1];
  } catch {
    return null;
  }
  return null;
}

export function getSocialPreview(url: string): SocialPreview {
  const trimmed = url.trim();
  try {
    const host = new URL(trimmed).hostname.replace(/^www\./, "");
    const yt = extractYouTubeVideoId(trimmed);
    if (yt) {
      return {
        kind: "youtube",
        videoId: yt,
        thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
        embedUrl: `https://www.youtube.com/embed/${yt}`,
      };
    }
    if (host.includes("tiktok.com")) return { kind: "tiktok", url: trimmed };
    if (host.includes("instagram.com")) return { kind: "instagram", url: trimmed };
    if (host === "x.com" || host === "twitter.com") return { kind: "x", url: trimmed };
  } catch {
    return { kind: "generic", url: trimmed };
  }
  return { kind: "generic", url: trimmed };
}

export function socialPreviewLabel(p: SocialPreview): string {
  switch (p.kind) {
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
    case "x":
      return "X";
    default:
      return "Lien";
  }
}
