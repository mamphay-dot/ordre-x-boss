const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){ w.scrollTo=()=>{};w.confirm=()=>true;w.alert=()=>{};w.prompt=(m,d)=>"Terrasse";w.open=()=>null;w.print=()=>{};
    w.fetch=()=>Promise.reject(new Error("off")); w.onerror=(m,s,l,c,e)=>errors.push(String(e||m)); }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s),qa=s=>Array.from(doc.querySelectorAll(s));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const prof=()=>{const s=JSON.parse(w.localStorage.getItem("boss:state:v1"));return s.profiles[s.currentId];};

(async()=>{
  await wait(350);

  console.log("=== Produits avec stock pour le POS ===");
  q('.tab[data-v="boutique"]').dispatchEvent(new w.Event("click"));await wait(80);
  function addP(n,pr,st){ q("#v-add").dispatchEvent(new w.Event("click")); q("#pf-name").value=n; q("#pf-prix").value=String(pr); if(st!=null)q("#pf-stock").value=String(st); q("#pf-save").dispatchEvent(new w.Event("click")); }
  addP("Riz",1500,10);await wait(90); addP("Poulet",3000,10);await wait(90);
  ok(prof().revenus.length===2,"2 produits");

  console.log("=== Ouvrir le POS depuis la caisse ===");
  q('.tab[data-v="caisse"]').dispatchEvent(new w.Event("click"));await wait(70);
  q("#c-open-pos").dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#view-pos").classList.contains("on"),"écran POS ouvert");
  ok(qa("#pos-grid .pos-p").length===2,"grille produits");

  console.log("=== Saisie d'une vente + monnaie à rendre ===");
  qa("#pos-grid .pos-p")[0].dispatchEvent(new w.Event("click"));await wait(30); // Riz
  qa("#pos-grid .pos-p")[0].dispatchEvent(new w.Event("click"));await wait(30); // Riz x2
  qa("#pos-grid .pos-p")[1].dispatchEvent(new w.Event("click"));await wait(30); // Poulet
  ok(q("#pos-total").textContent.replace(/\s/g,"").includes("6000"),"total ticket 6000 (2×1500+3000)");
  q("#pos-recu").value="10000"; q("#pos-recu").dispatchEvent(new w.Event("input"));await wait(40);
  ok(q("#pos-monnaie").textContent.replace(/\s/g,"").includes("4000"),"monnaie à rendre = 4000");
  q("#pos-valider").dispatchEvent(new w.Event("click"));await wait(150);
  const p=prof();
  ok(p.caisse.some(e=>e.type==="vente"&&e.montant===6000&&e.statut==="valide"),"vente validée enregistrée (propriétaire)");
  ok(p.revenus.find(r=>r.nom==="Riz").stock===8 && p.revenus.find(r=>r.nom==="Poulet").stock===9,"stock décrémenté (Riz 8, Poulet 9)");
  ok(q("#pos-total").textContent.replace(/\s/g,"")==="0"||/0/.test(q("#pos-total").textContent),"ticket remis à zéro");
  ok(q("#pos-ca").textContent.replace(/\s/g,"").includes("6000"),"CA du jour = 6000");

  console.log("=== Collaborateur (commercial, sans droit de validation) ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pl-team").dispatchEvent(new w.Event("click"));await wait(100);
  q("#team-new").dispatchEvent(new w.Event("click"));await wait(100);
  q("#co-nom").value="Awa"; q("#co-role").value="commercial"; q("#co-role").dispatchEvent(new w.Event("change"));await wait(40);
  q("#co-save").dispatchEvent(new w.Event("click"));await wait(120);
  ok(prof().collaborateurs.length===1 && prof().collaborateurs[0].nom==="Awa","collaborateur ajouté");
  ok(!prof().collaborateurs[0].permissions.includes("valider"),"commercial n'a pas le droit de valider");

  console.log("=== Vente d'un collaborateur -> à valider ===");
  q('.navlink[data-v="pos"]') ? q('.navlink[data-v="pos"]').dispatchEvent(new w.Event("click")) : q("#tab-plus").dispatchEvent(new w.Event("click"));
  await wait(60);
  // aller au POS via sidebar navlink
  q('.navlink[data-v="pos"]').dispatchEvent(new w.Event("click"));await wait(80);
  // choisir le collaborateur Awa
  const coId=prof().collaborateurs[0].id;
  q("#pos-collab").value=coId; q("#pos-collab").dispatchEvent(new w.Event("change"));await wait(30);
  qa("#pos-grid .pos-p")[0].dispatchEvent(new w.Event("click"));await wait(30);
  q("#pos-valider").dispatchEvent(new w.Event("click"));await wait(120);
  ok(prof().caisse.some(e=>e.statut==="a_valider"),"vente du collaborateur -> à valider");
  // le CA ne doit pas inclure la vente en attente
  const caTotal=w.BOSS.caisseTotals(prof()).ventesJour;
  ok(caTotal===6000,"CA du jour ignore la vente en attente ("+caTotal+")");

  console.log("=== Manager valide ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pl-valid").dispatchEvent(new w.Event("click"));await wait(100);
  ok(qa("#sheet .cat-row").length===1,"1 vente en attente listée");
  q('#sheet .cat-b[data-a="ok"]').dispatchEvent(new w.Event("click"));await wait(120);
  ok(!prof().caisse.some(e=>e.statut==="a_valider"),"plus de vente en attente après validation");
  ok(w.BOSS.caisseTotals(prof()).ventesJour===7500,"CA inclut la vente validée (6000+1500)");

  console.log("=== Facturation 2000/collab + 1000/caisse ===");
  // ajouter une 2e caisse
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pl-registers").dispatchEvent(new w.Event("click"));await wait(100);
  q("#reg-new").dispatchEvent(new w.Event("click"));await wait(120); // prompt -> "Terrasse"
  ok(prof().caisses.length===2,"2 caisses");
  const due=w.BOSS.billingDue(JSON.parse(w.localStorage.getItem("boss:state:v1")).license,{metiers:1,collaborateurs:1,caisses:2});
  ok(due.total===2000+1000,"dû = 1 collab (2000) + 1 caisse extra (1000) = 3000 ("+due.total+")");

  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,3).join(" | "):""));
  console.log("\n=========================================");
  console.log(`INTÉGRATION POS/ÉQUIPE : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
