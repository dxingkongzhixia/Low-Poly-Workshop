# Reference Suitability Verdict — `reference.png`

**Verdict: PASS (95%).**

| Criterion | Assessment |
|---|---|
| Subject legibility | High — a clean, hard-edged stylized render, not a photo. |
| Coverage | Three orthogonal views (front / right / back) share a ground plane and crown guide, so the proportions can be locked from the sheet itself. |
| Occlusion | Low. The coat hides the inner torso, and the sleeves hide the gloves; both are small and marked inferred. |
| Perspective | Effectively orthographic in views A and C; view B is a true side elevation. No meaningful lens distortion. |
| Resolution | 2000×1125; the per-view faces are ≈600 px wide — enough to resolve the eye ring, mouth, belt buckle and boot chevrons. |
| Background | Flat near-white with a faint construction grid; the subject is high-contrast black, so a foreground mask is trivial and admission reported `foregroundCoverage` 0.40 with a single connected component. |
| Style consistency between views | High; the hair block layout and coat length agree across all three views. |

**Caveats (do not silently ignore):** the twin-tail cross-section (flat ribbon vs square prism) is
inferred; the collapsed hood's volume behind the shoulders is inferred; the coat's inner face is
never visible. These are recorded in `analysis/image-analysis.md` Layer 8.

## Split references

`analysis/views/front.png`, `side.png`, `back.png` — each admitted as ground truth for its own
viewpoint (front / right / rear). Per-view face crops for landmark extraction are derived next.
