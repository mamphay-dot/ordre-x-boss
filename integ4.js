const fs=require("fs");const {JSDOM}=require("jsdom");const {webcrypto}=require("crypto");
const E=require("./engine.js");const priv=require("./keys.json").priv;
let pass=0,fail=0,errors=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");

const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){
    w.scrollTo=()=>{};w.confirm=()=>true;w.alert=()=>{};w.open=()=>null;
    w.prompt=(m,d)=>"1234";
    w.fetch=()=>Promise.reject(new Error("offline"));
    try{ Object.defineProperty(w,"crypto",{value:webcrypto,configurable:true,writable:true}); }catch(e){ try{w.crypto=webcrypto;}catch(_){} }
    w.TextEncoder=TextEncoder; w.TextDecoder=TextDecoder;
    w.navigator.clipboard={writeText:()=>Promise.resolve()};
    w.onerror=(msg,s,l,c,e)=>errors.push(String(e||msg));
  }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const rootVar=n=>doc.documentElement.style.getPropertyValue(n).trim();

(async()=>{
  await wait(350);

  console.log("=== THÈME ===");
  ok(rootVar("--gold").toLowerCase()==="#c8a23a","accent par défaut = ocre");
  ok(rootVar("--black")==="#0E0E0F","fond noir par défaut");
  // bascule clair/sombre
  q("#theme-toggle").dispatchEvent(new w.Event("click"));await wait(80);
  ok(rootVar("--black")==="#F4F4F5","bascule en mode clair");
  ok(rootVar("--cream")==="#1B1B1D","texte sombre en mode clair");
  q("#theme-toggle").dispatchEvent(new w.Event("click"));await wait(80);
  ok(rootVar("--black")==="#0E0E0F","re-bascule en sombre");
  // couleur personnalisée via Apparence
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pl-appearance").dispatchEvent(new w.Event("click"));await wait(100);
  ok(doc.querySelector("#ap-sw .swatch"),"pastilles couleur affichées");
  // choisir l'accent "Or" (2e pastille)
  doc.querySelectorAll("#ap-sw .swatch")[1].dispatchEvent(new w.Event("click"));await wait(80);
  ok(rootVar("--gold").toLowerCase()==="#8a8a8a","accent changé en Gris");
  const stored=JSON.parse(w.localStorage.getItem("boss:state:v1"));
  ok(stored.theme.accent.toLowerCase()==="#8a8a8a","thème persisté");
  q("#overlay").dispatchEvent(new w.Event("click"));await wait(50);

  console.log("=== LICENCE : essai actif au départ ===");
  ok(q("#lock-screen").style.display==="none","pas de verrou pendant l'essai");
  const deviceId=JSON.parse(w.localStorage.getItem("boss:state:v1")).deviceId;
  ok(/^BOSS-/.test(deviceId),"code appareil généré ("+deviceId+")");

  console.log("=== ADMIN : tarification + génération de code ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pl-admin").dispatchEvent(new w.Event("click"));await wait(120); // prompt -> "1234" crée le PIN
  // Nouveau : le panel admin s'ouvre sur l'onglet Aperçu. On bascule sur Licence.
  const licTab=doc.querySelector('.admin-tab[data-t="licence"]'); if(licTab){ licTab.dispatchEvent(new w.Event("click")); await wait(80); }
  ok(q("#ad-base"),"console admin ouverte");
  q("#ad-trial").value="90"; q("#ad-base").value="5000"; q("#ad-extra").value="2000";
  q("#ad-savecfg").dispatchEvent(new w.Event("click"));await wait(100);
  const st2=JSON.parse(w.localStorage.getItem("boss:state:v1"));
  ok(st2.license.basePrice===5000&&st2.license.extraMetierPrice===2000,"tarification enregistrée");
  // générer un code via la clé privée
  q("#ad-priv").value=JSON.stringify(priv); q("#ad-dev").value=deviceId; q("#ad-days").value="30";
  q("#ad-gen").dispatchEvent(new w.Event("click"));await wait(150);
  const genCode=q("#ad-code").value;
  ok(genCode && genCode.indexOf(".")>0,"code généré dans la console admin");
  const verif=await w.BOSS.verifyLicenseToken(genCode);
  ok(verif && verif.d===deviceId,"code généré valide pour cet appareil");

  console.log("=== VERROUILLAGE MANUEL + DÉVERROUILLAGE ===");
  // verrouiller cet appareil
  q("#ad-lock").checked=true; q("#ad-lock").dispatchEvent(new w.Event("change"));await wait(120);
  ok(q("#lock-screen").style.display==="flex","appareil verrouillé -> écran de blocage");
  ok(q("#lock-device").textContent===deviceId,"écran affiche le code appareil");
  // tenter un code bidon
  q("#lock-code").value="faux.code"; q("#lock-unlock").dispatchEvent(new w.Event("click"));await wait(120);
  ok(q("#lock-screen").style.display==="flex","code invalide -> reste verrouillé");
  ok(q("#lock-err").textContent.length>0,"message d'erreur affiché");
  // vrai code signé (Node) pour ce device
  const realCode=await E.signLicenseToken(priv,{d:deviceId,e:Date.now()+30*86400000,m:1});
  q("#lock-code").value=realCode; q("#lock-unlock").dispatchEvent(new w.Event("click"));await wait(160);
  ok(q("#lock-screen").style.display==="none","bon code -> déverrouillé ✅");
  const st3=JSON.parse(w.localStorage.getItem("boss:state:v1"));
  ok(st3.license.paidUntil>Date.now()&&!st3.license.lockedManually,"licence: payé jusqu'à une date future, blocage levé");

  console.log("=== Erreurs runtime ===");
  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,3).join(" | "):""));

  console.log("\n=========================================");
  console.log(`INTÉGRATION THÈME/LICENCE : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
