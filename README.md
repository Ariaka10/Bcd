<p align="center"><img src="build/icon.png" width="96" alt=""></p>

<h1 align="center">BCD</h1>

<p align="center"><b>La bibliothèque de l'école, simplement.</b><br>
Gérez les livres, les prêts et les élèves de votre BCD — pensée pour la maternelle et l'élémentaire.<br>
Gratuite, en français, sans abonnement, et les données restent sur l'ordinateur de l'école.</p>

<p align="center"><img src="docs/captures/espace-eleve.png" width="820" alt="Espace élève : thèmes en gros boutons et livres avec leur disponibilité"></p>

---

## ✨ En bref

| | |
|---|---|
| 📚 **Catalogue** | Ajout d'un livre en tapant son ISBN : la fiche arrive de la **BnF**. Cote calculée automatiquement, numéro d'exemplaire simple (1, 2, 3…), couverture, thèmes, mots-clés. |
| 🛎️ **Prêts** | Comptoir **sans douchette** : on touche l'avatar de l'enfant, on tape le numéro ou le titre du livre. Retards, réservations, prêt à toute une classe, fin d'année. |
| 🧒 **Élèves** | Import depuis **ONDE**, connexion par **avatar** (sans mot de passe), thèmes en gros boutons, avis en frimousses 😍🙂😐. |
| 💾 **Sécurité** | Sauvegarde toutes les 30 minutes et à chaque fermeture, copie sur **clé USB**, assistant de rentrée. **Aucune donnée d'élève ne quitte l'ordinateur.** |
| 🪟 **Windows** | Un installateur, ou un **zip sans installation** pour les PC qui bloquent les installations. Rien d'autre à installer. |

## 📥 Télécharger et installer

Les fichiers sont fabriqués **et testés sur Windows** automatiquement à chaque nouvelle version :
onglet **[Releases](../../releases)** (versions publiées) ou **Actions** → dernière exécution « Application Windows » → **Artifacts**.

| Fichier | Pour qui ? |
|---|---|
| `Installer-BCD-x.y.z.exe` | Cas général : double-clic, **sans droits administrateur**. Une icône BCD apparaît sur le bureau. |
| `BCD-x.y.z-sans-installation.zip` | PC qui refuse les installations (PC de mairie…) : dézipper n'importe où puis lancer `BCD.exe`. |

> Windows peut afficher « Windows a protégé votre ordinateur » (application non signée) :
> cliquer sur *Informations complémentaires* puis *Exécuter quand même*.

Au premier lancement, l'application demande le nom de l'école et crée le compte administrateur.

## 🖼️ Aperçu

<table>
<tr>
<td width="50%"><img src="docs/captures/accueil.png" alt="Tableau de bord"><br><sub><b>Tableau de bord</b> — prêts en cours, retards, statistiques</sub></td>
<td width="50%"><img src="docs/captures/comptoir.png" alt="Comptoir de prêt"><br><sub><b>Comptoir</b> — l'enfant par son avatar, le livre par son titre ou son numéro</sub></td>
</tr>
<tr>
<td><img src="docs/captures/connexion-eleve.png" alt="Connexion élève"><br><sub><b>Connexion des élèves</b> — sa classe, puis son avatar</sub></td>
<td><img src="docs/captures/fiche-classe.png" alt="Fiche classe"><br><sub><b>Fiche classe</b> imprimable — qui a quel livre</sub></td>
</tr>
<tr>
<td><img src="docs/captures/inventaire.png" alt="Tous les livres"><br><sub><b>Tous les livres</b> — l'inventaire complet, à imprimer ou exporter</sub></td>
<td><img src="docs/captures/rentree.png" alt="Assistant de rentrée"><br><sub><b>Assistant de rentrée</b> — import ONDE, élèves partis, classes vides</sub></td>
</tr>
</table>

## 🧰 Toutes les fonctionnalités

### Catalogue
- **Notices prêtes à l'emploi par ISBN** : catalogue de la **BnF**, complété par Open Library et Google Books
  (couverture, résumé). Doublons détectés, accents abîmés corrigés automatiquement.
- **Couvertures automatiques** : récupérées à l'enregistrement (service officiel de la BnF, Open Library, Google Books,
  Amazon en option) et gardées sur l'ordinateur,
  donc visibles même sans Internet ; bouton pour chercher en une fois celles des livres déjà enregistrés ou importés.
  Sinon, photo ou image du PC (ou collée avec Ctrl+V).
- **Cotes calculées automatiquement** : genre + 3 lettres de l'auteur (`A RAM`, `R DAH`, `BD AST`…),
  indice Dewey pour les documentaires (`590 LED`).
- **Numéros d'exemplaire simples** (1, 2, 3…), affichés en grand à l'enregistrement pour les écrire sur le livre.
- **Thèmes** (image, couleur, visibles ou non par les élèves) et **mots-clés**.
- **Périodiques** : chaque magazine avec ses numéros (prêtables un par un), suivi de l'abonnement ;
  type **Multimédia** pour les CD et DVD.
- **Recherche** simple (sans se soucier des accents) et avancée ; **Tous les livres** : inventaire complet.
- **Tous les tableaux** se trient d'un clic sur une colonne (▲▼) et ont un champ « Chercher dans ce tableau » (Ctrl+F).
- **Import d'un catalogue existant** : Hibouthèque (*Administration → Document → Export des documents en CSV*),
  BCDI, PMB, tableur. Colonnes reconnues automatiquement, aperçu avant import, numéros d'origine conservés.
- **Désherbage** par lots, **listes thématiques** et **étiquettes** à imprimer, export Excel (CSV).

### Prêts
- Comptoir **avec ou sans douchette** : l'enfant (classe puis avatar), puis le livre (numéro, titre ou ISBN) ;
  le **retour fonctionne de la même façon** (l'enfant, puis ses livres en grands boutons). Chaque opération est confirmée
  dans une fenêtre, puis le comptoir est prêt pour l'élève suivant.
- **Prêt à toute une classe** (lot de livres), **réservations** (par un adulte ou « Je le veux ! » de l'élève),
  livre mis de côté au retour.
- **Retards** par classe et **mots aux familles** imprimables (prénom de l'enfant, signés par l'enseignant·e, à découper) ; **fin d'année** : listes par classe et date de retour commune.
- **Élèves partis avec un livre** : signalés à l'import ONDE (« Rendu » / « Perdu »), rubrique dédiée avec mots pour les familles,
  et toujours en tête de « Ma classe » avec une alerte.
- Durées et limites par profil, prolongations, déclaration de perte.

### Élèves et classes
- **Import ONDE** (ou CSV) avec aperçu : nouvelles classes, changements de classe, élèves partis archivés.
- **Fiche classe** et **fiche élève** imprimables, avec le **carnet de lecteur** de l'année.
- **Aperçu avant impression** (A4, portrait ou paysage) pour toutes les impressions.
- Connexion des élèves **sans mot de passe** : classe → avatar → code secret en pictogrammes (facultatif) ;
  **cartes de connexion** imprimables.
- Espace élève pensé pour la maternelle : thèmes en gros boutons, couvertures, « Mes livres »,
  **avis en frimousses** et rayon « Coups de cœur ».
- **Statistiques détaillées** sur l'accueil : prêts par mois, lecteurs, rotation du fonds, classes, livres et thèmes
  préférés ; bilan annuel imprimable, sans nom d'élève.
- Profils **administrateur**, **enseignant**, **élève**, et **« Ajout de livres »** pour un bénévole, un service civique
  ou un stagiaire (catalogue seulement, aucun accès aux élèves ni aux prêts). Les adultes aussi se connectent par **cartes** :
  un clic pour les enseignant·es (mot de passe facultatif, proposé à la première connexion), mot de passe pour l'administrateur.

### Sécurité des données
- Les données restent **sur l'ordinateur** (`Documents\BCD`), rien n'est ouvert sur le réseau.
  Internet ne sert qu'à chercher les notices et les couvertures par ISBN (BnF, Open Library, Google Books)
  et à vérifier les mises à jour : aucune donnée d'élève n'est envoyée.
- **Sauvegarde automatique** toutes les 30 minutes pendant l'utilisation et à chaque fermeture, **copie sur clé USB**,
  restauration en un clic. Chaque modification est enregistrée immédiatement : une coupure de courant ne fait pas perdre la journée.
- **Assistant de rentrée** : suppression des données des élèves partis (RGPD).
- Copie de sécurité avant chaque mise à jour de l'application.

Le détail des nouveautés de chaque version est dans le **[CHANGELOG](CHANGELOG.md)**.

## 🔄 Mises à jour

L'application vérifie au démarrage si une nouvelle version est publiée (*Paramètres → Version et mises à jour*).
Version installée : « Installer et redémarrer » ; version zip : lien vers la page de téléchargement.
Les données sont toujours conservées.

## 🛠️ Pour les développeurs

Il suffit de **Node.js 22.13 ou plus récent** (base SQLite intégrée, aucune dépendance côté serveur).

```bash
npm start          # version web : http://localhost:3000 (données dans data/bcd.sqlite)
npm test           # tests automatiques
npm install        # puis…
npm run app        # application de bureau (Electron)
npm run dist:win   # fabriquer l'installateur et le zip Windows (sous Windows)
```

Variables : `PORT`, `BCD_DB` (chemin de la base). Derrière un proxy : `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=… npm start`.

Publier une version : changer `version` dans `package.json`, ajouter sa rubrique dans le `CHANGELOG.md`,
puis fusionner dans `main`. GitHub fabrique et teste l'application sur Windows, puis crée la **Release** `vX.Y.Z`
avec l'installateur, le zip et les notes du CHANGELOG (une seule fois par version).

```
electron/            application de bureau (fenêtre, menu, sauvegardes, mises à jour)
server/              API HTTP (Node.js)
  routes/            catalogue, prêts, usagers, thèmes, listes, administration
  notice.js          notices BnF / Open Library / Google Books
  covers.js          couvertures récupérées et gardées dans la base
  catalog-import.js  import Hibouthèque / CSV / XML
  cote.js            calcul des cotes
  backup.js          sauvegardes, clé USB, restauration
public/              interface (HTML, CSS, JavaScript)
test/                tests automatiques (node:test)
docs/captures/       captures d'écran (données fictives)
```

## ⚖️ Licence

BCD est un logiciel libre, distribué sous la **[Licence publique de l'Union européenne (EUPL) v1.2](LICENSE)**.
Chacun peut l'utiliser, l'étudier, le modifier et le redistribuer gratuitement ; une version modifiée et
diffusée doit rester sous la même licence (ou une licence compatible), avec son code source.

La licence existe en version officielle française, de même valeur juridique :
[texte de l'EUPL 1.2 en français](https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32017D0863).

Les couvertures récupérées sur Internet ne sont pas couvertes par cette licence ; celles de la BnF sont
réutilisables sous Licence ouverte (source citée sous chaque couverture).
