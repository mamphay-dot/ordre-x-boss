# BOSS — Guide de mise en ligne

Ce document décrit comment BOSS passe de l'app 100 % locale à l'app cloud
multi-appareils avec Supabase (Postgres + Auth + Realtime).

---

## URLs

| Ressource | URL |
|---|---|
| App publique | https://mamphay-dot.github.io/ordre-x-boss/ |
| Repo GitHub | https://github.com/mamphay-dot/ordre-x-boss |
| Projet Supabase | *(à renseigner après création du projet — voir §2)* |

---

## 1. Architecture

```
[téléphone du patron]     [téléphone du collab A]    [téléphone du collab B]
   PWA offline-first          PWA offline-first        PWA offline-first
        │                         │                          │
        └──── HTTPS + JWT ────────┼────── HTTPS + JWT ───────┘
                                  │
                        Supabase EU West (Frankfurt)
                        ├─ Auth (email + magic link)
                        ├─ Postgres 16 + RLS
                        ├─ Realtime (WebSocket)
                        └─ 500 MB DB · plan Free
```

- **Offline-first** : chaque téléphone garde une copie complète en IndexedDB.
  Toute action (vente, dépense, commande…) est enregistrée localement d'abord,
  puis synchronisée dès qu'une connexion est disponible.
- **Fusion « dernier-écrit-gagne » par profil** : `engine.js::mergeStates` est
  le moteur de la synchro. Un profil modifié à 2 endroits garde la version la
  plus récente. Pas de conflit à résoudre pour l'utilisateur.
- **Multi-tenant strict** : Row-Level Security Postgres. Un patron ne peut voir
  que les données de SES organisations. Un collaborateur ne voit que celles de
  l'organisation où il est invité.

---

## 2. Créer le projet Supabase (5 min, une seule fois)

1. https://supabase.com/dashboard/sign-up → « Continue with GitHub »
2. « New project »
   - Name : `ordre-x-boss`
   - Database password : générez un mot de passe fort, **conservez-le**
   - Region : **Europe West (eu-west-1) — Frankfurt**
   - Plan : Free
3. Une fois le projet provisionné (~2 min), aller dans **Settings → API** :
   copier
   - Project URL (ex. `https://abcdefgh.supabase.co`)
   - `anon` public key
   - `service_role` secret key

## 3. Appliquer les migrations SQL

Deux options :

### Option A — SQL Editor (recommandé, aucun outil à installer)

1. Aller dans **SQL Editor** dans le dashboard Supabase.
2. « New query ».
3. Copier tout le contenu du fichier `supabase/migrations/20260705_000_schema.sql`.
4. Coller, « Run ». Aucun erreur attendu → tables et RLS créés.

### Option B — Supabase CLI

```bash
npm install -g supabase
supabase link --project-ref <votre-ref>   # <votre-ref> = sous-domaine avant .supabase.co
supabase db push
```

## 4. Brancher l'app sur le projet

Dans le dossier `boss-source/`, créer un fichier **`.env.local`** (gitignoré) :

```env
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
```

Puis :

```bash
npm run build          # injecte les clés dans dist/ et docs/
git add -A
git commit -m "chore: brancher Supabase sur le build"
git push
```

GitHub Pages se met à jour automatiquement (~1 min).

⚠️ **Ne jamais committer `.env.local`** : la clé `anon` reste dans le HTML publié
(elle est publique, protégée par RLS), mais garder le fichier hors du repo évite
que la clé fuite via la config locale (backups, forks, IDE plugins).

## 5. Configurer l'authentification Supabase

Dans **Authentication → URL Configuration** :

- Site URL : `https://mamphay-dot.github.io/ordre-x-boss/`
- Redirect URLs (autoriser) :
  - `https://mamphay-dot.github.io/ordre-x-boss/`
  - `http://localhost:5150/` *(dev local)*
  - votre domaine personnalisé si applicable

Dans **Authentication → Providers → Email** :

- Enable Email provider ✅
- « Confirm email » : selon votre choix
  - **Activé** : le collaborateur reçoit un mail de confirmation avant sa 1re
    connexion. Plus sécurisé, mais nécessite une inbox joignable.
  - **Désactivé** : l'inscription connecte immédiatement. Meilleure UX pour
    l'Afrique de l'Ouest (emails parfois lents), mais un attaquant peut créer
    des comptes fictifs. **Recommandé désactivé** en phase pilote.

---

## 6. Créer votre organisation (première utilisation)

1. Ouvrir l'app → cliquer sur le badge « 👤 Se connecter » en haut à droite.
2. « Créer un compte » avec votre email + mot de passe.
3. Une fois connecté, le badge devient « ➕ Créer org ». Cliquer.
4. Nommer votre entreprise (ex. « Chez Fatou · Maquis »).
5. Le badge passe à « ☁️ En ligne ». Vos profils locaux sont poussés sur le cloud.

---

## 7. Inviter un collaborateur

1. Badge cloud → sheet « Espace en ligne ».
2. Section « 👥 Collaborateurs » → saisir l'email + rôle → « Envoyer l'invitation ».
3. Un **code d'invitation** apparaît. Le transmettre au collaborateur (WhatsApp,
   SMS, à l'oral…).
4. Le collaborateur :
   - Ouvre l'app.
   - « Se connecter » avec **le même email** que l'invitation.
   - Colle le code dans « Tu as reçu une invitation ? ».
   - Il rejoint votre organisation, voit vos business, peut saisir des ventes.

Rôles disponibles :

| Rôle | Permissions |
|---|---|
| **proprietaire** | Toutes les permissions, y compris facturation & suppression. |
| **manager** | Édition des business, invitations, mais pas de suppression d'org. |
| **collaborateur** | Saisie caisse, commandes, lecture (par défaut). |
| **comptable** | Pièces comptables + dashboard, lecture seule sur le reste. |
| **commercial** | Caisse + commandes + stock. |

---

## 8. Synchronisation

- **Automatique** : dès qu'une modification est faite localement, elle est
  poussée dans les 1,5 s (avec debounce).
- **Realtime** : les autres appareils reçoivent la modification instantanément
  via WebSocket.
- **Fallback polling** : toutes les 20 s en secours si le WebSocket est coupé.
- **Offline** : les modifs sont mises en attente et poussées dès la reconnexion.

## 9. Tests locaux

```bash
npm install     # une seule fois
npm test        # doit finir à "0 échec(s)"
npm run build   # dist/ + docs/ + pwa/
```

Serveur de dev local :

```bash
npx http-server pwa -p 5150 -c-1
# puis ouvrir http://localhost:5150
```

## 10. Prochaines étapes (Phase 2, non incluse)

- **Mobile Money (CinetPay / PayDunya)** : encaissement automatique mensuel
  des licences. Nécessite un compte marchand + KYC entreprise (5-15 jours
  ouvrés). Le stub `paymentRequestText` dans `engine.js` est déjà prêt côté
  client, il ne reste qu'à brancher un webhook côté serveur.
- **Domaine personnalisé** : ex. `boss.groupe-thorium.ci` — ajouter un CNAME
  dans Cloudflare pointant vers `mamphay-dot.github.io`, puis renseigner
  dans **Settings → Pages → Custom domain**.
- **Notifications push** : Supabase supporte Firebase Cloud Messaging. À
  activer pour prévenir un patron d'une commande urgente sans que l'app soit
  ouverte.
- **Sauvegardes chiffrées** : export local (déjà en place via `serializeBackup`)
  + backup automatique dans Supabase Storage.

---

## 11. Dépannage

| Symptôme | Cause probable | Correction |
|---|---|---|
| Badge reste « 🔒 Local » | `.env.local` absent au build | Créer `.env.local`, `npm run build`, recharger |
| Badge « ⚠️ Hors-ligne » | Supabase inaccessible | Vérifier la connexion, la clé anon, la Site URL |
| « Cette invitation est destinée à *autre@…* » | Email du compte ≠ email de l'invitation | Créer un nouveau compte avec le bon email OU réémettre l'invitation |
| Sync bloquée | Cache PWA obsolète | Rafraîchir avec `Cmd+Shift+R`. Le service worker s'auto-met à jour au boot suivant. |
| Erreur RLS 401/42501 | Politique RLS violée (tentative d'accès à une org non-membre) | Vérifier `select * from memberships where user_id = auth.uid();` |

## 12. Sécurité

- **Clé privée de licence** (`keys.json`) : reste locale, jamais sur GitHub.
  Vérifiable via `git ls-files | grep keys.json` → doit renvoyer vide.
- **`service_role` Supabase** : n'est **jamais** utilisé côté client. Ne
  JAMAIS le mettre dans `.env.local` — uniquement la clé `anon`.
- **RLS** : toutes les tables ont RLS activé. Un utilisateur non-membre d'une
  organisation ne peut ni lire, ni écrire ses données. Testé dans `integ14.js`.

---

*Mise à jour : 2026-07-05 — v1 sync cloud multi-utilisateur*
