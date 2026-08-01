# Photos du restaurant

Déposez ici les **vraies photos** d'Anas Pizza Original. Elles s'affichent
automatiquement dans la section « La maison » de la page d'accueil.

## La méthode la plus courte (3 clics, sans git)

1. Sur GitHub, ouvrez le dossier `assets/img/` du dépôt.
2. Bouton **Add file** → **Upload files**.
3. Glissez vos photos, puis **Commit changes**.

Vercel redéploie tout seul dans la foulée : les photos sont en ligne en une
minute environ.

## Noms de fichiers

Seul le **nom** compte, pas l'extension :

| Nom à donner | Emplacement sur le site | Cadrage        |
|--------------|-------------------------|----------------|
| `devanture`  | Grande image du haut    | Paysage, 16/10 |
| `salle`      | Vignette de gauche      | Portrait, 4/5  |
| `pizza`      | Vignette de droite      | Portrait, 4/5  |

`devanture.jpg`, `devanture.jpeg`, `devanture.png`, `devanture.webp`,
`devanture.avif` et leurs variantes en majuscules fonctionnent toutes : le site
essaie chaque extension à tour de rôle. Inutile de convertir quoi que ce soit.

Tant qu'une photo est absente, un emplacement neutre s'affiche à sa place et sa
légende est masquée : **rien ne casse**, il manque juste l'image.

## Conseils

- **Poids** : viser moins de 250 Ko par photo. Une photo de téléphone brute
  pèse 4 Mo et ralentit fortement le site sur mobile.
- **Cadrage** : les vignettes sont rognées en portrait (4/5), la grande en 16/10.
  Laissez de la marge autour du sujet.
- Les photos de pizzas sortie du four sont les plus efficaces commercialement.
  Pour en ajouter d'autres, dupliquez un bloc `<figure class="shot">` dans
  `index.html`.

## Fichiers générés (ne pas supprimer)

| Fichier         | Rôle                                                        |
|-----------------|-------------------------------------------------------------|
| `emblem.svg`    | Logo rond (en-tête, pied de page, icône d'application)      |
| `favicon.svg`   | Icône affichée dans l'onglet du navigateur                  |
| `og-image.jpg`  | Aperçu affiché quand le lien est partagé (WhatsApp, Insta…) |
