// Téléchargement d'assets Poly Haven (CC0) : modèles glTF et HDRI, mis en cache sur disque.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STUDIO_DIR } from "./paths.ts";

const API = "https://api.polyhaven.com";
const UA = { "User-Agent": "night-studio/0.1 (NVIDIA Claw Agent Challenge prototype)" };

async function download(url: string, to: string) {
  if (existsSync(to)) return;
  mkdirSync(dirname(to), { recursive: true });
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

// Modèle glTF (fichier .gltf + .bin + textures) ; renvoie le chemin du .gltf.
export async function polyhavenModel(id: string, res = "2k"): Promise<string> {
  const files = (await (await fetch(`${API}/files/${id}`, { headers: UA })).json()) as any;
  const entry = files.gltf?.[res]?.gltf ?? files.gltf?.["1k"]?.gltf;
  if (!entry) throw new Error(`Pas de glTF pour ${id}`);
  const dir = join(STUDIO_DIR, "assets", "models", id);
  const main = join(dir, entry.url.split("/").pop());
  await download(entry.url, main);
  for (const [rel, inc] of Object.entries<any>(entry.include ?? {})) await download(inc.url, join(dir, rel));
  return main;
}

export async function polyhavenHdri(id: string, res = "2k"): Promise<string> {
  const files = (await (await fetch(`${API}/files/${id}`, { headers: UA })).json()) as any;
  const url = files.hdri?.[res]?.hdr?.url ?? files.hdri?.["1k"]?.hdr?.url;
  if (!url) throw new Error(`Pas de HDRI pour ${id}`);
  const to = join(STUDIO_DIR, "assets", "hdri", `${id}_${res}.hdr`);
  await download(url, to);
  return to;
}

// Sélection d'HDRI adaptées au studio produit (intérieur doux, studio, extérieur lumineux).
export const HDRI_CHOICES = {
  studio_soft: "studio_small_09",
  studio_contrast: "studio_small_03",
  warm_interior: "brown_photostudio_02",
  window_daylight: "small_empty_room_1",
  sunset_outdoor: "kloofendal_48d_partly_cloudy_puresky",
} as const;
