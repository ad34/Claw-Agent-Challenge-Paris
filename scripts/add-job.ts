// Ajoute un produit à shooter. Usage :
//   npm run add-job -- polyhaven:ceramic_vase_01 "Handmade ceramic vase" "Hero image for an Etsy ceramics shop..."
//   npm run add-job -- C:/chemin/modele.glb "Nom" "Brief"
import { polyhavenModel } from "../src/studio/assets.ts";
import { db, logEvent, now } from "../src/studio/db.ts";

const [source, name, brief] = process.argv.slice(2);
if (!source || !name || !brief) {
  console.error('Usage : npm run add-job -- <polyhaven:id | chemin.glb> "Nom du produit" "Brief"');
  process.exit(1);
}
const model = source.startsWith("polyhaven:") ? await polyhavenModel(source.slice(10)) : source;
const { lastInsertRowid } = db.prepare("INSERT INTO jobs(name, model, brief, created_at) VALUES(?, ?, ?, ?)").run(name, model, brief, now());
logEvent("job", `New product on the shoot list: ${name}`, { jobId: Number(lastInsertRowid) });
