# Anas Pizza Original — site vitrine

Site vitrine de la pizzeria **Anas Pizza Original**, 10 allée Duguay Trouin, 44000 Nantes.

HTML / CSS / JavaScript natifs, **zéro dépendance externe** : pas de framework,
pas de CDN, pas de tracker. Le site se déploie tel quel sur n'importe quel
hébergement statique (GitHub Pages, Netlify, OVH, o2switch…).

## Structure

```
index.html                          page vitrine : carte, horaires, FAQ
commander.html                      commande en ligne (voir plus bas)
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
2. **Photos** — voir « Ajouter une photo » ci-dessous : il suffit de déposer
   un fichier au bon nom, tout le reste est automatique.
3. **Mentions légales** — compléter les coordonnées du médiateur de la consommation,
   et adapter l'hébergeur si le site n'est pas sur GitHub Pages.

## Ajouter une photo

**Une seule chose à faire : déposer le fichier au bon nom.** Le reste est
automatique à chaque déploiement — redimensionnement, conversion en WebP,
remplacement de l'illustration.

### Photo d'un plat

Le nom du fichier doit reprendre celui du plat, sans accent ni majuscule, les
espaces remplacés par des tirets. Le nom exact est celui du fichier `.svg`
déjà présent dans `assets/img/plats/` :

| Plat | Fichier à déposer |
|------|-------------------|
| Tikka | `assets/img/plats/tikka.jpg` |
| Chèvre Miel | `assets/img/plats/chevre-miel.jpg` |
| L'Originale | `assets/img/plats/l-originale.jpg` |

`.jpg`, `.jpeg`, `.png`, `.webp`, `.avif` et `.tiff` fonctionnent. Inutile de
redimensionner ou de compresser : une photo de téléphone de 4 Mo devient une
vignette de 1 à 2 Ko et une grande image de 5 à 15 Ko. L'orientation EXIF est
respectée, donc les photos prises à la verticale ne se retrouvent pas couchées.

Un plat sans photo garde son illustration : on peut donc remplacer les photos
une par une, au fil du temps, sans jamais casser la page. Les 49 illustrations
générées restent dans le dépôt et reprennent le relais dès qu'une photo est
retirée.

### Photos du restaurant

Même principe à la racine d'`assets/img/` : `devanture`, `salle`, `pizza`.
Tant qu'une de ces photos manque, la construction retire purement et simplement
la balise `<img>` correspondante : l'illustration de fond reste visible et
aucune requête inutile n'est envoyée au serveur.

### Photos qui ne sont pas celles du restaurant

Toute photo qui ne vient pas de la pizzeria doit être **libre de droits**, et
son auteur doit être cité. Les photos sous licence Creative Commons «&nbsp;BY&nbsp;»
imposent quatre mentions : titre, auteur, lien vers l'original, licence — c'est
la contrepartie de la gratuité, et son absence rend l'usage contrefaisant.

Ces mentions vivent dans la section **5. Crédits photographiques** de
`mentions-legales.html`, atteignable depuis le pied de page et depuis le bas de
la carte. Une photo ajoutée, une ligne ajoutée :

```html
<li><b>Nom du plat</b> — «&nbsp;Titre de la photo&nbsp;» par Auteur,
  <a href="URL-DE-L-ORIGINAL" target="_blank" rel="noopener">source</a>,
  <a href="https://creativecommons.org/licenses/by/2.0/" target="_blank" rel="noopener">CC BY 2.0</a>.</li>
```

Si la photo a été recadrée ou retouchée, l'indiquer (« recadrée ») : la licence
BY l'exige aussi.

Deux licences sont à **éviter** :

- **BY-SA** (partage dans les mêmes conditions) : sa clause contamine le site
  entier, qui devrait alors être republié sous la même licence ;
- **NC** (pas d'utilisation commerciale) : un site de restaurant est un usage
  commercial.

Enfin, une photo d'illustration ne doit jamais laisser croire qu'elle montre le
plat réellement servi — d'où la mention « photos non contractuelles » sous la
carte. Une photo qui ne correspond pas à la recette (viande absente de la carte,
plat qui n'est pas une pizza…) n'a rien à faire sur le site : l'illustration
vectorielle, tracée à partir des ingrédients réels, est alors plus honnête.

### La méthode la plus courte, sans git

Sur GitHub, ouvrir le dossier `assets/img/plats/` → **Add file** → **Upload
files** → glisser les photos → **Commit changes**. Vercel reconstruit tout seul,
les photos sont en ligne en une minute.

### Vérifier ce qui s'est passé

Le journal de construction Vercel indique, pour chaque photo, le fichier
source, les tailles produites et le poids obtenu. Si un nom ne correspond à
aucun plat, il le signale sans interrompre le déploiement.

## Commande en ligne

La boutique vit sur trois pages et deux fonctions serveur.

```
commander.html                page de commande, quatre étapes
commande-confirmee.html       retour de paiement
cuisine.html                  écran cuisine (interne, non indexé)
cgv.html                      conditions de vente + tableau des allergènes
assets/data/carte.json        catalogue généré — ne pas modifier à la main
api/_panier.js                calcul du prix, côté serveur
api/_paiement.js              ouverture de la page de paiement (SumUp ou Stripe)
api/commande.js               POST : recalcule, vérifie, ouvre le paiement
api/cuisine.js                GET  : les commandes payées du service en cours
outils/carte.js               index.html → carte.json
outils/cgv.js                 carte.json → tableau des allergènes dans cgv.html
outils/test-panier.js         contrôles du calcul (npm test)
```

### La règle qui tient tout

**Le navigateur n'envoie jamais un prix.** Il envoie des identifiants de plats,
des tailles, des quantités, des suppléments. Le serveur relit chaque prix dans
`carte.json` et recalcule le total avant d'ouvrir le paiement. Modifier un
montant dans les outils de développement ne change rien à ce qui est débité —
c'est vérifié par `npm test`.

### Une seule carte, partout

`index.html` reste la seule source. `outils/carte.js` en tire `carte.json`,
qui alimente la page de commande, le calcul serveur et le tableau des
allergènes. Après avoir modifié un plat&nbsp;:

```bash
npm run carte      # régénère le catalogue et le tableau des allergènes
npm test           # vérifie que les prix tombent juste
```

Le déploiement fait les deux tout seul (`npm run build`).

### Prestataire de paiement

Le restaurant encaisse déjà par **SumUp** au comptoir. Le site utilise le
même compte&nbsp;: pas de second compte marchand à ouvrir, et les recettes du
site tombent au même endroit que celles de la boutique — une seule
réconciliation bancaire.

`api/_paiement.js` sait parler aux deux prestataires et choisit selon les
variables présentes. Passer de l'un à l'autre ne demande aucune modification
de code, seulement un changement de variables.

| Variable | Rôle | Sans elle |
|---|---|---|
| `SUMUP_API_KEY` | clé API du compte SumUp du restaurant (`sup_sk_…`) | — |
| `SUMUP_MERCHANT_CODE` | code marchand SumUp | — |
| `STRIPE_SECRET_KEY` | solution de repli si le compte bascule sur Stripe | — |
| `CUISINE_CODE` | code d'accès de l'écran cuisine | `/cuisine` répond « non configuré » |

Sans aucune de ces clés, la page de commande fonctionne de bout en bout et le
bouton de paiement renvoie vers le téléphone. Rien ne casse&nbsp;: le site
reste vendeur par téléphone tant que le paiement n'est pas branché.

Le compte doit rester **celui d'ANAS PIZZA**. Un compte au nom de l'agence
ferait de l'agence le vendeur&nbsp;: elle encaisserait le chiffre d'affaires
du restaurant et répondrait des litiges clients.

### Le ticket de cuisine

SumUp n'offre pas de champ de métadonnées libre comme Stripe. Le ticket
voyage donc dans le champ `description` du paiement, sous une forme dense
relue par l'écran cuisine&nbsp;:

```
LIVRAISON | 2× Tikka — Large + Merguez ; 1× Coca-Cola | Dupont 0612345678 | 3 rue des Olivettes 44000 Nantes | NOTE : sans olives
```

Une commande courante tient en 130 caractères, le format est tronqué à 380 par
sécurité, et `npm test` vérifie qu'un ticket écrit est relu à l'identique.

### Zone de livraison, minimum, frais

Tout est dans la constante `LIVRAISON` en haut d'`outils/carte.js`&nbsp;:
codes postaux desservis, minimum de commande, frais, délai annoncé. Un code
postal absent de la liste est refusé par le serveur, pas seulement masqué dans
la page.

### Écran cuisine

`/cuisine` affiche les commandes payées depuis 11h (ou depuis la veille 11h
si l'on est entre minuit et 3h). Il se rafraîchit toutes les quinze secondes
et sonne à chaque nouvelle commande. Une commande marquée préparée passe en
bas de l'écran et le reste après rechargement.

Aucune base de données&nbsp;: les commandes sont relues directement chez
Stripe, qui les conserve déjà. Une base de plus serait une base à sauvegarder,
à sécuriser et à payer pour stocker ce qui existe ailleurs.

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
