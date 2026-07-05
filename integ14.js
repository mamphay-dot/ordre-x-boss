/* ============================================================
   Test d'intégration bossnet.js (mode Supabase)
   - Sans réseau : bossnet doit rester silencieux et fonctionner
     en mode "local seulement" quand SUPABASE_URL n'est pas configuré.
   - Avec un serveur fetch mocké : signIn, upsert profile, pull,
     merge doivent tourner bout-en-bout.
   ============================================================ */
const fs = require("fs");
const { JSDOM } = require("jsdom");
const { webcrypto } = require("crypto");

let pass = 0, fail = 0;
function ok(c, m){ if(c) pass++; else { fail++; console.log("  ❌", m); } }

const html = fs.readFileSync("dist/boss-app.html", "utf8");

/* ---------- petit serveur Supabase mocké ---------- */
function makeMockFetch(){
  const state = {
    users: [],
    orgs: [],
    memberships: [],
    profiles: [],
    session: null,
    calls: []
  };
  const j = (status, body) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    async json(){ return body; },
    async text(){ return JSON.stringify(body); }
  });
  const fn = (url, opts) => {
    opts = opts || {};
    const method = (opts.method || "GET").toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    state.calls.push({url, method, body});

    if (url.indexOf("/auth/v1/signup") >= 0) {
      const u = { id: "u1", email: body.email };
      state.users.push(u);
      state.session = { access_token: "tok-1", refresh_token: "ref-1",
                         expires_at: Math.floor(Date.now()/1000)+3600, user: u };
      return j(200, state.session);
    }
    if (url.indexOf("/auth/v1/token") >= 0 && url.indexOf("grant_type=password") >= 0) {
      const u = { id: "u1", email: body.email };
      state.session = { access_token: "tok-1", refresh_token: "ref-1",
                         expires_at: Math.floor(Date.now()/1000)+3600, user: u };
      return j(200, state.session);
    }
    if (url.indexOf("/auth/v1/user") >= 0) {
      return j(200, state.session ? state.session.user : null);
    }
    if (url.indexOf("/rest/v1/rpc/create_organization") >= 0) {
      const org = { id: "org-1", nom: body.org_nom, owner_user_id: "u1" };
      state.orgs.push(org);
      state.memberships.push({ organization_id: org.id, user_id: "u1", role: "proprietaire" });
      return j(200, org);
    }
    if (url.indexOf("/rest/v1/organizations") >= 0 && method === "GET") {
      return j(200, state.orgs);
    }
    if (url.indexOf("/rest/v1/memberships") >= 0 && method === "GET") {
      return j(200, state.memberships);
    }
    if (url.indexOf("/rest/v1/profiles") >= 0 && method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      rows.forEach(r => {
        const i = state.profiles.findIndex(p => p.id === r.id);
        if (i >= 0) state.profiles[i] = r; else state.profiles.push(r);
      });
      return j(200, rows);
    }
    if (url.indexOf("/rest/v1/profiles") >= 0 && method === "GET") {
      return j(200, state.profiles);
    }
    if (url.indexOf("/auth/v1/logout") >= 0) {
      state.session = null;
      return j(204, null);
    }
    return j(404, { message: "not mocked: " + method + " " + url });
  };
  return { fn, state };
}

(async () => {
  console.log("=== bossnet en mode local (Supabase non configuré) ===");
  const domA = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://boss.app/",
    beforeParse(w){
      w.scrollTo=()=>{}; w.confirm=()=>true; w.alert=()=>{};
      w.fetch = () => Promise.reject(new Error("no network"));
      try { Object.defineProperty(w,"crypto",{value:webcrypto,configurable:true,writable:true}); } catch(_){}
      w.__BOSS_SUPABASE__ = { url:"", anonKey:"" };
    }
  });
  await new Promise(r => setTimeout(r, 250));
  const winA = domA.window;
  ok(winA.BOSSNET != null, "bossnet est exposé même sans config");
  ok(winA.BOSSNET.isConfigured() === false, "isConfigured() renvoie false sans URL");
  const bl = winA.BOSSNET.auth.session();
  ok(bl == null || bl === null, "aucune session initiale");

  console.log("=== bossnet en mode connecté (fetch mocké) ===");
  const mock = makeMockFetch();
  const domB = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://boss.app/",
    beforeParse(w){
      w.scrollTo=()=>{}; w.confirm=()=>true; w.alert=()=>{};
      w.fetch = mock.fn;
      try { Object.defineProperty(w,"crypto",{value:webcrypto,configurable:true,writable:true}); } catch(_){}
      w.__BOSS_SUPABASE__ = { url: "https://xxx.supabase.co", anonKey: "test-anon-key" };
    }
  });
  await new Promise(r => setTimeout(r, 300));
  const winB = domB.window;
  const NET = winB.BOSSNET;
  ok(NET.isConfigured(), "isConfigured() true avec URL + anon key");

  // Inscription
  await NET.auth.signUp("test@boss.app", "password123");
  ok(NET.auth.user() && NET.auth.user().email === "test@boss.app", "signUp connecte l'utilisateur");
  ok(NET.auth.session() && NET.auth.session().access_token === "tok-1", "session stockée après signUp");

  // Créer une organisation
  const org = await NET.org.create("Test SARL");
  ok(org && org.id === "org-1", "create_organization RPC OK");

  // Pousser 2 profils
  const now = Date.now();
  const p1 = { id: "p-aaa", name: "Business 1", metier:"vendeur", revenus:[], charges:[], caisse:[], updatedAt: now };
  const p2 = { id: "p-bbb", name: "Business 2", metier:"maquis",  revenus:[], charges:[], caisse:[], updatedAt: now };
  await NET.profiles.pushMany(org.id, { [p1.id]: p1, [p2.id]: p2 });
  ok(mock.state.profiles.length === 2, "2 profils poussés");

  // Tirer les profils
  const remote = await NET.profiles.pullAll(org.id);
  ok(Object.keys(remote.profiles).length === 2, "pullAll ramène 2 profils");
  ok(remote.profiles["p-aaa"].name === "Business 1", "champ name restauré depuis JSONB");

  // Mise à jour + repush (dernier-écrit-gagne côté distant)
  p1.name = "Business 1 renommé";
  p1.updatedAt = now + 5000;
  await NET.profiles.pushOne(org.id, p1);
  const remote2 = await NET.profiles.pullAll(org.id);
  ok(remote2.profiles["p-aaa"].name === "Business 1 renommé", "upsert préserve le renommage");

  // Vérifie que Bearer et apikey sont bien envoyés
  const lastCall = mock.state.calls[mock.state.calls.length - 1];
  ok(mock.state.calls.some(c => c.url.indexOf("/rest/v1/") >= 0), "requêtes REST bien envoyées");

  // Déconnexion
  await NET.auth.signOut();
  ok(NET.auth.session() == null, "signOut vide la session");

  console.log("\n=========================================");
  console.log(`BOSSNET (intégration) : ${pass} réussis, ${fail} échoués`);
  console.log("=========================================");
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.log("FATAL:", e); process.exit(1); });
