const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
function near(a,b,m){ok(Math.abs(a-b)<1,m+" (att ~"+b+", reçu "+a+")");}

console.log("=== Modèle commande ===");
const o=E.blankOrder();
o.clientNom="Awa"; o.items=[{nom:"Robe",prix:15000,qty:2},{nom:"Foulard",prix:3000,qty:1}];
near(E.orderTotal(o),33000,"total = somme items (2×15000 + 3000)");
const o2=E.blankOrder(); o2.total=5000;
near(E.orderTotal(o2),5000,"total libre si pas d'items");

console.log("=== Cycle de statut ===");
ok(E.nextOrderStatus("nouvelle")==="confirmee","nouvelle -> confirmée");
ok(E.nextOrderStatus("en_route")==="livree","en livraison -> livrée");
ok(E.nextOrderStatus("livree")==="payee","livrée -> payée");
ok(E.nextOrderStatus("payee")===null,"payée = fin de cycle");
ok(E.orderStatusLabel("en_route")==="En livraison","libellé statut");

console.log("=== Planning par jour ===");
const today=E.todayISO(Date.now());
const cmds=[
  {...E.blankOrder(),dateLivraison:today,statut:"confirmee",paiement:"livraison",items:[{nom:"A",prix:10000,qty:1}]},
  {...E.blankOrder(),dateLivraison:today,statut:"nouvelle",paiement:"livraison",items:[{nom:"B",prix:5000,qty:1}]},
  {...E.blankOrder(),dateLivraison:today,statut:"annulee",items:[{nom:"C",prix:9999,qty:1}]},
  {...E.blankOrder(),dateLivraison:"2020-01-01",statut:"payee"},
];
ok(E.deliveriesForDay(cmds,today).length===2,"livraisons du jour = 2 (annulée exclue)");

console.log("=== Statistiques ===");
const st=E.orderStats(cmds,Date.now());
ok(st.todayCount===2,"2 à livrer aujourd'hui");
near(st.codToday,15000,"montant à encaisser à la livraison aujourd'hui (10000+5000)");
ok(st.enCours>=2,"commandes en cours comptées");

console.log("=== Satisfaction ===");
const cmds2=[
  {...E.blankOrder(),satisfaction:{note:5}},
  {...E.blankOrder(),satisfaction:{note:3}},
  {...E.blankOrder(),satisfaction:null},
];
const st2=E.orderStats(cmds2,Date.now());
near(st2.satisfactionAvg,4,"satisfaction moyenne = 4 (5 et 3)");
ok(st2.satisfactionCount===2,"2 avis comptés");

console.log("=== Messages WhatsApp ===");
const conf=E.orderConfirmText(o,"Chez Awa");
ok(conf.includes("Robe")&&conf.replace(/\s/g,"").includes("33000")&&conf.includes("confirmer"),"message de confirmation complet");
const way=E.deliveryOnWayText({...o,paiement:"livraison"});
ok(way.includes("route")&&way.replace(/\s/g,"").includes("33000"),"message en livraison + montant COD");
const sat=E.satisfactionRequestText(o,"Chez Awa");
ok(sat.includes("1 à 5")||sat.includes("satisfaction"),"message demande d'avis");

console.log("=== Profil enrichi ===");
const np=E.blankProfile("X"); ok(Array.isArray(np.commandes),"nouveau profil a commandes[]");
const old={id:"o",name:"v",metier:"maquis",revenus:[]}; E.ensureProfile(old);
ok(Array.isArray(old.commandes),"migration ajoute commandes[]");

console.log("\n=========================================");
console.log(`COMMANDES : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
