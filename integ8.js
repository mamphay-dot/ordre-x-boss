const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[],printed=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){ w.scrollTo=()=>{};w.confirm=()=>true;w.alert=(m)=>{errors.push("alert:"+m);};w.prompt=()=>"x";w.open=()=>null;
    w.print=()=>{printed++;};
    w.fetch=()=>Promise.reject(new Error("off")); w.onerror=(m,s,l,c,e)=>errors.push(String(e||m)); }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s),qa=s=>Array.from(doc.querySelectorAll(s));
const wait=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  await wait(350);
  console.log("=== Sans produit : message, pas d'impression ===");
  q('.tab[data-v="boutique"]').dispatchEvent(new w.Event("click"));await wait(80);
  errors.length=0;
  q("#v-pdf").dispatchEvent(new w.Event("click"));await wait(100);
  q("#cat-full").dispatchEvent(new w.Event("click"));await wait(120);
  ok(printed===0,"pas d'impression si boutique vide");
  ok(errors.some(e=>e.includes("produit")),"message invite à ajouter un produit");

  console.log("=== Ajouter des produits ===");
  function addProduct(nom,prix,desc){
    q("#v-add").dispatchEvent(new w.Event("click"));
    q("#pf-name").value=nom; q("#pf-prix").value=String(prix); if(desc){q("#pf-desc").value=desc;}
    q("#pf-save").dispatchEvent(new w.Event("click"));
  }
  addProduct("Robe wax",15000,"Coupe moderne, toutes tailles");await wait(120);
  addProduct("Foulard",3000,"");await wait(120);
  const s=JSON.parse(w.localStorage.getItem("boss:state:v1")); const p=s.profiles[s.currentId];
  p.name="Chez Awa"; // pour l'en-tête
  ok(p.revenus.length===2,"2 produits en boutique");

  console.log("=== Générer le catalogue PDF ===");
  printed=0; errors.length=0;
  q("#v-pdf").dispatchEvent(new w.Event("click"));await wait(100);
  q("#cat-full").dispatchEvent(new w.Event("click"));await wait(150);
  ok(printed===1,"impression (Enregistrer en PDF) déclenchée");
  const pa=q("#print-area");
  ok(qa("#print-area .pc-item").length===2,"catalogue contient les 2 produits");
  ok(pa.textContent.replace(/\s/g,"").includes("15000"),"le prix figure dans le catalogue");
  ok(pa.querySelector(".pc-name"),"les noms de produits figurent");
  ok(pa.querySelector(".pc-head"),"en-tête du catalogue présent");

  console.log("=== Icône vectorielle du bouton PDF ===");
  ok(q("#v-pdf .bi svg"),"bouton PDF avec pictogramme vectoriel");

  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,2).join(" | "):""));
  console.log("\n=========================================");
  console.log(`INTÉGRATION PDF : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
