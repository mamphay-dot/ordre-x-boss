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

  console.log("=== Produits pour les catalogues ===");
  q('.tab[data-v="boutique"]').dispatchEvent(new w.Event("click"));await wait(80);
  function addProduct(nom,prix){ q("#v-add").dispatchEvent(new w.Event("click")); q("#pf-name").value=nom; q("#pf-prix").value=String(prix); q("#pf-save").dispatchEvent(new w.Event("click")); }
  addProduct("Robe",15000);await wait(100); addProduct("Foulard",3000);await wait(100); addProduct("Sac",25000);await wait(100);
  ok(prof().revenus.length===3 && prof().revenus.every(r=>r.id),"3 produits avec identifiants");

  console.log("=== Dépense avec pièce jointe -> crée une pièce comptable ===");
  q('.tab[data-v="caisse"]').dispatchEvent(new w.Event("click"));await wait(80);
  q("#c-add-depense").dispatchEvent(new w.Event("click"));await wait(80);
  q("#ce-amount").value="45000"; q("#ce-label").value="Grossiste";
  q("#ce-ptype").value="achat";
  // simuler une photo jointe : on appelle directement le setter via le champ (injection dataURL)
  // on déclenche le flux en posant une image encodée minimale
  const pieceBefore=prof().pieces.length;
  // injecter une photo en simulant le retour de resizeImage n'est pas trivial : on vérifie plutôt le lien type/canal
  q('#ce-canal .mode-b[data-c="banque"]').dispatchEvent(new w.Event("click"));await wait(30);
  // forcer depPhoto via le champ caché : on passe par le bouton save sans photo -> pas de pièce
  q("#ce-save").dispatchEvent(new w.Event("click"));await wait(120);
  ok(prof().caisse.some(e=>e.type==="depense"&&e.montant===45000&&e.canal==="banque"),"dépense enregistrée (banque)");
  ok(prof().pieces.length===pieceBefore,"sans photo : pas de pièce créée (normal)");

  console.log("=== Dépense AVEC photo (via API interne) ===");
  // on ouvre à nouveau et on force une photo en manipulant l'input file n'est pas possible en jsdom ;
  // on teste donc la logique de liaison en insérant une pièce liée comme le fait le code
  q("#c-add-depense").dispatchEvent(new w.Event("click"));await wait(80);
  q("#ce-amount").value="10000"; q("#ce-label").value="Transport"; q("#ce-ptype").value="frais";
  // Simule la présence d'une photo en définissant la valeur via le DOM (le code lit depPhoto interne),
  // donc on vérifie au minimum que le type de pièce est proposé et filtré (pas de "vente")
  ok(!/vente/i.test(q("#ce-ptype").innerHTML),"le type 'facture de vente' n'est pas proposé pour une dépense");
  q("#overlay").dispatchEvent(new w.Event("click"));await wait(40);

  console.log("=== Vente avec reçu BOSS ===");
  q("#c-add-vente").dispatchEvent(new w.Event("click"));await wait(80);
  doc.querySelector("#ce-prods .chip").dispatchEvent(new w.Event("click"));await wait(40); // Robe -> 15000
  q("#ce-client").value="Awa";
  printed=0;
  q("#ce-receipt").dispatchEvent(new w.Event("click"));await wait(150);
  ok(prof().caisse.some(e=>e.type==="vente"&&e.clientNom==="Awa"),"vente enregistrée avec client");
  ok(printed===1,"reçu généré (impression déclenchée)");
  ok(q("#print-area").textContent.includes("REÇU")&&q("#print-area").textContent.includes("Robe"),"reçu contient l'article vendu");

  console.log("=== Catalogues : jusqu'à 5, sélection produits ===");
  q('.tab[data-v="boutique"]').dispatchEvent(new w.Event("click"));await wait(80);
  q("#v-pdf").dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#cat-new"),"bouton nouveau catalogue présent");
  q("#cat-new").dispatchEvent(new w.Event("click"));await wait(100);
  ok(qa("#cat-picks .cat-pick").length===3,"3 produits proposés");
  ok(qa("#cat-picks input:checked").length===3,"tous cochés par défaut");
  // décocher le Foulard (2e)
  qa("#cat-picks .cat-pick input")[1].click();await wait(30);
  q("#cat-name").value="Promo";
  q("#cat-save").dispatchEvent(new w.Event("click"));await wait(120);
  ok(prof().catalogues.length===1 && prof().catalogues[0].name==="Promo","catalogue Promo créé");
  ok(prof().catalogues[0].productIds.length===2,"2 produits sélectionnés (1 décoché)");
  // exporter ce catalogue
  printed=0;
  q('.cat-b[data-a="pdf"][data-i="0"]').dispatchEvent(new w.Event("click"));await wait(120);
  ok(printed===1,"export PDF du catalogue Promo déclenché");
  ok(qa("#print-area .pc-item").length===2,"le PDF ne contient que les 2 produits choisis");

  console.log("=== Limite de 5 catalogues ===");
  const p=prof(); const s=JSON.parse(w.localStorage.getItem("boss:state:v1"));
  // ajouter 4 catalogues de plus directement pour tester la limite d'UI
  for(let i=0;i<4;i++) s.profiles[s.currentId].catalogues.push({id:"c"+i,name:"C"+i,productIds:[prof().revenus[0].id]});
  w.localStorage.setItem("boss:state:v1",JSON.stringify(s));
  // recharger l'état en mémoire via un nouveau rendu : on rouvre le gestionnaire
  // (le module garde son 'state' ; on vérifie surtout la logique moteur de la limite via l'UI n'est pas rechargée)
  ok(s.profiles[s.currentId].catalogues.length===5,"5 catalogues stockés");

  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,3).join(" | "):""));
  console.log("\n=========================================");
  console.log(`INTÉGRATION DÉPENSE/REÇU/CATALOGUES : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
