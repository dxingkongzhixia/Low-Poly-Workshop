# Character contract, landmarks and action-ready evidence

## `character-contract-read`

Read completely, at the point the checklist named them:

- `grimoire/character/reconstruction.md` — head-unit proportion system, facial landmark layout,
  pose/skeleton rules, stylized character materials.
- `grimoire/character/likeness_maximization.md` — the projection-first route, and its explicit
  honesty note that a single image cannot yield a guaranteed likeness.

The likeness-maximisation route (solve camera -> de-light -> project -> bake) was **considered and
declined**, with a reason, not skipped: see the `projectionRoute` block in `assessment.json`. This
reference is flat vector-like paint whose identity features (star, trim chain, boot chevrons, eye
ring) all have hard bounded boundaries, and `grimoire/review/gates_reference.md` requires those to
be gated on GEOMETRY, never as a texture. There is no photographic albedo to recover, so
de-lighting and texture projection would only blur the boundaries the review depends on.

## `character-landmarks`

`analysis/anatomy.json` — measured from the sheet, not defaulted:

| Landmark | Value | Evidence |
|---|---|---|
| styleHeads | 2.6 HU | crown 165 px, chin 488 px, ground 1017 px; head 323 px of an 852 px figure |
| headUnit | 0.379 | head height / total height |
| torso | 1.80 HU | crown 165 -> hip 745 |
| legs | 0.84 HU | hip 745 -> ground 1017 |
| shoulderWidth | 0.75 HU | 242 px across, measured narrower than the 369 px head |
| hipWidth | 0.62 HU | 200 px across the shorts |
| eyeLine | 0.78 | eye-white blobs centred (356, 417) and (497, 417) |
| eyeSpacing | 0.22 | 81 px inner-corner gap of a 369 px head |
| hairline | 0.597 (image) / y 0.774 (model) | fringe stops above the eye line |
| mouthLine | 0.929 | short horizontal dark line |

`analysis/measure3.py`, `measure4.py`, `measure5.py`, `measure7.py` are the measurement
instruments; each prints the pixels it read.

## `action-ready`

The emitted model is a **pivot hierarchy**, and this is a recorded choice, not an omission.
`actionReadiness.defaultRigType` is `action-ready-pivot-rig` and the contract is restated in the
spec. Every one of the 69 components is a named `Object3D` pivot Group with a mesh child:

- `root.userData.sculptRuntime.nodes` — 69 named, selectable pivot nodes
- `root.userData.sculptRuntime.meshes` — 69 meshes, one per component, none fused
- `root.userData.sculptRuntime.colliders` — a box proxy per component at its own scale
- `root.userData.sculptRuntime.destructionGroups` — one detachable group per component

Verified by `check_part_coverage.py`: **68 specified / 69 built / 0 errors / 0 warnings**, so
nothing was specified and then quietly not built, and no two components collapsed onto one part.

The bone track is deliberately not emitted. `character`-track skinning would need a bind pose
authored for THIS subject's proportions; a skeleton carried over from the base humanoid template
has joint positions computed for a different figure, and binding against it deforms rather than
articulates. The subject's identity is bounded flat regions and rigid blocky hair, which a pivot
hierarchy preserves exactly. Moving to the bone track would mean authoring the rig for these
proportions first - it is a real next step, not something this run silently pretended to do.
