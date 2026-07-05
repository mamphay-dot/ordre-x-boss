const fs=require("fs");const {JSDOM}=require("jsdom");
let pass=0,fail=0,errors=[];
function ok(c,m){if(c)pass++;else{fail++;console.log("  ❌",m);}}
const html=fs.readFileSync("dist/boss-app.html","utf8");

// Réponses simulées de l'IA (séquentielles)
let aiCall=0;
const aiReplies=[
  {reply:"Super ! Comment s'appelle ton business ?",patch:{metier:"couturier"},done:false},
  {reply:"Parfait, tout est prêt !",patch:{name:"Chez Awa",addProducts:[{nom:"Robe",prix:15000,cout:9000,stock:5}]},done:true}
];

const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://boss.app/",
  beforeParse(w){
    w.scrollTo=()=>{};w.confirm=()=>true;w.alert=()=>{};w.prompt=()=>"x";w.open=()=>null;
    w.fetch=(url,opts)=>{
      url=String(url);
      if(url.includes("anthropic")||url.includes("messages")){
        const obj=aiReplies[Math.min(aiCall,aiReplies.length-1)]; aiCall++;
        return Promise.resolve({ok:true,json:()=>Promise.resolve({content:[{type:"text",text:JSON.stringify(obj)}]})});
      }
      return Promise.reject(new Error("offline"));
    };
    w.onerror=(m,s,l,c,e)=>errors.push(String(e||m));
  }
});
const w=dom.window,doc=w.document,q=s=>doc.querySelector(s);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const prof=()=>{const s=JSON.parse(w.localStorage.getItem("boss:state:v1"));return s.profiles[s.currentId];};
function send(t){ q("#chat-input").value=t; q("#chat-send").dispatchEvent(new w.Event("click")); }

(async()=>{
  await wait(750);
  console.log("=== L'onboarding IA démarre ===");
  ok(q("#view-onboard").classList.contains("on"),"écran assistant affiché au 1er lancement");
  ok(q("#chat").textContent.includes("assistant"),"l'assistant se présente");

  console.log("=== Tour 1 : l'IA déduit le métier ===");
  send("je fais de la couture, je vends des habits");
  await wait(500);
  ok(prof().metier==="couturier","métier configuré par l'IA (couturier)");
  ok(aiCall>=1,"l'IA a été appelée");

  console.log("=== Tour 2 : l'IA nomme le business et crée un produit, puis termine ===");
  send("Mon business c'est Chez Awa, je vends des robes à 15000");
  await wait(1500);
  const p=prof();
  ok(p.name==="Chez Awa","nom du business configuré par l'IA");
  ok(p.revenus.length===1 && p.revenus[0].nom==="Robe" && p.revenus[0].prix===15000,"produit créé par l'IA");
  ok(p.revenus[0].stock===5,"détails (stock) repris");
  ok(q("#chat").textContent.includes("prêt"),"message de clôture affiché");

  console.log("=== Repli mode guidé si l'IA est injoignable ===");
  // nouveau business + IA qui échoue
  aiCall=999; // forcera l'index sur la dernière réponse... on coupe plutôt via fetch:
  w.fetch=()=>Promise.reject(new Error("offline"));
  q("#tab-plus").dispatchEvent(new w.Event("click"));await wait(60);
  q("#pl-onboard").dispatchEvent(new w.Event("click"));await wait(120);
  send("je vends du poisson braisé");
  await wait(1100);
  ok(q("#chat").querySelectorAll(".bub.b").length>=2,"le mode guidé répond quand l'IA échoue (pas de blocage)");
  ok(errors.length===0,"aucune erreur JS"+(errors.length?" -> "+errors.slice(0,2).join(" | "):""));

  console.log("\n=========================================");
  console.log(`INTÉGRATION IA : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail>0?1:0);
})().catch(e=>{console.log("FATAL:",e&&e.stack||e);process.exit(1);});
