# Photos du restaurant

Déposez ici les **vraies photos** d'Anas Pizza Original. Elles s'affichent
automatiquement dans la section « La maison » de la page d'accueil.

Tant qu'un fichier est absent, le site affiche un emplacement stylé à sa place :
**rien ne casse**, il manque juste la photo.

## Fichiers attendus

| Fichier          | Emplacement sur le site | Format conseillé            |
|------------------|-------------------------|-----------------------------|
| `devanture.jpg`  | Grande image du haut    | Paysage, 1600 × 1000 px     |
| `salle.jpg`      | Vignette de gauche      | Portrait, 800 × 1000 px     |
| `pizza.jpg`      | Vignette de droite      | Portrait, 800 × 1000 px     |

## Conseils

- **Poids** : viser moins de 250 Ko par photo (compression JPEG qualité 80 environ).
  Une photo de téléphone brute pèse 4 Mo et ralentit fortement le site sur mobile.
- **Cadrage** : les vignettes sont rognées en portrait (4/5), la grande en 16/10.
  Laissez de la marge autour du sujet.
- **Lumière** : les photos prises en journée, devanture ouverte, rendent le mieux.
- Les photos de pizzas sortie du four sont les plus efficaces commercialement :
  n'hésitez pas à en ajouter d'autres et à dupliquer un bloc `<figure class="shot">`
  dans `index.html`.

## Fichiers générés (ne pas supprimer)

| Fichier         | Rôle                                                        |
|-----------------|-------------------------------------------------------------|
| `emblem.svg`    | Logo rond (en-tête, pied de page, icône d'application)      |
| `favicon.svg`   | Icône affichée dans l'onglet du navigateur                  |
| `og-image.jpg`  | Aperçu affiché quand le lien est partagé (WhatsApp, Insta…) |
