const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
function near(a,b,m){ok(Math.abs(a-b)<1,m+" (att ~"+b+", reçu "+a+")");}

const p=E.blankProfile("Tréso");
p.tresorerie={soldes:{especes:10000,banque:200000,mobile:5000}};
p.caisse=[
  {ts:1,type:"vente",montant:15000,canal:"especes"},
  {ts:2,type:"depense",montant:4000,canal:"especes"},
  {ts:3,type:"vente",montant:80000,canal:"banque"},
  {ts:4,type:"depense",montant:50000,canal:"banque"},
  {ts:5,type:"vente",montant:3000,canal:"mobile"},
  {ts:6,type:"vente",montant:2000}, // sans canal -> especes
];

console.log("=== Soldes de trésorerie ===");
const b=E.treasuryBalances(p);
near(b.especes,10000+15000-4000+2000,"solde espèces (10000+15000-4000+2000=23000)");
near(b.banque,200000+80000-50000,"solde banque (200000+80000-50000=230000)");
near(b.mobile,5000+3000,"solde mobile money (8000)");
near(b.total,23000+230000+8000,"trésorerie totale");

console.log("=== Comptes de trésorerie définis ===");
ok(E.TREASURY_ACCOUNTS.length===3,"3 comptes: espèces, banque, mobile");

console.log("=== Mouvements d'un compte ===");
ok(E.accountMovements(p,"banque").length===2,"2 mouvements banque");
ok(E.accountMovements(p,"especes").length===3,"3 mouvements espèces (dont sans canal)");

console.log("=== Rapprochement bancaire ===");
// solde théorique banque = 230000
let r=E.reconcile(p,230000,[]);
near(r.recorded,230000,"solde comptable banque");
ok(!r.rapproche,"non rapproché tant qu'on n'a rien pointé (pointé=solde initial)");
// on pointe les 2 mouvements banque -> pointé = 230000 = relevé
const banque=E.accountMovements(p,"banque").map(E.movKey);
r=E.reconcile(p,230000,banque);
near(r.pointed,230000,"solde pointé après pointage des 2 mouvements");
near(r.ecart,0,"écart nul -> rapproché");
ok(r.rapproche,"comptes rapprochés");
// relevé différent -> écart
r=E.reconcile(p,235000,banque);
near(r.ecart,5000,"écart de 5000 si le relevé diffère");
ok(!r.rapproche,"non rapproché si écart");

console.log("=== Profil enrichi (identité + trésorerie) ===");
const np=E.blankProfile("X");
ok(np.identite && typeof np.identite.rccm==="string","identité présente (RCCM…)");
ok(np.tresorerie && np.tresorerie.soldes,"trésorerie présente");
const old={id:"o",name:"v",metier:"maquis",revenus:[]}; E.ensureProfile(old);
ok(old.identite && old.tresorerie,"migration ajoute identité + trésorerie");

console.log("\n=========================================");
console.log(`TRÉSORERIE/RAPPROCHEMENT : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
