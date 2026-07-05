const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[],opened=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");

let remote={value:null};
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){
    w.scrollTo=()=>{};w.confirm=()=>true;w.prompt=(m,d)=>d;w.alert=()=>{};
    w.open=(u)=>{opened.push(String(u));return null;};
    w.URL.createObjectURL=()=>"blob:x";w.URL.revokeObjectURL=()=>{};
    w.fetch=(url,opts)=>{
      url=String(url);
      if(url.indexOf("sync.example")>=0){
        if(opts&&opts.method==="PUT"){ remote.value=opts.body; return Promise.resolve({ok:true,text:()=>Promise.resolve("ok")}); }
        return Promise.resolve({ok:true,text:()=>Promise.resolve(remote.value||"null")});
      }
      return Promise.reject(new Error("offline"));
    };
    w.onerror=(m,s,l,c,e)=>errors.push(String(e||m));
  }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s),qa=s=>Array.from(doc.querySelectorAll(s));
const wait=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  await wait(350);

  console.log("=== STOCK : ajout produit + décrément à la vente ===");
  q('.tab[data-v="boutique"]').dispatchEvent(new w.Event("click"));await wait(100);
  q("#v-add").dispatchEvent(new w.Event("click"));await wait(100);
  q("#pf-name").value="Robe wax"; q("#pf-prix").value="15000"; q("#pf-cout").value="9000"; q("#pf-qte").value="20"; q("#pf-stock").value="10";
  q("#pf-save").dispatchEvent(new w.Event("click"));await wait(120);
  ok(doc.querySelector(".vc-stock")&&doc.querySelector(".vc-stock").textContent.includes("10"),"carte affiche 10 en stock");
  // vendre 3 via la caisse
  q('.tab[data-v="caisse"]').dispatchEvent(new w.Event("click"));await wait(100);
  q("#c-add-vente").dispatchEvent(new w.Event("click"));await wait(100);
  doc.querySelector("#ce-prods .chip").dispatchEvent(new w.Event("click"));await wait(60);
  q("#ce-qty").value="3"; q("#ce-qty").dispatchEvent(new w.Event("input"));await wait(60);
  ok(parseFloat(q("#ce-amount").value)===45000,"montant auto = prix×qté (15000×3)");
  q("#ce-save").dispatchEvent(new w.Event("click"));await wait(120);
  const st=JSON.parse(w.localStorage.getItem("boss:state:v1"));
  const prof=st.profiles[st.currentId];
  ok(prof.revenus[0].stock===7,"stock décrémenté à 7 après vente de 3 ("+prof.revenus[0].stock+")");
  q('.tab[data-v="stock"]')&&q('.tab[data-v="stock"]').dispatchEvent(new w.Event("click"));
  // la vue stock est accessible via sidebar/plus; on rend directement
  q("#side-plus");
  // vérifier rendu de la liste stock
  // (on force l'affichage via le menu Plus)

  console.log("=== CLIENTS ===");
  // ouvrir Plus -> clients
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pl-clients").dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#view-clients").classList.contains("on"),"vue clients affichée");
  q("#cl-add").dispatchEvent(new w.Event("click"));await wait(100);
  q("#cl-name").value="Awa"; q("#cl-phone").value="0700112233";
  q("#cl-save").dispatchEvent(new w.Event("click"));await wait(120);
  ok(qa("#cl-list .client-row").length===1,"client ajouté et listé");
  // le carnet propose ce client
  q(".navlink[data-v=\"carnet\"]").dispatchEvent(new w.Event("click"));await wait(80);
  q("#k-add").dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#dk-clients")&&doc.querySelector("#dk-clients .chip"),"carnet propose le client enregistré");
  doc.querySelector("#dk-clients .chip").dispatchEvent(new w.Event("click"));await wait(40);
  ok(q("#dk-client").value==="Awa"&&q("#dk-phone").value==="0700112233","sélection client remplit nom + téléphone");
  closeAll();

  console.log("=== HISTORIQUE (graphique) ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pl-historique").dispatchEvent(new w.Event("click"));await wait(120);
  ok(q("#view-historique").classList.contains("on"),"vue historique affichée");
  ok(q("#h-chart svg"),"graphique SVG rendu");
  ok(qa("#h-table .h-row").length===6,"tableau sur 6 mois");
  ok(q("#h-table").textContent.includes("45 000")||q("#h-table").textContent.replace(/\s/g,"").includes("45000"),"le mois courant montre la vente de 45000");

  console.log("=== TVA ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pl-config").dispatchEvent(new w.Event("click"));await wait(120);
  ok(q("#cfg-tva-enabled"),"carte TVA présente dans Réglages");
  q("#cfg-tva-enabled").checked=true; q("#cfg-tva-enabled").dispatchEvent(new w.Event("change"));await wait(100);
  q('.tab[data-v="dash"]').dispatchEvent(new w.Event("click"));await wait(100);
  ok(q("#d-coach").textContent.includes("TVA"),"tableau affiche la TVA collectée");

  console.log("=== PAIEMENT : lien Wave réel ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pl-pay").dispatchEvent(new w.Event("click"));await wait(120);
  q("#ps-wave").value="https://pay.wave.com/m/MERCHANT/c/ci/?amount={amount}";
  q("#ps-save").dispatchEvent(new w.Event("click"));await wait(120);
  // encaisser depuis la boutique
  q('.tab[data-v="boutique"]').dispatchEvent(new w.Event("click"));await wait(100);
  doc.querySelector("#v-grid .vc-btn.pay").dispatchEvent(new w.Event("click"));await wait(100);
  opened.length=0;
  q("#pay-amount").value="5000";
  q("#pay-go").dispatchEvent(new w.Event("click"));await wait(60);
  ok(opened.length===1 && opened[0].includes("pay.wave.com") && opened[0].includes("amount=5000"),"encaissement -> vrai lien Wave avec montant ("+(opened[0]||"")+")");

  console.log("=== SYNCHRONISATION ===");
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(80);
  q("#pl-sync").dispatchEvent(new w.Event("click"));await wait(120);
  q("#sy-url").value="https://sync.example/boss"; q("#sy-auto").checked=true;
  q("#sy-now").dispatchEvent(new w.Event("click"));await wait(200);
  ok(remote.value && remote.value.indexOf("profiles")>=0,"synchro: état poussé vers le distant");
  // simuler un autre appareil qui a un profil plus récent
  const future=Date.now()+1000000;
  remote.value=JSON.stringify({app:"BOSS",version:1,state:{profiles:{remoteOnly:{id:"remoteOnly",name:"Depuis autre tel",metier:"vendeur",unite:"articles",revenus:[],charges:[],caisse:[],carnet:[],clients:[],tva:{enabled:false,rate:18,pricesIncludeTax:true},pay:{},target:30,updatedAt:future}},currentId:"remoteOnly",updatedAt:future}});
  q("#sy-now").dispatchEvent(new w.Event("click"));await wait(200);
  const after=JSON.parse(w.localStorage.getItem("boss:state:v1"));
  ok(after.profiles["remoteOnly"]&&after.profiles["remoteOnly"].name==="Depuis autre tel","synchro: profil distant fusionné localement");

  console.log("=== Erreurs runtime ===");
  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,3).join(" | "):""));

  console.log("\n=========================================");
  console.log(`INTÉGRATION V2 : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);

  function closeAll(){ try{ q("#overlay").dispatchEvent(new w.Event("click")); }catch(e){} }
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});

function closeAll(){}
