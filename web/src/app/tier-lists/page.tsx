import Link from "next/link";
import { auth } from "@/auth";
import { findApprovedTierListSuggestions } from "@/lib/link-suggestion-queries";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { SiteHeader } from "@/components/site-header";
import { PromoBanners } from "@/components/promo-banners";
import { LinkSuggestionForm } from "@/components/link-suggestion-form";
import { TierListMusicLink } from "@/components/tier-list-music-link";

const fallbackTierLists = [
  {
    title: "Dragon Ball Z — Arc Cell",
    category: "Arc",
    anime: "Dragon Ball Z",
    resourceUrl: "https://www.youtube.com/results?search_query=dragon+ball+z+arc+cell",
    items: [
      { label: "Gohan SSJ2", rank: "S", linkUrl: "https://www.youtube.com/results?search_query=gohan+ssj2" },
      { label: "Cell parfait", rank: "A", linkUrl: "https://www.youtube.com/results?search_query=perfect+cell" },
      { label: "Cell Juniors", rank: "B", linkUrl: "https://www.youtube.com/results?search_query=cell+juniors" },
    ],
  },
  {
    title: "Top OST motivation anime",
    category: "OST",
    anime: "Multi-anime",
    resourceUrl: "https://www.youtube.com/results?search_query=anime+ost+motivation",
    items: [
      { label: "You Say Run", rank: "S", linkUrl: "https://www.youtube.com/results?search_query=you+say+run" },
      { label: "Unravel", rank: "A", linkUrl: "https://www.youtube.com/results?search_query=unravel+tokyo+ghoul" },
      { label: "Guren no Yumiya", rank: "A", linkUrl: "https://www.youtube.com/results?search_query=guren+no+yumiya" },
    ],
  },
];

type TierListQueryRow = Prisma.TierListGetPayload<{
  include: {
    createdBy: { select: { name: true; email: true } };
    items: { orderBy: [{ rank: "asc" }, { sortOrder: "asc" }] };
    _count: { select: { votes: true } };
  };
}>;

export default async function TierListsPage() {
  let session = null;
  try {
    session = await auth();
  } catch {
    session = null;
  }

  let tierLists: TierListQueryRow[] = [];
  const listSuggestionMap = new Map<string, Array<{ url: string; title: string | null }>>();
  const itemSuggestionMap = new Map<string, Array<{ url: string; title: string | null }>>();
  let pendingSuggestionCount = 0;

  if (isDatabaseConfigured()) {
    try {
      const prisma = getPrisma();
      tierLists = await prisma.tierList.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          createdBy: { select: { name: true, email: true } },
          items: { orderBy: [{ rank: "asc" }, { sortOrder: "asc" }] },
          _count: { select: { votes: true } },
        },
      });

      const approvedSuggestions = await findApprovedTierListSuggestions(prisma);
      for (const suggestion of approvedSuggestions) {
        if (!suggestion.tierListId) continue;
        if (suggestion.tierListItemId) {
          const itemLinks = itemSuggestionMap.get(suggestion.tierListItemId) ?? [];
          itemLinks.push({ url: suggestion.url, title: suggestion.title });
          itemSuggestionMap.set(suggestion.tierListItemId, itemLinks);
          continue;
        }
        const listLinks = listSuggestionMap.get(suggestion.tierListId) ?? [];
        listLinks.push({ url: suggestion.url, title: suggestion.title });
        listSuggestionMap.set(suggestion.tierListId, listLinks);
      }

      if (session?.user?.role === "ADMIN") {
        pendingSuggestionCount = await prisma.linkSuggestion.count({ where: { status: "PENDING" } });
      }
    } catch {
      tierLists = [];
    }
  }

  const listsToRender =
    tierLists.length > 0
      ? tierLists.map((list) => ({
          id: list.id,
          title: list.title,
          category: list.category,
          anime: list.anime ?? "Non précisé",
          resourceUrl: list.resourceUrl,
          author: list.createdBy.name || list.createdBy.email,
          votes: list._count.votes,
          approvedLinks: listSuggestionMap.get(list.id) ?? [],
          items: list.items.map((item) => ({
            id: item.id,
            label: item.label,
            rank: item.rank,
            linkUrl: item.linkUrl,
            approvedLinks: itemSuggestionMap.get(item.id) ?? [],
          })),
        }))
      : fallbackTierLists.map((list) => ({
          id: null,
          ...list,
          author: "Exemple",
          votes: 0,
          approvedLinks: [],
          items: list.items.map((item) => ({ ...item, id: null, approvedLinks: [] })),
        }));

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div className="anime-grid pointer-events-none absolute inset-0" />
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 py-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Tier Lists <span className="neon-text">Anime/Manga</span>
            </h1>
            <p className="muted mt-2">
              Classements communautaires par oeuvre, arc, personnage, OST et plus.
            </p>
          </div>
          {session?.user ? (
            <p className="glass-panel rounded-lg px-3 py-2 text-sm text-zinc-200">
              Connecté en tant que {session.user.email}
            </p>
          ) : (
            <Link
              href="/login?callbackUrl=/tier-lists"
              className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
            >
              Se connecter pour participer
            </Link>
          )}
        </div>

        <div className="mt-6 rounded-xl border border-zinc-600/60 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300">
          <p>
            Les liens <span className="text-indigo-200">Shorts / Reels / TikTok / X</span> pour une{" "}
            <strong className="text-zinc-100">tier list</strong> ou un <strong className="text-zinc-100">element</strong>{" "}
            restent cachés ici tant qu&apos;un admin ne les a pas approuvés sur{" "}
            <Link href="/admin" className="font-medium text-cyan-200 hover:text-cyan-100">
              Admin
            </Link>
            . Les <strong className="text-zinc-100">teasers accueil</strong> apparaissent sur la page d&apos;accueil une
            fois valides.
          </p>
          <p className="mt-2 text-xs text-zinc-400">
            Liens <strong className="text-zinc-200">Spotify</strong> ou{" "}
            <strong className="text-zinc-200">YouTube</strong> (vidéo / morceau / playlist intégrable) : un petit{" "}
            <span className="font-mono text-cyan-400/90">▶</span> à côté du nom lance le{" "}
            <strong className="text-zinc-200">lecteur en bas de page</strong> ; la playlist en cours est remplacée
            temporairement — clique <strong className="text-zinc-200">Reprendre la playlist</strong> dans le lecteur pour
            revenir. Les liens type « recherche YouTube » s&apos;ouvrent seulement dans un nouvel onglet.
          </p>
        </div>

        {session?.user?.role === "ADMIN" ? (
          <div className="mt-4 rounded-xl border border-emerald-500/35 bg-emerald-950/30 px-4 py-3 text-sm">
            <p className="font-medium text-emerald-100">
              Admin : {pendingSuggestionCount} suggestion(s) en attente de validation.
            </p>
            <Link
              href="/admin"
              className="mt-2 inline-flex text-xs font-medium text-emerald-200 underline hover:text-emerald-100"
            >
              Ouvrir la validation des liens →
            </Link>
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {listsToRender.map((list) => (
            <article key={`${list.id ?? "fallback"}-${list.title}-${list.category}`} className="glass-panel rounded-xl p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">{list.title}</h2>
                <span className="rounded-full border border-indigo-300/35 bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-100">
                  {list.category}
                </span>
              </div>
              <p className="muted mt-1 text-sm">
                {list.anime} · par {list.author} · {list.votes} vote(s)
              </p>
              {list.resourceUrl ? (
                <a
                  href={list.resourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex text-xs font-medium text-cyan-200 hover:text-cyan-100"
                >
                  Voir la source principale →
                </a>
              ) : null}
              {list.approvedLinks.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {list.approvedLinks.slice(0, 4).map((link, idx) => (
                    <a
                      key={`${link.url}-${idx}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs text-emerald-200 hover:text-emerald-100"
                    >
                      Liste : {link.title || link.url}
                    </a>
                  ))}
                </div>
              ) : null}
              <ul className="mt-4 space-y-2 text-sm">
                {list.items.map((item, idx) => (
                  <li
                    key={`${item.label}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-700/40 bg-zinc-900/60 px-3 py-2"
                  >
                    <span className="inline-flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1 gap-y-0.5">
                      <span className="text-zinc-100">{item.label}</span>
                      {item.linkUrl ? <TierListMusicLink url={item.linkUrl} /> : null}
                      {item.approvedLinks.length > 0 ? (
                        <span className="inline-flex flex-wrap items-baseline gap-x-1">
                          {item.approvedLinks.slice(0, 2).map((link, linkIdx) => (
                            <TierListMusicLink
                              key={`${link.url}-${linkIdx}`}
                              url={link.url}
                              className="text-[8px] font-normal text-emerald-500/90 underline decoration-emerald-500/35 underline-offset-1 hover:text-emerald-300 sm:text-[9px]"
                            >
                              ♪
                            </TierListMusicLink>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-semibold text-indigo-300">{item.rank}</span>
                  </li>
                ))}
              </ul>
              {session?.user && list.id ? (
                <LinkSuggestionForm
                  tierListId={list.id}
                  items={list.items
                    .filter((item) => item.id)
                    .map((item) => ({ id: item.id as string, label: item.label }))}
                />
              ) : null}
            </article>
          ))}
        </div>
        <section className="glass-panel mt-6 overflow-hidden rounded-xl p-6">
          <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-indigo-400/25 bg-zinc-950/50 text-center text-sm text-zinc-400">
            Zone visuelle tier list — ajoute une image dans <code className="text-zinc-300">public/images/</code> si
            besoin.
          </div>
        </section>
        <PromoBanners />
      </main>
    </div>
  );
}

