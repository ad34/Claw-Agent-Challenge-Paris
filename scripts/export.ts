// Livrables d'un rendu : PNG 4K + GLB (produit et socle) + scène .blend autonome.
// Usage : npm run export -- <renderId>     (l'id est affiché dans l'interface, ex. #93)
import { exportNow } from "../src/studio/export.ts";

const id = Number(process.argv[2]);
if (!id) {
  console.error("Usage : npm run export -- <renderId>");
  process.exit(1);
}
console.log(`▶ Export du rendu #${id} en 4K + 3D…`);
const s = await exportNow(id);
if (s.status === "failed") {
  console.error("✗", s.error);
  process.exit(1);
}
console.log(`✓ Terminé en ${s.seconds} s`);
for (const [k, v] of Object.entries(s.files ?? {})) if (v) console.log(`  ${k.padEnd(5)} ${v}  (${Math.round((s.sizes?.[k] ?? 0) / 1024)} Ko)`);
