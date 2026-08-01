# Anas Pizza Original — site vitrine

Site vitrine de la pizzeria **Anas Pizza Original**, 10 allée Duguay Trouin, 44000 Nantes.

HTML / CSS / JavaScript natifs, **zéro dépendance externe** : pas de framework,
pas de CDN, pas de tracker. Le site se déploie tel quel sur n'importe quel
hébergement statique (GitHub Pages, Netlify, OVH, o2switch…).

## Structure

```
index.html                          page unique : carte, horaires, commande, FAQ
mentions-legales.html               obligatoire (LCEN)
politique-de-confidentialite.html   obligatoire (RGPD) + section cookies
404.html                            page d'erreur
robots.txt · sitemap.xml            référencement
site.webmanifest                    icône « ajouter à l'écran d'accueil »
assets/css/styles.css               feuille de style unique
assets/js/main.js                   script unique (animations, filtres, horaires)
assets/fonts/                       polices auto-hébergées (Anton, Barlow, Playfair)
assets/img/                         logo, favicon, image de partage, photos
```

## À faire avant la mise en ligne

1. **Nom de domaine** — remplacer `https://www.anaspizza-nantes.fr` partout :
   ```bash
   grep -rl "anaspizza-nantes.fr" . --include="*.html" --include="*.xml" --include="*.txt" \
     | xargs sed -i 's|https://www.anaspizza-nantes.fr|https://VOTRE-DOMAINE|g'
   ```
2. **Photos (facultatif)** — la section « La maison » est illustrée par des
   dessins vectoriels intégrés : le site est complet tel quel. Pour passer aux
   vraies photos, déposer `devanture`, `salle` ou `pizza` dans `assets/img/` ;
   l'extension n'a pas d'importance (`.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`,
   majuscules comprises). La photo recouvre l'illustration automatiquement.
   Voir `assets/img/README.md`.
3. **Mentions légales** — compléter les coordonnées du médiateur de la consommation,
   et adapter l'hébergeur si le site n'est pas sur GitHub Pages.

## Modifier la carte

Chaque plat est un bloc autonome dans `index.html` :

```html
<article class="item">
  <p class="item__top">
    <span class="item__name">Nom de la pizza</span>
    <span class="badge badge--veg">Végé</span>   <!-- optionnel -->
  </p>
  <p class="item__desc">Liste des ingrédients.</p>
</article>
```

Badges disponibles : `badge--veg` (végétarien), `badge--hot` (piquant),
`badge--star` (best-seller / signature). La recherche et les filtres
fonctionnent automatiquement sur le texte des plats — aucune configuration.

## Modifier les horaires

Deux endroits à garder synchronisés :

- l'affichage : tableau `.hours` dans `index.html` ;
- la pastille « Ouvert / Fermé » : constante `HOURS` en haut d'`assets/js/main.js`
  (minutes depuis minuit, fuseau Europe/Paris ; une fermeture supérieure à `1440`
  déborde sur le lendemain — ex. `1560` = 2h du matin).

Pensez aussi au bloc `openingHoursSpecification` du JSON-LD dans `<head>`.

## Aperçu en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Charte graphique

Les couleurs sont relevées sur la devanture et la salle du restaurant, et
déclarées une seule fois en haut de `assets/css/styles.css` :

| Jeton       | Valeur    | Origine                          |
|-------------|-----------|----------------------------------|
| `--navy-800`  | `#1C2B3E` | Bleu du panneau de l'enseigne          |
| `--orange`    | `#F4650F` | Orange des murs de la salle            |
| `--red`       | `#D0202A` | Rouge du logo rond                     |
| `--brand-gold`| `#EFAA3C` | Doré du « PIZZA » de l'enseigne        |
| `--gold`      | `#F5B325` | Jaune des titres de la carte           |
| `--cream`     | `#F6F1E7` | Blanc cassé du lettrage                |

Le logotype reprend la composition du panneau : « Anas » en serif crème,
« PIZZA » en doré, « — ORIGINAL — » en dessous entre deux filets.

Chaque section porte un thème (`t-cream`, `t-orange`, `t-red`) qui redéfinit
localement `--bg`, `--fg`, `--rule` et `--surface`. Pour changer l'ambiance
d'une section, il suffit de changer sa classe — aucun autre style à toucher.

## Accessibilité & performances

- Mobile-first, testé de 320 px à 1600 px de large.
- Barre d'action fixe (Appeler / Livraison / Itinéraire) sur mobile.
- Toutes les animations sont désactivées si le visiteur a activé
  « réduire les animations » (`prefers-reduced-motion`).
- Polices auto-hébergées : aucune requête vers Google Fonts, donc aucun
  transfert d'adresse IP vers un tiers — et aucun bandeau cookies nécessaire.
- Feuille de style d'impression : la carte reste lisible sur papier.
