/* ============================================================
   BOSS — moteur logique (pur, testable)
   Aucune dépendance. Utilisable en Node (tests) et en navigateur.
   ============================================================ */

const METIERS = {
  maquis:{ic:"🍗",name:"Maquis",unite:"plats & boissons",
    kw:["maquis","poulet","braisé","braise","attiéké","attieke","alloco","bière","biere","boisson","restaurant","resto","grillade","poisson braisé","kedjenou","garba"],
    ex:"poulet braisé",
    revenus:[{nom:"Poulet braisé",prix:3000,qte:300,cout:1500},{nom:"Attiéké poisson",prix:2000,qte:250,cout:900},{nom:"Boissons / bières",prix:1000,qte:800,cout:600}],
    charges:[{nom:"Loyer",montant:150000},{nom:"Salaires",montant:250000},{nom:"Électricité",montant:60000},{nom:"Gaz & charbon",montant:40000}]},
  hotel:{ic:"🏨",name:"Hôtel",unite:"nuitées & couverts",
    kw:["hotel","hôtel","chambre","nuitée","nuitee","auberge","résidence","residence","réception","hébergement","hebergement","client qui dort"],
    ex:"chambre standard",
    revenus:[{nom:"Chambre standard",prix:25000,qte:180,cout:5000},{nom:"Chambre VIP",prix:40000,qte:40,cout:8000},{nom:"Restauration",prix:8000,qte:200,cout:3500}],
    charges:[{nom:"Loyer / bâtiment",montant:800000},{nom:"Salaires",montant:1200000},{nom:"Électricité",montant:400000},{nom:"Sécurité",montant:150000}]},
  industrie:{ic:"🏭",name:"Industrie",unite:"lots & cartons",
    kw:["usine","industrie","fabrique","fabrication","production","produire","carton","lot","manufacture","ligne de production","fabricant"],
    ex:"carton de produit",
    revenus:[{nom:"Carton de jus (12)",prix:12000,qte:1500,cout:7000},{nom:"Sous-produits / vrac",prix:2000,qte:300,cout:800}],
    charges:[{nom:"Loyer usine",montant:1500000},{nom:"Salaires ouvriers",montant:3000000},{nom:"Électricité",montant:1200000},{nom:"Maintenance",montant:400000}]},
  enseignant:{ic:"📚",name:"Enseignant",unite:"heures de cours",
    kw:["cours","enseigne","enseignant","prof","professeur","répétiteur","repetiteur","élève","eleve","formation","leçon","lecon","école","ecole","tutorat","encadrement"],
    ex:"cours particulier",
    revenus:[{nom:"Cours particulier (1h)",prix:5000,qte:80,cout:0},{nom:"Cours en groupe (/élève)",prix:2000,qte:200,cout:200},{nom:"Pack BAC",prix:50000,qte:6,cout:2000}],
    charges:[{nom:"Transport",montant:60000},{nom:"Téléphone & internet",montant:25000},{nom:"Supports & photocopies",montant:30000}]},
  couturier:{ic:"🧵",name:"Couturier",unite:"pièces & commandes",
    kw:["couture","couturier","couturière","tenue","tissu","mesure","tailleur","habit","robe sur mesure","brodeur","brode","atelier couture","modéliste"],
    ex:"tenue sur mesure",
    revenus:[{nom:"Tenue sur mesure",prix:35000,qte:40,cout:15000},{nom:"Retouches",prix:5000,qte:60,cout:500},{nom:"Uniformes (lot)",prix:20000,qte:30,cout:9000}],
    charges:[{nom:"Atelier",montant:100000},{nom:"Apprenti",montant:80000},{nom:"Électricité",montant:30000}]},
  eleveur:{ic:"🐔",name:"Éleveur",unite:"têtes & produits",
    kw:["élevage","elevage","éleveur","eleveur","volaille","poule","cheptel","bœuf","boeuf","mouton","chèvre","chevre","poussin","ferme","poulailler","œuf","oeuf","bétail","betail"],
    ex:"poulet de chair",
    revenus:[{nom:"Poulets",prix:3500,qte:500,cout:2200},{nom:"Plateaux d'œufs",prix:2500,qte:600,cout:1500}],
    charges:[{nom:"Loyer ferme",montant:100000},{nom:"Ouvrier",montant:120000},{nom:"Eau & électricité",montant:80000},{nom:"Vétérinaire & vaccins",montant:60000}]},
  mecanicien:{ic:"🔧",name:"Mécanicien",unite:"interventions",
    kw:["mécanicien","mecanicien","garage","vidange","moteur","répare","repare","réparation","reparation","pièce","piece","frein","embrayage","auto","moto","véhicule","vehicule","mécanique","mecanique"],
    ex:"vidange",
    revenus:[{nom:"Vidange",prix:8000,qte:120,cout:4000},{nom:"Réparation moteur",prix:50000,qte:25,cout:30000},{nom:"Diagnostic",prix:5000,qte:80,cout:0}],
    charges:[{nom:"Garage / loyer",montant:120000},{nom:"Apprenti",montant:70000},{nom:"Électricité",montant:40000},{nom:"Outillage",montant:50000}]},
  transformateur:{ic:"⚙️",name:"Transformateur",unite:"sachets & bidons",
    kw:["transforme","transformation","transformateur","jus","savon","farine","beurre de karité","karité","karite","attiéké production","huile","séchage","sechage","conditionne"],
    ex:"sachet de produit",
    revenus:[{nom:"Sachet d'attiéké",prix:500,qte:3000,cout:250},{nom:"Bidon jus gingembre",prix:2500,qte:400,cout:1300}],
    charges:[{nom:"Local",montant:80000},{nom:"Main d'œuvre",montant:200000},{nom:"Eau & énergie",montant:100000},{nom:"Emballages",montant:60000}]},
  producteur:{ic:"🌾",name:"Producteur",unite:"sacs & kg",
    kw:["champ","récolte","recolte","cultive","culture","agriculteur","planteur","tomate","piment","igname","manioc","cacao","café","cafe","maraîcher","maraicher","semence","parcelle","plantation"],
    ex:"sac de récolte",
    revenus:[{nom:"Sac de tomates",prix:15000,qte:200,cout:7000},{nom:"Sac de piment",prix:25000,qte:60,cout:10000}],
    charges:[{nom:"Location terrain",montant:50000},{nom:"Main d'œuvre",montant:150000},{nom:"Irrigation",montant:40000},{nom:"Engrais",montant:80000}]},
  vendeur:{ic:"🛍️",name:"Vendeur",unite:"articles",
    kw:["vends","vend","vente","boutique","commerce","commerçant","commercant","article","revend","détail","detail","whatsapp","cosmétique","cosmetique","prêt-à-porter","pret-a-porter","chaussure","sac","magasin","étal","etal"],
    ex:"article",
    revenus:[{nom:"Robes / prêt-à-porter",prix:15000,qte:120,cout:9000},{nom:"Cosmétiques",prix:8000,qte:200,cout:5000},{nom:"Accessoires",prix:3000,qte:150,cout:1500}],
    charges:[{nom:"Boutique / stockage",montant:80000},{nom:"Livreur",montant:100000},{nom:"Data & pub",montant:50000}]}
};

const METIER_ORDER = ["vendeur","maquis","hotel","industrie","enseignant","couturier","eleveur","mecanicien","transformateur","producteur"];

/* ---------- détection du métier ---------- */
function normalize(s){return (s||"").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
function detectMetier(text){
  const t = normalize(text);
  let best=null, bestScore=0;
  for(const key of METIER_ORDER){
    const m=METIERS[key];
    let score=0;
    const seen=new Set();
    for(const k of m.kw){
      const nk=normalize(k);
      if(seen.has(nk)) continue;   // évite le double comptage des doublons
      seen.add(nk);
      if(t.includes(nk)) score += nk.length>5?2:1;
    }
    if(score>bestScore){bestScore=score;best=key;}
  }
  return bestScore>0?best:null;
}

/* ---------- extraction des montants ---------- */
function parseAmounts(text){
  if(!text) return [];
  let t=String(text).toLowerCase();
  const out=[];
  // motifs "3k", "150k"
  const kRe=/(\d+(?:[.,]\d+)?)\s*k\b/g; let mk;
  while((mk=kRe.exec(t))){ out.push(Math.round(parseFloat(mk[1].replace(",","."))*1000)); }
  t=t.replace(kRe," ");
  // nombres avec séparateurs d'espace ou point comme milliers : 150 000 / 150.000 / 1 500
  const numRe=/\d[\d \u00a0.]*\d|\d/g; let m;
  while((m=numRe.exec(t))){
    let raw=m[0];
    // si point suivi d'exactement 3 chiffres répétés => séparateur milliers
    let cleaned=raw.replace(/[ \u00a0]/g,"");
    if(/^\d{1,3}(\.\d{3})+$/.test(cleaned)) cleaned=cleaned.replace(/\./g,"");
    else cleaned=cleaned.replace(/\./g,"");
    const v=parseInt(cleaned,10);
    if(!isNaN(v)) out.push(v);
  }
  return out;
}
function extractName(text){
  // retire montants, mots-outils, garde un nom court
  let t=String(text||"");
  t=t.replace(/(\d+(?:[.,]\d+)?\s*k\b)/gi," ");
  t=t.replace(/\d[\d \u00a0.,]*/g," ");
  t=t.replace(/\b(je|j'|vends|vend|le|la|les|un|une|des|à|a|et|de|du|pour|c'est|ca|ça|coute|coûte|coûte|environ|fcfa|f|francs?|par|mois|prix|cout|coût)\b/gi," ");
  t=t.replace(/[.,;:!?]/g," ").replace(/\s+/g," ").trim();
  if(!t) return "";
  return t.charAt(0).toUpperCase()+t.slice(1);
}

/* ---------- MOTEUR FINANCIER ---------- */
function computeFinancials(profile){
  const revenus=profile.revenus||[], charges=profile.charges||[];
  const target=(profile.target!=null?profile.target:30)/100;
  let ca=0,coutsDirects=0,qteTot=0;
  revenus.forEach(r=>{ca+=(r.prix||0)*(r.qte||0);coutsDirects+=(r.cout||0)*(r.qte||0);qteTot+=(r.qte||0);});
  const margeBrute=ca-coutsDirects;
  const cf=charges.reduce((s,c)=>s+(c.montant||0),0);
  const net=margeBrute-cf;
  const tauxMB=ca>0?margeBrute/ca:0;
  const tauxNet=ca>0?net/ca:0;
  const seuilCA=tauxMB>0?cf/tauxMB:0;
  const partCharge=qteTot>0?cf/qteTot:0;
  const prices=revenus.filter(r=>(r.qte>0||r.prix>0)).map(r=>{
    const coutComplet=(r.cout||0)+partCharge;
    const prixConseille=target<1?coutComplet/(1-target):coutComplet;
    const margeActuelle=r.prix>0?(r.prix-coutComplet)/r.prix:-1;
    let verdict="ok";
    if(r.prix<coutComplet)verdict="bad";
    else if(margeActuelle<target-0.05)verdict="low";
    return {nom:r.nom,coutComplet,prixConseille,margeActuelle,verdict};
  });
  return {ca,coutsDirects,margeBrute,cf,net,tauxMB,tauxNet,seuilCA,qteTot,prices};
}

function coachInsights(profile){
  const d=computeFinancials(profile);
  const items=[];
  const revenus=profile.revenus||[];
  if(d.ca<=0){items.push({ic:"⚠️",txt:"Ajoute au moins une vente pour que je calcule ton business."});return {d,items};}
  items.push({ic:"💡",txt:`Ton argent réel après tout payer, c'est ${fmtF(d.net)} — pas tes ${fmtF(d.ca)} de ventes.`});
  if(d.net<0) items.push({ic:"🔴",txt:`Tu es en perte. Vends plus, ou réduis tes charges de ${fmtF(-d.net)}.`});
  const wm=revenus.filter(r=>r.qte>0&&r.prix>0).map(r=>({nom:r.nom,m:(r.prix-r.cout)/r.prix,vol:(r.prix-r.cout)*r.qte}));
  if(wm.length){
    const best=[...wm].sort((a,b)=>b.vol-a.vol)[0];
    const worst=[...wm].sort((a,b)=>a.m-b.m)[0];
    items.push({ic:"🏆",txt:`${best.nom} est ta meilleure marge : ${fmtF(best.vol)}/mois. Mets-en plus en avant.`});
    if(worst.m<0) items.push({ic:"🔴",txt:`Tu vends ${worst.nom} à perte. Chaque unité coûte plus qu'elle ne rapporte.`});
    else if(worst.m<0.15&&wm.length>1) items.push({ic:"🟡",txt:`${worst.nom} ne laisse que ${Math.round(worst.m*100)} % de marge. Monte le prix ou baisse le coût.`});
  }
  if(d.ca>0&&d.cf/d.ca>0.5) items.push({ic:"🟡",txt:`Tes charges fixes mangent ${Math.round(d.cf/d.ca*100)} % de tes ventes. Surveille loyer et salaires.`});
  if(d.net>0&&d.tauxNet>=0.2) items.push({ic:"✅",txt:`Belle santé : tu gardes ${Math.round(d.tauxNet*100)} % de chaque vente. Pense à investir.`});
  return {d,items};
}

function fmtF(n){return Math.round(n).toLocaleString("fr-FR")+" F";}

/* ---------- MACHINE CONVERSATIONNELLE (auto-config) ---------- */
function startConversation(){
  return {step:"start", tries:0};
}
// retourne {bot, events:[], done, patch:{metier?,unite?,addRevenu?,setQteLast?,addCharge?,setName?}}
function conversationStep(conv, userText, profile){
  const ev=[]; let bot="", done=false; const patch={};
  const amounts=parseAmounts(userText);

  switch(conv.step){
    case "start": {
      const met=detectMetier(userText);
      if(met){
        const m=METIERS[met];
        patch.metier=met; patch.unite=m.unite; patch.reset=true;
        ev.push(`Métier détecté : ${m.name}`);
        conv.step="product_price"; conv.metier=met;
        bot=`Parfait ${m.ic} Dis-moi ton produit principal : tu le vends combien, et il te coûte combien ?`;
      } else {
        conv.tries++;
        if(conv.tries>=2){
          patch.metier="vendeur"; patch.unite=METIERS.vendeur.unite; patch.reset=true; conv.metier="vendeur";
          ev.push("Métier par défaut : Vendeur");
          conv.step="product_price";
          bot="Pas de souci, je pars sur un commerce de vente 🛍️ Ton produit principal : prix de vente et coût ?";
        } else {
          bot="Dis-moi simplement : tu vends quoi ? (ex. « je vends du poulet braisé », « je répare des motos », « je couds des tenues »)";
        }
      }
      break;
    }
    case "product_price": {
      const name=extractName(userText)|| (METIERS[conv.metier]?METIERS[conv.metier].ex:"Produit");
      conv.lastName=name;
      if(amounts.length>=2){
        const prix=Math.max(amounts[0],amounts[1]); const cout=Math.min(amounts[0],amounts[1]);
        patch.addRevenu={nom:name,prix,qte:0,cout};
        const marge=prix>0?Math.round((prix-cout)/prix*100):0;
        ev.push(`Produit ajouté · marge ${marge}%`);
        conv.step="product_qty";
        bot=`Noté 👍 « ${name} » à ${fmtF(prix)}. Tu en vends combien par mois à peu près ?`;
      } else if(amounts.length===1){
        conv.pendingPrice=amounts[0];
        conv.step="product_cost";
        bot=`D'accord, ${fmtF(amounts[0])}. Et ça te coûte combien à produire / acheter ?`;
      } else {
        bot="Donne-moi un prix, par exemple « 3000 la part, ça me coûte 1500 ».";
      }
      break;
    }
    case "product_cost": {
      const cout=amounts.length?amounts[0]:0;
      const prix=conv.pendingPrice||0;
      const name=conv.lastName||"Produit";
      patch.addRevenu={nom:name,prix,qte:0,cout};
      const marge=prix>0?Math.round((prix-cout)/prix*100):0;
      ev.push(`Produit ajouté · marge ${marge}%`);
      conv.step="product_qty";
      bot=`Bien 👍 Tu vends combien de « ${name} » par mois ?`;
      break;
    }
    case "product_qty": {
      const qte=amounts.length?amounts[0]:0;
      patch.setQteLast=qte;
      ev.push(`Volume enregistré : ${qte}/mois`);
      conv.step="more";
      bot="Tu vends autre chose ? (oui / non)";
      break;
    }
    case "more": {
      const t=normalize(userText);
      if(/\b(oui|ouais|yes|ouai|si|bien sur|encore|autre)\b/.test(t)){
        conv.step="product_price";
        bot="Vas-y : c'est quoi, à quel prix, et quel coût ? (ex. « les boissons à 1000, ça me coûte 600 »)";
      } else {
        conv.step="rent";
        bot="Parlons des charges. Ton loyer, c'est combien par mois ? (mets 0 si tu n'en as pas)";
      }
      break;
    }
    case "rent": {
      const v=amounts.length?amounts[0]:0;
      if(v>0){patch.addCharge={nom:"Loyer",montant:v};ev.push("Charge : Loyer enregistré");}
      conv.step="charges";
      bot="D'autres charges chaque mois ? (salaires, électricité, transport…) Donne-moi les montants, ou dis « non ».";
      break;
    }
    case "charges": {
      const t=normalize(userText);
      if(amounts.length && !/\bnon\b/.test(t)){
        const labels=["Salaires","Électricité","Eau","Transport","Divers","Autres"];
        amounts.forEach((v,i)=>{ if(v>0){patch.addChargeMulti=patch.addChargeMulti||[]; patch.addChargeMulti.push({nom:labels[i]||"Autres",montant:v});} });
        ev.push(`${amounts.length} charge(s) enregistrée(s)`);
      }
      // calcul du seuil pour le message final
      conv.step="done"; done=true;
      bot="__SUMMARY__"; // remplacé par l'UI avec le seuil réel
      break;
    }
    default:
      done=true; bot="C'est bon BOSS, ton business est prêt ✅";
  }
  return {bot, events:ev, done, patch};
}

/* ---------- application d'un patch sur un profil ---------- */
function applyPatch(profile, patch){
  if(!patch) return profile;
  if(patch.reset){ profile.revenus=[]; profile.charges=[]; }
  if(patch.metier){ profile.metier=patch.metier; }
  if(patch.unite){ profile.unite=patch.unite; }
  if(patch.addRevenu){ profile.revenus.push({...patch.addRevenu}); }
  if(patch.setQteLast!=null && profile.revenus.length){ profile.revenus[profile.revenus.length-1].qte=patch.setQteLast; }
  if(patch.addCharge){ profile.charges.push({...patch.addCharge}); }
  if(patch.addChargeMulti){ patch.addChargeMulti.forEach(c=>profile.charges.push({...c})); }
  return profile;
}

let __bossSeq=0;
function uid(){ __bossSeq++; return "p"+Date.now().toString(36)+"-"+__bossSeq.toString(36)+"-"+Math.floor(Math.random()*1e6).toString(36); }

function blankProfile(name){
  return {id:uid(), name:name||"Mon business", metier:"vendeur", unite:METIERS.vendeur.unite, revenus:[], charges:[], caisse:[], carnet:[], clients:[], commandes:[], pieces:[], catalogues:[], collaborateurs:[], caisses:[{id:"k-principale",nom:"Caisse principale"}], identite:{logo:null,rccm:"",ncc:"",adresse:"",tel:"",email:"",slogan:"",mentions:""}, tresorerie:{soldes:{especes:0,banque:0,mobile:0}}, tva:{enabled:false,rate:18,pricesIncludeTax:true}, pay:{}, target:30, updatedAt:Date.now()};
}
function presetProfile(metier, name){
  const m=METIERS[metier];
  return {id:uid(), name:name||m.name, metier, unite:m.unite,
    revenus:m.revenus.map(r=>({...r})), charges:m.charges.map(c=>({...c})), caisse:[], carnet:[], clients:[], commandes:[], pieces:[], catalogues:[], collaborateurs:[], caisses:[{id:"k-principale",nom:"Caisse principale"}], identite:{logo:null,rccm:"",ncc:"",adresse:"",tel:"",email:"",slogan:"",mentions:""}, tresorerie:{soldes:{especes:0,banque:0,mobile:0}}, tva:{enabled:false,rate:18,pricesIncludeTax:true}, pay:{}, target:30, updatedAt:Date.now()};
}

/* ---------- VITRINE : helpers purs ---------- */
function suggestPrice(profile){
  const prices=(profile.revenus||[]).map(r=>r.prix).filter(p=>p>0).sort((a,b)=>a-b);
  if(prices.length){ return prices[Math.floor(prices.length/2)]; }
  const m=METIERS[profile.metier];
  if(m && m.revenus[0]) return m.revenus[0].prix;
  return 5000;
}
function fallbackDescription(name,details,metier){
  name=(name||"Article").trim();
  const d=(details||"").trim();
  const hooks=["Dispo maintenant","Qualité garantie","Bon prix","Stock limité","Tout neuf","Livraison possible"];
  const h=hooks[(name.length+d.length)%hooks.length];
  return `${name}${d?" — "+d:""}. ${h}, contacte-moi vite pour commander ✅`;
}
function waCatalogueText(profile){
  const all=(profile.revenus||[]);
  const items=all.filter(r=>r.vitrine).length?all.filter(r=>r.vitrine):all;
  let t=`🛍️ *${profile.name}*\n\n`;
  items.forEach(r=>{ t+=`• ${r.nom} — ${fmtF(r.prix)}\n`; });
  t+=`\nPour commander, réponds à ce message 👍`;
  return t;
}
function waLink(text,phone){
  const num=phone?String(phone).replace(/\D/g,""):"";
  return "https://wa.me/"+num+"?text="+encodeURIComponent(text||"");
}
function paymentRequestText(operator,amount,product,seller){
  return `💳 *Paiement ${operator}*\n`+
    (product?`Pour : ${product}\n`:"")+
    `Montant : ${fmtF(amount)}\n`+
    `Vendeur : ${seller||"BOSS"}\n\n`+
    `Fais le transfert ${operator} puis confirme ici. Merci BOSS 🙏`;
}

/* ---------- CAISSE (ventes/dépenses réelles, datées) ---------- */
function startOfDay(ts){const d=new Date(ts);d.setHours(0,0,0,0);return d.getTime();}
function startOfMonth(ts){const d=new Date(ts);d.setHours(0,0,0,0);d.setDate(1);return d.getTime();}
function sumCaisse(caisse,type,sinceTs){
  return (caisse||[]).filter(e=>e.type===type && e.statut!=="a_valider" && (sinceTs==null||e.ts>=sinceTs)).reduce((s,e)=>s+(e.montant||0),0);
}
function caisseTotals(profile,nowTs){
  nowTs=nowTs||Date.now();
  const c=profile.caisse||[]; const som=startOfMonth(nowTs), sod=startOfDay(nowTs);
  const vMois=sumCaisse(c,"vente",som), dMois=sumCaisse(c,"depense",som);
  return {ventesJour:sumCaisse(c,"vente",sod), depensesJour:sumCaisse(c,"depense",sod),
    ventesMois:vMois, depensesMois:dMois, netMois:vMois-dMois, nb:c.length};
}

/* ---------- CARNET (dettes) ---------- */
function carnetTotals(profile){
  const d=profile.carnet||[];
  const impayes=d.filter(x=>!x.paye);
  return {impaye:impayes.reduce((s,x)=>s+(x.montant||0),0), nb:impayes.length, total:d.length};
}
function debtReminderText(entry,sellerName){
  return `Bonjour ${entry.client||""} 👋\nPetit rappel amical : il reste ${fmtF(entry.montant)}${entry.motif?(" ("+entry.motif+")"):""} à régler chez ${sellerName||"nous"}.\nMerci de payer quand tu peux 🙏`;
}

/* ---------- SAUVEGARDE ---------- */
function serializeBackup(state){ return JSON.stringify({app:"BOSS",version:1,exportedAt:new Date().toISOString(),state},null,2); }
function parseBackup(text){
  const o=JSON.parse(text);
  if(!o||!o.state||!o.state.profiles) throw new Error("Fichier de sauvegarde invalide");
  return o.state;
}

/* ---------- MIGRATION / robustesse profil ---------- */
function ensureProfile(p){
  if(!p) return p;
  if(!Array.isArray(p.revenus)) p.revenus=[];
  if(!Array.isArray(p.charges)) p.charges=[];
  if(!Array.isArray(p.caisse)) p.caisse=[];
  if(!Array.isArray(p.carnet)) p.carnet=[];
  if(!Array.isArray(p.clients)) p.clients=[];
  if(!Array.isArray(p.commandes)) p.commandes=[];
  if(!Array.isArray(p.pieces)) p.pieces=[];
  if(!Array.isArray(p.catalogues)) p.catalogues=[];
  if(!p.identite) p.identite={logo:null,rccm:"",ncc:"",adresse:"",tel:"",email:"",slogan:"",mentions:""};
  if(!p.tresorerie) p.tresorerie={soldes:{especes:0,banque:0,mobile:0}};
  if(!Array.isArray(p.collaborateurs)) p.collaborateurs=[];
  if(!Array.isArray(p.caisses) || !p.caisses.length) p.caisses=[{id:"k-principale",nom:"Caisse principale"}];
  if(!p.tva) p.tva={enabled:false,rate:18,pricesIncludeTax:true};
  if(!p.pay) p.pay={};
  if(p.updatedAt==null) p.updatedAt=Date.now();
  if(p.target==null) p.target=30;
  if(!p.metier) p.metier="vendeur";
  if(!p.unite) p.unite=(METIERS[p.metier]||METIERS.vendeur).unite;
  // nettoyage : retirer les produits vides (ni nom ni prix) et les doublons de nom
  const _seen={};
  p.revenus=p.revenus.filter(r=>{
    if(!r) return false;
    const hasName=r.nom && String(r.nom).trim();
    if(!hasName && !(r.prix>0)) return false; // produit vide -> jeté
    const key=hasName?normalize(String(r.nom)).trim():"";
    if(key){ if(_seen[key]) return false; _seen[key]=true; }
    return true;
  });
  p.revenus.forEach(r=>{ if(r && !r.id) r.id="r"+Math.random().toString(36).slice(2,9); });
  return p;
}

/* ---------- STOCK ---------- */
function lowStockItems(profile,threshold){
  threshold=(threshold==null?5:threshold);
  return (profile.revenus||[]).filter(r=>typeof r.stock==="number" && r.stock<=threshold);
}

/* ---------- HISTORIQUE MENSUEL (depuis la caisse réelle) ---------- */
function monthlyHistory(profile,nMonths,nowTs){
  nowTs=nowTs||Date.now(); nMonths=nMonths||6;
  const base=new Date(nowTs); const out=[];
  for(let i=nMonths-1;i>=0;i--){
    const d=new Date(base.getFullYear(),base.getMonth()-i,1);
    const start=d.getTime();
    const end=new Date(base.getFullYear(),base.getMonth()-i+1,1).getTime();
    const c=(profile.caisse||[]).filter(e=>e.ts>=start && e.ts<end);
    const ventes=c.filter(e=>e.type==="vente").reduce((s,e)=>s+(e.montant||0),0);
    const depenses=c.filter(e=>e.type==="depense").reduce((s,e)=>s+(e.montant||0),0);
    out.push({start,label:d.toLocaleDateString("fr-FR",{month:"short"}),ventes,depenses,net:ventes-depenses});
  }
  return out;
}

/* ---------- TVA / IMPÔTS (indicatif) ---------- */
function tvaDecompose(amount,rate,includesTax){
  rate=(rate||0)/100;
  let ht,tva,ttc;
  if(includesTax!==false){ ttc=amount; ht=rate?ttc/(1+rate):ttc; tva=ttc-ht; }
  else { ht=amount; tva=ht*rate; ttc=ht+tva; }
  return {ht,tva,ttc};
}
function tvaMonth(profile,nowTs){
  const t=profile.tva||{}; 
  const ventesTTC=caisseTotals(profile,nowTs).ventesMois;
  const dec=tvaDecompose(ventesTTC,t.rate||0,t.pricesIncludeTax!==false);
  return {enabled:!!t.enabled, rate:t.rate||0, base:ventesTTC, ht:dec.ht, tvaCollectee:dec.tva, ttc:dec.ttc};
}

/* ---------- PAIEMENT (génère un vrai lien/USSD si configuré) ---------- */
function buildPayment(payConfig,operator,amount){
  payConfig=payConfig||{};
  const conf=payConfig[operator]||{};
  const amt=Math.round(amount||0);
  if(operator==="Wave" && conf.link){
    let url=conf.link;
    url = url.indexOf("{amount}")>=0 ? url.replace(/\{amount\}/g,amt) : url+(url.indexOf("?")>=0?"&":"?")+"amount="+amt;
    return {kind:"link",value:url};
  }
  if(conf.ussd){ return {kind:"ussd",value:conf.ussd.replace(/\{amount\}/g,amt)}; }
  return {kind:"whatsapp",value:null};
}

/* ---------- SYNC : fusion dernier-écrit-gagne par profil ---------- */
function mergeStates(local,remote){
  if(!remote||!remote.profiles) return local;
  if(!local||!local.profiles) return remote;
  const out={profiles:{},currentId:local.currentId,updatedAt:Math.max(local.updatedAt||0,remote.updatedAt||0)};
  const ids=new Set([...Object.keys(local.profiles),...Object.keys(remote.profiles)]);
  ids.forEach(id=>{
    const a=local.profiles[id], b=remote.profiles[id];
    if(a&&!b) out.profiles[id]=a;
    else if(b&&!a) out.profiles[id]=b;
    else out.profiles[id]=((b.updatedAt||0)>(a.updatedAt||0))?b:a;
  });
  out.currentId=(remote.updatedAt||0)>(local.updatedAt||0)?(remote.currentId||local.currentId):local.currentId;
  if(!out.profiles[out.currentId]) out.currentId=Object.keys(out.profiles)[0];
  return out;
}

/* ---------- LICENCE / ESSAI / BLOCAGE ---------- */
const LICENSE_PUBKEY={"kty":"EC","crv":"P-256","x":"0S_uw4Xa28STvQiadpqdqKO2rJ-kQkgZuyKhLHTX22M","y":"_cw4MZLL1BWfhRSI8P5kStwKFqdBZTy3bTQv8BG88iE","key_ops":["verify"],"ext":true};
const DAY=86400000;

/* ---------- PLANS D'ABONNEMENT (mars 2026) ---------- */
const PLANS = {
  starter: {
    id: "starter", name: "Starter", price: 2500, icon: "medal", iconColor:"#cd7f32",
    tagline: "Pour tester, ou petite activité",
    limits: {
      businesses: 1,
      collaborateurs: 0,
      products: 10,
      salesPerMonth: 50,
      aiMessagesPerDay: 10,
      affichesPerMonth: 0,
      cloudSync: false,
      thermalPrint: false,
      cgaReports: false,
      advancedStats: false,
      alertes: false,
      templatesMetier: true,
      catalogueShare: true,
      support: "email-48h"
    }
  },
  business: {
    id: "business", name: "Business", price: 5000, icon: "medal", iconColor:"#c0c0c0",
    tagline: "La majorité des maquis, boutiques, coiffures",
    limits: {
      businesses: 1,
      collaborateurs: -1,
      products: 50,
      salesPerMonth: -1,
      aiMessagesPerDay: 50,
      affichesPerMonth: 5,
      cloudSync: true,
      thermalPrint: true,
      cgaReports: true,
      advancedStats: false,
      alertes: true,
      templatesMetier: true,
      catalogueShare: true,
      support: "whatsapp-24h"
    }
  },
  pro: {
    id: "pro", name: "Pro", price: 10000, icon: "crown", iconColor:"#ffd700",
    tagline: "Business qui grandit, franchises, multi-points de vente",
    limits: {
      businesses: 1,
      collaborateurs: -1,
      products: 200,
      salesPerMonth: -1,
      aiMessagesPerDay: -1,
      affichesPerMonth: -1,
      cloudSync: true,
      thermalPrint: true,
      cgaReports: true,
      advancedStats: true,
      alertes: true,
      templatesMetier: true,
      catalogueShare: true,
      support: "whatsapp-4h"
    }
  }
};
const COLLAB_SURCHARGE = 0.6; // +60% du prix du plan par collaborateur ajouté
const TRIAL_DAYS = 30;         // 30 jours d'essai Pro

function currentPlan(license){
  const id = (license && license.planId) || "starter";
  return PLANS[id] || PLANS.starter;
}
function planLimit(license, key){ return currentPlan(license).limits[key]; }
function planCanUseFeature(license, key){
  const v = planLimit(license, key);
  return v === true || v === -1 || (typeof v === "number" && v > 0);
}
function isUnlimited(license, key){ return planLimit(license, key) === -1; }
function billingV2(license, counts){
  const plan = currentPlan(license);
  const businesses = Math.max(1, counts.businesses || counts.metiers || 1);
  const collabs = Math.max(0, counts.collaborateurs || 0);
  const businessCost = plan.price * businesses;
  const collabCost = Math.round(plan.price * COLLAB_SURCHARGE * collabs);
  return {
    planId: plan.id, planName: plan.name, planPrice: plan.price,
    businesses, businessCost,
    collabs, collabCost, collabSurcharge: COLLAB_SURCHARGE,
    total: businessCost + collabCost
  };
}

function defaultLicense(nowTs){
  nowTs=nowTs||Date.now();
  // 30 jours d'essai en Pro par défaut, puis bascule Starter
  return {
    installedAt: nowTs, trialDays: TRIAL_DAYS, paidUntil: 0,
    planId: "pro", trialPlanId: "pro",
    starterAfterTrial: true,
    basePrice: 0, extraMetierPrice: 0,
    perCollaborateur: 2000, perCaisse: 1000,  // legacy pour billingDue historique
    acceptedMonthly: 0, acceptedAt: 0,
    graceHours: 48, lockedManually: false
  };
}
function monthlyCost(license,counts){ return billingDue(license,counts); }
function licenseDue(license,metiers){
  metiers=Math.max(1,metiers||1);
  return (license.basePrice||0)+(license.extraMetierPrice||0)*(metiers-1);
}
function licenseStatus(license,metiers,nowTs){
  nowTs=nowTs||Date.now();
  license=license||defaultLicense(nowTs);
  const due=licenseDue(license,metiers);
  if(license.lockedManually){ return {state:"locked",due,daysLeftTrial:0}; }
  const trialEnds=(license.installedAt||nowTs)+(license.trialDays||0)*DAY;
  const paidUntil=license.paidUntil||0;
  if(paidUntil && nowTs<paidUntil){
    return {state:"active",due,paidUntil,daysLeftPaid:Math.ceil((paidUntil-nowTs)/DAY)};
  }
  if(nowTs<trialEnds){
    return {state:"trial",due,trialEnds,daysLeftTrial:Math.ceil((trialEnds-nowTs)/DAY)};
  }
  // échéance dépassée
  const dueSince=Math.max(trialEnds,paidUntil);
  const graceEnds=dueSince+(license.graceHours||48)*3600000;
  if(nowTs<graceEnds){
    return {state:"grace",due,graceEnds,hoursLeft:Math.ceil((graceEnds-nowTs)/3600000)};
  }
  return {state:"locked",due,graceEnds};
}

/* base64url <-> bytes */
function _b64u(bytes){ let s=""; const b=new Uint8Array(bytes); for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function _ub64(str){ str=str.replace(/-/g,"+").replace(/_/g,"/"); while(str.length%4) str+="="; const bin=atob(str); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
function _subtle(){ const c=(typeof globalThis!=="undefined"&&globalThis.crypto)?globalThis.crypto:null; if(!c||!c.subtle) throw new Error("WebCrypto indisponible"); return c.subtle; }

async function signLicenseToken(privJwk,payload){
  const subtle=_subtle();
  const key=await subtle.importKey("jwk",privJwk,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const pj=JSON.stringify(payload);
  const pb=_b64u(new TextEncoder().encode(pj));
  const sig=await subtle.sign({name:"ECDSA",hash:"SHA-256"},key,new TextEncoder().encode(pb));
  return pb+"."+_b64u(sig);
}
async function verifyLicenseToken(token,pubJwk){
  try{
    const subtle=_subtle();
    pubJwk=pubJwk||LICENSE_PUBKEY;
    const parts=String(token||"").trim().split(".");
    if(parts.length!==2) return null;
    const key=await subtle.importKey("jwk",pubJwk,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
    const okv=await subtle.verify({name:"ECDSA",hash:"SHA-256"},key,_ub64(parts[1]),new TextEncoder().encode(parts[0]));
    if(!okv) return null;
    const payload=JSON.parse(new TextDecoder().decode(_ub64(parts[0])));
    return payload;
  }catch(e){ return null; }
}

/* ---------- RÔLES (cadre de permissions) ---------- */
const ROLES={
  proprietaire:{label:"Propriétaire / Admin",perms:["all"]},
  chef_projet:{label:"Chef de projet",perms:["dashboard","users_view","support"]},
  commercial:{label:"Commercial",perms:["users_view","activate"]},
  bu_manager:{label:"Business Unit Manager",perms:["dashboard","users_view","pricing"]},
  secretaire:{label:"Secrétaire",perms:["users_view"]},
  comptable:{label:"Comptable",perms:["dashboard","payments","pricing"]},
  recouvrement:{label:"Recouvrement",perms:["users_view","payments","activate"]}
};

/* ---------- COMMANDES / LIVRAISONS / SATISFACTION ---------- */
const ORDER_STATUSES=[
  {k:"nouvelle",label:"Nouvelle"},
  {k:"confirmee",label:"Confirmée"},
  {k:"preparation",label:"En préparation"},
  {k:"en_route",label:"En livraison"},
  {k:"livree",label:"Livrée"},
  {k:"payee",label:"Payée"},
  {k:"annulee",label:"Annulée"}
];
const ORDER_FLOW=["nouvelle","confirmee","preparation","en_route","livree","payee"];
function orderStatusLabel(k){ const s=ORDER_STATUSES.find(x=>x.k===k); return s?s.label:k; }
function nextOrderStatus(k){ const i=ORDER_FLOW.indexOf(k); return (i>=0 && i<ORDER_FLOW.length-1)?ORDER_FLOW[i+1]:null; }
function orderTotal(o){
  if(!o) return 0;
  if(Array.isArray(o.items) && o.items.length) return o.items.reduce((s,it)=>s+(it.prix||0)*(it.qty||1),0);
  return o.total||0;
}
function blankOrder(){
  return {id:"o"+Date.now()+Math.random().toString(36).slice(2,6), clientNom:"", clientPhone:"", items:[], total:0, adresse:"", dateLivraison:"", creneau:"", paiement:"livraison", statut:"nouvelle", note:"", satisfaction:null, createdAt:Date.now(), updatedAt:Date.now()};
}
function todayISO(nowTs){ const d=new Date(nowTs||Date.now()); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function isActiveOrder(o){ return o.statut!=="payee" && o.statut!=="annulee" && o.statut!=="livree"; }
function deliveriesForDay(commandes,dayISO){
  return (commandes||[]).filter(o=>o.dateLivraison===dayISO && o.statut!=="annulee");
}
function orderStats(commandes,nowTs){
  nowTs=nowTs||Date.now();
  const tISO=todayISO(nowTs);
  const c=commandes||[];
  const today=c.filter(o=>o.dateLivraison===tISO && o.statut!=="annulee" && o.statut!=="payee");
  const codToday=today.filter(o=>o.paiement==="livraison").reduce((s,o)=>s+orderTotal(o),0);
  const enCours=c.filter(o=>isActiveOrder(o)).length;
  const livrees=c.filter(o=>o.statut==="livree"||o.statut==="payee").length;
  const notes=c.map(o=>o.satisfaction&&o.satisfaction.note).filter(n=>n>0);
  const satAvg=notes.length?(notes.reduce((a,b)=>a+b,0)/notes.length):0;
  return {todayCount:today.length, codToday, enCours, livrees, satisfactionAvg:satAvg, satisfactionCount:notes.length, total:c.length};
}
function orderConfirmText(o,business){
  const items=(o.items||[]).map(it=>`• ${it.nom} x${it.qty||1}`).join("\n");
  let t=`Bonjour ${o.clientNom||""} 👋\nMerci pour ta commande${business?(" chez "+business):""} !`;
  if(items) t+=`\n\n${items}`;
  t+=`\n\nTotal : ${fmtF(orderTotal(o))}`;
  if(o.dateLivraison) t+=`\nLivraison prévue : ${o.dateLivraison}${o.creneau?(" ("+o.creneau+")"):""}`;
  if(o.adresse) t+=`\nAdresse : ${o.adresse}`;
  if(o.paiement==="livraison") t+=`\nPaiement à la livraison.`;
  t+=`\n\nPeux-tu me confirmer ? 🙏`;
  return t;
}
function deliveryOnWayText(o){
  return `Bonjour ${o.clientNom||""} 🚚\nTa commande est en route${o.creneau?(" ("+o.creneau+")"):""}.`+
    (o.paiement==="livraison"?`\nMontant à préparer : ${fmtF(orderTotal(o))}.`:"")+`\nÀ tout de suite !`;
}
function satisfactionRequestText(o,business){
  return `Bonjour ${o.clientNom||""} 🙏\nMerci d'avoir commandé${business?(" chez "+business):""} ! J'espère que tout s'est bien passé.\nPeux-tu noter ta satisfaction de 1 à 5 et me dire ce que je peux améliorer ? Merci 🌟`;
}

/* ---------- ASSISTANT IA : patch structuré + extraction JSON ---------- */
function parseAIjson(text){
  if(!text) return null;
  let s=String(text);
  const fence=s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fence) s=fence[1];
  const start=s.indexOf("{"), end=s.lastIndexOf("}");
  if(start<0||end<0||end<start) return null;
  try{ return JSON.parse(s.slice(start,end+1)); }catch(e){ return null; }
}
function applyAIPatch(p,patch){
  const ev=[];
  if(!patch||typeof patch!=="object") return {events:ev,done:false};
  if(patch.name && typeof patch.name==="string" && patch.name.trim()){ p.name=patch.name.trim().slice(0,60); ev.push("Business : "+p.name); }
  if(patch.metier && METIERS[patch.metier]){ p.metier=patch.metier; p.unite=METIERS[patch.metier].unite; ev.push("Métier : "+METIERS[patch.metier].name); }
  if(patch.unite && typeof patch.unite==="string") p.unite=patch.unite.trim().slice(0,24);
  if(typeof patch.target==="number" && isFinite(patch.target)) p.target=Math.max(5,Math.min(90,patch.target));
  if(Array.isArray(patch.addProducts)){
    patch.addProducts.forEach(it=>{
      if(!it) return;
      const nom=String(it.nom||"").trim(); const prix=parseFloat(it.prix)||0;
      if(!nom || prix<=0) return;
      const key=normalize(nom).trim();
      if(p.revenus.some(r=>normalize(r.nom).trim()===key)) return;
      p.revenus.push({id:"r"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),nom,prix,cout:parseFloat(it.cout)||0,qte:parseFloat(it.qte)||0,stock:(it.stock!=null?(parseFloat(it.stock)||0):null),vitrine:true});
      ev.push("Produit : "+nom+" ("+fmtF(prix)+")");
    });
  }
  if(Array.isArray(patch.addCharges)){
    patch.addCharges.forEach(c=>{
      if(!c) return;
      const nom=String(c.nom||"").trim(); const montant=parseFloat(c.montant)||0;
      if(!nom || montant<=0) return;
      if(p.charges.some(x=>normalize(x.nom).trim()===normalize(nom).trim())) return;
      p.charges.push({nom,montant});
      ev.push("Charge : "+nom+" ("+fmtF(montant)+")");
    });
  }
  p.updatedAt=Date.now();
  return {events:ev, done:!!patch.done};
}

/* ---------- PIÈCES COMPTABLES (justificatifs) ---------- */
const PIECE_TYPES=[
  {k:"achat",label:"Facture d'achat",sens:"depense"},
  {k:"vente",label:"Facture de vente",sens:"recette"},
  {k:"recu",label:"Reçu / Ticket de caisse",sens:"depense"},
  {k:"releve",label:"Relevé bancaire",sens:"neutre"},
  {k:"livraison",label:"Bon de livraison",sens:"neutre"},
  {k:"frais",label:"Note de frais",sens:"depense"},
  {k:"quittance",label:"Quittance (loyer, eau, électricité)",sens:"depense"},
  {k:"avoir",label:"Avoir / Remboursement",sens:"recette"},
  {k:"autre",label:"Autre pièce",sens:"neutre"}
];
const PAYMENT_CHANNELS=[
  {k:"especes",label:"Espèces (caisse)"},
  {k:"banque",label:"Banque"},
  {k:"mobile",label:"Mobile Money"},
  {k:"cheque",label:"Chèque"},
  {k:"autre",label:"Autre"}
];
function pieceTypeLabel(k){ const t=PIECE_TYPES.find(x=>x.k===k); return t?t.label:k; }
function channelLabel(k){ const c=PAYMENT_CHANNELS.find(x=>x.k===k); return c?c.label:k; }
function blankPiece(){ return {id:"pc"+Date.now().toString(36)+Math.random().toString(36).slice(2,5), type:"achat", canal:"especes", montant:0, tiers:"", date:todayISO(Date.now()), photo:null, note:"", createdAt:Date.now()}; }

function isoWeek(d){
  d=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  const day=d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-day);
  const yStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const wk=Math.ceil((((d-yStart)/86400000)+1)/7);
  return {year:d.getUTCFullYear(),week:wk};
}
function periodKey(dateISO,period){
  const d=new Date((dateISO&&dateISO.length>=10?dateISO:todayISO(Date.now()))+"T12:00:00");
  const y=d.getFullYear(), m=d.getMonth()+1;
  if(period==="jour") return dateISO;
  if(period==="semaine"){ const w=isoWeek(d); return w.year+"-S"+String(w.week).padStart(2,"0"); }
  if(period==="mois") return y+"-"+String(m).padStart(2,"0");
  if(period==="trimestre") return y+"-T"+(Math.floor((m-1)/3)+1);
  if(period==="annee") return ""+y;
  return dateISO;
}
function periodLabel(key,period){
  if(period==="mois"){ const [y,m]=key.split("-"); try{ return new Date(+y,+m-1,1).toLocaleDateString("fr-FR",{month:"long",year:"numeric"}); }catch(e){ return key; } }
  if(period==="jour"){ try{ return new Date(key+"T12:00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"numeric",month:"short",year:"numeric"}); }catch(e){ return key; } }
  if(period==="semaine"){ const [y,w]=key.split("-S"); return "Semaine "+w+" · "+y; }
  if(period==="trimestre"){ const [y,t]=key.split("-T"); return t+"ᵉ trimestre "+y; }
  if(period==="annee") return "Année "+key;
  return key;
}
function filterPieces(pieces,f){
  f=f||{};
  return (pieces||[]).filter(p=>{
    if(f.type && f.type!=="tous" && p.type!==f.type) return false;
    if(f.canal && f.canal!=="tous" && p.canal!==f.canal) return false;
    if(f.from && p.date<f.from) return false;
    if(f.to && p.date>f.to) return false;
    return true;
  });
}
function groupPieces(pieces,period){
  const groups={};
  (pieces||[]).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")).forEach(p=>{
    const key=periodKey(p.date,period);
    if(!groups[key]) groups[key]={key,label:periodLabel(key,period),items:[],total:0,recettes:0,depenses:0};
    groups[key].items.push(p);
    const sens=(PIECE_TYPES.find(t=>t.k===p.type)||{}).sens;
    groups[key].total+=p.montant||0;
    if(sens==="recette") groups[key].recettes+=p.montant||0;
    else if(sens==="depense") groups[key].depenses+=p.montant||0;
  });
  return Object.values(groups).sort((a,b)=>b.key.localeCompare(a.key));
}
function pieceStats(pieces){
  const byType={}, byCanal={}; let total=0;
  (pieces||[]).forEach(p=>{ byType[p.type]=(byType[p.type]||0)+(p.montant||0); byCanal[p.canal]=(byCanal[p.canal]||0)+(p.montant||0); total+=p.montant||0; });
  return {count:(pieces||[]).length, total, byType, byCanal};
}
function pieceExamples(metier){
  const tiers={maquis:"Grossiste boissons",restaurant:"Marché / grossiste",couturier:"Boutique de tissus",coiffure:"Fournisseur de produits",boutique:"Grossiste",vendeur:"Fournisseur",patissier:"Grossiste (farine, sucre)",cosmetique:"Fournisseur cosmétiques",telephone:"Fournisseur accessoires",transport:"Station-service"};
  const t=tiers[metier]||"Fournisseur";
  return [
    {type:"achat",canal:"especes",tiers:t,hint:"Réassort de marchandise"},
    {type:"quittance",canal:"especes",tiers:"Propriétaire / SODECI / CIE",hint:"Loyer, eau ou électricité"},
    {type:"frais",canal:"mobile",tiers:"Transport",hint:"Taxi, carburant, livraison"}
  ];
}

/* ---------- TRÉSORERIE & RAPPROCHEMENT BANCAIRE ---------- */
const TREASURY_ACCOUNTS=[
  {k:"especes",label:"Caisse (espèces)"},
  {k:"banque",label:"Banque"},
  {k:"mobile",label:"Mobile Money"}
];
function movementSign(e){ return (e.type==="vente"||e.type==="entree")?1:-1; }
function treasuryBalances(profile){
  const open=(profile.tresorerie&&profile.tresorerie.soldes)||{};
  const bal={especes:open.especes||0, banque:open.banque||0, mobile:open.mobile||0};
  (profile.caisse||[]).forEach(e=>{
    if(e.statut==="a_valider") return;
    const c=e.canal||"especes"; if(bal[c]==null) return;
    bal[c]+= movementSign(e)*(e.montant||0);
  });
  bal.total=bal.especes+bal.banque+bal.mobile;
  return bal;
}
function accountMovements(profile,canal){
  return (profile.caisse||[]).filter(e=>(e.canal||"especes")===canal)
    .slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
}
function movKey(e){ return e.id || ("t"+(e.ts||0)); }
function reconcile(profile,statementBalance,pointedKeys){
  const open=((profile.tresorerie&&profile.tresorerie.soldes)||{}).banque||0;
  const movs=accountMovements(profile,"banque");
  const recorded=open+movs.reduce((s,e)=>s+movementSign(e)*(e.montant||0),0);
  const set=new Set(pointedKeys||[]);
  const pointed=open+movs.filter(e=>set.has(movKey(e))).reduce((s,e)=>s+movementSign(e)*(e.montant||0),0);
  const stmt=statementBalance||0;
  return {open, recorded, pointed, statement:stmt, ecart:stmt-pointed, rapproche:Math.abs(stmt-pointed)<1};
}

/* ---------- COLLABORATEURS, PERMISSIONS, FACTURATION, CAISSE (POS) ---------- */
const COLLAB_PERMS=[
  {k:"pos",label:"Saisie caisse (ventes)"},
  {k:"stock",label:"Voir le stock"},
  {k:"commandes",label:"Commandes / livraisons"},
  {k:"pieces",label:"Pièces comptables"},
  {k:"dash",label:"Tableau de bord (CA, ventes)"},
  {k:"valider",label:"Valider les ventes"}
];
function defaultPermsForRole(role){
  const map={
    proprietaire:["pos","stock","commandes","pieces","dash","valider"],
    bu_manager:["pos","stock","commandes","dash","valider"],
    chef_projet:["commandes","dash"],
    commercial:["pos","commandes","stock"],
    secretaire:["pos","commandes"],
    comptable:["pieces","dash"],
    recouvrement:["commandes","dash"]
  };
  return (map[role]||["pos"]).slice();
}
function blankCollaborateur(role){
  role=role||"commercial";
  return {id:"co"+Date.now().toString(36)+Math.random().toString(36).slice(2,5), nom:"", role, permissions:defaultPermsForRole(role), caisseId:"", actif:true};
}
function collabCan(collab,perm){
  if(!collab) return true; // propriétaire (pas de collaborateur sélectionné)
  return (collab.permissions||[]).indexOf(perm)>=0;
}
function billingDue(license,counts){
  license=license||{}; counts=counts||{};
  const base=license.basePrice||0;
  const metierExtra=(license.extraMetierPrice||0)*Math.max(0,(counts.metiers||1)-1);
  const perC=(license.perCollaborateur!=null?license.perCollaborateur:2000);
  const perK=(license.perCaisse!=null?license.perCaisse:1000);
  const collabs=perC*(counts.collaborateurs||0);
  const caisses=perK*Math.max(0,(counts.caisses||1)-1); // 1re caisse incluse
  return {base, metierExtra, perC, perK, nbCollab:counts.collaborateurs||0, nbCaisseExtra:Math.max(0,(counts.caisses||1)-1), collabs, caisses, total:base+metierExtra+collabs+caisses};
}
function makeChange(total,received){
  const r=(received||0)-(total||0);
  return {rendu:r>=0?r:0, insuffisant:r<0, manque:r<0?-r:0};
}
function ticketTotal(lines){ return (lines||[]).reduce((s,l)=>s+(l.prix||0)*(l.qty||1),0); }
function ticketVolume(lines){ return (lines||[]).reduce((s,l)=>s+(l.qty||1),0); }

const __API={METIERS,METIER_ORDER,detectMetier,parseAmounts,extractName,computeFinancials,coachInsights,fmtF,startConversation,conversationStep,applyPatch,blankProfile,presetProfile,normalize,suggestPrice,fallbackDescription,waCatalogueText,waLink,paymentRequestText,startOfDay,startOfMonth,sumCaisse,caisseTotals,carnetTotals,debtReminderText,serializeBackup,parseBackup,ensureProfile,lowStockItems,monthlyHistory,tvaDecompose,tvaMonth,buildPayment,mergeStates,LICENSE_PUBKEY,defaultLicense,licenseDue,licenseStatus,signLicenseToken,verifyLicenseToken,ROLES,ORDER_STATUSES,ORDER_FLOW,orderStatusLabel,nextOrderStatus,orderTotal,blankOrder,todayISO,deliveriesForDay,orderStats,orderConfirmText,deliveryOnWayText,satisfactionRequestText,parseAIjson,applyAIPatch,PIECE_TYPES,PAYMENT_CHANNELS,pieceTypeLabel,channelLabel,blankPiece,periodKey,periodLabel,filterPieces,groupPieces,pieceStats,pieceExamples,TREASURY_ACCOUNTS,treasuryBalances,accountMovements,movKey,reconcile,COLLAB_PERMS,defaultPermsForRole,blankCollaborateur,collabCan,billingDue,monthlyCost,makeChange,ticketTotal,ticketVolume,PLANS,COLLAB_SURCHARGE,TRIAL_DAYS,currentPlan,planLimit,planCanUseFeature,isUnlimited,billingV2};
if(typeof module!=="undefined" && module.exports){ module.exports=__API; }
if(typeof window!=="undefined"){ window.BOSS=__API; }
