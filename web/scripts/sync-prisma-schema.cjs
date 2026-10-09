/**
 * Prisma n’accepte qu’un seul `provider` par génération.
 * - Local (DATABASE_URL=file:...) → schema SQLite + better-sqlite3
 * - Vercel (VERCEL=1) ou DATABASE_URL postgresql:// → schema PostgreSQL + adapter pg
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

try {
  require("dotenv").config({ path: path.join(root, ".env") });
} catch {
  /* dotenv optionnel au premier install */
}

const url = (process.env.DATABASE_URL || "").trim();
const onVercel = process.env.VERCEL === "1";
const usePostgres = onVercel || /^postgres(ql)?:\/\//i.test(url);

const srcName = usePostgres ? "schema.postgresql.prisma" : "schema.sqlite.prisma";
const src = path.join(root, "prisma", srcName);
const dest = path.join(root, "prisma", "schema.prisma");

if (!fs.existsSync(src)) {
  console.error("[prisma] Fichier manquant:", src);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log("[prisma] schema.prisma ←", srcName, usePostgres ? "(PostgreSQL)" : "(SQLite)");
