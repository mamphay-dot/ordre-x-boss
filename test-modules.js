const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
function near(a,b,m){ok(Math.abs(a-b)<1,m+" (att ~"+b+", reçu "+a+")");}

const NOW=new Date("2026-06-15T12:00:00").getTime();
const yesterday=NOW-24*3600*1000;
const lastMonth=new Date("2026-05-20T12:00:00").getTime();

console.log("=== Caisse ===");
const p=E.blankProfile("Caisse test");
p.caisse=[
  {ts:NOW,type:"vente",montant:5000,label:"Poulet"},
  {ts:NOW,type:"vente",montant:3000,label:"Boisson"},
  {ts:NOW,type:"depense",montant:2000,label:"Charbon"},
  {ts:yesterday,type:"vente",montant:4000,label:"Hier"},
  {ts:lastMonth,type:"vente",montant:9999,label:"Mois dernier"}
];
const t=E.caisseTotals(p,NOW);
near(t.ventesJour,8000,"ventes du jour (5000+3000)");
near(t.depensesJour,2000,"dépenses du jour");
near(t.ventesMois,12000,"ventes du mois (8000 jour + 4000 hier, hors mois dernier)");
near(t.depensesMois,2000,"dépenses du mois");
near(t.netMois,10000,"net du mois");
ok(t.nb===5,"compte toutes les entrées");

console.log("=== Carnet (dettes) ===");
p.carnet=[
  {client:"Awa",montant:12000,motif:"Tissu",paye:false,phone:"0700000000",ts:NOW},
  {client:"Koffi",montant:5000,motif:"",paye:true,ts:NOW},
  {client:"Fatou",montant:8000,motif:"Avance",paye:false,ts:NOW}
];
const ct=E.carnetTotals(p);
near(ct.impaye,20000,"total impayé (12000+8000)");
ok(ct.nb===2,"2 dettes impayées");
ok(ct.total===3,"3 entrées au total");
const msg=E.debtReminderText(p.carnet[0],"Maquis Awa");
ok(msg.includes("Awa")&&msg.includes("Maquis Awa"),"message de relance personnalisé");
ok(msg.includes(E.fmtF(12000)),"relance contient le montant");

console.log("=== Sauvegarde / restauration ===");
const state={profiles:{},currentId:"x"};
const a=E.presetProfile("maquis","A"); state.profiles[a.id]=a; state.currentId=a.id;
const backup=E.serializeBackup(state);
ok(backup.includes("BOSS")&&backup.includes("exportedAt"),"backup sérialisé avec métadonnées");
const restored=E.parseBackup(backup);
ok(restored.profiles[a.id].name==="A","restauration: profil retrouvé");
ok(restored.currentId===a.id,"restauration: profil courant conservé");
let threw=false; try{E.parseBackup('{"bidon":1}');}catch(e){threw=true;}
ok(threw,"backup invalide rejeté");
let threw2=false; try{E.parseBackup("pas du json");}catch(e){threw2=true;}
ok(threw2,"texte non-JSON rejeté");

console.log("=== Migration ensureProfile ===");
const old={id:"o",name:"Vieux",metier:"maquis",revenus:[{nom:"X",prix:1000,qte:10,cout:500}]};
E.ensureProfile(old);
ok(Array.isArray(old.caisse)&&Array.isArray(old.carnet),"ajoute caisse/carnet manquants");
ok(old.target===30,"ajoute marge par défaut");
ok(old.unite,"ajoute unité");
const empty=E.ensureProfile({id:"e",name:"E",revenus:null,charges:undefined});
ok(Array.isArray(empty.revenus)&&Array.isArray(empty.charges),"répare tableaux corrompus");
ok(empty.metier==="vendeur","métier par défaut si absent");
// le moteur financier marche sur un profil migré
const f=E.computeFinancials(old);
ok(isFinite(f.net),"calcul OK après migration");

console.log("\n=========================================");
console.log(`CAISSE/CARNET/SAUVEGARDE : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
