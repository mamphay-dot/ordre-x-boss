# Installer BOSS sur ton téléphone

BOSS est une **PWA (Progressive Web App)**. Elle s'installe **directement depuis
le navigateur** — pas besoin de passer par le Play Store ou l'App Store.

Une fois installée, elle marche exactement comme une app native :
- Icône sur l'écran d'accueil
- Ouverture plein écran (pas de barre d'adresse)
- Fonctionne hors ligne (les ventes s'enregistrent, la synchro se fait dès qu'il y a
  du réseau)
- Se met à jour automatiquement en arrière-plan
- **Aucun frais** — pas de compte Play/App Store, pas d'installation à approuver

---

## 📱 Sur Android

**Navigateur : Chrome** (ou Samsung Internet, Edge, Brave).

1. Ouvre https://boss.ordre-x.com
2. Une bannière **« Installer BOSS sur ton téléphone »** apparaît en haut. Tape dessus.
3. Confirme « **Installer** » dans la fenêtre de Chrome.
4. L'icône **BOSS** apparaît sur l'écran d'accueil comme n'importe quelle app.

**Si la bannière n'apparaît pas :**
- Menu ⋮ (en haut à droite de Chrome) → **« Installer l'application »** ou
  **« Ajouter à l'écran d'accueil »**.

**Sur Samsung Internet :** ☰ → **« Ajouter la page à »** → **« Écran d'accueil »**.

---

## 🍎 Sur iPhone / iPad

**Navigateur : Safari uniquement.** (Chrome iOS ne peut PAS installer de PWA — Apple
oblige tous les navigateurs iOS à utiliser le moteur de Safari mais réserve
l'installation à Safari lui-même.)

1. Ouvre **Safari**, va sur https://boss.ordre-x.com
2. Tape sur l'icône **« Partager »** (le carré avec la flèche vers le haut, au
   milieu de la barre du bas).
3. Fais défiler vers le bas → tape **« Sur l'écran d'accueil »** (Add to Home Screen).
4. Tape **« Ajouter »** en haut à droite.
5. L'icône **BOSS** apparaît sur l'écran d'accueil. Tape dessus pour la lancer
   plein écran.

---

## 🖥️ Sur ordinateur (bonus)

Chrome / Edge sur Windows/Mac : icône **« Installer »** dans la barre d'adresse
(petit écran avec flèche vers le bas). L'app s'ouvre dans sa propre fenêtre,
sans onglets ni barre d'URL.

---

## Vérifier que ça marche hors ligne

1. Ouvre BOSS (installée).
2. Mets ton téléphone en **mode avion**.
3. L'app continue de fonctionner : caisse, catalogue, dettes, tout est enregistré
   localement.
4. Repasse en ligne → la synchro cloud s'active toute seule (badge « ☁️ En ligne »
   dans le coin haut-droit).

---

## Mise à jour de l'app

Aucune manip nécessaire. Quand tu ouvres BOSS avec une connexion, elle vérifie
si une nouvelle version est en ligne et se met à jour toute seule en arrière-plan.
Ferme et rouvre l'app pour voir la nouvelle version.

---

## Et une vraie app dans les stores ?

C'est possible mais **payant** et **long**. À envisager quand BOSS aura fait ses
preuves en PWA (retour utilisateur, volume d'inscriptions, etc.).

### Google Play (Android)

- Coût : **25 USD** (une seule fois, à vie).
- Délai : 1 à 7 jours pour la revue Google.
- Technique : on emballe la PWA dans un **APK/AAB** via **Bubblewrap** ou
  **PWABuilder** (Trusted Web Activity). Le code source reste identique —
  c'est juste un wrapper qui affiche https://boss.ordre-x.com
  en plein écran.
- À prévoir : compte Google Play Console + politique de confidentialité +
  captures d'écran.

### App Store (iOS)

- Coût : **99 USD/an** (renouvellement annuel obligatoire).
- Délai : 1 à 14 jours pour la revue Apple (plus stricte).
- Technique : wrapper **Capacitor** ou **WKWebView natif**. Nécessite un **Mac
  avec Xcode** pour compiler et signer.
- À prévoir : compte Apple Developer + politique de confidentialité + captures
  d'écran + description en anglais.

### Recommandation

Reste sur PWA pour le lancement pilote. Les micro-entrepreneurs d'Afrique de
l'Ouest sont majoritairement sur Android + WhatsApp — l'install depuis Chrome
via un lien WhatsApp est fluide et gratuit. Passe aux stores quand tu veux
gagner en visibilité ("trouvable" via une recherche Play/App Store) ou pour
la crédibilité — pas avant.

---

## Distribution rapide sans store

Tu peux partager le lien https://boss.ordre-x.com n'importe où :
WhatsApp, SMS, Facebook, affiche avec QR code, etc. Un simple tap installe l'app
en 30 secondes. Zéro friction.

Pour un QR code : https://qr.io/ → colle l'URL → imprime.
