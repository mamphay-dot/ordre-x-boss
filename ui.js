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

/* ---------- Chiffrement AES-GCM des données à disque ----------
   Clé aléatoire 256 bits, stockée uniquement dans IndexedDB (jamais
   dans localStorage). Encapsule state complet + queue. Défense contre
   fuite localStorage / backup non-chiffré du navigateur. */
const BossCrypto=(function(){
  const KEY_NAME="boss:crypto:key:v1";
  const VER_PREFIX="v1:";
  let CachedKey=null;
  function subtle(){
    if(typeof crypto!=="undefined" && crypto.subtle) return crypto.subtle;
    return null;
  }
  async function getOrCreateKey(){
    if(CachedKey) return CachedKey;
    const s = subtle(); if(!s) return null;
    try{
      let stored = null;
      try{ stored = await IDB.get(KEY_NAME); }catch(_){}
      if(stored){
        CachedKey = await s.importKey("jwk", stored, {name:"AES-GCM"}, false, ["encrypt","decrypt"]);
        return CachedKey;
      }
      const k = await s.generateKey({name:"AES-GCM",length:256}, true, ["encrypt","decrypt"]);
      const jwk = await s.exportKey("jwk", k);
      await IDB.set(KEY_NAME, jwk);
      CachedKey = k;
      return k;
    }catch(_){ return null; }
  }
  function b64(u8){ let s=""; for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(str){ const bin=atob(str); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
  async function encrypt(plain){
    const s = subtle(); const k = await getOrCreateKey(); if(!s||!k) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await s.encrypt({name:"AES-GCM", iv}, k, new TextEncoder().encode(plain));
    return VER_PREFIX + b64(iv) + "." + b64(new Uint8Array(buf));
  }
  async function decrypt(cipher){
    const s = subtle(); const k = await getOrCreateKey(); if(!s||!k) return null;
    if(!cipher || cipher.indexOf(VER_PREFIX)!==0) return null;
    const rest = cipher.slice(VER_PREFIX.length);
    const idx = rest.indexOf("."); if(idx<0) return null;
    const iv = unb64(rest.slice(0, idx));
    const data = unb64(rest.slice(idx+1));
    const buf = await s.decrypt({name:"AES-GCM", iv}, k, data);
    return new TextDecoder().decode(buf);
  }
  function looksEncrypted(v){ return typeof v==="string" && v.indexOf(VER_PREFIX)===0; }
  async function wipeKey(){ try{ await IDB.set(KEY_NAME, null); CachedKey=null; }catch(_){} }
  return { encrypt, decrypt, looksEncrypted, wipeKey, available: () => !!subtle() };
})();

/* Clés sensibles chiffrées à disque (business, sessions, files d'attente). */
const ENCRYPTED_KEYS = new Set(["boss:state:v1","boss.session.v1","boss.queue.v1"]);

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
  async _rawGet(k){
    try{
      if(this.mode==="artifact"){ const r=await window.storage.get(k); return r?r.value:null; }
      if(this.mode==="idb"){ return await IDB.get(k); }
      if(this.mode==="local"){ const v=localStorage.getItem(k); return v==null?null:v; }
    }catch(e){}
    return this.mem[k]!=null?this.mem[k]:null;
  },
  async _rawSet(k,v){
    this.mem[k]=v;
    try{
      if(this.mode==="artifact"){ await window.storage.set(k,v,false); return true; }
      if(this.mode==="idb"){ await IDB.set(k,v); return true; }
      if(this.mode==="local"){ localStorage.setItem(k,v); return true; }
    }catch(e){ return false; }
    return true;
  },
  async get(k){
    const raw = await this._rawGet(k);
    if(raw==null) return null;
    if(!ENCRYPTED_KEYS.has(k)) return raw;
    if(!BossCrypto.available()) return raw;
    // Legacy plaintext (compatibilité v1) : renvoyé tel quel, re-chiffré au prochain set()
    if(!BossCrypto.looksEncrypted(raw)) return raw;
    try { const dec = await BossCrypto.decrypt(raw); return dec!=null?dec:raw; }
    catch(_){ return raw; }
  },
  async set(k,v){
    if(ENCRYPTED_KEYS.has(k) && BossCrypto.available() && typeof v==="string" && v){
      try { const enc = await BossCrypto.encrypt(v); if(enc) return this._rawSet(k, enc); }
      catch(_){ /* repli en clair */ }
    }
    return this._rawSet(k, v);
  },
  label(){ return {artifact:"Sauvegarde Claude",idb:"Sauvegarde sur l'appareil",local:"Sauvegarde locale",memory:"Session uniquement"}[this.mode]; }
};
const KEY="boss:state:v1";
let state={profiles:{},currentId:null};
async function persist(){
  state.updatedAt=Date.now();
  const c=cur();
  if(c){ c.updatedAt=state.updatedAt; if(typeof sanitizeProfile==="function") sanitizeProfile(c); }
  const okSave=await Store.set(KEY, JSON.stringify(state));
  if(okSave===false){ flashSaveWarning(); }
  scheduleSync(); scheduleCloudPush();
}
/* Nettoyage anti-DoS et anti-injection appliqué à chaque sauvegarde.
   Bornes strictes sur longueurs de texte et amplitude des montants. */
function sanitizeProfile(p){
  if(!p) return;
  const MAX_NAME=60, MAX_ADDR=200, MAX_TXT=500, MAX_AMT=1e10;
  const clean = (v, max) => typeof sanitizeStr==="function" ? sanitizeStr(v, max) : (v==null?"":String(v).slice(0, max));
  const num = (v, lim) => { const n = parseFloat(v); if(!isFinite(n) || isNaN(n)) return 0; return Math.max(-lim, Math.min(lim, n)); };
  if(p.name) p.name = clean(p.name, MAX_NAME);
  if(p.unite) p.unite = clean(p.unite, 30);
  if(p.identite){
    p.identite.rccm = clean(p.identite.rccm, 30);
    p.identite.ncc = clean(p.identite.ncc, 30);
    p.identite.adresse = clean(p.identite.adresse, MAX_ADDR);
    p.identite.tel = clean(p.identite.tel, 40);
    p.identite.email = clean(p.identite.email, 120);
    p.identite.slogan = clean(p.identite.slogan, 120);
    p.identite.mentions = clean(p.identite.mentions, MAX_TXT);
  }
  (p.revenus||[]).forEach(r=>{
    if(!r) return;
    r.nom = clean(r.nom, MAX_NAME);
    r.desc = clean(r.desc||"", MAX_TXT);
    r.prix = num(r.prix, MAX_AMT);
    r.cout = num(r.cout, MAX_AMT);
    r.qte = num(r.qte, MAX_AMT);
    if(typeof r.stock==="number") r.stock = num(r.stock, MAX_AMT);
    if(r.photo && typeof safeImgUrl==="function" && !safeImgUrl(r.photo)) r.photo = null;
  });
  (p.charges||[]).forEach(c=>{ if(!c) return; c.nom = clean(c.nom, MAX_NAME); c.montant = num(c.montant, MAX_AMT); });
  (p.carnet||[]).forEach(c=>{ if(!c) return; c.client = clean(c.client, MAX_NAME); c.motif = clean(c.motif||"", MAX_NAME); c.montant = num(c.montant, MAX_AMT); });
  (p.clients||[]).forEach(c=>{ if(!c) return; c.nom = clean(c.nom, MAX_NAME); c.phone = clean(c.phone||"", 40); c.adresse = clean(c.adresse||"", MAX_ADDR); c.note = clean(c.note||"", MAX_TXT); });
  (p.commandes||[]).forEach(o=>{
    if(!o) return;
    o.clientNom = clean(o.clientNom, MAX_NAME);
    o.clientPhone = clean(o.clientPhone||"", 40);
    o.adresse = clean(o.adresse||"", MAX_ADDR);
    o.note = clean(o.note||"", MAX_TXT);
    o.total = num(o.total, MAX_AMT);
    (o.items||[]).forEach(it=>{ if(!it) return; it.nom = clean(it.nom, MAX_NAME); it.prix = num(it.prix, MAX_AMT); it.qty = num(it.qty, MAX_AMT); });
  });
  (p.pieces||[]).forEach(pc=>{ if(!pc) return; pc.tiers = clean(pc.tiers||"", MAX_NAME); pc.note = clean(pc.note||"", MAX_TXT); pc.montant = num(pc.montant, MAX_AMT); if(pc.photo && typeof safeImgUrl==="function" && !safeImgUrl(pc.photo)) pc.photo = null; });
  (p.collaborateurs||[]).forEach(co=>{ if(!co) return; co.nom = clean(co.nom||"", MAX_NAME); });
  (p.caisses||[]).forEach(k=>{ if(!k) return; k.nom = clean(k.nom||"", MAX_NAME); });
  (p.caisse||[]).forEach(e=>{ if(!e) return; e.montant = num(e.montant, MAX_AMT); if(e.motif) e.motif = clean(e.motif, MAX_TXT); });
  if(p.tresorerie && p.tresorerie.soldes){
    ["especes","banque","mobile"].forEach(k=>{ p.tresorerie.soldes[k] = num(p.tresorerie.soldes[k], MAX_AMT); });
  }
  if(typeof p.target === "number") p.target = Math.max(0, Math.min(90, p.target));
}
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
  Object.values(state.profiles).forEach(ensureProfileUI);
  let created=false;
  if(!state.theme){ state.theme={mode:"dark",accent:"#C8A23A"}; created=true; }
  if(!state.deviceId){ state.deviceId=genDeviceId(); created=true; }
  if(!state.license){ state.license=BOSS.defaultLicense(); created=true; }
  if(!state.admin){ state.admin={role:"proprietaire"}; created=true; }
  if(!state.ai){ state.ai={url:"",key:"",model:"openai",enabled:true,provider:"pollinations"}; created=true; }
  if(typeof state.easyMode !== "boolean"){ state.easyMode=false; created=true; }
  if(!state.easyVoice){ state.easyVoice={enabled:true, lang:"fr-FR"}; created=true; }
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
    row.querySelector(".pr-info").onclick=async()=>{state.currentId=p.id;await persist();closeSheet();applyMenuCustomization();refreshAll();showView((cur().ui&&cur().ui.home)||"dash");};
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
  return "Tu es l'assistant de gestion de BOSS, une app pour micro-entrepreneurs d'Afrique de l'Ouest francophone. Tu t'adresses toujours à l'utilisateur en l'appelant « BOSS » (jamais « patron », jamais son prénom). Pose UNE question simple à la fois, en français clair et chaleureux (nouchi ivoirien bienvenu), en FCFA, pour comprendre le business et le configurer.\n"
   +"Découvre : le type d'activité, le nom du business, les principaux produits/services avec leur PRIX de vente (et si possible le coût et le stock), et les grosses charges fixes (loyer, etc.).\n"
   +"À CHAQUE réponse de l'utilisateur, réponds UNIQUEMENT par un objet JSON valide, sans aucun texte autour, de la forme :\n"
   +'{"reply":"ta prochaine question ou confirmation, courte","patch":{"name":"...","metier":"un parmi: '+metiers+'","unite":"...","addProducts":[{"nom":"...","prix":0,"cout":0,"stock":0}],"addCharges":[{"nom":"...","montant":0}],"target":30},"done":false}\n'
   +'Ne mets dans "patch" que ce que tu viens d\'apprendre. Choisis "metier" dans la liste, le plus proche, sinon "vendeur". Quand tu as au moins le nom, le métier et 1-2 produits avec prix, passe "done":true avec un "reply" de clôture encourageant. Ne répète pas une info déjà connue. Reste bref.';
}
function onboardDone(p){
  const f=BOSS.computeFinancials(p);
  const msg=f.seuilCA>0
    ? `C'est bon BOSS, ton business est prêt ✅ Tu dois faire environ ${BOSS.fmtF(f.seuilCA)} de ventes par mois pour ne rien perdre. Regarde ton tableau de bord 👇`
    : `C'est bon BOSS, ton business est prêt ✅ Ajuste tes chiffres dans Réglages quand tu veux. Regarde ton tableau de bord 👇`;
  setTimeout(()=>{ botSay(msg); const go=el("button","chat-cta","Voir mon tableau de bord"); go.onclick=()=>showView("dash"); setTimeout(()=>{$("#chat").appendChild(go);$("#chat").scrollTop=$("#chat").scrollHeight;},700); },600);
  refreshAll(); renderTopbar();
}
function startOnboard(){
  conv=BOSS.startConversation();
  aiTurns=[]; aiDisabledForSession=false;
  $("#chat").innerHTML="";
  botSay("Bonjour BOSS 👋 Je suis ton assistant de gestion. Dis-moi, tu fais quoi comme business ?");
  $("#chat-input").value="";
  $("#chat-input").focus&&$("#chat-input").focus();
}
function bubble(cls,html){ const b=el("div","bub "+cls,html); $("#chat").appendChild(b); $("#chat").scrollTop=$("#chat").scrollHeight; return b; }
function botSay(text){
  const typing=bubble("b typing","<span class='dots'><i></i><i></i><i></i></span>");
  setTimeout(()=>{ typing.classList.remove("typing"); typing.innerHTML=`<div class="who">ASSISTANT</div>${escapeHtml(text)}`; $("#chat").scrollTop=$("#chat").scrollHeight; },450);
}
function userSay(text){ bubble("u",`<div class="who">BOSS</div>${escapeHtml(text)}`); }
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
    const safePhoto = safeImgUrl(r.photo);
    const img = safePhoto
      ? `<div class="vc-img" style="background-image:url('${safePhoto}')"></div>`
      : `<div class="vc-img noimg">${escapeHtml((r.nom||"?").slice(0,1).toUpperCase())}</div>`;
    card.innerHTML=`${img}
      <div class="vc-body">
        <div class="vc-top"><div class="vc-name">${escapeHtml(r.nom)}</div><div class="vc-price">${BOSS.fmtF(r.prix)}</div></div>
        <div class="vc-desc">${escapeHtml(r.desc||"")}</div>
        ${typeof r.stock==="number"?`<div class="vc-stock ${r.stock<=5?"low":""}">📦 ${r.stock} en stock</div>`:""}
        <div class="vc-actions">
          <button class="vc-btn pay" data-i="${i}">${ic("pay")} Encaisser</button>
          <button class="vc-btn share" data-i="${i}">${ic("share")} Partager</button>
          <button class="vc-btn affiche" data-i="${i}" aria-label="Créer une affiche">${ic("image")}</button>
          <button class="vc-btn edit" data-i="${i}" aria-label="Modifier">${ic("edit")}</button>
          <button class="vc-btn del" data-i="${i}" aria-label="Supprimer">${ic("del")}</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });
  grid.querySelectorAll(".pay").forEach(b=>b.onclick=()=>openPay(+b.dataset.i));
  grid.querySelectorAll(".share").forEach(b=>b.onclick=()=>shareProduct(+b.dataset.i));
  grid.querySelectorAll(".affiche").forEach(b=>b.onclick=()=>{ const idx=+b.dataset.i; const r=(cur().revenus||[])[idx]; openAffiches(r?.id); });
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
    <button class="plus-item gold" id="pl-easy" style="background:${state.easyMode?"var(--char2)":"linear-gradient(135deg,#241f10 0%,#1a1608 100%)"};border:2px solid var(--gold);color:var(--gold);font-size:15px">🔊 ${state.easyMode?"Revenir au mode complet 📊":"Passer en mode Facile (gros boutons + voix)"}</button>
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
    <button class="plus-item" id="pl-affiche">${ic("image")} Créer une affiche</button>
    <button class="plus-item" id="pl-perso">${ic("config")} Personnaliser mon menu</button>
    <button class="plus-item" id="pl-templates">${ic("boutique")} Templates métier prêts</button>
    <button class="plus-item" id="pl-qr">${ic("share")} QR code de ma boutique</button>
    <button class="plus-item" id="pl-cat-send">${ic("share")} Envoyer mon catalogue à un autre BOSS</button>
    <button class="plus-item" id="pl-cat-open">${ic("import")} Ouvrir un catalogue reçu</button>
    <button class="plus-item" id="pl-thermal">${ic("pos")} Imprimer un ticket (Bluetooth)</button>
    <button class="plus-item" id="pl-stats">${ic("dash")} Statistiques & prévision</button>
    <button class="plus-item" id="pl-alertes">${ic("warn")} Alertes intelligentes</button>
    <button class="plus-item" id="pl-fiscal">${ic("doc")} Rapports fiscaux (CGA/CEA)</button>
    <button class="plus-item" id="pl-lock">${ic("lock")} Verrouiller BOSS maintenant</button>
    <button class="plus-item" id="pl-bio">${ic("check")} Déverrouillage biométrique (Face ID / empreinte)</button>
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
  const ple=$("#pl-easy"); if(ple) ple.onclick=()=>{ closeSheet(); setEasyMode(!state.easyMode); };
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
  const pla=$("#pl-affiche"); if(pla) pla.onclick=()=>{ closeSheet(); openAffiches(); };
  const plp=$("#pl-perso"); if(plp) plp.onclick=()=>{ closeSheet(); openPersonnalisation(); };
  const pltp=$("#pl-templates"); if(pltp) pltp.onclick=()=>{ closeSheet(); openTemplates(); };
  const plqr=$("#pl-qr"); if(plqr) plqr.onclick=()=>{ closeSheet(); openQRShop(); };
  const plcs=$("#pl-cat-send"); if(plcs) plcs.onclick=()=>{ closeSheet(); openCatalogExport(); };
  const plco=$("#pl-cat-open"); if(plco) plco.onclick=()=>{ closeSheet(); openCatalogImport(); };
  const plth=$("#pl-thermal"); if(plth) plth.onclick=()=>{ closeSheet(); openThermalPrint(); };
  const plst=$("#pl-stats"); if(plst) plst.onclick=()=>{ closeSheet(); openStats(); };
  const plal=$("#pl-alertes"); if(plal) plal.onclick=()=>{ closeSheet(); openAlertes(); };
  const plfs=$("#pl-fiscal"); if(plfs) plfs.onclick=()=>{ closeSheet(); openFiscal(); };
  const pll=$("#pl-lock"); if(pll) pll.onclick=()=>{ closeSheet(); IdleLock.forceLockNow(); };
  const plb=$("#pl-bio"); if(plb) plb.onclick=()=>{ closeSheet(); openBioSetup(); };
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
/* ============ VERROU DE SESSION (inactivité) ============
   Après N minutes sans interaction, l'app se verrouille. Il faut
   saisir un code (PIN admin OU mot de passe cloud) pour rouvrir.
   Empêche l'accès physique opportuniste à un téléphone déverrouillé.
*/
/* ============================================================
   CATALOGUE PARTAGÉ ENTRE UTILISATEURS BOSS
   Format d'échange .boss-catalog.json : le patron exporte,
   le destinataire ouvre dans BOSS pour parcourir/importer.
   ============================================================ */

const CATALOG_MIME = "application/json";
const CATALOG_TYPE = "boss-catalog";
const CATALOG_VERSION = 1;

function buildCatalogPayload(p, opts){
  opts = opts||{};
  const products = (p.revenus||[]).filter(r=>r.nom).map(r=>({
    nom: r.nom, prix: r.prix||0, cout: r.cout||0,
    qte: r.qte||0, stock: (typeof r.stock==="number"?r.stock:null),
    desc: r.desc||"", vitrine: !!r.vitrine, unite: r.unite||null,
    photo: opts.includePhotos ? (r.photo||null) : null
  }));
  return {
    type: CATALOG_TYPE,
    version: CATALOG_VERSION,
    exported_at: new Date().toISOString(),
    sender: {
      business_name: p.name || "—",
      metier: p.metier || null,
      unite: p.unite || null,
      tel: p.identite?.tel || "",
      email: p.identite?.email || "",
      adresse: p.identite?.adresse || "",
      slogan: p.identite?.slogan || "",
      logo: opts.includePhotos ? (p.identite?.logo || null) : null
    },
    products
  };
}

function openCatalogExport(){
  const p = cur();
  const nbProds = (p.revenus||[]).filter(r=>r.nom).length;
  const nbPhotos = (p.revenus||[]).filter(r=>r.photo).length;
  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Envoyer mon catalogue</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Génère un fichier <b>.boss-catalog.json</b> avec tes ${nbProds} produits + tes coordonnées. Le destinataire l'ouvre dans BOSS pour parcourir, contacter ou importer.</div>
    <div class="ad-card">
      <div class="ad-row"><span>Produits</span><b>${nbProds}</b></div>
      <div class="ad-row"><span>Photos disponibles</span><b>${nbPhotos}</b></div>
      <div class="ad-row"><span>Business</span><b>${escapeHtml(p.name||"—")}</b></div>
      <div class="ad-row"><span>Téléphone joint</span><b>${escapeHtml(p.identite?.tel||"—")}</b></div>
    </div>
    <label class="switch-row" style="margin-top:12px"><span>Inclure les photos <span class="muted2">(fichier plus lourd)</span></span><input type="checkbox" id="cat-photos" ${nbPhotos>0?"checked":""}></label>
    <div class="aff-actions">
      <button class="sheet-add" id="cat-share">📱 Partager (WhatsApp / email)</button>
      <button class="plus-item" id="cat-download">📥 Télécharger le fichier</button>
      <button class="plus-item" id="cat-qr">📤 Générer un QR pour l'envoi</button>
    </div>
    <div id="cat-status" class="ps-note"></div>`;
  $("#sheet-close").onclick = closeSheet;

  function makeBlob(){
    const withPhotos = $("#cat-photos").checked;
    const payload = buildCatalogPayload(p, {includePhotos: withPhotos});
    return new Blob([JSON.stringify(payload, null, 2)], {type: CATALOG_MIME});
  }
  function fileName(){
    const safe = (p.name||"boss").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40);
    return `catalogue-${safe}.boss-catalog.json`;
  }
  $("#cat-download").onclick = ()=>{
    const b = makeBlob();
    const url = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = url; a.download = fileName(); a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    $("#cat-status").textContent = "✅ Fichier téléchargé.";
  };
  $("#cat-share").onclick = async ()=>{
    const b = makeBlob();
    const file = new File([b], fileName(), {type: CATALOG_MIME});
    const shareData = {
      files:[file],
      title:"Catalogue BOSS — "+(p.name||""),
      text:`Voici mon catalogue BOSS. Ouvre le fichier dans l'app BOSS (boss.ordre-x.com) pour le parcourir.\n\n${p.name||""}${p.identite?.tel?"\n📞 "+p.identite.tel:""}`
    };
    if(navigator.canShare && navigator.canShare(shareData) && navigator.share){
      try { await navigator.share(shareData); $("#cat-status").textContent = "✅ Partagé."; }
      catch(e){ if(e.name!=="AbortError") $("#cat-status").textContent = "Échec : "+(e.message||""); }
    } else {
      // Repli : téléchargement + ouverture WhatsApp Web avec texte
      $("#cat-download").click();
      const wa = "https://wa.me/?text="+encodeURIComponent(shareData.text+"\n\nJoins le fichier téléchargé.");
      window.open(wa, "_blank");
    }
  };
  $("#cat-qr").onclick = ()=>{
    // QR : URL directe pour ouvrir catalogue via URL query (nécessite hébergement)
    // Alternative simple : QR contenant les infos contact + lien BOSS pour importer
    const target = "https://boss.ordre-x.com/?catalog="+encodeURIComponent(p.name||"");
    let matrix; try { matrix = QRCode.encode(target); } catch(e){ alert("Génération QR impossible"); return; }
    const svg = QRCode.toSVG(matrix, 480, "#0E0E0F", "#ffffff");
    sheet.innerHTML = `
      <div class="sheet-head"><h3>QR pour partager en boutique</h3><button class="x" id="sheet-close">×</button></div>
      <div class="ps-note">Imprime ce QR à l'entrée. Un scan renvoie vers ton catalogue BOSS.</div>
      <div class="qr-preview">${svg}</div>
      <button class="sheet-add" id="cat-qr-back">← Retour</button>`;
    $("#sheet-close").onclick = closeSheet;
    $("#cat-qr-back").onclick = openCatalogExport;
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function openCatalogImport(preloadedFile){
  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Ouvrir un catalogue reçu</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Choisis le fichier <b>.boss-catalog.json</b> reçu (WhatsApp, email, téléchargements…). Tu pourras parcourir puis ajouter les produits qui t'intéressent.</div>
    <input class="field" id="cat-imp-file" type="file" accept="application/json,.json">
    <div id="cat-preview"></div>`;
  $("#sheet-close").onclick = closeSheet;
  const readFile = f => new Promise((res,rej)=>{ const rd=new FileReader(); rd.onload=()=>res(rd.result); rd.onerror=()=>rej(new Error("Lecture du fichier impossible")); rd.readAsText(f); });
  const handleFile = async f => {
    try {
      const txt = await readFile(f);
      const payload = JSON.parse(txt);
      if(payload.type !== CATALOG_TYPE){ throw new Error("Ce fichier n'est pas un catalogue BOSS"); }
      renderCatalogPreview(payload);
    } catch(e){
      $("#cat-preview").innerHTML = `<div class="ps-note" style="color:#f96">Fichier invalide : ${escapeHtml(e.message||"")}</div>`;
    }
  };
  $("#cat-imp-file").onchange = e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); };
  if(preloadedFile) handleFile(preloadedFile);
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function renderCatalogPreview(payload){
  const box = $("#cat-preview");
  const s = payload.sender || {};
  const products = payload.products || [];
  const gridItems = products.map((r,i)=>`
    <div class="cat-p-card">
      ${r.photo?`<div class="cat-p-img" style="background-image:url('${safeImgUrl(r.photo)}')"></div>`
        :`<div class="cat-p-img cat-p-noimg">${escapeHtml((r.nom||"?").slice(0,1).toUpperCase())}</div>`}
      <div class="cat-p-body">
        <div class="cat-p-name">${escapeHtml(r.nom||"—")}</div>
        <div class="cat-p-price">${BOSS.fmtF(r.prix||0)}</div>
        ${r.desc?`<div class="cat-p-desc">${escapeHtml(r.desc)}</div>`:""}
      </div>
      <label class="cat-p-check"><input type="checkbox" data-i="${i}" checked><span>Ajouter</span></label>
    </div>`).join("");
  const waLink = s.tel ? "https://wa.me/"+String(s.tel).replace(/\D/g,"") : null;
  box.innerHTML = `
    <div class="ad-card">
      <div class="ad-card-title">De la part de</div>
      <div class="ad-row"><span>Business</span><b>${escapeHtml(s.business_name||"—")}</b></div>
      ${s.metier?`<div class="ad-row"><span>Métier</span><b>${escapeHtml(s.metier)}</b></div>`:""}
      ${s.tel?`<div class="ad-row"><span>Téléphone</span><b>${escapeHtml(s.tel)}</b></div>`:""}
      ${s.email?`<div class="ad-row"><span>Email</span><b>${escapeHtml(s.email)}</b></div>`:""}
      ${s.adresse?`<div class="ad-row"><span>Adresse</span><b>${escapeHtml(s.adresse)}</b></div>`:""}
      <div class="ad-row"><span>Exporté le</span><b>${fmtDate(payload.exported_at)}</b></div>
    </div>
    ${waLink?`<a class="plus-item" href="${waLink}" target="_blank" rel="noopener" style="display:block;text-align:center;text-decoration:none">💬 Contacter sur WhatsApp</a>`:""}
    <h3 style="margin:14px 0 8px 0">${products.length} produits</h3>
    <div class="cat-p-grid">${gridItems||"<div class='ps-note'>Aucun produit dans ce catalogue.</div>"}</div>
    <div class="aff-actions">
      <button class="sheet-add" id="cat-add-selected">➕ Ajouter les produits cochés à ma boutique</button>
      <button class="plus-item" id="cat-add-all">➕ Tout ajouter</button>
      <button class="plus-item" id="cat-toggle-all">Cocher / décocher tout</button>
    </div>
    <div id="cat-add-status" class="ps-note"></div>`;
  const currentSender = s.business_name || "inconnu";
  $("#cat-add-selected").onclick = async ()=>{
    const checked = [...box.querySelectorAll('.cat-p-check input:checked')].map(i=>+i.dataset.i);
    await addProductsFromCatalog(products.filter((_,i)=>checked.includes(i)), currentSender);
  };
  $("#cat-add-all").onclick = async ()=>{
    await addProductsFromCatalog(products, currentSender);
  };
  $("#cat-toggle-all").onclick = ()=>{
    const all = [...box.querySelectorAll('.cat-p-check input')];
    const anyChecked = all.some(i=>i.checked);
    all.forEach(i=>i.checked = !anyChecked);
  };
}

async function addProductsFromCatalog(products, sender){
  if(!products.length){ $("#cat-add-status").textContent = "Rien à ajouter."; return; }
  if(!confirm("Ajouter "+products.length+" produit(s) à ta boutique ?")) return;
  const p = cur();
  if(!Array.isArray(p.revenus)) p.revenus = [];
  const seen = new Set(p.revenus.map(r=>String(r.nom||"").toLowerCase().trim()));
  let added = 0, skipped = 0;
  for(const r of products){
    const key = String(r.nom||"").toLowerCase().trim();
    if(!key){ skipped++; continue; }
    if(seen.has(key)){ skipped++; continue; }
    p.revenus.push({
      id: "r"+Math.random().toString(36).slice(2,9),
      nom: r.nom, prix: r.prix||0, cout: r.cout||0,
      qte: r.qte||0, stock: (typeof r.stock==="number"?r.stock:null),
      desc: r.desc||"", vitrine: r.vitrine!==false, unite: r.unite,
      photo: r.photo || null,
      source: sender
    });
    seen.add(key);
    added++;
  }
  await persist();
  $("#cat-add-status").innerHTML = `<span style="color:#7c7">✅ ${added} produit(s) ajouté(s)</span>${skipped?` · <span class="muted">${skipped} ignoré(s) (doublons)</span>`:""}`;
  refreshAll();
}

/* ============================================================
   BIOMÉTRIE — Écran de configuration
   ============================================================ */
async function openBioSetup(){
  const sheet = $("#sheet");
  const supported = BioAuth.available();
  const platformOK = supported ? await BioAuth.platformAvailable() : false;
  const enrolled = BioAuth.enrolled();
  const p = cur();
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Déverrouillage biométrique</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Utilise <b>Face ID, Touch ID, ton empreinte digitale ou Windows Hello</b> pour rouvrir BOSS quand elle est verrouillée par inactivité — au lieu de saisir ton code administrateur.</div>
    <div class="ps-note">Les données biométriques ne quittent <b>jamais</b> ton téléphone. BOSS ne stocke qu'un identifiant technique (32 caractères) pour valider ta demande.</div>

    <div class="bio-status">
      <div class="ad-row"><span>Support navigateur</span><b>${supported?"✅ Oui":"❌ Non"}</b></div>
      <div class="ad-row"><span>Capteur biométrique</span><b>${platformOK?"✅ Détecté":supported?"⚠️ Introuvable":"❌ N/A"}</b></div>
      <div class="ad-row"><span>Statut</span><b>${enrolled?"✅ Activé sur cet appareil":"Non activé"}</b></div>
    </div>

    ${!supported?`<div class="ps-note" style="color:#f96">Ton navigateur ne supporte pas WebAuthn. Utilise Chrome, Safari récent, Edge ou Firefox 60+.</div>`:""}
    ${supported && !platformOK?`<div class="ps-note" style="color:#f96">Aucun capteur biométrique détecté (Face ID / empreinte). Sur mobile, vérifie que le déverrouillage biométrique est activé dans les réglages système.</div>`:""}
    ${supported && platformOK && !state.admin?.pin?`<div class="ps-note" style="color:#f96">⚠️ Tu n'as pas encore de code administrateur. Va d'abord dans <b>Espace administrateur</b> pour en créer un — la biométrie fonctionne <b>en plus</b> du code, jamais à la place.</div>`:""}

    <div class="aff-actions">
      ${supported && platformOK && !enrolled ? `<button class="sheet-add" id="bio-enroll">👆 Activer avec ma biométrie</button>` : ""}
      ${enrolled ? `<button class="sheet-add" id="bio-test">🧪 Tester la biométrie</button>
        <button class="plus-item danger" id="bio-remove">✕ Désactiver la biométrie</button>` : ""}
    </div>
    <div id="bio-status-msg" class="ps-note"></div>`;
  $("#sheet-close").onclick = closeSheet;
  const setMsg = (t, ok) => {
    const m = $("#bio-status-msg");
    m.textContent = t;
    m.style.color = ok===false?"#f96":ok===true?"#7c7":"";
  };
  const enrollBtn = $("#bio-enroll");
  if(enrollBtn) enrollBtn.onclick = async ()=>{
    setMsg("Placement du doigt / regard vers l'écran…");
    try {
      await BioAuth.enroll(p.name || "BOSS");
      setMsg("✅ Biométrie activée. Elle sera proposée au prochain verrouillage.", true);
      setTimeout(openBioSetup, 900);
    } catch(e){
      setMsg("Échec : "+(e.message||"annulé"), false);
    }
  };
  const testBtn = $("#bio-test");
  if(testBtn) testBtn.onclick = async ()=>{
    setMsg("Vérification…");
    try {
      await BioAuth.verify();
      setMsg("✅ Ta biométrie fonctionne !", true);
    } catch(e){
      setMsg("Échec : "+(e.message||"annulé"), false);
    }
  };
  const remBtn = $("#bio-remove");
  if(remBtn) remBtn.onclick = ()=>{
    if(!confirm("Retirer la biométrie de cet appareil ? Tu devras utiliser ton code pour déverrouiller.")) return;
    BioAuth.disable();
    openBioSetup();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============================================================
   BIOMÉTRIE (WebAuthn) — Face ID, Touch ID, empreinte Android
   Déverrouillage local (offline). Aucune donnée biométrique ne
   quitte l'appareil ; on stocke uniquement un ID de credential.
   ============================================================ */
const BioAuth=(function(){
  const KEY_ID = "boss:bio:credId:v1";
  function available(){
    return !!(window.PublicKeyCredential && navigator.credentials
      && typeof navigator.credentials.create === "function"
      && typeof navigator.credentials.get === "function");
  }
  async function platformAvailable(){
    if(!available()) return false;
    try {
      if(PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable){
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      }
    } catch(_){}
    return false;
  }
  function _b64u(u8){ let s=""; for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
  function _ub64(str){ str=str.replace(/-/g,"+").replace(/_/g,"/"); while(str.length%4) str+="="; const bin=atob(str); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
  function getCredId(){ try { const v = localStorage.getItem(KEY_ID); return v || null; } catch(_){ return null; } }
  function saveCredId(id){ try { localStorage.setItem(KEY_ID, id); } catch(_){} }
  function clearCredId(){ try { localStorage.removeItem(KEY_ID); } catch(_){} }
  function enrolled(){ return !!getCredId(); }

  async function enroll(userName){
    if(!available()) throw new Error("Biométrie non supportée sur ce navigateur");
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const publicKey = {
      challenge,
      rp: { name: "BOSS", id: location.hostname },
      user: {
        id: userId,
        name: userName || "boss-user",
        displayName: userName || "BOSS"
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7  }, // ES256
        { type: "public-key", alg: -257 } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        requireResidentKey: false
      },
      timeout: 60000,
      attestation: "none"
    };
    const cred = await navigator.credentials.create({ publicKey });
    if(!cred || !cred.rawId) throw new Error("Enrôlement annulé");
    const id = _b64u(new Uint8Array(cred.rawId));
    saveCredId(id);
    return id;
  }

  async function verify(){
    const id = getCredId();
    if(!id) throw new Error("Aucune biométrie enregistrée");
    if(!available()) throw new Error("Biométrie non supportée sur ce navigateur");
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const publicKey = {
      challenge,
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: _ub64(id), transports: ["internal"] }],
      userVerification: "required",
      timeout: 60000
    };
    const assertion = await navigator.credentials.get({ publicKey });
    return !!assertion;
  }

  return { available, platformAvailable, enroll, verify, enrolled, disable: clearCredId, getCredId };
})();

const IdleLock=(function(){
  const IDLE_MS_DEFAULT = 15*60*1000; // 15 min
  let lastActivity = Date.now();
  let timer = null;
  let locked = false;
  function idleMs(){ return (state.security && state.security.idleMs) || IDLE_MS_DEFAULT; }
  function isEnabled(){ return !(state.security && state.security.idleLock===false) && !!state.admin?.pin; }
  function bump(){ lastActivity = Date.now(); }
  function start(){
    if(timer) return;
    ["mousemove","keydown","touchstart","click","scroll","visibilitychange"].forEach(ev=>{
      try{ document.addEventListener(ev, bump, {passive:true, capture:true}); }catch(_){}
    });
    timer = setInterval(check, 20000);
  }
  function check(){
    if(locked) return;
    if(!isEnabled()) return;
    if(Date.now() - lastActivity >= idleMs()) lock();
  }
  function lock(){
    if(locked) return;
    if(!state.admin?.pin){ return; } // pas de PIN, pas de verrou
    locked = true;
    const bioAvailable = BioAuth.available() && BioAuth.enrolled();
    let ov = document.getElementById("idle-lock");
    if(ov){ ov.remove(); ov = null; }
    ov = document.createElement("div");
    ov.id = "idle-lock";
    ov.className = "idle-lock";
    ov.innerHTML = `
      <div class="idle-lock-box">
        <div class="idle-lock-icon">${ic("lock")}</div>
        <div class="idle-lock-title">BOSS est verrouillée</div>
        <div class="idle-lock-sub">Inactivité — utilise ta biométrie ou ton code pour rouvrir.</div>
        ${bioAvailable?`<button class="sheet-add" id="idle-lock-bio" style="margin-bottom:10px">👆 Utiliser ma biométrie</button><div class="idle-lock-or">— ou —</div>`:""}
        <input class="field" id="idle-lock-code" type="password" inputmode="numeric" autocomplete="off" placeholder="Code administrateur">
        <button class="sheet-add" id="idle-lock-go" style="background:var(--char2);color:var(--cream);border:1px solid var(--line)">Déverrouiller avec le code</button>
        <div class="idle-lock-err" id="idle-lock-err"></div>
      </div>`;
    document.body.appendChild(ov);
    ov.style.display = "flex";
    setTimeout(()=>{
      const bioBtn = document.getElementById("idle-lock-bio");
      if(bioBtn){ bioBtn.focus(); tryBio(); }
      else { const i=document.getElementById("idle-lock-code"); i && i.focus(); }
    }, 150);
    document.getElementById("idle-lock-go").onclick = tryUnlock;
    document.getElementById("idle-lock-code").onkeydown = e=>{ if(e.key==="Enter") tryUnlock(); };
    const bioBtn = document.getElementById("idle-lock-bio");
    if(bioBtn) bioBtn.onclick = tryBio;
  }
  async function tryBio(){
    const err = document.getElementById("idle-lock-err");
    try {
      const ok = await BioAuth.verify();
      if(ok){
        err.textContent = "";
        document.getElementById("idle-lock").style.display = "none";
        locked = false;
        bump();
      }
    } catch(e){
      err.textContent = "Vérification biométrique refusée. Utilise ton code.";
    }
  }
  function tryUnlock(){
    const code = document.getElementById("idle-lock-code").value;
    const err = document.getElementById("idle-lock-err");
    if(String(code) === String(state.admin.pin)){
      err.textContent = "";
      document.getElementById("idle-lock").style.display = "none";
      document.getElementById("idle-lock-code").value = "";
      locked = false;
      bump();
    } else {
      err.textContent = "Code incorrect.";
    }
  }
  function forceLockNow(){ if(!state.admin?.pin){ alert("Crée d'abord un code administrateur (Plus → Espace administrateur)."); return; } lock(); }
  return { start, forceLockNow, isLocked: ()=>locked, bump };
})();
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

/* ============================================================
   PERSONNALISATION UI par profil : écran d'accueil + modules
   du menu visibles. Chaque business a sa propre config.
   ============================================================ */

// Toutes les vues candidates (ordre affiché dans le menu de personnalisation)
const MENU_VIEWS = [
  {v:"dash",       label:"Tableau",        ic:"dash",       required:true},
  {v:"boutique",   label:"Boutique",       ic:"boutique"},
  {v:"stock",      label:"Stock",          ic:"stock"},
  {v:"caisse",     label:"Caisse",         ic:"caisse"},
  {v:"pos",        label:"Saisie caisse",  ic:"pos"},
  {v:"carnet",     label:"Carnet",         ic:"carnet"},
  {v:"commandes",  label:"Commandes",      ic:"commandes"},
  {v:"pieces",     label:"Pièces",         ic:"doc"},
  {v:"tresorerie", label:"Trésorerie",     ic:"wallet"},
  {v:"clients",    label:"Clients",        ic:"clients"},
  {v:"historique", label:"Historique",     ic:"historique"},
  {v:"config",     label:"Réglages",       ic:"config",     required:true},
  {v:"onboard",    label:"Reconfigurer",   ic:"onboard"}
];

// Vues candidates comme écran d'accueil (uniquement celles qui ont du sens à l'ouverture)
const HOME_CANDIDATES = ["dash","boutique","caisse","pos","commandes","carnet","stock","pieces","tresorerie","clients","historique"];

function defaultMenuVisible(){ return MENU_VIEWS.map(x=>x.v); }

function ensureProfileUI(p){
  if(!p) return;
  if(!p.ui) p.ui = {};
  if(!p.ui.home) p.ui.home = "dash";
  if(!Array.isArray(p.ui.menuVisible) || !p.ui.menuVisible.length) p.ui.menuVisible = defaultMenuVisible();
  // Toujours forcer les vues requises (garantie de non-blocage)
  MENU_VIEWS.filter(x=>x.required).forEach(x=>{
    if(!p.ui.menuVisible.includes(x.v)) p.ui.menuVisible.push(x.v);
  });
}

function applyMenuCustomization(){
  const p = cur(); if(!p) return;
  ensureProfileUI(p);
  const visible = new Set(p.ui.menuVisible);
  document.querySelectorAll(".navlink[data-v], .tab[data-v]").forEach(el=>{
    const v = el.dataset.v;
    if(!v) return;
    el.style.display = visible.has(v) ? "" : "none";
  });
}

/* ============================================================
   TEMPLATES MÉTIER — packs prêts à l'emploi pour Afrique de l'Ouest
   ============================================================ */

const TEMPLATES_METIER = [
  {
    id: "maquis-complet", ic: "🍗",
    title: "Maquis complet",
    resume: "Poulet, poisson, boissons, attiéké, riz. Charges typiques d'un maquis abidjanais.",
    metier: "maquis",
    revenus: [
      {nom:"Poulet braisé entier",   prix: 3500, cout: 1700, qte: 200, stock: 30, vitrine: true},
      {nom:"Poulet braisé demi",     prix: 2000, cout:  900, qte: 250, stock: 30, vitrine: true},
      {nom:"Poisson braisé",         prix: 2500, cout: 1200, qte: 180, stock: 25, vitrine: true},
      {nom:"Attiéké poisson",        prix: 2000, cout:  900, qte: 300, stock: null, vitrine: true},
      {nom:"Riz sauce graine",       prix: 1500, cout:  600, qte: 220, stock: null, vitrine: true},
      {nom:"Bière (grand modèle)",   prix: 1000, cout:  600, qte: 800, stock: 150, vitrine: false},
      {nom:"Sucrerie 33 cl",         prix:  500, cout:  250, qte: 900, stock: 200, vitrine: false},
      {nom:"Eau minérale 1,5 L",     prix:  500, cout:  200, qte: 400, stock: 80, vitrine: false}
    ],
    charges: [
      {nom:"Loyer",                montant: 150000},
      {nom:"Salaires (cuisine)",   montant: 180000},
      {nom:"Salaires (service)",   montant: 120000},
      {nom:"Électricité (CIE)",    montant:  60000},
      {nom:"Gaz & charbon",         montant:  40000},
      {nom:"Eau (SODECI)",          montant:  15000}
    ],
    hours: "11h → 23h · 7/7"
  },
  {
    id: "boutique-cosmetique", ic: "💄",
    title: "Boutique cosmétique",
    resume: "Cosmétiques importés, mèches, perruques, huiles capillaires, produits éclaircissants.",
    metier: "vendeur",
    revenus: [
      {nom:"Mèche brésilienne 3 paquets",  prix: 45000, cout: 25000, qte:  8, stock: 12, vitrine: true},
      {nom:"Perruque courte",               prix: 25000, cout: 12000, qte: 15, stock: 20, vitrine: true},
      {nom:"Huile capillaire",             prix:  3500, cout:  1500, qte: 60, stock: 40, vitrine: true},
      {nom:"Crème hydratante visage",       prix:  6000, cout:  2800, qte: 40, stock: 25, vitrine: true},
      {nom:"Lotion corps",                 prix:  4500, cout:  2000, qte: 50, stock: 30, vitrine: true},
      {nom:"Rouge à lèvres",               prix:  3000, cout:  1200, qte: 80, stock: 50, vitrine: true}
    ],
    charges: [
      {nom:"Loyer boutique",       montant: 120000},
      {nom:"Vendeuse",             montant:  80000},
      {nom:"Data & pub Facebook",  montant:  40000},
      {nom:"Électricité",          montant:  25000}
    ]
  },
  {
    id: "couture-atelier", ic: "🧵",
    title: "Couture / atelier",
    resume: "Tenues sur mesure, uniformes, retouches, broderie.",
    metier: "couturier",
    revenus: [
      {nom:"Tenue sur mesure femme",       prix: 35000, cout: 15000, qte: 25, stock: null, vitrine: true},
      {nom:"Tenue sur mesure homme",       prix: 40000, cout: 18000, qte: 20, stock: null, vitrine: true},
      {nom:"Uniforme scolaire (lot 10)",   prix: 60000, cout: 30000, qte:  8, stock: null, vitrine: true},
      {nom:"Retouches",                    prix:  3000, cout:   300, qte: 80, stock: null, vitrine: true},
      {nom:"Broderie personnalisée",       prix:  8000, cout:  2500, qte: 20, stock: null, vitrine: true}
    ],
    charges: [
      {nom:"Atelier (loyer)",     montant: 100000},
      {nom:"Apprenti",            montant:  60000},
      {nom:"Électricité",         montant:  25000},
      {nom:"Fil & fournitures",   montant:  20000}
    ]
  },
  {
    id: "livreur-mototaxi", ic: "🛵",
    title: "Livreur / moto-taxi",
    resume: "Courses moto, livraison colis, transport passagers.",
    metier: "commercial",
    revenus: [
      {nom:"Course courte (< 3 km)",       prix:   500, cout:  100, qte: 400, stock: null, vitrine: true},
      {nom:"Course moyenne (3-8 km)",      prix:  1000, cout:  200, qte: 250, stock: null, vitrine: true},
      {nom:"Course longue (> 8 km)",       prix:  2000, cout:  400, qte: 100, stock: null, vitrine: true},
      {nom:"Livraison colis",              prix:  1500, cout:  300, qte: 180, stock: null, vitrine: true}
    ],
    charges: [
      {nom:"Location moto (mensuel)",  montant:  60000},
      {nom:"Carburant",                montant:  90000},
      {nom:"Entretien / réparations",  montant:  25000},
      {nom:"Assurance",                montant:  10000}
    ]
  }
];

function openTemplates(){
  const sheet = $("#sheet");
  const rows = TEMPLATES_METIER.map(t=>`
    <button class="tpl-card" data-id="${t.id}">
      <div class="tpl-ic">${t.ic}</div>
      <div class="tpl-body">
        <div class="tpl-title">${escapeHtml(t.title)}</div>
        <div class="tpl-resume">${escapeHtml(t.resume)}</div>
        <div class="tpl-meta">${t.revenus.length} produits · ${t.charges.length} charges</div>
      </div>
    </button>`).join("");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Templates métier</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Choisis un pack pré-configuré. Il remplace les produits et charges du business courant. Idéal pour démarrer vite.</div>
    <div class="tpl-list">${rows}</div>`;
  $("#sheet-close").onclick = closeSheet;
  sheet.querySelectorAll(".tpl-card").forEach(b=>b.onclick = ()=>applyTemplate(b.dataset.id));
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

async function applyTemplate(id){
  const t = TEMPLATES_METIER.find(x=>x.id===id);
  if(!t) return;
  const p = cur();
  const hasContent = (p.revenus||[]).length || (p.charges||[]).length || (p.caisse||[]).length;
  if(hasContent && !confirm("Ce template va remplacer tes produits et charges actuels. Continuer ?")) return;
  p.metier = t.metier;
  p.unite = (BOSS.METIERS[t.metier]||BOSS.METIERS.vendeur).unite;
  p.revenus = t.revenus.map(r=>Object.assign({id:"r"+Math.random().toString(36).slice(2,9)}, r));
  p.charges = t.charges.map(c=>Object.assign({}, c));
  if(t.hours && p.identite) p.identite.hours = t.hours;
  await persist();
  closeSheet();
  refreshAll();
  showView("dash");
  alert("Template « "+t.title+" » appliqué ✅");
}

/* ============================================================
   QR CODE — encoder compact, mode byte, ISO/IEC 18004
   Version 1-10, correction Q (~25%), Reed-Solomon minimal.
   Suffisant pour les URLs wa.me (~100-150 caractères).
   ============================================================ */
const QRCode = (function(){
  // Tables Reed-Solomon (GF(256), polynôme 0x11D)
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function(){ let x=1; for(let i=0;i<255;i++){ EXP[i]=x; LOG[x]=i; x<<=1; if(x&0x100) x^=0x11D; } for(let i=255;i<512;i++) EXP[i]=EXP[i-255]; })();
  function gfMul(a,b){ return (a===0||b===0)?0:EXP[LOG[a]+LOG[b]]; }
  // Génère polynôme générateur de degré n
  function rsGenPoly(n){
    let p=[1]; for(let i=0;i<n;i++){ const q=[]; for(let j=0;j<=p.length;j++){ let v=0; if(j<p.length) v^=p[j]; if(j>0) v^=gfMul(p[j-1], EXP[i]); q[j]=v; } p=q; } return p;
  }
  function rsEncode(data, ecLen){
    const gen = rsGenPoly(ecLen);
    const res = new Uint8Array(data.length + ecLen);
    res.set(data);
    for(let i=0;i<data.length;i++){
      const c = res[i]; if(c===0) continue;
      for(let j=0;j<gen.length;j++) res[i+j] ^= gfMul(gen[j], c);
    }
    return res.slice(data.length);
  }
  // Tables version : [capacité bytes en mode byte, correction Q]
  const CAP_BYTE_Q = { 1:11, 2:20, 3:32, 4:46, 5:60, 6:74, 7:86, 8:108, 9:130, 10:151 };
  // ECC info par version pour correction Q : [total data bytes, block1_data, blocks, block2_data (0 si un seul groupe)]
  const ECC_Q = {
    1: { total:26, ec:13, groups:[{n:1, data:13}] },
    2: { total:44, ec:22, groups:[{n:1, data:22}] },
    3: { total:70, ec:18, groups:[{n:2, data:17}] },
    4: { total:100, ec:26, groups:[{n:2, data:24}] },
    5: { total:134, ec:18, groups:[{n:2, data:15},{n:2, data:16}] },
    6: { total:172, ec:24, groups:[{n:4, data:19}] },
    7: { total:196, ec:18, groups:[{n:2, data:14},{n:4, data:15}] },
    8: { total:242, ec:22, groups:[{n:4, data:18},{n:2, data:19}] },
    9: { total:292, ec:20, groups:[{n:4, data:16},{n:4, data:17}] },
    10:{ total:346, ec:24, groups:[{n:6, data:19},{n:2, data:20}] }
  };
  function pickVersion(len){
    for(const v of [1,2,3,4,5,6,7,8,9,10]){
      // 4 bits mode + 8 bits length (byte mode versions 1-9) ou 16 bits (10+)
      const lenBits = v<10 ? 8 : 16;
      const totalBits = 4 + lenBits + len*8;
      const dataBytes = ECC_Q[v].groups.reduce((s,g)=>s + g.n * g.data, 0);
      if(totalBits <= dataBytes * 8) return v;
    }
    return null;
  }
  function encodeData(text, v){
    const bytes = new TextEncoder().encode(text);
    const lenBits = v<10 ? 8 : 16;
    // Stream de bits
    const bits = [];
    const pushBits = (val, n)=>{ for(let i=n-1;i>=0;i--) bits.push((val>>i)&1); };
    pushBits(0b0100, 4); // mode byte
    pushBits(bytes.length, lenBits);
    for(const b of bytes) pushBits(b, 8);
    const info = ECC_Q[v];
    const dataBytes = info.groups.reduce((s,g)=>s + g.n * g.data, 0);
    // Terminator jusqu'à 4 bits
    for(let i=0;i<4 && bits.length < dataBytes*8; i++) bits.push(0);
    while(bits.length % 8) bits.push(0);
    const data = new Uint8Array(dataBytes);
    for(let i=0;i<bits.length/8;i++){ let b=0; for(let j=0;j<8;j++) b = (b<<1) | (bits[i*8+j]||0); data[i]=b; }
    // Padding
    let pad = 0xEC;
    for(let i=Math.ceil(bits.length/8); i<dataBytes; i++){ data[i] = pad; pad = (pad===0xEC)?0x11:0xEC; }
    return data;
  }
  function interleave(data, v){
    const info = ECC_Q[v];
    const blocks = [];
    let off = 0;
    for(const g of info.groups){
      for(let i=0;i<g.n;i++){
        const d = data.slice(off, off+g.data);
        off += g.data;
        const ec = rsEncode(d, info.ec);
        blocks.push({data:d, ec});
      }
    }
    const maxD = Math.max(...blocks.map(b=>b.data.length));
    const out = [];
    for(let i=0;i<maxD;i++) for(const b of blocks) if(i<b.data.length) out.push(b.data[i]);
    for(let i=0;i<info.ec;i++) for(const b of blocks) out.push(b.ec[i]);
    return out;
  }
  // Format info (mask + level) — pré-calculé (level Q = 3, mask 0)
  const FORMAT_Q0 = 0x355F; // level Q + mask 0 encodé BCH
  const FORMAT_LEVEL = { Q: [0x355F,0x3068,0x3F31,0x3A06,0x24B4,0x2183,0x2EDA,0x2BED] };
  // Pattern de finder + timing
  function newMatrix(size){ const m = []; for(let i=0;i<size;i++){ m[i]=new Int8Array(size); m[i].fill(-1); } return m; }
  function setFinder(m, x, y){
    for(let dy=-1; dy<=7; dy++) for(let dx=-1; dx<=7; dx++){
      const nx=x+dx, ny=y+dy; if(nx<0||ny<0||nx>=m.length||ny>=m.length) continue;
      const inner = (dx===0||dx===6||dy===0||dy===6) || (dx>=2&&dx<=4&&dy>=2&&dy<=4);
      m[ny][nx] = (dx>=0&&dx<=6&&dy>=0&&dy<=6) ? (inner?1:0) : 0;
    }
  }
  function setTiming(m){
    const s = m.length;
    for(let i=8;i<s-8;i++){ m[6][i] = (i%2)?0:1; m[i][6] = (i%2)?0:1; }
  }
  // Alignment patterns (positions) par version
  const ALIGN_POS = {
    1:[], 2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30], 6:[6,34],
    7:[6,22,38], 8:[6,24,42], 9:[6,26,46], 10:[6,28,50]
  };
  function setAlignment(m, v){
    const pos = ALIGN_POS[v];
    for(const y of pos) for(const x of pos){
      if(m[y][x] >= 0) continue;
      for(let dy=-2; dy<=2; dy++) for(let dx=-2; dx<=2; dx++){
        const inner = (dx>=-1&&dx<=1&&dy>=-1&&dy<=1);
        const center = (dx===0&&dy===0);
        m[y+dy][x+dx] = (Math.abs(dx)===2||Math.abs(dy)===2||center)?1:0;
      }
    }
  }
  function setDarkModule(m, v){ const s = m.length; m[4*v+9][8] = 1; }
  function reserveFormat(m){
    const s = m.length;
    for(let i=0;i<9;i++){ if(m[8][i]<0) m[8][i]=0; if(m[i][8]<0) m[i][8]=0; }
    for(let i=0;i<8;i++){ m[8][s-1-i] = m[8][s-1-i]<0?0:m[8][s-1-i]; m[s-1-i][8] = m[s-1-i][8]<0?0:m[s-1-i][8]; }
  }
  function placeData(m, data){
    const s = m.length;
    let bitIdx = 0, upward = true;
    for(let col=s-1; col>0; col-=2){
      if(col===6) col--;
      for(let row=0; row<s; row++){
        const y = upward ? s-1-row : row;
        for(let c=0;c<2;c++){
          const x = col - c;
          if(m[y][x] < 0){
            const byte = data[bitIdx>>3];
            const bit = (byte >> (7 - (bitIdx&7))) & 1;
            m[y][x] = bit;
            bitIdx++;
          }
        }
      }
      upward = !upward;
    }
  }
  function applyMask(m, mask){
    const s = m.length;
    // Détermine quels modules sont data (pas fixes)
    const isFixed = [];
    for(let y=0;y<s;y++){ isFixed[y] = new Uint8Array(s); }
    // Marquer les finders, timing, alignment comme fixes
    const finderZones = [[0,0],[s-7,0],[0,s-7]];
    for(const [x,y] of finderZones) for(let dy=-1;dy<=7;dy++) for(let dx=-1;dx<=7;dx++){
      const nx=x+dx, ny=y+dy; if(nx<0||ny<0||nx>=s||ny>=s) continue;
      isFixed[ny][nx] = 1;
    }
    for(let i=0;i<s;i++){ isFixed[6][i]=1; isFixed[i][6]=1; }
    for(let i=0;i<9;i++){ isFixed[8][i]=1; isFixed[i][8]=1; }
    for(let i=0;i<8;i++){ isFixed[8][s-1-i]=1; isFixed[s-1-i][8]=1; }
    // Alignment
    const v = (s-17)/4;
    const pos = ALIGN_POS[v]||[];
    for(const yc of pos) for(const xc of pos){
      let skip = false;
      for(const [fx,fy] of [[3,3],[s-4,3],[3,s-4]]) if(Math.abs(xc-fx)<=4 && Math.abs(yc-fy)<=4) skip=true;
      if(skip) continue;
      for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) isFixed[yc+dy][xc+dx] = 1;
    }
    const maskFn = [
      (x,y)=>(x+y)%2===0,
      (x,y)=>y%2===0,
      (x,y)=>x%3===0,
      (x,y)=>(x+y)%3===0,
      (x,y)=>(Math.floor(y/2)+Math.floor(x/3))%2===0,
      (x,y)=>((x*y)%2)+((x*y)%3)===0,
      (x,y)=>(((x*y)%2)+((x*y)%3))%2===0,
      (x,y)=>(((x+y)%2)+((x*y)%3))%2===0
    ][mask];
    for(let y=0;y<s;y++) for(let x=0;x<s;x++) if(!isFixed[y][x] && maskFn(x,y)) m[y][x] ^= 1;
  }
  function drawFormat(m, mask){
    const s = m.length;
    const fmt = FORMAT_LEVEL.Q[mask];
    for(let i=0;i<15;i++){
      const bit = (fmt>>(14-i))&1;
      // Bloc gauche
      if(i<6) m[i][8] = bit;
      else if(i<8) m[i+1][8] = bit;
      else m[s-15+i][8] = bit;
      // Bloc droit-haut
      if(i<8) m[8][s-1-i] = bit;
      else if(i<9) m[8][15-i-1+1] = bit;
      else m[8][15-i-1] = bit;
    }
    // Format extra dark
    m[s-8][8] = 1;
  }
  function buildMatrix(text, mask){
    const v = pickVersion(new TextEncoder().encode(text).length);
    if(!v) throw new Error("Texte trop long pour QR v1-10");
    const size = 17 + v*4;
    const m = newMatrix(size);
    setFinder(m, 0, 0); setFinder(m, size-7, 0); setFinder(m, 0, size-7);
    setTiming(m);
    setAlignment(m, v);
    setDarkModule(m, v);
    reserveFormat(m);
    const data = encodeData(text, v);
    const interleaved = interleave(data, v);
    const bytes = new Uint8Array(interleaved);
    placeData(m, bytes);
    applyMask(m, mask);
    drawFormat(m, mask);
    // Convertir en booléens (0/1 seulement)
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(m[y][x]<0) m[y][x]=0;
    return m;
  }
  // Choix du meilleur mask (pénalité minimale)
  function scoreMatrix(m){
    const s = m.length;
    let score = 0;
    // Rangées / colonnes 5+ identiques
    for(let y=0;y<s;y++){ let run=1; for(let x=1;x<s;x++){ if(m[y][x]===m[y][x-1]) run++; else { if(run>=5) score += 3+(run-5); run=1; } } if(run>=5) score += 3+(run-5); }
    for(let x=0;x<s;x++){ let run=1; for(let y=1;y<s;y++){ if(m[y][x]===m[y-1][x]) run++; else { if(run>=5) score += 3+(run-5); run=1; } } if(run>=5) score += 3+(run-5); }
    // Blocs 2x2
    for(let y=0;y<s-1;y++) for(let x=0;x<s-1;x++) if(m[y][x]===m[y][x+1] && m[y][x]===m[y+1][x] && m[y][x]===m[y+1][x+1]) score += 3;
    // Dark ratio proche de 50%
    let dark=0; for(let y=0;y<s;y++) for(let x=0;x<s;x++) if(m[y][x]) dark++;
    score += Math.floor(Math.abs(dark*20 - s*s*10)/(s*s)) * 10;
    return score;
  }
  function encode(text){
    let best=null, bestScore=Infinity, bestMask=0;
    for(let mask=0; mask<8; mask++){
      const m = buildMatrix(text, mask);
      const s = scoreMatrix(m);
      if(s < bestScore){ best = m; bestScore = s; bestMask = mask; }
    }
    return best;
  }
  function toSVG(matrix, size, color, bg){
    const n = matrix.length;
    const cell = size / (n + 8);
    const off = cell * 4;
    let path = "";
    for(let y=0;y<n;y++) for(let x=0;x<n;x++) if(matrix[y][x]){
      path += `M${(off+x*cell).toFixed(2)} ${(off+y*cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${bg||'#ffffff'}"/><path d="${path}" fill="${color||'#000000'}"/></svg>`;
  }
  return { encode, toSVG };
})();

function openQRShop(){
  const p = cur();
  const phone = (p.identite && p.identite.tel) || "";
  const cleanPhone = String(phone).replace(/\D/g,"");
  const cat = BOSS.waCatalogueText(p) || `Bonjour, je m'intéresse à ${p.name}`;
  const waUrl = "https://wa.me/" + cleanPhone + "?text=" + encodeURIComponent(cat);
  const shopUrl = location.origin + location.pathname; // fallback si pas de numéro
  const target = cleanPhone ? waUrl : shopUrl;

  let matrix = null;
  try { matrix = QRCode.encode(target); }
  catch(e){ /* URL trop longue : fallback catalogue court */
    const short = cleanPhone ? "https://wa.me/"+cleanPhone : shopUrl;
    matrix = QRCode.encode(short);
  }
  const svg = QRCode.toSVG(matrix, 480, "#0E0E0F", "#ffffff");

  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>QR code de ta boutique</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Un scan de ce QR ouvre directement <b>WhatsApp</b> avec ta liste de produits pré-remplie. Colle-le à l'entrée, sur ta carte de visite, sur les emballages.</div>
    <div class="qr-preview" id="qr-preview">${svg}</div>
    <div class="ps-note qr-target">${cleanPhone?"→ WhatsApp <b>"+escapeHtml(phone)+"</b>":"→ ouvre l'app BOSS (aucun numéro renseigné)"}</div>
    <div class="aff-actions">
      <button class="sheet-add" id="qr-dl-png">📥 Télécharger PNG (haute résolution)</button>
      <button class="plus-item" id="qr-dl-svg">📥 Télécharger SVG (vectoriel)</button>
      <button class="plus-item" id="qr-print">🖨️ Imprimer (A4)</button>
    </div>`;
  $("#sheet-close").onclick = closeSheet;

  async function svgToPngBlob(svgStr, size){
    const svgBlob = new Blob([svgStr], { type:"image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      return await new Promise((res,rej)=>{
        const img = new Image();
        img.onload = ()=>{
          const cv = document.createElement("canvas");
          cv.width = size; cv.height = size;
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0,0,size,size);
          ctx.drawImage(img, 0, 0, size, size);
          cv.toBlob(b => b?res(b):rej(new Error("toBlob a échoué")), "image/png", 0.95);
        };
        img.onerror = ()=>rej(new Error("SVG illisible"));
        img.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }

  $("#qr-dl-png").onclick = async()=>{
    const bigSvg = QRCode.toSVG(matrix, 1200, "#0E0E0F", "#ffffff");
    const blob = await svgToPngBlob(bigSvg, 1200);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `qr-${(p.name||"boutique").toLowerCase().replace(/\s+/g,"-")}.png`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  };
  $("#qr-dl-svg").onclick = ()=>{
    const blob = new Blob([QRCode.toSVG(matrix, 1200, "#0E0E0F", "#ffffff")], {type:"image/svg+xml"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `qr-${(p.name||"boutique").toLowerCase().replace(/\s+/g,"-")}.svg`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  };
  $("#qr-print").onclick = ()=>{
    const bigSvg = QRCode.toSVG(matrix, 600, "#0E0E0F", "#ffffff");
    const w = window.open("","_blank");
    if(!w){ alert("Autorise les popups pour imprimer."); return; }
    w.document.write(`<!doctype html><html><head><title>QR ${escapeHtml(p.name)}</title>
      <style>@page{size:A4 portrait;margin:20mm}body{margin:0;padding:0;font-family:sans-serif;text-align:center;color:#0E0E0F}
      h1{margin:0 0 8px 0;font-size:28pt}.sub{color:#666;margin-bottom:20mm}.qr{width:140mm;height:140mm;margin:auto}
      .cta{font-size:14pt;margin-top:12mm}</style></head>
      <body onload="window.print();setTimeout(()=>window.close(),300)">
      <h1>${escapeHtml(p.name)}</h1><div class="sub">${escapeHtml((p.identite&&p.identite.slogan)||"")}</div>
      <div class="qr">${bigSvg}</div><div class="cta">📱 Scanne pour commander sur WhatsApp</div>
      ${cleanPhone?`<div style="margin-top:6mm;font-size:12pt">📞 ${escapeHtml(phone)}</div>`:""}
      </body></html>`);
    w.document.close();
  };

  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============================================================
   IMPRESSION THERMAL BLUETOOTH ESC/POS 58 mm
   Compatible imprimantes Xprinter, Milestone, Rongta,
   MunbynEspon-like via service BLE générique 000018f0.
   ============================================================ */
const Thermal = (function(){
  const SERVICE = "000018f0-0000-1000-8000-00805f9b34fb";
  const CHAR    = "00002af1-0000-1000-8000-00805f9b34fb";
  let device = null, characteristic = null;

  async function connect(){
    if(!navigator.bluetooth) throw new Error("Web Bluetooth non supporté sur ce navigateur (utilise Chrome Android)");
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE] }, { namePrefix: "Printer" }, { namePrefix: "BlueTooth" }, { namePrefix: "MTP" }, { namePrefix: "MPT" }],
      optionalServices: [SERVICE]
    });
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(SERVICE);
    characteristic = await svc.getCharacteristic(CHAR);
    return { name: device.name || "Imprimante" };
  }

  function encoder(){ return new TextEncoder(); }
  function bytes(arr){ return new Uint8Array(arr); }

  const CMD = {
    init:         bytes([0x1B, 0x40]),          // ESC @ : reset
    align_left:   bytes([0x1B, 0x61, 0]),
    align_center: bytes([0x1B, 0x61, 1]),
    align_right:  bytes([0x1B, 0x61, 2]),
    bold_on:      bytes([0x1B, 0x45, 1]),
    bold_off:     bytes([0x1B, 0x45, 0]),
    dbl_on:       bytes([0x1D, 0x21, 0x11]),    // taille x2
    dbl_off:      bytes([0x1D, 0x21, 0x00]),
    line:         bytes([0x0A]),
    cut:          bytes([0x1D, 0x56, 0x42, 0x00])
  };

  async function writeChunked(data){
    if(!characteristic) throw new Error("Imprimante non connectée");
    // BLE MTU limité : envoi par tranches de 20 octets
    const chunk = 20;
    for(let i=0; i<data.length; i+=chunk){
      await characteristic.writeValue(data.slice(i, i+chunk));
    }
  }

  function concat(arrs){
    const total = arrs.reduce((s,a)=>s+a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for(const a of arrs){ out.set(a, off); off += a.length; }
    return out;
  }
  function txt(s){ return encoder().encode(s); }

  // Génère un ticket 58 mm (32 chars/ligne)
  function ticketFor(p, ecritures, totalHT, totalTVA, totalTTC, mode, recu){
    const W = 32;
    const line = "-".repeat(W)+"\n";
    const center = s => { const pad = Math.max(0, Math.floor((W-s.length)/2)); return " ".repeat(pad)+s+"\n"; };
    const twoCol = (l,r)=>{ const spc = Math.max(1, W - l.length - r.length); return l + " ".repeat(spc) + r + "\n"; };

    const parts = [
      CMD.init,
      CMD.align_center, CMD.bold_on, CMD.dbl_on,
      txt(p.name.toUpperCase().slice(0,W/2) + "\n"),
      CMD.dbl_off, CMD.bold_off,
      txt((p.identite?.adresse||"")+"\n"),
      txt((p.identite?.tel||"")+"\n"),
      CMD.align_left,
      txt(line),
      txt(twoCol("Ticket #"+Math.floor(Date.now()/1000).toString().slice(-6), new Date().toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}))),
      txt(line)
    ];
    (ecritures||[]).forEach(e=>{
      const nom = (e.nom||"Article").slice(0, W-10);
      const px = BOSS.fmtF(e.total||e.montant||0);
      parts.push(txt(twoCol(nom, px)));
      if(e.qte>1) parts.push(txt("  x"+e.qte+" @ "+BOSS.fmtF(e.prix||0)+"\n"));
    });
    parts.push(txt(line));
    if(totalHT!=null && totalTVA>0){
      parts.push(txt(twoCol("Total HT", BOSS.fmtF(totalHT))));
      parts.push(txt(twoCol("TVA", BOSS.fmtF(totalTVA))));
    }
    parts.push(CMD.bold_on);
    parts.push(txt(twoCol("TOTAL", BOSS.fmtF(totalTTC))));
    parts.push(CMD.bold_off);
    if(recu){
      parts.push(txt(twoCol("Reçu ("+mode+")", BOSS.fmtF(recu))));
      const rendu = recu - totalTTC;
      if(rendu>0) parts.push(txt(twoCol("Rendu", BOSS.fmtF(rendu))));
    }
    parts.push(txt(line));
    parts.push(CMD.align_center);
    parts.push(txt("Merci BOSS !\n"));
    if(p.identite?.slogan) parts.push(txt(p.identite.slogan+"\n"));
    parts.push(CMD.line, CMD.line, CMD.line);
    parts.push(CMD.cut);
    return concat(parts);
  }

  async function printTicket(payload){ await writeChunked(ticketFor(payload.p, payload.lignes, payload.ht, payload.tva, payload.ttc, payload.mode, payload.recu)); }
  async function printTestPage(){
    if(!characteristic) throw new Error("Imprimante non connectée");
    const p = cur();
    const data = concat([
      CMD.init, CMD.align_center, CMD.bold_on, CMD.dbl_on,
      txt((p.name||"BOSS")+"\n"),
      CMD.dbl_off, CMD.bold_off,
      txt("--- TEST IMPRESSION ---\n"),
      CMD.align_left,
      txt("Test 32 caractères max ligne\n"),
      txt(new Date().toLocaleString("fr-FR")+"\n"),
      CMD.line, CMD.line, CMD.line, CMD.cut
    ]);
    await writeChunked(data);
  }
  function connected(){ return !!(device && device.gatt && device.gatt.connected); }
  async function disconnect(){ if(device && device.gatt && device.gatt.connected) device.gatt.disconnect(); device=null; characteristic=null; }
  return { connect, connected, disconnect, printTicket, printTestPage };
})();

function openThermalPrint(){
  const p = cur();
  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Imprimer un ticket Bluetooth</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Imprimante thermique 58 mm (Xprinter, Rongta, Milestone…). Fonctionne sur <b>Chrome Android</b>. iPhone ne supporte pas Web Bluetooth — utilise l'app Chrome sur Android.</div>
    <div class="thermal-status" id="thermal-status">${Thermal.connected()?"✅ Connectée à : "+ (Thermal.device?.name||"imprimante") : "❌ Non connectée"}</div>
    <button class="sheet-add" id="th-connect">🔗 Connecter une imprimante</button>
    <button class="plus-item" id="th-test">🖨️ Imprimer une page de test</button>
    <div class="pf-lbl" style="margin-top:14px">Réimprimer le dernier ticket de caisse</div>
    <div class="ps-note">Sélectionne une vente récente pour la ré-imprimer.</div>
    <div id="th-recent"></div>`;
  $("#sheet-close").onclick = closeSheet;
  $("#th-connect").onclick = async()=>{
    try {
      const info = await Thermal.connect();
      $("#thermal-status").textContent = "✅ Connectée à : " + info.name;
    } catch(e){ alert("Échec : "+(e.message||"connexion refusée")); }
  };
  $("#th-test").onclick = async()=>{
    if(!Thermal.connected()){ alert("Connecte d'abord une imprimante."); return; }
    try { await Thermal.printTestPage(); alert("Page de test envoyée ✅"); }
    catch(e){ alert("Échec : "+e.message); }
  };
  // Dernières ventes réimprimables
  const recent = (p.caisse||[]).filter(e=>e.type==="vente").slice(-10).reverse();
  const box = $("#th-recent");
  if(!recent.length){ box.innerHTML = "<div class='ps-note'>Aucune vente enregistrée.</div>"; }
  else {
    box.innerHTML = recent.map((e,i)=>`
      <div class="th-row">
        <div><b>${escapeHtml(e.motif||"Vente")}</b><br><span class="muted2">${fmtDate(e.ts)} · ${BOSS.fmtF(e.montant)}</span></div>
        <button class="btn-mini" data-idx="${i}">🖨️ Réimprimer</button>
      </div>`).join("");
    box.querySelectorAll("[data-idx]").forEach(b=>b.onclick = async()=>{
      if(!Thermal.connected()){ alert("Connecte d'abord une imprimante."); return; }
      const e = recent[+b.dataset.idx];
      try {
        await Thermal.printTicket({
          p, lignes: [{nom: e.motif||"Vente", total: e.montant, prix: e.montant, qte: 1}],
          ht: null, tva: null, ttc: e.montant, mode: e.canal||"especes", recu: null
        });
        alert("Ticket envoyé ✅");
      } catch(err){ alert("Échec : "+err.message); }
    });
  }
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============================================================
   STATISTIQUES + PRÉVISION TRÉSORERIE MULTI-HORIZONS
   ============================================================ */
const HORIZONS = [7, 14, 30, 60, 90];
let __statsHorizon = 30;

function openStats(){ renderStats(); }

function computeSalesForRange(p, fromTs){
  const c = (p.caisse||[]).filter(e => e.type==="vente" && (fromTs==null || e.ts>=fromTs));
  const totalCA = c.reduce((s,e)=>s+(e.montant||0), 0);
  const nb = c.length;
  return { totalCA, nb, entries: c };
}
function computeExpensesForRange(p, fromTs){
  const c = (p.caisse||[]).filter(e => e.type==="depense" && (fromTs==null || e.ts>=fromTs));
  return c.reduce((s,e)=>s+(e.montant||0), 0);
}
function topProduits(p, fromTs, k){
  const map = new Map();
  (p.caisse||[]).filter(e=>e.type==="vente" && (fromTs==null||e.ts>=fromTs)).forEach(e=>{
    const key = (e.motif||"Autres").trim() || "Autres";
    map.set(key, (map.get(key)||0) + (e.montant||0));
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0, k);
}
function topClients(p, fromTs, k){
  const map = new Map();
  (p.commandes||[]).filter(o => fromTs==null || (o.createdAt||0)>=fromTs).forEach(o=>{
    const key = (o.clientNom||"Client").trim() || "Client";
    map.set(key, (map.get(key)||0) + BOSS.orderTotal(o));
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0, k);
}
function forecastCash(p, days){
  // Base : CA moyen jour sur 30 j récents, charges fixes mensuelles rapportées au jour
  const now = Date.now();
  const window = 30*86400000;
  const {totalCA} = computeSalesForRange(p, now-window);
  const dailyCA = totalCA / 30;
  const monthlyCharges = (p.charges||[]).reduce((s,c)=>s+(c.montant||0), 0);
  const dailyCharges = monthlyCharges / 30;
  const dailyExpenses = computeExpensesForRange(p, now-window) / 30;
  const netDaily = dailyCA - dailyCharges - dailyExpenses;
  // Position actuelle (soldes trésorerie)
  const balances = BOSS.treasuryBalances(p);
  const start = balances.total || 0;
  const points = [];
  for(let i=0; i<=days; i++){
    points.push({ day: i, value: start + netDaily * i });
  }
  return { points, dailyCA, dailyCharges, dailyExpenses, netDaily, start, projected: start + netDaily*days };
}

function svgBarChart(items, w, h, color){
  if(!items.length) return `<div class="ps-note">Pas encore de données.</div>`;
  const max = Math.max(1, ...items.map(x=>x[1]));
  const bw = (w - 60) / items.length - 8;
  const bars = items.map((it,i)=>{
    const x = 60 + i * ((w-60)/items.length) + 4;
    const bh = Math.max(4, (it[1]/max) * (h-60));
    const y = h - 30 - bh;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" rx="4"/>
      <text x="${(x+bw/2).toFixed(1)}" y="${(y-6).toFixed(1)}" font-size="11" fill="#ECECEE" text-anchor="middle">${BOSS.fmtF(it[1]).replace(/\s/g," ")}</text>
      <text x="${(x+bw/2).toFixed(1)}" y="${h-10}" font-size="10" fill="#9A9AA0" text-anchor="middle">${escapeSvg((it[0]||"").slice(0,12))}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block">${bars}</svg>`;
}
function svgLineChart(points, w, h, color, threshold){
  if(!points.length) return "";
  const values = points.map(p=>p.value);
  const min = Math.min(0, ...values), max = Math.max(1, ...values);
  const range = max - min || 1;
  const path = points.map((p,i)=>{
    const x = 40 + (i/(points.length-1)) * (w-60);
    const y = h - 30 - ((p.value - min)/range) * (h-60);
    return (i===0?"M":"L") + x.toFixed(1) + " " + y.toFixed(1);
  }).join(" ");
  // Zone rouge sous zéro
  const zeroY = h - 30 - ((0 - min)/range) * (h-60);
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block">
    ${threshold!=null?`<line x1="40" y1="${zeroY.toFixed(1)}" x2="${w-20}" y2="${zeroY.toFixed(1)}" stroke="#f96" stroke-dasharray="4 4" stroke-width="1"/>
      <text x="${w-25}" y="${(zeroY-4).toFixed(1)}" font-size="10" fill="#f96" text-anchor="end">seuil 0</text>`:""}
    <path d="${path}" stroke="${color}" stroke-width="2.5" fill="none" stroke-linejoin="round"/>
    <text x="40" y="20" font-size="11" fill="#9A9AA0">Trésorerie prévue (FCFA)</text>
    <text x="40" y="${h-4}" font-size="10" fill="#9A9AA0">J+0</text>
    <text x="${w-20}" y="${h-4}" font-size="10" fill="#9A9AA0" text-anchor="end">J+${points[points.length-1].day}</text>
  </svg>`;
}

function renderStats(){
  const p = cur();
  const now = Date.now();
  const from = now - __statsHorizon*86400000;
  const sales = computeSalesForRange(p, from);
  const expenses = computeExpensesForRange(p, from);
  const net = sales.totalCA - expenses;
  const prods = topProduits(p, from, 5);
  const clients = topClients(p, from, 5);
  const fc = forecastCash(p, __statsHorizon);

  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Statistiques & prévision</h3><button class="x" id="sheet-close">×</button></div>
    <div class="stats-tabs">
      ${HORIZONS.map(h=>`<button class="stats-tab ${__statsHorizon===h?'on':''}" data-h="${h}">${h}j</button>`).join("")}
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Sur ${__statsHorizon} derniers jours</div>
      <div class="ad-row"><span>Chiffre d'affaires</span><b>${BOSS.fmtF(sales.totalCA)}</b></div>
      <div class="ad-row"><span>Dépenses caisse</span><b>${BOSS.fmtF(expenses)}</b></div>
      <div class="ad-row"><span>Bénéfice net période</span><b style="color:${net>=0?'#7c7':'#f96'}">${BOSS.fmtF(net)}</b></div>
      <div class="ad-row"><span>Nombre de ventes</span><b>${sales.nb}</b></div>
      <div class="ad-row"><span>Panier moyen</span><b>${BOSS.fmtF(sales.nb?sales.totalCA/sales.nb:0)}</b></div>
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Prévision trésorerie J+${__statsHorizon}</div>
      <div class="ad-row"><span>Solde actuel</span><b>${BOSS.fmtF(fc.start)}</b></div>
      <div class="ad-row"><span>CA moyen / jour</span><b>${BOSS.fmtF(fc.dailyCA)}</b></div>
      <div class="ad-row"><span>Charges fixes / jour</span><b>${BOSS.fmtF(fc.dailyCharges + fc.dailyExpenses)}</b></div>
      <div class="ad-row"><span>Net / jour</span><b style="color:${fc.netDaily>=0?'#7c7':'#f96'}">${BOSS.fmtF(fc.netDaily)}</b></div>
      <div class="ad-row"><span>Solde projeté J+${__statsHorizon}</span><b style="color:${fc.projected>=0?'#7c7':'#f96'}">${BOSS.fmtF(fc.projected)}</b></div>
      ${svgLineChart(fc.points, 640, 220, "#C8A23A", 0)}
      ${fc.projected < 0 ? `<div class="ps-note" style="color:#f96;margin-top:8px">⚠️ Ta trésorerie deviendra négative avant J+${__statsHorizon}. Réduis les charges ou augmente les ventes.</div>` : ""}
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Top 5 produits</div>
      ${svgBarChart(prods, 640, 200, "#C8A23A")}
    </div>
    <div class="ad-card">
      <div class="ad-card-title">Top 5 clients (commandes)</div>
      ${svgBarChart(clients, 640, 200, "#5a8fb8")}
    </div>`;
  $("#sheet-close").onclick = closeSheet;
  sheet.querySelectorAll(".stats-tab").forEach(b=>b.onclick = ()=>{ __statsHorizon = parseInt(b.dataset.h, 10); renderStats(); });
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============================================================
   ALERTES INTELLIGENTES (horizons + push PWA optionnel)
   ============================================================ */
function computeAlertes(p, horizonDays){
  const now = Date.now();
  const alerts = [];
  const stockThreshold = 5;
  const lowStock = (p.revenus||[]).filter(r=>typeof r.stock==="number" && r.stock<=stockThreshold);
  lowStock.forEach(r=>alerts.push({level:"warn", icon:"📦", txt:`Stock bas : <b>${escapeHtml(r.nom)}</b> (${r.stock} restant)`}));

  const overdueMs = horizonDays * 86400000;
  const overdueDebts = (p.carnet||[]).filter(d=>!d.paye && (now - (d.ts||now)) >= overdueMs);
  overdueDebts.forEach(d=>alerts.push({level:"danger", icon:"⏰", txt:`Dette impayée > ${horizonDays}j : <b>${escapeHtml(d.client||"Client")}</b> — ${BOSS.fmtF(d.montant)}${d.motif?" ("+escapeHtml(d.motif)+")":""}`}));

  const ordersOverdue = (p.commandes||[]).filter(o=>{
    if(o.statut==="livree"||o.statut==="payee"||o.statut==="annulee") return false;
    return (now - (o.createdAt||now)) >= 7*86400000;
  });
  ordersOverdue.forEach(o=>alerts.push({level:"warn", icon:"📋", txt:`Commande en attente depuis 7 jours : <b>${escapeHtml(o.clientNom||"—")}</b> — ${BOSS.fmtF(BOSS.orderTotal(o))}`}));

  const {totalCA} = computeSalesForRange(p, now-30*86400000);
  const salesToday = computeSalesForRange(p, now - 86400000);
  const avgDaily = totalCA/30;
  if(avgDaily > 100 && salesToday.totalCA > avgDaily * 3){
    alerts.push({level:"info", icon:"🚀", txt:`Journée exceptionnelle ! <b>${BOSS.fmtF(salesToday.totalCA)}</b> aujourd'hui, +${Math.round((salesToday.totalCA/avgDaily-1)*100)}% vs moyenne.`});
  }
  if(avgDaily > 100 && salesToday.totalCA < avgDaily * 0.3 && new Date().getHours() > 18){
    alerts.push({level:"warn", icon:"📉", txt:`Journée calme : <b>${BOSS.fmtF(salesToday.totalCA)}</b> — bien en dessous de la moyenne (${BOSS.fmtF(avgDaily)}).`});
  }

  const fc = forecastCash(p, horizonDays);
  if(fc.projected < 0){
    alerts.push({level:"danger", icon:"⚠️", txt:`Trésorerie négative prévue à J+${horizonDays} : <b>${BOSS.fmtF(fc.projected)}</b>. Agis maintenant.`});
  }

  const {ca, seuilCA} = BOSS.computeFinancials(p);
  if(ca > 0 && ca >= seuilCA){
    alerts.push({level:"success", icon:"✅", txt:`Seuil de rentabilité atteint : CA <b>${BOSS.fmtF(ca)}</b> ≥ seuil <b>${BOSS.fmtF(seuilCA)}</b>. Chaque vente supplémentaire est du profit.`});
  }
  return alerts;
}

let __alertesHorizon = 30;
function openAlertes(){ renderAlertes(); }
function renderAlertes(){
  const p = cur();
  const alerts = computeAlertes(p, __alertesHorizon);
  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Alertes intelligentes</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Analyse automatique de ton business — délai de tolérance pour les dettes et les prévisions de trésorerie :</div>
    <div class="stats-tabs">
      ${HORIZONS.map(h=>`<button class="stats-tab ${__alertesHorizon===h?'on':''}" data-h="${h}">${h}j</button>`).join("")}
    </div>
    ${alerts.length===0
      ? `<div class="ad-card"><div class="ad-card-title">✅ Rien à signaler</div><div class="ps-note">Tout va bien de ce côté. Continue comme ça.</div></div>`
      : alerts.map(a=>`<div class="alert-row alert-${a.level}"><span class="alert-ic">${a.icon}</span><span class="alert-txt">${a.txt}</span></div>`).join("")
    }
    <div class="pf-lbl" style="margin-top:16px">Notifications push (navigateur)</div>
    <button class="plus-item" id="al-notif-enable">🔔 Activer les notifications</button>`;
  $("#sheet-close").onclick = closeSheet;
  sheet.querySelectorAll(".stats-tab").forEach(b=>b.onclick=()=>{ __alertesHorizon = parseInt(b.dataset.h,10); renderAlertes(); });
  $("#al-notif-enable").onclick = async()=>{
    if(!("Notification" in window)){ alert("Notifications non supportées."); return; }
    const r = await Notification.requestPermission();
    if(r === "granted"){
      new Notification("BOSS", { body: "Notifications activées ✅ Tu recevras les alertes ici.", icon: "icon-192.png" });
    } else alert("Notifications refusées.");
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============================================================
   RAPPORTS FISCAUX CGA/CEA (Ivoire/Sénégal — cadre standard)
   ============================================================ */
function openFiscal(){
  const p = cur();
  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth()+1;
  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Rapports fiscaux (CGA/CEA)</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Génère une déclaration mensuelle ou annuelle formatée pour dépôt au Centre de Gestion Agréé.</div>

    <div class="pf-lbl">Type de rapport</div>
    <div class="stats-tabs">
      <button class="stats-tab on" data-r="month">Mensuel</button>
      <button class="stats-tab" data-r="year">Annuel</button>
    </div>

    <div class="pf-row" id="fisc-monthly-inputs">
      <div><div class="pf-lbl">Mois</div>
        <select class="field" id="fisc-month">${Array.from({length:12},(_,i)=>{const m=i+1;const name=new Date(2000,i,1).toLocaleDateString("fr-FR",{month:"long"});return `<option value="${m}" ${m===defaultMonth?"selected":""}>${name}</option>`;}).join("")}</select></div>
      <div><div class="pf-lbl">Année</div>
        <select class="field" id="fisc-year">${Array.from({length:5},(_,i)=>{const y=defaultYear-i;return `<option value="${y}" ${y===defaultYear?"selected":""}>${y}</option>`;}).join("")}</select></div>
    </div>
    <div class="aff-actions">
      <button class="sheet-add" id="fisc-preview">👁️ Aperçu</button>
      <button class="plus-item" id="fisc-print">🖨️ Imprimer / PDF</button>
    </div>
    <div id="fisc-view" style="margin-top:14px"></div>`;
  $("#sheet-close").onclick = closeSheet;
  let mode = "month";
  sheet.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{
    mode = b.dataset.r;
    sheet.querySelectorAll("[data-r]").forEach(x=>x.classList.toggle("on", x===b));
    $("#fisc-monthly-inputs").style.display = mode==="year" ? "none":"flex";
  });
  const compute = () => {
    const year = parseInt($("#fisc-year").value,10) || defaultYear;
    const month = parseInt($("#fisc-month").value,10) || defaultMonth;
    let from, to, label;
    if(mode==="year"){
      from = new Date(year,0,1).getTime(); to = new Date(year+1,0,1).getTime();
      label = "Exercice "+year;
    } else {
      from = new Date(year,month-1,1).getTime(); to = new Date(year,month,1).getTime();
      label = new Date(year,month-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
    }
    const ventes = (p.caisse||[]).filter(e=>e.type==="vente" && e.ts>=from && e.ts<to);
    const depenses = (p.caisse||[]).filter(e=>e.type==="depense" && e.ts>=from && e.ts<to);
    const pieces = (p.pieces||[]).filter(e => {
      const d = e.date ? Date.parse(e.date+"T00:00:00") : 0;
      return d>=from && d<to;
    });
    const ventesTTC = ventes.reduce((s,e)=>s+(e.montant||0),0);
    const depensesTotal = depenses.reduce((s,e)=>s+(e.montant||0),0);
    // TVA
    const tvaCfg = p.tva || {enabled:false, rate:18, pricesIncludeTax:true};
    let tvaCollectee=0, ventesHT=ventesTTC;
    if(tvaCfg.enabled){
      const dec = BOSS.tvaDecompose(ventesTTC, tvaCfg.rate, tvaCfg.pricesIncludeTax!==false);
      tvaCollectee = dec.tva; ventesHT = dec.ht;
    }
    // Achats déductibles (pièces d'achat + quittances)
    const achatsPieces = pieces.filter(pc=>["achat","recu","frais","quittance"].includes(pc.type));
    const achatsTTC = achatsPieces.reduce((s,e)=>s+(e.montant||0),0);
    const chargesMensuelles = mode==="year" ? (p.charges||[]).reduce((s,c)=>s+(c.montant||0),0)*12 : (p.charges||[]).reduce((s,c)=>s+(c.montant||0),0);
    const resultat = ventesHT - achatsTTC - chargesMensuelles;
    return { label, from, to, ventes, depenses, pieces, ventesTTC, ventesHT, tvaCollectee, achatsPieces, achatsTTC, chargesMensuelles, resultat, tvaCfg };
  };
  const renderReport = () => {
    const r = compute();
    const nomBiz = p.name || "—";
    const rccm = p.identite?.rccm || "—";
    const ncc = p.identite?.ncc || "—";
    const adresse = p.identite?.adresse || "—";
    const tel = p.identite?.tel || "—";
    return `<div class="fisc-report" id="fisc-report">
      <div class="fisc-header">
        <div class="fisc-h1">DÉCLARATION FISCALE — ${escapeHtml(r.label.toUpperCase())}</div>
        <div class="fisc-h2">Régime CGA / CEA</div>
      </div>
      <div class="fisc-block">
        <div class="fisc-line"><b>Entreprise :</b> ${escapeHtml(nomBiz)}</div>
        <div class="fisc-line"><b>RCCM :</b> ${escapeHtml(rccm)} · <b>NCC :</b> ${escapeHtml(ncc)}</div>
        <div class="fisc-line"><b>Adresse :</b> ${escapeHtml(adresse)}</div>
        <div class="fisc-line"><b>Téléphone :</b> ${escapeHtml(tel)}</div>
        <div class="fisc-line"><b>Période :</b> ${new Date(r.from).toLocaleDateString("fr-FR")} → ${new Date(r.to-1).toLocaleDateString("fr-FR")}</div>
      </div>
      <div class="fisc-block">
        <div class="fisc-section">A. CHIFFRE D'AFFAIRES</div>
        <table class="fisc-tbl"><tr><td>Ventes TTC de la période</td><td class="num">${BOSS.fmtF(r.ventesTTC)}</td></tr>
        ${r.tvaCfg.enabled?`<tr><td>Ventes HT (dont TVA ${r.tvaCfg.rate}%)</td><td class="num">${BOSS.fmtF(r.ventesHT)}</td></tr>
        <tr><td>TVA collectée</td><td class="num">${BOSS.fmtF(r.tvaCollectee)}</td></tr>`:""}
        <tr><td>Nombre de ventes</td><td class="num">${r.ventes.length}</td></tr>
        </table>
      </div>
      <div class="fisc-block">
        <div class="fisc-section">B. CHARGES ET DÉPENSES DÉDUCTIBLES</div>
        <table class="fisc-tbl"><tr><td>Charges fixes déclarées</td><td class="num">${BOSS.fmtF(r.chargesMensuelles)}</td></tr>
        <tr><td>Achats et frais (pièces justificatives)</td><td class="num">${BOSS.fmtF(r.achatsTTC)}</td></tr>
        <tr><td>Nombre de pièces</td><td class="num">${r.achatsPieces.length}</td></tr>
        <tr><td>Dépenses caisse enregistrées</td><td class="num">${BOSS.fmtF(r.depenses.reduce((s,e)=>s+(e.montant||0),0))}</td></tr>
        </table>
      </div>
      <div class="fisc-block">
        <div class="fisc-section">C. RÉSULTAT FISCAL</div>
        <table class="fisc-tbl fisc-result">
        <tr><td>Bénéfice fiscal (A - B)</td><td class="num"><b>${BOSS.fmtF(r.resultat)}</b></td></tr>
        <tr><td>Marge nette (%)</td><td class="num">${r.ventesHT>0?((r.resultat/r.ventesHT)*100).toFixed(1)+" %":"—"}</td></tr>
        </table>
      </div>
      <div class="fisc-footer">
        <div>Rapport généré par BOSS le ${new Date().toLocaleDateString("fr-FR")}</div>
        <div class="fisc-sign">Signature du contribuable : ____________________</div>
      </div>
    </div>`;
  };
  $("#fisc-preview").onclick = ()=>{ $("#fisc-view").innerHTML = renderReport(); };
  $("#fisc-print").onclick = ()=>{
    const html = renderReport();
    const w = window.open("","_blank");
    if(!w){ alert("Autorise les popups pour imprimer."); return; }
    w.document.write(`<!doctype html><html><head><title>Déclaration fiscale</title>
      <style>@page{size:A4 portrait;margin:15mm}body{margin:0;padding:0;font-family:'Times New Roman',serif;color:#111;font-size:11pt}
      .fisc-header{border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px;text-align:center}
      .fisc-h1{font-size:16pt;font-weight:700}.fisc-h2{font-size:11pt;color:#555}
      .fisc-block{margin:10px 0 12px 0}
      .fisc-line{margin:2px 0}
      .fisc-section{font-weight:700;font-size:12pt;background:#eee;padding:4px 8px;margin:8px 0 4px 0;border-left:3px solid #000}
      .fisc-tbl{width:100%;border-collapse:collapse}
      .fisc-tbl td{padding:4px 8px;border-bottom:1px dotted #999}
      .fisc-tbl td.num{text-align:right;font-variant-numeric:tabular-nums}
      .fisc-result td{font-size:12pt;border-bottom:2px solid #000}
      .fisc-footer{margin-top:20mm;font-size:10pt;color:#666}
      .fisc-sign{margin-top:15mm;text-align:right}
      </style></head><body onload="window.print();setTimeout(()=>window.close(),300)">${html}</body></html>`);
    w.document.close();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function openPersonnalisation(){
  const p = cur(); ensureProfileUI(p);
  const sheet = $("#sheet");
  const homeRadios = HOME_CANDIDATES.map(v=>{
    const item = MENU_VIEWS.find(x=>x.v===v); if(!item) return "";
    const checked = p.ui.home===v ? "checked" : "";
    return `<label class="perso-home-row">
      <input type="radio" name="perso-home" value="${v}" ${checked}>
      <span class="perso-home-ic">${ic(item.ic)}</span>
      <span class="perso-home-lbl">${escapeHtml(item.label)}</span>
    </label>`;
  }).join("");
  const menuChecks = MENU_VIEWS.map(x=>{
    const checked = p.ui.menuVisible.includes(x.v) ? "checked" : "";
    const disabled = x.required ? "disabled" : "";
    const requiredTag = x.required ? "<span class='perso-req'>Requis</span>" : "";
    return `<label class="perso-item-row ${x.required?'perso-req-row':''}">
      <input type="checkbox" data-v="${x.v}" ${checked} ${disabled}>
      <span class="perso-item-ic">${ic(x.ic)}</span>
      <span class="perso-item-lbl">${escapeHtml(x.label)}</span>
      ${requiredTag}
    </label>`;
  }).join("");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Personnaliser mon menu</h3><button class="x" id="sheet-close">×</button></div>
    <div class="ps-note">Choisis l'écran qui s'ouvre quand tu lances l'app, et les modules à garder dans le menu latéral (les autres restent accessibles depuis <b>Plus</b>).</div>

    <div class="pf-lbl" style="margin-top:14px">Écran d'accueil</div>
    <div class="perso-home-grid">${homeRadios}</div>

    <div class="pf-lbl" style="margin-top:18px">Modules du menu</div>
    <div class="perso-items">${menuChecks}</div>

    <div class="aff-actions">
      <button class="sheet-add" id="perso-save">Enregistrer</button>
      <button class="plus-item" id="perso-reset">Rétablir les valeurs par défaut</button>
    </div>`;
  renderIcons(sheet);
  $("#sheet-close").onclick = closeSheet;

  $("#perso-save").onclick = async ()=>{
    const home = sheet.querySelector('input[name="perso-home"]:checked')?.value || "dash";
    const visible = [...sheet.querySelectorAll('.perso-items input[type="checkbox"]:checked')].map(x=>x.dataset.v);
    // Forcer les requis + inclure la home même si l'utilisateur l'a décochée
    MENU_VIEWS.filter(x=>x.required).forEach(x=>{ if(!visible.includes(x.v)) visible.push(x.v); });
    if(!visible.includes(home)) visible.push(home);
    const p = cur(); ensureProfileUI(p);
    p.ui.home = home;
    p.ui.menuVisible = visible;
    await persist();
    applyMenuCustomization();
    closeSheet();
    showView(home);
  };
  $("#perso-reset").onclick = async ()=>{
    const p = cur(); p.ui = { home:"dash", menuVisible: defaultMenuVisible() };
    await persist();
    applyMenuCustomization();
    openPersonnalisation();
  };

  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* ============================================================
   AFFICHES / FLYERS — 4 gabarits SVG, éditeur live, export PNG,
   partage WhatsApp, génération d'image via Pollinations.
   ============================================================ */

function escapeSvg(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

/* Découpe un texte en lignes tenant dans une largeur pixels approximée
   par la taille de police (0.55 * fontSize par caractère en moyenne). */
function wrapText(str, maxChars){
  const words = String(str||"").split(/\s+/).filter(Boolean);
  const lines=[]; let cur="";
  for(const w of words){
    if((cur+" "+w).trim().length > maxChars){
      if(cur) lines.push(cur); cur = w;
    } else cur = (cur?cur+" ":"")+w;
  }
  if(cur) lines.push(cur);
  return lines;
}
function tspanLines(lines, x, y, dy){
  return lines.map((l,i)=>`<tspan x="${x}" dy="${i===0?0:dy}">${escapeSvg(l)}</tspan>`).join("");
}
function affPrice(v){ return v==null?"—":(Math.round(v).toLocaleString("fr-FR")+" F"); }

/* ---------- GABARIT 1 : VITRINE SOLO ---------- */
function tplVitrine(cfg){
  const { title, subtitle, price, photo, logo, phone, address, accent } = cfg;
  const acc = accent || "#C8A23A";
  const nameLines = wrapText(title||"Nom du produit", 18);
  const nameHtml = tspanLines(nameLines.slice(0,2), 540, 1030, 68);
  return `<svg viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1350" fill="#0E0E0F"/>
    <rect x="0" y="0" width="1080" height="4" fill="${acc}"/>
    ${logo?`<image href="${logo}" x="70" y="80" width="140" height="140" preserveAspectRatio="xMidYMid meet"/>`:
      `<circle cx="140" cy="150" r="55" fill="${acc}"/><text x="140" y="170" font-family="Archivo" font-weight="900" font-size="48" fill="#0E0E0F" text-anchor="middle">B</text>`}
    <text x="240" y="130" font-family="Archivo" font-weight="900" font-size="42" fill="#ECECEE">${escapeSvg(subtitle||"BOSS")}</text>
    <text x="240" y="178" font-family="Inter" font-size="22" fill="#9A9AA0">${escapeSvg(phone||"")}</text>
    ${photo?`<clipPath id="phV"><rect x="90" y="260" width="900" height="640" rx="20"/></clipPath>
      <image href="${photo}" x="90" y="260" width="900" height="640" preserveAspectRatio="xMidYMid slice" clip-path="url(#phV)"/>`:
      `<rect x="90" y="260" width="900" height="640" rx="20" fill="#1A1A1C" stroke="#34343A" stroke-width="2"/>
       <text x="540" y="590" font-family="Inter" font-size="26" fill="#9A9AA0" text-anchor="middle">Photo du produit</text>`}
    <rect x="0" y="960" width="1080" height="390" fill="#1A1A1C"/>
    <text font-family="Archivo" font-weight="800" font-size="60" fill="#ECECEE" text-anchor="middle">${nameHtml}</text>
    <text x="540" y="1180" font-family="Archivo" font-weight="900" font-size="130" fill="${acc}" text-anchor="middle">${escapeSvg(affPrice(price))}</text>
    <text x="540" y="1290" font-family="Inter" font-size="24" fill="#9A9AA0" text-anchor="middle">${escapeSvg(address||"")}</text>
  </svg>`;
}

/* ---------- GABARIT 2 : CATALOGUE 3 PRODUITS ---------- */
function tplGrille3(cfg){
  const { title, subtitle, products, logo, phone, address, accent } = cfg;
  const acc = accent || "#C8A23A";
  const items = (products||[]).slice(0,3);
  while(items.length<3) items.push({nom:"Ton produit",prix:0,photo:null});
  const cardX=[60,395,730];
  const cards = items.map((p,i)=>{
    const nlines = wrapText(p.nom||"Produit", 14).slice(0,2);
    const nameHtml = tspanLines(nlines, cardX[i]+145, 900, 34);
    return `
      ${p.photo?`<clipPath id="ph3_${i}"><rect x="${cardX[i]}" y="620" width="290" height="220" rx="14"/></clipPath>
        <image href="${p.photo}" x="${cardX[i]}" y="620" width="290" height="220" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph3_${i})"/>`:
        `<rect x="${cardX[i]}" y="620" width="290" height="220" rx="14" fill="#242427"/>
         <text x="${cardX[i]+145}" y="740" font-family="Inter" font-size="18" fill="#9A9AA0" text-anchor="middle">Photo</text>`}
      <text font-family="Archivo" font-weight="700" font-size="26" fill="#ECECEE" text-anchor="middle">${nameHtml}</text>
      <text x="${cardX[i]+145}" y="1010" font-family="Archivo" font-weight="900" font-size="42" fill="${acc}" text-anchor="middle">${escapeSvg(affPrice(p.prix))}</text>`;
  }).join("");
  return `<svg viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1350" fill="#0E0E0F"/>
    <rect x="0" y="0" width="1080" height="4" fill="${acc}"/>
    ${logo?`<image href="${logo}" x="70" y="70" width="120" height="120" preserveAspectRatio="xMidYMid meet"/>`:""}
    <text x="220" y="120" font-family="Archivo" font-weight="900" font-size="50" fill="${acc}">${escapeSvg(title||"NOTRE CATALOGUE")}</text>
    <text x="220" y="170" font-family="Inter" font-size="24" fill="#9A9AA0">${escapeSvg(subtitle||"")}</text>
    <line x1="60" y1="220" x2="1020" y2="220" stroke="${acc}" stroke-width="3"/>
    <text x="540" y="330" font-family="Archivo" font-weight="800" font-size="52" fill="#ECECEE" text-anchor="middle">Découvre nos offres</text>
    <text x="540" y="400" font-family="Inter" font-size="24" fill="#9A9AA0" text-anchor="middle">Commande directement par WhatsApp</text>
    ${cards}
    <rect x="0" y="1150" width="1080" height="200" fill="#1A1A1C"/>
    <text x="540" y="1230" font-family="Archivo" font-weight="800" font-size="42" fill="${acc}" text-anchor="middle">${escapeSvg(phone||"")}</text>
    <text x="540" y="1290" font-family="Inter" font-size="22" fill="#9A9AA0" text-anchor="middle">${escapeSvg(address||"")}</text>
  </svg>`;
}

/* ---------- GABARIT 3 : PROMO CHOC ---------- */
function tplPromo(cfg){
  const { title, subtitle, price, priceOld, promoLabel, promoUntil, photo, logo, phone, accent } = cfg;
  const acc = accent || "#C8A23A";
  const nameLines = wrapText(title||"Produit", 16).slice(0,2);
  const nameHtml = tspanLines(nameLines, 540, 1020, 68);
  return `<svg viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1350" fill="#0E0E0F"/>
    <rect x="0" y="0" width="1080" height="4" fill="${acc}"/>
    ${logo?`<image href="${logo}" x="70" y="80" width="130" height="130" preserveAspectRatio="xMidYMid meet"/>`:""}
    <text x="220" y="130" font-family="Archivo" font-weight="900" font-size="42" fill="#ECECEE">${escapeSvg(subtitle||"PROMO")}</text>
    <text x="220" y="180" font-family="Inter" font-size="24" fill="#9A9AA0">${escapeSvg(phone||"")}</text>
    ${photo?`<clipPath id="phP"><rect x="90" y="240" width="900" height="640" rx="20"/></clipPath>
      <image href="${photo}" x="90" y="240" width="900" height="640" preserveAspectRatio="xMidYMid slice" clip-path="url(#phP)"/>`:
      `<rect x="90" y="240" width="900" height="640" rx="20" fill="#1A1A1C"/>
       <text x="540" y="570" font-family="Inter" font-size="26" fill="#9A9AA0" text-anchor="middle">Photo</text>`}
    <g transform="translate(870 260) rotate(-12)">
      <circle cx="0" cy="0" r="130" fill="${acc}"/>
      <text y="-10" font-family="Archivo" font-weight="900" font-size="60" fill="#0E0E0F" text-anchor="middle">${escapeSvg(promoLabel||"-30%")}</text>
      <text y="40" font-family="Inter" font-weight="700" font-size="22" fill="#0E0E0F" text-anchor="middle">PROMO</text>
    </g>
    <rect x="0" y="920" width="1080" height="430" fill="#1A1A1C"/>
    <text font-family="Archivo" font-weight="800" font-size="60" fill="#ECECEE" text-anchor="middle">${nameHtml}</text>
    ${priceOld?`<text x="540" y="1180" font-family="Archivo" font-size="52" fill="#9A9AA0" text-anchor="middle" text-decoration="line-through">${escapeSvg(affPrice(priceOld))}</text>`:""}
    <text x="540" y="1270" font-family="Archivo" font-weight="900" font-size="120" fill="${acc}" text-anchor="middle">${escapeSvg(affPrice(price))}</text>
    ${promoUntil?`<text x="540" y="1330" font-family="Inter" font-weight="600" font-size="22" fill="#e08" text-anchor="middle">⏰ Jusqu'au ${escapeSvg(promoUntil)}</text>`:""}
  </svg>`;
}

/* ---------- GABARIT 4 : MENU DU JOUR ---------- */
function tplMenu(cfg){
  const { title, subtitle, products, hours, logo, phone, address, accent } = cfg;
  const acc = accent || "#C8A23A";
  const items = (products||[]).slice(0,6);
  const rows = items.map((p,i)=>{
    const y = 500 + i*100;
    return `
      <line x1="80" y1="${y+30}" x2="1000" y2="${y+30}" stroke="#242427" stroke-width="1"/>
      <text x="80" y="${y+10}" font-family="Inter" font-weight="700" font-size="30" fill="#ECECEE">${escapeSvg((p.nom||"Produit").slice(0,32))}</text>
      <text x="1000" y="${y+10}" font-family="Archivo" font-weight="800" font-size="34" fill="${acc}" text-anchor="end">${escapeSvg(affPrice(p.prix))}</text>`;
  }).join("");
  return `<svg viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
    <rect width="1080" height="1350" fill="#0E0E0F"/>
    <rect x="0" y="0" width="1080" height="4" fill="${acc}"/>
    ${logo?`<image href="${logo}" x="70" y="70" width="130" height="130" preserveAspectRatio="xMidYMid meet"/>`:""}
    <text x="540" y="180" font-family="Archivo" font-weight="900" font-size="72" fill="${acc}" text-anchor="middle">${escapeSvg(title||"MENU DU JOUR")}</text>
    <text x="540" y="240" font-family="Inter" font-size="26" fill="#9A9AA0" text-anchor="middle">${escapeSvg(subtitle||"")}</text>
    ${hours?`<rect x="290" y="290" width="500" height="70" rx="35" fill="#1A1A1C" stroke="${acc}" stroke-width="2"/>
      <text x="540" y="335" font-family="Inter" font-weight="700" font-size="24" fill="${acc}" text-anchor="middle">🕐 ${escapeSvg(hours)}</text>`:""}
    ${rows}
    <rect x="0" y="1180" width="1080" height="170" fill="#1A1A1C"/>
    <text x="540" y="1240" font-family="Archivo" font-weight="800" font-size="38" fill="${acc}" text-anchor="middle">${escapeSvg(phone||"")}</text>
    <text x="540" y="1300" font-family="Inter" font-size="22" fill="#9A9AA0" text-anchor="middle">${escapeSvg(address||"")}</text>
  </svg>`;
}

const AFFICHE_TEMPLATES = [
  { id:"vitrine",  label:"Vitrine solo",       hint:"1 produit, prix géant, photo",    fn: tplVitrine },
  { id:"grille3",  label:"Catalogue 3",        hint:"3 produits + prix",              fn: tplGrille3 },
  { id:"promo",    label:"Promo choc",         hint:"Badge % + prix barré",           fn: tplPromo   },
  { id:"menu",     label:"Menu du jour",       hint:"Liste + horaires (maquis)",      fn: tplMenu    }
];

/* ---------- ÉDITEUR ---------- */
let __aff = null; // config courante

function openAffiches(preselectedProductId){
  const p = cur();
  const products = (p.revenus||[]).filter(r=>r.nom);
  const preselected = preselectedProductId ? products.find(r=>r.id===preselectedProductId) : products[0];
  __aff = {
    tpl: "vitrine",
    title: preselected?.nom || "",
    subtitle: p.name || "",
    price: preselected?.prix || 0,
    priceOld: (preselected?.prix||0) > 0 ? Math.round((preselected.prix)*1.3) : 0,
    promoLabel: "-30%",
    promoUntil: "",
    hours: "",
    photo: preselected?.photo || null,
    products: products.slice(0,6).map(r=>({nom:r.nom, prix:r.prix, photo:r.photo||null})),
    logo: p.identite?.logo || null,
    phone: p.identite?.tel || "",
    address: p.identite?.adresse || "",
    accent: (state.theme && state.theme.accent) || "#C8A23A"
  };
  renderAfficheEditor();
}

function renderAfficheEditor(){
  const sheet = $("#sheet");
  const tplList = AFFICHE_TEMPLATES.map(t=>`
    <button class="aff-tpl ${__aff.tpl===t.id?'on':''}" data-t="${t.id}">
      <div class="aff-tpl-name">${escapeHtml(t.label)}</div>
      <div class="aff-tpl-hint">${escapeHtml(t.hint)}</div>
    </button>`).join("");
  sheet.innerHTML = `
    <div class="sheet-head"><h3>Créer une affiche</h3><button class="x" id="sheet-close">×</button></div>
    <div class="aff-editor">
      <div class="aff-preview-wrap"><div class="aff-preview" id="aff-preview"></div></div>
      <div class="aff-controls">
        <div class="pf-lbl">Gabarit</div>
        <div class="aff-tpls">${tplList}</div>

        <div class="pf-lbl">Titre / Nom principal</div>
        <input class="field" id="aff-title" value="${escapeAttr(__aff.title)}" maxlength="60">
        <div class="pf-lbl">Sous-titre / Nom entreprise</div>
        <input class="field" id="aff-sub" value="${escapeAttr(__aff.subtitle)}" maxlength="40">

        <div class="pf-row">
          <div><div class="pf-lbl">Prix (FCFA)</div>
            <input class="field" id="aff-price" type="number" value="${Number(__aff.price)||0}"></div>
          <div><div class="pf-lbl">Prix barré (promo)</div>
            <input class="field" id="aff-priceold" type="number" value="${Number(__aff.priceOld)||0}"></div>
        </div>

        <div class="pf-row">
          <div><div class="pf-lbl">Badge promo</div>
            <input class="field" id="aff-promolabel" value="${escapeAttr(__aff.promoLabel)}" maxlength="10"></div>
          <div><div class="pf-lbl">Jusqu'au</div>
            <input class="field" id="aff-promountil" value="${escapeAttr(__aff.promoUntil)}" maxlength="30" placeholder="ex : dimanche 20h"></div>
        </div>

        <div class="pf-lbl">Horaires (menu)</div>
        <input class="field" id="aff-hours" value="${escapeAttr(__aff.hours)}" maxlength="40" placeholder="ex : 11h → 23h · 7/7">

        <div class="pf-lbl">Téléphone</div>
        <input class="field" id="aff-phone" value="${escapeAttr(__aff.phone)}" maxlength="40">
        <div class="pf-lbl">Adresse</div>
        <input class="field" id="aff-addr" value="${escapeAttr(__aff.address)}" maxlength="120">

        <div class="pf-lbl">Photo du produit</div>
        <div class="aff-photo-actions">
          <label class="btn-mini">📷 Envoyer<input type="file" id="aff-photo" accept="image/*" hidden></label>
          <button class="btn-mini" id="aff-ai">✨ Générer par IA</button>
          ${__aff.photo?`<button class="btn-mini danger" id="aff-photo-clear">✕ Retirer</button>`:""}
        </div>
        <div id="aff-ai-status" class="ps-note"></div>

        <div class="pf-lbl">Logo</div>
        <div class="aff-photo-actions">
          <label class="btn-mini">📷 Envoyer un logo<input type="file" id="aff-logo" accept="image/*" hidden></label>
          ${__aff.logo?`<button class="btn-mini danger" id="aff-logo-clear">✕ Retirer</button>`:""}
        </div>

        <div class="aff-actions">
          <button class="sheet-add" id="aff-download">📥 Télécharger PNG</button>
          <button class="plus-item" id="aff-share">📱 Partager (WhatsApp)</button>
          <button class="plus-item" id="aff-print">🖨️ Imprimer</button>
        </div>
      </div>
    </div>`;
  renderIcons(sheet);
  $("#sheet-close").onclick = closeSheet;

  sheet.querySelectorAll(".aff-tpl").forEach(b=>b.onclick = ()=>{ __aff.tpl = b.dataset.t; renderAfficheEditor(); });
  const bind = (id, key, num)=>{ const el=$("#"+id); if(!el) return; el.oninput = ()=>{ __aff[key] = num?parseFloat(el.value)||0:el.value; updatePreview(); }; };
  bind("aff-title","title");
  bind("aff-sub","subtitle");
  bind("aff-price","price", true);
  bind("aff-priceold","priceOld", true);
  bind("aff-promolabel","promoLabel");
  bind("aff-promountil","promoUntil");
  bind("aff-hours","hours");
  bind("aff-phone","phone");
  bind("aff-addr","address");

  const readAsDataURL = f => new Promise((r,rj)=>{ const rd=new FileReader(); rd.onload=()=>r(rd.result); rd.onerror=rj; rd.readAsDataURL(f); });

  const photoInp = $("#aff-photo");
  if(photoInp) photoInp.onchange = async e=>{
    const f = e.target.files?.[0]; if(!f) return;
    if(f.size > 4*1024*1024){ alert("Image trop lourde (max 4 Mo)."); return; }
    try { __aff.photo = await readAsDataURL(f); renderAfficheEditor(); } catch(_){ alert("Impossible de lire cette image."); }
  };
  const photoClear = $("#aff-photo-clear");
  if(photoClear) photoClear.onclick = ()=>{ __aff.photo = null; renderAfficheEditor(); };

  const logoInp = $("#aff-logo");
  if(logoInp) logoInp.onchange = async e=>{
    const f = e.target.files?.[0]; if(!f) return;
    if(f.size > 2*1024*1024){ alert("Logo trop lourd (max 2 Mo)."); return; }
    try {
      const url = await readAsDataURL(f);
      __aff.logo = url;
      // Sauvegarde dans le profil pour réutilisation
      const p = cur(); if(!p.identite) p.identite = {}; p.identite.logo = url; await persist();
      renderAfficheEditor();
    } catch(_){ alert("Impossible de lire ce logo."); }
  };
  const logoClear = $("#aff-logo-clear");
  if(logoClear) logoClear.onclick = ()=>{ __aff.logo = null; renderAfficheEditor(); };

  $("#aff-ai").onclick = () => generateAffichePhoto();
  $("#aff-download").onclick = () => afficheDownload();
  $("#aff-share").onclick    = () => afficheShare();
  $("#aff-print").onclick    = () => affichePrint();

  updatePreview();
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function currentAfficheSVG(){
  const t = AFFICHE_TEMPLATES.find(x=>x.id===__aff.tpl) || AFFICHE_TEMPLATES[0];
  return t.fn(__aff);
}
function updatePreview(){
  const box = $("#aff-preview"); if(!box) return;
  box.innerHTML = currentAfficheSVG();
}

async function generateAffichePhoto(){
  const st = $("#aff-ai-status"); if(st) st.textContent = "Génération IA en cours (~10 s)…";
  try {
    const kw = __aff.title || "produit";
    const prompt = `professional product photography of ${kw}, west african market style, studio lighting, clean background, high quality, no text`;
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=800&nologo=true&safe=true&seed=${Math.floor(Math.random()*1e6)}`;
    const resp = await fetch(url);
    if(!resp.ok) throw new Error("HTTP "+resp.status);
    const blob = await resp.blob();
    const dataUrl = await new Promise((r,rj)=>{ const rd=new FileReader(); rd.onload=()=>r(rd.result); rd.onerror=rj; rd.readAsDataURL(blob); });
    __aff.photo = dataUrl;
    if(st) st.textContent = "Image générée ✅";
    renderAfficheEditor();
  } catch(e){
    if(st) st.textContent = "Échec de la génération : "+(e.message||"réseau");
  }
}

/* SVG → PNG blob à 1080×1350 */
async function afficheToPngBlob(){
  const svg = currentAfficheSVG();
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    return await new Promise((resolve, reject)=>{
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = 1080; cv.height = 1350;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#0E0E0F"; ctx.fillRect(0,0,cv.width,cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(b => b ? resolve(b) : reject(new Error("toBlob a échoué")), "image/png", 0.95);
      };
      img.onerror = () => reject(new Error("SVG illisible en image"));
      img.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

function affNameBase(){
  const t = (__aff.title || "affiche").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40);
  const d = new Date(); const pad = n=>String(n).padStart(2,"0");
  return `boss-${t}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.png`;
}

async function afficheDownload(){
  try {
    const blob = await afficheToPngBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = affNameBase(); a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  } catch(e){ alert("Échec du téléchargement : "+(e.message||"")); }
}

async function afficheShare(){
  try {
    const blob = await afficheToPngBlob();
    const file = new File([blob], affNameBase(), { type:"image/png" });
    const shareData = {
      files: [file],
      title: __aff.title || "Affiche BOSS",
      text: `${__aff.title || ""} — ${affPrice(__aff.price)}${__aff.phone?"\n📞 "+__aff.phone:""}`
    };
    if(navigator.canShare && navigator.canShare(shareData) && navigator.share){
      await navigator.share(shareData);
    } else {
      // Repli : ouvre WhatsApp avec juste le texte (sans image)
      const txt = `*${__aff.title||""}*\n${affPrice(__aff.price)}${__aff.phone?"\n📞 "+__aff.phone:""}${__aff.address?"\n📍 "+__aff.address:""}\n\nTélécharge l'affiche puis envoie-la 👇`;
      window.open("https://wa.me/?text="+encodeURIComponent(txt), "_blank");
      // + télécharge l'image
      afficheDownload();
    }
  } catch(e){ alert("Partage indisponible : "+(e.message||"")); }
}

function affichePrint(){
  const svg = currentAfficheSVG();
  const w = window.open("", "_blank");
  if(!w){ alert("Autorise les popups pour imprimer."); return; }
  w.document.write(`<!doctype html><html><head><title>Affiche BOSS</title>
    <style>@page{size:A4 portrait;margin:12mm}html,body{margin:0;padding:0;background:#0E0E0F}
    .p{width:100%;max-width:186mm;margin:0 auto}.p svg{width:100%;height:auto;display:block}</style>
    </head><body onload="window.print();setTimeout(()=>window.close(),300)">
    <div class="p">${svg}</div></body></html>`);
  w.document.close();
}

/* ---------- utils ---------- */
function escapeHtml(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function escapeAttr(s){return escapeHtml(s).replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
/* URL image sûre : uniquement data:image/* ou blob: — bloque javascript:, data:text/html:, etc. */
function safeImgUrl(u){
  if(!u || typeof u !== "string") return "";
  const s = u.trim();
  if(/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return s.replace(/[\r\n"'<>()]/g,"");
  if(/^blob:/i.test(s)) return s.replace(/[\r\n"'<>()]/g,"");
  return "";
}
/* Nettoyage caractères de contrôle Unicode (empêche injection RTLO, zero-width, etc.) */
function sanitizeStr(s, maxLen){
  if(s==null) return "";
  let x = String(s);
  x = x.replace(/[\x00-\x1F\x7F-\x9F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, "");
  if(maxLen && x.length>maxLen) x = x.slice(0, maxLen);
  return x;
}
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

/* ============================================================
   MODE FACILE — grand écran d'accueil pour patrons peu lettrés
   ============================================================ */
const EasyMode = {
  canSpeak(){ return typeof window!=="undefined" && "speechSynthesis" in window; },
  canListen(){ return typeof window!=="undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window); },
  _u:null,
  speak(text){
    try{
      if(!this.canSpeak() || !state.easyVoice || !state.easyVoice.enabled) return;
      window.speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(String(text||""));
      u.lang=(state.easyVoice.lang)||"fr-FR"; u.rate=0.95; u.pitch=1;
      const voices=window.speechSynthesis.getVoices();
      const v=voices.find(x=>x.lang && x.lang.toLowerCase().startsWith("fr"));
      if(v) u.voice=v;
      this._u=u;
      window.speechSynthesis.speak(u);
    }catch(e){}
  },
  stop(){ try{ window.speechSynthesis.cancel(); }catch(e){} },
  listen(onText,onEnd){
    if(!this.canListen()){ onEnd&&onEnd(new Error("Micro non supporté par ton navigateur")); return null; }
    const R=window.SpeechRecognition||window.webkitSpeechRecognition;
    const r=new R();
    r.lang=(state.easyVoice&&state.easyVoice.lang)||"fr-FR";
    r.interimResults=false; r.maxAlternatives=1; r.continuous=false;
    r.onresult=(e)=>{ const t=e.results&&e.results[0]&&e.results[0][0]&&e.results[0][0].transcript; onText&&onText(String(t||"")); };
    r.onerror=(e)=>{ onEnd&&onEnd(e); };
    r.onend=()=>{ onEnd&&onEnd(null); };
    try{ r.start(); }catch(e){ onEnd&&onEnd(e); }
    return r;
  }
};

/* Format simplifié des montants : 2 137 → "2 mille", 1 250 000 → "1 million 250 mille" */
function simpleAmount(n){
  n=Math.round(Number(n)||0);
  if(n===0) return "0 francs";
  const neg=n<0; if(neg) n=-n;
  const M=Math.floor(n/1000000), r=n%1000000;
  const K=Math.floor(r/1000), U=r%1000;
  const parts=[];
  if(M>0) parts.push(M+(M>1?" millions":" million"));
  if(K>0) parts.push(K+" mille");
  if(U>0 && M===0 && K===0) parts.push(U); // sous 1000, dire exactement
  if(!parts.length) parts.push("moins de mille");
  return (neg?"moins ":"")+parts.join(" ")+" francs";
}

function easyDayStats(){
  const p=cur();
  const now=Date.now(), Djour=24*3600*1000;
  const todayStart=new Date(); todayStart.setHours(0,0,0,0);
  const t0=todayStart.getTime();
  let ventes=0, depenses=0, nbV=0, nbD=0;
  (p.caisse||[]).forEach(e=>{
    if(!e || !e.ts || e.ts<t0) return;
    if(e.type==="vente"){ ventes+=Number(e.montant)||0; nbV++; }
    else if(e.type==="depense"){ depenses+=Number(e.montant)||0; nbD++; }
  });
  const caisseNette=ventes-depenses;
  return { ventes, depenses, caisseNette, nbV, nbD };
}

function renderEasyHome(){
  const p=cur();
  const wrap=$("#easy-wrap"); if(!wrap) return;
  const stats=easyDayStats();
  wrap.innerHTML=`
    <div class="easy-brand">BOSS<span>.</span></div>
    <div class="easy-biz">${escapeHtml(p.name)}</div>

    <div class="easy-money">
      <div class="easy-money-lbl">Aujourd'hui, tu as gagné</div>
      <div class="easy-money-big" id="easy-net">${stats.caisseNette>=0?"":"— "}${new Intl.NumberFormat("fr-FR").format(Math.abs(stats.caisseNette))} F</div>
      <div class="easy-money-sub">${stats.caisseNette>=0?"C'est bien !":"Fais attention, tu as plus dépensé que gagné."}</div>
      <button class="easy-speak" id="easy-listen">🔊 Écouter</button>
    </div>

    <div class="easy-grid">
      <button class="easy-btn gain" id="easy-vente">
        <div class="easy-btn-emoji">💰</div>
        <div class="easy-btn-txt">J'ai vendu</div>
      </button>
      <button class="easy-btn perte" id="easy-depense">
        <div class="easy-btn-emoji">💸</div>
        <div class="easy-btn-txt">J'ai payé</div>
      </button>
      <button class="easy-btn dette" id="easy-dette">
        <div class="easy-btn-emoji">👥</div>
        <div class="easy-btn-txt">On me doit</div>
      </button>
      <button class="easy-btn parler" id="easy-ai">
        <div class="easy-btn-emoji">🎙️</div>
        <div class="easy-btn-txt">Parler à BOSS</div>
      </button>
    </div>

    <div class="easy-day">
      <h4>Ce que tu as fait aujourd'hui</h4>
      <div class="easy-day-row g"><span class="k">Ventes (${stats.nbV})</span><span class="v">${new Intl.NumberFormat("fr-FR").format(stats.ventes)} F</span></div>
      <div class="easy-day-row p"><span class="k">Dépenses (${stats.nbD})</span><span class="v">${new Intl.NumberFormat("fr-FR").format(stats.depenses)} F</span></div>
    </div>

    <button class="easy-more" id="easy-more">📊 Voir mes vrais chiffres (mode complet)</button>
  `;
  $("#easy-vente").onclick=()=>{ EasyMode.stop(); openEasyVente(); };
  $("#easy-depense").onclick=()=>{ EasyMode.stop(); openEasyDepense(); };
  $("#easy-dette").onclick=()=>{ EasyMode.stop(); openEasyDette(); };
  $("#easy-ai").onclick=()=>{ EasyMode.stop(); openEasyAI(); };
  $("#easy-more").onclick=()=>{ setEasyMode(false); showView("dash"); };
  const ls=$("#easy-listen");
  ls.onclick=()=>{
    if(ls.classList.contains("on")){ EasyMode.stop(); ls.classList.remove("on"); ls.textContent="🔊 Écouter"; return; }
    ls.classList.add("on"); ls.textContent="⏸ Arrêter";
    const msg = stats.caisseNette>=0
      ? `Bonjour patron. Aujourd'hui tu as gagné environ ${simpleAmount(stats.caisseNette)}. Tu as fait ${stats.nbV} vente${stats.nbV>1?"s":""}, pour un total de ${simpleAmount(stats.ventes)}. Tes dépenses sont de ${simpleAmount(stats.depenses)}. C'est bien, continue.`
      : `Attention patron. Aujourd'hui tu as perdu ${simpleAmount(-stats.caisseNette)}. Tes dépenses sont plus grandes que tes ventes. Regarde bien ce que tu as payé.`;
    EasyMode.speak(msg);
    setTimeout(()=>{ ls.classList.remove("on"); ls.textContent="🔊 Écouter"; }, Math.max(4000, msg.length*70));
  };
}

function setEasyMode(on){
  state.easyMode=!!on;
  document.body.classList.toggle("easy", state.easyMode);
  persist();
  if(state.easyMode){
    renderEasyHome();
    showView("easy");
  }
}

/* --- Sheet Facile : vente en 2 taps --- */
function openEasyVente(){
  const p=cur();
  const sheet=$("#sheet");
  const prods=(p.revenus||[]).filter(r=>r.prix>0).slice(0,8);
  sheet.innerHTML=`
    <div class="sheet-head"><h3>💰 J'ai vendu</h3><button class="x" id="sheet-close">×</button></div>
    ${prods.length?`<div class="pf-lbl" style="font-size:16px">Choisis le produit</div>
      <div class="chips" id="ev-prods">${prods.map((r,i)=>`<button class="chip" data-i="${i}">${escapeHtml(r.nom)} · ${new Intl.NumberFormat("fr-FR").format(r.prix)} F</button>`).join("")}</div>`:""}
    <div class="pf-lbl" style="font-size:16px">Combien tu as reçu ?</div>
    <input class="field" id="ev-amount" type="number" inputmode="numeric" placeholder="0" style="font-size:26px;text-align:center;font-weight:800">
    ${EasyMode.canListen()?`<button class="easy-mic" id="ev-mic">🎙️ Dire le montant</button>`:""}
    <button class="sheet-add" id="ev-save" style="background:#3a7d4f;font-size:18px">✓ Enregistrer la vente</button>
  `;
  $("#sheet-close").onclick=closeSheet;
  let selIdx=null;
  sheet.querySelectorAll("#ev-prods .chip").forEach(c=>{
    c.onclick=()=>{
      const i=+c.dataset.i; selIdx=i;
      sheet.querySelectorAll("#ev-prods .chip").forEach(x=>x.classList.remove("on"));
      c.classList.add("on");
      $("#ev-amount").value=prods[i].prix||"";
      EasyMode.speak(prods[i].nom+", "+simpleAmount(prods[i].prix));
    };
  });
  const mic=$("#ev-mic");
  if(mic) mic.onclick=()=>{
    mic.classList.add("rec"); mic.textContent="🔴 Parle maintenant…";
    EasyMode.listen(txt=>{
      const digits=(txt.match(/\d[\d\s]*/g)||[]).join("").replace(/\s/g,"");
      const nb = digits ? parseInt(digits,10) : parseFrenchNumber(txt);
      if(nb>0){ $("#ev-amount").value=nb; EasyMode.speak(simpleAmount(nb)); }
    }, ()=>{ mic.classList.remove("rec"); mic.textContent="🎙️ Dire le montant"; });
  };
  $("#ev-save").onclick=async()=>{
    const montant=parseFloat($("#ev-amount").value)||0;
    if(montant<=0){ EasyMode.speak("Dis-moi combien tu as reçu"); $("#ev-amount").focus(); return; }
    const entry={id:"m"+Date.now().toString(36),ts:Date.now(),type:"vente",montant,canal:"especes",label:selIdx!=null?prods[selIdx].nom:"Vente",productId:selIdx!=null?(prods[selIdx].id||selIdx):undefined,qty:1};
    p.caisse.push(entry);
    if(selIdx!=null && typeof prods[selIdx].stock==="number") prods[selIdx].stock=Math.max(0,prods[selIdx].stock-1);
    await persist();
    EasyMode.speak("C'est bon patron. "+simpleAmount(montant)+" enregistrés.");
    closeSheet(); renderEasyHome();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function openEasyDepense(){
  const p=cur();
  const sheet=$("#sheet");
  sheet.innerHTML=`
    <div class="sheet-head"><h3>💸 J'ai payé</h3><button class="x" id="sheet-close">×</button></div>
    <div class="pf-lbl" style="font-size:16px">Combien tu as payé ?</div>
    <input class="field" id="ed-amount" type="number" inputmode="numeric" placeholder="0" style="font-size:26px;text-align:center;font-weight:800">
    <div class="pf-lbl" style="font-size:16px">Pour quoi ? (facultatif)</div>
    <input class="field" id="ed-label" placeholder="Ex. charbon, transport, marchandise…">
    ${EasyMode.canListen()?`<button class="easy-mic" id="ed-mic">🎙️ Dire ce que j'ai payé</button>`:""}
    <button class="sheet-add" id="ed-save" style="background:#8a3a3a;font-size:18px">✓ Enregistrer la dépense</button>
  `;
  $("#sheet-close").onclick=closeSheet;
  const mic=$("#ed-mic");
  if(mic) mic.onclick=()=>{
    mic.classList.add("rec"); mic.textContent="🔴 Parle maintenant…";
    EasyMode.listen(txt=>{
      const digits=(txt.match(/\d[\d\s]*/g)||[]).join("").replace(/\s/g,"");
      const nb = digits ? parseInt(digits,10) : parseFrenchNumber(txt);
      if(nb>0) $("#ed-amount").value=nb;
      const label=txt.replace(/\d[\d\s]*/g,"").replace(/\s+/g," ").trim();
      if(label && label.length<80) $("#ed-label").value=label;
    }, ()=>{ mic.classList.remove("rec"); mic.textContent="🎙️ Dire ce que j'ai payé"; });
  };
  $("#ed-save").onclick=async()=>{
    const montant=parseFloat($("#ed-amount").value)||0;
    if(montant<=0){ EasyMode.speak("Dis-moi combien tu as payé"); $("#ed-amount").focus(); return; }
    p.caisse.push({id:"m"+Date.now().toString(36),ts:Date.now(),type:"depense",montant,canal:"especes",label:($("#ed-label").value||"Dépense").trim(),qty:1});
    await persist();
    EasyMode.speak("D'accord patron. "+simpleAmount(montant)+" payés, c'est enregistré.");
    closeSheet(); renderEasyHome();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function openEasyDette(){
  const p=cur();
  const sheet=$("#sheet");
  sheet.innerHTML=`
    <div class="sheet-head"><h3>👥 On me doit</h3><button class="x" id="sheet-close">×</button></div>
    <div class="pf-lbl" style="font-size:16px">Qui te doit ?</div>
    <input class="field" id="et-client" placeholder="Nom de la personne">
    <div class="pf-lbl" style="font-size:16px">Combien ?</div>
    <input class="field" id="et-montant" type="number" inputmode="numeric" placeholder="0" style="font-size:26px;text-align:center;font-weight:800">
    <div class="pf-lbl" style="font-size:16px">Son numéro WhatsApp (facultatif)</div>
    <input class="field" id="et-phone" inputmode="tel" placeholder="Ex. 0700000000">
    <button class="sheet-add" id="et-save" style="background:#8a6a2a;font-size:18px">✓ Ajouter à mon carnet</button>
  `;
  $("#sheet-close").onclick=closeSheet;
  $("#et-save").onclick=async()=>{
    const montant=parseFloat($("#et-montant").value)||0;
    const client=($("#et-client").value||"").trim();
    if(!client){ EasyMode.speak("Dis-moi le nom de la personne"); $("#et-client").focus(); return; }
    if(montant<=0){ EasyMode.speak("Dis-moi combien elle te doit"); $("#et-montant").focus(); return; }
    p.carnet=p.carnet||[];
    p.carnet.push({client, montant, motif:"", phone:($("#et-phone").value||"").trim(), paye:false, ts:Date.now()});
    await persist();
    EasyMode.speak(client+" te doit "+simpleAmount(montant)+". C'est noté.");
    closeSheet(); renderEasyHome();
  };
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

function openEasyAI(){
  const sheet=$("#sheet");
  sheet.innerHTML=`
    <div class="sheet-head"><h3>🎙️ Parle à BOSS</h3><button class="x" id="sheet-close">×</button></div>
    <div style="text-align:center;padding:12px 0 6px;color:var(--cream-dim);font-size:14.5px">Appuie sur le micro et parle. Dis ce que tu veux :<br><i>"Combien j'ai gagné ?"</i>, <i>"Comment augmenter mes ventes ?"</i></div>
    <button class="easy-mic" id="eai-mic" style="width:100%;padding:22px;font-size:18px;justify-content:center">🎙️ Parler maintenant</button>
    <div id="eai-heard" style="background:var(--char2);border:1px solid var(--line);border-radius:12px;padding:14px;margin:12px 0;color:var(--cream);font-size:15px;min-height:40px;font-style:italic"></div>
    <div id="eai-answer" style="background:var(--char);border:1px solid var(--gold);border-radius:12px;padding:14px;color:var(--cream);font-size:15.5px;line-height:1.5;min-height:40px"></div>
    <div style="text-align:center;margin-top:14px;color:var(--cream-dim);font-size:12.5px">${EasyMode.canListen()?"":"⚠️ Ton navigateur ne reconnaît pas la voix — écris ta question :"}</div>
    ${EasyMode.canListen()?"":`<input class="field" id="eai-txt" placeholder="Ta question ici…" style="margin-top:8px"><button class="sheet-add" id="eai-send" style="margin-top:8px">Envoyer</button>`}
  `;
  $("#sheet-close").onclick=()=>{ EasyMode.stop(); closeSheet(); };
  async function ask(question){
    if(!question) return;
    $("#eai-heard").textContent="« "+question+" »";
    $("#eai-answer").textContent="BOSS réfléchit…";
    const p=cur();
    const stats=easyDayStats();
    const contexte=`Business : ${p.name}. Métier : ${(BOSS.METIERS[p.metier]||{}).name||"—"}. Aujourd'hui : ${stats.nbV} ventes pour ${stats.ventes} F, ${stats.nbD} dépenses pour ${stats.depenses} F. Solde du jour : ${stats.caisseNette} F.`;
    const prompt=`Tu es BOSS, assistant vocal pour un patron de rapide entreprise en Afrique de l'Ouest. Réponds en français très simple, phrases courtes (moins de 15 mots), sans jargon. Contexte : ${contexte}. Question : ${question}. Réponds en 2-3 phrases maximum.`;
    try{
      const r=await fetch("https://text.pollinations.ai/"+encodeURIComponent(prompt)+"?model=openai");
      const txt=await r.text();
      const clean=String(txt||"").slice(0,500).trim() || "Excuse-moi patron, je n'ai pas compris. Réessaie.";
      $("#eai-answer").textContent=clean;
      EasyMode.speak(clean);
    }catch(e){
      const fb=stats.caisseNette>=0?`Aujourd'hui tu as gagné ${simpleAmount(stats.caisseNette)}. Bien continué !`:`Aujourd'hui tu as perdu ${simpleAmount(-stats.caisseNette)}. Regarde tes dépenses.`;
      $("#eai-answer").textContent=fb; EasyMode.speak(fb);
    }
  }
  const mic=$("#eai-mic");
  if(mic) mic.onclick=()=>{
    mic.classList.add("rec"); mic.textContent="🔴 J'écoute…";
    EasyMode.listen(txt=>ask(txt), ()=>{ mic.classList.remove("rec"); mic.textContent="🎙️ Parler maintenant"; });
  };
  const send=$("#eai-send"); if(send) send.onclick=()=>ask(($("#eai-txt").value||"").trim());
  $("#overlay").classList.add("on"); sheet.classList.add("on");
}

/* Reconnaît quelques nombres écrits en français : mille, deux mille cinq cent, etc. */
function parseFrenchNumber(txt){
  const t=String(txt||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  const mots={zero:0,un:1,une:1,deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10,onze:11,douze:12,treize:13,quatorze:14,quinze:15,seize:16,vingt:20,trente:30,quarante:40,cinquante:50,soixante:60,cent:100,cents:100,mille:1000,million:1000000,millions:1000000};
  const tokens=t.split(/[\s\-]+/).filter(Boolean);
  let total=0, current=0;
  for(const w of tokens){
    if(!(w in mots)) continue;
    const n=mots[w];
    if(n===1000||n===1000000){ current=(current||1)*n; total+=current; current=0; }
    else if(n===100){ current=(current||1)*n; }
    else current+=n;
  }
  return total+current;
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
  IdleLock.start();
  applyMenuCustomization();
  const p=cur();
  if(state.easyMode){
    document.body.classList.add("easy");
    refreshAll(); renderEasyHome(); showView("easy");
  } else if(!p.revenus.length && !p.charges.length && !(p.caisse||[]).length){ startOnboard(); showView("onboard"); }
  else { refreshAll(); showView((p.ui&&p.ui.home)||"dash"); }
  const sn=$("#storage-note"); if(sn) sn.textContent=Store.label();
  // PWA file handler : réception d'un fichier .boss-catalog.json depuis le système
  if("launchQueue" in window){
    try {
      window.launchQueue.setConsumer(async (launchParams)=>{
        if(!launchParams || !launchParams.files || !launchParams.files.length) return;
        try {
          const fh = launchParams.files[0];
          const file = await fh.getFile();
          setTimeout(()=>openCatalogImport(file), 400);
        } catch(e){}
      });
    } catch(e){}
  }
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
