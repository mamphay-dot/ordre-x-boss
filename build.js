// BOSS — build : assemble engine.js + bossnet.js + ui.js dans shell.html
// Génère : dist/boss-app.html (fichier unique), pwa/index.html (dev),
// et docs/ (dossier PUBLIC et SÛR pour GitHub Pages, sans clé privée ni générateur admin).
const fs = require("fs");
const path = require("path");

const shell   = fs.readFileSync("shell.html", "utf8");
const engine  = fs.readFileSync("engine.js",  "utf8");
const bossnet = fs.readFileSync("bossnet.js", "utf8");
const ui      = fs.readFileSync("ui.js",      "utf8");

/* ---------- injection de la configuration Supabase ----------
   Priorité :
   1) variables d'environnement (SUPABASE_URL, SUPABASE_ANON_KEY)
   2) fichier .env.local (non commité)
   3) sinon : bloc vide → l'app tourne en 100 % local (offline).
------------------------------------------------------------- */
function readDotenv() {
  const p = ".env.local";
  if (!fs.existsSync(p)) return {};
  const out = {};
  fs.readFileSync(p, "utf8").split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) return;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    out[m[1]] = v;
  });
  return out;
}
const env = Object.assign({}, readDotenv(), process.env);
const SB_URL = env.SUPABASE_URL || "";
const SB_KEY = env.SUPABASE_ANON_KEY || "";
const configScript =
  "window.__BOSS_SUPABASE__ = window.__BOSS_SUPABASE__ || { url: " + JSON.stringify(SB_URL) +
  ", anonKey: " + JSON.stringify(SB_KEY) + " };";

const html = shell
  .replace("/*__SUPABASE_CONFIG__*/", () => configScript)
  .replace("/*__BOSSNET__*/",         () => bossnet)
  .replace("/*__ENGINE__*/",          () => engine)
  .replace("/*__UI__*/",              () => ui);

// 1) Fichier unique (partage / test hors-ligne)
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/boss-app.html", html);

// 2) Version PWA de dev
fs.writeFileSync("pwa/index.html", html);

// 3) Dossier PUBLIC pour GitHub Pages (uniquement les fichiers sûrs)
const SAFE = [
  "sw.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  ".htaccess",
  "CNAME",
];
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/index.html", html);
for (const f of SAFE) {
  const src = path.join("pwa", f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join("docs", f));
}

console.log("Build OK :", (html.length / 1024).toFixed(1) + " Ko");
console.log("→ dist/boss-app.html (fichier unique)");
console.log("→ docs/ (à publier sur GitHub Pages : Settings → Pages → main /docs)");
