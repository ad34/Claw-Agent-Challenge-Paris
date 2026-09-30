// Une image demandée pendant un redémarrage de l'agent échoue et le navigateur ne réessaie jamais :
// on relance jusqu'à 6 fois, de plus en plus espacé, avec un paramètre anti-cache.
export function retryImg(img: HTMLImageElement) {
  let tries = 0;
  let timer: ReturnType<typeof setTimeout>;
  const onError = () => {
    if (tries >= 6) return;
    tries++;
    timer = setTimeout(() => {
      const url = new URL(img.src);
      url.searchParams.set("retry", String(tries));
      img.src = url.toString();
    }, 1500 * tries);
  };
  const onLoad = () => (tries = 0);
  img.addEventListener("error", onError);
  img.addEventListener("load", onLoad);
  return {
    destroy() {
      clearTimeout(timer);
      img.removeEventListener("error", onError);
      img.removeEventListener("load", onLoad);
    },
  };
}
