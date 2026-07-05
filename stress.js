const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}

console.log("=== A. 200 profils simultanés, calculs indépendants ===");
const store={};
const metiers=E.METIER_ORDER;
for(let i=0;i<200;i++){
  const met=metiers[i%metiers.length];
  const p=E.presetProfile(met,"Boss "+i);
  // chaque boss ajuste son prix différemment
  if(p.revenus[0]) p.revenus[0].prix += i*10;
  store[p.id]=p;
}
ok(Object.keys(store).length===200,"200 profils créés sans collision d'id");
// vérifier que deux profils du même métier ont des CA différents (pas d'état partagé)
const ids=Object.keys(store);
const sameMetier=ids.filter(id=>store[id].metier==="maquis");
const cas=sameMetier.map(id=>E.computeFinancials(store[id]).ca);
ok(new Set(cas).size>1,"profils même métier => CA distincts (isolation)");
// recalcul global stable
let total=0; ids.forEach(id=>{total+=E.computeFinancials(store[id]).ca;});
ok(total>0 && isFinite(total),"agrégat global calculable");
console.log("   -> CA agrégé des 200 boss : "+E.fmtF(total));

console.log("=== B. 50 conversations entrelacées (simulation multi-connexion) ===");
// On lance 50 conversations en parallèle, en alternant les tours, états séparés
const sessions=[];
const scripts=[
  ["je vends du poulet braisé","3000 et 1500","300","non","150000","250000"],
  ["je répare des motos, vidange","8000 ça coûte 4000","120","non","120000","70000"],
  ["je couds des tenues","35000 coûte 15000","40","non","100000","80000"],
  ["j'élève des poulets volaille","3500 coûte 2200","500","non","100000","120000"],
  ["boutique de cosmétiques","8000 coûte 5000","200","non","80000","100000"]
];
for(let i=0;i<50;i++){
  sessions.push({conv:E.startConversation(),prof:E.blankProfile("S"+i),script:scripts[i%scripts.length],idx:0,done:false});
}
// dérouler en round-robin: un tour de chaque à la fois
let active=50, guard=0;
while(active>0 && guard<20){
  guard++;
  for(const s of sessions){
    if(s.done) continue;
    if(s.idx>=s.script.length){s.done=true;active--;continue;}
    const r=E.conversationStep(s.conv,s.script[s.idx],s.prof);
    E.applyPatch(s.prof,r.patch);
    s.idx++;
    if(r.done){s.done=true;active--;}
  }
}
// vérifier que chaque session a un business cohérent et distinct selon son script
let okSessions=0;
for(const s of sessions){
  const f=E.computeFinancials(s.prof);
  if(s.prof.metier && f.ca>0 && f.seuilCA>=0) okSessions++;
}
ok(okSessions===50,`50/50 sessions configurées correctement (reçu ${okSessions})`);
// vérifier l'isolation : un mécano et un couturier n'ont pas le même métier
const mec=sessions.find(s=>s.prof.metier==="mecanicien");
const cou=sessions.find(s=>s.prof.metier==="couturier");
ok(mec && cou && mec.prof.metier!==cou.prof.metier,"métiers isolés entre sessions parallèles");

console.log("=== C. Cas limites de saisie ===");
ok(E.parseAmounts("").length===0,"vide");
ok(E.parseAmounts("abc def").length===0,"texte sans nombre");
ok(E.parseAmounts("2.500.000 fcfa")[0]===2500000,"millions avec points");
ok(E.parseAmounts("le prix c'est 12000 et 8000 et 3000").length===3,"trois montants");
ok(E.parseAmounts("zéro")[0]===undefined,"mot zéro non numérique");
const nm=E.extractName("je vends des belles robes à 15000 ça coûte 9000");
ok(nm.length>0 && !/\d/.test(nm),"nom extrait sans chiffres: '"+nm+"'");

console.log("=== D. Robustesse moteur sur profil corrompu ===");
const bad={name:"x",metier:"vendeur",revenus:[{nom:"A"},{nom:"B",prix:null,qte:undefined,cout:NaN}],charges:[{nom:"L"}],target:30};
let crashed=false,f;
try{f=E.computeFinancials(bad);}catch(e){crashed=true;}
ok(!crashed,"pas de crash sur données manquantes");
ok(isFinite(f.ca)&&isFinite(f.net)&&isFinite(f.seuilCA),"valeurs finies malgré null/NaN");

console.log("=== E. Cohérence comptable (invariant) ===");
// Pour 30 profils aléatoires : net == margeBrute - cf, toujours
let invOk=true;
for(let i=0;i<30;i++){
  const p=E.presetProfile(metiers[i%metiers.length]);
  p.revenus.forEach(r=>{r.prix=Math.floor(Math.random()*40000);r.qte=Math.floor(Math.random()*500);r.cout=Math.floor(Math.random()*20000);});
  const f=E.computeFinancials(p);
  if(Math.abs(f.net-(f.margeBrute-f.cf))>0.5) invOk=false;
  if(Math.abs(f.margeBrute-(f.ca-f.coutsDirects))>0.5) invOk=false;
}
ok(invOk,"invariant comptable respecté sur 30 profils aléatoires");

console.log("\n=========================================");
console.log(`STRESS : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
