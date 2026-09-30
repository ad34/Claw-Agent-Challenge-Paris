import { homedir } from "node:os";
import { join } from "node:path";

export const STUDIO_DIR = process.env.STUDIO_DIR ?? join(homedir(), ".night-studio");
export const BLENDER = process.env.BLENDER_PATH ?? "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe";
