# img2threejs run — Chibi Twin-Tail Character

Reference: a three-view chibi turnaround sheet (front / right / back), 2000×1125.
Output: a code-only procedural Three.js factory, `src/createObjectModel.ts` (transpiled to
`render/createObjectModel.js`), 69 named pivot+mesh parts.

## Verdict

**Improved, not done.** Read `review/gates-as-run.md` before trusting any score below.

| Measure | Value | Threshold | Verdict |
|---|---|---|---|
| Tier 1 silhouette IoU (unaligned) | 0.40–0.47 | 0.85 | **FAIL** |
| Silhouette IoU (bbox-aligned, independent) | 0.63 | 0.85 | short |
| Aspect-ratio delta | 0.067 | 0.05 | **FAIL** |
| Max per-part colour ΔE | 19.9 | 20.0 | pass (barely) |
| Multi-angle degeneracy | not degenerate (0.52× / 1.02× / 0.92×) | >0.15 | pass |
| Interior difference | 0.139 over 10 863 cells | — | measured |
| Assembly / part coverage | 68 specified, 69 built | 0 errors | pass |
| Strict quality | PASS | — | pass |

The deterministic gate **failed on every pass**, and the AI-vision reviews were appended *before*
it was run — the wrong order, which the pipeline forbids. The five `continue` entries are still in
`reviewHistory`; a corrective `refine-spec` entry follows them, and `risks[0]` in the spec states
the failure ahead of every visual score.

## What the model gets right

- **Chibi proportion lock** — 2.6 head units, measured from the sheet (crown 165 px, chin 488 px,
  ground 1017 px), not assumed. Shoulder width 0.75 HU, narrower than the 0.39-unit head.
- **Blank ringed eyes** — two large white discs inside thick black limbal rings, no iris and no
  pupil, at the measured 62 px diameter and 141 px centre separation, seated on the computed
  ellipsoid surface rather than floating in front of it.
- **Blocky faceted hair** — flat cuboid slabs with hard facet-to-facet steps, a raised crown block,
  front fringe that stops at the measured hairline, side locks that narrow the visible face, and
  lateral ear-cup plates at the measured 0.216 lateral extent. Nothing was smoothed.
- **Long twin-tails** — four tapering slabs per side on an outward-then-down arc, widest at the top
  (0.44 units, matching the measured 398 px off-centre maximum) and terminating above the boot tops.
- **Two-value outfit with bounded white accents** — coat trim strips, hem trim, the five-point back
  star, belt, boot chevrons and sleeve bands are all **geometry**, never textures, so they survive a
  relight.
- **Flat matte finish** — roughness 0.72–0.85 on the blacks, matching a reference with no gloss.
- **Action-ready structure** — 69 named pivot nodes, meshes, box colliders and destruction groups
  exposed through `root.userData.sculptRuntime`.

## What it gets wrong, specifically

The bbox-normalised silhouette overlay (`review/silhouette-overlay-fix3.png`; black = agreement,
red = reference only, blue = render only) localises the shortfall:

1. **Tail blades.** The reference's tails are thin, long, tapering curved blades; the built ones are
   chunky rectilinear slabs that stop higher and do not reach as far down.
2. **Lower-body width.** The coat hem, legs and boots are wider than the reference's, which is the
   larger of the two error areas in the overlay.
3. **Hair mass.** Boxier than the reference's shaped bang and side-lock silhouette.
4. **Trim weight.** The white linework is coarser than the reference's fine lines.
5. **Arms.** Read as simple mitts with little visible sleeve break-up.

A single sheet cannot reveal the coat's inner face or the underside of the fringe; those are
inferred and marked as such in `analysis/image-analysis.md` Layer 8.

## Two deviations from the pipeline, both stated rather than silent

1. **Hair role.** The hair components carry `role: "shell"`, not `role: "hair"`. The hair subsystem
   hard-rejects a box primitive for role `hair`, and this subject's hair *is* a set of flat cuboid
   slabs — its single most distinctive feature. No `hairProfile` is emitted, so `scalp_exposure` and
   `hair_gate` do not run. Recorded in `risks`.
2. **Material quality priority.** `lookDevTargets.qualityPriority` is `balanced`, not
   `reference-fidelity`. Every material declares `textureless` with evidence, which the *validator*
   honours, but the *generator's* material-pass gate does not read that declaration. `balanced` is
   how the two gates are kept consistent; it declines a texture bar that does not describe a
   flat-paint subject rather than fabricating texture channels the renderer would never read.
   `qualityTargets.mustMatch` still names every reference feature. Recorded in `risks`.

## Files

| Path | What it is |
|---|---|
| `src/createObjectModel.ts` | the generated factory (all five passes) |
| `render/viewer.html`, `render/createObjectModel.js` | the review harness (plain renderer, no post-FX) |
| `object-sculpt-spec.json` | the authored spec: 69 components, 9 materials, 5 repetition systems |
| `assessment.json` | pre-spec assessment, quality contract, detail inventory, projection decision |
| `analysis/` | observation protocol, measurements, view crops, zone crops |
| `review/` | comparison sheets, silhouette overlay, gate outputs, contract notes |
| `tools/` | rebuild + capture + measure + overlay scripts |
| `.img2threejs/state.json` | the checklist, complete, every step with evidence or a recorded reason |

Reproduce: `powershell -File tools/rebuild.ps1 -Tag final -PassId lighting-pass`
(needs the static server from `tools/serve` on :8899, and the embedded Python 3.12).
