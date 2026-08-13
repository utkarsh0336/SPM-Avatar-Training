# VRM avatar assets

All five files below are built and present. They were generated via Blender, scripted
through **BlenderMCP** (an MCP server bridging Claude to a running Blender instance —
see `claude mcp list`), using the pipeline documented in this file. If you need to
regenerate or add a new replica, read the "Gotcha" section below first — it cost a full
debugging pass to find.

Chosen pipeline: **Blender + [MPFB](https://static.makehumancommunity.org/mpfb.html)**
(MakeHuman Plugin for Blender) for the base human model, exported via the
**[VRM Add-on for Blender](https://github.com/saturday06/VRM-Addon-for-Blender)** (saturday06,
GPLv3+/MIT, supports VRM 0.x and 1.0). Both are free/open-source. MPFB's core assets (base
mesh, targets, skins) are **CC0** per MakeHuman Community's own FAQ — safe to redistribute
commercially, no attribution required — *as long as you stick to MPFB's own bundled assets*.
Any third-party clothing/hair pack pulled in separately needs its own license check before use.

## Files needed

Filenames must exactly match the `id` field in `packages/avatar-core/src/replicas.json`:

| Filename | Style | Gender | Outfit |
|---|---|---|---|
| `realistic-female-business_formal.vrm` | Realistic | Female | Business formal |
| `realistic-male-business_casual.vrm` | Realistic | Male | Business casual |
| `animated-neutral-tech_creative.vrm` | Animated/stylized | Neutral | Tech-creative |
| `stylized_3d-female-academic_educator.vrm` | Stylized 3D | Female | Academic/educator |
| `_placeholder.vrm` | any | any | any — the one always-present fallback used when a specific replica's file is missing or fails to load |

(MPFB's realistic human meshes are the strongest fit for the two `realistic-*` entries. The
`animated`/`stylized_3d` entries will need non-photoreal shading/proportions — MPFB can still
provide the base rig, but treat the surface look for those two as a separate art pass.)

## Hard technical requirements (the code depends on these — not optional)

1. **A VRM expression preset named exactly `"aa"`**, bound to a mouth-open blend shape.
   `vrm-expression-driver.ts` calls `vrm.expressionManager.setValue("aa", weight)` every frame
   during speech to drive lip-sync — if this preset doesn't exist, the mouth just never moves.
   Set this up in the VRM Add-on's **Expressions** panel before export, mapped to whatever
   mouth-open shape key MPFB generates.
2. **Material names containing the substrings `skin`/`face`/`body` (case-insensitive) for skin
   materials, and `hair` for hair materials.** `vrm-material-tint.ts` does a substring match on
   `material.name` to apply live skin-tone/hair-color tinting. Rename materials in Blender if
   MPFB's defaults don't already match (they usually do, e.g. `Body`, `Face`, `Hair001`).
3. **Standard humanoid bone rig** — the VRM Add-on's Humanoid panel needs every required bone
   mapped (it will refuse to export otherwise). MPFB's default rig maps cleanly to this.
4. **Real-world human scale, in meters, feet at the origin.** `vrm-loader.ts` places the camera
   at `(0, 1.4, 1.6)` looking at `(0, 1.35, 0)` — i.e. it assumes roughly eye-height ≈ 1.4–1.6m.
   MPFB exports at this scale by default; don't rescale.
5. Export as **VRM 1.0** if the addon gives you the choice (VRM 0.x also works — `vrm-loader.ts`
   auto-detects `vrm.meta.metaVersion` and compensates for 0.x's opposite facing direction — but
   1.0 is the current spec and avoids that quirk).

## Soft guidance (not enforced by code, but matters for a widget embedded on customer sites)

- Keep each file reasonably small — this loads over the network into a live training session.
  Decimate MPFB's high-poly mesh output and keep textures ≤2048px where the addon supports
  texture compression on export.
- `_placeholder.vrm` should be the simplest/lightest of the five, since it's the last-resort
  fallback and should never itself become a loading bottleneck.

## Gotcha: MPFB materials export with unwanted alpha transparency

Every MPFB-generated material (skin, hair, clothes, eyes, eyebrows) defaults to
Blender's `HASHED` render method, with the Principled BSDF's **Alpha input wired
directly to the diffuse texture's own alpha channel** — e.g. skin textures like
`young_lightskinned_male_diffuse.png` don't have a uniform-255 alpha channel, so
the exported glTF material ends up with `alphaMode: "BLEND"` and partially-transparent
regions (most visibly the face) render as a dark bleed-through against whatever's
behind the mesh. This is invisible in Blender's own EEVEE viewport (which dithers/AAs
around it) but glaring in three.js/three-vrm's WebGL rendering.

**Fix**: before exporting, walk every material's node tree (including inside node
groups — MPFB's skin shader is a nested group) and for every `Principled BSDF` node,
sever any link into its `Alpha` input and force `default_value = 1.0`. Also set
`material.blend_method = 'OPAQUE'` for good measure, though the real fix is the alpha
link, not the render-method flag (in Blender 5.2's EEVEE Next, `blend_method` is a thin
compatibility shim over `surface_render_method` and doesn't reliably stick on its own).
See the git history of this pipeline's build scripts for the exact recursive fixup
function — it's cheap to re-run and safe to apply universally, including to materials
that don't have the bug.

## Regenerating or adding a replica

1. Ensure BlenderMCP, MPFB, and the VRM Add-on for Blender are installed and connected
   (`claude mcp list` should show `blender` connected; inside Blender, the addon must be
   enabled and "Connect to Claude" clicked in the N-panel's BlenderMCP tab).
2. MPFB's system asset pack (skins/hair/clothes/eyes — CC0, ~267MB) and the `faceunits01`
   pack (ARKit expression shape keys incl. `jawOpen` — CC0, ~0.2MB) must both be installed
   into MPFB's user data directory, both downloaded from `files2.makehumancommunity.org`.
   Neither ships with the base MPFB addon.
3. Build via `TargetService`/`HumanService`/`FaceService` (MPFB's Python API, importable
   inside Blender once the addon is enabled) to set macrodetails (gender/age/race), apply
   skin, hair, clothes, eyes/eyebrows/eyelashes, and a rig (`add_builtin_rig(obj, "default")`
   — the specific bone-naming scheme the VRM addon's own MPFB bone mapper expects).
4. Load ARKit face shape keys (`FaceService.load_targets(obj, load_arkit_faceunits=True)`),
   then `bpy.ops.vrm.assign_vrm1_humanoid_human_bones_automatically` and
   `bpy.ops.vrm.assign_vrm1_expressions_from_arkit` to wire up the skeleton and the `"aa"`
   expression automatically.
5. Apply the alpha-link fix above, then `bpy.ops.export_scene.vrm(filepath=..., armature_object_name=...)`.

## Verifying changes

1. Run `pnpm dev` in `apps/dashboard`, open the onboarding wizard, and confirm each replica
   loads, animates (idle spring-bone motion), lip-syncs, and responds to skin-tone/hair-color
   tint changes.
2. Run `pnpm verify` per `CLAUDE.md`.
