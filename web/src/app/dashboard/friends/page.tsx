import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FriendshipStatus } from "@/generated/prisma";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import { AddFriendForm } from "./add-friend-form";
import { FriendCard } from "./friend-card";

const userInclude = {
  select: {
    id: true,
    email: true,
    name: true,
    discordUsername: true,
    profile: true,
  },
} as const;

export default async function DashboardFriendsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard/friends");
  }
  const me = session.user.id;

  if (!isDatabaseConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <p className="text-zinc-400">Base de données non configurée.</p>
        <Link href="/dashboard" className="mt-4 inline-block text-cyan-400">
          ← Tableau de bord
        </Link>
      </div>
    );
  }

  const prisma = getPrisma();

  const [incoming, outgoing, accepted] = await Promise.all([
    prisma.friendship.findMany({
      where: { addresseeId: me, status: FriendshipStatus.PENDING },
      include: { requester: userInclude },
      orderBy: { createdAt: "desc" },
    }),
    prisma.friendship.findMany({
      where: { requesterId: me, status: FriendshipStatus.PENDING },
      include: { addressee: userInclude },
      orderBy: { createdAt: "desc" },
    }),
    prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: me }, { addresseeId: me }],
      },
      include: { requester: userInclude, addressee: userInclude },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-1 flex-col gap-8 px-4 py-16">
      <div>
        <p className="text-sm font-medium text-emerald-400">Ami·e·s</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">Invitations &amp; liste</h1>
        <p className="muted mt-2 text-sm">
          Ajoute quelqu’un avec l’email de son compte AnimeBeat (pas de recherche Discord ici — Discord sert à lier ton
          compte pour afficher ton pseudo si tu l’autorises dans le profil).
        </p>
      </div>

      <section className="glass-panel rounded-xl p-5">
        <h2 className="text-sm font-medium text-zinc-200">Inviter</h2>
        <AddFriendForm />
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-200">Demandes reçues</h2>
        {incoming.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Aucune demande en attente.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {incoming.map((f) => (
              <FriendCard key={f.id} friendshipId={f.id} other={f.requester} variant="incoming" />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-200">En attente (envoyées)</h2>
        {outgoing.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Tu n’as pas d’invitation en cours.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {outgoing.map((f) => (
              <FriendCard key={f.id} friendshipId={f.id} other={f.addressee} variant="outgoing" />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-200">Ami·e·s</h2>
        {accepted.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Ta liste est vide pour l’instant.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {accepted.map((f) => {
              const other = f.requesterId === me ? f.addressee : f.requester;
              return <FriendCard key={f.id} friendshipId={f.id} other={other} variant="accepted" />;
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-2 text-sm">
        <Link href="/dashboard/profile" className="text-cyan-400 hover:text-cyan-300">
          → Profil, lieu &amp; confidentialité
        </Link>
        <Link href="/dashboard" className="text-zinc-500 hover:text-zinc-400">
          ← Tableau de bord
        </Link>
      </div>
    </div>
  );
}
