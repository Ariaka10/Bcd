# BCD — gestion de la bibliothèque de l'école

Application web pour gérer la BCD (bibliothèque centre documentaire) d'une école primaire :
catalogue, notices BnF par ISBN, prêts, usagers, import ONDE, parcours adaptés aux élèves.

## Application Windows (recommandé)

Deux fichiers sont fabriqués (et testés sur Windows) automatiquement par GitHub à chaque modification
(onglet **Actions** → dernière exécution « Application Windows » → rubrique **Artifacts**,
ou onglet **Releases** pour les versions publiées) :

- `Installer-BCD-x.y.z.exe` : l'installateur (recommandé) ;
- `BCD-x.y.z-sans-installation.zip` : la même application sans installation. On dézippe le dossier
  où l'on veut (bureau, clé USB…) et on lance `BCD.exe`. Utile si l'ordinateur refuse les installateurs ;
  un ordinateur qui interdit *tout* programme non approuvé la bloquera quand même.

- **Installation** : double-clic sur l'installateur, sans droits administrateur. Une icône BCD apparaît sur le bureau.
  Windows peut afficher « Windows a protégé votre ordinateur » (application non signée) :
  cliquer sur *Informations complémentaires* puis *Exécuter quand même*.
- **Tout est inclus** : pas de Node.js ni de base de données à installer.
- L'application n'est accessible que depuis cet ordinateur (rien n'est ouvert sur le réseau).
  Internet sert seulement à récupérer les notices BnF et les couvertures.
- **Données** : `Documents\BCD\bcd.sqlite`.
- **Sauvegardes** : automatiques à chaque fermeture (les 15 dernières, dans `Documents\BCD\Sauvegardes`),
  manuelles et restauration depuis *Paramètres → Sauvegardes*.
- **Mises à jour** : l'application vérifie au démarrage si une nouvelle version est publiée sur GitHub
  (*Paramètres → Version et mises à jour*, et un bandeau pour l'administrateur). Version installée :
  bouton « Installer et redémarrer ». Sinon, ou si l'ordinateur le bloque : lien vers la page de téléchargement.
  Les données sont conservées, et une copie de sécurité est faite avant le premier lancement d'une nouvelle version.
  ⚠️ La vérification automatique ne fonctionne que si le dépôt GitHub est **public** (sinon GitHub refuse l'accès
  sans identifiant) ; avec un dépôt privé, on télécharge les nouvelles versions à la main depuis GitHub.
- La désinstallation (Paramètres Windows → Applications) ne supprime pas le dossier `Documents\BCD`.

Pour publier une version dans l'onglet *Releases* : changer `version` dans `package.json`,
puis créer une étiquette `vX.Y.Z` (ex. `git tag v1.0.1 && git push --tags`).

## Version serveur (développement)

Il suffit de **Node.js 22.13 ou plus récent** (base SQLite intégrée).

```bash
npm start          # http://localhost:3000
npm test           # tests automatiques
npm run app        # lancer l'application de bureau (après npm install)
```

Au premier lancement, l'application demande de créer le compte administrateur.
Les données sont enregistrées dans `data/bcd.sqlite` (pensez à sauvegarder ce fichier).

Variables utiles : `PORT` (3000 par défaut), `BCD_DB` (chemin de la base).
Derrière un proxy (réseau académique…) : `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy:port npm start`.

## Fonctionnalités

### Gestion du fonds documentaire
- **Recherche simple** (tous champs, sans tenir compte des accents) et **avancée** (titre, auteur, mot-clé, thème, sujet,
  collection, éditeur, ISBN, cote, type, années, public, emplacement, disponibilité, date d'ajout), tri et pagination.
- **Thèmes** créés par l'administrateur (nom, image, couleur) : filtre dans le catalogue, gros boutons pour les élèves,
  option « les élèves ne voient que les thèmes visibles ». **Mots-clés** libres sur chaque livre.
- **Tous les livres** : l'inventaire complet (numéros, cotes, thèmes, état, disponibilité), filtrable, imprimable,
  exportable pour Excel.
- **Notices prêtes à l'emploi par ISBN/EAN** : notice récupérée dans le catalogue de la **BnF**
  (API SRU, format UNIMARC), complétée si besoin par Open Library et Google Books (couverture, résumé).
  Détection des doublons (« ajouter un exemplaire ? »). **Accents abîmés corrigés automatiquement**
  (« kilomÃ¨tre » → « kilomètre »), avec un outil pour réparer les textes déjà enregistrés.
- **Ajout, modification, suppression** de documents et d'exemplaires. Chaque exemplaire reçoit un **numéro simple**
  (1, 2, 3… dans l'ordre d'enregistrement) à écrire sur le livre ; état (bon, abîmé, perdu, en réparation).
- **Désherbage** : recherche des candidats (parus avant telle année, non empruntés depuis N ans, abîmés/perdus),
  impression de la liste pour vérifier en rayon, **suppression par lots**. Les documents en prêt sont protégés,
  l'historique des prêts est conservé.
- **Listes thématiques** : créées à la main, depuis une sélection ou directement depuis une recherche ;
  impression (avec ou sans couvertures) et export CSV. **Étiquettes de cote** à imprimer.
- **Calcul automatique des cotes** :
  - fictions : préfixe du genre + 3 lettres de l'auteur — `A RAM` (album), `R DAH` (roman), `BD AST` (BD, d'après la série),
    `C`, `P`, `T`, `PL`, `M`, `PER`…
  - documentaires : indice **Dewey** simplifié (repris de la notice BnF, ou deviné d'après les sujets) + auteur — `599 LED`.

### Prêts et usagers
- **Comptoir de prêt sans douchette** : choix de l'emprunteur (par nom ou en touchant l'avatar dans sa classe),
  puis le livre par son **numéro ou quelques lettres du titre** ; retour par numéro, titre ou nom de l'enfant.
  Limites et durées par profil, blocage en cas de retard, prolongations, déclaration de perte.
- **Prêt à une classe** : un lot de livres prêté à toute la classe (durée et nombre propres).
- **Réservations** : par un adulte (« Réserver pour… ») ou par l'élève (« Je le veux ! ») ; au retour du livre,
  l'application prévient qu'il faut le mettre de côté.
- **Fin d'année** : listes « livres à rendre avant le … » par classe à imprimer, et date de retour commune pour tous les prêts.
- **Retards** : liste par classe, **mots aux familles** imprimables, export CSV.
- **Import des élèves depuis ONDE** (export CSV, encodage Windows ou UTF-8) ou tout fichier CSV :
  aperçu avant import, création des classes, changements de classe à la rentrée, archivage des élèves partis.
- **Profils** : administrateur (tout), enseignant (prêts, catalogue, listes, élèves), élève.
- **Parcours élève ludique** : connexion sans mot de passe (classe → avatar → code secret facultatif en pictogrammes),
  40 **avatars** d'animaux au choix, thèmes en gros boutons, couvertures, « Mes livres ».
- **Avis des élèves** en frimousses (😍 🙂 😐) et rayon « Coups de cœur de l'école ».
  **Cartes de connexion** imprimables par classe.

## Organisation du code

```
electron/          application de bureau Windows (fenêtre, menu, sauvegardes automatiques)
build/             icône de l'application
server/            API HTTP (Node.js, sans dépendance)
  routes/          auth, documents (catalogue, ISBN, désherbage), loans, users (import ONDE), lists, admin
  notice.js        récupération des notices BnF / Open Library / Google Books
  cote.js          calcul des cotes (genres, Dewey)
  csv.js           lecture des fichiers ONDE / CSV
public/            interface web (HTML, CSS, JavaScript modules)
test/              tests (node:test)
```
