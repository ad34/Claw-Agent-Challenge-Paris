// Enregistre UNIQUEMENT la fenêtre « Night Studio » (Tauri) en MP4 1920×1080 30 i/s.
// Usage : npm run record-ui -- 60 ui_live [visite]   → 60 s dans ~/.night-studio/rushes/ui_live.mp4
//         visite : live, products, progress, three, intake, feedback (mode démo, voir ui/src/demo.ts)
//
// Capture GPU via ddagrab (Desktop Duplication) : gdigrab rend une WebView2 en noir. ddagrab filme une zone
// de l'écran, pas une fenêtre : on garantit donc que cette zone ne montre QUE Night Studio.
// - la fenêtre (même rangée dans le tray) est affichée, calée à 1920×1080 de zone utile et mise au-dessus de tout ;
// - avant d'enregistrer, une grille de points est vérifiée (chaque point appartient à la fenêtre), sinon refus ;
// - pendant l'enregistrement, un garde refait la vérification en continu : au moindre recouvrement,
//   l'enregistrement est coupé et le fichier supprimé.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { STUDIO_DIR } from "../src/studio/paths.ts";

const WIN_X = 760; // fenêtre centrée sur l'écran principal 3440×1440 (mise à l'échelle 100 %)
const WIN_Y = 140;
const W = 1920;
const H = 1080;

const seconds = Number(process.argv[2] ?? 30);
const name = process.argv[3] ?? `ui_${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
// Visite scriptée de l'interface (ui/src/demo.ts) : live, products, progress, three, intake, feedback.
const tour = process.argv[4];
const out = join(STUDIO_DIR, "rushes", `${name}.mp4`);
mkdirSync(join(STUDIO_DIR, "rushes"), { recursive: true });

// Zone capturée : la fenêtre moins ses bordures invisibles (8 px à gauche, à droite et en bas).
const L = WIN_X + 8;
const T = WIN_Y;

const ps = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; public POINT(int x, int y) { X = x; Y = y; } }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);
  public static IntPtr Find(uint[] pids) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (Array.IndexOf(pids, pid) >= 0 && sb.ToString().StartsWith("Night Studio")) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  // Chaque point d'une grille 9×7 sur la zone capturée doit appartenir à la fenêtre h.
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  // Renvoie IntPtr.Zero si toute la zone appartient à h, sinon la fenêtre qui la recouvre.
  public static IntPtr Covers(IntPtr h, int l, int t, int w, int hh) {
    for (int i = 0; i <= 8; i++) for (int j = 0; j <= 6; j++) {
      var pt = new POINT(l + 2 + (w - 4) * i / 8, t + 2 + (hh - 4) * j / 6);
      var root = GetAncestor(WindowFromPoint(pt), 2);
      if (root != h) return root == IntPtr.Zero ? new IntPtr(-1) : root;
    }
    return IntPtr.Zero;
  }
}
'@
[void][W]::SetProcessDPIAware()
$pids = [uint32[]]@(Get-Process night-studio -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if (-not $pids) { 'NOWINDOW'; exit }
$h = [W]::Find($pids)
if ($h -eq [IntPtr]::Zero) { 'NOWINDOW'; exit }
$mode = $args[0]
# Écran allumé pendant toute la capture : un écran en veille ne livre plus d'images (vidéo figée, puis plus rien).
if ($mode -eq 'setup' -or $mode -eq 'guard') { [void][W]::SetThreadExecutionState([uint32]'0x80000003') }
if ($mode -eq 'release') { [void][W]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x0013); 'OK'; exit }
if ($mode -eq 'setup') {
  [void][W]::ShowWindow($h, 5); [void][W]::ShowWindow($h, 9)
  # HWND_TOPMOST : rien ne peut passer devant pendant l'enregistrement (hors autres fenêtres « topmost »).
  [void][W]::SetWindowPos($h, [IntPtr](-1), ${WIN_X}, ${WIN_Y}, ${W} + 16, ${H} + 8, 0x0040)
  [void][W]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 800
}
# Vérification (une fois pour 'setup', en boucle pour 'guard').
do {
  $o = [W]::Covers($h, ${L}, ${T}, ${W}, ${H})
  if ($o -eq [IntPtr]::Zero) { 'OK' } else {
    $c = New-Object Text.StringBuilder 256; [void][W]::GetClassName($o, $c, 256); $op = 0; [void][W]::GetWindowThreadProcessId($o, [ref]$op)
    "BAD:$((Get-Process -Id $op -ErrorAction SilentlyContinue).Name):$c"; exit
  }
  if ($mode -eq 'guard') { Start-Sleep -Milliseconds 250 }
} while ($mode -eq 'guard')
`;

const runPs = (mode: string): Promise<string> =>
  new Promise<string>((resolve) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-Command", `& { ${ps} } ${mode}`], { windowsHide: true });
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.on("exit", () => resolve(o.trim().split(/\s+/).pop() ?? ""));
  });

const release = () => runPs("release");

const setup = await runPs("setup");
if (setup !== "OK") {
  await release();
  console.error(
    setup === "NOWINDOW"
      ? "La fenêtre « Night Studio » est introuvable : lance start-night-studio.bat."
      : `Refus : une autre fenêtre recouvre la zone de Night Studio (${setup}). Rien n'a été enregistré.`,
  );
  process.exit(1);
}

console.log(`● Enregistrement de la fenêtre (${W}×${H}) pendant ${seconds} s → ${out}${tour ? ` · visite « ${tour} »` : ""}`);
if (tour) await fetch(`http://127.0.0.1:8787/api/tour/${tour}`, { method: "POST" }).catch(() => console.error("  (API injoignable : pas de visite)"));
const ff = spawn(
  "ffmpeg",
  [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", `ddagrab=output_idx=0:framerate=30:draw_mouse=${tour ? 0 : 1}:offset_x=${L}:offset_y=${T}:video_size=${W}x${H},hwdownload,format=bgra`,
    "-t", String(seconds),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    out,
  ],
  { stdio: ["ignore", "inherit", "inherit"], windowsHide: true },
);

// Garde : au moindre recouvrement, on coupe et on supprime le fichier.
let violated = false;
const guard = spawn("powershell.exe", ["-NoProfile", "-Command", `& { ${ps} } guard`], { windowsHide: true });
guard.stdout.on("data", (d) => {
  if (String(d).includes("BAD") && !violated) {
    violated = true;
    console.error(`  (recouvrement détecté : ${String(d).trim().split(/\s+/).find((x) => x.startsWith("BAD"))})`);
    ff.kill("SIGKILL");
  }
});

// Filet de sécurité : si la capture ne livre plus d'images (écran en veille…), ffmpeg ne s'arrête jamais seul.
let stalled = false;
const watchdog = setTimeout(() => {
  stalled = true;
  ff.kill("SIGKILL");
}, (seconds + 20) * 1000);
const code = await new Promise<number | null>((r) => ff.on("exit", r));
clearTimeout(watchdog);
guard.kill();
await release();
if (stalled) {
  if (existsSync(out)) rmSync(out);
  console.error("✗ La capture ne recevait plus d'images (écran en veille ?) : enregistrement supprimé.");
  process.exit(1);
}
if (violated) {
  if (existsSync(out)) rmSync(out);
  console.error("✗ Une autre fenêtre est passée devant Night Studio : enregistrement coupé et supprimé.");
  process.exit(1);
}
if (code !== 0) process.exit(1);
console.log("✓ Terminé");
