---
name: mise-en-ligne-site-client
description: >
  Le processus de fin de projet de Raythan Web Design : brancher le nom de
  domaine acheté par le client, poser les DNS chez le registrar vers Vercel,
  activer Google Analytics avec un bandeau de consentement conforme CNIL,
  valider Search Console, mettre en place l'espace d'administration du client,
  et vérifier que tout tient avant de livrer. Déclenche cette compétence dès
  qu'un site client approche de la livraison — quand le client dit qu'il a
  acheté son domaine, qu'il faut « mettre en ligne », « brancher le domaine »,
  « faire le SEO », « mettre Analytics », « Search Console », « les DNS »,
  « donner les accès », ou qu'il demande une vérification finale avant de
  montrer le site. Utilise-la aussi quand quelque chose « ne marche pas » sur
  une de ces étapes : les pannes sont presque toujours les mêmes quatre, et
  elles sont listées ici.
---

# Mettre un site client en ligne

Ce document décrit la fin de projet telle qu'elle se passe réellement, avec
les pièges qui ont coûté du temps la première fois. L'ordre compte : chaque
étape suppose la précédente faite.

Le principe qui traverse tout : **le client ne doit rien avoir à refaire, et
l'agence ne doit pas devenir le service après-vente d'un panneau de contrôle.**
Tout ce qui peut vivre dans le dépôt vit dans le dépôt, versionné.

---

## 1. Le nom de domaine

Le client achète le domaine à son nom. C'est important : un domaine au nom de
l'agence fait de l'agence le propriétaire de l'adresse du client, et ça se
retourne mal le jour où on se sépare.

### Écrire l'adresse à un seul endroit

Le site doit avoir **un seul fichier** qui connaît son adresse, et tout le
reste en découle — canoniques, Open Graph, données structurées, plan du site,
`robots.txt`, résumé pour les IA. Sur ce projet c'est `outils/domaine.js`.

Trois règles :

- **Sans `www`.** Une seule forme fait autorité ; la variante `www` redirige
  vers elle. Deux formes qui répondent toutes les deux, ce sont deux sites
  aux yeux d'un moteur, et un seul des deux est classé.
- **Le script de réécriture passe en avant-dernier** dans la chaîne de
  construction, juste avant l'empreinte des versions. Tout ce qui écrit une
  URL doit tourner avant lui. Piège vécu : `llms.txt` était généré *après*
  et gardait l'ancienne adresse pendant que les huit autres fichiers étaient
  à jour — invisible, parce que le fichier existait et paraissait juste.
- **Ne bascule l'adresse qu'une fois le domaine joignable.** Une canonique
  vers un domaine qui ne répond pas dit à Google « la vraie page est
  là-bas » ; il y va, ne trouve rien, et n'indexe pas la page qu'il avait
  sous les yeux. Le site peut être parfait, il reste invisible.

### Les DNS

Chez le registrar (Hostinger, OVH, Gandi…), zone DNS :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

Puis Vercel → projet → **Settings → Domains** → ajouter le domaine **et** sa
variante `www`, en laissant Vercel rediriger la seconde vers la première.
Propagation : quelques minutes à quelques heures. Le certificat HTTPS est
émis tout seul ensuite.

Vérifier depuis un terminal plutôt que depuis le navigateur du client, dont
le cache DNS ment :

```bash
getent hosts LE-DOMAINE.fr
curl -s -o /dev/null -w "%{http_code}\n" https://LE-DOMAINE.fr
curl -s -o /dev/null -w "%{http_code} → %{redirect_url}\n" https://ANCIENNE-ADRESSE.vercel.app
```

L'ancienne adresse doit répondre **307 vers la nouvelle**. Si le client dit
« ça marche plus », c'est souvent ça : il teste l'ancienne URL et prend la
redirection pour une panne.

---

## 2. Les variables d'environnement — les quatre pannes

Presque tous les blocages de fin de projet viennent d'ici. Connaître les
quatre fait gagner des heures.

**a) Vercel ne relit pas les variables sans un nouveau déploiement.**
C'est l'oubli numéro un. Après toute modification : Deployments → le dernier
→ ⋯ → **Redeploy**.

**b) Une variable lue à la construction n'est pas une variable lue à
l'exécution.** Les fonctions serverless lisent `process.env` à chaque appel :
une variable ajoutée puis redéployée marche tout de suite. Mais une variable
qui sert à *générer du HTML* n'agit qu'au moment du build. Symptôme
caractéristique : l'API répond correctement alors que les pages ne contiennent
rien de neuf. Vérifier en cherchant la balise attendue dans le HTML servi, pas
en croyant le tableau de bord.

**c) Ne range pas dans une variable ce qui n'est pas un secret.**
Un identifiant Google Analytics s'affiche en clair dans la source de chaque
page ; un nom de domaine aussi. Les mettre dans une variable ne protège rien
et ajoute une manipulation à rater — la mesure d'audience est restée éteinte
deux déploiements de suite pour cette seule raison. Écris-les dans le code,
et laisse la variable **passer devant si elle est posée**, ce qui garde la
possibilité d'éteindre sans toucher au code :

```js
const GA4 = (process.env.GA4_ID !== undefined ? process.env.GA4_ID : 'G-XXXXXXXXXX').trim();
```

Restent des variables : les clés d'API, les codes d'accès, les jetons. Eux
n'ont rien à faire dans un dépôt.

**d) Lire les variables au chargement du module fige la valeur d'avant.**
`const BASE = process.env.API_BASE || '...'` évalué à l'import fait dépendre
le comportement de l'ordre des `require()`. Toujours lire dans une fonction
appelée au moment utile.

---

## 3. Google Analytics et le bandeau de consentement

Analytics dépose des cookies, donc consentement. Le site n'en avait aucun
avant, et sa politique de confidentialité l'écrivait noir sur blanc. Poser
l'identifiant sans rien d'autre rend cette page fausse et le site non
conforme.

Le script qui pose la balise doit donc s'occuper des **trois** conséquences,
plutôt que de les rappeler dans un commentaire et les laisser à faire :

1. **Déclarer le refus par défaut avant de charger la balise.** Sinon elle
   dépose son cookie pendant que le visiteur lit encore le bandeau, et le
   consentement ne veut plus rien dire. L'ordre dans le `<head>` compte :

   ```html
   <script>
     window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
     gtag('consent','default',{ad_storage:"denied",ad_user_data:"denied",
       ad_personalization:"denied",analytics_storage:"denied"});
     try{if(localStorage.getItem("mesure")==="oui")
       gtag('consent','update',{analytics_storage:"granted"})}catch(e){}
     gtag('js',new Date());gtag('config','G-XXXXXXXXXX',{anonymize_ip:true});
   </script>
   <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
   ```

2. **Le bandeau, avec « Refuser » aussi visible qu'« Accepter »** — mêmes
   dimensions, même poids visuel. Un bouton plein contre un lien gris pâle,
   c'est un choix libre en apparence seulement, et c'est ce que la CNIL
   sanctionne. Mémoriser le refus comme l'acceptation : redemander à
   quelqu'un qui a dit non, c'est le harceler jusqu'à ce qu'il cède.

3. **Réécrire la section « Cookies » de la politique de confidentialité.**
   Le même script pose un texte quand la mesure est active et l'autre quand
   elle ne l'est pas, entre deux repères HTML. Retirer la variable défait les
   trois : la page légale ne peut plus mentir sur la configuration réelle.

Ne mesure **pas** les écrans internes (cuisine, administration, page de
confirmation) : le personnel n'est pas une audience, le compter fausse les
chiffres, et une page de confirmation porte des données de client.

### Les événements qui valent quelque chose

Analytics compte seul les visites, les pages et la provenance. Il ne compte
pas ce qui décide de la journée d'un commerce. Pour un restaurant, quatre
suffisent — et quatre est un bon nombre, parce qu'un tableau de bord avec
trente événements ne se lit plus :

| Événement | La question à laquelle il répond |
|---|---|
| `clic_telephone` | combien d'appels le site déclenche — la vraie conversion |
| `clic_commander` | combien ont eu l'intention |
| `commande_demarree` | combien sont entrés dans le tunnel |
| `clic_itineraire` | combien viennent sur place |

Chacun porte un paramètre `emplacement` (en-tête, barre du bas, pied de
page) : « 40 appels » sans savoir d'où ils partent ne dit pas quel bouton
garder.

Ne compte **pas** les paiements ici : ils sont déjà chez le prestataire de
paiement, avec le montant exact. Deux compteurs pour la même chose finissent
toujours par se contredire.

N'envoie rien tant que le consentement n'est pas donné, et vérifie-le en
interceptant les requêtes sortantes — pas en regardant si la balise est
présente.

---

## 4. Search Console

`GSC_TOKEN` reste une variable : le jeton ne sert qu'une fois, à la validation
de propriété, et n'a aucune raison de vivre dans le dépôt.

Le client peut aussi valider par **enregistrement DNS**, souvent plus simple
s'il a déjà la main sur sa zone — dans ce cas aucune balise n'est nécessaire,
et l'absence de `<meta name="google-site-verification">` n'est pas un défaut.

Soumettre `sitemap.xml` accélère le premier passage sans être indispensable :
`robots.txt` contient déjà la ligne `Sitemap:`, Google le trouve seul.

Ce qu'il faut vérifier côté site, et qui se vérifie sans compte :

```bash
curl -sS $D/robots.txt | head -8                    # Allow: / présent
curl -sS $D/ | grep -o 'rel="canonical" href="[^"]*"'
curl -sS $D/ | grep -c 'content="noindex'           # doit valoir 0
curl -sS $D/sitemap.xml | grep -c "<loc>"
```

Et dire honnêtement au client que le reste est du temps : quelques jours à
deux semaines pour un domaine neuf. Le levier qui pèse le plus lourd sur une
recherche locale n'est pas sur le site — c'est la **fiche Google Business
Profile**. Une fiche complète avec photos et horaires vaut plus que toute
l'optimisation de la page.

---

## 5. L'espace d'administration du client

Le client veut de l'autonomie. Sans base de données, le magasin qui marche est
**le dépôt lui-même** : un fichier JSON écrit par l'API de GitHub. Versionné,
sauvegardé partout, gratuit — et une erreur de prix se défait en lisant
l'historique, ce qu'aucun panneau de contrôle classique ne donne.

Points qui ont demandé une deuxième passe :

- **Lire par l'API, pas par le fichier déployé.** Le fichier déployé n'existe
  qu'après un redéploiement, soit une bonne minute. Une rupture de stock doit
  valoir en quelques secondes. Cache court (15 s) côté fonction, et repli sur
  le fichier déployé si l'API ne répond pas : une panne d'outil de gestion ne
  doit pas fermer la boutique.
- **`[skip ci]` dans les commits de pilotage.** Sans lui, six changements un
  samedi soir déclenchent six déploiements pour un fichier que personne ne lit
  au déploiement. Les photos, elles, ont besoin du déploiement pour être
  converties : elles ne le portent pas.
- **Un seul format d'image accepté.** Si l'étape de construction retient le
  premier fichier trouvé pour un nom donné, déposer `plat.png` à côté d'un
  `plat.jpg` existant ne remplace rien — le `.jpg` gagne au tri et la nouvelle
  photo est ignorée sans un mot. Le navigateur réencode de toute façon avant
  l'envoi.
- **Réduire la photo dans le navigateur** avant l'envoi : quatre mégaoctets
  pour un affichage sur 720 pixels, c'est faire payer au client trente
  secondes de données mobiles pour rien.
- **Deux téléphones ouverts en même temps, c'est le cas normal** dans un
  commerce. Lire le contenu et son `sha` dans la même réponse, sinon une
  écriture qui se glisse entre les deux fait fusionner un état périmé. Le
  danger n'est pas l'échec, c'est la réussite silencieuse.
- **Le message d'erreur parle au gérant, pas au développeur** : « quelqu'un
  vient de modifier au même moment, rien n'a été perdu, réessayez » plutôt
  qu'un 409 et un `sha`.

### Le jeton GitHub

Le client bloque souvent ici, et c'est de notre faute si on l'envoie sur les
*fine-grained tokens* : trois écrans, un propriétaire à choisir, un dépôt à
sélectionner, puis une permission à trouver dans une liste de quarante.

Envoie-le sur le **jeton classique** : `github.com/settings/tokens/new`, une
note, **No expiration** (sinon l'espace s'arrête de marcher dans 90 jours sans
prévenir), une seule case à cocher — `repo` — et c'est fini. Le jeton est
affiché une seule fois.

Le classique donne accès à tous les dépôts du compte au lieu d'un seul. Sur un
compte personnel, avec un jeton que seul le propriétaire détient et qui vit
dans Vercel, c'est un compromis acceptable — dis-le franchement plutôt que de
le taire.

**Et surtout : l'espace doit s'ouvrir sans le jeton.** Sans lui, il affiche
tout et n'enregistre pas, avec un message clair. Le client peut le montrer le
jour même et brancher le jeton plus tard. Une fonctionnalité qui exige une
configuration parfaite pour donner le moindre signe de vie est une
fonctionnalité qu'on n'arrive pas à livrer.

### Les niveaux d'accès

Deux codes, un seul lien : c'est le code qui décide du profil, pas l'adresse.
Deux adresses seraient moins sûres, pas plus — une adresse « privée » qui
traîne dans un SMS n'est plus privée.

Sur la question de brider le client tant qu'il n'a pas payé : la bride
protège l'agence, pas le commerce, et le vrai levier est ailleurs — l'agence
détient les codes, peut les changer et peut suspendre la boutique en un appui.
Le garde-fou qui sert vraiment tient tout seul : chaque modification est un
commit signé, avec son auteur et son avant/après. Propose la bride, explique
qu'elle est réversible par une variable, et laisse le patron trancher.

---

## 6. La vérification finale

Ne livre pas sur « ça a l'air d'aller ». Trois passes, dans cet ordre.

**a) Le balayage d'affichage.** Toutes les pages, cinq largeurs (320, 390,
768, 1440, 1920). Cherche : débordement horizontal, image cassée, texte
rogné, erreur JS. Le 320 px trouve des choses que le 390 ne trouve pas — la
barre d'un écran interne sortait de la page à cette largeur seulement.

Astuce pour trouver le coupable d'un débordement plutôt que le constater :
retenir les éléments qui dépassent **et dont aucun enfant ne dépasse**. C'est
le vrai fautif, pas ses parents.

**b) Le parcours réel, en production.** Pas les tests unitaires — le
parcours : choisir, ajouter, saisir ses coordonnées, arriver au récapitulatif.
Vérifier le total affiché.

**c) Les journaux de l'hébergeur.** Sur Vercel : `get_runtime_errors` et le
décompte par code HTTP.

Sur ce dernier point, sache expliquer le tableau de bord au client, parce
qu'il va s'en inquiéter : Vercel appelle « erreur » tout ce qui n'est pas un
2xx. Un site bien fait répond `401` à un mauvais code et `422` à une commande
qui viole les règles — **c'est la sécurité qui fonctionne**. Un site sans
aucun 4xx est un site qui accepte tout. Et sur un petit trafic, une seule
saisie ratée fait bondir le pourcentage : 28 appels, une erreur, 3,5 %. Ce
qu'il faut regarder, c'est **Runtime Errors** : la bonne valeur y est zéro.

---

## 7. Ce qu'on donne au client, et comment

Écris-lui un message qu'il peut lire debout derrière son comptoir : le lien,
le code, et ce qu'il peut faire — en verbes, pas en fonctionnalités.
« Touchez un plat pour le retirer de la carte » plutôt que « gestion des
ruptures de stock ».

Ce qui reste chez l'agence : le compte GitHub, le compte Vercel, la propriété
du dépôt. Ce qui appartient au client dès le premier jour : son nom de
domaine, son compte de paiement, ses données. Cette ligne-là est la bonne, et
elle se tient sans discussion.

---

## Sur le rythme de ces fins de projet

Ces livraisons se font tard, avec un client qui relance, et l'envie est
grande d'annoncer « c'est bon » avant de l'avoir vérifié. Trois réflexes qui
ont payé :

- **Diagnostiquer avant de répondre.** Quand le patron dit « ça marche pas »,
  regarde l'état réel — une commande, un journal — avant d'expliquer quoi que
  ce soit. Deux fois sur trois ça marchait, et ce qu'il voyait était une
  redirection ou un message prévu.
- **Dire ce qui ne va pas, même quand il croit avoir fini.** Annoncer
  qu'Analytics remonte alors que la balise n'est pas dans la page, c'est
  reporter le problème à plus tard, quand il sera plus coûteux à corriger.
- **Reconnaître ses propres erreurs sans en faire un plat.** Le rangement de
  l'identifiant GA4 dans une variable était une mauvaise décision de notre
  part. Le dire en une phrase, corriger, continuer.
