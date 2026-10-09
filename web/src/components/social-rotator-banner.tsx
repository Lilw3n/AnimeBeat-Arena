"use client";

import { TIKFINITY_SOCIAL_ROTATOR_URL } from "@/lib/constants";

/**
 * Bannière TikFinity / Zerody : affiche la rotation de tes réseaux (iframe officielle).
 * @see https://tikfinity.zerody.one/
 */
export function SocialRotatorBanner() {
  if (!TIKFINITY_SOCIAL_ROTATOR_URL) {
    return null;
  }

  return (
    <div className="sticky top-0 z-30 border-b border-indigo-400/20 bg-[#070b19]/92 backdrop-blur-md">
      <div className="mx-auto w-full max-w-5xl px-3 py-2 sm:px-4">
        <p className="mb-1.5 text-center text-[10px] font-medium uppercase tracking-[0.15em] text-indigo-200/80">
          Réseaux
        </p>
        <div className="overflow-hidden rounded-lg border border-indigo-500/25 bg-slate-950/60 shadow-inner shadow-indigo-950/30">
          <iframe
            src={TIKFINITY_SOCIAL_ROTATOR_URL}
            title="Réseaux sociaux — rotation TikFinity"
            className="block h-[72px] w-full border-0 sm:h-[84px]"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    </div>
  );
}
