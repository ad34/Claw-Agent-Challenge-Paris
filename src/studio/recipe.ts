// Recette de prise de vue. Le planificateur (LLM) propose des recettes ; on les borne ici
// pour qu'une idée farfelue produise au pire un rendu raté, jamais un crash ou un rendu de 20 minutes.
import { HDRI_CHOICES, polyhavenHdri } from "./assets.ts";

export interface Light {
  type: "area" | "spot" | "point";
  azimuth: number;
  elevation: number;
  power: number;
  size?: number;
  color?: string;
  distance?: number;
}

export interface Recipe {
  resolution?: [number, number];
  samples?: number;
  hdri?: string | null; // clé de HDRI_CHOICES côté LLM, chemin côté rendu
  hdri_strength?: number;
  hdri_rotation_deg?: number;
  world_color?: string;
  world_strength?: number;
  background: { type: "sweep" | "floor" | "none"; color: string; roughness?: number };
  pedestal?: { shape: "cylinder" | "box"; color: string; height?: number; scale?: number; roughness?: number; metallic?: number } | null;
  lights: Light[];
  camera: { azimuth: number; elevation: number; focal_mm: number; fill?: number; dof?: boolean; fstop?: number; look_offset_z?: number };
  product?: { rotation_deg?: number };
  exposure?: number;
}

export const RECIPE_DOC = `Recipe JSON fields (all angles in degrees; azimuth 0 = in front of the product, 90 = its right side, 180 = behind):
- hdri: one of ${Object.keys(HDRI_CHOICES).join(", ")} or null (then world_color/world_strength give ambient light)
- hdri_strength: 0.1..3, hdri_rotation_deg: 0..360
- background: {type: "sweep" (seamless studio cyclorama) | "floor" (infinite floor, HDRI visible as horizon), color: "#rrggbb", roughness 0..1}
- pedestal: null or {shape: "cylinder"|"box", color: "#rrggbb", height 0.05..0.6 (product height = 1), scale 0.5..1.5 (radius vs product footprint), roughness, metallic}
- lights: 0..4 of {type: "area"|"spot"|"point", azimuth, elevation -10..85, power 10..2000 (watts), size 0.2..4 (softbox size), color "#rrggbb", distance 1..5}
- camera: {azimuth -90..90, elevation -5..60, focal_mm 24..200, fill 0.3..0.9 (share of frame the product fills), dof bool, fstop 1.4..16, look_offset_z -0.5..0.5}
- product: {rotation_deg 0..360}
- exposure: -2..2`;

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const hex = (v: unknown, dflt: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : dflt);

export function sanitize(r: any): Recipe {
  const cam = r?.camera ?? {};
  const bg = r?.background ?? {};
  const ped = r?.pedestal;
  return {
    resolution: [1080, 1350],
    samples: 128,
    hdri: r?.hdri && r.hdri in HDRI_CHOICES ? r.hdri : null,
    hdri_strength: clamp(r?.hdri_strength, 0.1, 3, 1),
    hdri_rotation_deg: clamp(r?.hdri_rotation_deg, 0, 360, 0),
    world_color: hex(r?.world_color, "#202020"),
    world_strength: clamp(r?.world_strength, 0, 2, 0.3),
    background: { type: ["sweep", "floor", "none"].includes(bg.type) ? bg.type : "sweep", color: hex(bg.color, "#e9e6e1"), roughness: clamp(bg.roughness, 0, 1, 0.7) },
    pedestal: ped
      ? {
          shape: ped.shape === "box" ? "box" : "cylinder",
          color: hex(ped.color, "#d9d4cc"),
          height: clamp(ped.height, 0.05, 0.6, 0.2),
          scale: clamp(ped.scale, 0.5, 1.5, 0.8),
          roughness: clamp(ped.roughness, 0, 1, 0.5),
          metallic: clamp(ped.metallic, 0, 1, 0),
        }
      : null,
    lights: (Array.isArray(r?.lights) ? r.lights : []).slice(0, 4).map((l: any) => ({
      type: ["area", "spot", "point"].includes(l?.type) ? l.type : "area",
      azimuth: clamp(l?.azimuth, -180, 180, 45),
      elevation: clamp(l?.elevation, -10, 85, 35),
      power: clamp(l?.power, 10, 2000, 300),
      size: clamp(l?.size, 0.2, 4, 1.2),
      color: hex(l?.color, "#ffffff"),
      distance: clamp(l?.distance, 1, 5, 2.5),
    })),
    camera: {
      azimuth: clamp(cam.azimuth, -90, 90, 15),
      elevation: clamp(cam.elevation, -5, 60, 10),
      focal_mm: clamp(cam.focal_mm, 24, 200, 70),
      fill: clamp(cam.fill, 0.3, 0.9, 0.6),
      dof: !!cam.dof,
      fstop: clamp(cam.fstop, 1.4, 16, 4),
      look_offset_z: clamp(cam.look_offset_z, -0.5, 0.5, 0),
    },
    product: { rotation_deg: clamp(r?.product?.rotation_deg, 0, 360, 0) },
    exposure: clamp(r?.exposure, -2, 2, 0),
  };
}

// Côté rendu : la clé d'HDRI devient un chemin de fichier (téléchargé au besoin).
export async function resolveForRender(r: Recipe): Promise<Recipe> {
  return { ...r, hdri: r.hdri ? await polyhavenHdri(HDRI_CHOICES[r.hdri as keyof typeof HDRI_CHOICES]) : null };
}

// Point de départ volontairement basique : c'est à l'agent de trouver mieux.
export const STARTER: Recipe = sanitize({
  hdri: "studio_soft",
  hdri_strength: 0.6,
  background: { type: "sweep", color: "#d8d8d8" },
  pedestal: null,
  lights: [{ type: "area", azimuth: 0, elevation: 30, power: 250, size: 1.2 }],
  camera: { azimuth: 0, elevation: 8, focal_mm: 50, fill: 0.55 },
});
