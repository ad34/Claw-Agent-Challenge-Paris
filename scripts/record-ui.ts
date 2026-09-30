// Enregistre UNIQUEMENT la zone de la fenêtre « Night Studio » (Tauri) en MP4 1920×1080 30 i/s.
// Usage : npm run record-ui -- 60 ui_live      → 60 s dans ~/.night-studio/rushes/ui_live.mp4
//
// Capture GPU via ddagrab (Desktop Duplication) : gdigrab rend une WebView2 en noir.
// La capture est limitée au rectangle de la fenêtre, qui est mise au premier plan avant :
// rien d'autre de l'écran n'est jamais enregistré. Écran principal uniquement.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { STUDIO_DIR } from "../src/studio/paths.ts";

const seconds = Number(process.argv[2] ?? 30);
const name = process.argv[3] ?? `ui_${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
const out = join(STUDIO_DIR, "rushes", `${name}.mp4`);
mkdirSync(join(STUDIO_DIR, "rushes"), { recursive: true });

// Rectangle de la fenêtre (et passage au premier plan).
const ps = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
}
'@
[void][W]::SetProcessDPIAware()
$p = Get-Process night-studio -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { exit 2 }
[void][W]::ShowWindow($p.MainWindowHandle, 9); [void][W]::SetForegroundWindow($p.MainWindowHandle); Start-Sleep -Milliseconds 400
$r = New-Object W+RECT; [void][W]::GetWindowRect($p.MainWindowHandle, [ref]$r)
"$($r.L) $($r.T) $($r.R) $($r.B)"`;
const rect = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
if (rect.status !== 0) {
  console.error("La fenêtre « Night Studio » est introuvable : lance « npm run tauri dev » dans ui/.");
  process.exit(1);
}
let [l, t, r, b] = rect.stdout.trim().split(/\s+/).map(Number);
// Bordures invisibles de Windows (~8 px) et dimensions paires pour H.264.
l = Math.max(0, l + 8);
r -= 8;
b -= 8;
const w = (r - l) & ~1;
const h = (b - t) & ~1;

console.log(`● Enregistrement de la fenêtre (${w}×${h}) pendant ${seconds} s → ${out}`);
const rec = spawnSync(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `ddagrab=output_idx=0:framerate=30:draw_mouse=1:offset_x=${l}:offset_y=${t}:video_size=${w}x${h},hwdownload,format=bgra`,
    "-t", String(seconds),
    "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0c0e0b",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    out,
  ],
  { stdio: "inherit" },
);
if (rec.status !== 0) process.exit(1);
console.log("✓ Terminé (garde la fenêtre devant pendant l'enregistrement)");
