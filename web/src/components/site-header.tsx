import Link from "next/link";
import { DISCORD_INVITE_URL } from "@/lib/constants";

export function SiteHeader() {
  return (
    <header className="px-4 pt-4">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
        <Link href="/" className="neon-text text-lg font-semibold tracking-tight">
          AnimeBeat Arena
        </Link>
        <nav className="glass-panel rounded-xl p-1.5 text-sm font-medium">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Link
            href="/tier-lists"
            className="rounded-md px-2.5 py-1.5 text-zinc-200 hover:bg-white/10"
          >
            Tier Lists
          </Link>
          <Link
            href="/community"
            className="rounded-md px-2.5 py-1.5 text-zinc-200 hover:bg-white/10"
          >
            Communauté
          </Link>
          <Link
            href="/motivation"
            className="rounded-md px-2.5 py-1.5 text-zinc-200 hover:bg-white/10"
          >
            Motivation
          </Link>
          <Link
            href="/platforms"
            className="rounded-md px-2.5 py-1.5 text-zinc-200 hover:bg-white/10"
          >
            Plateformes
          </Link>
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary rounded-md px-3 py-1.5"
          >
            Discord
          </a>
          <Link
            href="/login"
            className="rounded-md px-2.5 py-1.5 text-zinc-200 hover:bg-white/10"
          >
            Connexion
          </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

