const E = require("./engine.js");
let pass=0, fail=0;
function ok(cond,msg){ if(cond){pass++;} else {fail++; console.log("  ❌ FAIL:",msg);} }
function eq(a,b,msg){ ok(a===b, `${msg} (attendu ${b}, reçu ${a})`); }
function near(a,b,msg){ ok(Math.abs(a-b)<1, `${msg} (attendu ~${b}, reçu ${a})`); }

console.log("=== 1. Détection du métier ===");
eq(E.detectMetier("je vends du poulet braisé et des boissons"),"maquis","maquis");
eq(E.detectMetier("je répare des motos au garage, vidange"),"mecanicien","mécanicien");
eq(E.detectMetier("je couds des tenues sur mesure"),"couturier","couturier");
eq(E.detectMetier("j'ai un hôtel avec des chambres"),"hotel","hôtel");
eq(E.detectMetier("je donne des cours aux élèves"),"enseignant","enseignant");
eq(E.detectMetier("j'élève des poulets, volaille"),"eleveur","éleveur");
eq(E.detectMetier("je transforme le manioc en attiéké et je conditionne"),"transformateur","transformateur");
eq(E.detectMetier("je cultive des tomates dans mon champ"),"producteur","producteur");
eq(E.detectMetier("j'ai une boutique, je vends des cosmétiques"),"vendeur","vendeur");
eq(E.detectMetier("usine de fabrication de jus, ligne de production"),"industrie","industrie");
eq(E.detectMetier("blablabla rien"),null,"aucun match -> null");

console.log("=== 2. Extraction des montants ===");
function arrEq(a,b,msg){ ok(JSON.stringify(a)===JSON.stringify(b), `${msg} (reçu ${JSON.stringify(a)})`); }
arrEq(E.parseAmounts("3000 la part"),[3000],"simple");
arrEq(E.parseAmounts("3000, ça coûte 1500"),[3000,1500],"deux nombres");
arrEq(E.parseAmounts("150 000 par mois"),[150000],"espace milliers");
arrEq(E.parseAmounts("150.000 fcfa"),[150000],"point milliers");
arrEq(E.parseAmounts("3k la part"),[3000],"k");
arrEq(E.parseAmounts("150k de loyer"),[150000],"150k");
arrEq(E.parseAmounts("rien du tout"),[],"aucun nombre");

console.log("=== 3. Moteur financier — maquis profitable ===");
const maquis = E.presetProfile("maquis");
let f = E.computeFinancials(maquis);
// CA = 3000*300 + 2000*250 + 1000*800 = 900000+500000+800000 = 2 200 000
near(f.ca,2200000,"CA maquis");
// coûts = 1500*300 + 900*250 + 600*800 = 450000+225000+480000 = 1 155 000
near(f.coutsDirects,1155000,"coûts directs");
near(f.margeBrute,1045000,"marge brute");
// charges = 150000+250000+60000+40000 = 500 000
near(f.cf,500000,"charges fixes");
near(f.net,545000,"résultat net");
ok(f.tauxMB>0.47 && f.tauxMB<0.48,"taux marge brute ~47.5%");
// seuil = cf / tauxMB = 500000 / 0.475 = ~1 052 631
ok(Math.abs(f.seuilCA-1052631)<2,"seuil de rentabilité");

console.log("=== 4. Scénario perte (charges trop lourdes) ===");
const perte = E.blankProfile("test");
perte.revenus=[{nom:"X",prix:1000,qte:100,cout:600}]; // CA 100000, marge brute 40000
perte.charges=[{nom:"Loyer",montant:100000}]; // net = 40000-100000 = -60000
f=E.computeFinancials(perte);
near(f.net,-60000,"net négatif");
ok(f.net<0,"perte détectée");
const ci=E.coachInsights(perte);
ok(ci.items.some(i=>i.ic==="🔴"),"coach signale la perte");

console.log("=== 5. Scénario vente à perte (prix < coût) ===");
const aperte=E.blankProfile("t");
aperte.revenus=[{nom:"Bon",prix:5000,qte:50,cout:2000},{nom:"Mauvais",prix:1000,qte:50,cout:1500}];
const ci2=E.coachInsights(aperte);
ok(ci2.items.some(i=>/à perte/.test(i.txt)),"coach détecte produit vendu à perte");

console.log("=== 6. Zéro vente (division par zéro) ===");
const vide=E.blankProfile("vide");
f=E.computeFinancials(vide);
eq(f.ca,0,"CA zéro");
eq(f.seuilCA,0,"seuil zéro sans crash");
ok(isFinite(f.tauxMB),"taux fini");
const ci3=E.coachInsights(vide);
ok(ci3.items.length>0,"coach répond même à vide");

console.log("=== 7. Prix conseillé (cohérence) ===");
const pp=E.blankProfile("p");
pp.revenus=[{nom:"A",prix:3000,qte:100,cout:1000}];
pp.charges=[{nom:"L",montant:50000}];
pp.target=40;
f=E.computeFinancials(pp);
// partCharge = 50000/100 = 500 ; coutComplet = 1000+500 = 1500 ; prix conseillé = 1500/(1-0.4)=2500
near(f.prices[0].coutComplet,1500,"coût complet");
near(f.prices[0].prixConseille,2500,"prix conseillé à 40%");

console.log("=== 8. Conversation complète d'auto-configuration ===");
let conv=E.startConversation();
let prof=E.blankProfile("Auto");
function turn(text){
  const r=E.conversationStep(conv,text,prof);
  E.applyPatch(prof,r.patch);
  return r;
}
let r;
r=turn("je vends du poulet braisé"); 
eq(prof.metier,"maquis","conv: métier configuré");
ok(r.events.some(e=>/Maquis/.test(e)),"conv: event métier");
r=turn("3000 la part, ça me coûte 1500");
eq(prof.revenus.length,1,"conv: 1 produit ajouté");
eq(prof.revenus[0].prix,3000,"conv: prix ok");
eq(prof.revenus[0].cout,1500,"conv: coût ok");
r=turn("j'en vends 300 par mois");
eq(prof.revenus[0].qte,300,"conv: quantité ok");
r=turn("oui");
ok(/prix/.test(r.bot.toLowerCase())||/coût/.test(r.bot.toLowerCase()),"conv: redemande un produit");
r=turn("les boissons à 1000 ça coûte 600");
eq(prof.revenus.length,2,"conv: 2e produit ajouté");
r=turn("800");
eq(prof.revenus[1].qte,800,"conv: quantité 2e produit");
r=turn("non");
ok(/loyer/i.test(r.bot),"conv: passe aux charges");
r=turn("150000");
ok(prof.charges.some(c=>c.nom==="Loyer"&&c.montant===150000),"conv: loyer enregistré");
r=turn("salaires 250000 et électricité 60000");
ok(prof.charges.length>=3,"conv: charges multiples");
ok(r.done,"conv: terminée");
const fc=E.computeFinancials(prof);
ok(fc.ca>0 && fc.seuilCA>0,"conv: business calculable à la fin");
console.log("   -> business auto-configuré: CA="+E.fmtF(fc.ca)+", net="+E.fmtF(fc.net)+", seuil="+E.fmtF(fc.seuilCA));

console.log("=== 9. Conversation: métier non reconnu -> fallback ===");
let conv2=E.startConversation(); let prof2=E.blankProfile("X");
let rr=E.conversationStep(conv2,"euh je sais pas",prof2); E.applyPatch(prof2,rr.patch);
ok(conv2.tries===1,"1re tentative ratée");
rr=E.conversationStep(conv2,"toujours pas clair",prof2); E.applyPatch(prof2,rr.patch);
eq(prof2.metier,"vendeur","fallback vendeur après 2 essais");

console.log("=== 10. Multi-profils simultanés ===");
const profiles={};
const a=E.presetProfile("maquis","Maquis Tantie Awa");
const b=E.presetProfile("mecanicien","Garage Koffi");
const c=E.presetProfile("couturier","Atelier Fatou");
[a,b,c].forEach(p=>profiles[p.id]=p);
eq(Object.keys(profiles).length,3,"3 profils créés");
ok(a.id!==b.id && b.id!==c.id,"ids uniques");
// modifier un profil ne touche pas les autres
profiles[a.id].revenus[0].prix=9999;
ok(profiles[b.id].revenus[0].prix!==9999,"isolation des profils");
const fa=E.computeFinancials(a), fb=E.computeFinancials(b);
ok(fa.ca!==fb.ca,"calculs indépendants par profil");

console.log("\n=========================================");
console.log(`RÉSULTAT : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
