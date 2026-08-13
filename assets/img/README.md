# Photos du restaurant

La section « La maison » affiche par défaut des **illustrations vectorielles**
dessinées d'après le restaurant (devanture, salle, pizza). Elles sont intégrées
directement dans `index.html` : rien à installer, le site est complet sans photo.

Dès qu'un fichier photo portant le bon nom est déposé dans ce dossier, il
**passe automatiquement par-dessus l'illustration**. Aucun code à toucher.

## La méthode la plus courte (3 clics, sans git)

1. Sur GitHub, ouvrez le dossier `assets/img/` du dépôt.
2. Bouton **Add file** → **Upload files**.
3. Glissez vos photos, puis **Commit changes**.

Vercel redéploie tout seul dans la foulée : les photos sont en ligne en une
minute environ.

## Noms de fichiers

Seul le **nom** compte, pas l'extension :

| Nom à donner | Emplacement sur le site        | Cadrage        |
|--------------|--------------------------------|----------------|
| `hero`       | Tout en haut, à côté du titre  | Paysage, 3/2   |
| `devanture`  | « La maison », grande image    | Paysage, 16/10 |
| `salle`      | « La maison », vignette gauche | Portrait, 4/5  |
| `pizza`      | « La maison », vignette droite | Portrait, 4/5  |

`hero` est la première image que voit un visiteur : c'est celle qui doit être
la plus soignée. Elle est rognée en paysage, alors laissez de l'air autour du
plat.

`devanture.jpg`, `devanture.jpeg`, `devanture.png`, `devanture.webp`,
`devanture.avif` et leurs variantes en majuscules fonctionnent toutes : le site
essaie chaque extension à tour de rôle. Inutile de convertir quoi que ce soit.

Tant qu'une photo est absente, l'illustration correspondante reste affichée :
**rien ne casse**, et la section reste finie.

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
