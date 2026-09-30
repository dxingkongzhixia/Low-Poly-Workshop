# Three.js standard modeling analysis

## Scope and provenance

The target URL resolves to a Bilibili Toy shell and an iframe on `bilibilitoy.com`. The content bundle used by the page was downloaded on 2026-09-28. The downloaded JavaScript is a minified production bundle, so it exposes implementation evidence rather than the original source modules. Five `Object3D.toJSON()` payloads were found: two distinct models (`iE` classic and `aE` desolate) plus three identical classic runtime copies (`PE`, `yD`, and `dO`). They are intentionally kept as JSON instead of being converted to a proprietary DCC format.

The project is a Three.js application. Evidence includes the Three.js renderer/classes in the bundle, `Object3D.toJSON()` metadata version 4.7, `MeshStandardMaterial`, custom shader materials, WebGL rendering, and explicit Three.js scene parsing.

## What is modeled

### Characters

The interactive cast is represented primarily by named actor data and runtime scene objects. The embedded study mesh is a modular wolf-eared character reference with these parts:

- rounded cheeks and chin;
- flat layered long hair, square crown/fringe, face-framing locks, chest locks;
- two ear pivots and wolf ears;
- double hair clips;
- mirrored legs: thigh, knee joint, shin, ankle straps, strap boot, buckles, legwear;
- mirrored arms: upper arm, forearm, hand, flared sleeves, sleeve patches;
- mirrored swords;
- downward tail;
- base body, hood, asymmetric coat, clasps/tags, and coat stitching.

The names are meaningful modeling documentation, not arbitrary mesh IDs. Preserve this style of semantic naming in new assets.

### Props / items

The gameplay code refers to interaction-driven objects such as seats, doors, armory keypad, security door, garage shutter, cardboard box, cup, cart, smoke, flash, diamond, microphone, music, and weapons. Their construction is mostly procedural or composed from simple scene objects rather than a separate model archive. Treat them as modular prop kits:

- hard-surface primitives for doors, shutters, keypad, cart, and box;
- thin layered meshes for labels, straps, patches, and weapon blades;
- small pickup meshes with clear interaction silhouettes;
- pivot groups for doors, shutters, lids, and carried objects.

### Scenes

The scene is a warehouse/logistics environment with zones, routes, doors, seats, security and garage access, patrol positions, blackout/smoke/flash state, and a Texas-carry escape sequence. The level logic is coordinate-driven: actors and interactables are placed in a compact X/Z map and navigation is expressed as points, zones, and routes. This favors a readable top-down/oblique composition over photorealistic environment detail.

## Modeling principles

### 1. Silhouette before surface detail

The reference uses a small number of deliberately shaped meshes. Hair is split into broad planar layers; coat panels and sleeve flares are separate pieces; ears, tail, buckles, and swords are silhouette accents. Establish the outline from front, side, and three-quarter views before adding seams or texture.

### 2. Anatomical base plus costume overlay

Keep the base head, torso, arms/hands, thighs, shins, and feet independent from costume meshes. This permits alternate clothing, animation, damage states, and study variants without rebuilding the body.

### 3. Pivot-first articulation

The source creates explicit pivots for ears, elbows, ankles, and other moving parts. Use empty `Group` nodes at joints, put the mesh under the group, and rotate the group—not the mesh origin. This is especially important for ears, hair, tail, limbs, doors, and carried items.

### 4. Low-poly with selective asymmetry

The mesh budget is spent on the face silhouette, hair contour, coat outline, swords, and boots. Large low-value surfaces are simplified. The coat is intentionally asymmetric, while mirrored limbs share the same construction. Mirror only where the design calls for symmetry.

### 5. Layered cards and shallow solids

Hair locks, coat stitching, sleeve patches, tags, and buckles are modeled as thin layered geometry or shallow extrusions. Avoid dense sculpting when a clean planar layer communicates the same read.

### 6. PBR values over complex textures

The reference predominantly uses `MeshStandardMaterial`. Skin is a warm base color; most costume materials are near-white with roughness around `0.83`; smoother accents are around `0.69`; metalness is low (`0.04–0.05`) except where a new asset requires a stronger metal read. One face/appearance texture and two additional small textures are packed into the JSON reference.

### 7. Cleanup and budgets are part of modeling

The embedded model records an optimization pass: `5108` triangles before, `2078` after, and a reference-study total of `1787` triangles under a `2000` triangle limit. It also records removal of enclosed faces and surface cleanup. Treat cleanup as a required modeling stage, not a final optimization emergency.

## Reference budget extracted from the model

| Category | Target triangles |
|---|---:|
| Base head | 300 |
| Base arms/hands | 100 |
| Base torso | 60 |
| Base legs | 130 |
| Hair | 330 |
| Arm decoration | 100 |
| Shoes | 50 |
| Animal ears | 30 |
| Tail | 80 |
| Held weapons | 200 |
| Reference total | 1787 / 2000 |

These are style-reference budgets, not universal limits. Raise them only when the silhouette or deformation demonstrably needs more geometry.

## Scene and camera recipe

- Use an oblique perspective camera with a readable three-quarter view.
- Keep the floor and major walls simple, with strong color/value blocks.
- Use soft ambient/fill plus one readable directional/key light.
- Keep interactable props visually distinct from background clutter.
- Use fog or subdued background values to preserve character readability.
- Place actor/prop origins at meaningful contact points: feet on floor, hand at grip, door at hinge, lid at hinge.

## Implementation recipe for new Three.js assets

### Template-first rule

Do not begin a character by guessing coordinates for isolated primitives. First load a reference JSON, compute its bounding box, and establish normalized landmarks such as foot plane, knee, pelvis, shoulder, chin, crown, ear tips, and hand/grip positions. New geometry should be authored in this normalized coordinate system and attached to semantic groups that mirror the reference hierarchy. This is the key difference between a convincing modular character and an arbitrary primitive sculpture.

```js
const character = new THREE.Group();
character.name = 'character-reference';

const body = new THREE.Group();
body.name = 'body';
character.add(body);

const elbow = new THREE.Group();
elbow.name = 'elbow-pivot-L';
body.add(elbow);

const sleeve = new THREE.Mesh(sleeveGeometry, clothMaterial);
sleeve.name = 'reference-flared-sleeve-L';
elbow.add(sleeve);
```

Prefer `BufferGeometry`, indexed meshes where useful, shared materials, and `MeshStandardMaterial`. Compute normals after procedural edits. Keep userData such as `studyCategory`, `triangleBudget`, and `referenceRole` on each mesh so a viewer or exporter can audit the asset.

## Viewer controls

The bundled viewer supports orbit drag, wheel zoom, reset, wireframe toggle, auto-rotate, category visibility toggles, and a triangle/object/material audit panel. It parses the same Three.js JSON format as the reference asset.
