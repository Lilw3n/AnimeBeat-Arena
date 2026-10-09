import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ProfileLocationVisibility } from "@/generated/prisma";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import { ProfileForm } from "./profile-form";

export default async function DashboardProfilePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard/profile");
  }

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
  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.user.id },
  });

  const initial = {
    bio: profile?.bio ?? null,
    locationCountry: profile?.locationCountry ?? null,
    locationDepartment: profile?.locationDepartment ?? null,
    locationCity: profile?.locationCity ?? null,
    locationDetail: profile?.locationDetail ?? null,
    locationVisibility: profile?.locationVisibility ?? ProfileLocationVisibility.PRIVATE,
    showEmailToFriends: profile?.showEmailToFriends ?? false,
    showDiscordToFriends: profile?.showDiscordToFriends ?? true,
    showDiscordOnPublicProfile: profile?.showDiscordOnPublicProfile ?? false,
  };

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-1 flex-col gap-6 px-4 py-16">
      <div>
        <p className="text-sm font-medium text-violet-400">Profil</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">Lieu &amp; confidentialité</h1>
        <p className="muted mt-2 text-sm">
          Tes infos restent sous ton contrôle : partiel ou complet, et qui peut les voir (toi seul·e, ami·e·s, ou tout
          le monde pour la localisation).
        </p>
      </div>

      <div className="glass-panel rounded-xl p-5">
        <p className="text-sm text-zinc-300">
          Compte : <span className="text-zinc-100">{session.user.email}</span>
          {session.user.discordUsername ? (
            <span className="mt-1 block text-emerald-300">Discord lié : @{session.user.discordUsername}</span>
          ) : (
            <span className="mt-1 block text-zinc-500">Discord non lié — utilise la connexion Discord sur /login.</span>
          )}
        </p>
        <ProfileForm initial={initial} />
      </div>

      <Link href="/dashboard/taste" className="text-sm text-rose-300 hover:text-rose-200">
        → Animes &amp; personnages (goûts)
      </Link>
      <Link href="/dashboard/friends" className="text-sm text-cyan-400 hover:text-cyan-300">
        → Ami·e·s &amp; invitations
      </Link>
      <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-400">
        ← Tableau de bord
      </Link>
    </div>
  );
}
