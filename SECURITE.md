# BOSS — Sécurité

Ce document décrit le modèle de menaces, les défenses en place et les
procédures de réponse. À lire avant tout déploiement en production.

---

## 1. Modèle de menaces (STRIDE simplifié)

| Menace | Défense principale |
|---|---|
| **XSS injection** (contenu malveillant dans un champ) | CSP strict + `escapeHtml` systématique + `safeImgUrl` + `sanitizeStr` |
| **Vol de session** (localStorage lu par XSS ou accès physique) | Chiffrement AES-GCM des clés sensibles, clé stockée en IndexedDB (jamais localStorage), verrouillage d'inactivité |
| **Élévation de privilège** (collab devient propriétaire) | Trigger PostgreSQL `prevent_self_privilege_escalation` |
| **Suppression du dernier admin** | Trigger `protect_last_owner` |
| **Réutilisation de token d'invitation** | `expires_at` à 7 jours + révocation à l'acceptation |
| **Force brute d'invitation** | Rate limit 20 invitations/heure/org |
| **Attaque volumétrique** (payload énorme) | Contrainte `pg_column_size(data) < 5 MB` + bornes clientes |
| **Homoglyphe / RTLO** dans les noms | `sanitizeStr` retire les caractères de contrôle Unicode |
| **CSRF sur endpoints Supabase** | Bearer JWT dans le header `Authorization` (pas de cookie => pas exposé au CSRF) |
| **Man-in-the-middle** | HTTPS enforced GitHub Pages + `upgrade-insecure-requests` dans CSP |
| **Fuite de secret client** | Zéro secret en clair côté client. Seule la clé `sb_publishable_*` est présente (safe par design). |
| **Compromission d'un appareil abandonné** | Verrou automatique après 15 min d'inactivité (PIN admin requis) |

---

## 2. Défenses en place

### 2.1 Côté client (browser)

- **Content Security Policy stricte** en meta tag (dans `shell.html`) :
  - `default-src 'self'` — aucune ressource externe autre que celles explicitement listées.
  - `connect-src` limité à Supabase + Pollinations + Groq + Anthropic.
  - `frame-ancestors 'none'` — impossible d'être iframé (protection contre clickjacking).
  - `form-action 'self'` — les formulaires ne peuvent pas soumettre ailleurs.
  - `object-src 'none'` — pas de Flash/plugin (surface d'attaque nulle).
  - `upgrade-insecure-requests` — HTTP → HTTPS forcé.
- **Autres en-têtes via meta** : `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
  qui coupe géolocalisation, USB, Bluetooth, cohortes publicitaires, etc.
- **Chiffrement AES-GCM** de `boss:state:v1`, `boss.session.v1`, `boss.queue.v1`
  avec clé aléatoire 256-bit stockée en IndexedDB (jamais dans localStorage).
- **Verrou d'inactivité** : après 15 min sans interaction, l'app se verrouille.
  Il faut le PIN administrateur pour rouvrir.
- **Sanitisation à l'écriture** (`sanitizeProfile`) : bornes de longueur et de
  montant, purge des caractères de contrôle Unicode, invalidation des `photo`
  qui ne sont pas `data:image/*` ou `blob:`.
- **Licence ECDSA P-256** : vérification par clé publique embarquée, la clé
  privée reste locale au propriétaire.

### 2.2 Côté serveur (Supabase)

- **RLS activé** sur toutes les tables (`organizations`, `memberships`,
  `profiles`, `invitations`, `license_state`, `audit_log`).
- **Fonctions SECURITY DEFINER** pour les actions sensibles
  (`create_organization`, `accept_invitation`, `log_audit`).
- **Triggers anti-abus** :
  - `prevent_self_privilege_escalation` — refuse toute tentative d'un utilisateur
    de se promouvoir lui-même.
  - `protect_last_owner` — refuse la rétrogradation ou suppression du dernier
    propriétaire d'une organisation.
  - `check_invitation_rate` — 20 invitations/h/org maximum.
- **Invitations avec expiration** (`expires_at`, défaut 7 jours) et refus lors
  de l'acceptation si dépassé.
- **Audit log** : chaque action sensible est journalisée dans `audit_log`,
  lecture réservée aux membres, insertion via fonctions SECURITY DEFINER
  uniquement (jamais par l'utilisateur en direct).
- **Contrainte de taille** : `profiles.data` limité à 5 MB pour prévenir les
  attaques de saturation.

### 2.3 Réseau

- **HTTPS enforced** sur GitHub Pages, certificat Let's Encrypt.
- **Domaine personnalisé** `boss.ordre-x.com` en DNS-only via Cloudflare
  (pas de proxy — cert géré directement par GitHub, chaîne plus courte).

---

## 3. À configurer côté Supabase (à faire manuellement)

Le dashboard Supabase a des réglages qu'on ne peut pas mettre en SQL.

### Auth → Attack Protection

- ✅ **Enable Captcha protection** (hCaptcha ou Turnstile) pour signup/login.
- ✅ **Bot protection level** : élevé.
- ✅ **Password strength** : au moins 8 caractères + un chiffre.

### Auth → Rate Limits

- **Signups** : 30/heure/IP (défaut peut être ajusté à la baisse).
- **Sign-in attempts** : 30/heure/IP.
- **Password recovery** : 5/heure/IP.
- **Email sending** : 4/heure/utilisateur.

### Auth → URL Configuration

- **Site URL** : `https://boss.ordre-x.com`
- **Redirect URLs** : ajouter `https://boss.ordre-x.com/**` en whitelist.

### Auth → Emails

- Activer la **confirmation d'email** en production (elle est désactivée par
  défaut sur les nouveaux projets).
- Personnaliser les templates (Sign up / Magic Link / Reset password) pour
  qu'ils portent la marque BOSS et pointent vers `boss.ordre-x.com`.

### Auth → MFA

- Activer **TOTP** (Google Authenticator, 1Password, Aegis, etc.).
- Recommander (voire imposer via une politique côté app) le MFA pour tout
  compte propriétaire ou manager.

---

## 4. Rotation des clés

### Clé publique de licence (LICENSE_PUBKEY)

- Générer un nouveau couple ECDSA P-256 avec le script dans
  `keys.example.json`.
- Remplacer `LICENSE_PUBKEY` dans `engine.js`.
- Sauvegarder la nouvelle `keys.json` **hors du repo** (déjà gitignored).
- Les anciens codes de déverrouillage ne fonctionneront plus — prévenir les
  clients affectés.

### Clé Supabase `anon` / `publishable`

- Depuis le dashboard Supabase → Settings → API Keys → « Rotate ».
- Mettre à jour `.env.local` avec la nouvelle clé.
- Rebuild + push. Les utilisateurs déjà connectés restent connectés (le JWT
  reste valide jusqu'à expiration, la nouvelle clé sert pour les futures
  connexions).

### Clé Supabase `service_role`

- **Ne jamais** l'utiliser côté client. Elle sert uniquement pour les scripts
  de migration/back-office lancés depuis un poste sécurisé.
- Roter dès la moindre suspicion de fuite.

---

## 5. Réponse à incident

### 5.1 Fuite suspectée de la clé publique de licence

1. Générer immédiatement un nouveau couple ECDSA.
2. Mettre à jour `LICENSE_PUBKEY` dans `engine.js`, rebuild, push.
3. Ré-émettre les codes de déverrouillage aux clients légitimes.

### 5.2 Compte propriétaire compromis (mot de passe volé, appareil perdu)

1. Depuis le dashboard Supabase → Authentication → Users → sélectionner
   l'utilisateur → **« Sign out »** (invalide tous ses refresh tokens).
2. Forcer une réinitialisation de mot de passe.
3. Auditer les modifications récentes via
   `select * from audit_log where actor_user_id = '...' order by created_at desc;`.
4. Rétrograder ou supprimer les memberships créés par cet utilisateur si
   suspicion d'abus.

### 5.3 Suspicion d'abus de tokens d'invitation

- Requête : `update invitations set accepted_at = now(), accepted_by = null where organization_id = '...' and accepted_at is null;`
  (invalide toutes les invitations en attente d'une org).

### 5.4 DDoS ou pic de trafic anormal

- Cloudflare étant en front (bien qu'en DNS-only pour `boss.ordre-x.com`),
  activer temporairement le **proxy Cloudflare** (nuage orange) pour bénéficier
  de leur protection. Réactiver le DNS-only quand la menace est passée pour
  laisser GitHub Pages gérer HTTPS directement.

---

## 6. Ce qui reste à faire (feuille de route sécurité)

- [ ] Enrôlement TOTP dans l'UI (Supabase supporte déjà côté serveur).
- [ ] Alertes Slack/email sur pics dans `audit_log` (via edge function).
- [ ] Rapport hebdomadaire d'audit (top actions, top acteurs).
- [ ] Signature du build (`dist/boss-app.html`) et vérification au load
      (défense contre altération en transit — utile si CDN compromis).
- [ ] Passer la CSP en nonce-based au lieu de `'unsafe-inline'` pour
      script-src (nécessite d'abandonner le modèle « fichier unique » ou de
      passer par un service qui injecte le nonce — pas trivial sur Pages).
- [ ] Test d'intrusion externe (bug bounty ou audit ponctuel).

---

## 7. Rappels importants

- **Aucune clé secrète** (`service_role`, `keys.json`, API keys tiers) ne doit
  entrer dans le repo git. Le `.gitignore` les couvre déjà, mais un
  `git status` avant chaque push est une bonne habitude.
- **Aucune donnée en clair** dans les emails/messages envoyés à l'utilisateur.
- **Backups chiffrés** : l'export JSON (`Admin → Données → Télécharger la
  sauvegarde`) contient les données en clair. Recommander à l'utilisateur de
  le stocker chiffré (fichier zippé avec mot de passe fort, ou stockage
  chiffré).

---

*Dernière mise à jour : 2026-07-06 — hardening initial (CSP, RLS, audit log,
verrou d'inactivité).*
