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

| Commande | Fichiers |
|---|---|
| `npm run rushes` | `lineage_*.mp4`, `flipbook_*.mp4`, `before_after_*.mp4`, `contact_*.png` (planche de tous les rendus), `manifest.json` |
| `npm run turntable -- <id>` | `turntable_*.mp4` (1080×1350) et `turntable_*_16x9.mp4` : 360° du champion, ≈ 10 min de rendu |
| `npm run record-ui -- <secondes> <nom>` | `<nom>.mp4` : capture de la fenêtre Night Studio **uniquement**, garder la fenêtre devant |

Rushs à filmer à la main : la photo du produit au téléphone, et l'écran du téléphone au moment du bilan Telegram
(vérifier qu'aucune notification ou conversation perso n'apparaît).

## Calendrier

- **Ce soir** : run officiel sur une base propre.
- **Demain matin** : bilan Telegram (à filmer), réactions, puis `npm run rushes` et `npm run turntable -- <id>`, captures `record-ui`.
- **2 octobre au soir** : vidéo en ligne et formulaire Airtable envoyé (deadline : 3 octobre, 8h59 heure de Paris).
