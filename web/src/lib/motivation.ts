/** Clés stockées en base (neutres, libellés FR dans l’UI). */

export const MOTIVATION_GOALS = [
  { id: "FRIENDS", label: "Trouver des ami·e·s sincères" },
  { id: "WELLBEING", label: "Prendre soin de moi (bien-être global)" },
  { id: "WEIGHT", label: "Avancer vers un corps où je me sens bien" },
  { id: "SOCIAL", label: "Sociabiliser à mon rythme, sans pression" },
  { id: "PARTNER", label: "Rencontrer quelqu’un, en douceur" },
] as const;

export type MotivationGoalId = (typeof MOTIVATION_GOALS)[number]["id"];

export const ZODIAC_OPTIONS = [
  { id: "SKIP", label: "Je préfère ne pas indiquer" },
  { id: "ARIES", label: "Bélier" },
  { id: "TAURUS", label: "Taureau" },
  { id: "GEMINI", label: "Gémeaux" },
  { id: "CANCER", label: "Cancer" },
  { id: "LEO", label: "Lion" },
  { id: "VIRGO", label: "Vierge" },
  { id: "LIBRA", label: "Balance" },
  { id: "SCORPIO", label: "Scorpion" },
  { id: "SAGITTARIUS", label: "Sagittaire" },
  { id: "CAPRICORN", label: "Capricorne" },
  { id: "AQUARIUS", label: "Verseau" },
  { id: "PISCES", label: "Poissons" },
] as const;

export const PERSONALITY_OPTIONS = [
  { id: "GENTLE", label: "Douce / doux, j’ai besoin de douceur" },
  { id: "ENERGETIC", label: "Énergique, j’aime bouger et m’investir" },
  { id: "THOUGHTFUL", label: "Réfléchi·e, j’aime comprendre avant d’agir" },
  { id: "CREATIVE", label: "Créatif·ve, je m’exprime autrement" },
  { id: "SENSITIVE", label: "Sensible, les émotions comptent beaucoup pour moi" },
  { id: "DETERMINED", label: "Déterminé·e, quand je m’engage je tiens le cap" },
] as const;

export type ZodiacId = (typeof ZODIAC_OPTIONS)[number]["id"];
export type PersonalityId = (typeof PERSONALITY_OPTIONS)[number]["id"];

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function utcMonthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

/** Date UTC du lundi de la semaine courante (identifiant de période hebdo). */
export function weekPeriodKey(d = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = x.getUTCDay() || 7;
  if (dow !== 1) x.setUTCDate(x.getUTCDate() - (dow - 1));
  return x.toISOString().slice(0, 10);
}

const XP_PER_LEVEL = 100;
const MAX_LEVEL = 99;

export function levelFromTotalXp(totalXp: number): { level: number; xpIntoLevel: number; xpForNext: number } {
  const level = Math.min(MAX_LEVEL, 1 + Math.floor(Math.max(0, totalXp) / XP_PER_LEVEL));
  const xpIntoLevel = Math.max(0, totalXp) % XP_PER_LEVEL;
  const xpForNext = level >= MAX_LEVEL ? 0 : XP_PER_LEVEL - xpIntoLevel;
  return { level, xpIntoLevel, xpForNext };
}

const DAILY_CAP = 80;
const KINDNESS_XP = 14;
const PROFILE_FIRST_XP = 28;

export type MotivationRow = {
  zodiacSign: string | null;
  personality: string | null;
  goals: unknown;
  totalXp: number;
  dailyXp: number;
  dailyPeriod: string;
  weeklyXp: number;
  weeklyPeriod: string;
  monthlyXp: number;
  monthlyPeriod: string;
  lastKindnessDay: string | null;
  profileFilledAt: Date | null;
};

export function parseGoalIds(raw: unknown): MotivationGoalId[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(MOTIVATION_GOALS.map((g) => g.id));
  return raw.filter((x): x is MotivationGoalId => typeof x === "string" && allowed.has(x as MotivationGoalId));
}

/** Remet à zéro les compteurs de période si on a changé de jour / semaine / mois. */
export function syncPeriodBuckets(row: MotivationRow, now = new Date()): MotivationRow {
  const day = utcDayKey(now);
  const week = weekPeriodKey(now);
  const month = utcMonthKey(now);
  let next = { ...row };
  if (next.dailyPeriod !== day) {
    next.dailyPeriod = day;
    next.dailyXp = 0;
  }
  if (next.weeklyPeriod !== week) {
    next.weeklyPeriod = week;
    next.weeklyXp = 0;
  }
  if (next.monthlyPeriod !== month) {
    next.monthlyPeriod = month;
    next.monthlyXp = 0;
  }
  return next;
}

export function canKindnessToday(row: MotivationRow, now = new Date()): boolean {
  return row.lastKindnessDay !== utcDayKey(now);
}

export function applyKindnessXp(row: MotivationRow, now = new Date()): MotivationRow | null {
  if (!canKindnessToday(row, now)) return null;
  const synced = syncPeriodBuckets(row, now);
  const add = Math.min(KINDNESS_XP, DAILY_CAP - synced.dailyXp);
  if (add <= 0) return null;
  return {
    ...synced,
    totalXp: synced.totalXp + add,
    dailyXp: synced.dailyXp + add,
    weeklyXp: synced.weeklyXp + add,
    monthlyXp: synced.monthlyXp + add,
    lastKindnessDay: utcDayKey(now),
  };
}

export function profileFirstCompletionXp(row: MotivationRow): number {
  if (row.profileFilledAt) return 0;
  return PROFILE_FIRST_XP;
}

export function buildMotivationMessage(row: MotivationRow): string {
  const goals = parseGoalIds(row.goals);
  const primary = goals[0];
  const z = row.zodiacSign;
  const p = row.personality;

  const goalLines: Partial<Record<MotivationGoalId, string>> = {
    FRIENDS:
      "Tes liens méritent d’être choisis avec soin : chaque petit échange honnête compte plus qu’une foule de conversations vides.",
    WELLBEING:
      "Prendre soin de toi n’est pas égoïste : c’est la base pour avancer sans te raconter d’histoires trop dures.",
    WEIGHT:
      "Ton corps n’a pas besoin de punition, seulement de constance douce. Un pas à la fois, sans honte.",
    SOCIAL:
      "Sociabiliser, c’est aussi le droit de dire non, de faire des pauses, et de choisir les espaces où tu te sens léger·e.",
    PARTNER:
      "L’âme sœur, ce n’est pas une course : c’est une rencontre qui respecte ton rythme, tes fragilités et tes envies.",
  };

  const zodiacHint: Partial<Record<string, string>> = {
    ARIES: "Ton élan est une force : canalise-le vers des actions qui te reposent aussi.",
    TAURUS: "Ta loyauté est précieuse : offre-la à des personnes qui la méritent.",
    GEMINI: "Ta curiosité est un cadeau : écoute aussi ce que ton corps te murmure.",
    CANCER: "Tes émotions sont des boussoles : pas des ennemies à taire.",
    LEO: "Briller, c’est bien ; briller pour toi d’abord, c’est encore mieux.",
    VIRGO: "Le détail compte, mais la bienveillance envers toi compte tout autant.",
    LIBRA: "L’équilibre, c’est aussi dire ce dont tu as besoin, sans attendre la permission.",
    SCORPIO: "Ta profondeur mérite des espaces où tu n’as pas à te réduire.",
    SAGITTARIUS: "L’aventure peut être intérieure : un pas de côté, une vérité douce.",
    CAPRICORN: "Ta persévérance est admirable : ajoute-y des pauses qui ne sont pas des échecs.",
    AQUARIUS: "Être différent·e est une forme de courage : reste accessible à la chaleur humaine.",
    PISCES: "Ta sensibilité n’est pas une faiblesse : c’est une forme d’intelligence.",
  };

  const personalityHint: Partial<Record<string, string>> = {
    GENTLE: "Aujourd’hui, choisis un mot plus tendre pour toi-même qu’hier.",
    ENERGETIC: "Canalise ton énergie : un objectif simple suffit pour une belle victoire.",
    THOUGHTFUL: "Réfléchir, c’est bien ; agir un tout petit peu, c’est déjà avancer.",
    CREATIVE: "Exprime-toi comme tu peux : dessin, écriture, musique — tout chemin est bon.",
    SENSITIVE: "Ce que tu ressens est valide ; entoure-toi de personnes qui ne le minimisent pas.",
    DETERMINED: "Ton cap est clair : découpe-le en micro-étapes pour éviter l’épuisement.",
  };

  const parts: string[] = [];
  parts.push("Tu es exactement là où tu dois être pour commencer — pas besoin d’être parfait·e.");
  if (primary && goalLines[primary]) parts.push(goalLines[primary]!);
  if (z && z !== "SKIP" && zodiacHint[z]) parts.push(zodiacHint[z]!);
  if (p && personalityHint[p]) parts.push(personalityHint[p]!);
  if (goals.length === 0) {
    parts.push(
      "Quand tu sauras quel objectif te parle le plus, on pourra t’accompagner avec des messages encore plus alignés.",
    );
  }
  return parts.join(" ");
}

/** Objectifs « niveau » période : 0–100 pour barres (échelle douce). */
export function periodLevelPercent(xp: number): number {
  return Math.min(100, Math.round((xp / DAILY_CAP) * 100));
}

const WEEKLY_SOFT_TARGET = 280;
const MONTHLY_SOFT_TARGET = 900;

export function weeklyBarPercent(xp: number): number {
  return Math.min(100, Math.round((xp / WEEKLY_SOFT_TARGET) * 100));
}

export function monthlyBarPercent(xp: number): number {
  return Math.min(100, Math.round((xp / MONTHLY_SOFT_TARGET) * 100));
}

export { DAILY_CAP, KINDNESS_XP, PROFILE_FIRST_XP, XP_PER_LEVEL };
