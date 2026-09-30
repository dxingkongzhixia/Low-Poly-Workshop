"""Extract the parts actually emitted by the generated factory into a coverage manifest.

The manifest must describe the BUILT model, not the spec, or check_part_coverage.py would be
comparing the spec against itself.
"""
import json
import re
import sys
from pathlib import Path

src = Path(sys.argv[1])
out = Path(sys.argv[2])
text = src.read_text(encoding="utf-8")

nodes = {}
for m in re.finditer(r'nodes\["([^"]+)"\]\s*=\s*(\w+);', text):
    nodes[m.group(1)] = m.group(2)

meshes = set(re.findall(r'meshes\["([^"]+)"\]\s*=', text))

parts = []
for cid in nodes:
    parts.append({
        "id": cid,
        "name": cid,
        "kind": "mesh" if cid in meshes else "pivot",
        "hasMesh": cid in meshes,
    })

out.write_text(json.dumps({"parts": parts, "count": len(parts)}, indent=2), encoding="utf-8")
print(f"built parts: {len(parts)} (with mesh: {len(meshes)}) -> {out}")
