// BOSS — lance toute la batterie de tests (moteur + intégration).
const { execSync } = require("child_process");
const fs = require("fs");

const files = fs
  .readdirSync(".")
  .filter((f) => /^(test.*|stress|integ.*)\.js$/.test(f))
  .sort();

let failed = 0;
for (const f of files) {
  try {
    execSync("node " + f, { stdio: "inherit" });
  } catch (e) {
    failed++;
    console.error("ÉCHEC :", f);
  }
}
console.log(
  "\n=== " + files.length + " fichiers de test · " + failed + " échec(s) ==="
);
process.exit(failed ? 1 : 0);
