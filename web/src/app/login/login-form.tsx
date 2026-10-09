import Link from "next/link";
import { DiscordSignInButton } from "@/components/discord-sign-in-button";
import { loginAction } from "./actions";

type Props = {
  callbackUrl: string;
  defaultEmail: string;
  registered?: boolean;
  serverError?: boolean;
  authServerError?: boolean;
  discordDenied?: boolean;
  showDiscordOAuth?: boolean;
};

export function LoginForm({
  callbackUrl,
  defaultEmail,
  registered,
  serverError,
  authServerError,
  discordDenied,
  showDiscordOAuth,
}: Props) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Connexion
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">AnimeBeat Arena</p>
        </div>
        {registered ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            Compte créé. Tu peux te connecter.
          </p>
        ) : null}
        {serverError ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            role="alert"
          >
            Email ou mot de passe incorrect.
          </p>
        ) : null}
        {authServerError ? (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            role="alert"
          >
            Erreur technique à la connexion. Regarde le terminal du serveur (`npm run dev`) pour le détail, ou relance{" "}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">npm run bootstrap-admin</code>.
          </p>
        ) : null}
        {discordDenied ? (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            role="alert"
          >
            Connexion Discord refusée ou email Discord indisponible. Vérifie que l&apos;application Discord demande le
            scope <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">email</code> et que ton compte Discord a
            un email.
          </p>
        ) : null}
        {showDiscordOAuth ? (
          <div className="space-y-2">
            <DiscordSignInButton callbackUrl={callbackUrl} />
            <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">ou avec email</p>
          </div>
        ) : null}
        <form action={loginAction} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={defaultEmail}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Se connecter
          </button>
        </form>
        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          Pas encore de compte ?{" "}
          <Link href="/register" className="font-medium text-zinc-900 underline dark:text-zinc-100">
            Créer un compte
          </Link>
        </p>
        <p className="text-center">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← Accueil
          </Link>
        </p>
      </div>
    </div>
  );
}
