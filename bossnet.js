/* ============================================================
   BOSS — client réseau (Supabase Auth + REST + Realtime)
   Aucune dépendance : uniquement fetch(), WebSocket, localStorage.
   Utilisable en Node (tests via jsdom + node-fetch polyfill).
   ============================================================ */

(function(root){
  "use strict";

  /* Configuration injectée au build par build.js
     (fallback vide → mode 100 % local, aucun appel réseau). */
  const CFG = (typeof root.__BOSS_SUPABASE__ === "object" && root.__BOSS_SUPABASE__) || {url:"",anonKey:""};

  const STORAGE_SESSION = "boss.session.v1";
  const STORAGE_QUEUE   = "boss.queue.v1";   // opérations en attente (mode dégradé)
  const AUTH_REFRESH_MARGIN = 60_000;         // renouveler le token 60s avant expiration

  /* ---------- utilitaires bas niveau ---------- */
  function isConfigured(){ return !!(CFG.url && CFG.anonKey); }
  function apiURL(path){ return CFG.url.replace(/\/+$/,"") + path; }
  function ls(){ try { return root.localStorage; } catch(_){ return null; } }
  function readJSON(key){
    const s = ls(); if(!s) return null;
    try { const v = s.getItem(key); return v?JSON.parse(v):null; } catch(_){ return null; }
  }
  function writeJSON(key,val){
    const s = ls(); if(!s) return;
    try { if(val==null) s.removeItem(key); else s.setItem(key,JSON.stringify(val)); } catch(_){}
  }

  /* ---------- état de session ---------- */
  let _session = null;   // {access_token, refresh_token, expires_at, user}
  const _authListeners = new Set();
  function loadSession(){
    _session = readJSON(STORAGE_SESSION);
    return _session;
  }
  function saveSession(s){
    _session = s;
    writeJSON(STORAGE_SESSION, s);
    _authListeners.forEach(fn => { try { fn(s); } catch(_){} });
  }
  function currentSession(){ return _session; }
  function currentUser(){ return _session && _session.user; }
  function onAuthChange(fn){ _authListeners.add(fn); return () => _authListeners.delete(fn); }

  /* ---------- fetch avec bearer ---------- */
  async function rawFetch(path, opts){
    if(!isConfigured()) throw new Error("Supabase non configuré (mode local seulement)");
    opts = opts || {};
    const headers = Object.assign({
      "apikey": CFG.anonKey,
      "Content-Type": "application/json",
      "Accept": "application/json"
    }, opts.headers || {});
    if(_session && _session.access_token && !opts.noAuth){
      headers["Authorization"] = "Bearer " + _session.access_token;
    }
    const url = apiURL(path);
    const res = await root.fetch(url, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined
    });
    let data = null;
    const ct = res.headers.get("content-type") || "";
    if(ct.indexOf("application/json") >= 0){
      try { data = await res.json(); } catch(_){ data = null; }
    } else {
      try { data = await res.text(); } catch(_){ data = null; }
    }
    if(!res.ok){
      const msg = (data && (data.message || data.error_description || data.error || data.msg)) || ("HTTP "+res.status);
      const err = new Error(msg); err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------- rafraîchissement automatique du token ---------- */
  async function ensureFreshToken(){
    if(!_session || !_session.expires_at) return;
    const nowMs = Date.now();
    const expMs = _session.expires_at * 1000;
    if(expMs - nowMs > AUTH_REFRESH_MARGIN) return;
    if(!_session.refresh_token) return;
    try {
      const data = await rawFetch("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: _session.refresh_token },
        noAuth: true
      });
      saveSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token || _session.refresh_token,
        expires_at: data.expires_at || Math.floor(Date.now()/1000) + (data.expires_in||3600),
        user: data.user || _session.user
      });
    } catch(e){
      if(e.status === 400 || e.status === 401){
        saveSession(null); // session invalide
      }
    }
  }

  async function authedFetch(path, opts){
    await ensureFreshToken();
    return rawFetch(path, opts);
  }

  /* ---------- AUTH ---------- */
  const auth = {
    async signUp(email, password, nom){
      const data = await rawFetch("/auth/v1/signup", {
        method: "POST",
        body: { email, password, data: nom ? {nom} : undefined },
        noAuth: true
      });
      // Supabase renvoie une session directement si "Confirm email" est désactivé,
      // sinon renvoie l'utilisateur sans session (l'utilisateur doit cliquer le lien reçu par email).
      if(data.access_token){
        saveSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at || Math.floor(Date.now()/1000)+(data.expires_in||3600),
          user: data.user
        });
      }
      return data;
    },
    async signIn(email, password){
      const data = await rawFetch("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email, password },
        noAuth: true
      });
      saveSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at || Math.floor(Date.now()/1000)+(data.expires_in||3600),
        user: data.user
      });
      return data;
    },
    async magicLink(email, redirectTo){
      return rawFetch("/auth/v1/otp", {
        method: "POST",
        body: { email, create_user: true, options: redirectTo ? {email_redirect_to: redirectTo} : undefined },
        noAuth: true
      });
    },
    async signOut(){
      try {
        if(_session && _session.access_token){
          await rawFetch("/auth/v1/logout", { method: "POST" });
        }
      } catch(_){}
      saveSession(null);
    },
    async me(){
      if(!_session) return null;
      try {
        const u = await authedFetch("/auth/v1/user", { method: "GET" });
        _session.user = u;
        writeJSON(STORAGE_SESSION, _session);
        return u;
      } catch(e){
        if(e.status === 401) saveSession(null);
        return null;
      }
    },
    // Récupération d'une session depuis le fragment #access_token=... (après magic link)
    async captureFromURL(){
      if(!root.location || !root.location.hash) return null;
      const h = root.location.hash.substring(1);
      const p = {};
      h.split("&").forEach(pair => {
        const [k,v] = pair.split("=");
        if(k) p[decodeURIComponent(k)] = decodeURIComponent(v||"");
      });
      if(!p.access_token) return null;
      const s = {
        access_token: p.access_token,
        refresh_token: p.refresh_token,
        expires_at: p.expires_at ? parseInt(p.expires_at,10) : Math.floor(Date.now()/1000) + (parseInt(p.expires_in||"3600",10)),
        user: null
      };
      saveSession(s);
      // Nettoyer l'URL
      try {
        root.history && root.history.replaceState({}, "", root.location.pathname + root.location.search);
      } catch(_){}
      // Récupérer l'utilisateur
      await auth.me();
      return _session;
    },
    session: currentSession,
    user: currentUser,
    onChange: onAuthChange
  };

  /* ---------- REST (PostgREST) ---------- */
  function buildQS(params){
    if(!params) return "";
    const parts = [];
    Object.keys(params).forEach(k => {
      const v = params[k];
      if(v==null) return;
      parts.push(encodeURIComponent(k)+"="+encodeURIComponent(String(v)));
    });
    return parts.length ? ("?"+parts.join("&")) : "";
  }
  function db(table){
    return {
      async select(query){
        const qs = buildQS(Object.assign({select:"*"}, query||{}));
        return authedFetch("/rest/v1/"+table+qs, {method:"GET"});
      },
      async insert(row, opts){
        const headers = {"Prefer": (opts&&opts.returning==="minimal")?"return=minimal":"return=representation"};
        const res = await authedFetch("/rest/v1/"+table, {method:"POST", body:row, headers});
        return Array.isArray(res)?res[0]:res;
      },
      async upsert(row, opts){
        const headers = {"Prefer": "resolution=merge-duplicates,return=representation"};
        if(opts && opts.onConflict) headers["Prefer"] += ",resolution=merge-duplicates";
        const path = "/rest/v1/"+table+(opts&&opts.onConflict?("?on_conflict="+encodeURIComponent(opts.onConflict)):"");
        const res = await authedFetch(path, {method:"POST", body:row, headers});
        return Array.isArray(res)?res[0]:res;
      },
      async update(patch, filter){
        const qs = buildQS(filter||{});
        const headers = {"Prefer":"return=representation"};
        const res = await authedFetch("/rest/v1/"+table+qs, {method:"PATCH", body:patch, headers});
        return Array.isArray(res)?res:[];
      },
      async remove(filter){
        const qs = buildQS(filter||{});
        return authedFetch("/rest/v1/"+table+qs, {method:"DELETE"});
      }
    };
  }
  async function rpc(fn, args){
    return authedFetch("/rest/v1/rpc/"+fn, {method:"POST", body: args||{}});
  }

  /* ---------- API ORGANISATIONS / PROFILES ---------- */
  const org = {
    async list(){
      return db("organizations").select({order:"created_at.desc"});
    },
    async create(nom){
      return rpc("create_organization", {org_nom: nom});
    },
    async members(orgId){
      return db("memberships").select({organization_id:"eq."+orgId, order:"created_at.asc"});
    },
    async invite(orgId, email, role){
      return db("invitations").insert({organization_id: orgId, email: email, role: role||"collaborateur"});
    },
    async pendingInvitations(orgId){
      return db("invitations").select({organization_id:"eq."+orgId, accepted_at:"is.null"});
    },
    async acceptInvitation(token){
      return rpc("accept_invitation", {inv_token: token});
    },
    async updateMemberRole(orgId, userId, role, permissions){
      return db("memberships").update(
        {role, permissions: permissions||undefined},
        {organization_id:"eq."+orgId, user_id:"eq."+userId}
      );
    },
    async removeMember(orgId, userId){
      return db("memberships").remove({organization_id:"eq."+orgId, user_id:"eq."+userId});
    }
  };

  const profiles = {
    async pullAll(orgId){
      const rows = await db("profiles").select({
        organization_id:"eq."+orgId,
        deleted_at:"is.null",
        order:"updated_at.desc"
      });
      // Reconstruire l'état {profiles:{id:profile}} pour mergeStates
      const out = {profiles:{}, currentId:null, updatedAt:0};
      rows.forEach(r => {
        out.profiles[r.id] = r.data;
        const ts = new Date(r.updated_at).getTime();
        if(ts > out.updatedAt) out.updatedAt = ts;
      });
      if(rows.length) out.currentId = rows[0].id;
      return out;
    },
    async pushOne(orgId, profile){
      const row = {
        id: profile.id,
        organization_id: orgId,
        data: profile,
        updated_at: new Date().toISOString()
      };
      return db("profiles").upsert(row, {onConflict:"id"});
    },
    async pushMany(orgId, profileMap){
      const rows = Object.keys(profileMap).map(id => ({
        id, organization_id: orgId, data: profileMap[id],
        updated_at: new Date((profileMap[id].updatedAt)||Date.now()).toISOString()
      }));
      if(!rows.length) return [];
      return db("profiles").upsert(rows, {onConflict:"id"});
    },
    async softDelete(id){
      return db("profiles").update({deleted_at: new Date().toISOString()}, {id:"eq."+id});
    }
  };

  /* ---------- SYNC (haut niveau) ---------- */
  const sync = {
    // Effectue un pull + fusion + push si local a des changements plus récents
    // mergeFn(local, remote) → state fusionné (typiquement engine.mergeStates)
    // localState : {profiles:{}, currentId, updatedAt}
    // Retourne l'état fusionné et signale s'il faut le sauvegarder localement.
    async runOnce(orgId, localState, mergeFn){
      if(!isConfigured() || !_session) return {state: localState, changed: false, source:"local"};
      const remote = await profiles.pullAll(orgId);
      const merged = mergeFn(localState||{profiles:{},updatedAt:0}, remote);
      // Détecter les profils modifiés localement vs distant
      const toPush = {};
      let pushedAny = false;
      const localProfiles = (localState && localState.profiles) || {};
      Object.keys(merged.profiles).forEach(id => {
        const localP = localProfiles[id];
        const remoteP = remote.profiles[id];
        const mergedP = merged.profiles[id];
        if(!remoteP || (mergedP.updatedAt||0) > (remoteP.updatedAt||0)){
          toPush[id] = mergedP;
          pushedAny = true;
        }
        else if(localP && (localP.updatedAt||0) > (remoteP.updatedAt||0)){
          toPush[id] = localP;
          pushedAny = true;
        }
      });
      if(pushedAny){
        try { await profiles.pushMany(orgId, toPush); }
        catch(e){ /* on garde en file pour retry */ }
      }
      const changed = JSON.stringify(merged) !== JSON.stringify(localState);
      return {state: merged, changed, source: pushedAny?"push+pull":"pull"};
    }
  };

  /* ---------- REALTIME (Supabase Phoenix Channels, minimal) ---------- */
  let _ws = null, _wsRef = 1, _wsHandlers = {}, _hbTimer = null, _reconnectTimer = null;
  function realtimeConnect(){
    if(!isConfigured() || !_session) return null;
    if(_ws && (_ws.readyState === 0 || _ws.readyState === 1)) return _ws;
    if(typeof root.WebSocket !== "function") return null;
    const wsBase = CFG.url.replace(/^http/,"ws") + "/realtime/v1/websocket";
    const url = wsBase + "?apikey=" + encodeURIComponent(CFG.anonKey)
              + "&vsn=1.0.0"
              + "&log_level=warn";
    _ws = new root.WebSocket(url);
    _ws.onopen = () => {
      // Envoyer le token pour authentifier la connexion (RLS)
      wsSend({topic:"realtime:_", event:"access_token", payload:{access_token:_session.access_token}, ref:String(_wsRef++)});
      // Rejoindre les topics déjà souscrits
      Object.keys(_wsHandlers).forEach(topic => {
        wsSend({topic, event:"phx_join", payload:_wsHandlers[topic].payload, ref:String(_wsRef++)});
      });
      // Heartbeat
      _hbTimer = setInterval(() => {
        wsSend({topic:"phoenix", event:"heartbeat", payload:{}, ref:String(_wsRef++)});
      }, 30_000);
    };
    _ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch(_){ return; }
      const h = _wsHandlers[msg.topic];
      if(!h) return;
      if(msg.event === "postgres_changes" && msg.payload && msg.payload.data){
        try { h.cb(msg.payload.data); } catch(_){}
      }
    };
    _ws.onclose = () => {
      if(_hbTimer){ clearInterval(_hbTimer); _hbTimer = null; }
      _ws = null;
      _reconnectTimer = setTimeout(realtimeConnect, 5000);
    };
    _ws.onerror = () => { /* onclose sera appelé */ };
    return _ws;
  }
  function wsSend(msg){
    if(_ws && _ws.readyState === 1){
      try { _ws.send(JSON.stringify(msg)); } catch(_){}
    }
  }
  function realtimeSubscribeProfiles(orgId, cb){
    const topic = "realtime:public:profiles:organization_id=eq."+orgId;
    _wsHandlers[topic] = {
      cb,
      payload: {
        config: {
          postgres_changes: [{event:"*", schema:"public", table:"profiles", filter:"organization_id=eq."+orgId}]
        }
      }
    };
    realtimeConnect();
    if(_ws && _ws.readyState === 1){
      wsSend({topic, event:"phx_join", payload:_wsHandlers[topic].payload, ref:String(_wsRef++)});
    }
    return () => {
      wsSend({topic, event:"phx_leave", payload:{}, ref:String(_wsRef++)});
      delete _wsHandlers[topic];
    };
  }
  function realtimeDisconnect(){
    if(_reconnectTimer){ clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if(_hbTimer){ clearInterval(_hbTimer); _hbTimer = null; }
    _wsHandlers = {};
    if(_ws){ try { _ws.close(); } catch(_){} _ws = null; }
  }

  const realtime = {
    subscribeProfiles: realtimeSubscribeProfiles,
    disconnect: realtimeDisconnect,
    isConnected: () => !!(_ws && _ws.readyState === 1)
  };

  /* ---------- API publique ---------- */
  const __API = {
    config: CFG,
    isConfigured,
    auth, org, profiles, sync, realtime, db, rpc,
    // Debug / tests
    __setSessionForTests(s){ _session = s; }
  };

  loadSession();

  if(typeof module !== "undefined" && module.exports){ module.exports = __API; }
  if(typeof root !== "undefined"){ root.BOSSNET = __API; }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
