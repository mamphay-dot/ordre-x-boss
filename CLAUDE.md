# BOSS — « C'est toi le boss »

Application de gestion **mobile-first, hors-ligne (PWA)** pour micro-entrepreneurs
francophones d'Afrique de l'Ouest. Tout est en **français**. Thème noir/gris/ocre,
icônes vectorielles. Aucune dépendance externe au runtime (fonctionne sans réseau).

## Structure du projet

- `engine.js` — **logique pure et testable** (aucun DOM). Exporte via `module.exports`
  ET `window.BOSS`. Contient : métiers, calculs financiers, coach, licences (signature
  ECDSA WebCrypto), commandes/livraisons, pièces comptables, trésorerie & rapprochement
  bancaire, collaborateurs/permissions, facturation mensuelle (POS).
- `ui.js` — **toute l'interface** (rendu des vues, feuilles modales, POS, thèmes,
  jeu d'icônes SVG). Manipule le DOM.
- `shell.html` — coquille HTML + CSS avec deux marqueurs : `/*__ENGINE__*/` et
  `/*__UI__*/` remplacés au build par le contenu de `engine.js` et `ui.js`.
- `build.js` — assemble le tout. Produit :
  - `dist/boss-app.html` — **fichier unique** autonome (partage / test hors-ligne)
  - `pwa/index.html` — version PWA de développement
  - `docs/` — **dossier public et sûr pour GitHub Pages** (uniquement l'app + icônes,
    SANS la clé privée ni le générateur admin)
- `pwa/` — manifeste, service worker (`sw.js`), icônes, guide d'installation.
- `test*.js`, `integ*.js`, `stress.js` — batterie de tests (moteur + intégration jsdom).

## Commandes

```bash
npm install        # installe jsdom (pour les tests)
npm run build      # assemble dist/, pwa/index.html et docs/
npm test           # lance toute la batterie de tests
npm run release    # build + test
```

## Règles importantes (à respecter à chaque modification)

1. **Ne jamais casser les tests** : après toute modification, `npm test` doit finir à 0 échec.
2. **Incrémenter la version du cache** dans `pwa/sw.js` à chaque release
   (ex. `boss-v13` → `boss-v14`), sinon les utilisateurs ne voient pas la mise à jour.
3. **Sécurité** : ne JAMAIS committer/publier `keys.json`, `CLE-PRIVEE-SECRETE.txt`,
   ni `pwa/admin-generateur.html` (déjà listés dans `.gitignore`). La clé privée sert
   uniquement, en local, à générer les codes de licence.
4. Toujours reconstruire (`npm run build`) avant de déployer, pour régénérer `docs/`.

## Déploiement (GitHub Pages)

Le dépôt se publie via **GitHub Pages depuis le dossier `docs/`** :
`Settings → Pages → Source : branche main, dossier /docs`.
L'app sera servie en HTTPS (obligatoire pour l'installation PWA et le hors-ligne).

Pour un domaine personnalisé (DNS géré par Cloudflare) : ajouter un CNAME
`boss → <pseudo>.github.io` dans Cloudflare, puis renseigner le domaine dans
`Settings → Pages → Custom domain`.

## Prochaine grande étape (back-end, non encore fait)

Le multi-appareils temps réel (chaque collaborateur sur son téléphone, validation du
manager à distance) et l'encaissement automatique mensuel (Mobile Money) nécessitent un
serveur : Supabase (auth + Postgres + RLS + storage) + un agrégateur de paiement ivoirien
(CinetPay/PayDunya). La couche de synchro côté client est déjà prévue comme point d'accroche.
