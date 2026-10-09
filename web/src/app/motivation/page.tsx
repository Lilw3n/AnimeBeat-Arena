import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SiteHeader } from "@/components/site-header";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";
import {
  buildMotivationMessage,
  levelFromTotalXp,
  monthlyBarPercent,
  MOTIVATION_GOALS,
  parseGoalIds,
  periodLevelPercent,
  PERSONALITY_OPTIONS,
  syncPeriodBuckets,
  weeklyBarPercent,
  ZODIAC_OPTIONS,
  type MotivationRow,
} from "@/lib/motivation";
import { saveMotivationProfileAction } from "./actions";
import { KindnessCheckButton } from "./kindness-check-button";

function ProgressBar({ label, percent, hint }: { label: string; percent: number; hint: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span>{hint}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default async function MotivationPage() {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    redirect("/login?callbackUrl=/motivation");
  }

  if (!isDatabaseConfigured()) {
    return (
      <div className="relative flex min-h-full flex-1 flex-col">
        <div className="anime-grid pointer-events-none absolute inset-0" />
        <SiteHeader />
        <main className="relative z-10 mx-auto w-full max-w-lg px-4 py-16 text-center">
          <h1 className="text-xl font-semibold text-zinc-50">Motivation indisponible</h1>
          <p className="muted mt-3 text-sm">
            La base de données n&apos;est pas configurée sur ce déploiement (
            <code className="text-zinc-400">DATABASE_URL</code>). Ajoute l&apos;URL Neon dans les variables
            Vercel puis redéploie.
          </p>
          <Link href="/dashboard" className="mt-6 inline-block text-cyan-300 hover:text-cyan-200">
            ← Tableau de bord
          </Link>
        </main>
      </div>
    );
  }

  let motivationRow: MotivationRow | null = null;
  try {
    const prisma = getPrisma();
    const m = await prisma.userMotivation.findUnique({
      where: { userId: session.user.id },
    });
    if (m) {
      const row: MotivationRow = {
        zodiacSign: m.zodiacSign,
        personality: m.personality,
        goals: m.goals,
        totalXp: m.totalXp,
        dailyXp: m.dailyXp,
        dailyPeriod: m.dailyPeriod,
        weeklyXp: m.weeklyXp,
        weeklyPeriod: m.weeklyPeriod,
        monthlyXp: m.monthlyXp,
        monthlyPeriod: m.monthlyPeriod,
        lastKindnessDay: m.lastKindnessDay,
        profileFilledAt: m.profileFilledAt,
      };
      const synced = syncPeriodBuckets(row);
      const periodChanged =
        synced.dailyPeriod !== m.dailyPeriod ||
        synced.weeklyPeriod !== m.weeklyPeriod ||
        synced.monthlyPeriod !== m.monthlyPeriod;
      if (periodChanged) {
        await prisma.userMotivation.update({
          where: { userId: session.user.id },
          data: {
            dailyPeriod: synced.dailyPeriod,
            weeklyPeriod: synced.weeklyPeriod,
            monthlyPeriod: synced.monthlyPeriod,
            dailyXp: synced.dailyXp,
            weeklyXp: synced.weeklyXp,
            monthlyXp: synced.monthlyXp,
          },
        });
      }
      motivationRow = synced;
    }
  } catch {
    motivationRow = null;
  }

  const goalsSelected = motivationRow ? parseGoalIds(motivationRow.goals) : [];
  const { level, xpIntoLevel, xpForNext } = levelFromTotalXp(motivationRow?.totalXp ?? 0);
  const message = motivationRow ? buildMotivationMessage(motivationRow) : "";

  const dailyPct = periodLevelPercent(motivationRow?.dailyXp ?? 0);
  const weekPct = weeklyBarPercent(motivationRow?.weeklyXp ?? 0);
  const monthPct = monthlyBarPercent(motivationRow?.monthlyXp ?? 0);

  return (
    <div className="relative flex min-h-full flex-1 flex-col">
      <div className="anime-grid pointer-events-none absolute inset-0" />
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-2xl px-4 py-12">
        <p className="text-sm font-medium text-violet-300">Training motivation</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-50">
          Ton chemin, <span className="neon-text">à ton rythme</span>
        </h1>
        <p className="muted mt-3 text-sm leading-relaxed">
          Ici, pas de compétition toxique : des niveaux qui reflètent ta régularité et des messages adaptés à tes
          objectifs, ta personnalité et (si tu le souhaites) ton signe astro. Tout est pensé dans la bienveillance.
        </p>

        {motivationRow ? (
          <section className="glass-panel-strong mt-8 space-y-5 rounded-xl p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-500">Niveau global</p>
                <p className="text-4xl font-bold text-zinc-50">{level}</p>
              </div>
              <p className="text-sm text-zinc-400">
                {xpIntoLevel} / 100 XP dans ce niveau
                {xpForNext > 0 ? (
                  <span className="block text-xs text-zinc-500">Encore {xpForNext} XP pour le niveau suivant</span>
                ) : level >= 99 ? (
                  <span className="block text-xs text-amber-200/80">Niveau max atteint — chapeau.</span>
                ) : null}
              </p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                style={{ width: `${level >= 99 ? 100 : xpIntoLevel}%` }}
              />
            </div>

            <div className="space-y-4 border-t border-zinc-700/50 pt-5">
              <p className="text-sm font-medium text-zinc-200">Énergie par période (UTC, même fuseau que le serveur)</p>
              <ProgressBar
                label="Aujourd’hui"
                percent={dailyPct}
                hint={`${motivationRow.dailyXp} XP`}
              />
              <ProgressBar
                label="Cette semaine"
                percent={weekPct}
                hint={`${motivationRow.weeklyXp} XP`}
              />
              <ProgressBar
                label="Ce mois-ci"
                percent={monthPct}
                hint={`${motivationRow.monthlyXp} XP`}
              />
            </div>

            <div className="border-t border-zinc-700/50 pt-5">
              <KindnessCheckButton />
            </div>

            <blockquote className="border-l-2 border-violet-400/60 pl-4 text-sm italic leading-relaxed text-zinc-300">
              {message}
            </blockquote>
          </section>
        ) : (
          <section className="glass-panel mt-8 rounded-xl p-5 text-sm text-zinc-400">
            Commence par remplir ton profil : objectifs, personnalité, astro optionnel. Tu recevras un premier bonus
            d’XP pour célébrer le pas.
          </section>
        )}

        <section className="glass-panel mt-8 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-zinc-50">Ton profil bienveillant</h2>
          <p className="muted mt-2 text-sm">
            Choisis un ou plusieurs objectifs — aucun n’est « mieux » qu’un autre. Le signe astro est optionnel et sert
            uniquement à des messages plus personnalisés, sans stéréotypes durs.
          </p>

          <form action={saveMotivationProfileAction} className="mt-6 space-y-6">
            <fieldset>
              <legend className="text-sm font-medium text-zinc-200">Tes objectifs (plusieurs choix possibles)</legend>
              <ul className="mt-3 space-y-2">
                {MOTIVATION_GOALS.map((g) => (
                  <li key={g.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-700/60 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200 hover:border-violet-500/40">
                      <input
                        type="checkbox"
                        name="goals"
                        value={g.id}
                        defaultChecked={goalsSelected.includes(g.id)}
                        className="mt-1 h-4 w-4 accent-violet-600"
                      />
                      <span>{g.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <div>
              <label htmlFor="zodiac" className="block text-sm font-medium text-zinc-200">
                Signe astro <span className="font-normal text-zinc-500">(optionnel)</span>
              </label>
              <select
                id="zodiac"
                name="zodiacSign"
                defaultValue={motivationRow?.zodiacSign ?? "SKIP"}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                {ZODIAC_OPTIONS.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="personality" className="block text-sm font-medium text-zinc-200">
                Ce qui te ressemble le plus
              </label>
              <select
                id="personality"
                name="personality"
                required
                defaultValue={motivationRow?.personality ?? ""}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="">Choisis…</option>
                {PERSONALITY_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-medium text-white hover:bg-violet-500 sm:w-auto sm:px-6"
            >
              Enregistrer mon profil
            </button>
          </form>
        </section>

        <p className="mt-8 text-center text-sm text-zinc-500">
          <Link href="/dashboard" className="text-cyan-300 hover:text-cyan-200">
            ← Tableau de bord
          </Link>
        </p>
      </main>
    </div>
  );
}
