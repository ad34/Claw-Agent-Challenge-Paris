// Mode démo : visites scriptées de l'interface, pour filmer les rushs sans toucher à la souris.
// Déclenchées par `npm run record-ui -- <secondes> <nom> <visite>` (route /api/tour), elles pilotent les vrais
// composants via des commandes : tout ce qu'on voit est l'app réelle et les données réelles du studio.

export type DemoCmd =
  | { type: "reset" }
  | { type: "select"; job: string | "current" }
  | { type: "view"; view: "champion" | "compare" | "3d" }
  | { type: "strip"; mode: "champions" | "all" }
  | { type: "pin"; index: number } // index dans la bande des champions (négatif = depuis la fin)
  | { type: "unpin" }
  | { type: "lightbox"; open: boolean }
  | { type: "lbmode"; mode: "image" | "3d" }
  | { type: "lbnav"; step: number }
  | { type: "zoom"; scale: number; fx?: number; fy?: number } // point de zoom en fraction de l'image
  | { type: "sweep" } // poignée avant / après
  | { type: "intake-open" }
  | { type: "intake-type"; text: string }
  | { type: "intake-send" }
  | { type: "feedback-type"; text: string }
  | { type: "feedback-send" }
  | { type: "scroll"; target: "stage" | "feed"; y: number };

export const demoBus = new EventTarget();
export const sendDemo = (cmd: DemoCmd) => demoBus.dispatchEvent(new CustomEvent<DemoCmd>("demo", { detail: cmd }));

// Abonnement depuis un composant (à appeler dans un $effect, qui renvoie la fonction de nettoyage).
export function onDemo(handler: (cmd: DemoCmd) => void) {
  const l = (e: Event) => handler((e as CustomEvent<DemoCmd>).detail);
  demoBus.addEventListener("demo", l);
  return () => demoBus.removeEventListener("demo", l);
}

// Une visite = des étapes [délai depuis l'étape précédente (ms), commande].
type Step = [number, DemoCmd];

export const TOURS: Record<string, Step[]> = {
  // Le studio travaille : le produit en cours de shooting, journal de l'agent qui défile.
  live: [
    [0, { type: "reset" }],
    [300, { type: "select", job: "current" }],
  ],
  // Le catalogue : on passe d'un produit à l'autre.
  products: [
    [0, { type: "reset" }],
    [300, { type: "select", job: "vase" }],
    [3500, { type: "select", job: "succulent" }],
    [3500, { type: "select", job: "bust" }],
    [3500, { type: "select", job: "watch" }],
    [3500, { type: "select", job: "parfum" }],
    [3500, { type: "select", job: "candle" }],
  ],
  // La progression d'un produit : champions successifs, avant / après, zoom sur le détail.
  progress: [
    [0, { type: "reset" }],
    [300, { type: "select", job: "candle" }],
    [2500, { type: "pin", index: 0 }],
    [2200, { type: "pin", index: 1 }],
    [2200, { type: "pin", index: 2 }],
    [2200, { type: "pin", index: 3 }],
    [2200, { type: "unpin" }],
    [2500, { type: "view", view: "compare" }],
    [2200, { type: "sweep" }],
    [4500, { type: "view", view: "champion" }],
    [1500, { type: "lightbox", open: true }],
    [2500, { type: "zoom", scale: 2.6, fx: 0.5, fy: 0.55 }],
    [3500, { type: "zoom", scale: 1 }],
    [2000, { type: "lightbox", open: false }],
  ],
  // La 3D temps réel : le GLB exporté par Blender, éclairé comme le rendu.
  three: [
    [0, { type: "reset" }],
    [300, { type: "select", job: "watch" }],
    [2500, { type: "view", view: "3d" }],
    [9000, { type: "lightbox", open: true }],
    [1500, { type: "lbmode", mode: "3d" }],
    [14000, { type: "lbmode", mode: "image" }],
    [2500, { type: "lightbox", open: false }],
  ],
  // Un nouveau produit décrit en une phrase : Nemotron Super écrit le brief, Meshy génère la 3D.
  intake: [
    [0, { type: "reset" }],
    [800, { type: "intake-open" }],
    [1200, { type: "intake-type", text: "A hand-thrown speckled stoneware coffee mug with a curved walnut handle, for a slow-living coffee brand" }],
    [6500, { type: "intake-send" }],
  ],
  // La marque a le dernier mot : une note sur le rendu, que le planificateur conciliera avec le directeur artistique.
  feedback: [
    [0, { type: "reset" }],
    [300, { type: "select", job: "succulent" }],
    [2500, { type: "scroll", target: "stage", y: 420 }],
    [1500, { type: "feedback-type", text: "Soft morning light on a linen tabletop. Keep it airy and Scandinavian." }],
    [5500, { type: "feedback-send" }],
    [2500, { type: "scroll", target: "stage", y: 0 }],
  ],
};

let running = 0;
export async function runTour(name: string) {
  const steps = TOURS[name];
  if (!steps) return;
  const id = ++running;
  for (const [delay, cmd] of steps) {
    await new Promise((r) => setTimeout(r, delay));
    if (id !== running) return; // une autre visite a démarré
    sendDemo(cmd);
  }
}

// Saisie « humaine » : le texte apparaît caractère par caractère (environ 25 caractères par seconde).
export function typeInto(text: string, set: (v: string) => void, cps = 25) {
  let i = 0;
  const t = setInterval(() => {
    i++;
    set(text.slice(0, i));
    if (i >= text.length) clearInterval(t);
  }, 1000 / cps);
}

