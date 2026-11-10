# Historique des versions

Toutes les évolutions notables de **BCD**. Les numéros suivent la forme `majeure.mineure.correctif`.

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
