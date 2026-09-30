import json

d = json.load(open("object-sculpt-spec.json", encoding="utf-8"))
for r in d.get("tier1Results", []):
    c = r.get("checks", {})
    print("%-16s passed=%-5s IoU=%.4f aspectDelta=%.4f scaleDelta=%.4f symmetry=%.4f maxDeltaE=%s" % (
        r.get("passId"), r.get("passed"), c.get("silhouetteIoU", -1),
        c.get("aspectRatioDelta", -1), c.get("scaleDelta", -1),
        c.get("bilateralSymmetryError", -1),
        (c.get("colorDelta") or {}).get("maxDeltaE")))
    for f in r.get("failures", []):
        print("      FAIL:", f)
print()
print("reviewHistory actions:", [ (e.get("passId"), e.get("action")) for e in d.get("reviewHistory", []) ])
