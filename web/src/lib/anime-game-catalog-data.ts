export type AnimeGameCatalogRow = {
  slug: string;
  title: string;
  series?: string;
  sortOrder: number;
};

export const ANIME_GAME_CATALOG: AnimeGameCatalogRow[] = [
  { slug: "dokkan-battle", title: "Dragon Ball Z: Dokkan Battle", series: "Dragon Ball", sortOrder: 0 },
  { slug: "dragon-ball-legends", title: "Dragon Ball Legends", series: "Dragon Ball", sortOrder: 1 },
  { slug: "dragon-ball-fighterz", title: "Dragon Ball FighterZ", series: "Dragon Ball", sortOrder: 2 },
  { slug: "naruto-storm-4", title: "Naruto Shippuden: Ultimate Ninja Storm 4", series: "Naruto", sortOrder: 3 },
  { slug: "naruto-x-boruto-connections", title: "NARUTO X BORUTO Ultimate Ninja STORM CONNECTIONS", series: "Naruto", sortOrder: 4 },
  { slug: "one-piece-odyssey", title: "One Piece Odyssey", series: "One Piece", sortOrder: 5 },
  { slug: "one-piece-pirate-warriors-4", title: "One Piece: Pirate Warriors 4", series: "One Piece", sortOrder: 6 },
  { slug: "hinokami-chronicles", title: "Demon Slayer: Kimetsu no Yaiba – The Hinokami Chronicles", series: "Demon Slayer", sortOrder: 7 },
  { slug: "mha-ones-justice-2", title: "My Hero One’s Justice 2", series: "My Hero Academia", sortOrder: 8 },
  { slug: "jjk-cursed-clash", title: "Jujutsu Kaisen: Cursed Clash", series: "Jujutsu Kaisen", sortOrder: 9 },
  { slug: "aot-2-final-battle", title: "A.O.T. 2: Final Battle", series: "L’Attaque des titans", sortOrder: 10 },
  { slug: "jump-force", title: "Jump Force", series: "Shōnen Jump (crossover)", sortOrder: 11 },
  { slug: "bleach-brave-souls", title: "Bleach: Brave Souls", series: "Bleach", sortOrder: 12 },
  { slug: "genshin-impact", title: "Genshin Impact", series: "Style anime / gacha", sortOrder: 13 },
  { slug: "honkai-star-rail", title: "Honkai: Star Rail", series: "Style anime / gacha", sortOrder: 14 },
  { slug: "zenless-zone-zero", title: "Zenless Zone Zero", series: "Style anime / action", sortOrder: 15 },
  { slug: "persona-5-royal", title: "Persona 5 Royal", series: "JRPG anime", sortOrder: 16 },
  { slug: "nier-automata", title: "NieR: Automata", series: "Action / esthétique anime", sortOrder: 17 },
];
