const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[],printed=0;
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){ w.scrollTo=()=>{};w.confirm=()=>true;w.alert=()=>{};w.prompt=()=>"x";w.open=()=>null;w.print=()=>{printed++;};
    w.fetch=()=>Promise.reject(new Error("off")); w.onerror=(m,s,l,c,e)=>errors.push(String(e||m)); }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s),qa=s=>Array.from(doc.querySelectorAll(s));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const prof=()=>{const s=JSON.parse(w.localStorage.getItem("boss:state:v1"));return s.profiles[s.currentId];};

(async()=>{
  await wait(350);

  console.log("=== Identité & mentions légales ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(70);
  q("#pl-identity").dispatchEvent(new w.Event("click"));await wait(100);
  q("#id-name").value="Chez Awa"; q("#id-adresse").value="Cocody, Abidjan"; q("#id-tel").value="0700112233";
  q("#id-rccm").value="CI-ABJ-2026-B-12345"; q("#id-ncc").value="1234567 A"; q("#id-ment").value="Merci de votre confiance";
  q("#id-save").dispatchEvent(new w.Event("click"));await wait(120);
  const id=prof().identite;
  ok(prof().name==="Chez Awa"&&id.rccm.includes("12345")&&id.ncc==="1234567 A","identité + mentions légales enregistrées");

  console.log("=== Caisse par mode de règlement ===");
  q('.tab[data-v="caisse"]').dispatchEvent(new w.Event("click"));await wait(80);
  // vente banque
  q("#c-add-vente").dispatchEvent(new w.Event("click"));await wait(80);
  q("#ce-amount").value="80000";
  q('#ce-canal .mode-b[data-c="banque"]').dispatchEvent(new w.Event("click"));await wait(30);
  q("#ce-save").dispatchEvent(new w.Event("click"));await wait(120);
  // dépense banque
  q("#c-add-depense").dispatchEvent(new w.Event("click"));await wait(80);
  q("#ce-amount").value="50000";
  q('#ce-canal .mode-b[data-c="banque"]').dispatchEvent(new w.Event("click"));await wait(30);
  q("#ce-save").dispatchEvent(new w.Event("click"));await wait(120);
  // vente espèces
  q("#c-add-vente").dispatchEvent(new w.Event("click"));await wait(80);
  q("#ce-amount").value="15000"; q("#ce-save").dispatchEvent(new w.Event("click"));await wait(120);
  const caisse=prof().caisse;
  ok(caisse.filter(e=>e.canal==="banque").length===2,"2 mouvements banque");
  ok(caisse.some(e=>e.canal==="especes"&&e.montant===15000),"vente espèces enregistrée");

  console.log("=== Trésorerie : soldes par compte ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(70);
  q("#pl-treso").dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#view-tresorerie").classList.contains("on"),"vue trésorerie affichée");
  // solde initial banque 200000
  q("#tr-opening").dispatchEvent(new w.Event("click"));await wait(100);
  q("#ob-banque").value="200000"; q("#ob-especes").value="10000";
  q("#ob-save").dispatchEvent(new w.Event("click"));await wait(120);
  const bal=w.BOSS.treasuryBalances(prof());
  ok(bal.banque===200000+80000-50000,"solde banque = 230000 ("+bal.banque+")");
  ok(bal.especes===10000+15000,"solde espèces = 25000 ("+bal.especes+")");
  ok(q("#tr-total").textContent.replace(/\s/g,"").includes("255000"),"trésorerie totale affichée");

  console.log("=== Rapprochement bancaire ===");
  q("#tr-stmt").value="230000"; q("#tr-stmt").dispatchEvent(new w.Event("change"));await wait(100);
  const movs=qa("#tr-movs .tr-mov");
  ok(movs.length===2,"2 mouvements bancaires à pointer");
  movs.forEach(m=>{ const c=m.querySelector("input"); if(!c.checked){ c.checked=true; c.dispatchEvent(new w.Event("change")); } });
  await wait(200);
  ok(q("#tr-badge").textContent.includes("Rapproch"),"badge « Rapproché » après pointage (écart nul)");
  ok(q("#tr-ecart").textContent.replace(/\s/g,"").includes("0"),"écart nul");

  console.log("=== Reçu PDF (avec identité) ===");
  // créer une commande livrée pour générer un reçu
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pl-commandes").dispatchEvent(new w.Event("click"));await wait(80);
  q("#cmd-add").dispatchEvent(new w.Event("click"));await wait(80);
  q("#oe-name").value="Client Test"; q("#oe-total") && (q("#oe-total").value="20000");
  // pas de produits -> champ total
  if(q("#oe-total")) q("#oe-total").value="20000";
  q("#oe-save").dispatchEvent(new w.Event("click"));await wait(150);
  const idx=prof().commandes.length-1;
  ok(idx>=0,"commande créée");
  // ouvrir le menu de la commande et générer le reçu
  const moreBtn=q('#cmd-list .cmd-b[data-a="more"]');
  ok(moreBtn,"bouton menu commande présent");
  printed=0;
  moreBtn.dispatchEvent(new w.Event("click"));await wait(100);
  q("#om-receipt").dispatchEvent(new w.Event("click"));await wait(120);
  ok(printed===1,"impression du reçu déclenchée");
  const pa=q("#print-area");
  ok(pa.textContent.includes("REÇU")&&pa.textContent.includes("Chez Awa"),"reçu contient le titre et le nom du business");
  ok(pa.textContent.includes("RCCM")&&pa.textContent.includes("12345"),"reçu contient les mentions légales");

  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,3).join(" | "):""));
  console.log("\n=========================================");
  console.log(`INTÉGRATION IDENTITÉ/TRÉSO/REÇU : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
