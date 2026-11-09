# BCD — gestion de la bibliothèque de l'école

Application web pour gérer la BCD (bibliothèque centre documentaire) d'une école primaire :
catalogue, notices BnF par ISBN, prêts, usagers, import ONDE, parcours adaptés aux élèves.

## Application Windows (recommandé)

Un installateur `Installer-BCD-x.y.z.exe` est fabriqué automatiquement par GitHub à chaque modification
(onglet **Actions** → dernière exécution « Application Windows » → rubrique **Artifacts**,
ou onglet **Releases** pour les versions publiées).

- **Installation** : double-clic sur l'installateur, sans droits administrateur. Une icône BCD apparaît sur le bureau.
  Windows peut afficher « Windows a protégé votre ordinateur » (application non signée) :
  cliquer sur *Informations complémentaires* puis *Exécuter quand même*.
- **Tout est inclus** : pas de Node.js ni de base de données à installer.
- L'application n'est accessible que depuis cet ordinateur (rien n'est ouvert sur le réseau).
  Internet sert seulement à récupérer les notices BnF et les couvertures.
- **Données** : `Documents\BCD\bcd.sqlite`.
- **Sauvegardes** : automatiques à chaque fermeture (les 15 dernières, dans `Documents\BCD\Sauvegardes`),
  manuelles et restauration depuis *Paramètres → Sauvegardes*.
- **Mise à jour** : lancer le nouvel installateur ; les données sont conservées.
  La désinstallation (Paramètres Windows → Applications) ne supprime pas le dossier `Documents\BCD`.

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
- **Recherche simple** (tous champs, sans tenir compte des accents) et **avancée** (titre, auteur, sujet, collection,
  éditeur, ISBN, cote, type, années, public, emplacement, disponibilité, date d'ajout), tri et pagination.
- **Notices prêtes à l'emploi par ISBN/EAN** : scan à la douchette → notice récupérée dans le catalogue de la **BnF**
  (API SRU, format UNIMARC), complétée si besoin par Open Library et Google Books (couverture, résumé).
  Détection des doublons (« ajouter un exemplaire ? »).
- **Ajout, modification, suppression** de documents et d'exemplaires (codes-barres générés automatiquement ou scannés),
  état des exemplaires (bon, abîmé, perdu, en réparation).
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
- **Comptoir de prêt** : choix de l'emprunteur (par nom ou en touchant l'avatar dans sa classe), scan du livre
  (code-barres de l'exemplaire **ou ISBN**), retour en un scan. Limites et durées par profil, blocage en cas de retard,
  prolongations, déclaration de perte.
- **Retards** : liste par classe, **mots aux familles** imprimables, export CSV.
- **Import des élèves depuis ONDE** (export CSV, encodage Windows ou UTF-8) ou tout fichier CSV :
  aperçu avant import, création des classes, changements de classe à la rentrée, archivage des élèves partis.
- **Profils** : administrateur (tout), enseignant (prêts, catalogue, listes, élèves), élève.
- **Parcours élève ludique** : connexion sans mot de passe (classe → avatar → code secret facultatif en pictogrammes),
  40 **avatars** d'animaux au choix, recherche simplifiée avec couvertures et catégories, « Mes livres ».
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
