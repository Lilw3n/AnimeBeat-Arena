/** Données du catalogue anime / persos (synchronisées en base via l’admin). */
export type AnimeCatalogRow = {
  slug: string;
  title: string;
  sortOrder: number;
  characters: string[];
};

export const ANIME_CATALOG: AnimeCatalogRow[] = [
  {
    slug: "dragon-ball-z",
    title: "Dragon Ball Z",
    sortOrder: 0,
    characters: ["Son Goku", "Vegeta", "Son Gohan", "Cell", "Freezer", "Trunks"],
  },
  {
    slug: "naruto",
    title: "Naruto",
    sortOrder: 1,
    characters: ["Naruto Uzumaki", "Sasuke Uchiha", "Sakura Haruno", "Kakashi Hatake", "Itachi Uchiha", "Gaara"],
  },
  {
    slug: "one-piece",
    title: "One Piece",
    sortOrder: 2,
    characters: ["Monkey D. Luffy", "Roronoa Zoro", "Nami", "Sanji", "Nico Robin", "Shanks"],
  },
  {
    slug: "demon-slayer",
    title: "Demon Slayer",
    sortOrder: 3,
    characters: ["Tanjiro Kamado", "Nezuko Kamado", "Zenitsu Agatsuma", "Inosuke Hashibira", "Muzan Kibutsuji"],
  },
  {
    slug: "attack-on-titan",
    title: "L’Attaque des titans",
    sortOrder: 4,
    characters: ["Eren Yeager", "Mikasa Ackerman", "Levi Ackerman", "Armin Arlert", "Erwin Smith"],
  },
  {
    slug: "jujutsu-kaisen",
    title: "Jujutsu Kaisen",
    sortOrder: 5,
    characters: ["Yuji Itadori", "Satoru Gojo", "Megumi Fushiguro", "Nobara Kugisaki", "Sukuna"],
  },
  {
    slug: "my-hero-academia",
    title: "My Hero Academia",
    sortOrder: 6,
    characters: ["Izuku Midoriya", "Katsuki Bakugo", "Shoto Todoroki", "All Might", "Ochaco Uraraka"],
  },
  {
    slug: "tokyo-ghoul",
    title: "Tokyo Ghoul",
    sortOrder: 7,
    characters: ["Ken Kaneki", "Touka Kirishima", "Hide Nagachika", "Shuu Tsukiyama"],
  },
];
