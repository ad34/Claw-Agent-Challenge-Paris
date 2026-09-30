// Clip héros d'un rendu (caméra en mouvement). Usage : npm run clip -- <renderId> [images=120] [échantillons=48]
import { makeClip } from "../src/studio/clip.ts";

const id = Number(process.argv[2]);
if (!id) {
  console.error("Usage : npm run clip -- <renderId> [images] [échantillons]");
  process.exit(1);
}
const out = await makeClip(id, { frames: process.argv[3] ? Number(process.argv[3]) : undefined, samples: process.argv[4] ? Number(process.argv[4]) : undefined });
console.log(`✓ ${out}`);
