#!/usr/bin/env node
/**
 * Re-applique le patch Instagram Live SSN (messages live) sur l'app installée.
 * Usage: node desktop/stream/patches/apply-ssn-instagram-patch.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const src = path.join(__dirname, "ssn-instagram.js");
const destDir = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"),
  "Programs/socialstream/resources/app.asar.unpacked/resources/social_stream_fallback/main/sources"
);
for (const name of ["instagram.js", "instagramlive.js"]) {
  const dest = path.join(destDir, name);
  if (!fs.existsSync(path.dirname(dest))) {
    console.error("SSN introuvable:", destDir);
    process.exit(1);
  }
  const bak = dest + ".bak-pre-animebeat";
  if (fs.existsSync(dest) && !fs.existsSync(bak)) fs.copyFileSync(dest, bak);
  fs.copyFileSync(src, dest);
  console.log("Patched", dest);
}
console.log("OK — redémarre Social Stream Ninja.");
