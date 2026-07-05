const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
function near(a,b,m){ok(Math.abs(a-b)<1,m+" (att ~"+b+", reçu "+a+")");}

console.log("=== Types & modes de règlement ===");
ok(E.PIECE_TYPES.length>=8,"types de pièces définis");
ok(E.PAYMENT_CHANNELS.some(c=>c.k==="banque")&&E.PAYMENT_CHANNELS.some(c=>c.k==="especes"),"modes de règlement banque/espèces");
ok(E.pieceTypeLabel("achat")==="Facture d'achat","libellé type");
ok(E.channelLabel("mobile")==="Mobile Money","libellé mode de règlement");

console.log("=== Clés de période ===");
ok(E.periodKey("2026-07-07","jour")==="2026-07-07","clé jour");
ok(E.periodKey("2026-07-07","mois")==="2026-07","clé mois");
ok(E.periodKey("2026-07-07","trimestre")==="2026-T3","clé trimestre");
ok(E.periodKey("2026-02-15","trimestre")==="2026-T1","trimestre T1");
ok(E.periodKey("2026-07-07","annee")==="2026","clé année");
ok(/^2026-S\d\d$/.test(E.periodKey("2026-07-07","semaine")),"clé semaine ISO");

console.log("=== Regroupement + totaux ===");
const pieces=[
  {id:"a",type:"achat",canal:"especes",montant:45000,date:"2026-07-02"},
  {id:"b",type:"vente",canal:"banque",montant:80000,date:"2026-07-20"},
  {id:"c",type:"quittance",canal:"banque",montant:50000,date:"2026-06-05"},
  {id:"d",type:"frais",canal:"mobile",montant:5000,date:"2026-07-25"},
];
const gm=E.groupPieces(pieces,"mois");
ok(gm.length===2,"2 groupes mensuels");
const juil=gm.find(g=>g.key==="2026-07");
near(juil.total,130000,"total juillet (45000+80000+5000)");
near(juil.recettes,80000,"recettes juillet (facture de vente)");
near(juil.depenses,50000,"dépenses juillet (achat+frais)");
ok(gm[0].key==="2026-07","tri décroissant par période");

console.log("=== Filtres (type, mode, période) ===");
ok(E.filterPieces(pieces,{type:"achat"}).length===1,"filtre par type");
ok(E.filterPieces(pieces,{canal:"banque"}).length===2,"filtre par mode de règlement");
ok(E.filterPieces(pieces,{from:"2026-07-01",to:"2026-07-31"}).length===3,"filtre par période (juillet)");
ok(E.filterPieces(pieces,{type:"tous",canal:"tous"}).length===4,"filtre 'tous' = tout");

console.log("=== Statistiques ===");
const st=E.pieceStats(pieces);
ok(st.count===4,"nombre de pièces");
near(st.byCanal.banque,130000,"total banque (80000+50000)");
near(st.byType.achat,45000,"total achats");

console.log("=== Exemples par métier ===");
const ex=E.pieceExamples("maquis");
ok(ex.length>=3 && ex[0].tiers.includes("boissons"),"exemples adaptés au maquis");
ok(E.pieceExamples("inconnu").length>=3,"exemples génériques si métier inconnu");

console.log("=== Profil enrichi ===");
const np=E.blankProfile("X"); ok(Array.isArray(np.pieces),"nouveau profil a pieces[]");
const old={id:"o",name:"v",metier:"maquis",revenus:[]}; E.ensureProfile(old);
ok(Array.isArray(old.pieces),"migration ajoute pieces[]");

console.log("\n=========================================");
console.log(`PIÈCES COMPTABLES : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
