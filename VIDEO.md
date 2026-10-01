# Vidéo de soumission : intention et rushs

Format : **60 à 90 s**, en anglais, 16:9, YouTube (non répertoriée) ou Loom.
Le montage, les captures d'écran et le motion design sont faits à part : ce document décrit l'intention et liste les rushs fournis.

## L'intention

**Une intro NVIDIA de 2-3 s maximum, puis la démo sans temps mort.**

1. **Intro (2-3 s)** : écran brandé NVIDIA, vert NVIDIA sur noir.
   « NVIDIA Paris Claw Agent Challenge · Submission » + le nom **Night Studio** et une ligne :
   *An autonomous product-photo studio that works the night shift.*
   Utiliser les éléments de marque officiels NVIDIA et la mention « Built with NVIDIA Nemotron », sans détourner le logo.
2. **Démo, bam bam** (un plan = une idée, 5-8 s chacun) :

| Temps fort | Ce qu'on montre | Rush |
|---|---|---|
| Le problème | Un produit pris en photo au téléphone | à filmer |
| L'entrée | La photo glissée dans l'app : Nemotron Omni écrit le brief, Meshy fait la 3D | `ui_intake.mp4` |
| La nuit de travail | Des dizaines de rendus qui défilent, le meilleur score qui monte | `flipbook_<produit>.mp4` |
| Comment l'agent décide | Le journal en direct : Plan (Nemotron Super) → Render (RTX) → Critique (Nemotron Omni) → Duel | `ui_live.mp4` |
| La progression | Les champions successifs, score et hypothèse gagnante | `lineage_<produit>.mp4` |
| Le matin | Le bilan Telegram à 7h30, un 🔥 et une note | à filmer (téléphone) |
| L'humain a le dernier mot | La note apparaît, le plan suivant la concilie avec le directeur artistique | `ui_feedback.mp4` |
| Le résultat | Avant / après en volet : premier rendu → champion | `before_after_<produit>.mp4` |
| La fin | 360° du champion + « Night Studio » | `turntable_<produit>_16x9.mp4` |

À faire entendre ou voir : **Nemotron Super** (planification), **Nemotron Omni** (brief et critique visuelle),
**build.nvidia.com**, **RTX 4080 SUPER** (rendu Cycles), **toute la nuit sans intervention**, **l'humain dans la boucle**.
Les chiffres à l'écran (rendus, minutes GPU, score de départ → champion) sont dans `manifest.json`.

## Les rushs

Dossier : `C:\Users\nico\.night-studio\rushes\` — 1920×1080, 30 i/s, H.264.

**Chiffres de la nuit du 30 septembre au 1er octobre** (pour l'écran et la voix off) : 1 716 rendus, 171 min de GPU, 56 champions,
environ 5 appels Nemotron par minute. Catalogue : vase en céramique (62 → 77), succulente (55 → 73), buste en marbre (60 → 75),
montre à gousset (75 → 82), parfum Noir Éclat (70 → 73), bougie terracotta (60 → 77). Détails dans `manifest.json`.

| Commande | Fichiers |
|---|---|
| `npm run rushes` | `lineage_*.mp4`, `flipbook_*.mp4`, `before_after_*.mp4`, `contact_*.png` (planche de tous les rendus), `manifest.json` |
| `npm run clip -- <renderId>` | `exports/<produit>/<produit>_r<id>_clip.mp4` (1080×1350, 4 s) : clip héros du champion, caméra en mouvement |
| `npm run turntable -- <jobId>` | `turntable_*.mp4` (1080×1350) et `turntable_*_16x9.mp4` : 360° du champion, ≈ 10 min de rendu |
| `npm run record-ui -- <secondes> <nom> [visite]` | `<nom>.mp4` : capture de la fenêtre Night Studio **uniquement**, 1920×1080 natif |

**Captures de l'interface en mode démo.** Les visites sont scriptées dans `ui/src/demo.ts` : l'app se pilote seule, sans souris,
avec les vraies données. **Écran allumé obligatoire** : un écran en veille ne livre plus d'images, et le script coupe alors l'enregistrement.

| Visite | Commande | Ce qu'on voit |
|---|---|---|
| `products` | `npm run record-ui -- 25 ui_products products` | Le catalogue, produit par produit ✅ |
| `live` | `npm run record-ui -- 32 ui_live live` | Le produit en cours de shooting, journal de l'agent qui défile ✅ |
| `progress` | `npm run record-ui -- 34 ui_progress progress` | Bougie : champions successifs, avant / après balayé, zoom plein écran ✅ |
| `three` | `npm run record-ui -- 32 ui_3d three` | Montre : vue 3D temps réel, puis plein écran 3D ✅ |
| `feedback` | `npm run record-ui -- 22 ui_feedback feedback` | Succulente : note de la marque tapée et envoyée (vraie note, prise en compte par l'agent) ✅ — couper avant 15 s |
| `intake` | `npm run record-ui -- 32 ui_intake intake` | Nouveau produit décrit en une phrase : la tasse en grès (vrai envoi à Meshy) ✅ |

Rushs à filmer à la main : la photo du produit au téléphone, et l'écran du téléphone au moment du bilan Telegram
(vérifier qu'aucune notification ou conversation perso n'apparaît).

## Calendrier

- **Ce soir** : run officiel sur une base propre.
- **Demain matin** : bilan Telegram (à filmer), réactions, puis `npm run rushes` et `npm run turntable -- <id>`, captures `record-ui`.
- **2 octobre au soir** : vidéo en ligne et formulaire Airtable envoyé (deadline : 3 octobre, 8h59 heure de Paris).
