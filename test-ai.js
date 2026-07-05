const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}

console.log("=== Extraction JSON ===");
ok(E.parseAIjson('Voici: {"reply":"ok","patch":{}}').reply==="ok","JSON brut extrait");
ok(E.parseAIjson('```json\n{"a":1}\n```').a===1,"bloc ```json``` extrait");
ok(E.parseAIjson("texte sans json")===null,"pas de JSON -> null");
ok(E.parseAIjson('{"x": invalide}')===null,"JSON cassé -> null");

console.log("=== Application du patch IA ===");
const p=E.blankProfile("Test");
const r=E.applyAIPatch(p,{name:"Chez Awa",metier:"couturier",addProducts:[
  {nom:"Robe",prix:15000,cout:9000,qte:20,stock:5},
  {nom:"Foulard",prix:3000}
],addCharges:[{nom:"Loyer",montant:50000}],target:35});
ok(p.name==="Chez Awa","nom appliqué");
ok(p.metier==="couturier","métier appliqué");
ok(p.revenus.length===2,"2 produits ajoutés");
ok(p.revenus[0].nom==="Robe"&&p.revenus[0].prix===15000&&p.revenus[0].stock===5,"produit complet");
ok(p.charges.length===1&&p.charges[0].montant===50000,"charge ajoutée");
ok(p.target===35,"objectif de marge appliqué");
ok(r.events.length>=4,"événements de configuration émis");

console.log("=== Validation & dédoublonnage ===");
const p2=E.blankProfile("T2");
E.applyAIPatch(p2,{addProducts:[{nom:"Pain",prix:200}]});
E.applyAIPatch(p2,{addProducts:[
  {nom:"pain",prix:250},        // doublon -> ignoré
  {nom:"",prix:500},             // sans nom -> ignoré
  {nom:"Eau",prix:0},            // prix 0 -> ignoré
  {nom:"Lait",prix:600}          // valide
]});
ok(p2.revenus.length===2,"doublons/vides ignorés (Pain + Lait) -> "+p2.revenus.length);
ok(p2.revenus.some(r=>r.nom==="Lait"),"produit valide conservé");

console.log("=== Métier inconnu ignoré, done lu ===");
const p3=E.blankProfile("T3"); const before=p3.metier;
const r3=E.applyAIPatch(p3,{metier:"astronaute",done:true});
ok(p3.metier===before,"métier inconnu ignoré (pas de crash)");
ok(r3.done===true,"drapeau done transmis");

console.log("=== Patch vide / nul ===");
ok(E.applyAIPatch(p3,null).events.length===0,"patch nul sans effet");

console.log("\n=========================================");
console.log(`ASSISTANT IA : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
