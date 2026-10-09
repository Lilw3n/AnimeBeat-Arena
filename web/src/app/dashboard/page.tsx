import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/sign-out-button";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=/dashboard");
  }
  const user = session?.user;
  const isAdmin = user?.role === "ADMIN";

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-1 flex-col gap-8 px-4 py-16">
      <div>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Tableau de bord</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Bienvenue{user?.name ? `, ${user.name}` : ""}
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">{user?.email}</p>
        <p className="mt-1 text-sm text-violet-600 dark:text-violet-400">
          Rôle : <span className="font-medium">{user?.role ?? "—"}</span>
        </p>
      </div>
      {isAdmin ? (
        <p>
          <Link
            href="/admin"
            className="inline-flex rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          >
            Espace administrateur
          </Link>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <SignOutButton />
        <Link
          href="/dashboard/profile"
          className="rounded-lg border border-cyan-500/40 bg-cyan-950/20 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40"
        >
          Profil &amp; lieu
        </Link>
        <Link
          href="/dashboard/friends"
          className="rounded-lg border border-emerald-500/40 bg-emerald-950/20 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-950/40"
        >
          Ami·e·s
        </Link>
        <Link
          href="/dashboard/taste"
          className="rounded-lg border border-rose-500/40 bg-rose-950/20 px-4 py-2 text-sm font-medium text-rose-100 hover:bg-rose-950/40"
        >
          Animes &amp; persos
        </Link>
        <Link
          href="/motivation"
          className="rounded-lg border border-violet-400/50 bg-violet-950/30 px-4 py-2 text-sm font-medium text-violet-100 hover:bg-violet-950/50 dark:border-violet-500/40"
        >
          Motivation
        </Link>
        <Link
          href="/tier-lists"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Tier Lists
        </Link>
        <Link
          href="/community"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Communauté
        </Link>
        <Link
          href="/"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Accueil
        </Link>
      </div>
    </div>
  );
}
