const E=require("./engine.js");
let pass=0,fail=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}

console.log("=== Vitrine: prix conseillé ===");
const p=E.presetProfile("maquis");
const sp=E.suggestPrice(p);
ok(sp>0,"prix conseillé > 0 ("+sp+")");
const vide=E.blankProfile("v");
ok(E.suggestPrice(vide)>0,"prix conseillé sur profil vide (défaut métier/5000)");

console.log("=== Vitrine: description de secours ===");
const d=E.fallbackDescription("Robe wax","taille M, neuve","vendeur");
ok(typeof d==="string"&&d.includes("Robe wax"),"description contient le nom");
ok(d.length>15,"description non vide");
ok(E.fallbackDescription("","","vendeur").length>0,"description même sans nom");

console.log("=== Vitrine: texte catalogue WhatsApp ===");
const cat=E.waCatalogueText(p);
ok(cat.includes(p.name),"catalogue contient le nom du business");
ok(cat.includes("Poulet braisé"),"catalogue liste les produits");
ok(/F/.test(cat),"catalogue affiche les prix");

console.log("=== Vitrine: lien wa.me ===");
const link=E.waLink("bonjour test","07 00 00 00 00");
ok(link.startsWith("https://wa.me/"),"lien wa.me valide");
ok(link.includes("0700000000"),"téléphone nettoyé dans le lien");
ok(link.includes(encodeURIComponent("bonjour test")),"texte encodé");
const link2=E.waLink("salut");
ok(link2.startsWith("https://wa.me/?text="),"lien sans téléphone valide");

console.log("=== Vitrine: demande de paiement ===");
const pay=E.paymentRequestText("Wave",3000,"Poulet braisé","Maquis Awa");
ok(pay.includes("Wave"),"opérateur présent");
ok(pay.includes("Poulet braisé"),"produit présent");
ok(pay.includes(E.fmtF(3000)),"montant formaté présent ("+E.fmtF(3000)+")");
ok(pay.includes("Maquis Awa"),"vendeur présent");

console.log("\n=========================================");
console.log(`VITRINE : ${pass} réussis, ${fail} échoués`);
console.log("=========================================");
process.exit(fail>0?1:0);
