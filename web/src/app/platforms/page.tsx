import { SiteHeader } from "@/components/site-header";
import { LiveTvWall } from "@/components/live-tv-wall";
import { StreamChatHub } from "@/components/stream-chat-hub";
import { DISCORD_INVITE_URL, KICK_URL, PATREON_URL, TIKTOK_URL } from "@/lib/constants";
import { getSiteConfig } from "@/lib/site-config";

const platformCards = [
  {
    name: "TikTok",
    role: "Acquisition & visibilité",
    description:
      "Formats courts, teasers, edits et hooks pour attirer la communauté anime vers Discord et les lives.",
    href: TIKTOK_URL,
    badge: "Découverte",
  },
  {
    name: "Kick",
    role: "Live communautaire",
    description:
      "Lives discussions, watch-along transformés, débats d'arcs, soirées anime et events en direct.",
    href: KICK_URL,
    badge: "Live",
  },
  {
    name: "Patreon",
    role: "Monétisation récurrente",
    description:
      "Replays premium, bonus, backstage, tiers membres et soutien direct de la communauté.",
    href: PATREON_URL,
    badge: "Premium",
  },
  {
    name: "Discord",
    role: "Noyau social",
    description:
      "Organisation des événements, canaux cinéma anime, salons tier list et entraide sociable au quotidien.",
    href: DISCORD_INVITE_URL,
    badge: "Communauté",
  },
];

const complianceRules = [
  "Pas de rediffusion brute d'anime sans droits explicites.",
  "Favoriser les formats transformés: analyse, commentaire, réaction, débat.",
  "Rediriger vers les sources officielles pour le visionnage légal.",
  "Vérifier les règles de chaque plateforme avant publication.",
];

export default async function PlatformsPage() {
  const config = await getSiteConfig();
  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div className="anime-grid pointer-events-none absolute inset-0" />
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 py-12">
        <section className="glass-panel-strong rounded-2xl p-6 sm:p-8">
          <p className="mb-3 inline-flex rounded-full border border-indigo-300/40 bg-indigo-500/15 px-3 py-1 text-xs font-medium text-indigo-100">
            Stratégie multi-plateforme
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            TikTok, Kick, Patreon, Discord: <span className="neon-text">écosystème complet</span>
          </h1>
          <p className="muted mt-3 max-w-3xl text-sm sm:text-base">
            L&apos;objectif: découverte massive, lives engageants, communauté solide et monétisation saine autour
            de l&apos;univers anime/manga.
          </p>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          {platformCards.map((platform) => (
            <a
              key={platform.name}
              href={platform.href}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-panel rounded-xl p-5 transition-transform duration-200 hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{platform.name}</h2>
                <span className="rounded-full border border-indigo-300/35 bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-100">
                  {platform.badge}
                </span>
              </div>
              <p className="mt-1 text-sm font-medium text-zinc-200">{platform.role}</p>
              <p className="muted mt-2 text-sm">{platform.description}</p>
              <p className="mt-4 text-sm font-medium text-indigo-200">Ouvrir {platform.name} →</p>
            </a>
          ))}
        </section>

        <section className="glass-panel mt-8 rounded-xl p-5">
          <h2 className="text-xl font-semibold">Cadre conformité (important)</h2>
          <ul className="muted mt-3 list-disc space-y-1 pl-5 text-sm">
            {complianceRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </section>
        {config.liveTvEnabled ? <LiveTvWall /> : null}
        <StreamChatHub />
      </main>
    </div>
  );
}

