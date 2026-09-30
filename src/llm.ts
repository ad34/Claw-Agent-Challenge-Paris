// Client Nemotron (build.nvidia.com, API compatible OpenAI) avec boucle d'appels d'outils.
export const MODEL = process.env.NVIDIA_MODEL ?? "nvidia/nemotron-3-super-120b-a12b";
const ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  run: (args: any) => Promise<unknown>;
}

export interface ChatOpts {
  tools?: Tool[];
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
  json?: boolean;
}

// build.nvidia.com : pas de crédits, mais une limite de 40 requêtes/min par compte. Tous les appels
// (planificateur, critique, intake) passent par cette fenêtre glissante plafonnée à 30/min, retries compris.
export const NVIDIA_RPM = Number(process.env.NVIDIA_RPM ?? 30);
const recent: number[] = [];
let gate = Promise.resolve();

async function slot() {
  const turn = gate.then(async () => {
    for (;;) {
      const now = Date.now();
      while (recent.length && now - recent[0] >= 60_000) recent.shift();
      if (recent.length < NVIDIA_RPM) return void recent.push(now);
      await new Promise((r) => setTimeout(r, 60_000 - (now - recent[0]) + 50));
    }
  });
  gate = turn;
  return turn;
}

export const nvidiaCallsLastMinute = () => recent.filter((t) => Date.now() - t < 60_000).length;

// POST vers l'API NVIDIA avec limite de débit et reprises (429/5xx : attente exponentielle ;
// 403 : un seul nouvel essai, le service en renvoie parfois de passagers).
export async function nvidiaPost(body: unknown, label: string, retries = 4, baseMs = 2000): Promise<any> {
  let forbidden = 0;
  for (let attempt = 0; ; attempt++) {
    await slot();
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await new Promise((r) => setTimeout(r, baseMs * 2 ** attempt));
      continue;
    }
    if (res.status === 403 && forbidden++ < 1) {
      await new Promise((r) => setTimeout(r, 20_000));
      continue;
    }
    throw new Error(`${label} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

export async function chat(messages: Message[], opts: ChatOpts = {}) {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.2,
    chat_template_kwargs: { enable_thinking: opts.thinking ?? false },
  };
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = "auto";
  }
  if (opts.json) body.response_format = { type: "json_object" };

  const j = await nvidiaPost(body, "Nemotron");
  return { message: j.choices[0].message as { content: string | null; tool_calls?: ToolCall[] }, usage: j.usage };
}

export interface Trace {
  tool: string;
  args: unknown;
  result: unknown;
}

// Boucle agentique : le modèle appelle des outils jusqu'à produire une réponse finale.
export async function runAgent(messages: Message[], tools: Tool[], opts: { maxSteps?: number; onTool?: (t: Trace) => void } = {}) {
  const trace: Trace[] = [];
  const byName = new Map(tools.map((t) => [t.name, t]));
  for (let step = 0; step < (opts.maxSteps ?? 10); step++) {
    const { message } = await chat(messages, { tools });
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });
    if (!message.tool_calls?.length) return { content: message.content ?? "", trace, messages };
    for (const call of message.tool_calls) {
      const tool = byName.get(call.function.name);
      let result: unknown;
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
        result = tool ? await tool.run(args) : { error: `outil inconnu ${call.function.name}` };
      } catch (err) {
        result = { error: (err as Error).message };
      }
      const t = { tool: call.function.name, args, result };
      trace.push(t);
      opts.onTool?.(t);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result ?? null).slice(0, 6000) });
    }
  }
  // Plus d'étapes : on force une réponse finale sans outils.
  messages.push({ role: "user", content: "Tu as atteint la limite d'étapes. Donne maintenant ta réponse finale au format demandé." });
  const { message } = await chat(messages);
  return { content: message.content ?? "", trace, messages };
}

// Extrait le premier objet JSON d'une réponse (le modèle l'entoure parfois de ```json,
// ou laisse une virgule finale / un commentaire) et le répare au passage.
export function parseJson<T = any>(text: string): T {
  const obj = firstObject(text);
  if (!obj) throw new Error(`Pas de JSON dans la réponse : ${text.slice(0, 200)}`);
  try {
    return JSON.parse(obj) as T;
  } catch {
    const repaired = obj
      .replace(/\/\/[^\n"]*$/gm, "") // commentaires en fin de ligne
      .replace(/,\s*([}\]])/g, "$1"); // virgules finales
    return JSON.parse(repaired) as T;
  }
}

// Premier objet JSON complet (accolades équilibrées, hors chaînes) : le modèle ajoute parfois du texte
// ou un second objet après, qu'une regex gloutonne engloberait.
function firstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start); // tronqué : on laisse JSON.parse / la réparation échouer proprement
}

// Demande une réponse JSON ; si elle est invalide, redemande une fois en montrant l'erreur.
export async function chatJson<T = any>(messages: Message[], opts: ChatOpts = {}): Promise<T> {
  const first = await chat(messages, opts);
  try {
    return parseJson<T>(first.message.content ?? "");
  } catch (err) {
    return retryJson<T>(messages, first.message.content ?? "", err as Error, opts);
  }
}

export async function retryJson<T>(messages: Message[], badContent: string, err: Error, opts: ChatOpts = {}): Promise<T> {
  const retry = await chat(
    [
      ...messages,
      { role: "assistant", content: badContent },
      { role: "user", content: `Ta réponse n'est pas du JSON valide (${err.message.slice(0, 120)}). Renvoie uniquement l'objet JSON, sans commentaire.` },
    ],
    { ...opts, tools: undefined },
  );
  return parseJson<T>(retry.message.content ?? "");
}
