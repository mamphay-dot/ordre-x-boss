const E=require("./engine.js");
const fs=require("fs");
const priv=require("./keys.json").priv;
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}

const DAY=86400000;
const NOW=Date.now();

console.log("=== Tarif ===");
const lic={installedAt:NOW,trialDays:90,paidUntil:0,basePrice:5000,extraMetierPrice:2000,graceHours:48};
ok(E.licenseDue(lic,1)===5000,"1 métier = prix de base");
ok(E.licenseDue(lic,3)===9000,"3 métiers = base + 2×supplément (5000+4000)");

console.log("=== Statut: essai / grâce / blocage ===");
let s=E.licenseStatus(lic,1,NOW);
ok(s.state==="trial","en période d'essai");
ok(s.daysLeftTrial===90||s.daysLeftTrial===89,"jours d'essai restants ~90");
// après l'essai mais dans les 48h
const expiredTrial={...lic,installedAt:NOW-91*DAY};
s=E.licenseStatus(expiredTrial,1,NOW);
ok(s.state==="grace","après essai, dans la grâce 48h -> bandeau rouge");
ok(s.hoursLeft<=48&&s.hoursLeft>0,"heures de grâce restantes <=48");
// après 48h
const wayExpired={...lic,installedAt:NOW-100*DAY};
s=E.licenseStatus(wayExpired,1,NOW);
ok(s.state==="locked","au-delà de 48h -> verrouillé");
// payé
const paid={...lic,installedAt:NOW-100*DAY,paidUntil:NOW+10*DAY};
s=E.licenseStatus(paid,1,NOW);
ok(s.state==="active","payé -> actif");
ok(s.daysLeftPaid===10||s.daysLeftPaid===9,"jours payés restants ~10");
// blocage manuel
s=E.licenseStatus({...lic,lockedManually:true},1,NOW);
ok(s.state==="locked","blocage manuel par admin");

console.log("=== Code de déverrouillage (signé) ===");
(async()=>{
  const expiry=NOW+30*DAY;
  const token=await E.signLicenseToken(priv,{d:"device-XYZ",e:expiry,m:2});
  ok(typeof token==="string"&&token.indexOf(".")>0,"code généré");
  const payload=await E.verifyLicenseToken(token);
  ok(payload && payload.d==="device-XYZ" && payload.e===expiry,"code vérifié avec la clé publique embarquée");
  // code falsifié rejeté
  const bad=await E.verifyLicenseToken(token.slice(0,-3)+"AAA");
  ok(bad===null,"code falsifié -> rejeté");
  // code bidon rejeté
  ok((await E.verifyLicenseToken("nimporte.quoi"))===null,"code invalide -> rejeté");
  // un attaquant sans la clé privée ne peut pas forger (clé aléatoire)
  const {webcrypto}=require("crypto");
  const fake=await webcrypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const fakePriv=await webcrypto.subtle.exportKey("jwk",fake.privateKey);
  const forged=await E.signLicenseToken(fakePriv,{d:"device-XYZ",e:expiry,m:2});
  ok((await E.verifyLicenseToken(forged))===null,"code signé par une autre clé -> rejeté (non falsifiable)");

  console.log("=== Rôles ===");
  ok(E.ROLES.proprietaire&&E.ROLES.recouvrement&&E.ROLES.comptable,"rôles définis (proprio, recouvrement, comptable…)");
  ok(E.ROLES.proprietaire.perms.includes("all"),"propriétaire a tous les droits");

  console.log("\n=========================================");
  console.log(`LICENCE/RÔLES : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e);process.exit(1);});
