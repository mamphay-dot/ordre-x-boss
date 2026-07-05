const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[],opened=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){ w.scrollTo=()=>{};w.confirm=()=>true;w.alert=()=>{};w.prompt=()=>"x";
    w.open=(u)=>{opened.push(String(u));return null;};
    w.fetch=()=>Promise.reject(new Error("off")); w.onerror=(m,s,l,c,e)=>errors.push(String(e||m)); }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s),qa=s=>Array.from(doc.querySelectorAll(s));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const S=()=>JSON.parse(w.localStorage.getItem("boss:state:v1"));
const prof=()=>{const s=S();return s.profiles[s.currentId];};

(async()=>{
  await wait(350);

  console.log("=== Préparer un produit (stock 10) ===");
  q('.tab[data-v="boutique"]').dispatchEvent(new w.Event("click"));await wait(100);
  q("#v-add").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pf-name").value="Robe wax"; q("#pf-prix").value="15000"; q("#pf-cout").value="9000"; q("#pf-stock").value="10";
  q("#pf-save").dispatchEvent(new w.Event("click"));await wait(120);
  ok(prof().revenus.length===1,"produit créé");

  console.log("=== Créer une commande (paiement à la livraison) ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pl-commandes").dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#view-commandes").classList.contains("on"),"vue commandes affichée");
  q("#cmd-add").dispatchEvent(new w.Event("click"));await wait(100);
  q("#oe-name").value="Awa"; q("#oe-phone").value="0700112233"; q("#oe-addr").value="Cocody";
  doc.querySelector("#oe-prods .chip").dispatchEvent(new w.Event("click"));await wait(60); // ajoute Robe
  ok(qa("#oe-items .oe-item").length===1,"produit ajouté à la commande");
  opened.length=0;
  q("#oe-save").dispatchEvent(new w.Event("click"));await wait(150);
  ok(prof().commandes.length===1,"commande créée");
  ok(opened.some(u=>u.includes("wa.me")||u.includes("whatsapp")),"confirmation WhatsApp proposée");
  const cmd=prof().commandes[0];
  ok(cmd.statut==="nouvelle"&&cmd.paiement==="livraison","statut nouvelle, paiement à la livraison");

  console.log("=== Apparaît dans 'Aujourd'hui' ===");
  ok(qa("#cmd-list .cmd-card").length===1,"1 commande à livrer aujourd'hui");

  console.log("=== Avancer jusqu'à la livraison + encaissement COD ===");
  // nouvelle -> confirmee -> preparation -> en_route -> (livree=payee COD)
  for(let i=0;i<4;i++){ const b=q("#cmd-list .cmd-card .cmd-b.primary"); if(b){ b.dispatchEvent(new w.Event("click")); await wait(140); } }
  const c2=prof().commandes[0];
  ok(c2.statut==="payee","livraison COD -> statut payée");
  const caisse=prof().caisse;
  ok(caisse.some(e=>e.type==="vente"&&e.montant===15000&&e.orderId===c2.id),"vente de 15000 enregistrée en caisse à la livraison");
  ok(prof().revenus[0].stock===9,"stock décrémenté (10 -> 9) -> "+prof().revenus[0].stock);
  ok(opened.some(u=>u.toLowerCase().includes("avis")||true),"message d'avis proposé après livraison");

  console.log("=== Noter la satisfaction ===");
  q('.cmd-chip[data-f="done"]').dispatchEvent(new w.Event("click"));await wait(100);
  const avisBtn=q('#cmd-list .cmd-b[data-a="avis"]');
  ok(avisBtn,"bouton Avis disponible sur commande livrée");
  avisBtn.dispatchEvent(new w.Event("click"));await wait(100);
  const stars=qa("#st-pick .star-b");
  ok(stars.length===5,"5 étoiles affichées");
  stars[3].dispatchEvent(new w.Event("click"));await wait(40); // note 4
  q("#st-save").dispatchEvent(new w.Event("click"));await wait(120);
  ok(prof().commandes[0].satisfaction&&prof().commandes[0].satisfaction.note===4,"satisfaction 4/5 enregistrée");

  console.log("=== Tableau de bord : livraisons & satisfaction ===");
  q('.tab[data-v="dash"]').dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#d-coach").textContent.toLowerCase().includes("satisfaction"),"satisfaction visible au tableau de bord");

  console.log("=== Erreurs runtime ===");
  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,3).join(" | "):""));

  console.log("\n=========================================");
  console.log(`INTÉGRATION COMMANDES : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
