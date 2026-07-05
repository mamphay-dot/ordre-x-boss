const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[],opened=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");

// PAS de window.storage -> on force le chemin "app installée" (localStorage), comme sur le téléphone
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){
    w.scrollTo=()=>{};w.confirm=()=>true;w.prompt=(m,d)=>d||"X";w.alert=()=>{};
    w.fetch=()=>Promise.reject(new Error("offline"));
    w.open=(u)=>{opened.push(u);return null;};
    w.URL.createObjectURL=()=>"blob:x"; w.URL.revokeObjectURL=()=>{};
    w.onerror=(msg,s,l,c,e)=>errors.push(String(e||msg));
    // pas de serviceWorker, pas d'indexedDB -> localStorage
  }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s),qa=s=>Array.from(doc.querySelectorAll(s));
const wait=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  await wait(350);

  console.log("=== Stockage app installée (sans window.storage) ===");
  ok(q("#storage-note")!=null,"indicateur de stockage présent");
  // après le boot, le profil par défaut doit être écrit dans localStorage
  ok(w.localStorage.getItem("boss:state:v1")!=null,"état écrit dans localStorage (persistant sur l'appareil)");

  console.log("=== Caisse : enregistrer ventes & dépenses ===");
  q('.tab[data-v="caisse"]').dispatchEvent(new w.Event("click"));
  await wait(120);
  ok(q("#view-caisse").classList.contains("on"),"vue caisse affichée");
  // vente
  q("#c-add-vente").dispatchEvent(new w.Event("click"));
  await wait(120);
  ok(q("#ce-amount")!=null,"formulaire de vente ouvert");
  q("#ce-amount").value="5000"; q("#ce-label").value="Poulet";
  q("#ce-save").dispatchEvent(new w.Event("click"));
  await wait(120);
  ok(q("#c-vjour").textContent.replace(/\s/g,"").includes("5000"),"ventes du jour = 5000 ("+q("#c-vjour").textContent+")");
  ok(doc.querySelectorAll("#c-list .caisse-row").length===1,"1 mouvement listé");
  // dépense
  q("#c-add-depense").dispatchEvent(new w.Event("click"));
  await wait(120);
  q("#ce-amount").value="2000"; q("#ce-save").dispatchEvent(new w.Event("click"));
  await wait(120);
  ok(q("#c-djour").textContent.replace(/\s/g,"").includes("2000"),"dépenses du jour = 2000");
  ok(q("#c-net").textContent.replace(/\s/g,"").includes("3000"),"net du mois = 3000 ("+q("#c-net").textContent+")");
  // persistance de la caisse
  const stored=JSON.parse(w.localStorage.getItem("boss:state:v1"));
  const prof=stored.profiles[stored.currentId];
  ok(prof.caisse.length===2,"caisse persistée (2 entrées)");

  console.log("=== Tableau : réel ce mois ===");
  q('.tab[data-v="dash"]').dispatchEvent(new w.Event("click"));
  await wait(120);
  ok(q("#d-real").children.length>=2,"bloc réel/impayés affiché sur le tableau");
  ok(q("#d-real").textContent.includes("Encaissé ce mois"),"affiche l'encaissé réel du mois");

  console.log("=== Carnet : dettes & relance ===");
  q(".navlink[data-v=\"carnet\"]").dispatchEvent(new w.Event("click"));
  await wait(120);
  q("#k-add").dispatchEvent(new w.Event("click"));
  await wait(120);
  ok(q("#dk-montant")!=null,"formulaire de dette ouvert");
  q("#dk-client").value="Awa"; q("#dk-montant").value="12000"; q("#dk-motif").value="Tissu"; q("#dk-phone").value="0700112233";
  q("#dk-save").dispatchEvent(new w.Event("click"));
  await wait(120);
  ok(q("#k-impaye").textContent.replace(/\s/g,"").includes("12000"),"total dû = 12000");
  ok(doc.querySelectorAll("#k-list .debt-row").length===1,"1 dette listée");
  // relance WhatsApp
  opened.length=0;
  doc.querySelector("#k-list .db-remind").dispatchEvent(new w.Event("click"));
  await wait(60);
  ok(opened.length===1 && opened[0].includes("0700112233"),"relance -> WhatsApp au bon numéro");
  ok(decodeURIComponent(opened[0]).includes("Awa"),"relance personnalisée au client");
  // marquer payé
  doc.querySelector("#k-list .db-check").dispatchEvent(new w.Event("click"));
  await wait(120);
  ok(q("#k-impaye").textContent.replace(/\s/g,"").startsWith("0"),"après paiement -> total dû = 0");

  console.log("=== Plus : sauvegarde / réinitialiser ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));
  await wait(120);
  ok(q("#pl-export")&&q("#pl-import")&&q("#pl-reset"),"menu Plus : export/import/reset présents");
  ok(q("#pl-install")==null,"bouton installer masqué (pas de prompt dispo en test)");
  // export ne doit pas planter
  let expErr=false; try{ q("#pl-export").dispatchEvent(new w.Event("click")); }catch(e){ expErr=true; }
  await wait(60);
  ok(!expErr,"export sans erreur");

  console.log("=== Import d'une sauvegarde ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));
  await wait(100);
  // fabriquer une sauvegarde d'un autre business
  const other={profiles:{},currentId:"imp1"};
  other.profiles["imp1"]={id:"imp1",name:"Business Importé",metier:"couturier",unite:"pièces",revenus:[],charges:[],caisse:[],carnet:[],target:30};
  const backup=JSON.stringify({app:"BOSS",version:1,exportedAt:"now",state:other});
  const fileInput=q("#pl-file");
  const fileObj=new w.File([backup],"b.json",{type:"application/json"});
  Object.defineProperty(fileInput,"files",{value:[fileObj],configurable:true});
  fileInput.dispatchEvent(new w.Event("change"));
  await wait(250);
  ok(q("#cur-name").textContent==="Business Importé","import: business chargé depuis le fichier");
  const after=JSON.parse(w.localStorage.getItem("boss:state:v1"));
  ok(after.profiles["imp1"]&&after.profiles["imp1"].name==="Business Importé","import persisté dans localStorage");

  console.log("=== Erreurs runtime ===");
  ok(errors.length===0,"aucune erreur JS sur tout le parcours"+(errors.length?" -> "+errors.slice(0,3).join(" | "):""));

  console.log("\n=========================================");
  console.log(`INTÉGRATION 2 : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e);process.exit(1);});
