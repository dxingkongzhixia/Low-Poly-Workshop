# ThreejS_Standard_modeling

Three.js low-poly / stylized 3D modeling and modular asset-assembly skill, distilled from the public Bilibili Toy demo at:

`https://www.bilibili.com/toy/ChtnnVPvxjymK5f9/index.html`

## Purpose

Use this skill when creating a stylized Three.js character, prop, or scene that should match the reference project's visual and technical language. The bundled reference is for study and comparison; do not copy branded characters, logos, dialogue, music, or other protected content into a new commercial project without permission.

## READ FIRST — the standard model is the base

👉 **Read `USAGE.md` before building anything.** It is the complete usage manual.

The rule that matters most:

```
The standard model (reference/iE.json) is the base.
Reference images only supply details (clothes, hair, palette, props).

  ❌ rebuild human proportions from the reference image
  ✅ keep standard proportions, layer reference details on top
```

Every reference image must be adapted to the standard's look (a ~2.4-head chibi facing +Z), not the other way round. Open the standard project to see it: `viewer/`.

Measured skeleton data is already extracted to `reference/standard-landmarks.json`. Regenerate with `node tools/measure-standard.js reference/iE.json`.

### Feature-led beats image-led (field note)

The best results came from letting the model **identify the character's signature features and choose the construction itself**, not from tracing a reference image pixel by pixel.

- ✅ **Feature-led** — hand over the identity as a short feature list (silhouette, hair, palette, one or two props, a signature gesture) and let the model decide which `stack` / `shapeExtrude` / `ribbon` / `panel` builds each one, on top of the standard skeleton. The two shipped code-built characters (`HATSUNE MIKU`, `BLACK★ROCK SHOOTER` — see `docs/lowpoly-runtime.md`) were made exactly this way, entirely in code, and read better than any image-matched attempt.
- ❌ **Image-led** — "make it look exactly like this picture" pushes the model into per-pixel silhouette matching: it fights the standard proportions, over-fits a single view, and comes back with flat, un-articulated shapes.

**Where do the features come from?** By default, **let the agent collect them itself** — research the character's public materials online and reduce them to a short feature list. **You do not need the user to supply an image.**

**If you do have a reference image**, mine it for *features* only — hair shape, palette, props, the few big shapes in the silhouette, one signature gesture. **Never take its body proportions.**

**Where does the body come from?** Always the **original models** — the standard skeleton constants (`docs/ai-pipeline.md` §11.1), or measure a shipped model with `EditorAPI.boxify('<id>')` / `ModelReadout.dump()`.

So: keep the **original-model body**, and spend the reference budget on **features, not tracing**. A feature list is worth more than a photo.

## Included materials

- `USAGE.md` — **complete usage manual. Start here.**
- `source/` — downloaded public HTML shell, bundled JavaScript, and CSS snapshot. This is a build artifact, not the original authoring repository.
- `reference/` — the standard model data. `iE.json` is the canonical Classic standard; `aE.json` is the Desolate variant; `PE.json`, `yD.json`, `dO.json` are identical Classic runtime copies. `standard-landmarks.json` holds the measured skeleton.
- `viewer/` — **the standard project.** Loads the standard model, switches variants, toggles categories, shows wireframe and triangle stats. Open `viewer/index.html` via a local static server.
- `tools/measure-standard.js` — regenerates the landmark report from any standard-model JSON.
- `ANALYSIS.md` — detailed modeling, materials, scene, performance, and reconstruction notes.
- `manifest.json` — provenance and extraction metadata.
- `kit/standard-modeling-kit.js` — reusable custom-geometry builders and modular assembly helpers. It creates authored-looking meshes from profiles, ribbons, panels, sweeps, bevelled contours, and joint groups; it is not a collection of Box/Sphere shortcuts.
- `kit/example-character.js` — small API sample. Not a visual quality bar.
- `projects/girl-character/` — worked example: the standard model's neutral anatomy kept as the base, with original black-twin-tail / black-coat details layered on. 1921 triangles, Classic/Alternate variants, real joint pivots, weapon mounts, and a full viewer.

## Geometry core (use these, not stock primitives)

| Need | Function | Why |
|---|---|---|
| Connected organic volume (torso, head, limb, tail, boot) | `loft(rings)` / `stack(rows, sides, ...)` | Cross-sections are perpendicular to the sweep axis, so forms are solid—never paper-thin |
| Costume panel, emblem, belt buckle, silhouette detail | `panel()` / `shapeExtrude()` | Extrudes an authored XY outline; `shapeExtrude` handles concave shapes such as stars |
| Piping, strap, blade, trim following a curve | `ribbon(path, widths, thickness)` | Sections are oriented perpendicular to the path |

`stack` accepts an options object: pass `{capStart:false, capEnd:false}` for parts whose ends are hidden inside another part. This is the main triangle-budget lever.

### Pitfall that produced a broken earlier version

A naive sweep that builds each cross-section in the XY plane and moves it along Y creates a **flat sheet**, not a tube. Always build cross-sections perpendicular to the sweep direction. `loft`/`stack` here use XZ rings advanced along Y, which is correct for upright bodies.

### Parenting pitfall

Registering a mesh in a category map does **not** add it to the scene graph, and a pivot with a non-zero position shifts all children. Either author geometry in local pivot space, or author in character space and wrap it in an offset rig group (see `head-rig` in the example project).

## Workflow

Full step-by-step instructions live in `USAGE.md`. Summary:

1. Measure the standard: `node tools/measure-standard.js reference/iE.json` (or read `reference/standard-landmarks.json`).
2. Load the standard model and keep only the neutral anatomy categories (`基础头型`, `基础身体`, `基础手臂（含手）`, `基础腿部`). Do **not** reparent those meshes.
3. Translate the reference image into a detail list (hair, coat, palette, props) — proportions come from the standard, not the image.
4. Author each detail with `stack` / `loft` / `shapeExtrude` / `ribbon` in the standard's world coordinates.
5. Assemble with real joint pivot groups and add `hand-weapon-mount-L/R`.
6. Keep the triangle count in 1800–2400 using hidden-end caps (`{capStart:false, capEnd:false}`).
7. Verify against the acceptance checklist in `USAGE.md`.

## Standard acceptance checklist

- Low-poly silhouette reads correctly at thumbnail size.
- Primary forms are separate, named meshes or groups.
- Articulation pivots are located at joints and preserved through export.
- Flat layered hair, ears/tail, sleeves, boots, weapons, and clothing trims are independently editable.
- No accidental enclosed/interior faces or duplicate surfaces.
- Materials use a restrained palette and roughness-first stylized PBR.
- Complex-looking forms are created by silhouette/profile geometry, not by hiding a stack of primitive solids.
- Each visible module can be replaced without changing the skeleton or neighboring modules.
- The asset remains usable on a mid-range device with an explicit triangle budget.

## What can and cannot be reverse engineered

The public bundle allows us to recover the final mesh buffers, material parameters, node hierarchy, pivots, names, triangle budgets, and runtime transformations. It does not reveal the original DCC scene, sculpt history, retopology steps, authoring scripts, source textures before packing, or the exact artist decisions. The correct goal is therefore to reproduce the **construction grammar**, not to claim recovery of the original authoring source.

The construction grammar is reproducible:

```text
silhouette/profile design
  -> custom low-poly geometry
  -> separate semantic parts
  -> joint/pivot hierarchy
  -> clothing and detail overlays
  -> material and texture variants
  -> runtime assembly / animation
```

### Required modeling strategy

Do not satisfy a modeling request with `new BoxGeometry()` repeated for every body part. Use stock primitives only as hidden support volumes or blockout guides. The visible result should use at least two of these authored construction methods:

- `stack` / `loft`: connect XZ elliptical rings along Y — the primary tool for torso, head, limbs, tails, boots;
- `shapeExtrude`: extrude an authored XY outline, including concave shapes (stars, emblems, spikes);
- `ribbon`: sweep a rectangular section perpendicular to a 3D path (piping, straps, blades);
- `panel`: a shallow costume silhouette;
- `ring` + manual placement: custom sections with changing radii and offsets.

`kit/example-character.js` is only an API usage sample. It is not a visual quality bar. The standard model in `reference/` and the standard project in `viewer/` are the visual and structural standard. A new character keeps the standard's proportions and part grammar, and adds original detail on top.

## Viewer commands

From this skill directory:

```bash
npx --yes http-server viewer -p 4173
```

Then open `http://localhost:4173`.
