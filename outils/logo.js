/* ==========================================================================
   Le logo, détouré de l'enseigne.
   --------------------------------------------------------------------------
   Le restaurant a une identité, et elle est peinte au-dessus de sa porte :
   « ANAS » en blanc, « PIZZA » en doré, « ORIGINAL » souligné dessous. Le
   site en portait une autre — un « Anas » en italique à côté d'une pastille
   ronde. Deux identités pour une seule maison, c'est une de trop, et c'est
   celle de la rue qui gagne : c'est elle que le client a vue avant d'arriver
   ici.

   Reste à l'obtenir. Le « A » de l'enseigne est un swash calligraphique —
   une boucle qui descend sous la ligne et remonte croiser la diagonale.
   Aucune des polices du site ne l'a, et le redessiner à la main donnerait un
   à-peu-près qui se verrait. On prend donc le vrai lettrage, celui de la
   photo, et on le détoure.

   Le détourage n'est pas un simple recadrage : les lettres sont éclairées de
   l'intérieur sur un panneau noir, donc séparables par la lumière. Chaque
   pixel devient transparent ou opaque selon sa clarté, puis reçoit l'une des
   deux couleurs de la charte selon sa chaleur — le doré d'un côté, le blanc
   cassé de l'autre. Le résultat n'est plus une photo : c'est un aplat à deux
   couleurs, aux formes exactes de l'enseigne, qui se pose sur n'importe quel
   fond sombre.

   Ce script ne tourne pas au déploiement. Il produit un fichier qu'on relit,
   qu'on juge à l'œil et qu'on versionne :

       node outils/logo.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const sharp = require('sharp');

const SOURCE = 'assets/img/devanture.jpg';
const SORTIE = 'assets/img/logo.png';

/* Le panneau dans la photo. Relevé une fois à l'œil ; si la photo de
   devanture change, ces quatre nombres sont les seuls à revoir. */
const PANNEAU = { left: 155, top: 125, width: 635, height: 128 };

/* Travail en 2× de la plus grande taille d'affichage prévue (≈ 200 px de
   large dans l'en-tête), avec de la marge pour un futur usage plus grand. */
const LARGEUR_TRAVAIL = 1270;

/* Les néons débordent : au-dessus des capitales, la rampe d'éclairage du
   store laisse une traînée aussi claire qu'une lettre. Elle est au-dessus de
   la ligne de capitale, donc on coupe net à partir de cette ligne plutôt que
   d'essayer de la distinguer par la couleur. */
const HAUT_CAPITALES = 36;

/* Seuils de clarté : en dessous du premier c'est le panneau, au-dessus du
   second c'est franchement une lettre, entre les deux c'est le bord — et
   c'est ce dégradé qui évite l'escalier sur les diagonales. */
const OMBRE = 118;
const LUMIERE = 186;

/* Au-delà de cet écart entre le rouge et le bleu, le pixel appartient au
   « PIZZA » doré. En dessous, au lettrage blanc. */
const CHALEUR_DOREE = 62;

const CREME = [0xF6, 0xF1, 0xE7];   // --cream
const DORE = [0xEF, 0xAA, 0x3C];    // --brand-gold

const lisse = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);       // pas de cassure aux deux extrémités
};

(async function principal() {
  if (!fs.existsSync(SOURCE)) {
    console.error('[logo] ' + SOURCE + ' introuvable.');
    process.exit(1);
  }

  const { data, info } = await sharp(SOURCE)
    .extract(PANNEAU)
    .resize({ width: LARGEUR_TRAVAIL, kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: W, height: H } = info;
  const rgba = Buffer.alloc(W * H * 4);
  let dores = 0;
  let cremes = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 3;
      const q = (y * W + x) * 4;
      const r = data[p], v = data[p + 1], b = data[p + 2];

      const clarte = r * 0.299 + v * 0.587 + b * 0.114;
      const alpha = y < HAUT_CAPITALES ? 0 : lisse(clarte, OMBRE, LUMIERE);
      const dore = (r - b) > CHALEUR_DOREE;
      const c = dore ? DORE : CREME;

      if (alpha > 0.5) { if (dore) dores++; else cremes++; }
      rgba[q] = c[0]; rgba[q + 1] = c[1]; rgba[q + 2] = c[2];
      rgba[q + 3] = Math.round(alpha * 255);
    }
  }

  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .trim({ threshold: 1 })          // recadre au plus près du lettrage
    .png({ compressionLevel: 9, palette: true })
    .toFile(SORTIE);

  const m = await sharp(SORTIE).metadata();
  console.log('[logo] ' + SORTIE + ' — ' + m.width + '×' + m.height + ', ' +
    Math.round(fs.statSync(SORTIE).size / 1024) + ' Ko ' +
    '(' + cremes + ' pixels blancs, ' + dores + ' dorés)');
})().catch((e) => { console.error('[logo] ' + e.message); process.exit(1); });
