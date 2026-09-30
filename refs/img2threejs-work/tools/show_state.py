import json

d = json.load(open(".img2threejs/state.json", encoding="utf-8"))
steps = d.get("steps") or d.get("checklist") or {}
if isinstance(steps, dict):
    for k, v in steps.items():
        status = v.get("status") if isinstance(v, dict) else v
        print("%-28s %s" % (k, status))
else:
    for s in steps:
        print("%-28s %s" % (s.get("id"), s.get("status")))
