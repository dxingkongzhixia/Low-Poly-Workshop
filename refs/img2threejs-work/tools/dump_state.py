import json

d = json.load(open(".img2threejs/state.json", encoding="utf-8"))
print("top keys:", list(d.keys()))
for k, v in d.items():
    if k in ("steps", "checklist"):
        print(k, "-> len", len(v))
        if isinstance(v, list) and v:
            print("  first:", json.dumps(v[0])[:300])
            for item in v:
                if isinstance(item, dict) and item.get("id") in (
                        "build-current-pass", "render-capture", "part-coverage", "tier1-diagnostics"):
                    print("  ", json.dumps(item)[:300])
        continue
    print(k, "=", json.dumps(v)[:400])
