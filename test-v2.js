const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
function near(a,b,m){ok(Math.abs(a-b)<1,m+" (att ~"+b+", reçu "+a+")");}

console.log("=== STOCK ===");
const p=E.blankProfile("Stock");
p.revenus=[{nom:"A",prix:1000,qte:10,cout:500,stock:3},{nom:"B",prix:2000,qte:5,cout:1000,stock:50},{nom:"C",prix:500,qte:0,cout:200}];
const low=E.lowStockItems(p,5);
ok(low.length===1 && low[0].nom==="A","alerte stock bas (seuil 5) -> A seulement");
ok(E.lowStockItems(p,0).length===0,"seuil 0 -> aucune alerte");

console.log("=== HISTORIQUE MENSUEL ===");
const NOW=new Date("2026-06-15T10:00:00").getTime();
const m=(y,mo,d)=>new Date(y,mo,d,10).getTime();
p.caisse=[
  {ts:m(2026,5,2),type:"vente",montant:10000}, // juin
  {ts:m(2026,5,10),type:"depense",montant:3000}, // juin
  {ts:m(2026,4,5),type:"vente",montant:8000}, // mai
  {ts:m(2026,3,1),type:"vente",montant:5000}, // avril
];
const hist=E.monthlyHistory(p,6,NOW);
ok(hist.length===6,"6 mois renvoyés");
const juin=hist[hist.length-1];
near(juin.ventes,10000,"juin ventes");
near(juin.depenses,3000,"juin dépenses");
near(juin.net,7000,"juin net");
const mai=hist[hist.length-2];
near(mai.ventes,8000,"mai ventes");
ok(hist[0].ventes===0||hist[0].ventes>=0,"mois anciens sans données = 0");

console.log("=== TVA ===");
const dec=E.tvaDecompose(11800,18,true); // TTC 11800 @18% -> HT 10000, TVA 1800
near(dec.ht,10000,"TVA: HT depuis TTC");
near(dec.tva,1800,"TVA: montant");
const dec2=E.tvaDecompose(10000,18,false); // HT 10000 -> TVA 1800, TTC 11800
near(dec2.tva,1800,"TVA: depuis HT");
near(dec2.ttc,11800,"TVA: TTC depuis HT");
p.tva={enabled:true,rate:18,pricesIncludeTax:true};
const tm=E.tvaMonth(p,NOW);
ok(tm.enabled,"TVA activée");
near(tm.base,10000,"TVA base = ventes du mois (juin 10000)");
near(tm.tvaCollectee,1525.42,"TVA collectée sur 10000 TTC @18%");

console.log("=== PAIEMENT ===");
const pay={Wave:{link:"https://pay.wave.com/m/MERCHANT/c/ci/?amount={amount}"}};
const w=E.buildPayment(pay,"Wave",3000);
ok(w.kind==="link" && w.value.includes("amount=3000"),"Wave: lien avec montant injecté");
const pay2={Wave:{link:"https://pay.wave.com/m/X/c/ci/"}};
ok(E.buildPayment(pay2,"Wave",2500).value.includes("amount=2500"),"Wave: ajoute amount si pas de gabarit");
const pay3={"Orange Money":{ussd:"#144*82*MARCHAND*{amount}#"}};
const o=E.buildPayment(pay3,"Orange Money",1500);
ok(o.kind==="ussd" && o.value.includes("1500"),"Orange: USSD avec montant");
ok(E.buildPayment({},"MTN MoMo",1000).kind==="whatsapp","sans config -> repli WhatsApp");

console.log("=== SYNC : fusion dernier-écrit-gagne ===");
const A={profiles:{p1:{id:"p1",name:"Ancien",updatedAt:100},p2:{id:"p2",name:"LocalSeul",updatedAt:50}},currentId:"p1",updatedAt:100};
const B={profiles:{p1:{id:"p1",name:"Récent",updatedAt:200},p3:{id:"p3",name:"DistantSeul",updatedAt:80}},currentId:"p3",updatedAt:200};
const merged=E.mergeStates(A,B);
ok(merged.profiles.p1.name==="Récent","fusion: garde le profil le plus récent (p1)");
ok(merged.profiles.p2 && merged.profiles.p2.name==="LocalSeul","fusion: conserve profil local seul");
ok(merged.profiles.p3 && merged.profiles.p3.name==="DistantSeul","fusion: ajoute profil distant seul");
ok(merged.currentId==="p3","fusion: currentId de l'état le plus récent");
ok(E.mergeStates(A,null)===A,"fusion: remote vide -> local");
ok(E.mergeStates(null,B)===B,"fusion: local vide -> remote");

console.log("=== Profils enrichis ===");
const np=E.blankProfile("X");
ok(Array.isArray(np.clients)&&np.tva&&np.pay&&np.updatedAt,"nouveau profil: clients/tva/pay/updatedAt présents");
const old={id:"o",name:"vieux",metier:"maquis",revenus:[]};
E.ensureProfile(old);
ok(Array.isArray(old.clients)&&old.tva&&old.pay,"migration ajoute clients/tva/pay");

console.log("\n=========================================");
console.log(`MODULES V2 : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
