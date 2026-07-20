const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[],alerts=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){ w.scrollTo=()=>{};w.confirm=()=>true;w.alert=(m)=>{alerts.push(String(m));};w.prompt=(m,d)=>"Terrasse";w.open=()=>null;w.print=()=>{};
    w.fetch=()=>Promise.reject(new Error("off")); w.onerror=(m,s,l,c,e)=>errors.push(String(e||m)); }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s),qa=s=>Array.from(doc.querySelectorAll(s));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const lic=()=>JSON.parse(w.localStorage.getItem("boss:state:v1")).license;

(async()=>{
  await wait(350);
  console.log("=== Coût mensuel initial = 0 ===");
  ok(lic().acceptedMonthly===0 || !lic().acceptedMonthly,"aucune fonction payante -> 0");

  console.log("=== Activer un collaborateur -> +2000/mois auto ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pl-team").dispatchEvent(new w.Event("click"));await wait(100);
  q("#team-new").dispatchEvent(new w.Event("click"));await wait(100);
  q("#co-nom").value="Awa";
  alerts.length=0;
  q("#co-save").dispatchEvent(new w.Event("click"));await wait(150);
  ok(lic().acceptedMonthly===2000,"coût mensuel accepté = 2000 ("+lic().acceptedMonthly+")");
  ok(alerts.some(a=>a.includes("mensuel")&&a.replace(/\s/g,"").includes("2000")),"message d'acceptation automatique du coût mensuel");

  console.log("=== 2e collaborateur -> 4000/mois ===");
  q("#team-new").dispatchEvent(new w.Event("click"));await wait(100);
  q("#co-nom").value="Koffi"; q("#co-save").dispatchEvent(new w.Event("click"));await wait(150);
  ok(lic().acceptedMonthly===4000,"2 collaborateurs -> 4000/mois");

  console.log("=== Ajouter une caisse -> +1000/mois ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pl-registers").dispatchEvent(new w.Event("click"));await wait(100);
  alerts.length=0;
  q("#reg-new").dispatchEvent(new w.Event("click"));await wait(150); // prompt -> Terrasse
  ok(lic().acceptedMonthly===5000,"2 collab + 1 caisse extra -> 5000/mois ("+lic().acceptedMonthly+")");

  console.log("=== Écran Abonnement (plans BOSS Starter/Business/Pro) ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pl-abo").dispatchEvent(new w.Event("click"));await wait(100);
  ok(q(".abo-current"),"la carte 'plan actuel' est affichée");
  ok(qa(".plan-card").length===3,"3 plans affichés (Starter, Business, Pro)");
  ok(doc.body.textContent.includes("Starter") && doc.body.textContent.includes("Business") && doc.body.textContent.includes("Pro"),"noms des 3 plans présents");
  q("#overlay").dispatchEvent(new w.Event("click"));await wait(40);

  console.log("=== Retrait d'un collaborateur -> coût baisse auto ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pl-team").dispatchEvent(new w.Event("click"));await wait(100);
  q('#sheet .cat-b[data-a="del"]').dispatchEvent(new w.Event("click"));await wait(150);
  ok(lic().acceptedMonthly===3000,"1 collab retiré -> 3000/mois (1 collab + 1 caisse)");

  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,2).join(" | "):""));
  console.log("\n=========================================");
  console.log(`INTÉGRATION ABONNEMENT MENSUEL : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
