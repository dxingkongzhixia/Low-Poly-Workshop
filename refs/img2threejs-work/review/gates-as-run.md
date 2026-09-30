# Review contract, and the gates as actually run

## Process honesty first

`grimoire/review/gates_reference.md` and `grimoire/review/self_correction.md` were read **at the
point the checklist named them**, which for this run was **after** the AI-vision reviews had been
appended. That is the wrong order and it had a consequence worth naming:

- Tier 1 (`diagnose_render.py`) must gate Tier 2 (AI-vision). It was not run until the end, so the
  five `continue` actions were recorded **without** the deterministic gate in front of them.
- When Tier 1 did run it **failed on every pass**. A corrective `refine-spec` review entry has been
  appended to `lighting-pass` recording that, and the spec's `risks[0]` now states the failure
  first, ahead of every visual score.
- Nothing was deleted to hide it: `reviewHistory` still holds all five `continue` entries followed
  by the corrective `refine-spec` entry, in that order.

## Gates as actually run

| Gate | Where | Result |
|---|---|---|
| Reference admission | `check_reference_admission.py` | admitted; foregroundCoverage 0.40, single component |
| Strict quality | `validate_sculpt_spec.py --strict-quality` | **PASS** (`strict-validation.txt`) |
| Tier 1 | `diagnose_render.py` (5 passes, `--in-place`) | **FAIL** every pass — IoU 0.40-0.47 vs 0.85; aspect delta 0.067-0.077 vs 0.05 |
| Multi-angle | `diagnose_render_multi_angle.py` | **PASS** — not degenerate; side 0.52x, back 1.02x, three-quarter 0.92x of the reference-angle area |
| Interior difference | `interior_difference.py` | measured: **0.139** over 10 863 cells (no mask fallback warnings) |
| Assembly / part coverage | `check_part_coverage.py` | **PASS** — 68 specified / 69 built / 0 errors / 0 warnings |
| Attachment | spec validator | passed: every child appendage carries parentSocket/localStart/localEnd/contactType/embedDepth/gapTolerance |
| Chirality | spec validator `validate_chirality` | passed: every `-l`/`-r` pair is a sagittal mirror, not a rotation |
| Scalp exposure / hair gate | — | **not applicable**: hair components carry role `shell`, not `hair`; the deviation and its reason are recorded in the spec's `risks` |
| Rig payload | — | **not applicable**: pivot track, no `THREE.Skeleton` bound; the reason is recorded in `actionReadiness.contract` |

## On the Tier 1 number

`self_correction.md`'s photo-vs-procedural caveat applies in part here: the unaligned Tier 1 IoU is
dominated by framing and background, and IoU is only trustworthy **after** scale+translation
alignment. So both numbers are reported rather than the flattering one:

- unaligned, as the pipeline's Tier 1 computes it: **0.40-0.47**
- bounding-box normalised (scale+translation aligned), computed independently in
  `tools/silhouette_overlay.py`: **0.63**

Both are short of 0.85. The aligned overlay localises the shortfall to the twin-tail blades and the
lower-body width, which is what the corrective `refine-spec` entry asks for next.
