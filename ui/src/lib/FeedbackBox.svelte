<script lang="ts">
  import gsap from "gsap";
  import { tick } from "svelte";
  import { parseFeedback, sendFeedback, type Render } from "../api";

  // Retour de la marque sur le rendu affiché : réactions rapides + note libre.
  // Le planificateur les concilie avec le directeur artistique (la marque a le dernier mot).
  let { render, onSent }: { render: Render; onSent: () => void } = $props();

  const QUICK: [string, string][] = [
    ["love", "🔥 Love it"],
    ["ok", "👍 Good"],
    ["no", "👎 No"],
    ["minimal", "More minimal"],
    ["warm", "Warmer"],
    ["lifestyle", "More lifestyle"],
    ["moody", "Moodier"],
  ];
  const LABEL = Object.fromEntries(QUICK);

  let note = $state("");
  let sending = $state<string | null>(null);
  let error = $state<string | null>(null);
  let list: HTMLUListElement | undefined = $state();
  const history = $derived(parseFeedback(render).slice().reverse());

  async function send(label: string | null) {
    const text = note.trim();
    if (!label && !text) return;
    sending = label ?? "note";
    error = null;
    try {
      await sendFeedback(render.id, label, text || null);
      note = "";
      onSent();
      await tick();
      const first = list?.firstElementChild;
      if (first) gsap.fromTo(first, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" });
    } catch (e) {
      error = (e as Error).message;
    } finally {
      sending = null;
    }
  }
</script>

<section class="rounded-box border border-secondary/25 bg-secondary/5 p-3.5" aria-label="Your feedback on render #{render.id}">
  <div class="mb-2.5 flex items-baseline justify-between">
    <h3 class="text-xs font-medium text-secondary">Your feedback · render #{render.id}</h3>
    <span class="text-[11px] text-base-content/45">Brand notes outrank the art director</span>
  </div>

  <div class="flex flex-wrap gap-1.5">
    {#each QUICK as [key, label]}
      <button class="btn btn-xs {key === 'love' ? 'btn-secondary' : 'btn-soft'}" onclick={() => send(key)} disabled={sending !== null}>
        {#if sending === key}<span class="loading loading-spinner loading-xs"></span>{/if}
        {label}
      </button>
    {/each}
  </div>

  <form
    class="join mt-2.5 w-full"
    onsubmit={(e) => {
      e.preventDefault();
      send(null);
    }}
  >
    <input
      class="input input-sm join-item w-full"
      placeholder="Tell the studio what you want, e.g. less shadow under the product"
      bind:value={note}
      maxlength="600"
      disabled={sending !== null}
      aria-label="Note for the studio"
    />
    <button class="btn btn-sm btn-secondary join-item" type="submit" disabled={sending !== null || !note.trim()}>
      {#if sending === "note"}<span class="loading loading-spinner loading-xs"></span>{/if}
      Send
    </button>
  </form>

  {#if error}<p role="alert" class="mt-2 text-xs text-error">{error}</p>{/if}

  {#if history.length}
    <ul bind:this={list} class="mt-3 grid gap-1.5">
      {#each history as f (f.ts + f.label)}
        <li class="flex gap-2 text-[12px] text-base-content/75">
          <span class="num shrink-0 text-base-content/40">{new Date(f.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
          <span class="text-pretty">
            {#if f.label !== "note"}<span class="text-secondary">{LABEL[f.label] ?? f.label}</span>{/if}
            {#if f.note}{f.label !== "note" ? " · " : ""}"{f.note}"{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
