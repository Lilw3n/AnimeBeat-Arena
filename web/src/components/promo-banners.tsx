import Link from "next/link";
import { DISCORD_INVITE_URL, KICK_URL, PATREON_URL, TIKTOK_URL } from "@/lib/constants";

const banners = [
  {
    title: "Teasers anime sur TikTok",
    subtitle: "Formats courts, edits et hooks pour recruter la commu",
    cta: "Voir TikTok",
    href: TIKTOK_URL,
    external: true,
    tone: "from-pink-500/35 via-fuchsia-500/25 to-cyan-400/25",
    badge: "Acquisition",
  },
  {
    title: "Live anime sur Kick",
    subtitle: "Watch-along + débat en direct avec le chat",
    cta: "Accéder à Kick",
    href: KICK_URL,
    external: true,
    tone: "from-emerald-500/30 via-lime-500/25 to-sky-500/25",
    badge: "Live",
  },
  {
    title: "Replays premium via Patreon",
    subtitle: "VOD, bonus et soutien créateur",
    cta: "Découvrir Patreon",
    href: PATREON_URL,
    external: true,
    tone: "from-amber-500/30 via-orange-500/25 to-rose-500/25",
    badge: "Monétisation",
  },
  {
    title: "Hub social Discord",
    subtitle: "Cinéma anime, tier lists live, entraide et motivation",
    cta: "Rejoindre le Discord",
    href: DISCORD_INVITE_URL,
    external: true,
    tone: "from-indigo-500/35 via-violet-500/25 to-cyan-400/25",
    badge: "Communauté",
  },
];

export function PromoBanners() {
  return (
    <section className="mt-6 grid gap-4 md:grid-cols-2">
      {banners.map((banner) => {
        const content = (
          <article
            className={`glass-panel group relative overflow-hidden rounded-xl p-4 transition-transform duration-200 hover:-translate-y-0.5`}
          >
            <div className={`absolute inset-0 -z-10 bg-gradient-to-br ${banner.tone}`} />
            <span className="inline-flex rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-100">
              {banner.badge}
            </span>
            <h3 className="mt-3 text-base font-semibold text-zinc-100">{banner.title}</h3>
            <p className="muted mt-1 text-sm">{banner.subtitle}</p>
            <p className="mt-4 text-sm font-medium text-indigo-200 group-hover:text-indigo-100">{banner.cta} →</p>
          </article>
        );

        if (banner.external) {
          return (
            <a key={banner.title} href={banner.href} target="_blank" rel="noopener noreferrer">
              {content}
            </a>
          );
        }

        return (
          <Link key={banner.title} href={banner.href}>
            {content}
          </Link>
        );
      })}
    </section>
  );
}

