<script lang="ts">
  import gsap from "gsap";

  let { value, format = (n: number) => Math.round(n).toLocaleString("en-US") }: { value: number; format?: (n: number) => string } = $props();

  // Le chiffre « roule » jusqu'à sa nouvelle valeur et s'illumine brièvement : on voit le studio produire.
  const tween = { v: 0 };
  let shown = $state(format(0));
  let el: HTMLElement;

  $effect(() => {
    const target = value;
    const initial = tween.v === 0;
    gsap.to(tween, { v: target, duration: initial ? 1.4 : 0.9, ease: "power3.out", onUpdate: () => (shown = format(tween.v)) });
    if (!initial && el) gsap.fromTo(el, { color: "#76b900" }, { color: "#e6e9e1", duration: 1.4, ease: "power2.out" });
  });
</script>

<span class="num" bind:this={el}>{shown}</span>
