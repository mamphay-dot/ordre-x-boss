const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){ w.scrollTo=()=>{};w.confirm=()=>true;w.alert=()=>{};w.open=()=>null;w.prompt=()=>"x";
    w.fetch=()=>Promise.reject(new Error("off")); w.onerror=(m,s,l,c,e)=>errors.push(String(e||m)); }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const stateNow=()=>JSON.parse(w.localStorage.getItem("boss:state:v1"));
const prods=()=>{const s=stateNow();return s.profiles[s.currentId].revenus;};

(async()=>{
  await wait(350);
  q('.tab[data-v="boutique"]').dispatchEvent(new w.Event("click"));await wait(100);
  const n0=prods().length;

  console.log("=== Création bloquée si vide ===");
  q("#v-add").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pf-save").dispatchEvent(new w.Event("click"));await wait(80); // rien rempli
  ok(q("#pf-err")&&q("#pf-err").textContent.length>0,"message: nom requis");
  ok(prods().length===n0,"aucun produit vide créé");

  console.log("=== Création bloquée si prix manquant ===");
  q("#pf-name").value="Chaussures"; q("#pf-save").dispatchEvent(new w.Event("click"));await wait(80);
  ok(q("#pf-err").textContent.toLowerCase().includes("prix"),"message: prix requis");
  ok(prods().length===n0,"toujours aucun produit créé");

  console.log("=== Création valide ===");
  q("#pf-prix").value="20000"; q("#pf-save").dispatchEvent(new w.Event("click"));await wait(120);
  ok(prods().length===n0+1,"produit valide créé");
  ok(prods().some(r=>r.nom==="Chaussures"&&r.prix===20000),"bonnes valeurs enregistrées");

  console.log("=== Doublon bloqué ===");
  q("#v-add").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pf-name").value="chaussures"; q("#pf-prix").value="15000"; // même nom, casse différente
  q("#pf-save").dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#pf-err").textContent.toLowerCase().includes("existe"),"message: doublon refusé");
  ok(prods().length===n0+1,"pas de doublon créé");
  closeOverlay();

  console.log("=== Modifier un produit ne se bloque pas lui-même ===");
  q('.tab[data-v="boutique"]').dispatchEvent(new w.Event("click"));await wait(80);
  doc.querySelector("#v-grid .vc-btn.edit").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pf-prix").value="25000"; q("#pf-save").dispatchEvent(new w.Event("click"));await wait(120);
  ok(prods().some(r=>r.nom==="Chaussures"&&r.prix===25000),"modification du même produit acceptée");

  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,2).join(" | "):""));
  console.log("\n=========================================");
  console.log(`INTÉGRATION PRODUIT : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);

  function closeOverlay(){ try{q("#overlay").dispatchEvent(new w.Event("click"));}catch(e){} }
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
