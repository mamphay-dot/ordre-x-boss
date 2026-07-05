const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}

console.log("=== Permissions par rôle ===");
ok(E.defaultPermsForRole("proprietaire").includes("valider"),"propriétaire peut valider");
ok(E.defaultPermsForRole("commercial").includes("pos")&&!E.defaultPermsForRole("commercial").includes("valider"),"commercial: POS oui, valider non");
const co=E.blankCollaborateur("commercial");
ok(co.role==="commercial"&&Array.isArray(co.permissions)&&co.actif,"collaborateur créé avec permissions");
ok(E.collabCan(co,"pos")&&!E.collabCan(co,"valider"),"collabCan respecte les permissions");
ok(E.collabCan(null,"valider"),"propriétaire (null) peut tout");

console.log("=== Facturation : 2000/collaborateur + 1000/caisse ===");
const lic=E.defaultLicense();
ok(lic.perCollaborateur===2000&&lic.perCaisse===1000,"tarifs par défaut 2000 / 1000");
let b=E.billingDue(lic,{metiers:1,collaborateurs:0,caisses:1});
ok(b.total===0,"0 collaborateur, 1 caisse -> 0");
b=E.billingDue(lic,{metiers:1,collaborateurs:3,caisses:1});
ok(b.total===6000,"3 collaborateurs -> 6000 ("+b.total+")");
b=E.billingDue(lic,{metiers:1,collaborateurs:0,caisses:3});
ok(b.total===2000,"3 caisses -> 2 en plus × 1000 = 2000 ("+b.total+")");
b=E.billingDue(lic,{metiers:2,collaborateurs:2,caisses:2});
const lic2={...lic,basePrice:5000,extraMetierPrice:2000};
const b2=E.billingDue(lic2,{metiers:2,collaborateurs:2,caisses:2});
ok(b2.total===5000+2000+ (2*2000) + (1*1000),"base+métier+2 collab+1 caisse = "+b2.total);

console.log("=== Rendu de monnaie ===");
let m=E.makeChange(4500,5000);
ok(m.rendu===500&&!m.insuffisant,"monnaie à rendre = 500");
m=E.makeChange(5000,5000);
ok(m.rendu===0&&!m.insuffisant,"appoint exact -> 0");
m=E.makeChange(5000,3000);
ok(m.insuffisant&&m.manque===2000,"paiement insuffisant -> manque 2000");

console.log("=== Ticket POS ===");
const lines=[{nom:"Riz",prix:1500,qty:2},{nom:"Poulet",prix:3000,qty:1}];
ok(E.ticketTotal(lines)===6000,"total ticket (2×1500+3000)");
ok(E.ticketVolume(lines)===3,"volume = 3 articles");

console.log("=== Profil enrichi ===");
const np=E.blankProfile("X");
ok(Array.isArray(np.collaborateurs)&&np.caisses.length===1,"profil: collaborateurs[] + 1 caisse");
const old={id:"o",name:"v",metier:"maquis",revenus:[]}; E.ensureProfile(old);
ok(Array.isArray(old.collaborateurs)&&old.caisses[0].nom==="Caisse principale","migration ajoute collaborateurs + caisse principale");

console.log("\n=========================================");
console.log(`COLLABORATEURS/POS/FACTURATION : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
