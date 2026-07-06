/* ============================================================
   BOSS — Interface application (s'appuie sur engine.js déjà testé)
   ============================================================ */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};

/* ---------- Persistance (window.storage si dispo, sinon mémoire) ---------- */
/* ---------- IndexedDB minimal (clé/valeur) ---------- */
const IDB=(function(){
  let dbp=null;
  function open(){
    if(dbp) return dbp;
    dbp=new Promise((res,rej)=>{
      try{
        const r=indexedDB.open("bossdb",1);
        r.onupgradeneeded=()=>{ r.result.createObjectStore("kv"); };
        r.onsuccess=()=>res(r.result);
        r.onerror=()=>rej(r.error);
      }catch(e){ rej(e); }
    });
    return dbp;
  }
  return {
    async get(k){ const db=await open(); return new Promise((res,rej)=>{ const t=db.transaction("kv","readonly").objectStore("kv").get(k); t.onsuccess=()=>res(t.result==null?null:t.result); t.onerror=()=>rej(t.error); }); },
    async set(k,v){ const db=await open(); return new Promise((res,rej)=>{ const t=db.transaction("kv","readwrite").objectStore("kv").put(v,k); t.onsuccess=()=>res(true); t.onerror=()=>rej(t.error); }); }
  };
})();

/* ---------- Couche de stockage (persiste hors de Claude) ---------- */
const Store={
  mem:{}, mode:"memory",
  async init(){
    // priorité : artifact Claude > IndexedDB (app installée) > localStorage > mémoire
    if(typeof window!=="undefined" && window.storage){ this.mode="artifact"; return; }
    if(typeof indexedDB!=="undefined"){ try{ await IDB.set("__t","1"); this.mode="idb"; return; }catch(e){} }
    try{ if(typeof localStorage!=="undefined"){ localStorage.setItem("__t","1"); localStorage.removeItem("__t"); this.mode="local"; return; } }catch(e){}
    this.mode="memory";
  },
  async get(k){
    try{
      if(this.mode==="artifact"){ const r=await window.storage.get(k); return r?r.value:null; }
      if(this.mode==="idb"){ return await IDB.get(k); }
      if(this.mode==="local"){ const v=localStorage.getItem(k); return v==null?null:v; }
    }catch(e){}
    return this.mem[k]!=null?this.mem[k]:null;
  },
  async set(k,v){
    this.mem[k]=v;
    try{
      if(this.mode==="artifact"){ await window.storage.set(k,v,false); return true; }
      if(this.mode==="idb"){ await IDB.set(k,v); return true; }
      if(this.mode==="local"){ localStorage.setItem(k,v); return true; }
    }catch(e){ return false; }
    return true;
  },
  label(){ return {artifact:"Sauvegarde Claude",idb:"Sauvegarde sur l'appareil",local:"Sauvegarde locale",memory:"Session uniquement"}[this.mode]; }
};
const KEY="boss:state:v1";
let state={profiles:{},currentId:null};
async function persist(){ state.updatedAt=Date.now(); const c=cur(); if(c) c.updatedAt=state.updatedAt; const okSave=await Store.set(KEY, JSON.stringify(state)); if(okSave===false){ flashSaveWarning(); } scheduleSync(); scheduleCloudPush(); }
let __cloudTimer=null;
function scheduleCloudPush(){
  if(typeof Cloud === "undefined") return;
  if(!Cloud.available() || !Cloud.session() || !Cloud.currentOrgId()) return;
  clearTimeout(__cloudTimer);
  __cloudTimer = setTimeout(()=>{ Cloud.pushLocal(); }, 1500);
}
async function restore(){
  const raw=await Store.get(KEY);
  if(raw){ try{state=JSON.parse(raw);}catch(e){} }
  if(!state.profiles) state.profiles={};
  Object.values(state.profiles).forEach(p=>BOSS.ensureProfile(p));
  let created=false;
  if(!state.theme){ state.theme={mode:"dark",accent:"#C8A23A"}; created=true; }
  if(!state.deviceId){ state.deviceId=genDeviceId(); created=true; }
  if(!state.license){ state.license=BOSS.defaultLicense(); created=true; }
  if(!state.admin){ state.admin={role:"proprietaire"}; created=true; }
  if(!state.ai){ state.ai={url:"",key:"",model:"openai",enabled:true,provider:"pollinations"}; created=true; }
  else if(!state.ai.provider){ state.ai.provider=(state.ai.url&&state.ai.url.includes("anthropic"))?"anthropic":(state.ai.key?"anthropic":"pollinations"); created=true; }
  if(!state.currentId || !state.profiles[state.currentId]){
    const p=BOSS.blankProfile("Mon business");
    state.profiles[p.id]=p; state.currentId=p.id; created=true;
  }
  if(created) await persist();
}
const cur=()=>state.profiles[state.currentId];
function flashSaveWarning(){ try{ const n=$("#save-warn"); if(n){ n.style.display="block"; setTimeout(()=>n.style.display="none",4000);} }catch(e){} }

/* ---------- Navigation ---------- */
function showView(v){
  $$(".view").forEach(x=>x.classList.remove("on"));
  $("#view-"+v).classList.add("on");
  $$(".tab,.navlink").forEach(t=>t.classList.toggle("on",t.dataset.v===v));
  if(v==="config") renderConfig();
  if(v==="boutique") renderVitrine();
  if(v==="caisse") renderCaisse();
  if(v==="pos") renderPOS();
  if(v==="carnet") renderCarnet();
  if(v==="stock") renderStock();
  if(v==="clients") renderClients();
  if(v==="commandes") renderCommandes();
  if(v==="pieces") renderPieces();
  if(v==="tresorerie") renderTreso();
  if(v==="historique") renderHistorique();
  if(v==="dash") renderDash();
  enforceLicense();
  window.scrollTo({top:0,behavior:"smooth"});
}

/* ---------- Barre profils ---------- */
function renderTopbar(){
  const p=cur();
  const m=BOSS.METIERS[p.metier];
  $("#cur-name").textContent=p.name;
  const cm=$("#cur-metier"); if(!cm) return;
  if(!m){ cm.textContent="—"; return; }
  const icName=METIER_IC[p.metier]||"boutique";
  cm.innerHTML=ic(icName)+" "+escapeHtml(m.name);
}
function openProfiles(){
  const sheet=$("#sheet"); sheet.innerHTML="";
  const head=el("div","sheet-head","<h3>Tes business</h3><button class='x' id='sheet-close'>×</button>");
  sheet.appendChild(head);
  Object.values(state.profiles).forEach(p=>{
    const m=BOSS.METIERS[p.metier];
    const icName=METIER_IC[p.metier]||"boutique";
    const row=el("div","prof-row"+(p.id===state.currentId?" on":""));
    row.innerHTML=`<div class="pr-ic">${ic(icName)}</div>
      <div class="pr-info"><div class="pr-n">${escapeHtml(p.name)}</div><div class="pr-m">${m?m.name:""}</div></div>
      ${Object.keys(state.profiles).length>1?`<button class="pr-del" data-id="${p.id}" title="Supprimer">${ic("del")}</button>`:""}`;
    row.querySelector(".pr-info").onclick=async()=>{state.currentId=p.id;await persist();closeSheet();refreshAll();};
    row.querySelector(".pr-ic").onclick=row.querySelector(".pr-info").onclick;
    const del=row.querySelector(".pr-del");
    if(del) del.onclick=async(e)=>{e.stopPropagation(); if(confirm("Supprimer « "+p.name+" » ?")){ delete state.profiles[p.id]; if(state.currentId===p.id) state.currentId=Object.keys(state.profiles)[0]; await persist(); openProfiles(); refreshAll(); }};
    sheet.appendChild(row);
  });
  const add=el("button","sheet-add","+ Nouveau business");
  add.onclick=async()=>{
    const name=prompt("Nom du nouveau business ?","Mon business");
    if(name===null) return;
    const p=BOSS.blankProfile(name||"Mon business");
    state.profiles[p.id]=p; state.currentId=p.id; await persist();
    closeSheet(); refreshAll(); startOnboard(); showView("onboard");
  };
  sheet.appendChild(add);
  $("#sheet-close").onclick=closeSheet;
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function closeSheet(){ $("#overlay").classList.remove("on"); $("#sheet").classList.remove("on"); }

/* ---------- ONBOARDING conversationnel ---------- */
let conv=null;
let aiTurns=[], aiDisabledForSession=false;

/* ============ ASSISTANT IA ============ */
/* 3 providers pris en charge :
   - pollinations : gratuit, sans clé, sans compte (par défaut).
   - anthropic    : clé et modèle Claude à fournir (avancé).
   - openai       : URL compatible OpenAI + clé (Groq, OpenRouter, …).
*/
async function aiComplete(messages,system,maxTokens){
  const cfg=state.ai||{};
  if(cfg.enabled===false) return null;
  const provider=cfg.provider||"pollinations";

  // Provider POLLINATIONS (gratuit, aucun compte)
  if(provider==="pollinations"){
    const msgs=(system?[{role:"system",content:system}]:[]).concat(messages||[]);
    const body={ messages: msgs, model: cfg.model||"openai", private:true, seed: Math.floor(Math.random()*1e6) };
    try{
      const resp=await fetch("https://text.pollinations.ai/", {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
      });
      if(!resp.ok) return null;
      const txt=await resp.text();
      // Pollinations renvoie du texte brut ; certains modèles enveloppent en JSON
      try{ const j=JSON.parse(txt); return (j.choices?.[0]?.message?.content)||j.content||txt; }
      catch(_){ return txt.trim()||null; }
    }catch(e){ return null; }
  }

  // Provider ANTHROPIC (Claude direct)
  if(provider==="anthropic"){
    const url=(cfg.url&&cfg.url.trim())||"https://api.anthropic.com/v1/messages";
    const body={model:cfg.model||"claude-sonnet-4-5",max_tokens:maxTokens||700,messages};
    if(system) body.system=system;
    const headers={"Content-Type":"application/json"};
    if(cfg.key){ headers["x-api-key"]=cfg.key; headers["anthropic-version"]="2023-06-01"; }
    try{
      const resp=await fetch(url,{method:"POST",headers,body:JSON.stringify(body)});
      if(!resp.ok) return null;
      const data=await resp.json();
      return (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").trim()||null;
    }catch(e){ return null; }
  }

  // Provider OPENAI-compatible (Groq, OpenRouter, Together…)
  if(provider==="openai"){
    const url=(cfg.url&&cfg.url.trim())||"https://api.groq.com/openai/v1/chat/completions";
    const msgs=(system?[{role:"system",content:system}]:[]).concat(messages||[]);
    const body={model:cfg.model||"llama-3.1-8b-instant",messages:msgs,max_tokens:maxTokens||700};
    const headers={"Content-Type":"application/json"};
    if(cfg.key) headers["Authorization"]="Bearer "+cfg.key;
    try{
      const resp=await fetch(url,{method:"POST",headers,body:JSON.stringify(body)});
      if(!resp.ok) return null;
      const data=await resp.json();
      return data.choices?.[0]?.message?.content||null;
    }catch(e){ return null; }
  }

  return null;
}
function aiOnboardSystem(){
  const metiers=BOSS.METIER_ORDER.join(", ");
  return "Tu es l'assistant de configuration de BOSS, une app de gestion pour micro-entrepreneurs d'Afrique de l'Ouest francophone. Pose UNE question simple à la fois, en français clair et chaleureux (nouchi ivoirien bienvenu), en FCFA, pour comprendre le business et le configurer.\n"
   +"Découvre : le type d'activité, le nom du business, les principaux produits/services avec leur PRIX de vente (et si possible le coût et le stock), et les grosses charges fixes (loyer, etc.).\n"
   +"À CHAQUE réponse de l'utilisateur, réponds UNIQUEMENT par un objet JSON valide, sans aucun texte autour, de la forme :\n"
   +'{"reply":"ta prochaine question ou confirmation, courte","patch":{"name":"...","metier":"un parmi: '+metiers+'","unite":"...","addProducts":[{"nom":"...","prix":0,"cout":0,"stock":0}],"addCharges":[{"nom":"...","montant":0}],"target":30},"done":false}\n'
   +'Ne mets dans "patch" que ce que tu viens d\'apprendre. Choisis "metier" dans la liste, le plus proche, sinon "vendeur". Quand tu as au moins le nom, le métier et 1-2 produits avec prix, passe "done":true avec un "reply" de clôture encourageant. Ne répète pas une info déjà connue. Reste bref.';
}
function onboardDone(p){
  const f=BOSS.computeFinancials(p);
  const msg=f.seuilCA>0
    ? `C'est bon patron, ton business est prêt ✅ Tu dois faire environ ${BOSS.fmtF(f.seuilCA)} de ventes par mois pour ne rien perdre. Regarde ton tableau de bord 👇`
    : `C'est bon patron, ton business est prêt ✅ Ajuste tes chiffres dans Réglages quand tu veux. Regarde ton tableau de bord 👇`;
  setTimeout(()=>{ botSay(msg); const go=el("button","chat-cta","Voir mon tableau de bord"); go.onclick=()=>showView("dash"); setTimeout(()=>{$("#chat").appendChild(go);$("#chat").scrollTop=$("#chat").scrollHeight;},700); },600);
  refreshAll(); renderTopbar();
}
function startOnboard(){
  conv=BOSS.startConversation();
  aiTurns=[]; aiDisabledForSession=false;
  $("#chat").innerHTML="";
  botSay("Bonjour patron 👋 Je suis ton assistant BOSS. Dis-moi, tu fais quoi comme business ?");
  $("#chat-input").value="";
  $("#chat-input").focus&&$("#chat-input").focus();
}
function bubble(cls,html){ const b=el("div","bub "+cls,html); $("#chat").appendChild(b); $("#chat").scrollTop=$("#chat").scrollHeight; return b; }
function botSay(text){
  const typing=bubble("b typing","<span class='dots'><i></i><i></i><i></i></span>");
  setTimeout(()=>{ typing.classList.remove("typing"); typing.innerHTML=`<div class="who">BOSS</div>${escapeHtml(text)}`; $("#chat").scrollTop=$("#chat").scrollHeight; },450);
}
function userSay(text){ bubble("u",`<div class="who">Toi</div>${escapeHtml(text)}`); }
function configChip(text){ const c=el("div","cfg-chip",`⚙️ ${escapeHtml(text)} <span class="tick">✓</span>`); $("#chat").appendChild(c); $("#chat").scrollTop=$("#chat").scrollHeight; }

async function handleUser(text){
  text=text.trim(); if(!text) return;
  userSay(text);
  const p=cur();
  let used=false;
  // 1) Assistant IA dynamique (si joignable)
  if(!aiDisabledForSession){
    aiTurns.push({role:"user",content:text});
    const typing=bubble("b typing","<span class='dots'><i></i><i></i><i></i></span>");
    const reply=await aiComplete(aiTurns,aiOnboardSystem(),700);
    try{ typing.remove(); }catch(e){}
    const obj=reply?BOSS.parseAIjson(reply):null;
    if(obj){
      aiTurns.push({role:"assistant",content:reply});
      const res=BOSS.applyAIPatch(p,obj.patch||{});
      await persist();
      (res.events||[]).forEach(e=>setTimeout(()=>configChip(e),250));
      if(res.done||obj.done){ onboardDone(p); }
      else setTimeout(()=>botSay(obj.reply||"D'accord 👍"),400);
      used=true;
    } else {
      // l'IA n'est pas joignable/utile -> bascule en mode guidé pour la session
      aiDisabledForSession=true; if(aiTurns.length) aiTurns.pop();
    }
  }
  // 2) Repli déterministe (mode guidé, 100% hors-ligne)
  if(!used){
    const r=BOSS.conversationStep(conv,text,p);
    BOSS.applyPatch(p,r.patch);
    await persist();
    (r.events||[]).forEach(e=>setTimeout(()=>configChip(e),300));
    if(r.bot==="__SUMMARY__"){ onboardDone(p); renderTopbar(); return; }
    setTimeout(()=>botSay(r.bot),600);
  }
  renderTopbar();
}

/* ---------- CONFIG manuelle (100% paramétrable) ---------- */
function renderConfig(){
  const p=cur();
  // métiers
  const chips=$("#cfg-metiers"); chips.innerHTML="";
  BOSS.METIER_ORDER.forEach(k=>{
    const m=BOSS.METIERS[k];
    const c=el("button","chip"+(k===p.metier?" on":""),`<span class="ic">${m.ic}</span>${m.name}`);
    c.onclick=async()=>{
      if(p.metier!==k && (p.revenus.length||p.charges.length)){
        if(!confirm("Changer de métier va remplacer tes lignes par l'exemple « "+m.name+" ». Continuer ?")) return;
      }
      const np=BOSS.presetProfile(k,p.name); np.id=p.id; np.target=p.target;
      state.profiles[p.id]=np; await persist(); renderConfig(); renderTopbar();
    };
    chips.appendChild(c);
  });
  $("#cfg-name").value=p.name;
  $("#cfg-unite").textContent=p.unite||(BOSS.METIERS[p.metier]?BOSS.METIERS[p.metier].unite:"");
  // ventes
  const rl=$("#cfg-rev"); rl.innerHTML="";
  p.revenus.forEach((r,i)=>{
    const row=el("div","lrow");
    row.innerHTML=`<input class="f name" value="${escapeAttr(r.nom)}" data-i="${i}" data-f="nom">
      <input class="f" type="number" inputmode="numeric" value="${r.prix||0}" data-i="${i}" data-f="prix">
      <input class="f" type="number" inputmode="numeric" value="${r.qte||0}" data-i="${i}" data-f="qte">
      <input class="f" type="number" inputmode="numeric" value="${r.cout||0}" data-i="${i}" data-f="cout">
      <button class="del" data-i="${i}">×</button>`;
    rl.appendChild(row);
  });
  rl.querySelectorAll("input").forEach(inp=>inp.oninput=async e=>{
    const i=+e.target.dataset.i,fkey=e.target.dataset.f;
    p.revenus[i][fkey]=fkey==="nom"?e.target.value:(parseFloat(e.target.value)||0);
    await persist();
  });
  rl.querySelectorAll(".del").forEach(b=>b.onclick=async()=>{p.revenus.splice(+b.dataset.i,1);await persist();renderConfig();});
  // charges
  const cl=$("#cfg-charge"); cl.innerHTML="";
  p.charges.forEach((c,i)=>{
    const row=el("div","lrow chargerow");
    row.innerHTML=`<input class="f name" value="${escapeAttr(c.nom)}" data-i="${i}" data-f="nom">
      <input class="f" type="number" inputmode="numeric" value="${c.montant||0}" data-i="${i}" data-f="montant">
      <button class="del" data-i="${i}">×</button>`;
    cl.appendChild(row);
  });
  cl.querySelectorAll("input").forEach(inp=>inp.oninput=async e=>{
    const i=+e.target.dataset.i,fkey=e.target.dataset.f;
    p.charges[i][fkey]=fkey==="nom"?e.target.value:(parseFloat(e.target.value)||0);
    await persist();
  });
  cl.querySelectorAll(".del").forEach(b=>b.onclick=async()=>{p.charges.splice(+b.dataset.i,1);await persist();renderConfig();});
  // target
  $("#cfg-target").value=p.target; $("#cfg-targetval").textContent=p.target+" %";
  // TVA
  const tv=$("#cfg-tva-enabled");
  if(tv){ if(!p.tva)p.tva={enabled:false,rate:18,pricesIncludeTax:true};
    tv.checked=!!p.tva.enabled; $("#cfg-tva-rate").value=p.tva.rate!=null?p.tva.rate:18; $("#cfg-tva-ttc").checked=p.tva.pricesIncludeTax!==false; }
}
async function addRev(){ const p=cur(); p.revenus.push({nom:"Nouvelle vente",prix:0,qte:0,cout:0}); await persist(); renderConfig(); }
async function addCharge(){ const p=cur(); p.charges.push({nom:"Nouvelle charge",montant:0}); await persist(); renderConfig(); }

/* ---------- TABLEAU DE BORD ---------- */
function renderDash(){
  const p=cur();
  const {d,items}=BOSS.coachInsights(p);
  $("#d-net").textContent=BOSS.fmtF(d.net);
  $("#d-net").className="big "+(d.net>=0?"pos":"neg");
  $("#d-netnote").innerHTML = d.ca<=0 ? "Configure tes ventes pour voir ton bénéfice."
    : d.net>=0 ? `Après tout payé, il te reste <b>${BOSS.fmtF(d.net)}</b> ce mois. Marge nette <b>${(d.tauxNet*100).toFixed(1)} %</b>.`
    : `Tu perds <b>${BOSS.fmtF(-d.net)}</b> ce mois. Tes ventes ne couvrent pas tes charges.`;
  $("#d-ca").textContent=BOSS.fmtF(d.ca);
  $("#d-mb").textContent=BOSS.fmtF(d.margeBrute);
  $("#d-mbpct").textContent=d.ca>0?(d.tauxMB*100).toFixed(0)+" % du CA":"";
  $("#d-cf").textContent=BOSS.fmtF(d.cf);
  // seuil
  if(d.tauxMB<=0){
    $("#d-seuiltxt").innerHTML="Avec ces prix, chaque vente perd de l'argent. Augmente tes prix ou baisse tes coûts.";
    $("#d-gfill").style.width="0%";
  }else{
    const ratio=d.seuilCA>0?d.ca/d.seuilCA:0;
    $("#d-gfill").style.width=Math.min(100,ratio*100)+"%";
    $("#d-gfill").style.background=d.ca>=d.seuilCA?"linear-gradient(90deg,var(--gold-dim),var(--gold))":"linear-gradient(90deg,var(--char2),var(--cream-dim))";
    $("#d-seuiltxt").innerHTML=d.ca>=d.seuilCA
      ? `Seuil : <b>${BOSS.fmtF(d.seuilCA)}</b>. ✅ Tu es au-dessus — le reste, c'est ton bénéfice.`
      : `Seuil : <b>${BOSS.fmtF(d.seuilCA)}</b>. Il te manque <b style="color:var(--gold)">${BOSS.fmtF(d.seuilCA-d.ca)}</b>.`;
  }
  $("#d-gca").textContent=BOSS.fmtF(d.ca);
  // coach
  const ul=$("#d-coach"); ul.innerHTML="";
  const os=BOSS.orderStats(p.commandes,Date.now());
  const pend=(p.caisse||[]).filter(e=>e.statut==="a_valider").length;
  if(pend>0){ const li=el("li"); li.innerHTML=`<span class="b">${ic("check")}</span><span><b>${pend}</b> vente(s) à valider (saisie caisse).</span>`; li.style.cursor="pointer"; li.onclick=openValidations; ul.appendChild(li); }
  if(os.todayCount>0){ const li=el("li"); li.innerHTML=`<span class="b">${ic("truck")}</span><span><b>${os.todayCount}</b> livraison(s) aujourd'hui${os.codToday?` · <b>${BOSS.fmtF(os.codToday)}</b> à encaisser à la livraison`:""}.</span>`; ul.appendChild(li); }
  if(os.satisfactionCount>0){ const li=el("li"); li.innerHTML=`<span class="b">${ic("star")}</span><span>Satisfaction moyenne : <b>${os.satisfactionAvg.toFixed(1)}/5</b> (${os.satisfactionCount} avis).</span>`; ul.appendChild(li); }
  const low=BOSS.lowStockItems(p,5);
  if(low.length){ const li=el("li"); li.innerHTML=`<span class="b">${ic("stock")}</span><span>Stock bas : ${low.map(x=>escapeHtml(x.nom)+" ("+x.stock+")").join(", ")}. Pense à réapprovisionner.</span>`; ul.appendChild(li); }
  if(p.tva && p.tva.enabled){ const tm=BOSS.tvaMonth(p,Date.now()); const li=el("li"); li.innerHTML=`<span class="b">${ic("config")}</span><span>TVA collectée ce mois (${tm.rate}%) : <b>${BOSS.fmtF(tm.tvaCollectee)}</b> à reverser. CA HT : ${BOSS.fmtF(tm.ht)}.</span>`; ul.appendChild(li); }
  items.forEach(it=>{ const li=el("li"); li.innerHTML=`<span class="b">${it.ic}</span><span>${escapeHtml(it.txt)}</span>`; ul.appendChild(li); });
  // prix
  const pr=$("#d-prices"); pr.innerHTML="";
  // réel du mois (caisse) + impayés (carnet)
  const ct=BOSS.caisseTotals(p,Date.now());
  const kt=BOSS.carnetTotals(p);
  const rb=$("#d-real");
  if(rb){
    rb.innerHTML=`
      <div class="rb-item"><div class="rb-k">Encaissé ce mois (réel)</div><div class="rb-v">${BOSS.fmtF(ct.ventesMois)}</div></div>
      <div class="rb-item"><div class="rb-k">Dépensé ce mois (réel)</div><div class="rb-v">${BOSS.fmtF(ct.depensesMois)}</div></div>
      <div class="rb-item"><div class="rb-k">On te doit</div><div class="rb-v ${kt.impaye>0?'warn':''}">${BOSS.fmtF(kt.impaye)}</div></div>`;
  }
  if(!d.prices.length){ pr.innerHTML='<div class="muted2">Ajoute une vente pour voir le prix conseillé.</div>'; }
  d.prices.forEach(x=>{
    let cls="ok",label="Bonne marge";
    if(x.verdict==="bad"){cls="bad";label="À perte";} else if(x.verdict==="low"){cls="low";label="Trop bas";}
    const row=el("div","prow");
    row.innerHTML=`<div class="pn">${escapeHtml(x.nom)}</div>
      <div class="pv">${BOSS.fmtF(x.coutComplet)}<small>coût réel</small></div>
      <div class="pv" style="color:var(--gold)">${BOSS.fmtF(x.prixConseille)}<small>prix conseillé</small></div>
      <div class="badge ${cls}">${label}</div>`;
    pr.appendChild(row);
  });
}

/* ---------- VITRINE / BOUTIQUE ---------- */
let editingIndex=null;     // index produit en cours d'édition (null = nouveau)
let editingPhoto=null;     // dataURL temporaire

function resizeImage(file,max){
  max=max||640;
  return new Promise(res=>{
    try{
      const img=new Image();
      const url=URL.createObjectURL(file);
      img.onload=()=>{
        try{
          let w=img.width,h=img.height;
          if(w>h && w>max){h=Math.round(h*max/w);w=max;}
          else if(h>=w && h>max){w=Math.round(w*max/h);h=max;}
          const c=document.createElement("canvas");c.width=w;c.height=h;
          c.getContext("2d").drawImage(img,0,0,w,h);
          URL.revokeObjectURL(url);
          res(c.toDataURL("image/jpeg",0.72));
        }catch(e){ res(null); }
      };
      img.onerror=()=>res(null);
      img.src=url;
    }catch(e){ res(null); }
  });
}

async function aiProduct(name,details,photo){
  const p=cur();
  // tentative API (vision si photo), repli local sinon
  try{
    const content=[];
    if(photo){
      const m=/^data:(image\/\w+);base64,(.+)$/.exec(photo);
      if(m) content.push({type:"image",source:{type:"base64",media_type:m[1],data:m[2]}});
    }
    content.push({type:"text",text:`Tu es un vendeur ouest-africain malin. Pour ce produit, écris une description vendeuse TRÈS courte (1 à 2 phrases, français simple, un peu de nouchi ivoirien bienvenu) et propose un prix de vente réaliste en FCFA pour la Côte d'Ivoire.\nProduit : ${name||"(voir photo)"}\nDétails : ${details||"-"}\nMétier du vendeur : ${BOSS.METIERS[p.metier].name}\nRéponds UNIQUEMENT en JSON strict, sans texte autour : {"desc":"...","prix":12345}`});
    const resp=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:300,messages:[{role:"user",content}]})
    });
    const data=await resp.json();
    let txt=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim();
    txt=txt.replace(/```json|```/g,"").trim();
    const obj=JSON.parse(txt);
    if(obj && obj.desc) return {desc:String(obj.desc), prix:parseInt(obj.prix,10)||BOSS.suggestPrice(p)};
  }catch(e){/* repli */}
  return {desc:BOSS.fallbackDescription(name,details,p.metier), prix:BOSS.suggestPrice(p)};
}

function renderVitrine(){
  const p=cur();
  const grid=$("#v-grid"); grid.innerHTML="";
  const prods=p.revenus;
  if(!prods.length){
    grid.innerHTML=`<div class="v-empty">Ta boutique est vide.<br>Ajoute ton premier produit 👇</div>`;
  }
  prods.forEach((r,i)=>{
    const card=el("div","vcard");
    const img = r.photo
      ? `<div class="vc-img" style="background-image:url('${r.photo}')"></div>`
      : `<div class="vc-img noimg">${(r.nom||"?").slice(0,1).toUpperCase()}</div>`;
    card.innerHTML=`${img}
      <div class="vc-body">
        <div class="vc-top"><div class="vc-name">${escapeHtml(r.nom)}</div><div class="vc-price">${BOSS.fmtF(r.prix)}</div></div>
        <div class="vc-desc">${escapeHtml(r.desc||"")}</div>
        ${typeof r.stock==="number"?`<div class="vc-stock ${r.stock<=5?"low":""}">📦 ${r.stock} en stock</div>`:""}
        <div class="vc-actions">
          <button class="vc-btn pay" data-i="${i}">${ic("pay")} Encaisser</button>
          <button class="vc-btn share" data-i="${i}">${ic("share")} Partager</button>
          <button class="vc-btn edit" data-i="${i}" aria-label="Modifier">${ic("edit")}</button>
          <button class="vc-btn del" data-i="${i}" aria-label="Supprimer">${ic("del")}</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });
  grid.querySelectorAll(".pay").forEach(b=>b.onclick=()=>openPay(+b.dataset.i));
  grid.querySelectorAll(".share").forEach(b=>b.onclick=()=>shareProduct(+b.dataset.i));
  grid.querySelectorAll(".edit").forEach(b=>b.onclick=()=>openProduct(+b.dataset.i));
  grid.querySelectorAll(".del").forEach(b=>b.onclick=async()=>{ if(confirm("Retirer ce produit ?")){p.revenus.splice(+b.dataset.i,1);await persist();renderVitrine();renderDash&&renderDash();} });
}

function openProduct(index){
  const p=cur();
  editingIndex = (index==null?null:index);
  const r = editingIndex==null ? {nom:"",prix:0,cout:0,qte:0,desc:"",photo:null} : p.revenus[editingIndex];
  editingPhoto = r.photo||null;
  const sheet=$("#sheet");
  sheet.innerHTML=`
    <div class="sheet-head"><h3>${editingIndex==null?"Nouveau produit":"Modifier le produit"}</h3><button class="x" id="sheet-close">×</button></div>
    <div id="ph-prev" class="ph-prev ${editingPhoto?'':'empty'}" ${editingPhoto?`style="background-image:url('${editingPhoto}')"`:""}>${editingPhoto?"":"📷<br><span>Aucune photo</span>"}</div>
    <div class="ph-btns">
      <button type="button" class="ph-b" id="ph-cam">📷 Prendre une photo</button>
      <button type="button" class="ph-b" id="ph-gal">🖼️ Choisir une photo</button>
    </div>
    <input type="file" id="ph-cam-input" accept="image/*" capture="environment" hidden>
    <input type="file" id="ph-gal-input" accept="image/*" hidden>
    <input class="field" id="pf-name" placeholder="Nom du produit (ex. Robe wax taille M)" value="${escapeAttr(r.nom)}">
    <input class="field" id="pf-details" placeholder="Quelques mots (état, taille, parfum…) — facultatif">
    <button class="ai-gen" id="pf-gen">✨ Générer la description et le prix</button>
    <textarea class="field" id="pf-desc" rows="3" placeholder="Description vendeuse…">${escapeHtml(r.desc||"")}</textarea>
    <div class="pf-row">
      <div><div class="pf-lbl">Prix de vente</div><input class="field" id="pf-prix" type="number" inputmode="numeric" value="${r.prix||0}"></div>
      <div><div class="pf-lbl">Coût / unité</div><input class="field" id="pf-cout" type="number" inputmode="numeric" value="${r.cout||0}"></div>
    </div>
    <div class="pf-lbl">Ventes estimées / mois (pour tes calculs)</div>
    <input class="field" id="pf-qte" type="number" inputmode="numeric" value="${r.qte||0}">
    <div class="pf-lbl">Stock disponible (vide = pas de suivi de stock)</div>
    <input class="field" id="pf-stock" type="number" inputmode="numeric" value="${r.stock!=null?r.stock:""}">
    <div class="lock-err" id="pf-err" style="text-align:left;margin-top:8px"></div>
    <button class="sheet-add" id="pf-save">${editingIndex==null?"Ajouter à ma boutique":"Enregistrer"}</button>
  `;
  $("#sheet-close").onclick=closeSheet;
  const onPhoto=async e=>{
    const file=e.target.files&&e.target.files[0]; if(!file) return;
    const data=await resizeImage(file);
    if(data){ editingPhoto=data; const prev=$("#ph-prev"); prev.classList.remove("empty"); prev.style.backgroundImage=`url('${data}')`; prev.innerHTML=""; }
    e.target.value="";
  };
  $("#ph-cam-input").onchange=onPhoto;
  $("#ph-gal-input").onchange=onPhoto;
  $("#ph-cam").onclick=()=>$("#ph-cam-input").click();
  $("#ph-gal").onclick=()=>$("#ph-gal-input").click();
  $("#ph-prev").onclick=()=>$("#ph-gal-input").click();
  $("#pf-gen").onclick=async()=>{
    const btn=$("#pf-gen"); const old=btn.textContent; btn.textContent="✨ Génération…"; btn.disabled=true;
    const out=await aiProduct($("#pf-name").value,$("#pf-details").value,editingPhoto);
    $("#pf-desc").value=out.desc;
    if(!parseFloat($("#pf-prix").value)) $("#pf-prix").value=out.prix;
    btn.textContent=old; btn.disabled=false;
  };
  $("#pf-save").onclick=async()=>{
    const err=$("#pf-err"); if(err) err.textContent="";
    const nom=$("#pf-name").value.trim();
    const prix=parseFloat($("#pf-prix").value)||0;
    // l'essentiel : un nom et un prix
    if(!nom){ if(err)err.textContent="Donne un nom au produit."; $("#pf-name").focus(); return; }
    if(prix<=0){ if(err)err.textContent="Indique un prix de vente (supérieur à 0)."; $("#pf-prix").focus(); return; }
    // pas de doublon (même nom)
    const norm=s=>BOSS.normalize(s).trim();
    const dup=p.revenus.findIndex((x,i)=>i!==editingIndex && norm(x.nom)===norm(nom));
    if(dup>=0){ if(err)err.textContent="Un produit nommé « "+p.revenus[dup].nom+" » existe déjà."; return; }
    const stockRaw=$("#pf-stock").value.trim();
    const prod={
      nom,
      prix,
      cout:parseFloat($("#pf-cout").value)||0,
      qte:parseFloat($("#pf-qte").value)||0,
      desc:$("#pf-desc").value.trim(),
      photo:editingPhoto||null,
      stock: stockRaw===""?null:(parseFloat(stockRaw)||0),
      vitrine:true
    };
    if(editingIndex==null){ prod.id="r"+Date.now()+Math.random().toString(36).slice(2,6); p.revenus.push(prod); }
    else { p.revenus[editingIndex]={...p.revenus[editingIndex],...prod}; }
    await persist(); closeSheet(); renderVitrine(); renderTopbar(); renderStock();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function openPay(index){
  const p=cur(); const r=p.revenus[index];
  const sheet=$("#sheet");
  sheet.innerHTML=`
    <div class="sheet-head"><h3>Encaisser — ${escapeHtml(r.nom)}</h3><button class="x" id="sheet-close">×</button></div>
    <div class="pf-lbl">Opérateur Mobile Money</div>
    <div class="ops">
      <button class="op on" data-op="Wave">🌊 Wave</button>
      <button class="op" data-op="Orange Money">🟠 Orange</button>
      <button class="op" data-op="MTN MoMo">🟡 MTN</button>
    </div>
    <div class="pf-lbl">Montant</div>
    <input class="field" id="pay-amount" type="number" inputmode="numeric" value="${r.prix||0}">
    <div class="pf-lbl">Numéro du client (facultatif)</div>
    <input class="field" id="pay-phone" inputmode="tel" placeholder="Ex. 0700000000">
    <button class="sheet-add" id="pay-go">📲 Envoyer la demande de paiement</button>
    <div class="pay-note">Le message de paiement s'ouvre dans WhatsApp, prêt à envoyer au client.</div>
  `;
  let op="Wave";
  sheet.querySelectorAll(".op").forEach(b=>b.onclick=()=>{op=b.dataset.op;sheet.querySelectorAll(".op").forEach(x=>x.classList.toggle("on",x===b));});
  $("#sheet-close").onclick=closeSheet;
  $("#pay-go").onclick=()=>{
    const amount=parseFloat($("#pay-amount").value)||0;
    const phone=$("#pay-phone").value;
    const built=BOSS.buildPayment(p.pay,op,amount);
    if(built.kind==="link"){ window.open(built.value,"_blank"); }
    else if(built.kind==="ussd"){ window.open("tel:"+encodeURIComponent(built.value),"_self"); }
    else { window.open(BOSS.waLink(BOSS.paymentRequestText(op,amount,r.nom,p.name),phone),"_blank"); }
    closeSheet();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function shareProduct(index){
  const p=cur(); const r=p.revenus[index];
  const txt=`🛍️ *${r.nom}* — ${BOSS.fmtF(r.prix)}\n${r.desc||""}\n\nVendu par ${p.name}. Réponds pour commander 👍`;
  window.open(BOSS.waLink(txt),"_blank");
}
function shareCatalogue(){
  const p=cur();
  if(!p.revenus.length){ alert("Ajoute au moins un produit à ta boutique."); return; }
  window.open(BOSS.waLink(BOSS.waCatalogueText(p)),"_blank");
}
function exportCataloguePDF(catalogue){
  const p=cur();
  let prods=(p.revenus||[]).filter(r=>r.prix>0);
  if(catalogue && Array.isArray(catalogue.productIds)) prods=prods.filter(r=>catalogue.productIds.includes(r.id));
  if(!prods.length){ alert("Aucun produit à mettre dans ce catalogue."); return; }
  const pa=$("#print-area"); if(!pa) return;
  const today=new Date().toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});
  const titre=catalogue&&catalogue.name?("Catalogue « "+catalogue.name+" »"):"Catalogue";
  let cards="";
  prods.forEach(r=>{
    cards+=`<div class="pc-item">${r.photo?`<img src="${r.photo}" class="pc-img" alt="">`:`<div class="pc-img ph"></div>`}<div class="pc-body"><div class="pc-name">${escapeHtml(r.nom)}</div>${r.desc?`<div class="pc-desc">${escapeHtml(r.desc)}</div>`:""}<div class="pc-price">${BOSS.fmtF(r.prix)}</div></div></div>`;
  });
  const wave=(p.pay&&p.pay.Wave&&p.pay.Wave.link)?"Paiement Wave disponible · ":"";
  const id=p.identite||{};
  pa.innerHTML=`<div class="pc-head rc-head">${id.logo?`<img src="${id.logo}" class="rc-logo">`:""}<div><div class="pc-biz">${escapeHtml(p.name||"Ma boutique")}</div><div class="pc-sub">${titre} · ${today}${id.slogan?(" · "+escapeHtml(id.slogan)):""}</div>${legalHTML(id)}</div></div><div class="pc-grid">${cards}</div><div class="pc-foot">${id.mentions?escapeHtml(id.mentions)+" · ":""}${wave}Commande sur WhatsApp</div>`;
  setTimeout(()=>{ try{ window.print(); }catch(e){} }, 60);
}

/* ---------- /VITRINE ---------- */

/* ---------- CAISSE : enregistrer ventes / dépenses ---------- */
function renderCaisse(){
  const p=cur();
  const t=BOSS.caisseTotals(p,Date.now());
  $("#c-vjour").textContent=BOSS.fmtF(t.ventesJour);
  $("#c-djour").textContent=BOSS.fmtF(t.depensesJour);
  $("#c-net").textContent=BOSS.fmtF(t.netMois);
  $("#c-vmois").textContent=BOSS.fmtF(t.ventesMois);
  const list=$("#c-list"); list.innerHTML="";
  const items=[...(p.caisse||[])].sort((a,b)=>b.ts-a.ts).slice(0,40);
  if(!items.length){ list.innerHTML='<div class="muted2" style="padding:14px 0">Aucun mouvement. Enregistre ta première vente 👆</div>'; }
  items.forEach((e,idx)=>{
    const realIdx=p.caisse.indexOf(e);
    const row=el("div","caisse-row");
    const sign=e.type==="vente"?"+":"−";
    row.innerHTML=`<div class="cr-ic ${e.type}">${e.type==="vente"?"💰":"🧾"}</div>
      <div class="cr-info"><div class="cr-lbl">${escapeHtml(e.label||(e.type==="vente"?"Vente":"Dépense"))}</div><div class="cr-date">${fmtDate(e.ts)}</div></div>
      <div class="cr-amt ${e.type}">${sign} ${BOSS.fmtF(e.montant)}</div>
      <button class="cr-del" data-i="${realIdx}">×</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll(".cr-del").forEach(b=>b.onclick=async()=>{ p.caisse.splice(+b.dataset.i,1); await persist(); renderCaisse(); renderDash(); });
}
function openCaisseEntry(type){
  const p=cur();
  const sheet=$("#sheet");
  const prods=p.revenus.filter(r=>r.prix>0);
  let selIdx=null, depPhoto=null;
  const ptypeOpts=BOSS.PIECE_TYPES.filter(t=>t.sens!=="recette").map(t=>`<option value="${t.k}">${t.label}</option>`).join("");
  sheet.innerHTML=`
    <div class="sheet-head"><h3>${type==="vente"?"Enregistrer une vente":"Enregistrer une dépense"}</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    ${type==="vente"&&prods.length?`<div class="pf-lbl">Produit / service (optionnel)</div><div class="chips" id="ce-prods"></div>`:""}
    ${type==="vente"?`<div class="pf-lbl">Quantité</div><input class="field" id="ce-qty" type="number" inputmode="numeric" value="1">`:""}
    <div class="pf-lbl">${type==="vente"?"Montant reçu":"Montant dépensé"}</div>
    <input class="field" id="ce-amount" type="number" inputmode="numeric" placeholder="0">
    <div class="pf-lbl">Mode de règlement</div>
    <div class="mode-seg" id="ce-canal"><button class="mode-b on" data-c="especes">Espèces</button><button class="mode-b" data-c="banque">Banque</button><button class="mode-b" data-c="mobile">Mobile</button></div>
    <div class="pf-lbl">Note (optionnel)</div>
    <input class="field" id="ce-label" placeholder="${type==="vente"?"Ex. 2 poulets":"Ex. charbon, transport…"}">
    ${type==="vente"?`<div class="pf-lbl">Client (pour le reçu, optionnel)</div><input class="field" id="ce-client" placeholder="Nom du client">`:""}
    ${type==="depense"?`<div class="pf-lbl">Pièce justificative (optionnel)</div>
      <div class="pc-photo" id="ce-photo"><div class="pc-photo-empty">${ic("camera2")}<span>Photo de la facture / reçu</span></div></div>
      <div class="pc-cap"><button class="plus-item" id="ce-cam">${ic("camera2")} Prendre</button><button class="plus-item" id="ce-gal">${ic("image")} Choisir</button></div>
      <div class="pf-lbl">Type de pièce</div><select class="field" id="ce-ptype">${ptypeOpts}</select>`:""}
    <div class="ce-btns">
      <button class="sheet-add" id="ce-save">${type==="vente"?"Encaisser":"Enregistrer la dépense"}</button>
      ${type==="vente"?`<button class="plus-item" id="ce-receipt" style="margin-top:8px">${ic("doc")} Encaisser & générer un reçu</button>`:""}
    </div>
  `;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  function recompute(){ if(selIdx!=null){ const q=parseFloat($("#ce-qty").value)||1; $("#ce-amount").value=(p.revenus[selIdx].prix||0)*q; } }
  if(type==="vente"&&prods.length){
    const cont=$("#ce-prods");
    prods.forEach(r=>{ const idx=p.revenus.indexOf(r); const c=el("button","chip",escapeHtml(r.nom));
      c.onclick=()=>{ selIdx=idx; cont.querySelectorAll(".chip").forEach(x=>x.classList.remove("on")); c.classList.add("on"); $("#ce-label").value=r.nom; recompute(); };
      cont.appendChild(c); });
  }
  if(type==="vente"){ const qf=$("#ce-qty"); if(qf) qf.oninput=recompute; }
  let canal="especes";
  $("#ce-canal").querySelectorAll(".mode-b").forEach(b=>b.onclick=()=>{ canal=b.dataset.c; $("#ce-canal").querySelectorAll(".mode-b").forEach(x=>x.classList.toggle("on",x===b)); });
  if(type==="depense"){
    const pick=(cap)=>{ const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*"; if(cap) inp.capture="environment"; inp.onchange=async()=>{ const f=inp.files&&inp.files[0]; if(!f)return; const d=await resizeImage(f,900); if(d){ depPhoto=d; $("#ce-photo").innerHTML=`<img src="${d}" alt="">`; } }; inp.click(); };
    $("#ce-cam").onclick=()=>pick(true); $("#ce-gal").onclick=()=>pick(false);
  }
  async function save(withReceipt){
    const montant=parseFloat($("#ce-amount").value)||0;
    if(montant<=0){ $("#ce-amount").focus(); return; }
    const qty=type==="vente"?(parseFloat($("#ce-qty").value)||1):1;
    const entry={id:"m"+Date.now().toString(36),ts:Date.now(),type,montant,canal,label:$("#ce-label").value.trim(),productId:(type==="vente"&&selIdx!=null)?(p.revenus[selIdx].id||selIdx):undefined,qty};
    if(type==="vente"){ const cl=$("#ce-client"); if(cl&&cl.value.trim()) entry.clientNom=cl.value.trim(); }
    p.caisse.push(entry);
    if(type==="vente" && selIdx!=null && typeof p.revenus[selIdx].stock==="number"){ p.revenus[selIdx].stock=Math.max(0,p.revenus[selIdx].stock-qty); }
    // dépense : pièce justificative jointe -> créer une pièce comptable liée
    if(type==="depense" && depPhoto){
      const piece={...BOSS.blankPiece(), type:$("#ce-ptype").value, canal, montant, tiers:entry.label, date:BOSS.todayISO(Date.now()), photo:depPhoto, caisseId:entry.id};
      p.pieces.push(piece); entry.pieceId=piece.id;
    }
    await persist(); closeSheet(); renderCaisse(); renderDash(); renderStock(); renderVitrine(); renderTreso&&renderTreso(); renderPieces&&renderPieces();
    if(withReceipt) receiptFromCaisse(entry);
  }
  $("#ce-save").onclick=()=>save(false);
  const rc=$("#ce-receipt"); if(rc) rc.onclick=()=>save(true);
  $("#overlay").classList.add("on"); sheet.classList.add("on");
  setTimeout(()=>{try{$("#ce-amount").focus();}catch(e){}},100);
}
function receiptFromCaisse(entry){
  const p=cur();
  let items;
  if(entry.productId!=null){ const r=p.revenus.find(x=>(x.id||x)===entry.productId); items = r?[{nom:r.nom,prix:r.prix,qty:entry.qty||1}]:[{nom:entry.label||"Vente",prix:entry.montant,qty:1}]; }
  else items=[{nom:entry.label||"Vente",prix:entry.montant,qty:1}];
  receiptPDF({id:entry.id, items, clientNom:entry.clientNom||"", dateLivraison:BOSS.todayISO(entry.ts||Date.now()), paiement:(entry.canal==="especes"?"livraison":"avance")});
}

/* ---------- CARNET : dettes ---------- */
function renderCarnet(){
  const p=cur();
  const ct=BOSS.carnetTotals(p);
  $("#k-impaye").textContent=BOSS.fmtF(ct.impaye);
  $("#k-nb").textContent=ct.nb+(ct.nb>1?" personnes doivent":" personne doit");
  const list=$("#k-list"); list.innerHTML="";
  const items=[...(p.carnet||[])].sort((a,b)=>(a.paye-b.paye)||(b.ts-a.ts));
  if(!items.length){ list.innerHTML='<div class="muted2" style="padding:14px 0">Personne ne te doit rien pour l\'instant. Ajoute une dette 👆</div>'; }
  items.forEach(e=>{
    const idx=p.carnet.indexOf(e);
    const row=el("div","debt-row"+(e.paye?" paid":""));
    row.innerHTML=`
      <button class="db-check ${e.paye?"on":""}" data-i="${idx}" title="Marquer payé">${e.paye?"✓":""}</button>
      <div class="db-info"><div class="db-name">${escapeHtml(e.client||"Client")}</div><div class="db-motif">${escapeHtml(e.motif||"")} · ${fmtDate(e.ts)}</div></div>
      <div class="db-amt">${BOSS.fmtF(e.montant)}</div>
      <div class="db-actions">
        ${!e.paye?`<button class="db-remind" data-i="${idx}" title="Relancer">🔔</button>`:""}
        <button class="db-del" data-i="${idx}" title="Supprimer">🗑️</button>
      </div>`;
    list.appendChild(row);
  });
  list.querySelectorAll(".db-check").forEach(b=>b.onclick=async()=>{ const i=+b.dataset.i; p.carnet[i].paye=!p.carnet[i].paye; await persist(); renderCarnet(); });
  list.querySelectorAll(".db-remind").forEach(b=>b.onclick=()=>{ const e=p.carnet[+b.dataset.i]; const txt=BOSS.debtReminderText(e,p.name); window.open(BOSS.waLink(txt,e.phone),"_blank"); });
  list.querySelectorAll(".db-del").forEach(b=>b.onclick=async()=>{ if(confirm("Supprimer cette dette ?")){ p.carnet.splice(+b.dataset.i,1); await persist(); renderCarnet(); } });
}
function openDebtEntry(){
  const p=cur();
  const sheet=$("#sheet");
  const cls=p.clients||[];
  sheet.innerHTML=`
    <div class="sheet-head"><h3>Nouvelle dette</h3><button class="x" id="sheet-close">×</button></div>
    ${cls.length?`<div class="pf-lbl">Client existant</div><div class="chips" id="dk-clients"></div>`:""}
    <div class="pf-lbl">Qui te doit ?</div>
    <input class="field" id="dk-client" placeholder="Nom du client">
    <div class="pf-lbl">Combien ?</div>
    <input class="field" id="dk-montant" type="number" inputmode="numeric" placeholder="0">
    <div class="pf-lbl">Pour quoi ? (optionnel)</div>
    <input class="field" id="dk-motif" placeholder="Ex. 2 tenues">
    <div class="pf-lbl">Son numéro WhatsApp (pour les relances)</div>
    <input class="field" id="dk-phone" inputmode="tel" placeholder="Ex. 0700000000">
    <button class="sheet-add" id="dk-save">Ajouter au carnet</button>
  `;
  $("#sheet-close").onclick=closeSheet;
  if(cls.length){ const cont=$("#dk-clients"); cls.forEach(c=>{ const b=el("button","chip",escapeHtml(c.name)); b.onclick=()=>{ $("#dk-client").value=c.name; if(c.phone)$("#dk-phone").value=c.phone; }; cont.appendChild(b); }); }
  $("#dk-save").onclick=async()=>{
    const montant=parseFloat($("#dk-montant").value)||0;
    if(montant<=0){ $("#dk-montant").focus(); return; }
    p.carnet.push({client:$("#dk-client").value.trim()||"Client",montant,motif:$("#dk-motif").value.trim(),phone:$("#dk-phone").value.trim(),paye:false,ts:Date.now()});
    await persist(); closeSheet(); renderCarnet();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ---------- PLUS : sauvegarde, reconfigurer, réinitialiser, installer ---------- */
function openPlus(){
  const sheet=$("#sheet");
  const installable = !!deferredInstall && !isStandalone();
  sheet.innerHTML=`
    <div class="sheet-head"><h3>Plus</h3><button class="x" id="sheet-close">×</button></div>
    ${installable?`<button class="plus-item gold" id="pl-install">${ic("install")} Installer l'application sur l'écran d'accueil</button>`:""}
    <button class="plus-item" id="pl-pos">${ic("pos")} Saisie caisse (POS)</button>
    <button class="plus-item" id="pl-team">${ic("team")} Mon équipe (collaborateurs)</button>
    <button class="plus-item" id="pl-registers">${ic("wallet")} Caisses de saisie</button>
    <button class="plus-item" id="pl-valid">${ic("check")} Ventes à valider</button>
    <button class="plus-item" id="pl-abo">${ic("coins")} Abonnement (coût mensuel)</button>
    <button class="plus-item" id="pl-stock">${ic("stock")} Stock / inventaire</button>
    <button class="plus-item" id="pl-commandes">${ic("commandes")} Commandes &amp; livraisons</button>
    <button class="plus-item" id="pl-carnet">${ic("carnet")} Carnet de dettes</button>
    <button class="plus-item" id="pl-pieces">${ic("doc")} Pièces comptables</button>
    <button class="plus-item" id="pl-treso">${ic("wallet")} Trésorerie & rapprochement</button>
    <button class="plus-item" id="pl-identity">${ic("idcard")} Identité & logo (catalogue, reçu)</button>
    <button class="plus-item" id="pl-clients">${ic("clients")} Mes clients</button>
    <button class="plus-item" id="pl-historique">${ic("historique")} Historique (mois par mois)</button>
    <button class="plus-item" id="pl-pay">${ic("pay")} Paramètres de paiement (Wave / Orange / MTN)</button>
    <button class="plus-item" id="pl-appearance">${ic("theme")} Apparence (thème & couleur)</button>
    <button class="plus-item" id="pl-sync">${ic("sync")} Synchronisation entre appareils</button>
    <button class="plus-item" id="pl-admin">${ic("admin")} Espace administrateur</button>
    <button class="plus-item" id="pl-onboard">${ic("onboard")} Reconfigurer avec l'assistant IA</button>
    <button class="plus-item" id="pl-ai">${ic("ai")} Réglages de l'assistant IA</button>
    <button class="plus-item" id="pl-help">${ic("help")} Aide & tutoriel</button>
    <button class="plus-item" id="pl-config">${ic("config")} Réglages détaillés (dont TVA)</button>
    <button class="plus-item" id="pl-export">${ic("export")} Exporter une sauvegarde</button>
    <button class="plus-item" id="pl-import">${ic("import")} Importer une sauvegarde</button>
    <button class="plus-item danger" id="pl-reset">${ic("del")} Réinitialiser ce business</button>
    <input type="file" id="pl-file" accept="application/json,.json" hidden>
    <div class="plus-note">${Store.label()} · ${Object.keys(state.profiles).length} business</div>
  `;
  $("#sheet-close").onclick=closeSheet;
  const ins=$("#pl-install"); if(ins) ins.onclick=async()=>{ closeSheet(); await doInstall(); };
  const plpos=$("#pl-pos"); if(plpos) plpos.onclick=()=>{ closeSheet(); showView("pos"); };
  const plteam=$("#pl-team"); if(plteam) plteam.onclick=openTeam;
  const plreg=$("#pl-registers"); if(plreg) plreg.onclick=openRegisters;
  const plval=$("#pl-valid"); if(plval) plval.onclick=openValidations;
  const plabo=$("#pl-abo"); if(plabo) plabo.onclick=openAbonnement;
  $("#pl-stock").onclick=()=>{ closeSheet(); showView("stock"); };
  $("#pl-commandes").onclick=()=>{ closeSheet(); showView("commandes"); };
  $("#pl-carnet").onclick=()=>{ closeSheet(); showView("carnet"); };
  $("#pl-pieces").onclick=()=>{ closeSheet(); showView("pieces"); };
  const plt=$("#pl-treso"); if(plt) plt.onclick=()=>{ closeSheet(); showView("tresorerie"); };
  const pli=$("#pl-identity"); if(pli) pli.onclick=()=>{ openIdentity(); };
  const plh=$("#pl-help"); if(plh) plh.onclick=()=>{ openHelp(); };
  $("#pl-clients").onclick=()=>{ closeSheet(); showView("clients"); };
  $("#pl-historique").onclick=()=>{ closeSheet(); showView("historique"); };
  $("#pl-pay").onclick=()=>{ openPaySettings(); };
  $("#pl-sync").onclick=()=>{ openSync(); };
  $("#pl-appearance").onclick=()=>{ openAppearance(); };
  $("#pl-admin").onclick=()=>{ openAdmin(); };
  $("#pl-onboard").onclick=()=>{ closeSheet(); showView("onboard"); startOnboard(); };
  $("#pl-ai").onclick=()=>{ openAISettings(); };
  $("#pl-config").onclick=()=>{ closeSheet(); showView("config"); };
  $("#pl-export").onclick=()=>{ closeSheet(); exportBackup(); };
  $("#pl-import").onclick=()=>$("#pl-file").click();
  $("#pl-file").onchange=importBackup;
  $("#pl-reset").onclick=async()=>{ if(confirm("Effacer toutes les données de ce business ? (les autres business restent)")){ const np=BOSS.blankProfile(cur().name); np.id=cur().id; state.profiles[np.id]=np; await persist(); closeSheet(); refreshAll(); showView("onboard"); startOnboard(); } };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function exportBackup(){
  const data=BOSS.serializeBackup(state);
  const blob=new Blob([data],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download="boss-sauvegarde-"+new Date().toISOString().slice(0,10)+".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function importBackup(e){
  const file=e.target.files&&e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=async()=>{
    try{
      const imported=BOSS.parseBackup(String(reader.result));
      Object.values(imported.profiles).forEach(p=>BOSS.ensureProfile(p));
      state=imported;
      if(!state.currentId||!state.profiles[state.currentId]) state.currentId=Object.keys(state.profiles)[0];
      await persist(); closeSheet(); refreshAll(); showView("dash");
      alert("Sauvegarde importée ✅");
    }catch(err){ alert("Fichier invalide : "+err.message); }
  };
  reader.readAsText(file);
}

/* ---------- INSTALLATION (PWA) ---------- */
let deferredInstall=null;
function isStandalone(){ try{ return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone===true; }catch(e){ return false; } }
function isIOS(){ const ua=navigator.userAgent||""; return /iPhone|iPad|iPod/.test(ua) && !window.MSStream; }
function isSafariiOS(){ return isIOS() && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent); }
function installDismissedAt(){ try{ return parseInt(localStorage.getItem("boss.install.dismissed")||"0",10); }catch(_){ return 0; } }
function markInstallDismissed(){ try{ localStorage.setItem("boss.install.dismissed", String(Date.now())); }catch(_){} }

async function doInstall(){
  if(deferredInstall){
    deferredInstall.prompt();
    try{ await deferredInstall.userChoice; }catch(e){}
    deferredInstall=null; updateInstallHint();
    return;
  }
  // iOS Safari : instructions manuelles
  if(isSafariiOS()){
    showIOSInstallSheet();
    return;
  }
  // Autres navigateurs : instructions génériques
  showManualInstallSheet();
}

function showIOSInstallSheet(){
  const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Installer BOSS sur iPhone</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="ps-note">Safari ne propose pas d'installation automatique. C'est 3 clics à la main :</div>
    <ol class="ins-steps">
      <li>Appuie sur l'icône <b>Partager</b> ⬆️ en bas de l'écran (le carré avec la flèche vers le haut).</li>
      <li>Descends dans la liste et tape <b>« Sur l'écran d'accueil »</b>.</li>
      <li>Confirme <b>« Ajouter »</b> en haut à droite.</li>
    </ol>
    <div class="ps-note">Une icône BOSS apparaît sur ton écran d'accueil. Ouvre-la comme n'importe quelle app.</div>
    <button class="sheet-add" id="ins-ok">Compris</button>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  $("#ins-ok").onclick=closeSheet;
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function showManualInstallSheet(){
  const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Installer BOSS</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="ps-note">Ce navigateur ne propose pas d'install automatique. Ouvre son menu :</div>
    <ul class="ins-steps">
      <li><b>Chrome, Edge, Brave</b> : menu <b>⋮</b> → <b>« Installer l'application »</b> ou <b>« Ajouter à l'écran d'accueil »</b>.</li>
      <li><b>Samsung Internet</b> : menu <b>☰</b> → <b>« Ajouter la page à »</b> → <b>« Écran d'accueil »</b>.</li>
      <li><b>Firefox</b> : menu <b>⋮</b> → <b>« Installer »</b>.</li>
    </ul>
    <button class="sheet-add" id="ins-ok">Compris</button>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  $("#ins-ok").onclick=closeSheet;
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function updateInstallHint(){
  const h=$("#install-hint"); if(!h) return;
  if(isStandalone()){ h.style.display="none"; return; }
  // Bannière : masquée si utilisateur l'a rejetée dans les 7 derniers jours
  const dismissed=installDismissedAt();
  const daysSince=(Date.now()-dismissed)/86400000;
  const recentlyDismissed=(dismissed>0 && daysSince<7);
  // On l'affiche si install-prompt dispo, OU sur iOS Safari (jamais d'install-prompt), OU premier boot
  const canShow=deferredInstall || isSafariiOS() || dismissed===0;
  h.style.display=(canShow && !recentlyDismissed)?"flex":"none";
}

/* ---------- STOCK ---------- */
function renderStock(){
  const p=cur();
  const list=$("#st-list"); if(!list) return;
  const prods=p.revenus.filter(r=>typeof r.stock==="number");
  const untracked=p.revenus.filter(r=>typeof r.stock!=="number");
  list.innerHTML="";
  if(!prods.length){ list.innerHTML='<div class="muted2" style="padding:14px 0">Aucun produit suivi en stock. Active le stock dans la fiche d\'un produit (Boutique).</div>'; }
  prods.sort((a,b)=>a.stock-b.stock).forEach(r=>{
    const i=p.revenus.indexOf(r);
    const row=el("div","stock-row"+(r.stock<=5?" low":""));
    row.innerHTML=`<div class="sr-name">${escapeHtml(r.nom)}</div>
      <div class="sr-qty">${r.stock}</div>
      <div class="sr-ctrl"><button class="sr-b" data-i="${i}" data-d="-1">−</button><button class="sr-b" data-i="${i}" data-d="1">+</button><button class="sr-b restock" data-i="${i}" data-d="restock">↻</button></div>`;
    list.appendChild(row);
  });
  if(untracked.length){
    const t=el("div","muted2"); t.style.marginTop="14px";
    t.textContent=untracked.length+" produit(s) sans suivi de stock.";
    list.appendChild(t);
  }
  list.querySelectorAll(".sr-b").forEach(b=>b.onclick=async()=>{
    const r=p.revenus[+b.dataset.i];
    if(b.dataset.d==="restock"){ const v=prompt("Réappro : nouveau stock pour « "+r.nom+" »",r.stock); if(v===null)return; r.stock=Math.max(0,parseFloat(v)||0); }
    else { r.stock=Math.max(0,(r.stock||0)+parseInt(b.dataset.d,10)); }
    await persist(); renderStock(); renderVitrine();
  });
}

/* ---------- CLIENTS ---------- */
function renderClients(){
  const p=cur();
  const list=$("#cl-list"); if(!list) return;
  list.innerHTML="";
  const cls=p.clients||[];
  if(!cls.length){ list.innerHTML='<div class="muted2" style="padding:14px 0">Aucun client enregistré. Ajoute-en un 👆</div>'; }
  cls.forEach((c,i)=>{
    const dettes=(p.carnet||[]).filter(d=>!d.paye && (d.client===c.name)).reduce((s,d)=>s+d.montant,0);
    const row=el("div","client-row");
    row.innerHTML=`<div class="clr-av">${(c.name||"?").slice(0,1).toUpperCase()}</div>
      <div class="clr-info"><div class="clr-n">${escapeHtml(c.name)}</div><div class="clr-m">${escapeHtml(c.phone||"")}${dettes>0?` · doit ${BOSS.fmtF(dettes)}`:""}</div></div>
      <div class="clr-act">${c.phone?`<button class="clr-b" data-i="${i}" data-a="wa">💬</button>`:""}<button class="clr-b" data-i="${i}" data-a="del">🗑️</button></div>`;
    list.appendChild(row);
  });
  list.querySelectorAll(".clr-b").forEach(b=>b.onclick=async()=>{
    const c=p.clients[+b.dataset.i];
    if(b.dataset.a==="wa"){ window.open(BOSS.waLink("Bonjour "+(c.name||"")+" 👋",c.phone),"_blank"); }
    else { if(confirm("Supprimer ce client ?")){ p.clients.splice(+b.dataset.i,1); await persist(); renderClients(); } }
  });
}
function openClientEntry(){
  const p=cur(); const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Nouveau client</h3><button class="x" id="sheet-close">×</button></div>
    <div class="pf-lbl">Nom</div><input class="field" id="cl-name" placeholder="Nom du client">
    <div class="pf-lbl">Téléphone / WhatsApp</div><input class="field" id="cl-phone" inputmode="tel" placeholder="Ex. 0700000000">
    <div class="pf-lbl">Note (optionnel)</div><input class="field" id="cl-note" placeholder="Ex. cliente fidèle, quartier Cocody">
    <button class="sheet-add" id="cl-save">Ajouter</button>`;
  $("#sheet-close").onclick=closeSheet;
  $("#cl-save").onclick=async()=>{
    const name=$("#cl-name").value.trim(); if(!name){ $("#cl-name").focus(); return; }
    p.clients.push({id:"c"+Date.now(),name,phone:$("#cl-phone").value.trim(),note:$("#cl-note").value.trim(),ts:Date.now()});
    await persist(); closeSheet(); renderClients();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ---------- HISTORIQUE (graphique SVG, sans dépendance) ---------- */
function renderHistorique(){
  const p=cur(); const host=$("#h-chart"); if(!host) return;
  const hist=BOSS.monthlyHistory(p,6,Date.now());
  const _cs=getComputedStyle(document.documentElement);
  const _acc=(_cs.getPropertyValue("--gold")||"#C8A23A").trim();
  const _gray=(_cs.getPropertyValue("--cream-dim")||"#9A9AA0").trim();
  const _axis=(_cs.getPropertyValue("--line")||"#34343A").trim();
  const max=Math.max(1,...hist.map(h=>Math.max(h.ventes,h.depenses)));
  const W=320,H=180,pad=24,bw=(W-pad*2)/hist.length;
  let bars="";
  hist.forEach((h,i)=>{
    const x=pad+i*bw;
    const vh=(h.ventes/max)*(H-pad*2), dh=(h.depenses/max)*(H-pad*2);
    const bw2=(bw-10)/2;
    bars+=`<rect x="${x+4}" y="${H-pad-vh}" width="${bw2}" height="${vh}" rx="2" fill="${_acc}"/>`;
    bars+=`<rect x="${x+4+bw2+2}" y="${H-pad-dh}" width="${bw2}" height="${dh}" rx="2" fill="${_gray}"/>`;
    bars+=`<text x="${x+bw/2}" y="${H-8}" text-anchor="middle" font-size="10" font-family="monospace" fill="${_gray}">${h.label}</text>`;
  });
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="${_axis}"/>${bars}</svg>
    <div class="h-leg"><span><i style="background:var(--gold)"></i>Ventes</span><span><i style="background:var(--cream-dim)"></i>Dépenses</span></div>`;
  // tableau
  const tb=$("#h-table"); tb.innerHTML="";
  [...hist].reverse().forEach(h=>{
    const row=el("div","h-row");
    row.innerHTML=`<div class="h-m">${h.label}</div><div class="h-v pos">${BOSS.fmtF(h.ventes)}</div><div class="h-v neg">${BOSS.fmtF(h.depenses)}</div><div class="h-v ${h.net>=0?'':'redtxt'}" style="font-weight:700">${BOSS.fmtF(h.net)}</div>`;
    tb.appendChild(row);
  });
}

/* ---------- PARAMÈTRES DE PAIEMENT ---------- */
function openPaySettings(){
  const p=cur(); if(!p.pay)p.pay={}; const sheet=$("#sheet");
  const wave=p.pay["Wave"]||{}, om=p.pay["Orange Money"]||{}, mtn=p.pay["MTN MoMo"]||{};
  sheet.innerHTML=`<div class="sheet-head"><h3>Paiement Mobile Money</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Renseigne tes infos marchand pour générer de vrais liens de paiement. Laisse vide pour envoyer une simple demande par WhatsApp.</div>
    <div class="pf-lbl">🌊 Lien de paiement Wave Business</div>
    <input class="field" id="ps-wave" placeholder="https://pay.wave.com/m/...{amount}" value="${escapeAttr(wave.link||"")}">
    <div class="pf-lbl">🟠 Code USSD Orange Money (marchand)</div>
    <input class="field" id="ps-orange" placeholder="#144*82*CODE*{amount}#" value="${escapeAttr(om.ussd||"")}">
    <div class="pf-lbl">🟡 Code USSD MTN MoMo (marchand)</div>
    <input class="field" id="ps-mtn" placeholder="*133*1*CODE*{amount}#" value="${escapeAttr(mtn.ussd||"")}">
    <div class="ps-note">Utilise <b>{amount}</b> là où le montant doit s'insérer.</div>
    <button class="sheet-add" id="ps-save">Enregistrer</button>`;
  $("#sheet-close").onclick=closeSheet;
  $("#ps-save").onclick=async()=>{
    p.pay["Wave"]={link:$("#ps-wave").value.trim()};
    p.pay["Orange Money"]={ussd:$("#ps-orange").value.trim()};
    p.pay["MTN MoMo"]={ussd:$("#ps-mtn").value.trim()};
    await persist(); closeSheet();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ---------- SYNCHRONISATION CLOUD ---------- */
let syncTimer=null, syncing=false;
function syncHeaders(){ const h={}; if(state.sync&&state.sync.token) h["Authorization"]="Bearer "+state.sync.token; return h; }
function scheduleSync(){ if(!state.sync||!state.sync.url||!state.sync.auto) return; clearTimeout(syncTimer); syncTimer=setTimeout(()=>{ pushSync(); },3000); }
async function pullSync(){
  if(!state.sync||!state.sync.url) return false;
  try{
    const r=await fetch(state.sync.url,{headers:syncHeaders()});
    if(!r.ok) return false;
    const txt=await r.text(); if(!txt||txt==="null") return false;
    let remote; const o=JSON.parse(txt); remote=o&&o.state?o.state:o;
    if(!remote||!remote.profiles) return false;
    state=BOSS.mergeStates(state,remote);
    Object.values(state.profiles).forEach(x=>BOSS.ensureProfile(x));
    await Store.set(KEY,JSON.stringify(state));
    return true;
  }catch(e){ return false; }
}
async function pushSync(){
  if(!state.sync||!state.sync.url) return false;
  try{
    const r=await fetch(state.sync.url,{method:"PUT",headers:Object.assign({"Content-Type":"application/json"},syncHeaders()),body:BOSS.serializeBackup(state)});
    return r.ok;
  }catch(e){ return false; }
}
async function syncNow(){
  if(syncing) return; syncing=true;
  const p=await pullSync(); const u=await pushSync();
  syncing=false; refreshAll();
  return p||u;
}
function openSync(){
  const sheet=$("#sheet"); const s=state.sync||{};
  sheet.innerHTML=`<div class="sheet-head"><h3>Synchronisation</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Sauvegarde automatique entre tes appareils. Renseigne l'adresse d'un espace de stockage qui accepte GET (lire) et PUT (écrire) du JSON — ex. un bac JSON gratuit (jsonbin, Supabase, ton serveur…).</div>
    <div class="pf-lbl">Adresse (URL)</div>
    <input class="field" id="sy-url" placeholder="https://.../boss-state" value="${escapeAttr(s.url||"")}">
    <div class="pf-lbl">Jeton secret (optionnel)</div>
    <input class="field" id="sy-token" placeholder="Bearer token" value="${escapeAttr(s.token||"")}">
    <label class="sy-auto"><input type="checkbox" id="sy-auto" ${s.auto?"checked":""}> Synchroniser automatiquement</label>
    <button class="sheet-add" id="sy-now">🔄 Synchroniser maintenant</button>
    <button class="plus-item" id="sy-save" style="margin-top:8px">Enregistrer les réglages</button>
    <div class="ps-note" id="sy-status"></div>`;
  $("#sheet-close").onclick=closeSheet;
  $("#sy-save").onclick=async()=>{ state.sync={url:$("#sy-url").value.trim(),token:$("#sy-token").value.trim(),auto:$("#sy-auto").checked}; await persist(); $("#sy-status").textContent="Réglages enregistrés ✅"; };
  $("#sy-now").onclick=async()=>{ state.sync={url:$("#sy-url").value.trim(),token:$("#sy-token").value.trim(),auto:$("#sy-auto").checked}; await persist(); $("#sy-status").textContent="Synchronisation…"; const okc=await syncNow(); $("#sy-status").textContent=okc?"Synchronisé ✅":"Échec — vérifie l'adresse."; };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ CLOUD BOSS (Supabase — sync multi-appareils) ============ */
const Cloud = (function(){
  const NET = (typeof window !== "undefined" && window.BOSSNET) ? window.BOSSNET : null;
  let orgId = null;
  let autoTimer = null;
  let unsubRT = null;
  let listeners = new Set();
  let cloudStatus = "off"; // off | signed-out | needs-org | syncing | online | offline | error

  function available(){ return !!(NET && NET.isConfigured()); }
  function session(){ return NET ? NET.auth.session() : null; }
  function user(){ return NET ? NET.auth.user() : null; }
  function status(){ return cloudStatus; }
  function currentOrgId(){ return orgId; }
  function setStatus(s){ if(s!==cloudStatus){ cloudStatus=s; listeners.forEach(fn=>{ try{fn(s);}catch(_){}}); refreshCloudBadge(); } }
  function onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

  async function loadCurrentOrg(){
    if(!available() || !session()) return null;
    // Reprend la dernière org utilisée (persistée dans state.cloud.orgId), sinon la 1re trouvée
    const saved = state.cloud && state.cloud.orgId;
    try {
      const orgs = await NET.org.list();
      if(!orgs || !orgs.length) return null;
      const found = saved && orgs.find(o=>o.id===saved);
      orgId = (found||orgs[0]).id;
      state.cloud = Object.assign({}, state.cloud, {orgId, orgs: orgs.map(o=>({id:o.id,nom:o.nom}))});
      return orgId;
    } catch(e){
      setStatus("error");
      return null;
    }
  }

  async function pullAndMerge(){
    if(!available() || !session() || !orgId) return false;
    try {
      setStatus("syncing");
      const remote = await NET.profiles.pullAll(orgId);
      const before = JSON.stringify({p:state.profiles, c:state.currentId});
      const merged = BOSS.mergeStates({profiles:state.profiles,currentId:state.currentId,updatedAt:state.updatedAt||0}, remote);
      state.profiles = merged.profiles;
      if(merged.currentId && state.profiles[merged.currentId]) state.currentId = merged.currentId;
      state.updatedAt = merged.updatedAt;
      Object.values(state.profiles).forEach(p=>BOSS.ensureProfile(p));
      const after = JSON.stringify({p:state.profiles, c:state.currentId});
      const changed = before !== after;
      if(changed){ await Store.set(KEY, JSON.stringify(state)); }
      setStatus("online");
      return changed;
    } catch(e){
      setStatus("offline");
      return false;
    }
  }

  async function pushLocal(){
    if(!available() || !session() || !orgId) return false;
    try {
      setStatus("syncing");
      await NET.profiles.pushMany(orgId, state.profiles);
      setStatus("online");
      return true;
    } catch(e){
      setStatus("offline");
      return false;
    }
  }

  async function syncNow(){
    if(!available() || !session() || !orgId) return false;
    const changed = await pullAndMerge();
    await pushLocal();
    if(changed) refreshAll();
    return true;
  }

  function scheduleAuto(){
    if(autoTimer) clearInterval(autoTimer);
    if(!available() || !session() || !orgId) return;
    // Polling toutes les 20 s en secours du realtime
    autoTimer = setInterval(()=>{ syncNow(); }, 20_000);
  }

  function startRealtime(){
    if(unsubRT){ try{unsubRT();}catch(_){} unsubRT=null; }
    if(!available() || !session() || !orgId) return;
    try {
      unsubRT = NET.realtime.subscribeProfiles(orgId, async (evt)=>{
        // À chaque changement distant, on tire l'état à jour et refresh
        const changed = await pullAndMerge();
        if(changed) refreshAll();
      });
    } catch(_){}
  }

  async function init(){
    if(!available()) { setStatus("off"); return; }
    // Captation d'une session issue d'un magic-link (#access_token=…)
    try { await NET.auth.captureFromURL(); } catch(_){}
    if(!session()){ setStatus("signed-out"); return; }
    // Rafraîchir l'utilisateur
    try { await NET.auth.me(); } catch(_){}
    if(!session()){ setStatus("signed-out"); return; }
    const id = await loadCurrentOrg();
    if(!id){ setStatus("needs-org"); return; }
    setStatus("online");
    await pullAndMerge();
    await pushLocal();
    scheduleAuto();
    startRealtime();
    // Sauvegarder la connexion
    await Store.set(KEY, JSON.stringify(state));
  }

  async function signInPassword(email, password){
    if(!available()) throw new Error("Cloud non configuré");
    await NET.auth.signIn(email, password);
    await init();
  }
  async function signUp(email, password){
    if(!available()) throw new Error("Cloud non configuré");
    const r = await NET.auth.signUp(email, password);
    if(session()) await init();
    return r;
  }
  async function sendMagicLink(email){
    if(!available()) throw new Error("Cloud non configuré");
    return NET.auth.magicLink(email, location && location.href);
  }
  async function signOut(){
    if(!available()) return;
    if(autoTimer){ clearInterval(autoTimer); autoTimer=null; }
    if(unsubRT){ try{unsubRT();}catch(_){} unsubRT=null; }
    try { NET.realtime.disconnect(); } catch(_){}
    await NET.auth.signOut();
    orgId = null;
    setStatus("signed-out");
  }
  async function createOrg(nom){
    if(!available() || !session()) throw new Error("Non connecté");
    const org = await NET.org.create(nom);
    orgId = org.id;
    state.cloud = Object.assign({}, state.cloud, {orgId});
    // Pousser les profils locaux existants vers la nouvelle organisation
    await pushLocal();
    setStatus("online");
    scheduleAuto();
    startRealtime();
    return org;
  }
  async function inviteCollab(email, role){
    if(!available() || !session() || !orgId) throw new Error("Non connecté");
    return NET.org.invite(orgId, email, role);
  }
  async function listMembers(){
    if(!available() || !session() || !orgId) return [];
    return NET.org.members(orgId);
  }
  async function listInvitations(){
    if(!available() || !session() || !orgId) return [];
    return NET.org.pendingInvitations(orgId);
  }
  async function acceptInvitation(token){
    if(!available() || !session()) throw new Error("Connecte-toi d'abord");
    const mem = await NET.org.acceptInvitation(token);
    orgId = mem.organization_id;
    state.cloud = Object.assign({}, state.cloud, {orgId});
    await pullAndMerge();
    scheduleAuto();
    startRealtime();
    setStatus("online");
    return mem;
  }

  return {
    available, session, user, status, currentOrgId,
    init, signInPassword, signUp, sendMagicLink, signOut,
    createOrg, inviteCollab, listMembers, listInvitations, acceptInvitation,
    pullAndMerge, pushLocal, syncNow, onChange
  };
})();

/* Badge de statut (mini icône dans la barre) */
function refreshCloudBadge(){
  const b = $("#cloud-badge"); if(!b) return;
  const s = Cloud.status();
  const map = {
    off:         {ic:"lock",  txt:"Local",       cls:"cb-off"},
    "signed-out":{ic:"user",  txt:"Se connecter",cls:"cb-off"},
    "needs-org": {ic:"add",   txt:"Créer org",   cls:"cb-warn"},
    syncing:     {ic:"sync",  txt:"Sync…",       cls:"cb-sync"},
    online:      {ic:"cloud", txt:"En ligne",    cls:"cb-on"},
    offline:     {ic:"warn",  txt:"Hors-ligne",  cls:"cb-warn"},
    error:       {ic:"warn",  txt:"Erreur",      cls:"cb-err"}
  };
  const m = map[s] || map.off;
  b.innerHTML = ic(m.ic) + " " + m.txt;
  b.className = "cloud-badge " + m.cls;
}

/* ============ ÉCRAN AUTH / ORG / COLLABORATEURS ============ */
async function openCloudSheet(){
  const sheet=$("#sheet"); sheet.innerHTML="";
  const head=el("div","sheet-head",`<h3>${ic("cloud")} Espace en ligne</h3><button class='x' id='sheet-close'>×</button>`);
  sheet.appendChild(head);
  $("#sheet-close").onclick=closeSheet;

  if(!Cloud.available()){
    const box=el("div","ps-note",
      "L'espace en ligne n'est pas configuré dans cette version de l'app. Utilise la sauvegarde locale ou la synchro par URL personnalisée.");
    sheet.appendChild(box);
    $("#overlay").classList.add("on"); sheet.classList.add("on");
    return;
  }

  const s = Cloud.status();
  const u = Cloud.user();

  if(!Cloud.session()){
    // Vue login/signup — magic link par défaut, mot de passe en repli
    sheet.appendChild(el("div","ps-note",
      "Synchronise tes données entre tes téléphones, sauvegarde-les en ligne, invite tes collaborateurs. <b>Gratuit</b>."));

    sheet.appendChild(el("div","pf-lbl","Ton adresse email"));
    const emailInp=el("input","field"); emailInp.id="cl-email"; emailInp.type="email"; emailInp.autocomplete="email";
    emailInp.placeholder="ton.email@exemple.com";
    sheet.appendChild(emailInp);

    const btnMagic=el("button","sheet-add",ic("send")+" Recevoir un lien par email");
    btnMagic.id="cl-magic";
    sheet.appendChild(btnMagic);

    sheet.appendChild(el("div","ps-note",
      "On t'envoie un lien à cliquer — pas de mot de passe à retenir. C'est la méthode la plus simple, et la plus sûre."));

    const status=el("div","ps-note"); status.id="cl-status"; status.style.marginTop="10px";
    sheet.appendChild(status);

    // Zone repliée : mot de passe (pour ceux qui préfèrent)
    const toggle=el("button","plus-item","J'ai déjà un mot de passe ▾");
    toggle.style.marginTop="16px";
    sheet.appendChild(toggle);

    const pwBlock=el("div","cl-pw-block");
    pwBlock.style.display="none";
    pwBlock.innerHTML=`
      <div class="pf-lbl" style="margin-top:12px">Mot de passe (6 caractères minimum)</div>
      <input class="field" id="cl-pw" type="password" autocomplete="current-password" placeholder="Ton mot de passe">
      <button class="sheet-add" id="cl-signin" style="margin-top:8px">Se connecter</button>
      <button class="plus-item" id="cl-signup" style="margin-top:8px">Créer un compte avec mot de passe</button>`;
    sheet.appendChild(pwBlock);

    toggle.onclick=()=>{
      const shown=pwBlock.style.display==="block";
      pwBlock.style.display=shown?"none":"block";
      toggle.textContent=shown?"J'ai déjà un mot de passe ▾":"J'ai déjà un mot de passe ▴";
    };

    function validEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
    function setStatus(t,ok){
      const s=$("#cl-status"); if(!s) return;
      s.innerHTML=t;
      s.style.color = ok===false?"#f96":ok===true?"#7c7":"";
    }

    btnMagic.onclick=async()=>{
      const email=$("#cl-email").value.trim();
      if(!validEmail(email)){ setStatus("Cette adresse email n'a pas l'air correcte",false); return; }
      setStatus("Envoi du lien en cours…");
      btnMagic.disabled=true;
      try{
        await Cloud.sendMagicLink(email);
        setStatus("✅ Lien envoyé à <b>"+escapeHtml(email)+"</b>.<br>Ouvre ta boîte email (regarde aussi les spams) et clique sur le lien. L'app se connectera automatiquement.",true);
      }catch(e){
        const msg=(e.message||"").toLowerCase();
        if(msg.includes("rate")) setStatus("Trop de tentatives. Attends 1 minute et réessaie.",false);
        else setStatus("Échec de l'envoi : "+(e.message||"vérifie ton adresse email"),false);
        btnMagic.disabled=false;
      }
    };

    setTimeout(()=>{
      const s=$("#cl-signin"); const su=$("#cl-signup");
      if(s) s.onclick=async()=>{
        const email=$("#cl-email").value.trim(); const pw=$("#cl-pw").value;
        if(!validEmail(email)){ setStatus("Email invalide",false); return; }
        if(!pw){ setStatus("Entre ton mot de passe",false); return; }
        setStatus("Connexion…");
        try{ await Cloud.signInPassword(email, pw); setStatus("✅ Connecté",true); setTimeout(openCloudSheet,700); }
        catch(e){
          const m=(e.message||"").toLowerCase();
          if(m.includes("invalid") || m.includes("credentials")) setStatus("Email ou mot de passe incorrect. Essaie plutôt le lien par email.",false);
          else setStatus("Échec : "+(e.message||"réessaie"),false);
        }
      };
      if(su) su.onclick=async()=>{
        const email=$("#cl-email").value.trim(); const pw=$("#cl-pw").value;
        if(!validEmail(email)){ setStatus("Email invalide",false); return; }
        if(!pw || pw.length<6){ setStatus("Mot de passe : 6 caractères minimum",false); return; }
        setStatus("Création du compte…");
        try{
          await Cloud.signUp(email, pw);
          if(Cloud.session()){ setStatus("✅ Compte créé et connecté",true); setTimeout(openCloudSheet,700); }
          else setStatus("✅ Compte créé.<br>Vérifie ton email pour confirmer, puis reviens ici.",true);
        }catch(e){
          const m=(e.message||"").toLowerCase();
          if(m.includes("already") || m.includes("registered")) setStatus("Cet email est déjà utilisé. Utilise « Se connecter » ou le lien par email.",false);
          else setStatus("Échec : "+(e.message||"réessaie"),false);
        }
      };
    },0);

    $("#overlay").classList.add("on"); sheet.classList.add("on");
    return;
  }

  // Connecté → vue org / collaborateurs
  const info=el("div","ps-note",`Connecté : <b>${escapeHtml((u&&u.email)||"—")}</b>`);
  sheet.appendChild(info);

  if(s==="needs-org"){
    sheet.appendChild(el("div","pf-lbl","Nom de ton entreprise / activité"));
    const nomInp=el("input","field"); nomInp.id="cl-orgnom"; nomInp.placeholder="Ex. Chez Fatou · Maquis";
    sheet.appendChild(nomInp);
    const btn=el("button","sheet-add","Créer mon espace en ligne"); btn.id="cl-orgcreate";
    sheet.appendChild(btn);
    const inviteBox=el("div","ps-note","Tu as reçu une invitation ? Colle le code ici :"); inviteBox.style.marginTop="16px";
    sheet.appendChild(inviteBox);
    const invInp=el("input","field"); invInp.id="cl-invtok"; invInp.placeholder="Code d'invitation";
    sheet.appendChild(invInp);
    const btnAcc=el("button","plus-item","Accepter l'invitation"); btnAcc.id="cl-invaccept"; btnAcc.style.marginTop="8px";
    sheet.appendChild(btnAcc);
    const status=el("div","ps-note"); status.id="cl-status"; status.style.marginTop="10px"; sheet.appendChild(status);
    btn.onclick=async()=>{
      const nom=$("#cl-orgnom").value.trim();
      if(!nom){ $("#cl-status").textContent="Nom requis"; return; }
      $("#cl-status").textContent="Création…";
      try{ await Cloud.createOrg(nom); $("#cl-status").textContent="Espace créé ✅"; setTimeout(openCloudSheet,600); }
      catch(e){ $("#cl-status").textContent="Échec : "+(e.message||""); }
    };
    btnAcc.onclick=async()=>{
      const t=$("#cl-invtok").value.trim();
      if(!t){ $("#cl-status").textContent="Code requis"; return; }
      $("#cl-status").textContent="Traitement…";
      try{ await Cloud.acceptInvitation(t); $("#cl-status").textContent="Rejoint ✅"; setTimeout(openCloudSheet,600); }
      catch(e){ $("#cl-status").textContent="Échec : "+(e.message||"code invalide"); }
    };
    $("#overlay").classList.add("on"); sheet.classList.add("on");
    return;
  }

  // Statut normal : connecté + org
  const st=el("div","ps-note",`Statut : <b>${escapeHtml(Cloud.status())}</b>`);
  sheet.appendChild(st);

  const btnSync=el("button","sheet-add","🔄 Synchroniser maintenant");
  sheet.appendChild(btnSync);
  btnSync.onclick=async()=>{ btnSync.textContent="Sync…"; await Cloud.syncNow(); btnSync.textContent="🔄 Synchroniser maintenant"; };

  // Collaborateurs
  sheet.appendChild(el("h4","",'<span style="margin-top:16px;display:block">👥 Collaborateurs</span>'));
  const membersBox=el("div","cl-members","Chargement…");
  sheet.appendChild(membersBox);
  const invBox=el("div","cl-invites","");
  sheet.appendChild(invBox);
  sheet.appendChild(el("div","pf-lbl","Inviter un collaborateur (email)"));
  const invEmail=el("input","field"); invEmail.id="cl-invemail"; invEmail.type="email"; invEmail.placeholder="collab@exemple.com";
  sheet.appendChild(invEmail);
  const invRole=el("select","field"); invRole.id="cl-invrole";
  ["collaborateur","manager","comptable","commercial"].forEach(r=>{
    const opt=document.createElement("option"); opt.value=r; opt.textContent=r; invRole.appendChild(opt);
  });
  sheet.appendChild(el("div","pf-lbl","Rôle"));
  sheet.appendChild(invRole);
  const btnInv=el("button","plus-item","Envoyer l'invitation"); btnInv.style.marginTop="8px";
  sheet.appendChild(btnInv);
  const invStatus=el("div","ps-note"); invStatus.id="cl-invstatus"; sheet.appendChild(invStatus);

  // Bouton déconnexion
  const btnOut=el("button","plus-item","Se déconnecter"); btnOut.style.marginTop="16px";
  sheet.appendChild(btnOut);
  btnOut.onclick=async()=>{ if(confirm("Se déconnecter ?")){ await Cloud.signOut(); openCloudSheet(); }};

  // Charger membres + invitations
  Cloud.listMembers().then(list=>{
    if(!list||!list.length){ membersBox.innerHTML="<i>Personne pour l'instant</i>"; return; }
    membersBox.innerHTML = list.map(m=>`<div class="cl-mem-row"><b>${escapeHtml(m.nom||m.user_id.slice(0,8))}</b> · ${escapeHtml(m.role)}</div>`).join("");
  }).catch(()=>{ membersBox.innerHTML="<i>Erreur de chargement</i>"; });

  Cloud.listInvitations().then(list=>{
    if(!list||!list.length){ invBox.innerHTML=""; return; }
    invBox.innerHTML = "<div class='pf-lbl'>Invitations en attente</div>" + list.map(iv=>
      `<div class="cl-inv-row"><b>${escapeHtml(iv.email)}</b> · ${escapeHtml(iv.role)}<br><code style="font-size:11px;user-select:all">${escapeHtml(iv.token)}</code></div>`
    ).join("");
  }).catch(()=>{});

  btnInv.onclick=async()=>{
    const email=$("#cl-invemail").value.trim(); const role=$("#cl-invrole").value;
    if(!email){ invStatus.textContent="Email requis"; return; }
    invStatus.textContent="Envoi…";
    try{
      const inv = await Cloud.inviteCollab(email, role);
      invStatus.innerHTML="Invitation créée ✅. Code à transmettre :<br><code style='user-select:all'>"+escapeHtml(inv.token)+"</code>";
      // rafraîchir la liste
      Cloud.listInvitations().then(list=>{
        if(!list||!list.length){ invBox.innerHTML=""; return; }
        invBox.innerHTML = "<div class='pf-lbl'>Invitations en attente</div>" + list.map(iv=>
          `<div class="cl-inv-row"><b>${escapeHtml(iv.email)}</b> · ${escapeHtml(iv.role)}<br><code style="font-size:11px;user-select:all">${escapeHtml(iv.token)}</code></div>`
        ).join("");
      });
    }catch(e){ invStatus.textContent="Échec : "+(e.message||"vérifie l'email"); }
  };

  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ RÉGLAGES ASSISTANT IA ============ */
function openAISettings(){
  const a=state.ai||{provider:"pollinations",enabled:true};
  const prov=a.provider||"pollinations";
  const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Assistant IA</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="ps-note">Ton assistant IA t'aide à configurer ton business, analyser tes chiffres et écrire des messages clients. Choisis un fournisseur :</div>

    <label class="switch-row"><span>Activer l'assistant IA</span><input type="checkbox" id="ai-enabled" ${a.enabled!==false?"checked":""}></label>

    <div class="pf-lbl">Fournisseur</div>
    <div class="ai-provs">
      <label class="ai-prov ${prov==='pollinations'?'on':''}"><input type="radio" name="ai-prov" value="pollinations" ${prov==='pollinations'?'checked':''}>
        <b>Gratuit — sans compte</b><br>
        <span class="ai-prov-sub">Aucune clé, aucune configuration. Marche tout de suite (limité en volume).</span>
      </label>
      <label class="ai-prov ${prov==='openai'?'on':''}"><input type="radio" name="ai-prov" value="openai" ${prov==='openai'?'checked':''}>
        <b>OpenAI / Groq / OpenRouter</b><br>
        <span class="ai-prov-sub">Ton propre compte (Groq offre 14 000 requêtes/jour gratuites).</span>
      </label>
      <label class="ai-prov ${prov==='anthropic'?'on':''}"><input type="radio" name="ai-prov" value="anthropic" ${prov==='anthropic'?'checked':''}>
        <b>Anthropic Claude</b><br>
        <span class="ai-prov-sub">Ton propre compte Anthropic (payant).</span>
      </label>
    </div>

    <div id="ai-adv-openai" style="display:${prov==='openai'?'block':'none'}">
      <div class="pf-lbl">URL du point d'accès (compatible OpenAI)</div>
      <input class="field" id="ai-url-o" placeholder="https://api.groq.com/openai/v1/chat/completions" value="${escapeAttr(a.url||'')}">
      <div class="pf-lbl">Clé API</div>
      <input class="field" id="ai-key-o" type="password" placeholder="gsk_… (Groq) ou sk-… (OpenAI)" value="${escapeAttr(a.key||'')}">
      <div class="pf-lbl">Modèle</div>
      <input class="field" id="ai-model-o" placeholder="llama-3.1-8b-instant" value="${escapeAttr(a.model||'llama-3.1-8b-instant')}">
      <div class="ps-note">📖 Créer une clé Groq gratuite : <b>console.groq.com</b> → API Keys → Create.</div>
    </div>

    <div id="ai-adv-anthropic" style="display:${prov==='anthropic'?'block':'none'}">
      <div class="pf-lbl">Clé API Anthropic</div>
      <input class="field" id="ai-key-a" type="password" placeholder="sk-ant-…" value="${escapeAttr(a.key||'')}">
      <div class="pf-lbl">Modèle</div>
      <input class="field" id="ai-model-a" placeholder="claude-sonnet-4-5" value="${escapeAttr(a.model||'claude-sonnet-4-5')}">
      <div class="ps-note">⚠️ Une clé Anthropic mise dans une PWA publique est visible par tout utilisateur — préfère un proxy si tu partages l'app.</div>
    </div>

    <div id="ai-adv-pollinations" style="display:${prov==='pollinations'?'block':'none'}">
      <div class="pf-lbl">Modèle</div>
      <select class="field" id="ai-model-p">
        <option value="openai" ${(a.model||'openai')==='openai'?'selected':''}>openai (rapide, généraliste)</option>
        <option value="mistral" ${a.model==='mistral'?'selected':''}>mistral (français propre)</option>
        <option value="llama" ${a.model==='llama'?'selected':''}>llama (open source)</option>
      </select>
      <div class="ps-note">Aucune donnée ne transite chez BOSS ; tout va directement chez le fournisseur choisi.</div>
    </div>

    <button class="sheet-add" id="ai-save">Enregistrer</button>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;

  function refreshBlocks(){
    const cur=sheet.querySelector('input[name="ai-prov"]:checked')?.value||"pollinations";
    sheet.querySelectorAll('.ai-prov').forEach(x=>x.classList.toggle('on',x.querySelector('input')?.value===cur));
    ["pollinations","openai","anthropic"].forEach(p=>{
      const box=sheet.querySelector('#ai-adv-'+p);
      if(box) box.style.display=(cur===p?'block':'none');
    });
  }
  sheet.querySelectorAll('input[name="ai-prov"]').forEach(i=>i.onchange=refreshBlocks);

  $("#ai-save").onclick=async()=>{
    const enabled=$("#ai-enabled").checked;
    const provider=sheet.querySelector('input[name="ai-prov"]:checked')?.value||"pollinations";
    let url="", key="", model="";
    if(provider==="openai"){
      url=$("#ai-url-o").value.trim();
      key=$("#ai-key-o").value.trim();
      model=$("#ai-model-o").value.trim()||"llama-3.1-8b-instant";
    } else if(provider==="anthropic"){
      key=$("#ai-key-a").value.trim();
      model=$("#ai-model-a").value.trim()||"claude-sonnet-4-5";
    } else {
      model=$("#ai-model-p").value||"openai";
    }
    state.ai={enabled,provider,url,key,model};
    await persist();
    closeSheet();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ COMMANDES / LIVRAISONS ============ */
let cmdFilter="today";
function renderCommandes(){
  const p=cur(); const list=$("#cmd-list"); if(!list) return;
  // chips de filtre
  const chips=$("#cmd-filters");
  if(chips && !chips.dataset.wired){
    chips.dataset.wired="1";
    chips.querySelectorAll(".cmd-chip").forEach(b=>b.onclick=()=>{ cmdFilter=b.dataset.f; chips.querySelectorAll(".cmd-chip").forEach(x=>x.classList.toggle("on",x===b)); renderCommandes(); });
  }
  if(chips) chips.querySelectorAll(".cmd-chip").forEach(x=>x.classList.toggle("on",x.dataset.f===cmdFilter));

  const all=p.commandes||[];
  const tISO=BOSS.todayISO(Date.now());
  let rows=[];
  const active=o=>o.statut!=="payee"&&o.statut!=="annulee";
  if(cmdFilter==="today"){ rows=all.filter(o=>o.dateLivraison===tISO && o.statut!=="annulee" && o.statut!=="payee"); }
  else if(cmdFilter==="week"){ const wk=weekISOset(); rows=all.filter(o=>wk.has(o.dateLivraison) && active(o)); }
  else if(cmdFilter==="done"){ rows=all.filter(o=>o.statut==="payee"||o.statut==="livree"||o.statut==="annulee"); }
  else { rows=all.filter(active); }
  // tri par date puis créneau
  const ordC={"Matin":0,"Après-midi":1,"Soir":2,"":3};
  rows.sort((a,b)=>(a.dateLivraison||"").localeCompare(b.dateLivraison||"")|| (ordC[a.creneau]||3)-(ordC[b.creneau]||3));

  list.innerHTML="";
  if(!rows.length){ list.innerHTML=`<div class="muted2" style="padding:16px 0">Aucune commande ${cmdFilter==="today"?"à livrer aujourd'hui":""}. Touche « ＋ Commande » pour en créer une.</div>`; return; }

  let lastDay=null;
  rows.forEach(o=>{
    const idx=p.commandes.indexOf(o);
    if(cmdFilter!=="today" && o.dateLivraison!==lastDay){
      lastDay=o.dateLivraison;
      const h=el("div","cmd-day"); h.textContent=dayLabel(o.dateLivraison); list.appendChild(h);
    }
    list.appendChild(orderCard(o,idx));
  });
}
function weekISOset(){ const s=new Set(); const now=Date.now(); for(let i=0;i<7;i++){ s.add(BOSS.todayISO(now+i*86400000)); } return s; }
function dayLabel(iso){ if(!iso) return "Sans date"; const t=BOSS.todayISO(Date.now()); const tm=BOSS.todayISO(Date.now()+86400000); if(iso===t) return "Aujourd'hui"; if(iso===tm) return "Demain"; try{ return new Date(iso+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"short"}); }catch(e){ return iso; } }
function orderCard(o,idx){
  const card=el("div","cmd-card s-"+o.statut);
  const cod=o.paiement==="livraison";
  const itemsTxt=(o.items||[]).map(it=>escapeHtml(it.nom)+" ×"+(it.qty||1)).join(", ");
  const nextK=BOSS.nextOrderStatus(o.statut);
  const nextLabel={confirmee:"Confirmer",preparation:"Préparer",en_route:"Envoyer en livraison",livree:cod?"Livrer & encaisser":"Marquer livrée",payee:"Marquer payée"}[nextK]||"";
  const stars=o.satisfaction&&o.satisfaction.note?("★".repeat(o.satisfaction.note)+"☆".repeat(5-o.satisfaction.note)):"";
  card.innerHTML=`
    <div class="cmd-top">
      <div class="cmd-client">${escapeHtml(o.clientNom||"Client")}</div>
      <div class="cmd-badge b-${o.statut}">${BOSS.orderStatusLabel(o.statut)}</div>
    </div>
    <div class="cmd-meta">
      ${o.adresse?`<span>${ic("pin")} ${escapeHtml(o.adresse)}</span>`:""}
      ${o.dateLivraison?`<span>${ic("clock")} ${dayLabel(o.dateLivraison)}${o.creneau?(" · "+o.creneau):""}</span>`:""}
    </div>
    ${itemsTxt?`<div class="cmd-items">${itemsTxt}</div>`:""}
    <div class="cmd-total"><b>${BOSS.fmtF(BOSS.orderTotal(o))}</b> ${cod?`<span class="cod">${ic("truck")} à la livraison</span>`:`<span class="paid">payé d'avance</span>`}</div>
    ${stars?`<div class="cmd-stars">${stars} ${o.satisfaction.commentaire?("· "+escapeHtml(o.satisfaction.commentaire)):""}</div>`:""}
    <div class="cmd-actions">
      ${nextK&&o.statut!=="annulee"?`<button class="cmd-b primary" data-a="next" data-i="${idx}">${ic("check")} ${nextLabel}</button>`:""}
      ${o.clientPhone?`<button class="cmd-b" data-a="wa" data-i="${idx}" aria-label="WhatsApp">${ic("onboard")}</button>`:""}
      ${(o.statut==="livree"||o.statut==="payee")?`<button class="cmd-b" data-a="avis" data-i="${idx}">${ic("star")} Avis</button>`:""}
      <button class="cmd-b" data-a="edit" data-i="${idx}" aria-label="Modifier">${ic("edit")}</button>
      <button class="cmd-b" data-a="more" data-i="${idx}" aria-label="Plus">${ic("plus_menu")}</button>
    </div>`;
  card.querySelectorAll(".cmd-b").forEach(b=>b.onclick=()=>orderAction(b.dataset.a,+b.dataset.i));
  return card;
}
async function orderAction(a,idx){
  const p=cur(); const o=p.commandes[idx]; if(!o) return;
  if(a==="wa"){ window.open(BOSS.waLink(o.statut==="en_route"?BOSS.deliveryOnWayText(o):BOSS.orderConfirmText(o,p.name),o.clientPhone),"_blank"); return; }
  if(a==="edit"){ openOrderEntry(idx); return; }
  if(a==="avis"){ openSatisfaction(idx); return; }
  if(a==="more"){ openOrderMore(idx); return; }
  if(a==="next"){
    const nextK=BOSS.nextOrderStatus(o.statut); if(!nextK) return;
    if(nextK==="livree"){
      // livraison : paiement à la livraison -> encaisse + déstocke, passe direct à payée
      if(o.paiement==="livraison"){
        if(!confirm("Confirmer la livraison et l'encaissement de "+BOSS.fmtF(BOSS.orderTotal(o))+" ?")) return;
        recordOrderPayment(o);
        o.statut="payee";
      } else { o.statut="livree"; }
    } else { o.statut=nextK; }
    o.updatedAt=Date.now();
    await persist(); renderCommandes(); renderCaisse&&renderCaisse(); renderDash&&renderDash(); renderStock&&renderStock();
    if(o.statut==="payee"||o.statut==="livree"){ if(confirm("Envoyer un message pour demander l'avis du client ?")) window.open(BOSS.waLink(BOSS.satisfactionRequestText(o,p.name),o.clientPhone),"_blank"); }
  }
}
function recordOrderPayment(o){
  const p=cur();
  p.caisse.push({id:"m"+Date.now().toString(36),ts:Date.now(),type:"vente",montant:BOSS.orderTotal(o),canal:"especes",label:"Livraison "+(o.clientNom||""),orderId:o.id});
  // déstockage
  (o.items||[]).forEach(it=>{
    const ri=p.revenus.findIndex(r=>BOSS.normalize(r.nom).trim()===BOSS.normalize(it.nom).trim());
    if(ri>=0 && typeof p.revenus[ri].stock==="number") p.revenus[ri].stock=Math.max(0,p.revenus[ri].stock-(it.qty||1));
  });
}
function openOrderMore(idx){
  const p=cur(); const o=p.commandes[idx]; const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Commande — ${escapeHtml(o.clientNom||"")}</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    ${o.clientPhone?`<button class="plus-item" id="om-call">${ic("phone")} Appeler le client</button>`:""}
    <button class="plus-item" id="om-confirm">${ic("onboard")} Renvoyer la confirmation (WhatsApp)</button>
    <button class="plus-item" id="om-receipt">${ic("doc")} Reçu (PDF)</button>
    <button class="plus-item danger" id="om-cancel">${ic("close")} Annuler la commande</button>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  const call=$("#om-call"); if(call) call.onclick=()=>{ window.open("tel:"+encodeURIComponent(o.clientPhone),"_self"); };
  $("#om-confirm").onclick=()=>{ window.open(BOSS.waLink(BOSS.orderConfirmText(o,p.name),o.clientPhone),"_blank"); };
  $("#om-receipt").onclick=()=>{ closeSheet(); receiptPDF(o); };
  $("#om-cancel").onclick=async()=>{ if(confirm("Annuler cette commande ?")){ o.statut="annulee"; o.updatedAt=Date.now(); await persist(); closeSheet(); renderCommandes(); renderDash&&renderDash(); } };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function openSatisfaction(idx){
  const p=cur(); const o=p.commandes[idx]; const sheet=$("#sheet");
  let note=(o.satisfaction&&o.satisfaction.note)||0;
  sheet.innerHTML=`<div class="sheet-head"><h3>Satisfaction — ${escapeHtml(o.clientNom||"")}</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="pf-lbl">Note du client</div>
    <div class="stars-pick" id="st-pick"></div>
    <div class="pf-lbl">Commentaire / remarque</div>
    <input class="field" id="st-com" value="${escapeAttr((o.satisfaction&&o.satisfaction.commentaire)||"")}" placeholder="Ex. très contente, livraison rapide">
    <button class="sheet-add" id="st-save">Enregistrer</button>
    <button class="plus-item" id="st-ask" style="margin-top:8px">${ic("onboard")} Demander l'avis par WhatsApp</button>`;
  renderIcons(sheet);
  const pick=$("#st-pick");
  const draw=()=>{ pick.innerHTML=""; for(let i=1;i<=5;i++){ const b=el("button","star-b"+(i<=note?" on":"")); b.innerHTML=ic("star"); b.onclick=()=>{ note=i; draw(); }; pick.appendChild(b); } };
  draw();
  $("#sheet-close").onclick=closeSheet;
  $("#st-save").onclick=async()=>{ o.satisfaction={note,commentaire:$("#st-com").value.trim(),ts:Date.now()}; o.updatedAt=Date.now(); await persist(); closeSheet(); renderCommandes(); renderDash&&renderDash(); };
  $("#st-ask").onclick=()=>{ window.open(BOSS.waLink(BOSS.satisfactionRequestText(o,p.name),o.clientPhone),"_blank"); };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function openOrderEntry(idx){
  const p=cur(); const editing=idx!=null;
  const o=editing?JSON.parse(JSON.stringify(p.commandes[idx])):BOSS.blankOrder();
  if(!o.items) o.items=[];
  const sheet=$("#sheet");
  const cls=p.clients||[];
  const prods=p.revenus.filter(r=>r.prix>0);
  sheet.innerHTML=`<div class="sheet-head"><h3>${editing?"Modifier la commande":"Nouvelle commande"}</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    ${cls.length?`<div class="pf-lbl">Client existant</div><div class="chips" id="oe-clients"></div>`:""}
    <div class="pf-lbl">Nom du client</div><input class="field" id="oe-name" value="${escapeAttr(o.clientNom)}" placeholder="Nom">
    <div class="pf-lbl">WhatsApp</div><input class="field" id="oe-phone" inputmode="tel" value="${escapeAttr(o.clientPhone)}" placeholder="0700000000">
    ${prods.length?`<div class="pf-lbl">Produits</div><div class="chips" id="oe-prods"></div>`:""}
    <div id="oe-items" class="oe-items"></div>
    ${!prods.length?`<div class="pf-lbl">Montant total</div><input class="field" id="oe-total" type="number" inputmode="numeric" value="${o.total||""}" placeholder="0">`:""}
    <div class="pf-lbl">Adresse de livraison</div><input class="field" id="oe-addr" value="${escapeAttr(o.adresse)}" placeholder="Quartier, repère…">
    <div class="pf-row">
      <div><div class="pf-lbl">Date</div><input class="field" id="oe-date" type="date" value="${o.dateLivraison||BOSS.todayISO(Date.now())}"></div>
      <div><div class="pf-lbl">Créneau</div><div class="seg3" id="oe-creneau"></div></div>
    </div>
    <div class="pf-lbl">Paiement</div>
    <div class="mode-seg" id="oe-pay"><button class="mode-b ${o.paiement==="livraison"?"on":""}" data-p="livraison">À la livraison</button><button class="mode-b ${o.paiement!=="livraison"?"on":""}" data-p="avance">Payé d'avance</button></div>
    <div class="pf-lbl">Note</div><input class="field" id="oe-note" value="${escapeAttr(o.note)}" placeholder="Ex. appeler avant">
    <div class="lock-err" id="oe-err" style="text-align:left"></div>
    <button class="sheet-add" id="oe-save">${editing?"Enregistrer":"Créer la commande"}</button>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  // créneaux
  const cren=$("#oe-creneau"); ["Matin","Après-midi","Soir"].forEach(c=>{ const b=el("button","seg-b"+(o.creneau===c?" on":"")); b.textContent=c; b.onclick=()=>{ o.creneau=(o.creneau===c?"":c); cren.querySelectorAll(".seg-b").forEach(x=>x.classList.toggle("on",x.textContent===c&&o.creneau===c)); }; cren.appendChild(b); });
  // clients
  if(cls.length){ const cc=$("#oe-clients"); cls.forEach(c=>{ const b=el("button","chip",escapeHtml(c.name)); b.onclick=()=>{ $("#oe-name").value=c.name; if(c.phone)$("#oe-phone").value=c.phone; }; cc.appendChild(b); }); }
  // paiement seg
  $("#oe-pay").querySelectorAll(".mode-b").forEach(b=>b.onclick=()=>{ o.paiement=b.dataset.p; $("#oe-pay").querySelectorAll(".mode-b").forEach(x=>x.classList.toggle("on",x===b)); });
  // produits -> items
  function drawItems(){
    const box=$("#oe-items"); box.innerHTML="";
    o.items.forEach((it,i)=>{
      const row=el("div","oe-item");
      row.innerHTML=`<span class="oei-n">${escapeHtml(it.nom)}</span><span class="oei-p">${BOSS.fmtF(it.prix)}</span>
        <span class="oei-q"><button class="oei-b" data-q="-1">−</button>${it.qty||1}<button class="oei-b" data-q="1">+</button></span>
        <button class="oei-x" aria-label="Retirer">${ic("close")}</button>`;
      row.querySelectorAll(".oei-b").forEach(b=>b.onclick=()=>{ it.qty=Math.max(1,(it.qty||1)+parseInt(b.dataset.q,10)); drawItems(); });
      row.querySelector(".oei-x").onclick=()=>{ o.items.splice(i,1); drawItems(); };
      box.appendChild(row);
    });
    renderIcons(box);
    if(o.items.length){ const tot=el("div","oe-tot"); tot.innerHTML=`Total : <b>${BOSS.fmtF(BOSS.orderTotal(o))}</b>`; box.appendChild(tot); }
  }
  if(prods.length){ const pc=$("#oe-prods"); prods.forEach(r=>{ const b=el("button","chip",escapeHtml(r.nom)); b.onclick=()=>{ const ex=o.items.find(x=>x.nom===r.nom); if(ex) ex.qty=(ex.qty||1)+1; else o.items.push({nom:r.nom,prix:r.prix,qty:1}); drawItems(); }; pc.appendChild(b); }); }
  drawItems();
  $("#oe-save").onclick=async()=>{
    const err=$("#oe-err"); err.textContent="";
    o.clientNom=$("#oe-name").value.trim();
    o.clientPhone=$("#oe-phone").value.trim();
    o.adresse=$("#oe-addr").value.trim();
    o.dateLivraison=$("#oe-date").value;
    o.note=$("#oe-note").value.trim();
    if(!prods.length){ o.total=parseFloat($("#oe-total").value)||0; }
    if(!o.clientNom){ err.textContent="Indique le nom du client."; return; }
    if(BOSS.orderTotal(o)<=0){ err.textContent="Ajoute au moins un produit ou un montant."; return; }
    o.updatedAt=Date.now();
    if(editing){ p.commandes[idx]=o; }
    else { o.createdAt=Date.now(); p.commandes.push(o); }
    await persist(); closeSheet(); renderCommandes(); renderDash&&renderDash();
    // proposer la confirmation WhatsApp
    if(!editing && o.clientPhone && confirm("Envoyer la confirmation de commande au client sur WhatsApp ?")) window.open(BOSS.waLink(BOSS.orderConfirmText(o,p.name),o.clientPhone),"_blank");
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ PIÈCES COMPTABLES ============ */
let pcType="tous", pcCanal="tous", pcPeriod="mois";
function renderPieces(){
  const p=cur(); const list=$("#pc-list"); if(!list) return;
  // remplir les selects une fois
  const tSel=$("#pc-f-type"), cSel=$("#pc-f-canal");
  if(tSel && !tSel.dataset.filled){ tSel.dataset.filled="1";
    tSel.innerHTML=`<option value="tous">Tous les types</option>`+BOSS.PIECE_TYPES.map(t=>`<option value="${t.k}">${t.label}</option>`).join("");
    cSel.innerHTML=`<option value="tous">Tous les règlements</option>`+BOSS.PAYMENT_CHANNELS.map(c=>`<option value="${c.k}">${c.label}</option>`).join("");
    tSel.onchange=()=>{ pcType=tSel.value; renderPieces(); };
    cSel.onchange=()=>{ pcCanal=cSel.value; renderPieces(); };
    $("#pc-periods").querySelectorAll(".cmd-chip").forEach(b=>b.onclick=()=>{ pcPeriod=b.dataset.p; $("#pc-periods").querySelectorAll(".cmd-chip").forEach(x=>x.classList.toggle("on",x===b)); renderPieces(); });
  }
  if(tSel) tSel.value=pcType; if(cSel) cSel.value=pcCanal;
  $("#pc-periods")&&$("#pc-periods").querySelectorAll(".cmd-chip").forEach(x=>x.classList.toggle("on",x.dataset.p===pcPeriod));

  const filtered=BOSS.filterPieces(p.pieces||[],{type:pcType,canal:pcCanal});
  const groups=BOSS.groupPieces(filtered,pcPeriod);
  list.innerHTML="";
  if(!groups.length){ list.innerHTML=`<div class="muted2" style="padding:16px 0">Aucune pièce enregistrée. Touche « ＋ Pièce » pour photographier une facture, un reçu, une quittance…</div>`; return; }
  groups.forEach(g=>{
    const head=el("div","pc-group");
    head.innerHTML=`<div class="pcg-title">${g.label}</div><div class="pcg-tot">${g.recettes?`<span class="pos">+${BOSS.fmtF(g.recettes)}</span>`:""}${g.depenses?`<span class="neg">−${BOSS.fmtF(g.depenses)}</span>`:""}</div>`;
    list.appendChild(head);
    g.items.forEach(pc=>{
      const idx=p.pieces.indexOf(pc);
      const row=el("div","pc-row");
      row.innerHTML=`${pc.photo?`<img src="${pc.photo}" class="pc-thumb" alt="">`:`<div class="pc-thumb ph">${ic("doc")}</div>`}
        <div class="pc-info"><div class="pc-t">${BOSS.pieceTypeLabel(pc.type)}</div>
        <div class="pc-m">${escapeHtml(pc.tiers||"")}${pc.tiers?" · ":""}${BOSS.channelLabel(pc.canal)} · ${pc.date}</div></div>
        <div class="pc-amt">${BOSS.fmtF(pc.montant)}</div>`;
      row.onclick=()=>openPieceEntry(idx);
      list.appendChild(row);
    });
  });
  renderIcons(list);
}
function openPieceEntry(idx){
  const p=cur(); const editing=idx!=null;
  const pc=editing?JSON.parse(JSON.stringify(p.pieces[idx])):BOSS.blankPiece();
  const sheet=$("#sheet");
  const typeOpts=BOSS.PIECE_TYPES.map(t=>`<option value="${t.k}" ${pc.type===t.k?"selected":""}>${t.label}</option>`).join("");
  const canalOpts=BOSS.PAYMENT_CHANNELS.map(c=>`<option value="${c.k}" ${pc.canal===c.k?"selected":""}>${c.label}</option>`).join("");
  const examples=BOSS.pieceExamples(p.metier);
  sheet.innerHTML=`<div class="sheet-head"><h3>${editing?"Modifier la pièce":"Nouvelle pièce comptable"}</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="pc-photo" id="pc-photo">${pc.photo?`<img src="${pc.photo}" alt="">`:`<div class="pc-photo-empty">${ic("camera2")}<span>Prends la pièce en photo</span></div>`}</div>
    <div class="pc-cap"><button class="plus-item" id="pc-cam">${ic("camera2")} Prendre en photo</button><button class="plus-item" id="pc-gal">${ic("image")} Choisir une image</button></div>
    ${!editing?`<div class="pf-lbl">Exemples pour ton activité</div><div class="chips" id="pc-ex"></div>`:""}
    <div class="pf-lbl">Type de pièce</div><select class="field" id="pc-type">${typeOpts}</select>
    <div class="pf-lbl">Mode de règlement (canal)</div><select class="field" id="pc-canal">${canalOpts}</select>
    <div class="pf-row">
      <div><div class="pf-lbl">Montant</div><input class="field" id="pc-montant" type="number" inputmode="numeric" value="${pc.montant||""}" placeholder="0"></div>
      <div><div class="pf-lbl">Date</div><input class="field" id="pc-date" type="date" value="${pc.date||BOSS.todayISO(Date.now())}"></div>
    </div>
    <div class="pf-lbl">Tiers (fournisseur / client)</div><input class="field" id="pc-tiers" value="${escapeAttr(pc.tiers||"")}" placeholder="Ex. Grossiste, propriétaire, CIE…">
    <div class="pf-lbl">Note</div><input class="field" id="pc-note" value="${escapeAttr(pc.note||"")}" placeholder="Optionnel">
    <div class="lock-err" id="pc-err" style="text-align:left"></div>
    <button class="sheet-add" id="pc-save">${editing?"Enregistrer":"Ajouter la pièce"}</button>
    ${editing?`<button class="plus-item danger" id="pc-del" style="margin-top:8px">${ic("del")} Supprimer</button>`:""}`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  let photo=pc.photo||null;
  function setPhoto(dataUrl){ photo=dataUrl; const box=$("#pc-photo"); box.innerHTML=`<img src="${dataUrl}" alt="">`; }
  function pick(capture){
    const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*"; if(capture) inp.capture="environment";
    inp.onchange=async()=>{ const f=inp.files&&inp.files[0]; if(!f) return; const d=await resizeImage(f,900); if(d) setPhoto(d); };
    inp.click();
  }
  $("#pc-cam").onclick=()=>pick(true);
  $("#pc-gal").onclick=()=>pick(false);
  if(!editing){ const exc=$("#pc-ex"); examples.forEach(ex=>{ const b=el("button","chip",BOSS.pieceTypeLabel(ex.type).split(" ")[0]+" · "+ex.tiers); b.title=ex.hint;
    b.onclick=()=>{ $("#pc-type").value=ex.type; $("#pc-canal").value=ex.canal; $("#pc-tiers").value=ex.tiers; }; exc.appendChild(b); }); }
  $("#pc-save").onclick=async()=>{
    const err=$("#pc-err"); err.textContent="";
    const montant=parseFloat($("#pc-montant").value)||0;
    if(montant<=0){ err.textContent="Indique le montant de la pièce."; return; }
    const np={...pc, type:$("#pc-type").value, canal:$("#pc-canal").value, montant, date:$("#pc-date").value, tiers:$("#pc-tiers").value.trim(), note:$("#pc-note").value.trim(), photo};
    if(editing) p.pieces[idx]=np; else p.pieces.push(np);
    await persist(); closeSheet(); renderPieces();
  };
  const del=$("#pc-del"); if(del) del.onclick=async()=>{ if(confirm("Supprimer cette pièce ?")){ p.pieces.splice(idx,1); await persist(); closeSheet(); renderPieces(); } };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ AIDE / TUTORIEL ============ */
const TUTO_STEPS=[
  {t:"Bienvenue sur BOSS",d:"Ton assistant te pose des questions et configure ton business tout seul. Tu peux tout ajuster ensuite dans Réglages."},
  {t:"Boutique",d:"Ajoute tes produits (photo + prix). Partage ton catalogue sur WhatsApp ou en PDF."},
  {t:"Commandes & livraisons",d:"Prends la commande, planifie la livraison, et à la livraison BOSS encaisse et met à jour le stock automatiquement (paiement à la livraison)."},
  {t:"Caisse & Carnet",d:"Note chaque vente et dépense. Le Carnet suit qui te doit de l'argent, avec relance WhatsApp."},
  {t:"Pièces comptables",d:"Photographie tes factures, reçus et quittances. Elles se trient par type, mode de règlement et période."},
  {t:"Tableau de bord",d:"Ton bénéfice, ton seuil de rentabilité, tes livraisons du jour et ta satisfaction client, d'un coup d'œil."}
];
function openHelp(){
  const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Aide & tutoriel</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="tuto">${TUTO_STEPS.map((s,i)=>`<div class="tuto-step"><div class="tuto-n">${i+1}</div><div><div class="tuto-t">${s.t}</div><div class="tuto-d">${s.d}</div></div></div>`).join("")}</div>
    <div class="ps-note">Astuce : appuie longuement (ou touche l'icône <b>?</b>) sur un écran pour un rappel. Tu peux rouvrir ce tutoriel depuis « Plus ».</div>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function openCatalogues(){
  const p=cur(); if(!Array.isArray(p.catalogues))p.catalogues=[]; const sheet=$("#sheet");
  const rows=p.catalogues.map((c,i)=>`<div class="cat-row"><div class="cat-info"><div class="cat-n">${escapeHtml(c.name)}</div><div class="cat-m">${(c.productIds||[]).length} produit(s)</div></div><button class="cat-b" data-a="pdf" data-i="${i}" title="PDF">${ic("doc")}</button><button class="cat-b" data-a="edit" data-i="${i}" title="Modifier">${ic("edit")}</button><button class="cat-b" data-a="del" data-i="${i}" title="Supprimer">${ic("del")}</button></div>`).join("");
  sheet.innerHTML=`<div class="sheet-head"><h3>Catalogues PDF</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="ps-note">Crée jusqu'à 5 catalogues (ex. « Tout », « Promo », « Nouveautés »). À la création, tous les produits sont cochés — tu décoches ceux à exclure.</div>
    <button class="plus-item" id="cat-full">${ic("doc")} Exporter tout le catalogue</button>
    ${rows?`<div class="pf-lbl">Mes catalogues</div><div class="cat-list">${rows}</div>`:""}
    ${p.catalogues.length<5?`<button class="sheet-add" id="cat-new" style="margin-top:10px">＋ Nouveau catalogue</button>`:`<div class="ps-note">Limite de 5 catalogues atteinte.</div>`}`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  $("#cat-full").onclick=()=>{ closeSheet(); exportCataloguePDF(null); };
  const nb=$("#cat-new"); if(nb) nb.onclick=()=>openCatalogueEditor(null);
  sheet.querySelectorAll(".cat-b").forEach(b=>b.onclick=async()=>{ const i=+b.dataset.i; if(b.dataset.a==="pdf"){ closeSheet(); exportCataloguePDF(p.catalogues[i]); } else if(b.dataset.a==="edit"){ openCatalogueEditor(i); } else { if(confirm("Supprimer ce catalogue ?")){ p.catalogues.splice(i,1); await persist(); openCatalogues(); } } });
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function openCatalogueEditor(idx){
  const p=cur(); const editing=idx!=null;
  const prods=(p.revenus||[]).filter(r=>r.prix>0);
  if(!prods.length){ alert("Ajoute d'abord des produits à ta boutique."); return; }
  const cat=editing?JSON.parse(JSON.stringify(p.catalogues[idx])):{id:"cat"+Date.now().toString(36),name:"",productIds:prods.map(r=>r.id)};
  const sel=new Set(cat.productIds||[]);
  const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>${editing?"Modifier le catalogue":"Nouveau catalogue"}</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="pf-lbl">Nom du catalogue</div><input class="field" id="cat-name" value="${escapeAttr(cat.name)}" placeholder="Ex. Promo, Nouveautés">
    <div class="cat-tools"><button class="chip" id="cat-all">Tout cocher</button><button class="chip" id="cat-none">Tout décocher</button></div>
    <div class="cat-picks" id="cat-picks"></div>
    <div class="lock-err" id="cat-err" style="text-align:left"></div>
    <button class="sheet-add" id="cat-save">${editing?"Enregistrer":"Créer le catalogue"}</button>`;
  renderIcons(sheet);
  const picks=$("#cat-picks");
  function draw(){ picks.innerHTML=""; prods.forEach(r=>{ const row=el("label","cat-pick"); row.innerHTML=`<input type="checkbox" ${sel.has(r.id)?"checked":""}><span class="cp-n">${escapeHtml(r.nom)}</span><span class="cp-p">${BOSS.fmtF(r.prix)}</span>`; row.querySelector("input").onchange=e=>{ if(e.target.checked)sel.add(r.id); else sel.delete(r.id); }; picks.appendChild(row); }); }
  draw();
  $("#cat-all").onclick=()=>{ prods.forEach(r=>sel.add(r.id)); draw(); };
  $("#cat-none").onclick=()=>{ sel.clear(); draw(); };
  $("#sheet-close").onclick=closeSheet;
  $("#cat-save").onclick=async()=>{
    const name=$("#cat-name").value.trim(); const err=$("#cat-err");
    if(!name){ err.textContent="Donne un nom au catalogue."; return; }
    if(!sel.size){ err.textContent="Sélectionne au moins un produit."; return; }
    const nc={id:cat.id,name,productIds:[...sel]};
    if(editing) p.catalogues[idx]=nc; else p.catalogues.push(nc);
    await persist(); openCatalogues();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ IDENTITÉ (nom, logo, mentions légales) ============ */
function legalHTML(id){
  const l1=[]; if(id.adresse)l1.push(escapeHtml(id.adresse)); if(id.tel)l1.push("Tél : "+escapeHtml(id.tel)); if(id.email)l1.push(escapeHtml(id.email));
  const l2=[]; if(id.rccm)l2.push("RCCM : "+escapeHtml(id.rccm)); if(id.ncc)l2.push("NCC : "+escapeHtml(id.ncc));
  let h=""; if(l1.length)h+=`<div class="rc-legal">${l1.join(" · ")}</div>`; if(l2.length)h+=`<div class="rc-legal">${l2.join(" · ")}</div>`;
  return h;
}
function openIdentity(){
  const p=cur(); if(!p.identite)p.identite={}; const id=p.identite; const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Identité de mon business</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="id-logo" id="id-logo">${id.logo?`<img src="${id.logo}" alt="">`:`<div class="id-logo-empty">${ic("image")}<span>Ajouter un logo</span></div>`}</div>
    <div class="pc-cap"><button class="plus-item" id="id-pick">${ic("image")} Choisir le logo</button>${id.logo?`<button class="plus-item" id="id-rm">${ic("del")} Retirer</button>`:""}</div>
    <div class="pf-lbl">Nom du business</div><input class="field" id="id-name" value="${escapeAttr(p.name||"")}" placeholder="Ex. Chez Awa">
    <div class="pf-lbl">Slogan (optionnel)</div><input class="field" id="id-slogan" value="${escapeAttr(id.slogan||"")}" placeholder="Ex. La mode à ta taille">
    <div class="pf-lbl">Adresse</div><input class="field" id="id-adresse" value="${escapeAttr(id.adresse||"")}" placeholder="Quartier, ville">
    <div class="pf-row"><div><div class="pf-lbl">Téléphone</div><input class="field" id="id-tel" value="${escapeAttr(id.tel||"")}" placeholder="0700000000"></div><div><div class="pf-lbl">Email</div><input class="field" id="id-email" value="${escapeAttr(id.email||"")}" placeholder="(optionnel)"></div></div>
    <div class="pf-lbl">RCCM (registre du commerce)</div><input class="field" id="id-rccm" value="${escapeAttr(id.rccm||"")}" placeholder="Ex. CI-ABJ-2026-B-12345">
    <div class="pf-lbl">NCC (numéro contribuable)</div><input class="field" id="id-ncc" value="${escapeAttr(id.ncc||"")}" placeholder="Ex. 1234567 A">
    <div class="pf-lbl">Mentions à afficher (catalogue & reçu)</div><input class="field" id="id-ment" value="${escapeAttr(id.mentions||"")}" placeholder="Ex. Merci de votre confiance · Échange sous 48h">
    <button class="sheet-add" id="id-save">Enregistrer</button>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  let logo=id.logo||null;
  function pick(){ const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*"; inp.onchange=async()=>{ const f=inp.files&&inp.files[0]; if(!f)return; const d=await resizeImage(f,320); if(d){ logo=d; $("#id-logo").innerHTML=`<img src="${d}" alt="">`; } }; inp.click(); }
  $("#id-pick").onclick=pick;
  const rm=$("#id-rm"); if(rm) rm.onclick=()=>{ logo=null; $("#id-logo").innerHTML=`<div class="id-logo-empty">${ic("image")}<span>Ajouter un logo</span></div>`; renderIcons($("#id-logo")); };
  $("#id-save").onclick=async()=>{
    p.name=$("#id-name").value.trim()||p.name;
    p.identite={logo, slogan:$("#id-slogan").value.trim(), adresse:$("#id-adresse").value.trim(), tel:$("#id-tel").value.trim(), email:$("#id-email").value.trim(), rccm:$("#id-rccm").value.trim(), ncc:$("#id-ncc").value.trim(), mentions:$("#id-ment").value.trim()};
    await persist(); closeSheet(); renderTopbar();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ REÇU (PDF) ============ */
function receiptPDF(order){
  const p=cur(); const id=p.identite||{}; const pa=$("#print-area"); if(!pa) return;
  const num="R-"+String(order.id||Date.now()).slice(-6).toUpperCase();
  const rows=(order.items||[]).map(it=>`<tr><td>${escapeHtml(it.nom)}</td><td class="r">${it.qty||1}</td><td class="r">${BOSS.fmtF(it.prix)}</td><td class="r">${BOSS.fmtF((it.prix||0)*(it.qty||1))}</td></tr>`).join("")
    || `<tr><td>Vente</td><td class="r">1</td><td class="r"></td><td class="r">${BOSS.fmtF(BOSS.orderTotal(order))}</td></tr>`;
  pa.innerHTML=`<div class="rc">
    <div class="rc-head">${id.logo?`<img src="${id.logo}" class="rc-logo">`:""}<div><div class="pc-biz">${escapeHtml(p.name||"Ma boutique")}</div>${id.slogan?`<div class="pc-sub">${escapeHtml(id.slogan)}</div>`:""}${legalHTML(id)}</div></div>
    <div class="rc-title">REÇU N° ${num}</div>
    <div class="rc-meta">Date : ${order.dateLivraison||BOSS.todayISO(Date.now())}${order.clientNom?(" · Client : "+escapeHtml(order.clientNom)):""}${order.clientPhone?(" · "+escapeHtml(order.clientPhone)):""}</div>
    <table class="rc-table"><thead><tr><th>Article</th><th class="r">Qté</th><th class="r">P.U.</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="rc-total">TOTAL : ${BOSS.fmtF(BOSS.orderTotal(order))}</div>
    <div class="rc-pay">Règlement : ${order.paiement==="livraison"?"à la livraison":"payé d'avance"}</div>
    ${id.mentions?`<div class="rc-ment">${escapeHtml(id.mentions)}</div>`:""}
    <div class="pc-foot">Merci de votre confiance${p.name?(" — "+escapeHtml(p.name)):""}</div></div>`;
  setTimeout(()=>{ try{ window.print(); }catch(e){} },60);
}

/* ============ TRÉSORERIE & RAPPROCHEMENT ============ */
function renderTreso(){
  const p=cur(); const host=$("#tr-accounts"); if(!host) return;
  const bal=BOSS.treasuryBalances(p);
  const icby={especes:"cash",banque:"bank",mobile:"pay"};
  host.innerHTML="";
  BOSS.TREASURY_ACCOUNTS.forEach(a=>{
    const card=el("div","tr-card");
    card.innerHTML=`<div class="tr-ic">${ic(icby[a.k]||"wallet")}</div><div class="tr-lbl">${a.label}</div><div class="tr-bal">${BOSS.fmtF(bal[a.k])}</div>`;
    host.appendChild(card);
  });
  const tot=$("#tr-total"); if(tot) tot.textContent=BOSS.fmtF(bal.total);
  renderIcons(host);
  // rapprochement bancaire
  const rp=(p.tresorerie&&p.tresorerie.rappro)||{statement:0,pointed:[]};
  const movs=BOSS.accountMovements(p,"banque");
  const res=BOSS.reconcile(p,rp.statement||0,rp.pointed||[]);
  const si=$("#tr-stmt"); if(si && document.activeElement!==si) si.value=rp.statement||"";
  $("#tr-recorded").textContent=BOSS.fmtF(res.recorded);
  $("#tr-pointed").textContent=BOSS.fmtF(res.pointed);
  $("#tr-ecart").textContent=BOSS.fmtF(res.ecart);
  const badge=$("#tr-badge"); badge.textContent=res.rapproche?"Rapproché ✓":"Écart"; badge.className="tr-badge "+(res.rapproche?"ok":"ko");
  const ml=$("#tr-movs"); ml.innerHTML="";
  if(!movs.length){ ml.innerHTML=`<div class="muted2" style="padding:10px 0">Aucun mouvement bancaire. En caisse, choisis « Banque » comme mode de règlement.</div>`; }
  const set=new Set(rp.pointed||[]);
  movs.forEach(e=>{
    const key=BOSS.movKey(e); const row=el("label","tr-mov");
    row.innerHTML=`<input type="checkbox" ${set.has(key)?"checked":""}><span class="trm-l">${escapeHtml(e.label||(e.type==="vente"?"Encaissement":"Décaissement"))}</span><span class="trm-a ${e.type==="vente"?"pos":"neg"}">${e.type==="vente"?"+":"−"}${BOSS.fmtF(e.montant)}</span>`;
    row.querySelector("input").onchange=async(ev)=>{ if(!p.tresorerie.rappro)p.tresorerie.rappro={statement:rp.statement||0,pointed:[]}; const arr=new Set(p.tresorerie.rappro.pointed||[]); if(ev.target.checked)arr.add(key); else arr.delete(key); p.tresorerie.rappro.pointed=[...arr]; await persist(); renderTreso(); };
    ml.appendChild(row);
  });
}
function openOpeningBalances(){
  const p=cur(); const s=(p.tresorerie&&p.tresorerie.soldes)||{}; const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Soldes initiaux</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="ps-note">Le montant que tu avais dans chaque compte au départ. La trésorerie s'ajuste ensuite avec tes ventes et dépenses.</div>
    <div class="pf-lbl">Caisse (espèces)</div><input class="field" id="ob-especes" type="number" inputmode="numeric" value="${s.especes||0}">
    <div class="pf-lbl">Banque</div><input class="field" id="ob-banque" type="number" inputmode="numeric" value="${s.banque||0}">
    <div class="pf-lbl">Mobile Money</div><input class="field" id="ob-mobile" type="number" inputmode="numeric" value="${s.mobile||0}">
    <button class="sheet-add" id="ob-save">Enregistrer</button>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  $("#ob-save").onclick=async()=>{ if(!p.tresorerie)p.tresorerie={}; p.tresorerie.soldes={especes:parseFloat($("#ob-especes").value)||0,banque:parseFloat($("#ob-banque").value)||0,mobile:parseFloat($("#ob-mobile").value)||0}; await persist(); closeSheet(); renderTreso(); renderDash&&renderDash(); };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ SAISIE CAISSE (POS) ============ */
let posTicket=[], posCanal="especes", posCollabId="", posCaisseId="";
function posStats(p){
  const t0=BOSS.startOfDay(Date.now());
  const today=(p.caisse||[]).filter(e=>e.type==="vente"&&e.ts>=t0&&e.statut!=="a_valider");
  const ca=today.reduce((s,e)=>s+e.montant,0);
  const vol=today.reduce((s,e)=>s+(Array.isArray(e.items)?e.items.reduce((a,l)=>a+(l.qty||1),0):(e.qty||1)),0);
  return {ca,vol,count:today.length};
}
function renderPOS(){
  const p=cur(); const grid=$("#pos-grid"); if(!grid) return;
  if(!posCaisseId && p.caisses[0]) posCaisseId=p.caisses[0].id;
  const ks=$("#pos-caisse"); ks.innerHTML=p.caisses.map(k=>`<option value="${k.id}" ${k.id===posCaisseId?"selected":""}>${escapeHtml(k.nom)}</option>`).join("");
  const cs=$("#pos-collab"); cs.innerHTML=`<option value="">Propriétaire</option>`+p.collaborateurs.filter(c=>c.actif!==false).map(c=>`<option value="${c.id}" ${c.id===posCollabId?"selected":""}>${escapeHtml(c.nom||"Collaborateur")} · ${(BOSS.ROLES[c.role]||{}).label||c.role}</option>`).join("");
  ks.onchange=()=>{ posCaisseId=ks.value; }; cs.onchange=()=>{ posCollabId=cs.value; };
  const st=posStats(p); $("#pos-ca").textContent=BOSS.fmtF(st.ca); $("#pos-vol").textContent=st.vol+" art.";
  const term=BOSS.normalize($("#pos-search")?$("#pos-search").value:"");
  const prods=p.revenus.filter(r=>r.prix>0 && (!term||BOSS.normalize(r.nom).includes(term)));
  grid.innerHTML="";
  if(!prods.length){ grid.innerHTML=`<div class="muted2" style="padding:14px 0;grid-column:1/-1">Aucun produit. Ajoute-les dans Boutique.</div>`; }
  prods.forEach(r=>{ const b=el("button","pos-p"); b.innerHTML=`<span class="pp-n">${escapeHtml(r.nom)}</span><span class="pp-pr">${BOSS.fmtF(r.prix)}</span>${typeof r.stock==="number"?`<span class="pp-s ${r.stock<=5?"low":""}">${r.stock}</span>`:""}`; b.onclick=()=>posAdd(r); grid.appendChild(b); });
  renderPOSTicket();
}
function posAdd(r){ const ex=posTicket.find(l=>l.id===r.id); if(ex) ex.qty++; else posTicket.push({id:r.id,nom:r.nom,prix:r.prix,qty:1}); renderPOSTicket(); }
function renderPOSTicket(){
  const box=$("#pos-ticket"); if(!box) return; box.innerHTML="";
  posTicket.forEach((l,i)=>{ const row=el("div","pos-line"); row.innerHTML=`<span class="pl-n">${escapeHtml(l.nom)}</span><span class="pl-q"><button class="pl-b" data-d="-1">−</button>${l.qty}<button class="pl-b" data-d="1">+</button></span><span class="pl-t">${BOSS.fmtF(l.prix*l.qty)}</span><button class="pl-x" aria-label="Retirer">${ic("close")}</button>`;
    row.querySelectorAll(".pl-b").forEach(b=>b.onclick=()=>{ l.qty=Math.max(1,l.qty+parseInt(b.dataset.d,10)); renderPOSTicket(); });
    row.querySelector(".pl-x").onclick=()=>{ posTicket.splice(i,1); renderPOSTicket(); };
    box.appendChild(row);
  });
  renderIcons(box);
  $("#pos-total").textContent=BOSS.fmtF(BOSS.ticketTotal(posTicket));
  posMonnaie();
}
function posMonnaie(){
  const total=BOSS.ticketTotal(posTicket);
  const recu=parseFloat($("#pos-recu")?$("#pos-recu").value:0)||0;
  const m=BOSS.makeChange(total,recu);
  const box=$("#pos-monnaie"); if(!box) return;
  if(!recu){ box.textContent=""; box.className="pos-monnaie"; }
  else if(m.insuffisant){ box.textContent="Manque "+BOSS.fmtF(m.manque); box.className="pos-monnaie ko"; }
  else { box.textContent="Monnaie à rendre : "+BOSS.fmtF(m.rendu); box.className="pos-monnaie ok"; }
}
async function posValider(withReceipt){
  const p=cur(); const total=BOSS.ticketTotal(posTicket);
  if(!posTicket.length||total<=0) return;
  const collab=p.collaborateurs.find(c=>c.id===posCollabId)||null;
  const canV=BOSS.collabCan(collab,"valider");
  const entry={id:"m"+Date.now().toString(36),ts:Date.now(),type:"vente",montant:total,canal:posCanal,
    items:posTicket.map(l=>({id:l.id,nom:l.nom,prix:l.prix,qty:l.qty})),
    caisseId:posCaisseId, collaborateurId:collab?collab.id:null, collaborateurNom:collab?(collab.nom||"Collaborateur"):"Propriétaire",
    statut:canV?"valide":"a_valider"};
  p.caisse.push(entry);
  posTicket.forEach(l=>{ const r=p.revenus.find(x=>x.id===l.id); if(r&&typeof r.stock==="number") r.stock=Math.max(0,r.stock-l.qty); });
  await persist();
  const receiptEntry=entry;
  posTicket=[]; if($("#pos-recu"))$("#pos-recu").value="";
  renderPOS(); renderCaisse&&renderCaisse(); renderDash&&renderDash(); renderStock&&renderStock(); renderTreso&&renderTreso();
  if(withReceipt) receiptFromCaisse(receiptEntry);
  else if(!canV) alert("Vente enregistrée — en attente de validation du manager.");
}

/* ============ ÉQUIPE (collaborateurs) ============ */
function accountCounts(){
  let collaborateurs=0, caisses=0; const metiers=Object.keys(state.profiles).length;
  Object.values(state.profiles).forEach(p=>{ collaborateurs+=(p.collaborateurs||[]).filter(c=>c.actif!==false).length; caisses+=(p.caisses||[]).length; });
  return {metiers, collaborateurs, caisses};
}
function currentDueTotal(){ return BOSS.billingDue(state.license,accountCounts()).total; }
async function acceptMonthlyUpdate(reason,silent){
  const m=currentDueTotal();
  if(!state.license) state.license=BOSS.defaultLicense();
  state.license.acceptedMonthly=m; state.license.acceptedAt=Date.now();
  await persist();
  if(!silent) alert("Coût d'utilisation mensuel mis à jour : "+BOSS.fmtF(m)+" / mois.\nCe montant est facturé chaque mois tant que la fonction est active.");
  enforceLicense&&enforceLicense();
  return m;
}
function openAbonnement(){
  const counts=accountCounts();
  const due=BOSS.billingDue(state.license,counts);
  const st=BOSS.licenseStatus(state.license,counts.metiers,Date.now());
  const sheet=$("#sheet");
  const lignes=[];
  if(due.base) lignes.push(["Abonnement de base",due.base]);
  if(due.metierExtra) lignes.push([counts.metiers+" métiers (extra)",due.metierExtra]);
  if(due.nbCollab) lignes.push([due.nbCollab+" collaborateur(s) × "+BOSS.fmtF(due.perC),due.collabs]);
  if(due.nbCaisseExtra) lignes.push([due.nbCaisseExtra+" caisse(s) en + × "+BOSS.fmtF(due.perK),due.caisses]);
  const echeance = st.state==="active"&&st.paidUntil ? new Date(st.paidUntil).toLocaleDateString("fr-FR") : (st.state==="trial"?("fin d'essai dans "+st.daysLeftTrial+" j"):"à régler");
  sheet.innerHTML=`<div class="sheet-head"><h3>Abonnement mensuel</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="abo-total"><span>Coût d'utilisation</span><b>${BOSS.fmtF(due.total)}</b><span class="abo-mois">/ mois</span></div>
    <div class="abo-lines">${lignes.length?lignes.map(l=>`<div><span>${l[0]}</span><b>${BOSS.fmtF(l[1])}</b></div>`).join(""):`<div><span>Aucune fonction payante activée</span><b>0</b></div>`}</div>
    <div class="abo-status">État : <b>${({trial:"Essai",active:"Actif",grace:"Paiement en attente",locked:"Bloqué"})[st.state]||st.state}</b> · Prochaine échéance : ${echeance}</div>
    <div class="ps-note">Le coût se met à jour <b>automatiquement</b> quand tu actives une fonction : chaque collaborateur ajouté coûte ${BOSS.fmtF(due.perC)}/mois, chaque caisse supplémentaire ${BOSS.fmtF(due.perK)}/mois.</div>
    <button class="plus-item" id="abo-treso">${ic("wallet")} Facturation automatique en multi-appareils : nécessite le serveur</button>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  const bt=$("#abo-treso"); if(bt) bt.onclick=()=>{ closeSheet(); };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function openTeam(){
  const p=cur(); const sheet=$("#sheet");
  const rows=p.collaborateurs.map((c,i)=>`<div class="cat-row"><div class="cat-info"><div class="cat-n">${escapeHtml(c.nom||"(sans nom)")}${c.actif===false?" · inactif":""}</div><div class="cat-m">${(BOSS.ROLES[c.role]||{}).label||c.role} · ${(c.permissions||[]).length} droit(s)</div></div><button class="cat-b" data-a="edit" data-i="${i}">${ic("edit")}</button><button class="cat-b" data-a="del" data-i="${i}">${ic("del")}</button></div>`).join("");
  const due=BOSS.billingDue(state.license,accountCounts());
  sheet.innerHTML=`<div class="sheet-head"><h3>Mon équipe</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="ps-note">Ajoute des collaborateurs et définis leur rôle, leurs droits et leurs vues. Location : <b>${BOSS.fmtF(due.perC)}</b>/mois par collaborateur (mis à jour automatiquement).</div>
    ${rows?`<div class="cat-list">${rows}</div>`:`<div class="muted2" style="padding:8px 0">Aucun collaborateur pour l'instant.</div>`}
    <button class="sheet-add" id="team-new" style="margin-top:8px">＋ Nouveau collaborateur</button>
    <div class="ps-note">⚠️ Que chaque collaborateur travaille sur <b>son propre téléphone</b> avec connexion et validation en temps réel du manager nécessite le serveur (voir guide back-end). Sur cet appareil, tu configures les rôles et le circuit de validation.</div>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  $("#team-new").onclick=()=>openCollab(null);
  sheet.querySelectorAll(".cat-b").forEach(b=>b.onclick=async()=>{ const i=+b.dataset.i; if(b.dataset.a==="edit") openCollab(i); else { if(confirm("Retirer ce collaborateur ?")){ p.collaborateurs.splice(i,1); await persist(); await acceptMonthlyUpdate("collab",true); openTeam(); } } });
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function openCollab(idx){
  const p=cur(); const editing=idx!=null;
  const c=editing?JSON.parse(JSON.stringify(p.collaborateurs[idx])):BOSS.blankCollaborateur("commercial");
  const perms=new Set(c.permissions||[]);
  const sheet=$("#sheet");
  const roleOpts=Object.entries(BOSS.ROLES).filter(([k])=>k!=="proprietaire").map(([k,v])=>`<option value="${k}" ${c.role===k?"selected":""}>${v.label}</option>`).join("");
  const caisseOpts=`<option value="">— Toutes —</option>`+p.caisses.map(k=>`<option value="${k.id}" ${c.caisseId===k.id?"selected":""}>${escapeHtml(k.nom)}</option>`).join("");
  sheet.innerHTML=`<div class="sheet-head"><h3>${editing?"Modifier":"Nouveau collaborateur"}</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="pf-lbl">Nom</div><input class="field" id="co-nom" value="${escapeAttr(c.nom||"")}" placeholder="Nom du collaborateur">
    <div class="pf-lbl">Rôle</div><select class="field" id="co-role">${roleOpts}</select>
    <div class="pf-lbl">Caisse assignée</div><select class="field" id="co-caisse">${caisseOpts}</select>
    <div class="pf-lbl">Droits & vues</div><div class="cat-picks" id="co-perms"></div>
    <label class="switch-row"><span>Actif</span><input type="checkbox" id="co-actif" ${c.actif!==false?"checked":""}></label>
    <div class="lock-err" id="co-err" style="text-align:left"></div>
    <button class="sheet-add" id="co-save">${editing?"Enregistrer":"Ajouter"}</button>`;
  renderIcons(sheet);
  const pc=$("#co-perms");
  function drawPerms(){ pc.innerHTML=""; BOSS.COLLAB_PERMS.forEach(pm=>{ const row=el("label","cat-pick"); row.innerHTML=`<input type="checkbox" ${perms.has(pm.k)?"checked":""}><span class="cp-n">${pm.label}</span>`; row.querySelector("input").onchange=e=>{ if(e.target.checked)perms.add(pm.k); else perms.delete(pm.k); }; pc.appendChild(row); }); }
  drawPerms();
  $("#co-role").onchange=()=>{ perms.clear(); BOSS.defaultPermsForRole($("#co-role").value).forEach(x=>perms.add(x)); drawPerms(); };
  $("#sheet-close").onclick=closeSheet;
  $("#co-save").onclick=async()=>{
    const nom=$("#co-nom").value.trim(); const err=$("#co-err");
    if(!nom){ err.textContent="Indique le nom."; return; }
    const nc={...c, nom, role:$("#co-role").value, caisseId:$("#co-caisse").value, permissions:[...perms], actif:$("#co-actif").checked};
    if(editing) p.collaborateurs[idx]=nc; else p.collaborateurs.push(nc);
    await persist(); await acceptMonthlyUpdate("collaborateur", editing); openTeam();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function openRegisters(){
  const p=cur(); const sheet=$("#sheet");
  const due=BOSS.billingDue(state.license,accountCounts());
  const rows=p.caisses.map((k,i)=>`<div class="cat-row"><div class="cat-info"><div class="cat-n">${escapeHtml(k.nom)}</div></div><button class="cat-b" data-a="ren" data-i="${i}">${ic("edit")}</button>${p.caisses.length>1?`<button class="cat-b" data-a="del" data-i="${i}">${ic("del")}</button>`:""}</div>`).join("");
  sheet.innerHTML=`<div class="sheet-head"><h3>Caisses de saisie</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="ps-note">La 1re caisse est incluse. Chaque caisse supplémentaire : <b>${BOSS.fmtF(due.perK)}</b>/mois.</div>
    <div class="cat-list">${rows}</div>
    <button class="sheet-add" id="reg-new" style="margin-top:8px">＋ Ajouter une caisse</button>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  $("#reg-new").onclick=async()=>{ const nom=prompt("Nom de la caisse (ex. Comptoir, Terrasse) :"); if(!nom)return; p.caisses.push({id:"k"+Date.now().toString(36),nom:nom.trim()}); await persist(); await acceptMonthlyUpdate("caisse",false); openRegisters(); };
  sheet.querySelectorAll(".cat-b").forEach(b=>b.onclick=async()=>{ const i=+b.dataset.i; if(b.dataset.a==="ren"){ const nom=prompt("Nouveau nom :",p.caisses[i].nom); if(nom){ p.caisses[i].nom=nom.trim(); await persist(); openRegisters(); } } else { if(confirm("Supprimer cette caisse ?")){ p.caisses.splice(i,1); await persist(); await acceptMonthlyUpdate("caisse",true); openRegisters(); } } });
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}
function pendingSales(p){ return (p.caisse||[]).filter(e=>e.statut==="a_valider").sort((a,b)=>b.ts-a.ts); }
function openValidations(){
  const p=cur(); const sheet=$("#sheet"); const pend=pendingSales(p);
  const rows=pend.map(e=>`<div class="cat-row"><div class="cat-info"><div class="cat-n">${BOSS.fmtF(e.montant)}</div><div class="cat-m">${escapeHtml(e.collaborateurNom||"")} · ${(e.items||[]).map(l=>escapeHtml(l.nom)+"×"+l.qty).join(", ")}</div></div><button class="cat-b" data-a="ok" data-id="${e.id}" title="Valider">${ic("check")}</button><button class="cat-b" data-a="no" data-id="${e.id}" title="Refuser">${ic("close")}</button></div>`).join("");
  sheet.innerHTML=`<div class="sheet-head"><h3>Ventes à valider</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    ${pend.length?`<div class="cat-list">${rows}</div>`:`<div class="muted2" style="padding:10px 0">Aucune vente en attente ✓</div>`}
    <div class="ps-note">Le manager valide ici les ventes saisies par les collaborateurs sans droit de validation. En multi-appareils, cette validation se fait en temps réel via le serveur.</div>`;
  renderIcons(sheet);
  $("#sheet-close").onclick=closeSheet;
  sheet.querySelectorAll(".cat-b").forEach(b=>b.onclick=async()=>{ const e=p.caisse.find(x=>x.id===b.dataset.id); if(!e)return;
    if(b.dataset.a==="ok"){ e.statut="valide"; }
    else { (e.items||[]).forEach(l=>{ const r=p.revenus.find(x=>x.id===l.id); if(r&&typeof r.stock==="number") r.stock+=l.qty; }); p.caisse=p.caisse.filter(x=>x.id!==e.id); }
    await persist(); openValidations(); renderCaisse&&renderCaisse(); renderDash&&renderDash(); renderTreso&&renderTreso();
  });
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ ICÔNES VECTORIELLES (tracé) ============ */
const ICON={
 boutique:'<path d="M5 8h14l-1 11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 8z"/><path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8"/>',
 caisse:'<path d="M6 3h12v18l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3L6 21V3z"/><path d="M9 8h6M9 12h6"/>',
 carnet:'<path d="M7 4h10a1 1 0 0 1 1 1v15H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M5 6a2 2 0 0 1 2-2M9 9h6M9 13h4"/>',
 dash:'<path d="M5 13v6M12 8v11M19 4v15"/>',
 plus_menu:'<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
 stock:'<path d="M12 3l8 4v10l-8 4-8-4V7l8-4z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
 clients:'<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6M21 20a5.5 5.5 0 0 0-4-5.3"/>',
 historique:'<path d="M4 5v14h16"/><path d="M7 14l4-4 3 2 4-5"/>',
 config:'<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V20a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 7 18.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4 12.6a2 2 0 0 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 4H11a2 2 0 0 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9z"/>',
 onboard:'<path d="M4 5h16v11H9l-4 4V5z"/><path d="M8 10h8M8 13h5"/>',
 admin:'<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
 sync:'<path d="M4 9a8 8 0 0 1 13.7-3.7L20 7M20 15A8 8 0 0 1 6.3 18.7L4 17"/><path d="M20 4v3h-3M4 20v-3h3"/>',
 pay:'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
 add:'<path d="M12 5v14M5 12h14"/>',
 edit:'<path d="M5 19h3l9.5-9.5-3-3L5 16v3z"/><path d="M14 6.5l3 3"/>',
 del:'<path d="M5 7h14M10 7V5h4v2M6.5 7l1 13h9l1-13"/>',
 share:'<path d="M6 13v6h12v-6"/><path d="M12 16V4M8 8l4-4 4 4"/>',
 close:'<path d="M6 6l12 12M18 6L6 18"/>',
 theme:'<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/>',
 lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
 send:'<path d="M4 12l16-7-7 16-2-7-7-2z"/>',
 install:'<path d="M12 4v10M8 11l4 4 4-4M5 19h14"/>',
 export:'<path d="M12 16V4M8 8l4-4 4 4M5 20h14"/>',
 import:'<path d="M12 4v12M8 12l4 4 4-4M5 20h14"/>',
 copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
 camera:'<path d="M4 8h3l1.5-2h7L17 8h3v11H4V8z"/><circle cx="12" cy="13" r="3"/>',
 image:'<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l4-4 3 3 3-3 4 4"/>',
 commandes:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h4"/>',
 truck:'<path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="7.5" cy="18" r="1.6"/><circle cx="16.5" cy="18" r="1.6"/>',
 calendar:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/>',
 star:'<path d="M12 4l2.4 5 5.4.5-4.1 3.6 1.2 5.4L12 16.2 6.9 18.5 8.1 13.1 4 9.5 9.6 9z"/>',
 phone:'<path d="M5 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A14 14 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
 check:'<path d="M5 12l4 4 10-10"/>',
 pin:'<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
 clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
 ai:'<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>',
 doc:'<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v3h3M9 12h6M9 16h4"/>',
 bank:'<path d="M4 10h16M5 10l7-5 7 5M6 10v7M10 10v7M14 10v7M18 10v7M3 20h18"/>',
 cash:'<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.4"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.4 2.4 0 0 1 4.4 1.3c0 1.6-2 2-2 3.3"/><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/>',
 camera2:'<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3"/>',
 wallet:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 14h2.5"/>',
 idcard:'<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M6 16a3 3 0 0 1 6 0M14 9h4M14 13h4"/>',
 bank2:'<path d="M4 10h16M5 10l7-5 7 5M6 10v7M18 10v7M10 10v7M14 10v7M3 20h18"/>',
 pos:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2.5M13.5 11h2.5M8 15h2.5M13.5 15h2.5"/>',
 coins:'<circle cx="9" cy="9" r="5"/><path d="M14.5 5.2a5 5 0 0 1 0 7.6M7 9h4"/>',
 team:'<circle cx="8" cy="8" r="3"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="8" r="2.5"/><path d="M15 14.2A5 5 0 0 1 21.5 19"/>',
 user:'<circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
 cloud:'<path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.9-1 4 4 0 0 0 .9 9z"/>',
 warn:'<path d="M12 4l10 17H2z"/><path d="M12 10v5M12 18.5v.1"/>',
 building:'<rect x="5" y="4" width="14" height="16" rx="1"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2"/>',
 chef:'<path d="M7 12a4 4 0 1 1 5-6 4 4 0 1 1 5 6v3H7z"/><path d="M7 15h10v3a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z"/>',
 bed:'<path d="M3 8v12M21 20V12a3 3 0 0 0-3-3H8v11"/><path d="M3 14h18"/><circle cx="7" cy="12" r="1.6"/>',
 book:'<path d="M6 4h11a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a2 2 0 0 1 0-4h12"/><path d="M9 8h6M9 11h5"/>',
 shears:'<circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M8.8 15L20 4M15.2 15L4 4M10 12l4 0"/>',
 chick:'<circle cx="12" cy="12" r="7"/><circle cx="14" cy="10" r="0.8" fill="currentColor" stroke="none"/><path d="M18 12l3-1-2 3M9 17a4 4 0 0 0 6 0"/>',
 wrench:'<path d="M14 6a4 4 0 0 1 5 5l-9 9-4-4z"/><circle cx="16" cy="8" r="1" fill="currentColor" stroke="none"/>',
 factory:'<path d="M3 20V10l6 3V10l6 3V7l6 3v10z"/><path d="M7 20v-4M12 20v-4M17 20v-4"/>',
 sprout:'<path d="M12 21V10"/><path d="M12 12a5 5 0 0 0-5-5H4a5 5 0 0 0 8 5zM12 14a5 5 0 0 1 5-5h3a5 5 0 0 1-8 5z"/>'
};

/* Correspondance métier -> icône outline (topbar, chips) */
const METIER_IC={vendeur:"boutique",maquis:"chef",hotel:"bed",industrie:"factory",enseignant:"book",couturier:"shears",eleveur:"chick",mecanicien:"wrench",transformateur:"factory",producteur:"sprout"};
function ic(name,cls){ const p=ICON[name]||""; return `<svg class="ic ${cls||""}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`; }
function renderIcons(root){ (root||document).querySelectorAll("[data-ic]").forEach(e=>{ const n=e.getAttribute("data-ic"); if(ICON[n]) e.innerHTML=ic(n); }); }

/* ============ THÈME ============ */
const ACCENTS=[["Ocre","#C8A23A"],["Gris","#8A8A8A"]];
const PAL={
  dark:{black:"#0E0E0F",char:"#1A1A1C",char2:"#242427",line:"#34343A",line2:"#28282D",cream:"#ECECEE",dim:"#9A9AA0",field:"#0b0b0c",card:"#1A1A1C"},
  light:{black:"#F4F4F5",char:"#FFFFFF",char2:"#EEEEF0",line:"#DBDBE0",line2:"#E6E6EA",cream:"#1B1B1D",dim:"#6B6B72",field:"#FFFFFF",card:"#FFFFFF"}
};
function hexToRgb(h){h=String(h||"#000").replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");return [parseInt(h.slice(0,2),16)||0,parseInt(h.slice(2,4),16)||0,parseInt(h.slice(4,6),16)||0];}
function darken(h,f){const[r,g,b]=hexToRgb(h);return `rgb(${Math.round(r*(1-f))},${Math.round(g*(1-f))},${Math.round(b*(1-f))})`;}
function isLight(h){const[r,g,b]=hexToRgb(h);return (0.299*r+0.587*g+0.114*b)>150;}
function applyTheme(t){
  t=t||state.theme||{mode:"dark",accent:"#C8A23A"};
  const p=PAL[t.mode==="light"?"light":"dark"]; const acc=t.accent||"#C8A23A";
  const rs=document.documentElement.style;
  rs.setProperty("--black",p.black);rs.setProperty("--char",p.char);rs.setProperty("--char2",p.char2);
  rs.setProperty("--line",p.line);rs.setProperty("--line2",p.line2);rs.setProperty("--cream",p.cream);rs.setProperty("--cream-dim",p.dim);
  rs.setProperty("--field-bg",p.field);rs.setProperty("--card-accent",p.card);
  rs.setProperty("--gold",acc);rs.setProperty("--gold-dim",darken(acc,0.32));
  rs.setProperty("--on-accent",isLight(acc)?"#16140d":"#ffffff");
  // palette restreinte : positif = ocre, négatif/alerte = gris (pas d'autres couleurs)
  rs.setProperty("--green",acc);
  rs.setProperty("--amber",acc);
  rs.setProperty("--red",p.dim);
  rs.setProperty("--wa",acc);
  const mt=document.querySelector('meta[name=theme-color]'); if(mt) mt.setAttribute("content",p.black);
}
function toggleMode(){ state.theme=state.theme||{mode:"dark",accent:"#C8A23A"}; state.theme.mode=(state.theme.mode==="light")?"dark":"light"; applyTheme(state.theme); persist(); }
function openAppearance(){
  const t=state.theme||{mode:"dark",accent:"#C8A23A"}; const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Apparence</h3><button class="x" id="sheet-close" data-ic="close"></button></div>
    <div class="pf-lbl">Mode</div>
    <div class="mode-seg"><button class="mode-b ${t.mode!=="light"?"on":""}" data-m="dark">Sombre</button><button class="mode-b ${t.mode==="light"?"on":""}" data-m="light">Clair</button></div>
    <div class="pf-lbl">Accent</div>
    <div class="swatches" id="ap-sw"></div>
    <div class="ps-note">Identité BOSS : noir, gris et jaune ocre.</div>`;
  $("#sheet-close").onclick=closeSheet;
  const sw=$("#ap-sw");
  ACCENTS.forEach(([nm,hex])=>{ const b=el("button","swatch"+((t.accent||"").toLowerCase()===hex.toLowerCase()?" on":"")); b.style.background=hex; b.title=nm;
    b.onclick=async()=>{ state.theme=Object.assign({},state.theme,{accent:hex}); applyTheme(state.theme); sw.querySelectorAll(".swatch").forEach(x=>x.classList.remove("on")); b.classList.add("on"); await persist(); refreshAll(); }; sw.appendChild(b); });
  sheet.querySelectorAll(".mode-b").forEach(b=>b.onclick=async()=>{ state.theme=Object.assign({},state.theme,{mode:b.dataset.m}); applyTheme(state.theme); sheet.querySelectorAll(".mode-b").forEach(x=>x.classList.toggle("on",x===b)); await persist(); refreshAll(); });
  renderIcons(sheet);
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ LICENCE / VERROUILLAGE ============ */
function genDeviceId(){ return "BOSS-"+Math.random().toString(36).slice(2,6).toUpperCase()+"-"+Math.random().toString(36).slice(2,6).toUpperCase(); }
function metiersCount(){ return Math.max(1,Object.keys(state.profiles).length); }
function enforceLicense(){
  if(!state.license) return true;
  const st=BOSS.licenseStatus(state.license,metiersCount(),Date.now());
  const banner=$("#lock-banner"), lock=$("#lock-screen");
  if(st.state==="locked"){ showLock(st); return false; }
  if(lock) lock.style.display="none";
  if(!banner) return true;
  if(st.state==="grace"){
    banner.style.display="block"; banner.style.animation=""; banner.style.background=""; banner.style.color="";
    const _due=currentDueTotal(); banner.innerHTML=`⏳ Paiement en attente — blocage dans ${st.hoursLeft}h. ${_due?(BOSS.fmtF(_due)+" / mois. "):""}Touche pour régler / saisir le code.`;
    banner.onclick=openPayUnlock;
  } else if(st.state==="trial" && st.daysLeftTrial<=7){
    banner.style.display="block"; banner.style.animation="none"; banner.style.background="var(--char2)"; banner.style.color="var(--cream)";
    banner.innerHTML=`Essai : ${st.daysLeftTrial} jour(s) restant(s). Touche pour activer.`;
    banner.onclick=openPayUnlock;
  } else { banner.style.display="none"; }
  return true;
}
function showLock(st){
  const lock=$("#lock-screen"); if(!lock) return;
  $("#lock-msg").textContent = state.license.lockedManually ? "Accès suspendu par l'administrateur." : "Ta période d'utilisation est terminée. Règle pour continuer à utiliser BOSS.";
  const _due=currentDueTotal(); $("#lock-amt").textContent = _due ? "Abonnement : "+BOSS.fmtF(_due)+" / mois" : "";
  $("#lock-device").textContent = state.deviceId;
  $("#lock-err").textContent="";
  lock.style.display="flex";
}
async function applyUnlock(code,errEl){
  const payload=await BOSS.verifyLicenseToken(String(code||"").trim());
  if(!payload){ if(errEl)errEl.textContent="Code invalide."; return false; }
  if(payload.d && payload.d!==state.deviceId){ if(errEl)errEl.textContent="Ce code n'est pas pour cet appareil."; return false; }
  if(payload.e && payload.e<Date.now()){ if(errEl)errEl.textContent="Ce code a expiré."; return false; }
  state.license.paidUntil=payload.e||(Date.now()+30*86400000);
  state.license.lockedManually=false;
  await persist();
  return true;
}
function openPayUnlock(){
  const st=BOSS.licenseStatus(state.license,metiersCount(),Date.now());
  const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Activer / Déverrouiller</h3><button class="x" id="sheet-close">×</button></div>
    ${currentDueTotal()?`<div class="lock-amt" style="text-align:left;margin-bottom:8px">Abonnement : ${BOSS.fmtF(currentDueTotal())} / mois</div>`:""}
    <div class="ps-note">Paie ton abonnement, puis saisis le code que l'administrateur te donne.</div>
    <div class="lock-dev" style="text-align:left">Ton code appareil :<br><b>${state.deviceId}</b></div>
    <input class="field" id="pu-code" placeholder="Code de déverrouillage">
    <button class="sheet-add" id="pu-go">Déverrouiller</button>
    <div class="lock-err" id="pu-err"></div>`;
  $("#sheet-close").onclick=closeSheet;
  $("#pu-go").onclick=async()=>{ const okc=await applyUnlock($("#pu-code").value,$("#pu-err")); if(okc){ closeSheet(); enforceLicense(); refreshAll(); } };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============ CONSOLE ADMINISTRATEUR (locale) ============ */
function openAdmin(){
  if(!state.admin) state.admin={role:"proprietaire"};
  if(!state.admin.pin){ const set=prompt("Crée un code administrateur (à retenir) :"); if(!set) return; state.admin.pin=String(set); persist(); }
  else { const p=prompt("Code administrateur :"); if(String(p)!==String(state.admin.pin)){ alert("Code incorrect."); return; } }
  adminPanel();
}
let __adminTab="apercu";
function adminPanel(){
  const sheet=$("#sheet");
  sheet.innerHTML=`<div class="sheet-head"><h3>Espace administrateur</h3><button class="x" id="sheet-close">×</button></div>
    <div class="admin-tabs">
      <button class="admin-tab" data-t="apercu">Aperçu</button>
      <button class="admin-tab" data-t="equipe">Équipe</button>
      <button class="admin-tab" data-t="donnees">Données</button>
      <button class="admin-tab" data-t="business">Business</button>
      <button class="admin-tab" data-t="licence">Licence</button>
    </div>
    <div id="admin-body"></div>`;
  $("#sheet-close").onclick=closeSheet;
  sheet.querySelectorAll(".admin-tab").forEach(b=>{
    b.onclick=()=>{ __adminTab=b.dataset.t; renderAdminBody(); sheet.querySelectorAll(".admin-tab").forEach(x=>x.classList.toggle("on",x===b)); };
    if(b.dataset.t===__adminTab) b.classList.add("on");
  });
  renderAdminBody();
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function renderAdminBody(){
  const body=$("#admin-body"); if(!body) return;
  if(__adminTab==="apercu") return renderAdminApercu(body);
  if(__adminTab==="equipe") return renderAdminEquipe(body);
  if(__adminTab==="donnees") return renderAdminDonnees(body);
  if(__adminTab==="business") return renderAdminBusiness(body);
  if(__adminTab==="licence") return renderAdminLicence(body);
}

function renderAdminApercu(body){
  const nbBusiness=Object.keys(state.profiles||{}).length;
  const p=cur();
  const nbProduits=(p?.revenus||[]).length;
  const nbCharges=(p?.charges||[]).length;
  const nbCaisse=(p?.caisse||[]).length;
  const cloudStatus=(typeof Cloud!=="undefined"?Cloud.status():"off");
  const email=(typeof Cloud!=="undefined"&&Cloud.user()&&Cloud.user().email)||"—";
  const org=(state.cloud&&state.cloud.orgs&&state.cloud.orgs.find(o=>o.id===state.cloud.orgId))||null;
  const orgNom=org?org.nom:"—";
  const licState=BOSS.licenseStatus(state.license,metiersCount());
  const badgeMap={active:"En cours (payé)",trial:"Essai",grace:"Grâce (48h)",locked:"Verrouillé"};
  body.innerHTML=`
    <div class="ad-card">
      <div class="ad-card-title">Compte cloud</div>
      <div class="ad-row"><span>Statut</span><b>${escapeHtml(cloudStatus)}</b></div>
      <div class="ad-row"><span>Email</span><b>${escapeHtml(email)}</b></div>
      <div class="ad-row"><span>Organisation</span><b>${escapeHtml(orgNom)}</b></div>
      <div class="ad-row"><span>Rôle</span><b>${escapeHtml(state.admin?.role||"proprietaire")}</b></div>
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Ce business (${escapeHtml(p?.name||"—")})</div>
      <div class="ad-row"><span>Produits/services</span><b>${nbProduits}</b></div>
      <div class="ad-row"><span>Charges fixes</span><b>${nbCharges}</b></div>
      <div class="ad-row"><span>Écritures caisse</span><b>${nbCaisse}</b></div>
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Global</div>
      <div class="ad-row"><span>Nombre de business</span><b>${nbBusiness}</b></div>
      <div class="ad-row"><span>Licence</span><b>${escapeHtml(badgeMap[licState.state]||licState.state)}</b></div>
      <div class="ad-row"><span>Coût mensuel estimé</span><b>${BOSS.fmtF(currentDueTotal())}</b></div>
    </div>
    <button class="plus-item" id="ad-open-cloud">Gérer le compte cloud</button>
    <button class="plus-item" id="ad-open-sync">Forcer la synchronisation</button>`;
  $("#ad-open-cloud").onclick=()=>{ closeSheet(); openCloudSheet(); };
  $("#ad-open-sync").onclick=async()=>{
    if(typeof Cloud==="undefined"||!Cloud.available()){ alert("Espace en ligne non configuré"); return; }
    if(!Cloud.session()){ alert("Connecte-toi d'abord"); return; }
    const ok=await Cloud.syncNow();
    alert(ok?"Synchronisation réussie ✅":"Échec de la synchronisation");
  };
}

async function renderAdminEquipe(body){
  body.innerHTML=`<div class="ps-note">Chargement de l'équipe…</div>`;
  if(typeof Cloud==="undefined" || !Cloud.available() || !Cloud.session() || !Cloud.currentOrgId()){
    body.innerHTML=`<div class="ps-note">Connecte-toi et crée ton organisation pour gérer une équipe. <button class="plus-item" id="ad-goto-cloud">Ouvrir l'espace en ligne</button></div>`;
    const b=$("#ad-goto-cloud"); if(b) b.onclick=()=>{ closeSheet(); openCloudSheet(); };
    return;
  }
  const [members, invites] = await Promise.all([Cloud.listMembers().catch(()=>[]), Cloud.listInvitations().catch(()=>[])]);
  const rolesOpts = ["proprietaire","manager","collaborateur","comptable","commercial"];
  const rows = members.map(m=>`
    <div class="ad-mem-row">
      <div class="ad-mem-info">
        <b>${escapeHtml(m.nom||m.user_id.slice(0,8))}</b>
        <span class="ad-mem-role">${escapeHtml(m.role)}</span>
      </div>
    </div>`).join("");
  const invRows = invites.map(iv=>`
    <div class="ad-inv-row">
      <div><b>${escapeHtml(iv.email)}</b> · <span class="muted2">${escapeHtml(iv.role)}</span></div>
      <div><code style="user-select:all;font-size:11px">${escapeHtml(iv.token)}</code></div>
    </div>`).join("");
  body.innerHTML=`
    <div class="ad-card">
      <div class="ad-card-title">Membres actifs (${members.length})</div>
      ${rows||'<div class="ps-note">Personne pour le moment.</div>'}
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Inviter un collaborateur</div>
      <div class="pf-lbl">Email</div>
      <input class="field" id="ad-inv-email" type="email" placeholder="collab@exemple.com">
      <div class="pf-lbl">Rôle</div>
      <select class="field" id="ad-inv-role">${rolesOpts.map(r=>`<option value="${r}">${r}</option>`).join("")}</select>
      <button class="sheet-add" id="ad-inv-send" style="margin-top:8px">Envoyer l'invitation</button>
      <div id="ad-inv-status" class="ps-note" style="margin-top:8px"></div>
    </div>
    ${invRows?`<div class="ad-card"><div class="ad-card-title">Invitations en attente (${invites.length})</div>${invRows}</div>`:""}`;
  $("#ad-inv-send").onclick=async()=>{
    const email=$("#ad-inv-email").value.trim(); const role=$("#ad-inv-role").value;
    const st=$("#ad-inv-status");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ st.textContent="Email invalide"; return; }
    st.textContent="Envoi…";
    try{
      const inv=await Cloud.inviteCollab(email, role);
      st.innerHTML="Invitation créée ✅<br>Code à transmettre : <code style='user-select:all'>"+escapeHtml(inv.token)+"</code>";
      setTimeout(()=>renderAdminEquipe(body), 800);
    }catch(e){ st.textContent="Échec : "+(e.message||"réessaie"); }
  };
}

function renderAdminDonnees(body){
  body.innerHTML=`
    <div class="ad-card">
      <div class="ad-card-title">Sauvegarde locale</div>
      <div class="ps-note">Exporte tous tes business dans un fichier JSON à garder sur ton téléphone/ordinateur.</div>
      <button class="plus-item" id="ad-export">📥 Télécharger la sauvegarde</button>
      <div class="ps-note" style="margin-top:12px">Restaure une sauvegarde précédente (remplace tout).</div>
      <input class="field" id="ad-import-file" type="file" accept="application/json,.json">
      <button class="plus-item" id="ad-import" style="margin-top:6px">📤 Restaurer</button>
      <div id="ad-imp-status" class="ps-note"></div>
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Synchronisation cloud</div>
      <div class="ad-row"><span>Statut</span><b>${escapeHtml(typeof Cloud!=="undefined"?Cloud.status():"off")}</b></div>
      <button class="plus-item" id="ad-sync-now">🔄 Synchroniser maintenant</button>
    </div>
    <div class="ad-card ad-danger">
      <div class="ad-card-title">⚠️ Zone dangereuse</div>
      <div class="ps-note">Ces actions sont définitives.</div>
      <button class="plus-item" id="ad-signout-all">Déconnexion cloud (sur cet appareil)</button>
      <button class="plus-item" id="ad-wipe" style="color:#f96">🗑️ Effacer TOUTES les données locales</button>
    </div>`;
  $("#ad-export").onclick=()=>{
    try{
      const blob=new Blob([BOSS.serializeBackup(state)],{type:"application/json"});
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      const d=new Date(); const pad=n=>String(n).padStart(2,"0");
      a.download="boss-sauvegarde-"+d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+".json";
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    }catch(e){ alert("Échec de l'export : "+e.message); }
  };
  $("#ad-import").onclick=()=>{
    const f=$("#ad-import-file").files?.[0];
    const st=$("#ad-imp-status");
    if(!f){ st.textContent="Choisis un fichier"; return; }
    if(!confirm("Restaurer cette sauvegarde va REMPLACER tous tes business actuels. Confirmer ?")) return;
    const reader=new FileReader();
    reader.onload=async()=>{
      try{
        const parsed=BOSS.parseBackup(reader.result);
        state=Object.assign(state, parsed);
        Object.values(state.profiles).forEach(p=>BOSS.ensureProfile(p));
        await persist();
        st.textContent="Restauration réussie ✅";
        setTimeout(()=>{ closeSheet(); refreshAll(); },800);
      }catch(e){ st.textContent="Fichier invalide : "+e.message; }
    };
    reader.readAsText(f);
  };
  $("#ad-sync-now").onclick=async()=>{
    if(typeof Cloud==="undefined"||!Cloud.available()){ alert("Cloud non configuré"); return; }
    if(!Cloud.session()){ alert("Connecte-toi d'abord"); return; }
    const ok=await Cloud.syncNow();
    alert(ok?"Synchronisé ✅":"Échec");
  };
  $("#ad-signout-all").onclick=async()=>{
    if(!confirm("Se déconnecter de l'espace en ligne sur cet appareil ?")) return;
    if(typeof Cloud!=="undefined") await Cloud.signOut();
    refreshCloudBadge&&refreshCloudBadge();
  };
  $("#ad-wipe").onclick=async()=>{
    if(!confirm("⚠️ Cette action efface TOUTES les données locales de tes business (sauf ce qui est dans le cloud). Continuer ?")) return;
    if(!confirm("Vraiment sûr ? Cette action est irréversible.")) return;
    state={profiles:{},currentId:null};
    await Store.set(KEY, JSON.stringify(state));
    location.reload();
  };
}

function renderAdminBusiness(body){
  const list=Object.values(state.profiles||{});
  body.innerHTML=`
    <div class="ad-card">
      <div class="ad-card-title">Business (${list.length})</div>
      ${list.map(p=>{
        const m=BOSS.METIERS[p.metier];
        const f=BOSS.computeFinancials(p);
        return `<div class="ad-biz-row">
          <div class="ad-biz-info">
            <b>${escapeHtml(p.name)}</b>
            <span class="muted2">${escapeHtml(m?m.name:"—")} · CA ~${BOSS.fmtF(f.ca)}/mois · net ${BOSS.fmtF(f.net)}</span>
          </div>
          <div>
            <button class="plus-item" data-open="${escapeAttr(p.id)}" style="width:auto">Ouvrir</button>
            ${list.length>1?`<button class="plus-item" data-del="${escapeAttr(p.id)}" style="width:auto;color:#f96">Supprimer</button>`:""}
          </div>
        </div>`;
      }).join("")}
    </div>
    <button class="sheet-add" id="ad-biz-add">+ Nouveau business</button>`;
  body.querySelectorAll("[data-open]").forEach(b=>b.onclick=async()=>{ state.currentId=b.dataset.open; await persist(); closeSheet(); refreshAll(); });
  body.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    const id=b.dataset.del;
    if(!confirm("Supprimer ce business et toutes ses données ?")) return;
    delete state.profiles[id];
    if(state.currentId===id) state.currentId=Object.keys(state.profiles)[0];
    await persist(); renderAdminBusiness(body); refreshAll();
  });
  $("#ad-biz-add").onclick=async()=>{
    const nom=prompt("Nom du nouveau business ?","Mon business");
    if(!nom) return;
    const p=BOSS.blankProfile(nom); state.profiles[p.id]=p; state.currentId=p.id;
    await persist(); renderAdminBusiness(body); refreshAll();
  };
}

function renderAdminLicence(body){
  const lic=state.license;
  let roleOpts=""; Object.entries(BOSS.ROLES).forEach(([k,v])=>{ roleOpts+=`<option value="${k}" ${state.admin.role===k?"selected":""}>${v.label}</option>`; });
  body.innerHTML=`
    <div class="ad-card">
      <div class="ad-card-title">Tarification</div>
      <div class="pf-row"><div><div class="pf-lbl">Essai (jours)</div><input class="field" id="ad-trial" type="number" value="${lic.trialDays}"></div><div><div class="pf-lbl">Abonnement de base /mois</div><input class="field" id="ad-base" type="number" value="${lic.basePrice}"></div></div>
      <div class="pf-lbl">Supplément par métier supplémentaire</div><input class="field" id="ad-extra" type="number" value="${lic.extraMetierPrice}">
      <div class="pf-row"><div><div class="pf-lbl">Par collaborateur /mois</div><input class="field" id="ad-collab" type="number" value="${lic.perCollaborateur!=null?lic.perCollaborateur:2000}"></div><div><div class="pf-lbl">Par caisse en + /mois</div><input class="field" id="ad-caisse" type="number" value="${lic.perCaisse!=null?lic.perCaisse:1000}"></div></div>
      <div class="ps-note">Compte : <b>${accountCounts().collaborateurs}</b> collaborateur(s), <b>${accountCounts().caisses}</b> caisse(s) · <b>Coût mensuel : ${BOSS.fmtF(currentDueTotal())}</b></div>
      <button class="plus-item gold" id="ad-savecfg">Enregistrer la tarification</button>
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Générer un code de déverrouillage</div>
      <div class="ps-note">Colle ta <b>clé privée</b> (jamais enregistrée dans l'app).</div>
      <input class="field" id="ad-priv" placeholder="Clé privée (JSON)">
      <input class="field" id="ad-dev" placeholder="Code appareil du client" value="${state.deviceId}">
      <div class="pf-row"><div><div class="pf-lbl">Durée (jours)</div><input class="field" id="ad-days" type="number" value="30"></div><div><div class="pf-lbl">&nbsp;</div><button class="plus-item" id="ad-gen" style="margin:0">Générer</button></div></div>
      <input class="field" id="ad-code" placeholder="Le code apparaîtra ici" readonly>
      <button class="plus-item" id="ad-copy">📋 Copier le code</button>
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Cet appareil</div>
      <label class="switch-row"><span>Verrouiller cet appareil</span><input type="checkbox" id="ad-lock" ${lic.lockedManually?"checked":""}></label>
      <div class="pf-lbl">Rôle</div>
      <select class="field" id="ad-role">${roleOpts}</select>
      <div class="perm-grid" id="ad-perms"></div>
    </div>`;
  $("#ad-savecfg").onclick=async()=>{ lic.trialDays=parseFloat($("#ad-trial").value)||0; lic.basePrice=parseFloat($("#ad-base").value)||0; lic.extraMetierPrice=parseFloat($("#ad-extra").value)||0; lic.perCollaborateur=parseFloat($("#ad-collab").value)||0; lic.perCaisse=parseFloat($("#ad-caisse").value)||0; await persist(); enforceLicense(); alert("Tarification enregistrée ✅"); };
  $("#ad-gen").onclick=async()=>{ try{ const priv=JSON.parse($("#ad-priv").value); const dev=$("#ad-dev").value.trim(); const days=parseFloat($("#ad-days").value)||30; const tok=await BOSS.signLicenseToken(priv,{d:dev,e:Date.now()+days*86400000,m:metiersCount()}); $("#ad-code").value=tok; }catch(e){ alert("Clé privée invalide."); } };
  $("#ad-copy").onclick=()=>{ const v=$("#ad-code").value; if(!v)return; try{ navigator.clipboard.writeText(v); alert("Code copié ✅"); }catch(e){ $("#ad-code").select&&$("#ad-code").select(); } };
  $("#ad-lock").onchange=async e=>{ lic.lockedManually=e.target.checked; await persist(); enforceLicense(); };
  const renderPerms=()=>{ const role=BOSS.ROLES[$("#ad-role").value]; const g=$("#ad-perms"); g.innerHTML=""; (role.perms||[]).forEach(pm=>{ const row=el("div","perm-row"); row.innerHTML=`<span>${pm==="all"?"Tous les droits":pm}</span><b>✓</b>`; g.appendChild(row); }); };
  $("#ad-role").onchange=async()=>{ state.admin.role=$("#ad-role").value; await persist(); renderPerms(); };
  renderPerms();
}

/* ---------- COACH IA (question libre, API si dispo sinon local) ---------- */
async function askCoach(q){
  const log=$("#ai-log");
  log.appendChild(el("div","ai-u",escapeHtml(q)));
  const wait=el("div","ai-b","…"); log.appendChild(wait); log.scrollTop=log.scrollHeight;
  const p=cur(); const f=BOSS.computeFinancials(p);
  const ctx=`Business: ${p.name} (${BOSS.METIERS[p.metier].name}). CA ${Math.round(f.ca)} F, coûts directs ${Math.round(f.coutsDirects)} F, charges fixes ${Math.round(f.cf)} F, bénéfice net ${Math.round(f.net)} F, seuil ${Math.round(f.seuilCA)} F. Produits: ${p.revenus.map(r=>r.nom+" prix "+r.prix+" coût "+r.cout+" vol "+r.qte).join("; ")}.`;
  let answer=await aiComplete([{role:"user",content:`Tu es le Coach BOSS, conseiller business pour un petit entrepreneur d'Afrique de l'Ouest. Parle simplement, en français (un peu de nouchi ivoirien bienvenu), court et concret, en FCFA. Voici ses chiffres: ${ctx}\n\nSa question: ${q}`}],null,400);
  if(!answer){
    // repli local: on réutilise les insights + une réponse simple
    const tips=BOSS.coachInsights(p).items.map(i=>i.txt);
    answer="Voici ce que je vois sur tes chiffres :\n• "+tips.slice(0,3).join("\n• ");
    if(f.net<0) answer+="\nPriorité : revenir à l'équilibre en atteignant "+BOSS.fmtF(f.seuilCA)+" de ventes.";
  }
  wait.textContent=answer;
  log.scrollTop=log.scrollHeight;
}

/* ---------- utils ---------- */
function escapeHtml(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function escapeAttr(s){return escapeHtml(s).replace(/"/g,"&quot;");}
function fmtDate(ts){
  try{
    const d=new Date(ts), now=new Date();
    const sameDay=d.toDateString()===now.toDateString();
    const y=new Date(now); y.setDate(now.getDate()-1);
    const yest=d.toDateString()===y.toDateString();
    const hm=d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});
    if(sameDay) return "Aujourd'hui "+hm;
    if(yest) return "Hier "+hm;
    return d.toLocaleDateString("fr-FR",{day:"2-digit",month:"short"})+" "+hm;
  }catch(e){ return ""; }
}

/* ---------- refresh global ---------- */
function refreshAll(){ renderTopbar(); renderVitrine(); renderCaisse(); renderPOS(); renderCarnet(); renderStock(); renderClients(); renderCommandes(); renderPieces(); renderTreso(); renderHistorique(); renderConfig(); renderDash(); }

/* ---------- wiring ---------- */
function wire(){
  $$(".tab[data-v],.navlink[data-v]").forEach(t=>t.onclick=()=>showView(t.dataset.v));
  const tp=$("#tab-plus"); if(tp) tp.onclick=openPlus;
  const sp=$("#side-plus"); if(sp) sp.onclick=openPlus;
  $("#profbtn").onclick=openProfiles;
  $("#overlay").onclick=closeSheet;
  $("#chat-send").onclick=()=>{const v=$("#chat-input").value;$("#chat-input").value="";handleUser(v);};
  $("#chat-input").addEventListener("keydown",e=>{ if(e.key==="Enter"){e.preventDefault();$("#chat-send").click();} });
  $("#chat-restart").onclick=()=>{ if(confirm("Recommencer la configuration de ce business ?")){ const p=cur(); p.revenus=[];p.charges=[]; persist(); startOnboard(); } };
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(SR){ const mic=$("#chat-mic"); mic.style.display="flex";
    mic.onclick=()=>{ try{const rec=new SR(); rec.lang="fr-FR"; rec.onresult=ev=>{$("#chat-input").value=ev.results[0][0].transcript;}; rec.start();}catch(e){} };
  }
  $("#cfg-name").oninput=async e=>{ cur().name=e.target.value||"Mon business"; await persist(); renderTopbar(); };
  $("#cfg-addrev").onclick=addRev;
  $("#cfg-addcharge").onclick=addCharge;
  $("#cfg-target").oninput=async e=>{ cur().target=+e.target.value; $("#cfg-targetval").textContent=e.target.value+" %"; await persist(); };
  const te=$("#cfg-tva-enabled"); if(te) te.onchange=async e=>{ const p=cur(); if(!p.tva)p.tva={}; p.tva.enabled=e.target.checked; await persist(); renderDash(); };
  const tr=$("#cfg-tva-rate"); if(tr) tr.oninput=async e=>{ const p=cur(); if(!p.tva)p.tva={}; p.tva.rate=parseFloat(e.target.value)||0; await persist(); renderDash(); };
  const tt=$("#cfg-tva-ttc"); if(tt) tt.onchange=async e=>{ const p=cur(); if(!p.tva)p.tva={}; p.tva.pricesIncludeTax=e.target.checked; await persist(); renderDash(); };
  $("#ai-send").onclick=()=>{const v=$("#ai-input").value.trim();if(!v)return;$("#ai-input").value="";askCoach(v);};
  $("#ai-input").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("#ai-send").click();}});
  $$(".ai-quick").forEach(b=>b.onclick=()=>askCoach(b.textContent));
  $("#v-add").onclick=()=>openProduct(null);
  const vpdf=$("#v-pdf"); if(vpdf) vpdf.onclick=openCatalogues;
  $("#v-share").onclick=shareCatalogue;
  $("#c-add-vente").onclick=()=>openCaisseEntry("vente");
  $("#c-add-depense").onclick=()=>openCaisseEntry("depense");
  $("#k-add").onclick=openDebtEntry;
  const cla=$("#cl-add"); if(cla) cla.onclick=openClientEntry;
  const cmda=$("#cmd-add"); if(cmda) cmda.onclick=()=>openOrderEntry(null);
  const pca=$("#pc-add"); if(pca) pca.onclick=()=>openPieceEntry(null);
  const pch=$("#pc-help"); if(pch) pch.onclick=openHelp;
  const tro=$("#tr-opening"); if(tro) tro.onclick=openOpeningBalances;
  const cpos=$("#c-open-pos"); if(cpos) cpos.onclick=()=>showView("pos");
  const psearch=$("#pos-search"); if(psearch) psearch.oninput=renderPOS;
  const precu=$("#pos-recu"); if(precu) precu.oninput=posMonnaie;
  const pval=$("#pos-valider"); if(pval) pval.onclick=()=>posValider(false);
  const prec=$("#pos-receipt"); if(prec) prec.onclick=()=>posValider(true);
  const pcanal=$("#pos-canal"); if(pcanal) pcanal.querySelectorAll(".mode-b").forEach(b=>b.onclick=()=>{ posCanal=b.dataset.c; pcanal.querySelectorAll(".mode-b").forEach(x=>x.classList.toggle("on",x===b)); });
  const trs=$("#tr-stmt"); if(trs) trs.onchange=async()=>{ const p=cur(); if(!p.tresorerie.rappro)p.tresorerie.rappro={statement:0,pointed:[]}; p.tresorerie.rappro.statement=parseFloat(trs.value)||0; await persist(); renderTreso(); };
  const ih=$("#install-hint"); if(ih){
    ih.onclick=(e)=>{ if(e.target.closest(".install-x")) return; doInstall(); };
    const dx=$("#install-hint-dismiss"); if(dx) dx.onclick=(e)=>{ e.stopPropagation(); markInstallDismissed(); updateInstallHint(); };
    // Texte adapté iOS
    const txt=$("#install-hint-text");
    if(txt){
      if(isSafariiOS()) txt.textContent="Installer BOSS sur ton iPhone (Safari)";
      else txt.textContent="Installer BOSS sur ton téléphone";
    }
  }
  const tgl=$("#theme-toggle"); if(tgl) tgl.onclick=toggleMode;
  const lu=$("#lock-unlock"); if(lu) lu.onclick=async()=>{ const okc=await applyUnlock($("#lock-code").value,$("#lock-err")); if(okc){ $("#lock-screen").style.display="none"; refreshAll(); enforceLicense(); } };
  const la=$("#lock-admin"); if(la) la.onclick=openAdmin;
  const cb=$("#cloud-badge"); if(cb) cb.onclick=openCloudSheet;
}

/* ---------- boot ---------- */
window.addEventListener("DOMContentLoaded",async()=>{
  wire();
  await Store.init();
  await restore();
  applyTheme(state.theme);
  renderIcons();
  renderTopbar();
  enforceLicense();
  const p=cur();
  if(!p.revenus.length && !p.charges.length && !(p.caisse||[]).length){ startOnboard(); showView("onboard"); }
  else { refreshAll(); showView("dash"); }
  const sn=$("#storage-note"); if(sn) sn.textContent=Store.label();
  // installation PWA
  window.addEventListener("beforeinstallprompt",ev=>{ ev.preventDefault(); deferredInstall=ev; updateInstallHint(); });
  window.addEventListener("appinstalled",()=>{ deferredInstall=null; updateInstallHint(); });
  updateInstallHint();
  // service worker (uniquement si servi en http/https)
  if("serviceWorker" in navigator && location.protocol.indexOf("http")===0){
    try{
      navigator.serviceWorker.register("sw.js").then(reg=>{
        try{ reg.update(); }catch(e){}
        reg.addEventListener("updatefound",()=>{
          const nw=reg.installing;
          if(nw) nw.addEventListener("statechange",()=>{
            if(nw.state==="installed" && navigator.serviceWorker.controller){ try{ nw.postMessage("skipWaiting"); }catch(e){} }
          });
        });
      });
      let _reloaded=false;
      navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(_reloaded)return; _reloaded=true; location.reload(); });
    }catch(e){}
  }
  // synchronisation au démarrage
  if(state.sync && state.sync.url && state.sync.auto){
    pullSync().then(changed=>{ if(changed) refreshAll(); });
  }
  // Espace en ligne (Supabase) — s'initialise si configuré
  try {
    if(typeof Cloud !== "undefined" && Cloud.available()){
      refreshCloudBadge();
      Cloud.init().then(()=>{ refreshAll(); refreshCloudBadge(); });
      Cloud.onChange(refreshCloudBadge);
    } else {
      refreshCloudBadge();
    }
  } catch(_){}
});

})();
