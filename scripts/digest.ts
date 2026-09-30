// Envoie tout de suite le bilan (test), sur les rendus des dernières N heures (24 par défaut).
import { activeJobs } from "../src/studio/night.ts";
import { sendDigest } from "../src/studio/telegram.ts";

const hours = Number(process.argv[2] ?? 24);
const since = new Date(Date.now() - hours * 3600_000).toISOString();
for (const job of activeJobs()) await sendDigest(job, since);
