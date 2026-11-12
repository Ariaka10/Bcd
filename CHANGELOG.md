# Historique des versions

Toutes les évolutions notables de **BCD**. Les numéros suivent la forme `majeure.mineure.correctif`.

## [1.7.0] — 2026-11-12

### Ajouté
- **Bouton « 🌓 Contraste »** en bas à gauche de l'écran (connexion comprise) : couleurs nettement plus marquées et
  bordures épaisses, pour les écrans pâles ou vieillissants. Réglage gardé sur cet ordinateur.
- **Mise à jour avec barre de progression** : pourcentage et Mo téléchargés, puis annonce claire
  « l'application va se fermer puis se rouvrir toute seule ». Taille du téléchargement indiquée sur le bouton.
- **Mise à jour légère de la version zip** : seule la partie « application » est téléchargée (quelques Mo au lieu du zip
  complet), vérifiée, puis mise en place à la fermeture ; BCD se rouvre tout seul. L'ancienne version est gardée en secours.
  Si le moteur de l'application change, le lien vers le zip complet est proposé comme avant.
  *Disponible à partir de la mise à jour suivante (la 1.7.0 elle-même s'installe encore avec le zip complet).*

### Modifié
- **Espacement** entre les blocs qui se suivent (statistiques détaillées, grilles, cartes).

## [1.6.1] — 2026-11-12

### Corrigé
- **Couleurs plus contrastées** : fond, cartes, bordures et texte secondaire se distinguent mieux sur tous les écrans
  (certains écrans d'ordinateur effaçaient les teintes trop claires). Lignes des tableaux alternées.
- **Mode « contraste élevé » de Windows** : les cartes, boutons et tableaux gardent des bordures visibles.

## [1.6.0] — 2026-11-12

### Ajouté
- **Statistiques détaillées** sur l'accueil (menu « 📊 Statistiques détaillées », qui reste ouvert si on le souhaite) :
  prêts par mois (graphique et tableau), élèves lecteurs, prêts par élève, part du fonds empruntée, livres jamais empruntés,
  livres ajoutés, retours en retard et pertes, tableau par classe, 10 livres les plus empruntés, thèmes préférés,
  prêts par type ; choix de l'année scolaire et **bilan imprimable** (pour le conseil d'école). Aucun nom d'élève.
- **Compte « Ajout de livres »** pour un bénévole, un service civique ou un stagiaire : ajouter et modifier des livres,
  couvertures, thèmes, étiquettes, tous les livres. **Aucun accès aux élèves, aux prêts, aux listes ni aux réglages** ;
  la fiche d'un livre ne montre pas qui l'a emprunté. Ne peut pas emprunter ni supprimer. Créé par l'administrateur
  (*Usagers → Nouveau*, profil « Ajout de livres »), carte de connexion d'un clic, mot de passe facultatif.

### Modifié
- **Retour sur le modèle du prêt** : « 1. Qui rend ? » (nom, ou classe puis avatar ; les enfants sans livre sont grisés),
  puis « 2. Quel livre ? » avec les livres de l'enfant en grands boutons, « Tout rendre », et une fenêtre de confirmation
  (« Un autre livre de… » / « Élève suivant », fermeture toute seule après 5 secondes). Un livre réservé par quelqu'un
  d'autre garde la fenêtre ouverte pour penser à le mettre de côté. La saisie directe par numéro ou titre reste possible.
- **Licence** : BCD est désormais distribué sous la **Licence publique de l'Union européenne (EUPL) v1.2**
  (fichier `LICENSE`, version officielle française disponible sur EUR-Lex).

## [1.5.3] — 2026-11-11

### Corrigé
- **Déconnexion à la fermeture** : fermer l'application déconnecte tous les profils. À la prochaine ouverture,
  on repart de l'écran des cartes (y compris après une coupure de courant ou un arrêt brutal du PC).
- **Écran de connexion** : les cartes (classes, élèves, adultes) sont centrées.
- En haut de l'application, l'école 🏫 à côté de son nom (au lieu des livres 📚, déjà utilisés pour « Prêts »).

### Ajouté
- **« Tous les livres »** : champ de recherche (titre, auteur, numéro, mot-clé…), résultats au fil de la frappe,
  combinable avec les filtres et l'export.

## [1.5.2] — 2026-11-11

### Ajouté
- **Couvertures de la BnF par son service officiel** (gratuit, Licence ouverte), recherché par ISBN/EAN en premier :
  bien meilleur pour les livres français. La source et la date sont indiquées sous la couverture, comme le demande la licence.
- **Option Amazon** (*Paramètres → Couvertures des livres*, décochée par défaut) : en dernier recours, quand aucune autre
  source n'a l'image. Très complet pour les albums, mais ce n'est pas un service prévu pour les logiciels : la recherche
  ralentit pour éviter d'être bloquée. Les images vides d'Amazon sont écartées.
- Sous chaque couverture trouvée sur Internet : sa source (BnF, Open Library, Google Books, Amazon).

### Modifié
- À la mise à jour, les livres marqués « introuvables » sont remis à chercher, pour profiter des nouvelles sources.

## [1.5.1] — 2026-11-11

### Ajouté
- **Confirmation du prêt** : une fenêtre affiche la couverture, le titre, l'enfant et la date de retour.
  « 👍 Élève suivant » (bouton par défaut, ou fermeture toute seule après 5 secondes) remet le comptoir à zéro
  et réaffiche les avatars de la classe, avec les compteurs à jour ; « 📖 Un autre livre pour… » garde le même enfant.
- **Tri des tableaux** : un clic sur le titre d'une colonne trie (▲ croissant, ▼ décroissant, un nouveau clic inverse).
  Dates, numéros et noms sont triés correctement (sans tenir compte de l'avatar). Les élèves partis avec un livre restent en tête.
- **« Chercher dans ce tableau »** au-dessus des tableaux de plus de 5 lignes : ne garde que les lignes qui contiennent
  les mots tapés (sans se soucier des accents), avec le nombre de résultats. **Ctrl+F** place le curseur dans ce champ.

## [1.5.0] — 2026-11-11

### Ajouté
- **Couvertures récupérées automatiquement** : à l'enregistrement d'un livre, l'application cherche sa couverture
  (catalogue de la **BnF**, puis Open Library et Google Books) et **la garde sur l'ordinateur**.
  Elle s'affiche ensuite même sans Internet et part avec les sauvegardes. Seul l'ISBN est envoyé.
- **« Chercher les couvertures manquantes »** (*Paramètres → Couvertures des livres*) : pour les livres déjà
  enregistrés ou importés d'Hibouthèque. Un livre à la fois avec une pause, barre d'avancement, arrêt et reprise,
  bilan (« 412 trouvées, 88 introuvables »), option pour réessayer les introuvables. Aussi proposé à la fin d'un import.

### Modifié
- Les images « pas de couverture » de certains sites et les images vides sont reconnues et écartées
  (l'icône avec la première lettre reste affichée).
- Une couverture retirée à la main n'est pas remise automatiquement ; une photo ajoutée à la main n'est jamais remplacée.
- Sans Internet, rien n'est marqué « introuvable » : la recherche reprendra plus tard.

## [1.4.0] — 2026-11-11

### Ajouté
- **Connexion des adultes par cartes**, comme pour les élèves : une carte par enseignant·e (avatar, prénom),
  connexion d'un clic. La carte **Administrateur** demande toujours le mot de passe.
- **Mot de passe facultatif pour les enseignant·es** : à la première connexion, une fenêtre propose d'en définir un
  (« Non merci » possible). Réglable ensuite dans *Mon compte* (définir, changer, retirer) ou par l'administrateur.
  L'identifiant devient facultatif (créé automatiquement).
- **Périodiques** : une fiche par magazine (périodicité, fin d'abonnement) et ses **numéros** en dessous
  (« n° 412 — mars 2026 »), chacun prêtable avec son numéro BCD ; le numéro et le mois suivants sont proposés ;
  retrait des anciens numéros en une fois ; rappel sur l'accueil quand un abonnement se termine.
- **« Ma classe »** : alerte quand des élèves partis ont encore un livre, et ces élèves toujours **en tête du tableau**
  (⚠️, ligne rouge pâle, titre du livre), quel que soit le filtre.

### Modifié
- **Mots aux familles** : prénom de l'enfant seulement, **signés par la personne connectée**, présentés en bandes
  séparées par une **ligne de découpe** ✂.
- **Type « Multimédia »** (cote `MM`) qui regroupe CD et DVD ; les documents existants sont convertis automatiquement.

## [1.3.2] — 2026-11-11

### Ajouté
- **Vignette des livres sans image** : l'icône de l'application (livre ouvert) avec la première lettre du titre
  sur la page de gauche (« Le loup… » → « L » de loup).
- Cote des documentaires : les saisons et la nature sont reconnues (indice Dewey 508).
- **Aperçu avant impression** : chaque bouton « Imprimer » (et Ctrl+P) ouvre d'abord une fenêtre montrant la feuille
  telle qu'elle sortira (A4, portrait ou paysage), avec le bouton « Imprimer » en bas.
- **Import ONDE : élèves qui partent avec un livre** signalés dans l'aperçu, avec des boutons « Rendu » / « Perdu »
  pour régler le prêt tout de suite (sinon le prêt est conservé).
- Onglet **Prêts → Élèves partis** : les livres encore chez des élèves archivés, avec les mots pour les familles
  à imprimer. Rappel sur l'accueil et dans l'assistant de rentrée.

### Corrigé
- **Réservations d'un élève parti** : quand un élève est archivé ou supprimé, ses réservations sont annulées
  et un livre qui lui était mis de côté passe à l'enfant suivant (avant, le livre restait bloqué).
- **Assistant de rentrée** : une classe n'est plus proposée à la suppression tant que des élèves partis
  de cette classe ont encore un livre.
- **Fiche classe** : un élève parti (archivé, par exemple après l'import ONDE de la rentrée) qui a encore
  un livre n'était pas affiché, alors que son livre était compté dans le total. Il apparaît maintenant
  avec la mention « parti — livre à récupérer ». Même mention dans les listes de prêts, retards et fin d'année.

## [1.3.1] — 2026-11-11

### Ajouté
- **Sauvegardes pendant l'utilisation** : toutes les 30 minutes, s'il y a eu des changements (les 12 dernières
  sont gardées, soit une journée de travail), en plus de celles faites à la fermeture.
- **Page Releases** sur GitHub : chaque version publiée y apparaît avec l'installateur, le zip et ses notes.

### Modifié
- Chaque modification est écrite sur le disque dès qu'elle est validée : une coupure de courant
  ne fait perdre, au plus, que l'opération en cours.

## [1.3.0] — 2026-11-10

### Ajouté
- **Copie sur clé USB** : dans *Paramètres*, choix d'un dossier de sauvegarde supplémentaire (clé USB…).
  À chaque fermeture, si la clé est branchée, une sauvegarde y est copiée (10 gardées).
  La clé est retrouvée même si Windows lui donne une autre lettre (E:, F:…).
  Rappel sur l'accueil si aucune copie n'a été faite depuis 7 jours.
- **Assistant « Nouvelle année scolaire »** : proposé à la première ouverture après le 1er septembre.
  Sauvegarde, livres pas rendus, import ONDE de la nouvelle année, suppression des élèves partis (RGPD),
  suppression des classes vides.
- **Fiche classe** imprimable : chaque élève avec ses livres en cours, dates de retour, retards,
  livres prêtés à toute la classe, colonne « Rendu ✓ » à cocher sur papier.
- **Fiche élève** imprimable avec le **carnet de lecteur** de l'année scolaire.
- Après l'enregistrement d'un livre, le **numéro à écrire sur le livre** s'affiche en grand.

### Corrigé
- Changer de page pendant un chargement ne peut plus afficher l'ancienne page par-dessus la nouvelle.
- L'application de bureau réessaie le chargement de sa page si l'ordinateur est encore occupé au démarrage.

## [1.2.0] — 2026-11-10

### Ajouté
- **Ajouter une couverture** sur la fiche ou dans le formulaire : photo, image du PC ou image collée (Ctrl+V).
  L'image est réduite et rangée dans la base (fonctionne sans Internet, incluse dans les sauvegardes).
- **Import d'un catalogue existant** (Hibouthèque, BCDI, PMB, tableur ; CSV ou XML) : colonnes reconnues
  automatiquement et modifiables, aperçu, exemplaires regroupés par livre, numéros d'origine conservés,
  livres déjà présents ignorés.

### Modifié
- Au comptoir, « 0012 » et « 12 » désignent le même livre.

## [1.1.0] — 2026-11-10

### Ajouté
- **Thèmes** créés par l'administrateur (image, couleur, visibles ou non par les élèves) et **mots-clés**.
- Onglet **Tous les livres** : inventaire complet, filtrable, imprimable, exportable.
- **Comptoir sans douchette** : recherche du livre par numéro ou par titre.
- **Prêt à une classe entière**, **réservations**, onglet **Fin d'année**.
- **Avis des élèves** en frimousses et rayon « Coups de cœur ». Espace élève adapté à la maternelle.
- Application Windows : **version zip sans installation**, vérification des **mises à jour**.

### Modifié
- **Numéros d'exemplaire simples** (1, 2, 3…) ; les anciens « BCD000001 » sont convertis automatiquement.
- Copie de sécurité de la base avant le premier lancement d'une nouvelle version.

### Corrigé
- **Accents abîmés** dans certaines notices (« kilomÃ¨tre » → « kilomètre »), avec un outil de réparation.

## [1.0.0] — 2026-11-09

### Ajouté
- **Application Windows** autonome (installateur sans droits administrateur), données dans `Documents\BCD`.
- **Sauvegardes** automatiques à chaque fermeture, sauvegarde et restauration depuis les paramètres.
- Catalogue : recherche simple et avancée, **notices BnF par ISBN** (complétées par Open Library et Google Books),
  ajout, modification, suppression, **désherbage** par lots, **listes thématiques**, **calcul automatique des cotes**.
- Prêts : prêts, retours, prolongations, **retards** et mots aux familles.
- Usagers : **import des élèves depuis ONDE** ou CSV, profils administrateur / enseignant / élève,
  connexion des élèves par **avatar** et code en pictogrammes, cartes de connexion imprimables.
