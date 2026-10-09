import Image from "next/image";
import Link from "next/link";
import { auth } from "@/auth";
import { DiscordSignInButton } from "@/components/discord-sign-in-button";
import { PromoBanners } from "@/components/promo-banners";
import { SiteHeader } from "@/components/site-header";
import { isDiscordOAuthConfigured, resolveDiscordCommunity } from "@/lib/discord-community";
import { getSiteConfig } from "@/lib/site-config";

const weeklySchedule = [
  { day: "Lundi", event: "Tier list live: openings anime", channel: "#tier-list-live" },
  { day: "Mercredi", event: "Soirée cinéma anime", channel: "#cinema-anime" },
  { day: "Vendredi", event: "Débat arc vs arc", channel: "#debats-anime" },
  { day: "Dimanche", event: "Bilan motivation + objectifs", channel: "#motivation-sport" },
];

export default async function CommunityPage() {
  const [rawConfig, session] = await Promise.all([getSiteConfig(), auth().catch(() => null)]);
  const discord = resolveDiscordCommunity(rawConfig);
  const oauth = isDiscordOAuthConfigured();

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div className="anime-grid pointer-events-none absolute inset-0" />
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Communauté Anime + <span className="neon-text">Discord</span>
        </h1>
        <p className="muted mt-2 max-w-2xl">
          Les discussions en direct se passent sur un salon Discord dédié : pas de chat parallèle sur le site, tout le
          monde utilise le même fil (widget + lien direct + invitation).
        </p>

        <section className="glass-panel-strong mt-8 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-indigo-100">Salon Discord dédié</h2>
          <p className="mt-2 text-sm text-indigo-100/85">
            Ouvre le salon dans l&apos;app ou le navigateur Discord pour chatter. Le widget ci-dessous affiche les
            membres en ligne sur le serveur (si activé côté Discord).
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={discord.inviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex rounded-lg px-4 py-2 text-sm font-medium"
            >
              Inviter / rejoindre le serveur
            </a>
            {discord.communityChannelUrl ? (
              <a
                href={discord.communityChannelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20"
              >
                Ouvrir le salon de chat
              </a>
            ) : (
              <p className="self-center text-xs text-amber-200/90">
                Admin : renseigne le lien du canal dans l&apos;espace admin (ou{" "}
                <code className="rounded bg-zinc-900 px-1">NEXT_PUBLIC_DISCORD_COMMUNITY_CHANNEL_URL</code>).
              </p>
            )}
          </div>

          {discord.widgetServerId ? (
            <div className="mt-6 overflow-hidden rounded-xl border border-zinc-700/60 bg-zinc-950/40">
              <iframe
                title="Widget Discord"
                src={`https://discord.com/widget?id=${encodeURIComponent(discord.widgetServerId)}&theme=dark`}
                width="100%"
                height={420}
                style={{ maxWidth: 400 }}
                allowTransparency
                sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              />
            </div>
          ) : (
            <p className="muted mt-4 text-xs">
              Pour afficher le widget : active le widget sur ton serveur Discord et renseigne l&apos;ID dans l&apos;admin
              ou <code className="text-zinc-400">NEXT_PUBLIC_DISCORD_WIDGET_SERVER_ID</code>.
            </p>
          )}
        </section>

        <section className="glass-panel mt-8 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-zinc-50">Lier ton compte AnimeBeat à Discord</h2>
          <p className="muted mt-2 text-sm">
            Connexion OAuth : si ton email Discord correspond déjà à un compte du site, le profil est relié. Sinon un
            compte est créé. Tu peux aussi te connecter par email / mot de passe puis utiliser Discord une fois OAuth
            configuré.
          </p>
          {oauth ? (
            <div className="mt-4 max-w-sm space-y-3">
              {session?.user ? (
                <p className="text-sm text-zinc-200">
                  Connecté : <span className="font-medium text-zinc-50">{session.user.email}</span>
                  {session.user.discordUsername ? (
                    <span className="block text-emerald-200/90">
                      Discord lié : @{session.user.discordUsername}
                    </span>
                  ) : (
                    <span className="block text-amber-200/90">
                      Pas encore de Discord lié — clique pour associer ce compte Discord (même email).
                    </span>
                  )}
                </p>
              ) : null}
              <DiscordSignInButton callbackUrl="/community" />
              {!session?.user ? (
                <p className="text-center text-xs text-zinc-500">
                  Déjà un compte email ?{" "}
                  <Link href="/login?callbackUrl=/community" className="text-cyan-300 hover:text-cyan-200">
                    Connexion classique
                  </Link>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="muted mt-3 text-sm">
              OAuth Discord non configuré sur ce déploiement. Ajoute{" "}
              <code className="text-zinc-400">DISCORD_CLIENT_ID</code> et{" "}
              <code className="text-zinc-400">DISCORD_CLIENT_SECRET</code> (voir{" "}
              <code className="text-zinc-400">.env.example</code>) et enregistre l&apos;URL de callback sur le portail
              développeur Discord.
            </p>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">Planning type des channels</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {weeklySchedule.map((slot) => (
              <article key={`${slot.day}-${slot.channel}`} className="glass-panel rounded-xl p-4">
                <p className="muted text-sm font-medium">{slot.day}</p>
                <h3 className="mt-1 font-semibold">{slot.event}</h3>
                <p className="muted mt-1 text-sm">{slot.channel}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="glass-panel mt-10 rounded-xl p-5">
          <h2 className="text-xl font-semibold">Canaux recommandés</h2>
          <ul className="mt-3 grid gap-2 text-sm text-zinc-200 sm:grid-cols-2">
            <li>#annonces</li>
            <li>#tier-list-live</li>
            <li>#cinema-anime</li>
            <li>#watch-party</li>
            <li>#mangas-scans</li>
            <li>#ost-and-playlists</li>
            <li>#motivation-sport</li>
            <li>#entraide-sociale</li>
          </ul>
        </section>
        <section className="glass-panel mt-6 overflow-hidden rounded-xl p-3">
          <Image
            src="/images/decor/hinata.png"
            alt="Groupe de fans en soirée anime"
            width={1400}
            height={900}
            className="h-auto w-full rounded-lg object-cover"
          />
        </section>
        <PromoBanners />
      </main>
    </div>
  );
}
