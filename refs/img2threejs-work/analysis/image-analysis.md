# Image Analysis — `reference.png`

Reference: 2000×1125 PNG, three orthographic views on a shared ground plane and a common
horizontal guide grid: **front (view A, x≈0–660)**, **right side (view B, x≈660–1330)**,
**back (view C, x≈1330–2000)**. Views A and C share the same crown/ground guide lines, so the
sheet is dimensionally usable for proportion lock.

## Layer 1 — Identification & classification

- **Work type:** stylized chibi character turnaround sheet (figurine-style), not a photograph.
- **Broad classification:** humanoid character (stylized/chibi, hard-surface-assisted hair).
- **`primaryDomain`:** `character` (secondary read: `hybrid` — the hair masses are deliberately
  hard-surface, near-cuboid, Minecraft-like blocks, so the reconstruction mixes a smooth chibi
  body/face with a faceted hair shell).
- **Confidence:** 0.96 that this is a chibi character; 0.9 on the hard-surface hair read.

## Layer 2 — Overall form & silhouette

- **Bounding volume:** a tall narrow cuboid dominated at the top by two long lateral
  spikes (twin-tails) that flare past shoulder width and drop below the hips.
- **Symmetry:** bilateral (left/right mirror) about the vertical body axis in view A and C.
- **Shape language:** geometric/hard-surface head and hair; soft-rounded organic limbs and head
  volume; the silhouette is a broad "T" at the hair line, then a narrow column for the body.
- **Proportion relative to named dimension:** measured in head-units (HU). Head height ≈ 410 px of
  a ≈ 950 px crown-to-ground span → **≈ 2.3–2.5 HU total**, i.e. the chibi/figurine band
  (2–3 HU), with head ≈ 40–45% of total height.

## Layer 3 — Macro → meso → micro decomposition

**Macro (independent major parts)**
1. Head assembly (skull + face + hair shell)
2. Torso (coat + halter top + exposed midriff)
3. Arms ×2 (sleeve, cuff, glove)
4. Hips/pelvis (shorts + belt)
5. Legs ×2 (thigh + boot)
6. Twin-tail hair masses ×2

**Meso (sub-assemblies)**
- Head: crown blocks, fringe/bangs, lateral "ear-cup" blocks, face plate, eyes, mouth
- Torso: open coat (2 front panels + 2 back panels), hood (collapsed, behind neck), white star
  on the back, halter neck strap + ring, choker, belly/navel
- Arms: upper sleeve, forearm sleeve, white trim bands, fingerless glove
- Hips: shorts, white belt + square buckle
- Legs: bare thigh, tall boot shaft, white chevron trim, sole/wedge

**Micro (feature groups)**
- Twin-tail: 3–4 stacked angular segments per tail, tapering, with a notched/spiky distal fan
- Coat: white edge linework on every panel border, star appliqué, panel splits
- Boots: white overlay chevrons at ankle, cuff band, buckle tabs
- Face: thick black eye outline ring, blank white sclera, small horizontal mouth

## Layer 4 — Spatial relationships (scene-graph)

- `<twin-tails, attached-to, hair shell at azimuth ±90°, superior-lateral>` — contact: embedded root
- `<hair shell, sits-on, skull>`, contact: overlap
- `<fringe, occludes, forehead>` — contact: flush-with
- `<hood, behind, neck/shoulders>`, contact: overlap on back of coat
- `<coat panels, hang-from, shoulder seam>`, open at front, contact: overlap
- `<gloves, surround, wrist>`, contact: socket
- `<boots, surround, lower leg from knee>`, contact: socket
- `<belt, around, waist>`, contact: flush-with
- `<arms, lateral-of, torso, abducted ≈ 25–30° in view A>`

## Layer 5 — Materials & surface (PBR)

| Part | Albedo | Metalness | Roughness | Notes |
|---|---|---|---|---|
| Skin | warm pale `#F2DED2` | 0.0 | ≈0.55 | matte, almost no specular read |
| Hair | near-black `#141414` → `#1E1E1E` | 0.0 | ≈0.42 | faceted flat planes, sharp facet-to-facet value steps; broad low-frequency sheen, no strand specular |
| Coat / shorts / boots | black `#131313` | 0.0 | ≈0.5 (satin) | matte-satin cloth, subtle broad highlight on the sleeve |
| White trim / star | `#E9E9E9` | 0.0 | ≈0.45 | matte screen-print white, hard boundary |
| Eyes (sclera) | `#FBFBFB` | 0.0 | ≈0.15 | bright, reads glossy/blank with a hard black limbal ring |
| Eye outline / choker | `#0A0A0A` | 0.0 | ≈0.4 | pure dark linework |
| Buckle / ring hardware | `#B9B9B9` | 0.75 | ≈0.3 | only true metal in the subject |

## Layer 6 — Color & finish

- **Palette:** two-value scheme. Black family (hue 0, value 0.06–0.12) over warm pale skin
  (hue ≈ 25°, low sat, high value) with a neutral light-gray/white accent family
  (value 0.90) used exclusively as linework, trim, and the single back star.
- **Finish:** everything is **matte-to-satin**; no gloss and no true metallic across the cloth.
  Flat bounded regions throughout — every white mark is a hard-edged shape, not a gradient.

## Layer 7 — Identity-defining features

1. **Long black twin-tails** — extremely long (past hip, ≈ 55% of total height), thick at the root,
   segmented into stacked angular slabs, terminating in a spiky fan.
2. **Blocky faceted hair shell** — cuboid fringe blocks and lateral "ear-cup" slabs; this is
   the most unusual stylistic feature and must not be smoothed into organic hair.
3. **Blank round white eyes with a thick black ring** — no visible iris or pupil. Extremely
   distinctive; a generic anime eye would break the likeness.
4. **Open black coat with white edge linework and a large white star centered on the back**.
5. **Black halter/bikini top with exposed midriff** (bare torso band between top and shorts).
6. **Black shorts + white belt with a square buckle**.
7. **Tall black boots with white ankle chevrons**.
8. **Black fingerless gloves and a choker with a metal ring**.
9. **Chibi proportions (~2.4 HU)** — an adult proportion would be a wrong reconstruction.

## Layer 8 — Uncertainty & single-image limits

- **Hidden:** the underside of the fringe, the inner surface of the coat, the back of the head
  under the hair shell, the exact hood geometry between view B and view C.
- **Occluded:** hands are largely hidden by the long sleeves; the glove fingers are not resolvable.
- **Uncertain:** the twin-tail cross-section (flat ribbon vs square prism) — views A/B are thin
  in x, C is wider in y, so I read it as a **flattened rectilinear ribbon**, low confidence.
- **Needs another view:** none critical — three orthogonal views are present, so the reconstruction
  can proceed; only the hood's internal fold and the coat's inner face remain inferred.
- **`unknownsToResolveBeforeImplementation`:** twin-tail cross-section profile; hood volume behind
  the shoulders; coat panel thickness. All three are stated as inferred, not measured.
