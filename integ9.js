const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){ w.scrollTo=()=>{};w.confirm=()=>true;w.alert=()=>{};w.prompt=()=>"x";w.open=()=>null;
    w.fetch=()=>Promise.reject(new Error("off")); w.onerror=(m,s,l,c,e)=>errors.push(String(e||m)); }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s),qa=s=>Array.from(doc.querySelectorAll(s));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const prof=()=>{const s=JSON.parse(w.localStorage.getItem("boss:state:v1"));return s.profiles[s.currentId];};

(async()=>{
  await wait(350);
  console.log("=== Ouvrir Pièces via Plus ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pl-pieces").dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#view-pieces").classList.contains("on"),"vue pièces affichée");
  ok(q("#pc-f-type").options.length>1,"filtre type rempli");
  ok(q("#pc-f-canal").options.length>1,"filtre mode de règlement rempli");

  console.log("=== Ajouter des pièces ===");
  function addPiece(type,canal,montant,tiers,date){
    q("#pc-add").dispatchEvent(new w.Event("click"));
    q("#pc-type").value=type; q("#pc-canal").value=canal;
    q("#pc-montant").value=String(montant); q("#pc-tiers").value=tiers; q("#pc-date").value=date;
    q("#pc-save").dispatchEvent(new w.Event("click"));
  }
  addPiece("achat","especes",45000,"Grossiste","2026-07-02");await wait(100);
  addPiece("vente","banque",80000,"Client X","2026-07-20");await wait(100);
  addPiece("quittance","banque",50000,"Propriétaire","2026-06-05");await wait(100);
  ok(prof().pieces.length===3,"3 pièces enregistrées");

  console.log("=== Blocage si montant manquant ===");
  q("#pc-add").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pc-save").dispatchEvent(new w.Event("click"));await wait(60);
  ok(q("#pc-err").textContent.length>0,"montant obligatoire");
  ok(prof().pieces.length===3,"aucune pièce vide créée");
  q("#overlay").dispatchEvent(new w.Event("click"));await wait(40);

  console.log("=== Tri par mois (groupes + totaux) ===");
  await wait(60);
  let groups=qa("#pc-list .pc-group").length;
  ok(groups===2,"2 groupes mensuels (juin, juillet) -> "+groups);
  ok(q("#pc-list").textContent.replace(/\s/g,"").includes("80000"),"total recettes affiché");

  console.log("=== Filtre par type ===");
  q("#pc-f-type").value="achat"; q("#pc-f-type").dispatchEvent(new w.Event("change"));await wait(80);
  ok(qa("#pc-list .pc-row").length===1,"filtre type=achat -> 1 pièce");
  q("#pc-f-type").value="tous"; q("#pc-f-type").dispatchEvent(new w.Event("change"));await wait(60);

  console.log("=== Filtre par mode de règlement + période année ===");
  q("#pc-f-canal").value="banque"; q("#pc-f-canal").dispatchEvent(new w.Event("change"));await wait(80);
  ok(qa("#pc-list .pc-row").length===2,"filtre banque -> 2 pièces");
  q('#pc-periods .cmd-chip[data-p="annee"]').dispatchEvent(new w.Event("click"));await wait(80);
  ok(qa("#pc-list .pc-group").length===1,"regroupement par année -> 1 groupe");

  console.log("=== Aide / tutoriel ===");
  q("#pc-help").dispatchEvent(new w.Event("click"));await wait(100);
  ok(qa(".tuto .tuto-step").length>=5,"tutoriel avec étapes affiché");
  q("#overlay").dispatchEvent(new w.Event("click"));await wait(40);

  console.log("=== Exemples par métier dans le formulaire ===");
  q("#pc-add").dispatchEvent(new w.Event("click"));await wait(80);
  ok(qa("#pc-ex .chip").length>=3,"exemples de remplissage proposés");
  doc.querySelector("#pc-ex .chip").dispatchEvent(new w.Event("click"));await wait(40);
  ok(q("#pc-tiers").value.length>0,"un exemple préremplit le tiers");

  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,2).join(" | "):""));
  console.log("\n=========================================");
  console.log(`INTÉGRATION PIÈCES : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
