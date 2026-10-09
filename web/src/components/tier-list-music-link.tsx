"use client";

import { ANIMEBEAT_MUSIC_PLAY_ONCE_EVENT, canPlayInSitePlayer } from "@/lib/music-embed";

type Props = {
  url: string;
  /** Texte très discret dans la ligne (défaut : symbole lecture). */
  children?: React.ReactNode;
  className?: string;
};

export function TierListMusicLink({ url, children = "▶", className = "" }: Props) {
  const inPlayer = canPlayInSitePlayer(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (!inPlayer) return;
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent(ANIMEBEAT_MUSIC_PLAY_ONCE_EVENT, {
            detail: { url: url.trim() },
          }),
        );
      }}
      className={
        className ||
        "ml-0.5 inline align-baseline text-[8px] font-normal leading-none text-cyan-500/85 underline decoration-cyan-500/30 underline-offset-1 hover:text-cyan-300 sm:text-[9px]"
      }
      title={
        inPlayer
          ? "Écouter dans le lecteur du bas : la playlist en cours est mise en pause ; tu pourras la reprendre."
          : "Ouvrir le lien (nouvel onglet)"
      }
    >
      {children}
    </a>
  );
}
