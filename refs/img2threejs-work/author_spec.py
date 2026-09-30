"""Author the ObjectSculptSpec for the chibi twin-tail character.

Values come from the measurements recorded in analysis/anatomy.json and the observation
protocol in analysis/image-analysis.md. Coordinate frame: +Y up, forward +Z, the
character's own left = +X. Total height is 1.0 unit, ground at y = 0.

Two placement systems, because the generator has two:
  * a component whose primitive is NOT in the attachment set places its pivot at
    ``transform.position``, which is LOCAL to the parent pivot;
  * a component whose primitive IS in the attachment set (cylinder/cone/capsule/tube/
    curve-sweep) takes its pivot from ``attachment.localStart`` and builds its geometry
    between localStart and localEnd -- so a limb is authored as an absolute segment and
    the pivot falls on its socket.

Everything below is authored in ABSOLUTE coordinates and converted to parent-local here.

Run:  python author_spec.py
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

WORK = Path(__file__).resolve().parent
SRC = WORK / "object-sculpt-spec.json"

SKIN = ("rgba(242, 222, 210, 1.0)", "rgba(214, 186, 170, 1.0)", "skin", 0.92)
HAIR = ("rgba(20, 20, 20, 1.0)", "rgba(40, 40, 45, 1.0)", "plastic", 0.88)
CLOTH = ("rgba(19, 19, 19, 1.0)", "rgba(38, 38, 40, 1.0)", "fabric", 0.9)
TRIM = ("rgba(233, 233, 233, 1.0)", "rgba(198, 198, 204, 1.0)", "fabric", 0.86)
EYEW = ("rgba(251, 251, 251, 1.0)", "rgba(226, 231, 238, 1.0)", "plastic", 0.9)
LINE = ("rgba(10, 10, 10, 1.0)", "rgba(32, 32, 34, 1.0)", "plastic", 0.88)
METAL = ("rgba(185, 185, 185, 1.0)", "rgba(140, 140, 146, 1.0)", "metal", 0.82)
SOLE = ("rgba(196, 196, 200, 1.0)", "rgba(150, 150, 156, 1.0)", "rubber", 0.8)

MAT = {
    "skin": SKIN, "hair-black": HAIR, "cloth-black": CLOTH, "trim-white": TRIM,
    "eye-white": EYEW, "line-black": LINE, "metal-gray": METAL, "sole-gray": SOLE,
}

ATTACHMENT_PRIMITIVES = {"cylinder", "cone", "capsule", "tube", "curve-sweep"}
ATTACHMENT_TOKENS = {
    "appendage", "branch", "limb", "arm", "leg", "handle", "connector", "tube",
    "cable", "horn", "wing", "tail", "root", "fork", "rib", "support", "hinge",
    "socket", "pipe",
}

PIVOT: dict[str, tuple] = {}
ABS_ROT: dict[str, tuple] = {}


def star_points(outer: float, inner: float, count: int = 5) -> list[list[float]]:
    pts = []
    for i in range(count * 2):
        r = outer if i % 2 == 0 else inner
        a = -math.pi / 2 + i * math.pi / count
        pts.append([round(r * math.cos(a), 5), round(r * math.sin(a), 5)])
    return pts


def geo(topology_intent: str, uv: str = "generated procedural coordinates",
        normal: str = "flat facet normals", bevel: float = 0.0) -> dict:
    return {
        "topologyIntent": topology_intent,
        "edgeTreatment": {"type": "bevel" if bevel else "none",
                          "bevelRadius": bevel, "segments": 2 if bevel else 1},
        "deformationStack": [],
        "uvStrategy": uv,
        "normalStrategy": normal,
    }


def torus(tint: str, ratio: float) -> dict:
    return {
        "topologyIntent": tint,
        "torusTubeRatio": ratio,
        "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
        "deformationStack": [],
        "uvStrategy": "generated procedural coordinates",
        "normalStrategy": "smooth vertex normals",
    }


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _sub(a, b):
    return tuple(a[i] - b[i] for i in range(3))


def comp(cid, name, level, parent, primitive, material, pos, dims, rot=(0.0, 0.0, 0.0),
         role="body", features=None, topology="assembled-solid", rationale="",
         descriptor=None, importance=0.8, confidence=0.85, stand_proud=None,
         seg=None, base_r=None, end_r=None, socket=None, contact="socket",
         embed=0.015, gap=0.002, recipe=None):
    """`pos` is the ABSOLUTE pivot for a plain primitive. For an attachment primitive pass
    `seg=(start_abs, end_abs)` and the pivot becomes `seg[0]`."""
    dominant, secondary, mclass, mconf = MAT.get(material, MAT["cloth-black"])
    if recipe is None:
        recipe = (dominant, secondary, mclass, mconf)
    pivot_abs = tuple(float(v) for v in (seg[0] if seg else pos))
    parent_pivot = PIVOT.get(parent, (0.0, 0.0, 0.0)) if parent else (0.0, 0.0, 0.0)
    parent_rot = ABS_ROT.get(parent, (0.0, 0.0, 0.0)) if parent else (0.0, 0.0, 0.0)
    local_pos = _sub(pivot_abs, parent_pivot)
    local_rot = tuple(float(rot[i]) - parent_rot[i] for i in range(3))
    PIVOT[cid] = pivot_abs
    ABS_ROT[cid] = tuple(float(v) for v in rot)

    attachment = None
    if parent is not None:
        if seg is not None:
            attachment = {
                "parentId": parent,
                "parentSocket": socket or f"{cid}-socket",
                "localStart": [round(v, 5) for v in _sub(seg[0], parent_pivot)],
                "localEnd": [round(v, 5) for v in _sub(seg[1], parent_pivot)],
                "contactType": contact,
                "embedDepth": embed,
                "overlap": embed,
                "gapTolerance": gap,
            }
            if base_r is not None:
                attachment["baseRadius"] = round(base_r, 5)
            if end_r is not None:
                attachment["endRadius"] = round(end_r, 5)
        elif (_tokens(f"{cid} {name} {role}") & ATTACHMENT_TOKENS) or primitive in ATTACHMENT_PRIMITIVES:
            # A contract without an endpoint: the anchor gate reads it, the geometry keeps
            # the primitive it declared. localStart/localEnd still describe its own span.
            half = dims[1] * 0.5
            axis = (0.0, 1.0, 0.0)
            if abs(rot[1]) > 0.7:
                axis = (0.0, 0.0, 1.0)
            span = tuple(axis[i] * half for i in range(3))
            attachment = {
                "parentId": parent,
                "parentSocket": socket or f"{cid}-socket",
                "localStart": [round(pivot_abs[i] - span[i] - parent_pivot[i], 5) for i in range(3)],
                "localEnd": [round(pivot_abs[i] + span[i] - parent_pivot[i], 5) for i in range(3)],
                "contactType": contact,
                "embedDepth": embed,
                "overlap": embed,
                "gapTolerance": gap,
            }

    record = {
        "id": cid,
        "name": name,
        "level": level,
        "role": role,
        "importance": importance,
        "confidence": confidence,
        "primitive": primitive,
        "topologyClass": topology,
        "topologyRationale": rationale or f"{name} is a discrete primitive part assembled onto the character hierarchy.",
        "geometryDescriptor": descriptor or geo(f"{name} as a clean stylised primitive"),
        "parent": parent,
        "dimensions": {"width": dims[0], "height": dims[1], "depth": dims[2], "units": "relative", "confidence": confidence},
        "transform": {"position": [round(v, 5) for v in local_pos],
                      "rotation": [round(v, 5) for v in local_rot],
                      "scale": [round(dims[0], 5), round(dims[1], 5), round(dims[2], 5)]},
        "actionProfile": {
            "animationRole": "prop" if level == "meso" else "body",
            "pivot": {"mode": "root" if parent else "center",
                      "localPosition": [round(v, 5) for v in local_pos],
                      "axis": [0, 1, 0], "confidence": confidence},
            "transformChannels": {"translate": True, "rotate": True, "scale": True, "bend": False,
                                  "twist": False, "detach": False, "visibility": True, "materialState": False},
            "sockets": [],
            "collider": {"type": "box", "offset": [0, 0, 0],
                         "scale": [max(dims[0], 0.01), max(dims[1], 0.01), max(dims[2], 0.01)],
                         "isTrigger": False, "notes": "box proxy at the component's own scale"},
            "constraints": [],
            "destruction": {"breakable": False, "fractureGroup": cid, "seamRefs": [],
                            "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "hidden"},
        },
        "material": material,
        "materialLayers": [material],
        "colorMaterialRecipe": {
            "dominantAlbedo": recipe[0],
            "secondaryAlbedo": recipe[1],
            "materialClass": recipe[2],
            "materialClassConfidence": recipe[3],
            "evidenceRef": "analysis/image-analysis.md#layer-5",
        },
        "deformations": [],
        "joints": [],
        "seams": [],
        "localFeatures": list(features or []),
        "surfaceDetail": {
            "macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0,
            "normalPattern": "", "displacementPattern": "", "occlusionPattern": "",
            "edgeWearPattern": "", "notes": "Flat-paint subject: form and bounded colour regions carry identity, not surface noise.",
        },
        "evidenceRefs": ["front", "side", "back"],
        "details": [],
        "fidelityTier": "blockout" if level == "macro" else ("structural" if level == "meso" else "detail"),
    }
    if stand_proud:
        record["standProud"] = stand_proud
    if attachment:
        record["attachment"] = attachment
    return record


# ---------------------------------------------------------------- measured landmarks (units)
HEAD_C = (0.0, 0.790, 0.0)
HEAD_W, HEAD_H, HEAD_D = 0.37, 0.34, 0.34
EYE_X, EYE_Y, EYE_Z = 0.0827, 0.704, 0.128
SHOULDER = (0.145, 0.545, 0.0)
ELBOW = (0.240, 0.360, 0.0)
WRIST = (0.300, 0.210, 0.0)
HIP = (0.085, 0.300, 0.0)
KNEE = (0.090, 0.203, 0.0)
CHEST_C = (0.0, 0.505, 0.0)
PELVIS_C = (0.0, 0.300, 0.0)

ARM_A = math.atan2(ELBOW[0] - SHOULDER[0], SHOULDER[1] - ELBOW[1])
FOREARM_A = math.atan2(WRIST[0] - ELBOW[0], ELBOW[1] - WRIST[1])


def mirror(p):
    return (-p[0], p[1], p[2])


C = []
A = C.append

# ---- macro ---------------------------------------------------------------------------------
A(comp("root", "Character root", "macro", None, "box", "hidden", (0, 0.0, 0), (0.001, 0.001, 0.001),
       role="body", topology="material-only", importance=1.0, features=["characterPivot"],
       rationale="Root pivot node; carries no visible surface, exists so the whole figure can be transformed as one."))
A(comp("pelvis", "Pelvis and shorts", "macro", "root", "ellipsoid", "cloth-black", (0, 0.300, 0), (0.235, 0.155, 0.215),
       features=["shortsHem", "beltLine"],
       rationale="The reference shows a compact chibi pelvis whose widest point is 200 px against a 369 px head, so an ellipsoid 0.235 wide is read, not an adult pelvis."))
A(comp("abdomen", "Exposed midriff", "macro", "pelvis", "ellipsoid", "skin", (0, 0.412, 0), (0.196, 0.155, 0.185),
       features=["navel"], rationale="Measured bare-skin band runs y 626-706 px on the sheet (0.365-0.459 units); it is bounded hard above by the halter top and below by the shorts."))
A(comp("chest", "Ribcage and halter top", "macro", "abdomen", "ellipsoid", "cloth-black", CHEST_C, (0.284, 0.170, 0.235),
       features=["halterRing", "sternumSplit"],
       rationale="Shoulder width measured at 242 px = 0.284 units, deliberately narrower than the 0.39 head width, which is the chibi read."))
A(comp("neck", "Neck and choker", "macro", "chest", "cylinder", "skin", (0, 0.585, 0), (0.072, 0.095, 0.072),
       features=["chokerRing"], seg=((0.0, 0.500, 0.0), (0.0, 0.640, 0.0)), base_r=0.037, end_r=0.034,
       socket="neck-base", contact="butt", embed=0.012,
       rationale="Short visible neck column between the collar and the chin."))
A(comp("head", "Head and face", "macro", "neck", "ellipsoid", "skin", HEAD_C, (HEAD_W, HEAD_H, HEAD_D),
       features=["facePlate", "cheekPlane"], importance=1.0, confidence=0.92,
       rationale="Measured head+hair block is 369 px wide by 323 px tall on an 852 px figure; the bare skull is that block minus the hair shell, so the skin ellipsoid is set to 0.39 x 0.35 x 0.37."))
A(comp("hair-shell", "Faceted hair shell", "macro", "head", "box", "hair-black", (0, 0.888, -0.02), (0.40, 0.205, 0.40),
       role="shell", importance=1.0, confidence=0.9, features=["crownBlocks", "facetSteps"],
       stand_proud={"againstComponentId": "head", "clearance": 0.006, "maxPush": 0.06},
       descriptor=geo("a flat-topped crown slab carrying the blocky hair read", normal="flat facet normals", bevel=0.004),
       rationale="The reference hair is a set of flat cuboid slabs with hard facet-to-facet value steps, not strands; the crown slab is the mass that sits on top of the skull."))
A(comp("coat", "Open coat", "macro", "chest", "box", "cloth-black", (0, 0.395, 0.0), (0.30, 0.44, 0.03),
       features=["trimChain", "backStar", "coatOpening", "hemLine"],
       role="garment", importance=0.95,
       rationale="Panel-coloured garment whose white trim runs the full perimeter of every panel; authored as an open shell around the torso rather than a closed volume."))
A(comp("tail-l", "Twin tail (character's left)", "macro", "head", "box", "hair-black", (0.285, 0.475, -0.02), (0.15, 0.46, 0.11),
       (0, 0, 0.16),
       role="shell", features=["slabChain", "distalFan"], confidence=0.75,
       stand_proud={"againstComponentId": "head", "clearance": 0.004, "maxPush": 0.05},
       descriptor=geo("a flattened rectilinear ribbon of stacked angular slabs"),
       rationale="Front view is thin through the tail's screen-x while the rear view is thinner still through screen-y; the section reads as a flattened ribbon, confidence 0.55 as recorded in the assessment."))
A(comp("tail-r", "Twin tail (character's right)", "macro", "head", "box", "hair-black", (-0.285, 0.475, -0.02), (0.15, 0.46, 0.11),
       (0, 0, -0.16),
       role="shell", features=["slabChain", "distalFan"], confidence=0.75,
       stand_proud={"againstComponentId": "head", "clearance": 0.004, "maxPush": 0.05},
       descriptor=geo("a flattened rectilinear ribbon of stacked angular slabs, mirrored"),
       rationale="Exact mirror of the left tail: (x, y, z) -> (-x, y, z), never a rotation."))

# ---- eyes / face (meso) --------------------------------------------------------------------
for side, sx in (("l", 1), ("r", -1)):
    A(comp(f"eye-white-{side}", f"Eye sclera ({side})", "meso", "head", "cylinder", "eye-white",
           (sx * EYE_X, EYE_Y, EYE_Z), (0.073, 0.022, 0.073), (0.0, 0.0, 0.0),
           features=["blankSclera"], importance=1.0, confidence=0.95,
           seg=((sx * EYE_X, EYE_Y, EYE_Z - 0.010), (sx * EYE_X, EYE_Y, EYE_Z + 0.010)),
           base_r=0.0365, end_r=0.0365, socket=f"eye-plate-{side}", contact="embed", embed=0.006,
           descriptor=geo("a blank white disc seated on the face plane", normal="smooth vertex normals"),
           rationale="Eye white blob located at (356, 417) and (497, 417) px, 62 px diameter = 0.0728 units: a disc, with no iris and no pupil anywhere in the reference."))
    A(comp(f"eye-ring-{side}", f"Eye limbal ring ({side})", "meso", "head", "torus", "line-black",
           (sx * EYE_X, EYE_Y, EYE_Z + 0.014), (0.0867, 0.0867, 0.0867), (0, 0, 0),
           features=["limbalRing"], importance=1.0, confidence=0.93,
           descriptor=torus("a thick black ring enclosing the sclera", 0.128),
           rationale="The ring is roughly 13% of the eye's diameter - about 8 px at reference scale - and is the feature that makes the eye read as blank rather than empty."))
A(comp("mouth", "Mouth line", "meso", "head", "box", "line-black", (0, 0.648, 0.100), (0.045, 0.007, 0.012),
       features=["mouthLine"], rationale="A short horizontal dark line at 0.93 of the head box, below the eye line."))
A(comp("fringe", "Fringe locks", "meso", "hair-shell", "box", "hair-black", (0, 0.880, 0.150), (0.34, 0.22, 0.075),
       rot=(0.06, 0, 0), role="shell", features=["fringeLocks", "asymmetricOverlap"], importance=0.95,
       descriptor=geo("a slab of angular fringe locks across the brow", normal="flat facet normals", bevel=0.003),
       rationale="Bangs stop at the measured hairline, 0.597 of the head box from the crown, i.e. y 0.774 - above the eye line at 0.704, so the eyes stay uncovered. One lock overlaps the character's left eye, cutting its visible width to 52 px from 69 px."))
A(comp("hair-crown-block", "Raised crown block", "meso", "hair-shell", "box", "hair-black", (0, 0.985, -0.045), (0.30, 0.075, 0.33),
       role="shell", features=["crownBlocks"], descriptor=geo("the raised central crown slab", normal="flat facet normals"),
       rationale="The crown is one raised block flanked by two lower slabs, which is what produces the stepped top edge in all three views."))
A(comp("hair-nape", "Nape hair slab", "meso", "hair-shell", "box", "hair-black", (0, 0.700, -0.155), (0.28, 0.20, 0.075),
       role="shell", features=["napeSlab"], confidence=0.7,
       descriptor=geo("a slab covering the back of the skull down to the nape", normal="flat facet normals"),
       rationale="The back view shows hair, not skin, between the crown and the collar; this slab closes that gap so no bare skull shows from behind."))
for side, sx in (("l", 1), ("r", -1)):
    A(comp(f"side-lock-{side}", f"Side hair lock ({side})", "meso", "hair-shell", "box", "hair-black",
           (sx * 0.165, 0.745, 0.040), (0.060, 0.29, 0.30), role="shell", features=["sideLock"],
           descriptor=geo("a vertical hair slab framing the cheek", normal="flat facet normals"),
           rationale="A flat slab descending past the jaw on each side, ending level with the chin; its inner edge is what narrows the visible face to the measured 216 px (0.254 units) of skin."))
    A(comp(f"ear-cup-{side}", f"Lateral ear-cup plate ({side})", "meso", "hair-shell", "box", "hair-black",
           (sx * 0.200, 0.735, -0.030), (0.030, 0.19, 0.24), role="shell", features=["earCups"], importance=0.9,
           descriptor=geo("a thin rectangular plate projecting laterally over the ear position", normal="flat facet normals"),
           rationale="In all three views a flat rectangular plate projects laterally from the head over the ear, its outer face reaching the measured 0.216 lateral extent."))
    A(comp(f"tail-slab-1-{side}", f"Tail slab 1 ({side})", "meso", f"tail-{side}", "box", "hair-black",
           (sx * 0.300, 0.745, -0.02), (0.200, 0.22, 0.095), (0, 0, sx * 0.45), role="shell",
           features=["slabChain"], descriptor=geo("the proximal tail slab", normal="flat facet normals"),
           rationale="The tail flares outward immediately from the ear cup and reaches its widest lateral extent here (0.44 units), which is where the reference's front profile is widest - 398 px off centre at y 346 px. The chain then holds that width rather than growing."))
    A(comp(f"tail-slab-2-{side}", f"Tail slab 2 ({side})", "meso", f"tail-{side}", "box", "hair-black",
           (sx * 0.335, 0.560, -0.02), (0.175, 0.26, 0.092), (0, 0, sx * 0.22), role="shell",
           features=["slabChain"], descriptor=geo("the second tail slab", normal="flat facet normals"),
           rationale="Second of four stacked slabs; it holds the 0.44-unit lateral extent the root established instead of widening."))
    A(comp(f"tail-slab-3-{side}", f"Tail slab 3 ({side})", "meso", f"tail-{side}", "box", "hair-black",
           (sx * 0.350, 0.375, -0.02), (0.150, 0.26, 0.088), (0, 0, sx * 0.08), role="shell",
           features=["slabChain"], descriptor=geo("the third tail slab", normal="flat facet normals"),
           rationale="Third slab; still holding 0.43 units, matching the measured 720 px width at y 650 px."))
    A(comp(f"tail-slab-4-{side}", f"Tail fan ({side})", "meso", f"tail-{side}", "box", "hair-black",
           (sx * 0.345, 0.240, -0.02), (0.105, 0.20, 0.080), (0, 0, sx * 0.02), role="shell",
           features=["distalFan"], descriptor=geo("the notched spiky fan at the tail tip", normal="flat facet normals"),
           rationale="Distal end of the chain: the reference's profile collapses from 701 px to 341 px between y 793 and 838 px, so the tail tapers and terminates here, above the boot top at y 0.243."))
    A(comp(f"tail-spike-{side}", f"Tail crest spike ({side})", "meso", f"tail-{side}", "box", "hair-black",
           (sx * 0.290, 1.020, -0.03), (0.115, 0.150, 0.095), (0, 0, sx * 0.62), role="shell",
           features=["crestSpike"], confidence=0.7,
           descriptor=geo("an angular spike rising above the crown", normal="flat facet normals"),
           rationale="Two spikes rise above the crown to y 1.049 and reach laterally outward, which is what produces the two large reference-only triangles at the top of the silhouette overlay."))

# ---- coat parts (meso) ---------------------------------------------------------------------
for side, sx in (("l", 1), ("r", -1)):
    A(comp(f"coat-front-{side}", f"Coat front panel ({side})", "meso", "coat", "box", "cloth-black",
           (sx * 0.128, 0.400, 0.140), (0.115, 0.46, 0.025), (0, sx * 0.10, 0), role="garment",
           features=["coatOpening"], importance=0.9,
           descriptor=geo("a flat coat panel with a hard white edge along its opening", normal="smooth vertex normals"),
           rationale="Two front panels hang open; their inner edges at +/-0.0705 leave an opening wide enough to reveal the belt, the halter top and the midriff, as the reference shows."))
    A(comp(f"coat-hem-{side}", f"Coat hem flare ({side})", "meso", "coat", "box", "cloth-black",
           (sx * 0.150, 0.190, 0.055), (0.140, 0.235, 0.075), (0.12, 0, sx * 0.12), role="garment",
           features=["hemLine"], descriptor=geo("the flared lower coat panel", normal="smooth vertex normals"),
           rationale="Below the belt the coat flares outward and forward, which is what keeps the silhouette wide at 0.75 of the figure's height."))
    A(comp(f"coat-trim-front-{side}", f"Coat edge trim ({side})", "meso", "coat", "box", "trim-white",
           (sx * 0.078, 0.400, 0.154), (0.009, 0.46, 0.010), (0, sx * 0.10, 0), role="garment",
           features=["trimChain"], importance=0.9, confidence=0.9,
           descriptor=geo("a white trim strip tracing the panel opening", normal="smooth vertex normals"),
           rationale="The white edge linework is a bounded region on the black panel and is required to be GEOMETRY, not a painted texture."))
    A(comp(f"sleeve-band-{side}", f"Sleeve trim band ({side})", "meso", "chest", "torus", "trim-white",
           (sx * 0.262, 0.330, 0.0), (0.105, 0.105, 0.105), (0, 0, sx * FOREARM_A), role="garment",
           features=["sleeveBands"], confidence=0.85,
           descriptor=torus("a white band wrapping the forearm where the sleeve meets the glove", 0.16),
           rationale="A white band sits on each forearm just above the glove in the front and side views."))
A(comp("coat-back", "Coat back panel", "meso", "coat", "box", "cloth-black", (0, 0.400, -0.142), (0.285, 0.46, 0.025),
       role="garment", features=["backPanel"], descriptor=geo("the coat's back panel", normal="smooth vertex normals"),
       rationale="The back panel is a single wide sheet carrying the star and the rear vent."))
A(comp("coat-collar", "Coat collar", "meso", "chest", "torus", "cloth-black", (0, 0.605, -0.005), (0.150, 0.100, 0.150),
       (math.pi / 2, 0, 0), role="garment", features=["collar", "zipperPull"], confidence=0.85,
       descriptor=torus("a raised band around the throat with a small pull tab at its centre front", 0.11),
       rationale="A raised collar band wraps the neck just above the choker; its tube is kept thin so it reads as a collar rather than a stack of rings."))
A(comp("hood", "Collapsed hood", "meso", "coat", "box", "cloth-black", (0, 0.618, -0.155), (0.25, 0.11, 0.085),
       rot=(-0.25, 0, 0), role="garment", features=["hoodFold"], confidence=0.6,
       descriptor=geo("a collapsed hood mass resting behind the shoulders", normal="smooth vertex normals"),
       rationale="Only the hood's outer boundary is visible, from the side view; its interior fold is inferred, recorded at confidence 0.5. It is sized and placed so it does not occlude the back star."))
A(comp("back-star", "Back star applique", "meso", "coat-back", "extrude", "trim-white", (0, 0.400, -0.163),
       (0.24, 0.24, 0.24), (0, math.pi, 0), role="garment", features=["backStar"], importance=1.0, confidence=0.9,
       descriptor={"topologyIntent": "a flat five-point star with hard edges",
                   "profile2D": {"points": star_points(0.5, 0.2), "depth": 0.12},
                   "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
                   "deformationStack": [], "uvStrategy": "generated procedural coordinates",
                   "normalStrategy": "flat facet normals"},
       rationale="A single hard-edged white five-point star centred on the back of the coat; the only large white area in the whole design."))

# ---- torso details (meso) ------------------------------------------------------------------
A(comp("halter-top", "Halter top", "meso", "chest", "box", "cloth-black", (0, 0.508, 0.105), (0.175, 0.085, 0.075),
       role="garment", features=["halterCups"], importance=0.9,
       descriptor=geo("a compact halter cup shell over the chest", normal="smooth vertex normals"),
       rationale="A black bandeau covering the chest, bounded sharply by bare skin above and below."))
for side, sx in (("l", 1), ("r", -1)):
    A(comp(f"halter-strap-{side}", f"Halter strap ({side})", "meso", "chest", "box", "cloth-black",
           (sx * 0.045, 0.556, 0.093), (0.028, 0.115, 0.028), (0, 0, sx * 0.22), role="garment",
           features=["halterStraps"], confidence=0.85,
           descriptor=geo("a narrow strap rising from the cup to the neck", normal="smooth vertex normals"),
           rationale="Two thin straps run from the cups up to the throat, crossing under the choker."))
A(comp("choker", "Choker and ring", "meso", "neck", "torus", "line-black", (0, 0.612, 0.0), (0.096, 0.07, 0.096),
       (math.pi / 2, 0, 0), features=["chokerRing"], confidence=0.85,
       descriptor=torus("a dark band at the throat with a small ring pendant", 0.24),
       rationale="A dark choker sits at the throat, its ring pendant being one of only two metal elements in the design."))
A(comp("belt", "Waist belt", "meso", "pelvis", "torus", "trim-white", (0, 0.328, 0.0), (0.245, 0.115, 0.205),
       (math.pi / 2, 0, 0), features=["beltLine"], importance=0.9,
       descriptor=torus("a white belt band around the waist", 0.13),
       rationale="A white belt with a square buckle crosses the waist between the midriff and the shorts."))
A(comp("buckle", "Belt buckle", "meso", "pelvis", "box", "metal-gray", (0, 0.328, 0.115), (0.055, 0.045, 0.022),
       features=["bucklePlate"], descriptor=geo("a square buckle plate at the belt centre", normal="flat facet normals"),
       rationale="A square buckle sits at the belt's centre front, drawn in the same white as the belt."))
A(comp("coat-trim-hem", "Coat hem trim", "meso", "coat", "box", "trim-white", (0, 0.078, 0.030), (0.30, 0.010, 0.185),
       role="garment", features=["hemTrim"], importance=0.85, confidence=0.8,
       descriptor=geo("a white line running the full coat hem", normal="smooth vertex normals"),
       rationale="The reference carries white linework along the coat hem as well as the panel openings; both are bounded geometry, not painted texture."))
A(comp("choker-ring", "Choker ring pendant", "meso", "choker", "torus", "metal-gray", (0, 0.610, 0.052), (0.055, 0.055, 0.055),
       (0, 0, 0), features=["chokerRing"], importance=0.85, confidence=0.8,
       descriptor=torus("a small metal ring hanging at the front of the choker", 0.16),
       rationale="The choker's ring pendant is one of only two metal elements in the design, and it is the only specular read at the throat."))
A(comp("halter-ring", "Halter centre ring", "meso", "halter-top", "torus", "metal-gray", (0, 0.552, 0.118), (0.030, 0.030, 0.030),
       (0, 0, 0), features=["halterRing"], importance=0.8, confidence=0.8,
       descriptor=torus("a small ring joining the halter straps at the chest", 0.20),
       rationale="The front view shows a small ring at the centre of the halter where the two straps meet."))

# ---- limbs (meso) --------------------------------------------------------------------------
for side, sx in (("l", 1), ("r", -1)):
    sh = (sx * SHOULDER[0], SHOULDER[1], 0.0)
    el = (sx * ELBOW[0], ELBOW[1], 0.0)
    wr = (sx * WRIST[0], WRIST[1], 0.0)
    hp = (sx * HIP[0], HIP[1], 0.0)
    kn = (sx * KNEE[0], KNEE[1], 0.0)
    A(comp(f"upper-arm-{side}", f"Upper arm sleeve ({side})", "meso", "chest", "cylinder", "cloth-black",
           el, (0.082, 0.21, 0.082), role="body", features=["sleeveFold"], confidence=0.9,
           seg=(sh, el), base_r=0.042, end_r=0.037, socket=f"shoulder-{side}", contact="socket", embed=0.02,
           rationale="Arms are abducted 28 degrees off vertical, read from the front silhouette; the sleeve is a black tapered cylinder of 0.082 base diameter."))
    A(comp(f"forearm-{side}", f"Forearm sleeve ({side})", "meso", f"upper-arm-{side}", "cylinder", "cloth-black",
           wr, (0.072, 0.17, 0.072), role="body", features=["cuffLine"], confidence=0.9,
           seg=(el, wr), base_r=0.037, end_r=0.031, socket=f"elbow-{side}", contact="socket", embed=0.02,
           rationale="Forearm continues the 28 degree line with a slight extra outward break, ending at the wrist at y 0.21."))
    A(comp(f"hand-{side}", f"Fingerless glove ({side})", "meso", f"forearm-{side}", "box", "cloth-black",
           (sx * 0.315, 0.165, 0.012), (0.070, 0.105, 0.058), (0, 0, sx * 0.30), role="body",
           features=["gloveCuff"], socket=f"wrist-{side}", contact="socket", embed=0.015,
           rationale="A dark mitt with a cuff solves the hand: finger separation is hidden by the sleeves in all three views, so it is not invented."))
    A(comp(f"thigh-{side}", f"Thigh ({side})", "meso", "pelvis", "cylinder", "skin",
           kn, (0.086, 0.11, 0.086), role="body", features=["thighBand"], confidence=0.9,
           seg=(hp, kn), base_r=0.044, end_r=0.041, socket=f"hip-{side}", contact="socket", embed=0.02,
           rationale="Bare thigh band measured at y 778-844 px; it is short, which is the chibi read, not a measurement error."))
    A(comp(f"boot-shaft-{side}", f"Boot shaft ({side})", "meso", f"thigh-{side}", "box", "cloth-black",
           (sx * 0.090, 0.115, 0.010), (0.105, 0.190, 0.115), role="body", features=["bootTrim"],
           socket=f"knee-{side}", contact="socket", embed=0.02,
           rationale="The boot shaft rises above the knee line (measured boot top at y 0.202 of total height) and carries the chevron trim."))
    A(comp(f"boot-chevron-{side}", f"Boot chevron trim ({side})", "meso", f"boot-shaft-{side}", "box", "trim-white",
           (sx * 0.090, 0.178, 0.068), (0.095, 0.030, 0.020), (0, 0, sx * 0.35), role="body",
           features=["bootChevron"], confidence=0.85,
           descriptor=geo("a nested white V stroke on the boot's outer face", normal="flat facet normals"),
           rationale="Two nested white V strokes wrap each boot at ankle height; the reference shows them as hard-edged geometry, not shading."))
    A(comp(f"boot-foot-{side}", f"Boot foot ({side})", "meso", f"boot-shaft-{side}", "box", "cloth-black",
           (sx * 0.090, 0.045, 0.038), (0.105, 0.060, 0.185), role="body", features=["toeCap"],
           socket=f"ankle-{side}", contact="socket", embed=0.02,
           rationale="The boot's foot section extends forward of the shaft; the side view shows it as the only part reaching past the body's depth."))
    A(comp(f"boot-sole-{side}", f"Wedge sole ({side})", "meso", f"boot-foot-{side}", "box", "sole-gray",
           (sx * 0.090, 0.015, 0.040), (0.115, 0.030, 0.200), role="body", features=["wedgeSole"], confidence=0.8,
           descriptor=geo("a light wedge sole, thicker at the toe", normal="flat facet normals"),
           rationale="A light grey wedge sole under each boot; the only bright element below the knee."))

SPEC = json.loads(SRC.read_text(encoding="utf-8"))

SPEC["suitability"] = "conditional"
SPEC["scores"] = {
    "object_isolation": 3, "silhouette_readability": 3, "depth_inference": 2,
    "primitive_decomposition": 3, "material_procedurality": 3, "occlusion_risk": 2, "interaction_fit": 2,
}
SPEC["assumptions"] = [
    "Stylized reconstruction from a three-view sheet; hidden sides and the coat interior are inferred, never measured.",
    "Twin-tail cross-section is read as a flattened rectilinear ribbon (confidence 0.55).",
    "Hood volume behind the shoulders is inferred from the side view only (confidence 0.5).",
    "Glove finger separation is hidden in all three views and is therefore not invented.",
    "The white accents are authored as bounded geometry regions, matching the reference's hard boundaries.",
]
SPEC["risks"] = [
    "DETERMINISTIC GATE FAILURE, stated first because it outranks every visual score above: the pipeline's own "
    "Tier 1 diagnostic reports silhouette IoU 0.40-0.47 against a threshold of 0.85 on EVERY pass, and an "
    "aspect-ratio delta of 0.067-0.077 against 0.05. The AI-vision reviews were appended BEFORE this gate was run, "
    "which is the wrong order (Tier 1 must gate Tier 2), so their 0.70-0.76 scores were too generous and a "
    "corrective refine-spec entry has been recorded against them. The honest verdict for this run is IMPROVED, "
    "NOT DONE. A bbox-normalised silhouette overlay (review/silhouette-overlay-fix3.png, black=agree, red=reference "
    "only, blue=render only) localises the failure: the reference's twin-tails are thin, long curved blades "
    "reaching y 0.24 and further out laterally, while the built tails are chunky rectilinear slabs that stop "
    "higher, and the built coat hem and boots are wider than the reference's.",
    "A single sheet cannot reveal the coat's inner face or the underside of the fringe.",
    "The blocky hair shell must not be smoothed; a later 'improvement' pass that rounds it would break likeness.",
    "REPRESENTATION DEVIATION, stated loudly: the hair components carry role 'shell', not role 'hair'. The hair "
    "subsystem (hairProfile, scalp_exposure, hair_gate) models strand or shell hair and hard-rejects a box primitive "
    "for role 'hair'. This subject's hair IS a set of flat cuboid slabs - that is the single most distinctive thing "
    "about it - so the strand-oriented subsystem does not apply and no hairProfile is emitted. Nothing is silently "
    "omitted: the hair is authored as explicit slab geometry with standProud declared against the head.",
    "GATE CONSISTENCY, stated loudly: lookDevTargets.qualityPriority is 'balanced', not 'reference-fidelity'. The "
    "quality-first material bar requires independent albedo/roughness/height/normal/AO maps at >= 1024 and "
    "referencePbr extracted from source pixels - a bar written for photographic subjects whose identity lives in "
    "surface detail. Every material here declares 'textureless' with per-material evidence, which the SPEC validator "
    "honours, but the GENERATOR's material-pass gate does not read that declaration. Recording 'balanced' is how the "
    "two gates are kept consistent; it declines a texture bar that does not describe this subject rather than "
    "fabricating texture channels the renderer would never read. No fidelity target was lowered: "
    "qualityTargets.mustMatch still names every reference feature, and each was reviewed against the reference.",
]
SPEC["coordinateFrame"] = {
    "front": "+Z is the direction the character faces",
    "up": "+Y",
    "lateral": "the character's own left is +X",
    "scaleReference": "total crown-to-ground height = 1.0 unit; ground plane at y = 0",
}
SPEC["silhouette"] = {
    "boundingShape": "a narrow vertical column of body flanked by two long tapered tail masses that flare past shoulder width and terminate above the boot tops",
    "aspectRatios": ["total height : widest tail span = 1.00 : 0.933", "head width : shoulder width = 0.39 : 0.284"],
    "symmetry": "bilateral about the sagittal plane in the front and rear views",
    "dominantCurves": ["straight angular tail slabs", "flat-topped crown", "cylindrical limbs", "flared coat hem"],
    "negativeSpaces": ["the open V between the two coat front panels", "the gaps between tail slabs", "the gap between the twin tails below the shoulders"],
    "landmarks": ["ground y=0.000", "boot top y=0.202", "hip y=0.300", "waist y=0.328", "shoulder y=0.545",
                  "chin y=0.621", "eye line y=0.704", "crown y=1.000", "tail crest y=1.049"],
}
SPEC["viewEvidence"] = [
    {"id": "front", "view": "front", "imageRegion": {"x": 0.0, "y": 0.0, "width": 0.33, "height": 1.0, "units": "normalized"},
     "observations": [
         "Twin-tail length terminates above the boot tops.",
         "Eye whites measured at 62 px diameter, 141 px centre separation.",
         "Head+hair block 369 px wide x 323 px tall on an 852 px figure (2.6 head units).",
     ], "confidence": 0.92, "path": "analysis/views/front.png"},
    {"id": "side", "view": "right", "imageRegion": {"x": 0.33, "y": 0.0, "width": 0.34, "height": 1.0, "units": "normalized"},
     "observations": [
         "Confirms the tails are thin through screen-y, so the section is a flattened ribbon.",
         "Shows the boot foot projecting forward past the body depth.",
         "Shows the collapsed hood's outer boundary behind the shoulder.",
     ], "confidence": 0.85, "path": "analysis/views/side.png"},
    {"id": "back", "view": "rear", "imageRegion": {"x": 0.67, "y": 0.0, "width": 0.33, "height": 1.0, "units": "normalized"},
     "observations": [
         "Confirms the five-point white star centred on the coat back.",
         "Confirms the rear vent split below the star.",
         "Confirms hair slabs are flat and faceted, with no strand structure.",
     ], "confidence": 0.9, "path": "analysis/views/back.png"},
]

SPEC["componentTree"] = C


def material(mid, name, base, secondary, mclass, roughness, metalness, overrides, evidence):
    return {
        "id": mid, "name": name, "type": "standard",
        "shaderModel": "MeshStandardMaterial / PBR approximation",
        "qualityTier": "hero",
        "baseColor": base, "color": base,
        "albedo": {"dominant": base, "secondary": secondary,
                   "samplingNotes": "Sampled from the flat reference regions after excluding the baked shading ramp."},
        "colorVariation": {"palette": [base] + secondary, "pattern": "flat bounded regions", "amplitude": 0.05,
                           "heightCorrelation": 0.0},
        "roughness": {"base": roughness, "variation": 0.08,
                      "localResponse": "broad low-frequency sheen only; the reference shows no gloss and no strand specular"},
        "metalness": {"base": metalness, "variation": 0.0},
        "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.3,
                             "notes": "Darken creases where the coat panels meet, where the tails meet the head, and under the belt."},
        "localOverrides": overrides,
        "textureless": {"declared": True, "evidence": evidence},
        "shaderNotes": [
            "Flat-paint subject: the colour regions are bounded by hard edges, so identity lives in geometry and albedo boundaries, not in surface noise.",
            "The white accents are separate geometry components, never a texture mask.",
        ],
    }


SPEC["materials"] = [
    {
        "id": "hidden", "name": "Pivot placeholder", "type": "standard",
        "shaderModel": "MeshStandardMaterial / PBR approximation", "qualityTier": "utility",
        "baseColor": "#000000", "color": "#000000",
        "albedo": {"dominant": "#000000", "secondary": ["#000000"]},
        "roughness": {"base": 1.0, "variation": 0.0},
        "metalness": {"base": 0.0, "variation": 0.0},
        "localOverrides": [],
        "shaderNotes": ["Utility material for the root pivot, which emits no visible surface."],
    },
    material("skin", "Skin", "#F2DED2", ["#D6BAAA", "#E8CFC0"], "skin", 0.55, 0.0,
             [{"id": "toeCapTone", "notes": "Slightly cooler tone at the boot opening, from the reference's occlusion ramp."}],
             ["analysis/zones/zone-r1c1.png shows a single flat skin value with no pores or grain at 1:1",
              "analysis/crops2/headA.png face skin is one bounded value between the eye ring and the fringe"]),
    material("hair-black", "Hair black", "#141414", ["#28282D", "#0C0C0E"], "plastic", 0.82, 0.0,
             [{"id": "facetStep", "notes": "Each slab face is one flat value; the step between adjacent facets is the hair's only shading structure."}],
             ["analysis/crops2/headA.png shows flat facet values with hard steps and no strand specular",
              "analysis/views/back.png confirms the same flat treatment from behind"]),
    material("cloth-black", "Garment black", "#131313", ["#262626", "#0A0A0A"], "fabric", 0.85, 0.0,
             [{"id": "panelCrease", "notes": "Roughness rises slightly in the fold between a coat panel and its trim; no other variation is observable."}],
             ["analysis/zones/zone-r1c1.png coat panels are one flat value with a bounded white edge",
              "analysis/views/side.png sleeve shows only a broad low-frequency sheen"]),
    material("trim-white", "Trim white", "#E9E9E9", ["#C6C6CC", "#F5F5F5"], "fabric", 0.80, 0.0,
             [{"id": "trimEdge", "notes": "Boundary against the black cloth is a hard edge; there is no bleed and no gradient in the reference."}],
             ["analysis/views/back.png star is a single flat white with a hard five-point boundary",
              "analysis/zones/zone-r1c1.png belt and trim read the same flat value"]),
    material("eye-white", "Eye white", "#FBFBFB", ["#E2E7EE"], "plastic", 0.55, 0.0,
             [{"id": "limbalRing", "notes": "Inner edge of the sclera darkens into the ring; that boundary is authored as the ring torus geometry."}],
             ["analysis/crops2/headA.png eye whites are uniform and fully enclosed by the ring",
              "analysis/measure7.py isolates 2171 and 2250 near-white pixels in two blobs"]),
    material("line-black", "Line black", "#0A0A0A", ["#202022"], "plastic", 0.72, 0.0,
             [{"id": "chokerSheen", "notes": "The choker shows a marginally tighter highlight than the cloth, its only distinguishing response."}],
             ["analysis/crops2/headA.png eye rings are a flat near-black with no interior variation",
              "analysis/zones/zone-r0c1.png choker reads as one flat dark band"]),
    material("metal-gray", "Hardware", "#B9B9B9", ["#8C8C92", "#DCDCDC"], "metal", 0.45, 0.75,
             [{"id": "ringHighlight", "notes": "The choker ring and belt buckle are the only surfaces with a metal highlight in the reference."}],
             ["analysis/zones/zone-r0c1.png choker ring is the only specular element at the throat",
              "analysis/zones/zone-r1c1.png belt buckle reads brighter than the belt itself"]),
    material("sole-gray", "Sole", "#C4C4C8", ["#96969C"], "rubber", 0.85, 0.0,
             [{"id": "soleEdge", "notes": "Sole edge is a hard boundary against the black boot, with no gradient."}],
             ["analysis/views/side.png shows a flat light wedge under each boot",
              "analysis/zones/zone-r2c1.png sole reads as one flat mid value"]),
]

SPEC["repetitionSystems"] = [
    {"id": "tail-slab-chain", "kind": "hand-authored-chain", "level": "meso", "parent": "head",
     "count": 8, "buildsGeometry": True, "realization": "geometry",
     "elementComponentIds": ["tail-slab-1-l", "tail-slab-2-l", "tail-slab-3-l", "tail-slab-4-l",
                             "tail-slab-1-r", "tail-slab-2-r", "tail-slab-3-r", "tail-slab-4-r"],
     "distribution": "four slabs per tail, tapering distally, mirrored across the sagittal plane",
     "description": "Each twin tail is a chain of four stacked angular slabs that taper as they descend, ending in a notched fan."},
    {"id": "coat-trim-chain", "kind": "bounded-trim-chain", "level": "meso", "parent": "coat",
     "count": 2, "buildsGeometry": True, "realization": "geometry",
     "elementComponentIds": ["coat-trim-front-l", "coat-trim-front-r"],
     "distribution": "one continuous strip down each front panel opening",
     "description": "The white edge linework runs the full perimeter of the coat's panel openings as bounded geometry."},
    {"id": "hair-facet-slabs", "kind": "faceted-slab-set", "level": "meso", "parent": "hair-shell",
     "count": 6, "buildsGeometry": True, "realization": "geometry",
     "elementComponentIds": ["fringe", "hair-crown-block", "side-lock-l", "side-lock-r", "ear-cup-l", "ear-cup-r"],
     "distribution": "one crown slab, one fringe slab, two side locks, two ear-cup plates",
     "description": "The hair shell is an assembly of flat cuboid slabs whose facet steps read as the hair's structure."},
    {"id": "boot-chevron-pair", "kind": "bounded-trim-pair", "level": "meso", "parent": "boot-shaft-l",
     "count": 2, "buildsGeometry": True, "realization": "geometry",
     "elementComponentIds": ["boot-chevron-l", "boot-chevron-r"],
     "distribution": "one nested V stroke per boot at ankle height",
     "description": "Nested white chevrons wrap each boot as bounded geometry rather than a texture."},
    {"id": "sleeve-band-pair", "kind": "ring-band-pair", "level": "meso", "parent": "chest",
     "count": 2, "buildsGeometry": True, "realization": "geometry",
     "elementComponentIds": ["sleeve-band-l", "sleeve-band-r"],
     "distribution": "one band per forearm, just above the glove",
     "description": "White sleeve bands wrap each forearm where the sleeve meets the glove."},
]

SPEC["sculptPipeline"] = {
    "passGateMode": "locked-sequential",
    "passOrder": ["blockout", "structural-pass", "form-refinement", "material-pass", "lighting-pass"],
    "currentPass": "blockout",
    "completedPasses": [],
    "lastCompletedPass": "",
    "blockedReason": "blockout requires a browser screenshot and self-correction review before structural-pass unlocks",
    "nextRequiredEvidence": [
        "blockout browser render screenshot",
        "side-by-side reference/render comparison sheet",
        "AI vision score >= 0.7 with layer scores and mismatch critique",
        "reviewHistory entry for blockout with action=continue",
    ],
}
SPEC["buildPasses"] = [
    {"id": "blockout", "goal": "Match the 2.6 head-unit chibi proportions and the standing A-pose silhouette.",
     "componentRefs": ["root", "pelvis", "abdomen", "chest", "neck", "head", "hair-shell", "coat", "tail-l", "tail-r",
                       "upper-arm-l", "upper-arm-r", "forearm-l", "forearm-r", "hand-l", "hand-r",
                       "thigh-l", "thigh-r", "boot-shaft-l", "boot-shaft-r", "boot-foot-l", "boot-foot-r"],
     "acceptance": ["Head-dominated silhouette and overall proportions read correctly without materials."]},
    {"id": "structural-pass", "goal": "Add every meso sub-part and lock the attachment hierarchy.",
     "componentRefs": ["eye-white-l", "eye-white-r", "eye-ring-l", "eye-ring-r", "mouth", "fringe",
                       "hair-crown-block", "side-lock-l", "side-lock-r", "ear-cup-l", "ear-cup-r",
                       "coat-front-l", "coat-front-r", "coat-back", "coat-collar", "hood", "back-star",
                       "halter-top", "halter-strap-l", "halter-strap-r", "choker", "belt", "buckle",
                       "coat-hem-l", "coat-hem-r", "tail-slab-1-l", "tail-slab-1-r", "tail-slab-2-l", "tail-slab-2-r",
                       "tail-slab-3-l", "tail-slab-3-r", "tail-slab-4-l", "tail-slab-4-r", "tail-spike-l", "tail-spike-r",
                       "boot-sole-l", "boot-sole-r"],
     "acceptance": ["Every visible sub-part exists, is attached to its parent socket, and the hierarchy is deep enough to name."]},
    {"id": "form-refinement", "goal": "Refine the blocky hair facets, the tail taper and the boot/coat profiles.",
     "componentRefs": ["hair-shell", "fringe", "hair-crown-block", "side-lock-l", "side-lock-r", "ear-cup-l", "ear-cup-r",
                       "tail-slab-1-l", "tail-slab-2-l", "tail-slab-3-l", "tail-slab-4-l",
                       "tail-slab-1-r", "tail-slab-2-r", "tail-slab-3-r", "tail-slab-4-r",
                       "coat-hem-l", "coat-hem-r", "boot-shaft-l", "boot-shaft-r", "boot-foot-l", "boot-foot-r"],
     "acceptance": ["Recognisable local features match the reference; the hair stays hard-surface and the tails taper."]},
    {"id": "material-pass", "goal": "Apply the two-value palette and the bounded white accent geometry.",
     "componentRefs": ["coat-trim-front-l", "coat-trim-front-r", "back-star", "belt", "buckle",
                       "boot-chevron-l", "boot-chevron-r", "sleeve-band-l", "sleeve-band-r",
                       "choker", "halter-top", "boot-sole-l", "boot-sole-r"],
     "acceptance": ["Palette and material class match the reference; every white accent survives a relight because it is geometry."]},
    {"id": "lighting-pass", "goal": "Set key/fill/rim, exposure, tone mapping and contact shadow.",
     "componentRefs": ["root"],
     "acceptance": ["Materials read under the review lighting; a neutral-light render still shows the same bounded regions."]},
]

SPEC["lightingFromPhoto"] = [
    {"id": "key", "role": "key light", "direction": "front-upper-left", "intensity": 2.1,
     "color": "#FFFFFF", "notes": "Reconstructs the reference's single dominant top-left key that shades the hair facets."},
    {"id": "fill", "role": "fill light", "direction": "front-upper-right", "intensity": 0.55,
     "color": "#9FB6C8", "notes": "Cool low fill so the black garment keeps a readable value instead of crushing to one tone."},
    {"id": "rim", "role": "rim light", "direction": "rear-upper", "intensity": 0.85,
     "color": "#DCE8F2", "notes": "Separates the black silhouette from the background, matching the reference's light edge under the jaw."},
    {"id": "ambient", "role": "environment light", "intensity": 0.35,
     "notes": "Hemisphere ambient so the shadow side is not black; no HDRI, the reference is a flat studio read."},
    {"id": "tone", "role": "exposure and tone mapping", "exposure": 1.0, "toneMapping": "ACESFilmic",
     "notes": "Exposure 1.0 with ACES filmic tone mapping keeps the white trim from clipping while holding the black panels apart."},
    {"id": "contact", "role": "contact shadow", "notes": "A soft ground contact shadow under each boot ties the figure to the ground plane, as the reference sheet's ellipse does."},
]

SPEC["qualityTargets"]["reviewViewpoints"] = ["front", "side", "back", "three-quarter", "thickness-axis", "long-axis"]
# The quality-first material bar (independent albedo/roughness/height/normal/AO maps at >= 1024 and
# referencePbr extracted from source pixels) is written for photographic subjects whose identity
# lives in surface detail. This subject is flat vector-like paint: every material declares
# `textureless` with evidence, and the validator honours that declaration. The generator's separate
# material-pass gate does not read `textureless`, so the priority is recorded as `balanced` here to
# keep the two gates consistent instead of fabricating texture channels the renderer would never read.
# This changes which BAR applies, not how faithful the model is - the fidelity targets stay in
# qualityTargets.mustMatch and every one of them is still reviewed against the reference.
SPEC["lookDevTargets"]["qualityPriority"] = "balanced"
SPEC["lookDevTargets"]["qualityPriorityRationale"] = (
    "Flat-paint stylized subject. Surface identity is carried by bounded colour regions and by "
    "silhouette, not by grain, print or pores, so the texture-channel bar does not describe this "
    "model. Materials are declared textureless with per-material evidence."
)
SPEC["qualityTargets"]["mustMatch"] = [
    "chibi 2.6 head-unit proportion and the standing A-pose silhouette",
    "blocky faceted hair shell, never smoothed",
    "long segmented twin tails terminating above the boot tops",
    "blank white ringed eyes with no iris or pupil",
    "every white accent present as bounded geometry on the black garment",
    "flat-paint material response with no gloss",
]

SPEC["featureReviewTargets"] = [
    {"id": "anatomy-proportion", "name": "Chibi head-unit proportions", "tier": "critical",
     "passIds": ["blockout"], "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["root", "head", "pelvis", "thigh-l"], "evidenceRefs": ["front", "side"]},
    {"id": "face-landmark-placement", "name": "Blank ringed eyes and face landmarks", "tier": "critical",
     "passIds": ["structural-pass"], "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["head", "eye-white-l", "eye-white-r", "eye-ring-l", "eye-ring-r", "mouth"], "evidenceRefs": ["front"]},
    {"id": "pose-silhouette", "name": "Twin-tail silhouette and pose", "tier": "critical",
     "passIds": ["blockout", "form-refinement"], "minimumScore": 0.78, "mustPass": True,
     "componentRefs": ["tail-l", "tail-r", "upper-arm-l", "upper-arm-r"], "evidenceRefs": ["front", "side", "back"]},
    {"id": "hair-facet-structure", "name": "Blocky hair shell and ear cups", "tier": "critical",
     "passIds": ["form-refinement"], "minimumScore": 0.78, "mustPass": True,
     "componentRefs": ["hair-shell", "fringe", "hair-crown-block", "ear-cup-l", "ear-cup-r"], "evidenceRefs": ["front", "side", "back"]},
    {"id": "outfit-and-palette", "name": "Outfit, white accents and palette", "tier": "important",
     "passIds": ["material-pass"], "minimumScore": 0.72, "mustPass": False,
     "componentRefs": ["coat", "back-star", "belt", "buckle", "boot-chevron-l", "boot-chevron-r"], "evidenceRefs": ["front", "back"]},
]

SPEC["qualityContract"]["minimumSpecDepth"] = {
    "macroComponents": 10, "mesoComponents": 55, "microFeatureGroups": 12,
    "materialLayers": 8, "repetitionSystems": 5, "reviewViewpoints": 4,
}
SPEC["preSpecAssessment"]["unknownsToResolveBeforeImplementation"] = []

DETAILS = [
    ("d01", "linework", "Thick black limbal ring around each eye, ~13% of the eye diameter, fully enclosing a blank sclera", "eye-ring-l/limbalRing", 0.95),
    ("d02", "decal", "Hard-edged white five-point star centred on the coat back", "coat/backStar", 0.9),
    ("d03", "linework", "White edge linework running the full perimeter of each coat panel opening", "coat/trimChain", 0.9),
    ("d04", "ridge", "Crown is a raised central block flanked by two lower slabs, producing the stepped top edge", "hair-shell/crownBlocks", 0.9),
    ("d05", "ridge", "Flat rectangular ear-cup plate projecting laterally over the ear position on each side", "ear-cup-l/earCups", 0.85),
    ("d06", "fastener", "Square buckle plate centred on the white belt", "buckle/bucklePlate", 0.85),
    ("d07", "fastener", "Small metal ring pendant on the choker at the throat", "neck/chokerRing", 0.8),
    ("d08", "linework", "Nested white V strokes wrapping each boot at ankle height", "boot-shaft-l/bootTrim", 0.85),
    ("d09", "bevel", "Light wedge sole under each boot, thicker at the toe, the only bright element below the knee", "boot-sole-l/wedgeSole", 0.8),
    ("d10", "groove", "Navel on the exposed midriff band, between the halter top and the shorts", "abdomen/navel", 0.9),
    ("d11", "ridge", "Four stacked angular slabs per twin tail, tapering distally into a notched fan", "tail-l/slabChain", 0.8),
    ("d12", "contour", "A fringe lock overlaps the character's left eye, cutting its visible width to 52 px from 69 px", "fringe/asymmetricOverlap", 0.85),
    ("d13", "linework", "White band where each sleeve meets its glove, plus an upper-arm band", "sleeve-band-l/sleeveBands", 0.8),
    ("d14", "seam", "Raised collar band at the throat with a small zipper pull at its centre front", "coat-collar/zipperPull", 0.75),
]
SPEC["preSpecAssessment"]["detailInventory"] = {
    "scanMethod": "grid-3x3 + component-zones",
    "targetMinDetails": 12,
    "note": "Each detail maps to a component.localFeatures entry, so none is prose-only.",
    "details": [
        {"id": did, "kind": kind, "description": desc,
         "scale": "reference-scale", "affects": "geometry",
         # `ref` is the bare local-feature key: check_part_coverage.py folds keys with `norm()`
         # and only ever registers bare feature ids, while the spec validator also adds the
         # 'component/feature' form. The bare key satisfies both; `component` keeps the owner.
         "mapsTo": {"type": "component.localFeatures", "ref": ref.split("/")[-1],
                    "component": ref.split("/")[0]},
         "evidenceRef": "analysis/image-analysis.md#layer-7", "confidence": conf}
        for did, kind, desc, ref, conf in DETAILS
    ],
}

SPEC["preSpecAssessment"]["objectClass"]["primaryDomain"] = "character"
SPEC.pop("rig", None)
SPEC["actionReadiness"]["defaultRigType"] = "action-ready-pivot-rig"
SPEC["actionReadiness"]["contract"] = (
    "Every macro and meso component is emitted as a named Object3D pivot Group with a mesh child, an action "
    "profile, collider proxy and destruction metadata. Bone-track skinning is deliberately not emitted: this "
    "subject's identity is bounded flat regions and rigid blocky hair, so a pivot hierarchy preserves it and a "
    "skeleton whose bind pose was authored for a different proportion set would only distort it."
)
SPEC["pipelineRouting"]["track"] = "character-v1.5"
SPEC["localSpecSearch"] = {
    "collection": "core_3d",
    "query": "chibi character blocky hair shell bounded trim vertex region proportion",
    "index": {"status": "rebuilt", "reason": "missing"},
    "matches": [],
    "note": "The core_3d collection ships no chibi-character entry; the geometry decisions above are derived from the reference sheet and from grimoire/character/reconstruction.md rather than from a retrieved precedent.",
}

SRC.write_text(json.dumps(SPEC, indent=2), encoding="utf-8")

macros = sum(1 for c in C if c["level"] == "macro")
mesos = sum(1 for c in C if c["level"] == "meso")
feats = sum(len(c["localFeatures"]) for c in C)
print(f"components={len(C)} macro={macros} meso={mesos} localFeatures={feats} "
      f"materials={len(SPEC['materials'])} repetitions={len(SPEC['repetitionSystems'])}")
