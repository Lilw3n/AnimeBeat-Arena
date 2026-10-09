export type OstCatalogRow = {
  slug: string;
  title: string;
  /** Série ou film d’origine (affichage). */
  series?: string;
  sortOrder: number;
};

export const OST_CATALOG: OstCatalogRow[] = [
  { slug: "you-say-run", title: "You Say Run", series: "My Hero Academia", sortOrder: 0 },
  { slug: "unravel", title: "Unravel", series: "Tokyo Ghoul", sortOrder: 1 },
  { slug: "guren-no-yumiya", title: "Guren no Yumiya", series: "L’Attaque des titans", sortOrder: 2 },
  { slug: "blue-bird", title: "Blue Bird", series: "Naruto Shippuden", sortOrder: 3 },
  { slug: "departure", title: "Departure!", series: "Hunter × Hunter", sortOrder: 4 },
  { slug: "the-world", title: "The World", series: "Death Note", sortOrder: 5 },
  { slug: "kaikai-kitan", title: "Kaikai Kitan", series: "Jujutsu Kaisen", sortOrder: 6 },
  { slug: "inferno", title: "Inferno", series: "Fire Force", sortOrder: 7 },
  { slug: "colors", title: "Colors", series: "Code Geass", sortOrder: 8 },
  { slug: "again", title: "Again", series: "Fullmetal Alchemist: Brotherhood", sortOrder: 9 },
  { slug: "we-go", title: "We Go!", series: "One Piece", sortOrder: 10 },
  { slug: "cha-la-head-cha-la", title: "Cha-La Head-Cha-La", series: "Dragon Ball Z", sortOrder: 11 },
  { slug: "aot-ashesonme", title: "Ashes on The Fire (OST)", series: "L’Attaque des titans", sortOrder: 12 },
  { slug: "never-meant-to-belong", title: "Never Meant to Belong", series: "Bleach", sortOrder: 13 },
  { slug: "vogel-im-kafig", title: "Vogel im Käfig", series: "L’Attaque des titans", sortOrder: 14 },
  { slug: "my-war", title: "My War", series: "L’Attaque des titans", sortOrder: 15 },
  { slug: "red", title: "RED", series: "Chainsaw Man", sortOrder: 16 },
  { slug: "kick-back", title: "KICK BACK", series: "Chainsaw Man", sortOrder: 17 },
  { slug: "idol", title: "Idol", series: "Oshi no Ko", sortOrder: 18 },
  { slug: "peace-sign", title: "Peace Sign", series: "My Hero Academia", sortOrder: 19 },
];
