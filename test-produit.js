const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}

console.log("=== Nettoyage : produits vides retirés ===");
const p=E.blankProfile("T");
p.revenus=[
  {nom:"Robe",prix:15000},
  {nom:"",prix:0},            // vide -> retiré
  {nom:"   ",prix:0},          // vide -> retiré
  {nom:"Sac",prix:0},          // a un nom -> gardé
];
E.ensureProfile(p);
ok(p.revenus.length===2,"produits vides retirés (reste 2: Robe, Sac) -> "+p.revenus.length);
ok(p.revenus.some(r=>r.nom==="Robe")&&p.revenus.some(r=>r.nom==="Sac"),"bons produits conservés");

console.log("=== Dédoublonnage par nom ===");
const p2=E.blankProfile("T2");
p2.revenus=[
  {nom:"Poulet",prix:2000},
  {nom:"poulet",prix:2500},     // doublon (casse) -> retiré
  {nom:"Poulet ",prix:3000},    // doublon (espace) -> retiré
  {nom:"Frites",prix:1000},
];
E.ensureProfile(p2);
ok(p2.revenus.length===2,"doublons fusionnés (reste 2) -> "+p2.revenus.length);
ok(p2.revenus[0].nom==="Poulet"&&p2.revenus[0].prix===2000,"première occurrence conservée");

console.log("=== Presets restent valides ===");
const pr=E.presetProfile("maquis");
E.ensureProfile(pr);
ok(pr.revenus.length>0,"un preset garde ses produits");
const names=pr.revenus.map(r=>E.normalize(r.nom).trim());
ok(new Set(names).size===names.length,"un preset n'a pas de doublons");

console.log("\n=========================================");
console.log(`PRODUIT/NETTOYAGE : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
