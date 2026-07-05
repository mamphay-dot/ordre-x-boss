# BOSS — Installer l'application sur ton Samsung Galaxy Z Fold 6

BOSS est une application web installable (PWA). Une fois installée, elle a son **icône sur l'écran d'accueil**, s'ouvre en **plein écran sans barre de navigateur**, **fonctionne sans connexion**, et **garde tes données sur le téléphone**.

Tu as deux façons de faire. La première est la plus simple.

---

## ✅ Méthode 1 — La plus simple (5 minutes, sans rien installer d'autre)

Pour qu'une PWA s'installe vraiment, les fichiers doivent être en ligne (en HTTPS). On utilise un hébergement gratuit où il suffit de **déposer le dossier**.

1. Sur un ordinateur, va sur **https://app.netlify.com/drop**
2. **Glisse-dépose le dossier `boss`** (celui qui contient `index.html`) dans la zone indiquée.
3. Netlify te donne un lien du type `https://nom-au-hasard.netlify.app`. **Copie ce lien.**
4. Sur ton **Fold 6**, ouvre **Chrome** et va sur ce lien.
5. Touche le menu **⋮** (en haut à droite) → **« Installer l'application »** (ou « Ajouter à l'écran d'accueil »).
   - BOSS peut aussi t'afficher directement une barre dorée **« 📲 Installer BOSS »** en haut : touche-la.
6. C'est fini : l'icône **BOSS** apparaît sur ton écran d'accueil. Ouvre-la comme une vraie app.

> Astuce Fold : déplie le téléphone, BOSS passe automatiquement en affichage large avec un menu latéral. Replie-le, il revient aux onglets du bas.

---

## 📦 Méthode 2 — Un vrai fichier APK (pour le Play Store ou installation directe)

Si tu veux un **APK Android** (par exemple pour le publier sur le Play Store) :

1. Fais d'abord la Méthode 1 jusqu'à avoir le lien `https://...netlify.app`.
2. Va sur **https://www.pwabuilder.com**
3. Colle ton lien, lance l'analyse, puis **« Package For Stores » → Android**.
4. Télécharge le paquet Android (`.apk` / `.aab`) généré. Aucune ligne de code à écrire.
5. Pour l'installer directement sur le Fold : transfère l'`.apk` sur le téléphone et ouvre-le (autorise « installer des applications inconnues » si demandé).

---

## 🔌 Tester tout de suite, sans installer

Tu peux aussi simplement ouvrir `index.html` depuis le gestionnaire de fichiers du téléphone : l'app fonctionne et garde tes données. Mais l'**icône sur l'écran d'accueil** et le **mode hors-ligne complet** ne s'activent qu'avec la Méthode 1 (hébergement HTTPS).

---

## Ce qu'il y a dans le dossier

- `index.html` — l'application.
- `manifest.webmanifest` — la fiche de l'app (nom, icône, couleurs).
- `sw.js` — le « service worker » qui fait marcher l'app hors-ligne.
- `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — les icônes.

**Ne sépare pas ces fichiers** : ils doivent rester ensemble dans le même dossier.

---

## Sauvegarde de tes données

Tes données restent sur le téléphone. Pour les mettre à l'abri (changement de téléphone, réinstallation) :
- Dans l'app : onglet **Plus ⋯ → Exporter une sauvegarde** (un fichier `.json`).
- Pour restaurer : **Plus ⋯ → Importer une sauvegarde**.

---

## Ce qui marche hors-ligne, et ce qui a besoin d'internet

- **Hors-ligne :** boutique, photos, catalogue, caisse, carnet de dettes, tableau de bord, tous les calculs.
- **Besoin d'internet :** la génération automatique de description par l'IA (sinon un texte de secours est utilisé), l'ouverture de WhatsApp pour partager/relancer, et l'encaissement Mobile Money.

Bonne vente, patron. 👑

---

## Nouveautés de cette version

- **Stock / inventaire** — active le stock dans la fiche d'un produit (Boutique). Il baisse automatiquement à chaque vente enregistrée en caisse ; alerte quand il est bas.
- **Clients** — un répertoire relié au carnet de dettes (menu **Plus → Mes clients**).
- **Historique** — tes ventes et dépenses mois par mois, avec graphique (menu **Plus → Historique**).
- **TVA** — estimation de la TVA collectée (Réglages → carte TVA). Indicatif, pas une déclaration officielle.
- **Écran déplié du Fold** — barre latérale automatique en grand écran.

## Brancher la synchronisation entre appareils (optionnel)

Menu **Plus → Synchronisation**. Il te faut une adresse web qui accepte de **lire (GET)** et **écrire (PUT)** du texte JSON — par exemple un « bac » gratuit chez **jsonbin.io**, **Supabase**, ou ton propre serveur.
1. Crée un espace de stockage et récupère son **adresse (URL)** et éventuellement un **jeton**.
2. Colle-les dans BOSS, coche « Synchroniser automatiquement », touche **Synchroniser maintenant**.
3. Mets la même adresse sur ton autre téléphone : tes business se retrouvent des deux côtés.

> Sans cette configuration, tes données restent sur l'appareil (et tu peux toujours faire une sauvegarde manuelle par fichier).

## Brancher l'encaissement Mobile Money réel (optionnel)

Menu **Plus → Paramètres de paiement**.
- **Wave** : colle ton **lien de paiement Wave Business** (mets `{amount}` là où le montant doit aller).
- **Orange / MTN** : mets ton **code USSD marchand** avec `{amount}`.

Quand tu touches **Encaisser** sur un produit, BOSS génère alors un vrai lien Wave ou compose le code USSD. Sans configuration, il envoie simplement une demande de paiement par WhatsApp.

> La **confirmation automatique** des paiements (savoir que le client a bien payé) nécessite les API marchand officielles des opérateurs et un compte marchand — c'est l'étape de mise en production avec eux.

---

# Thèmes, paiement, verrouillage et administration

## Thèmes (couleurs)
- Par défaut : **nuances de gris**, mode sombre. Le bouton ◐ en haut bascule **clair / sombre** en un geste.
- **Plus → Apparence** : choisis une couleur d'accent (gris, or, vert, bleu, magenta, rouge, violet) ou une **couleur personnalisée**. Le choix est mémorisé.

## Essai puis paiement
- Chaque appareil démarre avec une **période d'essai** (90 jours par défaut, modifiable par toi).
- Tu fixes : **durée d'essai**, **prix de base**, et **supplément par métier au-delà du premier**. Le montant dû = base + (supplément × (nombre de métiers − 1)).
- À l'échéance : **bandeau rouge** de rappel pendant **48 h**, puis **verrouillage** des fonctions jusqu'au paiement.

## Déverrouillage par code (hors-ligne, non falsifiable)
Le système utilise une **signature cryptographique** : toi seul peux fabriquer des codes valides (avec ta clé privée) ; l'app les vérifie avec une clé publique embarquée. Un utilisateur **ne peut pas** se fabriquer un faux code.

**Pour activer un client qui a payé :**
1. Le client te donne son **code appareil** (affiché sur l'écran de verrouillage, ex. `BOSS-AB12-CD34`).
2. Tu ouvres **admin-generateur.html**, tu colles ta **clé privée** (fichier `CLE-PRIVEE-SECRETE.txt`), tu mets son code appareil + la durée → tu obtiens un **code**.
3. Le client saisit ce code dans l'app → débloqué pour la durée choisie.

Tu peux aussi générer un code depuis l'app (**Plus → Espace administrateur**), ou verrouiller/déverrouiller manuellement cet appareil.

> 🔐 **Sécurité** : garde `CLE-PRIVEE-SECRETE.txt` pour toi. Idéalement, génère **tes propres clés** (admin-generateur.html → section 2) et remplace `LICENSE_PUBKEY` dans `index.html`.

## Rôles employés
Dans l'espace administrateur, un sélecteur de rôle (propriétaire, chef de projet, commercial, BU manager, secrétaire, comptable, recouvrement) avec sa grille de permissions. **Localement**, ça cadre qui fait quoi sur l'appareil.

---

# Ce qui exige un serveur (back-end) — le plan

Une app installée sur le téléphone d'un client ne peut pas, à elle seule, laisser l'admin **voir les données de tous les clients**, **réinitialiser des mots de passe** ou **réconcilier les paiements automatiquement** : ces fonctions ont besoin d'un service central. Voici comment les brancher proprement — le **crochet de synchronisation est déjà dans l'app**.

## Stack recommandée : Supabase (gratuit pour démarrer)
- **Auth** : comptes utilisateurs + comptes employés, connexion par e-mail/téléphone, **réinitialisation de mot de passe** (lien sécurisé — on *réinitialise*, on ne lit jamais un mot de passe en clair).
- **Base de données (Postgres)** : une table `users`, une table `états` (le JSON de chaque business), une table `paiements`, une table `licences`.
- **Storage** : sauvegardes de fichiers si besoin.
- **Row Level Security** : chaque client ne voit que ses données ; l'**admin et les rôles** voient selon leurs droits (recouvrement → paiements ; comptable → finances ; etc.).
- **Edge Functions + Webhooks paiement** : Wave/Orange/MTN notifient ton serveur quand un client paie → le serveur **génère et envoie le code automatiquement** et met à jour `paidUntil`.

## Comment l'app s'y connecte
- L'app a déjà une **couche de synchronisation** (Plus → Synchronisation) qui fait GET/PUT du JSON d'état. Pointe-la vers ton API Supabase : chaque appareil pousse son état, le serveur l'agrège.
- Côté admin, une **console web** (séparée) lit la base : liste de tous les clients, sauvegarde/restauration de n'importe quel compte, génération de codes, suivi des paiements et des relances.

## Correspondance rôles → permissions serveur
- **Propriétaire/Admin** : tout.
- **Chef de projet** : tableau de bord global, support clients.
- **Commercial** : voir clients, activer un essai/abonnement.
- **BU Manager** : tableau de bord, tarification.
- **Secrétaire** : consultation clients.
- **Comptable** : paiements, finances, tarification.
- **Recouvrement** : clients en retard, paiements, génération de codes.

> En résumé : l'app cliente (essai, verrouillage, code, thèmes, rôle local) fonctionne **dès maintenant** ; la **console multi-utilisateurs** se construit sur Supabase et se branche via la synchro. Quand tu veux, je te génère le schéma de base de données et la console admin web.

---

# Assistant IA intégré

BOSS embarque un **assistant qui mène l'entretien** : il pose les questions, devine le métier, crée le business, les produits, les prix et les charges automatiquement, puis annonce ton seuil de rentabilité. Il apparaît au 1er lancement, et reste accessible via **Plus → Reconfigurer avec l'assistant IA**.

- **En ligne avec un point d'accès IA configuré** → entretien 100 % dynamique et personnalisé.
- **Sans accès IA (hors-ligne)** → bascule automatique sur le **mode guidé** (mêmes questions, sans blocage).

**Brancher l'IA** : *Plus → Réglages de l'assistant IA*. Renseigne l'adresse de **ton proxy** (un petit service côté serveur qui parle à l'API et garde la clé secrète), un éventuel jeton, et le modèle.

> 🔐 Ne mets **jamais** une clé d'API secrète directement dans l'app distribuée au public : passe par un proxy serveur (même logique que le back-end multi-utilisateurs).

---

# Installer / publier l'app (Android, iOS, tablettes)

Une seule base de code BOSS, plusieurs façons de la mettre entre les mains des utilisateurs.

## 1) PWA — la plus simple (Android, iPhone, iPad, tablettes Android)
Héberge le dossier sur un lien HTTPS (ex. **Netlify Drop** : dépose le dossier sur app.netlify.com/drop).
- **Android / tablette Android** : ouvre le lien dans **Chrome** → menu → **Installer l'application**.
- **iPhone / iPad (iPadOS)** : ouvre le lien dans **Safari** → **Partager** → **Sur l'écran d'accueil**.
L'app s'installe avec son icône, en plein écran, et marche hors-ligne. C'est déjà une vraie app.

## 2) Paquet Android (.apk / .aab) sans rien installer — **PWABuilder**
1. Va sur **https://www.pwabuilder.com** et colle le lien HTTPS de ton app.
2. Onglet **Android** → **Generate Package** (Google Play AAB, ou APK pour test direct).
3. Tu obtiens un paquet **signé**, prêt pour le **Play Store** ou à installer directement.
> C'est la voie recommandée pour un vrai exécutable Android sans ordinateur de développement.

## 3) Projet natif Android + iOS à compiler — **Capacitor**
Le fichier **boss-capacitor.zip** contient un projet prêt à compiler (voir `BUILD.md` dedans).
- **Android** : Android Studio → Build APK / AAB (Windows, Mac ou Linux).
- **iOS / iPadOS** : nécessite un **Mac + Xcode** et un **compte Apple Developer** (99 $/an) pour publier sur l'App Store. C'est une exigence d'Apple, incontournable.

## Ce que je ne peux pas faire à ta place
- Générer ici un `.ipa` iOS : Apple impose un Mac + Xcode + compte développeur signé.
- Signer un `.apk` avec ta propre clé d'éditeur : ça se fait sur ton poste (Android Studio / PWABuilder), pour que l'app t'appartienne.

| Cible | Voie la plus simple | Pour publier sur le store |
|---|---|---|
| Téléphone Android | PWA (Chrome → Installer) | PWABuilder → AAB → Play Store |
| Tablette Android | PWA (Chrome → Installer) | PWABuilder → AAB |
| iPhone | PWA (Safari → écran d'accueil) | Capacitor + Mac/Xcode → App Store |
| iPad (iPadOS) | PWA (Safari → écran d'accueil) | Capacitor + Mac/Xcode → App Store |
