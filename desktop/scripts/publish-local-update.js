/**
 * Build NSIS + laisse les artefacts dans desktop/release/
 * pour les mises à jour auto locales (latest.yml + installateur).
 *
 * Usage:
 *   node scripts/publish-local-update.js
 *   node scripts/publish-local-update.js --bump patch
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkgPath = path.join(root, "package.json");
const args = process.argv.slice(2);
const bumpIdx = args.indexOf("--bump");
const bump = bumpIdx >= 0 ? args[bumpIdx + 1] || "patch" : null;

function bumpVersion(ver, kind) {
  const parts = String(ver)
    .split(".")
    .map((n) => Number(n) || 0);
  while (parts.length < 3) parts.push(0);
  if (kind === "major") {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (kind === "minor") {
    parts[1] += 1;
    parts[2] = 0;
  } else {
    parts[2] += 1;
  }
  return parts.join(".");
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (bump) {
  const next = bumpVersion(pkg.version, bump);
  console.log(`Version ${pkg.version} → ${next}`);
  pkg.version = next;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

console.log(`Build AnimeBeat Live Hub v${pkg.version}…`);
const r = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["electron-builder", "--win", "nsis", "--publish", "never"],
  { cwd: root, stdio: "inherit", shell: true },
);
if (r.status !== 0) {
  process.exit(r.status || 1);
}

const releaseDir = path.join(root, "release");
const yml = path.join(releaseDir, "latest.yml");
if (!fs.existsSync(yml)) {
  console.error("latest.yml manquant dans release/ — vérifie electron-builder");
  process.exit(1);
}
console.log("");
console.log("OK — mise à jour locale prête:");
console.log(`  ${releaseDir}`);
console.log(`  latest.yml → v${pkg.version}`);
console.log("L’app installée la détectera au prochain check (ou au lancement).");
console.log("Mode DEV: lance l’installeur .exe dans release/ pour basculer en version installée.");
