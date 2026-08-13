/* ==========================================================================
   Anas Pizza Original — étape de construction
   --------------------------------------------------------------------------
   Rôle unique : rendre l'ajout de photos indolore.

   Déposez une photo dans assets/img/plats/ nommée comme le plat
   (tikka.jpg, kebab.png, chevre-miel.webp…) et c'est terminé :
   ce script la redimensionne, la convertit en WebP et remplace
   l'illustration correspondante dans index.html au moment du déploiement.
   Aucun code à toucher, aucun réglage.

   Même principe pour les trois photos du restaurant à la racine
   d'assets/img/ : devanture, salle, pizza.

   Le script ne fait jamais échouer la construction : si sharp manque ou
   qu'une image est illisible, on garde l'illustration vectorielle et on
   continue. Le pire scénario est « la photo n'apparaît pas », jamais
   « le site est cassé ».
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const RASTER = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const PLATS = 'assets/img/plats';
const IMG = 'assets/img';
const OPT = path.join(PLATS, 'opt');

// Les photos du restaurant et la largeur qui leur convient. « hero » est la
// seule qui s'affiche sur le premier écran : elle est servie telle quelle,
// sans attendre le défilement.
const SCENES = { hero: 900, devanture: 1400, salle: 900, pizza: 900 };
// Largeur des vignettes de plats : elles s'affichent à 64 px, 256 px couvre
// les écrans à forte densité avec de la marge.
const PLAT_WIDTH = 256;
const PLAT_LARGE = 720; // la fiche détaillée les montre en grand

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('[build] sharp indisponible, les photos restent telles quelles :', e.message);
}

function listRasters(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => RASTER.test(f))
    .map((f) => ({ file: f, slug: f.replace(RASTER, ''), abs: path.join(dir, f) }));
}

async function convert(src, dest, width) {
  if (!sharp) return false;
  try {
    await sharp(src)
      .rotate()                      // respecte l'orientation EXIF des photos de téléphone
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(dest);
    return true;
  } catch (e) {
    console.warn('[build] conversion impossible pour ' + src + ' :', e.message);
    return false;
  }
}

function ko(p) {
  try { return Math.round(fs.statSync(p).size / 1024) + ' Ko'; } catch (e) { return '?'; }
}

async function main() {
  let html = fs.readFileSync('index.html', 'utf8');
  let done = 0;

  // ── photos de plats ─────────────────────────────────────────────────────
  const plats = listRasters(PLATS);
  if (plats.length) fs.mkdirSync(OPT, { recursive: true });

  for (const p of plats) {
    const small = path.join(OPT, p.slug + '-256.webp');
    const large = path.join(OPT, p.slug + '-720.webp');
    const okSmall = await convert(p.abs, small, PLAT_WIDTH);
    await convert(p.abs, large, PLAT_LARGE);
    if (!okSmall) continue;

    // la vignette de la carte pointe vers la version 256
    const before = html;
    html = html.split(PLATS + '/' + p.slug + '.svg').join(OPT.replace(/\\/g, '/') + '/' + p.slug + '-256.webp');
    if (html !== before) {
      done++;
      console.log('[build] ' + p.file + ' → ' + p.slug + '-256.webp (' + ko(small) + ') + -720.webp (' + ko(large) + ')');
    } else {
      console.warn('[build] ' + p.file + ' : aucun plat ne porte le nom « ' + p.slug +' », photo ignorée');
    }
  }

  // ── photos du restaurant ────────────────────────────────────────────────
  for (const [slug, width] of Object.entries(SCENES)) {
    const found = listRasters(IMG).find((r) => r.slug === slug);
    const dest = path.join(IMG, slug + '.opt.webp');

    if (found && (await convert(found.abs, dest, width))) {
      html = html.split(IMG + '/' + slug + '.jpg').join(IMG + '/' + slug + '.opt.webp');
      done++;
      console.log('[build] ' + found.file + ' → ' + slug + '.opt.webp (' + ko(dest) + ')');
      continue;
    }

    // Pas de photo : on retire la balise <img> plutôt que de laisser le
    // navigateur chercher un fichier absent. L'illustration de fond reste
    // visible, et aucune requête inutile n'est envoyée.
    const tag = new RegExp('\\s*<img[^>]*src="' + IMG + '/' + slug + '\\.jpg"[^>]*>', 'g');
    if (tag.test(html)) {
      html = html.replace(tag, '');
      console.log('[build] pas de photo « ' + slug + ' » : illustration conservée');
    }
  }

  fs.writeFileSync('index.html', html);
  // Le catalogue de la commande est régénéré juste après (npm run build) :
  // il reprend alors les chemins des photos optimisées, pas ceux des
  // illustrations.
  console.log(done
    ? '[build] ' + done + ' photo(s) intégrée(s). Les plats sans photo gardent leur illustration.'
    : '[build] aucune photo trouvée, le site utilise ses illustrations. Rien à signaler.');
}

main().catch((e) => {
  // On ne casse jamais un déploiement pour une histoire d'image.
  console.warn('[build] interrompu sans dommage :', e.message);
});
