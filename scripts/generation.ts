// Lance N générations sur tous les produits actifs (test manuel de la boucle).
import { activeJobs, runGeneration } from "../src/studio/night.ts";

const n = Number(process.argv[2] ?? 1);
for (let i = 0; i < n; i++) for (const job of activeJobs()) await runGeneration(job);
