import Image from "next/image";
import { auth } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { PromoBanners } from "@/components/promo-banners";
import { LiveTvWall } from "@/components/live-tv-wall";
import { HomeDecorGallery } from "@/components/home-decor-gallery";
import { HomeTeaserSuggestionForm } from "@/components/home-teaser-suggestion-form";
import { findApprovedHomeTeasers } from "@/lib/link-suggestion-queries";
import { getSiteConfig } from "@/lib/site-config";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";

const decorImages = [
  { src: "/images/decor/hinata.png", alt: "Hinata" },
  { src: "/images/decor/saber.png", alt: "Saber" },
  { src: "/images/decor/goku-gohan.png", alt: "Goku et Gohan" },
  { src: "/images/decor/one-piece.png", alt: "One Piece crew" },
  { src: "/images/decor/naruto.png", alt: "Naruto" },
  { src: "/images/decor/kuroko.png", alt: "Kuroko Basket" },
  { src: "/images/decor/armin.png", alt: "Armin" },
  { src: "/images/decor/kaneki.png", alt: "Kaneki" },
  { src: "/images/decor/senku.png", alt: "Senku" },
  { src: "/images/decor/mikey.png", alt: "Mikey Tokyo Revengers" },
];

async function getSessionSafe() {
  try {
    return await auth();
  } catch {
    return null;
  }
}

export default async function Home() {
  const [siteConfig, session] = await Promise.all([getSiteConfig(), getSessionSafe()]);
  let approvedTeasers: Awaited<ReturnType<typeof findApprovedHomeTeasers>> = [];
  if (isDatabaseConfigured()) {
    try {
      const prisma = getPrisma();
      approvedTeasers = await findApprovedHomeTeasers(prisma);
    } catch {
      approvedTeasers = [];
    }
  }

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div className="anime-grid pointer-events-none absolute inset-0" />
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 py-12">
        <section className="glass-panel-strong overflow-hidden rounded-2xl p-6 sm:p-8">
          <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200/90">
                Anime. Motivation. Communaute.
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
                AnimeBeat Arena <span className="neon-text">live experience</span>
              </h1>
              <p className="muted mt-4 max-w-2xl text-sm sm:text-base">
                Plateforme orientee anime/manga: lives, musique, tier lists, et progression communautaire.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs sm:text-sm">
                <span className="rounded-full border border-indigo-300/35 bg-indigo-500/15 px-3 py-1 text-indigo-100">
                  TV live multi-ecrans
                </span>
                <span className="rounded-full border border-cyan-300/35 bg-cyan-500/15 px-3 py-1 text-cyan-100">
                  Suggestions valides admin
                </span>
                <span className="rounded-full border border-violet-300/35 bg-violet-500/15 px-3 py-1 text-violet-100">
                  Playlists communaute
                </span>
              </div>
            </div>
            <Image
              src="/images/decor/saber.png"
              alt="Hero anime stylise"
              width={1400}
              height={900}
              className="h-auto w-full rounded-xl border border-indigo-300/25 bg-zinc-950/40 p-2"
              priority
            />
          </div>
        </section>

        <PromoBanners />

        {approvedTeasers.length > 0 ? (
          <section className="glass-panel mt-6 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-zinc-50">
              Teasers <span className="neon-text">communaute</span>
            </h2>
            <p className="muted mt-1 text-sm">
              Shorts / Reels / TikTok validés par l&apos;équipe — hors tier lists.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {approvedTeasers.map((t, i) => (
                <li key={`${t.url}-${i}`}>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/20"
                  >
                    {t.title || "Voir le teaser"}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {session?.user ? (
          <section className="glass-panel mt-6 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-zinc-50">Proposer un teaser</h2>
            <p className="muted mt-1 text-sm">
              Connecté en tant que {session.user.email}. Les liens restent en attente jusqu&apos;à validation admin.
            </p>
            <HomeTeaserSuggestionForm />
          </section>
        ) : null}

        {siteConfig.liveTvEnabled ? <LiveTvWall /> : null}

        <section className="glass-panel mt-6 rounded-xl p-4">
          <h2 className="text-xl font-semibold">
            Galerie <span className="neon-text">Anime</span>
          </h2>
          <p className="muted mt-1 text-sm">
            Sélection visuelle de tes univers préférés. Clique une vignette pour l&apos;ouvrir en grand sur le site.
          </p>
          <HomeDecorGallery images={decorImages} />
        </section>

        <section className="glass-panel mt-6 overflow-hidden rounded-xl p-4 sm:p-5">
          <div className="flex justify-center">
            <Image
              src="/images/decor/one-piece.png"
              alt="Visuel communaute anime"
              width={972}
              height={1024}
              sizes="(max-width: 640px) 85vw, 384px"
              quality={85}
              className="h-auto max-h-[220px] w-auto max-w-[min(100%,20rem)] rounded-lg object-contain sm:max-h-[260px] sm:max-w-[24rem]"
            />
          </div>
        </section>
      </main>
    </div>
  );
}
