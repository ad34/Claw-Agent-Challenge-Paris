// Le directeur artistique : Nemotron Omni regarde chaque rendu et le note comme une photo e-commerce.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { STUDIO_DIR } from "./paths.ts";
import { nvidiaPost, parseJson } from "../llm.ts";

export const VISION_MODEL = process.env.NVIDIA_VISION_MODEL ?? "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

export interface Critique {
  score: number; // 0..100
  scores: { composition: number; lighting: number; background: number; product_clarity: number; commercial_appeal: number };
  issues: string[];
  suggestions: string[];
  one_liner: string;
}

const PROMPT = (brief: string, taste: string) => `You are a demanding e-commerce art director reviewing a product photo render.
Brief: ${brief}
Brand taste learned so far:
${taste}

Be harsh and calibrated: 4 = amateur render, 5-6 = acceptable marketplace photo, 7 = strong professional packshot,
9-10 = top-tier brand campaign (rare). A plain grey studio render with flat light is a 5, not an 8.
Judge ONLY what you see. Score each criterion 0-10: composition (framing, placement, negative space),
lighting (shape, contrast, highlights not blown, shadows grounding the product), background (clean, on-brand, not distracting),
product_clarity (product readable, materials convincing), commercial_appeal (would it sell on a Shopify/Etsy page?).
Then list concrete visual issues and actionable suggestions a 3D lighting artist can apply (camera angle, focal length, light
position/intensity/color, background color, pedestal, HDRI mood).
Answer ONLY JSON:
{"scores":{"composition":n,"lighting":n,"background":n,"product_clarity":n,"commercial_appeal":n},
 "issues":["..."],"suggestions":["..."],"one_liner":"short verdict"}`;

const dataUri = async (path: string) =>
  `data:image/jpeg;base64,${(await sharp(path).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()).toString("base64")}`;

export async function critique(imagePath: string, brief: string, taste = "(nothing yet)"): Promise<Critique> {
  const content = [
    { type: "text", text: PROMPT(brief, taste) },
    { type: "image_url", image_url: { url: await dataUri(imagePath) } },
  ];
  const out = await visionJson<Omit<Critique, "score">>(content, 900);
  const s = out.scores;
  const score = Math.round(((s.composition + s.lighting + s.background + s.product_clarity + 2 * s.commercial_appeal) / 60) * 100);
  return { ...out, score };
}

// Duel : laquelle des deux images vendrait le mieux ? Plus fiable qu'une note absolue.
// On présente les images dans les deux ordres pour neutraliser le biais de position.
export async function duel(a: string, b: string, brief: string, taste = "(nothing yet)"): Promise<{ winner: "A" | "B" | "tie"; reason: string }> {
  const ask = async (first: string, second: string) => {
    const content = [
      {
        type: "text",
        text: `You are an e-commerce art director. Brief: ${brief}\nBrand taste: ${taste}\nImage 1 and Image 2 are two hero-photo candidates for the same product. Which one would sell the product better on the store's product page? Answer ONLY JSON: {"winner":1|2,"reason":"one sentence"}`,
      },
      { type: "image_url", image_url: { url: await dataUri(first) } },
      { type: "image_url", image_url: { url: await dataUri(second) } },
    ];
    return visionJson<{ winner: number; reason: string }>(content, 300);
  };
  const r1 = await ask(a, b);
  const r2 = await ask(b, a);
  const aWins = (r1.winner === 1 ? 1 : 0) + (r2.winner === 2 ? 1 : 0);
  if (aWins === 2) return { winner: "A", reason: r1.reason };
  if (aWins === 0) return { winner: "B", reason: r1.reason };
  return { winner: "tie", reason: "avis contradictoires selon l'ordre de présentation" };
}

// Le modèle rend parfois un JSON mal formé : on redemande (jusqu'à 3 essais) plutôt que de perdre le rendu.
export async function visionJson<T>(content: unknown[], maxTokens: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    // À la relance : consigne explicite (les guillemets doubles non échappés dans les textes sont la cause habituelle)
    // et plus de place pour que la réponse ne soit pas coupée.
    const attempt =
      i === 0
        ? content
        : [...content, { type: "text", text: "Your previous answer was not valid JSON. Return strictly valid JSON only. Never use double quotes inside string values (write inches as in, use single quotes)." }];
    let raw = "";
    try {
      raw = await vision(attempt, maxTokens + i * 600);
      return parseJson<T>(raw);
    } catch (err) {
      lastErr = err;
      if (raw) writeFileSync(join(STUDIO_DIR, "last-bad-json.txt"), raw);
    }
  }
  throw lastErr;
}

async function vision(content: unknown[], maxTokens: number): Promise<string> {
  const body = { model: VISION_MODEL, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: "user", content }], chat_template_kwargs: { enable_thinking: false } };
  const j = await nvidiaPost(body, "Vision", 5, 3000);
  return j.choices[0].message.content ?? "";
}
