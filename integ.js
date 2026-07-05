const fs=require("fs");
const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[],openedUrls=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}

const html=fs.readFileSync("dist/boss-app.html","utf8");

// storage simulé (comme window.storage de l'environnement artifact)
const memStore={};
const fakeStorage={
  async get(k){ if(memStore[k]==null) throw new Error("not found"); return {key:k,value:memStore[k],shared:false}; },
  async set(k,v){ memStore[k]=v; return {key:k,value:v,shared:false}; },
  async delete(k){ delete memStore[k]; return {key:k,deleted:true}; },
  async list(){ return {keys:Object.keys(memStore)}; }
};

const dom=new JSDOM(html,{
  runScripts:"dangerously",
  pretendToBeVisual:true,
  url:"https://example.com/",
  beforeParse(window){
    window.storage=fakeStorage;
    window.scrollTo=()=>{};
    window.confirm=()=>true;
    window.prompt=(m,d)=>d||"Test business";
    window.fetch=()=>Promise.reject(new Error("offline test")); // force le repli local du coach
    window.alert=()=>{};
    window.open=(u)=>{openedUrls.push(u);return null;};
    window.onerror=(msg,src,l,c,err)=>{errors.push(String(err||msg));};
  }
});
const {window}=dom;
const doc=window.document;

window.addEventListener("error",e=>errors.push(String(e.error||e.message)));

function wait(ms){return new Promise(r=>setTimeout(r,ms));}
const q=s=>doc.querySelector(s);

(async()=>{
  // laisser le DOMContentLoaded + restore() s'exécuter
  await wait(300);

  console.log("=== Boot ===");
  ok(q("#cur-name").textContent.length>0,"topbar profil affiché");
  ok(q("#view-onboard").classList.contains("on"),"démarre sur l'onboarding (profil vide)");
  ok(q("#chat").children.length>0,"BOSS a posé la 1re question");

  console.log("=== Conversation d'auto-config (entrées simulées) ===");
  async function say(text){
    q("#chat-input").value=text;
    q("#chat-send").dispatchEvent(new window.Event("click"));
    await wait(120); // laisse passer les setTimeout de bulles
  }
  await say("je vends du poulet braisé et des boissons");
  await wait(200);
  await say("3000 la part, ça me coûte 1500");
  await wait(200);
  await say("300 par mois");
  await wait(200);
  await say("non");
  await wait(200);
  await say("150000");
  await wait(200);
  await say("salaires 250000 et électricité 60000");
  await wait(700);

  // lire l'état persistant
  const st=JSON.parse(memStore["boss:state:v1"]);
  const prof=st.profiles[st.currentId];
  ok(prof.metier==="maquis","conversation: métier maquis configuré et persisté");
  ok(prof.revenus.length>=1,"conversation: produit(s) enregistré(s)");
  ok(prof.revenus[0].prix===3000 && prof.revenus[0].cout===1500,"conversation: prix/coût corrects");
  ok(prof.revenus[0].qte===300,"conversation: quantité correcte");
  ok(prof.charges.some(c=>c.montant===150000),"conversation: loyer enregistré");
  ok(prof.charges.length>=2,"conversation: charges multiples enregistrées");

  console.log("=== Navigation onglets ===");
  q('.tab[data-v="dash"]').dispatchEvent(new window.Event("click"));
  await wait(150);
  ok(q("#view-dash").classList.contains("on"),"bascule vers tableau de bord");
  ok(q("#d-net").textContent.includes("F"),"bénéfice net affiché: "+q("#d-net").textContent);
  ok(q("#d-ca").textContent.includes("F"),"CA affiché: "+q("#d-ca").textContent);
  ok(q("#d-coach").children.length>0,"coach affiche des conseils");
  ok(q("#d-prices").children.length>0,"prix conseillés affichés");

  q('.tab[data-v="config"],.navlink[data-v="config"]').dispatchEvent(new window.Event("click"));
  await wait(150);
  ok(q("#view-config").classList.contains("on"),"bascule vers réglages");
  ok(q("#cfg-rev").children.length===prof.revenus.length,"réglages: lignes de vente affichées");
  ok(q("#cfg-charge").children.length===prof.charges.length,"réglages: charges affichées");

  console.log("=== Édition manuelle (100% paramétrable) ===");
  const firstPrice=q('#cfg-rev .lrow input[data-f="prix"]');
  firstPrice.value="5000";
  firstPrice.dispatchEvent(new window.Event("input"));
  await wait(120);
  const st2=JSON.parse(memStore["boss:state:v1"]);
  ok(st2.profiles[st2.currentId].revenus[0].prix===5000,"édition manuelle du prix persistée");

  // ajouter une ligne
  q("#cfg-addrev").dispatchEvent(new window.Event("click"));
  await wait(120);
  const st3=JSON.parse(memStore["boss:state:v1"]);
  ok(st3.profiles[st3.currentId].revenus.length===prof.revenus.length+1,"ajout d'une ligne de vente");

  console.log("=== Boutique / Vitrine ===");
  q('.tab[data-v="boutique"]').dispatchEvent(new window.Event("click"));
  await wait(150);
  ok(q("#view-boutique").classList.contains("on"),"bascule vers la boutique");
  const before=JSON.parse(memStore["boss:state:v1"]).profiles[st.currentId].revenus.length;
  // ajouter un produit
  q("#v-add").dispatchEvent(new window.Event("click"));
  await wait(120);
  ok(q("#pf-name")!=null,"éditeur produit ouvert");
  q("#pf-name").value="Sauce graine maison";
  q("#pf-prix").value="2500";
  q("#pf-qte").value="120";
  // génération IA (fetch coupé -> repli local) : doit remplir la description
  q("#pf-gen").dispatchEvent(new window.Event("click"));
  await wait(250);
  ok(q("#pf-desc").value.length>0,"description générée (repli local): «"+q("#pf-desc").value.slice(0,40)+"…»");
  q("#pf-save").dispatchEvent(new window.Event("click"));
  await wait(150);
  const after=JSON.parse(memStore["boss:state:v1"]).profiles[st.currentId].revenus;
  ok(after.length===before+1,"produit ajouté à la boutique");
  const np=after[after.length-1];
  ok(np.vitrine===true && np.desc.length>0 && np.prix===2500,"produit a description, prix, flag vitrine");
  ok(doc.querySelectorAll("#v-grid .vcard").length===after.length,"catalogue affiche toutes les cartes");
  // partager le catalogue -> ouvre un lien wa.me
  openedUrls.length=0;
  q("#v-share").dispatchEvent(new window.Event("click"));
  await wait(80);
  ok(openedUrls.length===1 && openedUrls[0].startsWith("https://wa.me/"),"partage catalogue -> lien WhatsApp");
  ok(decodeURIComponent(openedUrls[0]).includes("Sauce graine maison"),"le catalogue partagé liste le produit");
  // encaisser un produit
  doc.querySelector("#v-grid .vc-btn.pay").dispatchEvent(new window.Event("click"));
  await wait(120);
  ok(q("#pay-go")!=null,"sheet d'encaissement ouverte");
  q("#pay-phone").value="0700112233";
  openedUrls.length=0;
  q("#pay-go").dispatchEvent(new window.Event("click"));
  await wait(80);
  ok(openedUrls.length===1 && openedUrls[0].includes("0700112233"),"demande de paiement -> WhatsApp au client");
  ok(decodeURIComponent(openedUrls[0]).includes("Wave"),"demande de paiement mentionne l'opérateur");

  console.log("=== Coach IA (repli local car fetch coupé) ===");
  q(".ai-quick").dispatchEvent(new window.Event("click"));
  await wait(300);
  ok(q("#ai-log").children.length>=2,"coach répond même hors-ligne (repli local)");

  console.log("=== Multi-profils ===");
  q("#profbtn").dispatchEvent(new window.Event("click"));
  await wait(120);
  ok(q("#sheet").classList.contains("on"),"panneau profils ouvert");
  q("#sheet .sheet-add").dispatchEvent(new window.Event("click"));
  await wait(300);
  const st4=JSON.parse(memStore["boss:state:v1"]);
  ok(Object.keys(st4.profiles).length===2,"2e business créé");
  ok(st4.currentId!==st.currentId,"bascule sur le nouveau business");
  // le nouveau profil est vierge -> onboarding
  ok(q("#view-onboard").classList.contains("on"),"nouveau business -> retour onboarding");

  console.log("=== Persistance entre sessions (re-boot) ===");
  // simuler un rechargement: nouvelle JSDOM avec le même storage
  const dom2=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://example.com/",
    beforeParse(w){w.storage=fakeStorage;w.scrollTo=()=>{};w.confirm=()=>true;w.prompt=(m,d)=>d;w.fetch=()=>Promise.reject(new Error("x"));w.alert=()=>{};}});
  await wait(300);
  const d2=dom2.window.document;
  ok(d2.querySelector("#cur-name").textContent.length>0,"après reboot: profil rechargé depuis le storage");
  const st5=JSON.parse(memStore["boss:state:v1"]);
  ok(Object.keys(st5.profiles).length===2,"après reboot: les 2 business sont conservés");

  console.log("=== Erreurs runtime ===");
  ok(errors.length===0,"aucune erreur JS pendant tout le parcours"+(errors.length?(" -> "+errors.slice(0,3).join(" | ")):""));

  console.log("\n=========================================");
  console.log(`INTÉGRATION : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("ERREUR FATALE:",e);process.exit(1);});
