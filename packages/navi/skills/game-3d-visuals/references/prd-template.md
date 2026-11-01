# Visual PRD template

Copy this into `visual-plan/PRD.md` and fill every section. Delete the games-only section for a pure model or scene. The examples show the level of detail expected; replace them.

```markdown
# <Project name>: visual PRD

## 1. Goal and visual pillars
<One paragraph: what is being made, for whom, the final deliverable.>
Pillars:
- <e.g. Chunky, toy-like proportions: thick parts, generous bevels, no thin spindly pieces>
- <e.g. Saturated candy palette on a clean white studio background>
- <e.g. Soft, readable lighting with one large key and a soft contact shadow>

## 2. Reference index
| File | Shows | Authoritative for | Source |
|---|---|---|---|
| refs/hero.png | three-quarter front-right view | silhouette, colors, camera; wins all conflicts | user / generated |
| refs/side.png | right side profile | body depth, wheel spacing | generated from hero |
| refs/detail-cockpit.png | close-up of cockpit | window shape, seat, trim | generated from hero |
Assumptions for parts no reference shows:
- <e.g. back of the body is a plain mirror of the front panel layout>

## 3. Global look
- Style: <e.g. clean stylized PBR render, slightly toy-like, no texture noise>
- Palette: body red #C8202B; trim chrome #D9D9D9 (metallic 1.0, roughness 0.15); tires #1A1A1A (roughness 0.8); glass #2B3A44 (transmission 0.9)
- Lighting: large soft key from front-left-above (~45° azimuth, 50° elevation); low fill from right; faint rim from behind; white world ~0.6 strength; soft contact shadow directly under the object, darkest at contact points
- Camera: three-quarter front-right, ~25° above the object's center, normal lens (~50 mm feel); subject fills ~70% of frame width, centered, fully in frame with margin
- Background / ground: plain white (#FFFFFF), seamless; shadow catcher floor
- Render: <engine, samples, resolution, color management>

## 4. Objects
### 4.1 <Object name>  (refs: hero.png, side.png)
Base unit: overall length L = 1.0
Shape: <primitive breakdown and silhouette, e.g. "long low wedge; top line rises from nose (0.18 L high) to cabin peak (0.32 L high) at 55% of length, then drops to a flat tail (0.24 L high)">
Parts:
| Part | Count | Size (in L) | Position | Material | Notes |
|---|---|---|---|---|---|
| body | 1 | 1.0 × 0.45 × 0.30 | origin, resting on wheels | body red | bevel 0.02 L on all edges |
| wheel | 4 | Ø0.18, width 0.07 | axles at 0.18 L and 0.80 L from nose; track 0.40 L | tires + chrome hub | hub is 50% of wheel diameter, 5 spokes |
| headlight | 2 | 0.06 × 0.03 | front face, 0.07 L in from each side, 0.14 L high | emissive white #FFF6E0, strength 3 | slightly recessed |
Details: <seams, panel lines, decals, wear; every small feature visible in any reference>

### 4.2 <Next object> ...

## 5. Games only
- Core loop: <e.g. dodge falling asteroids, collect crystals, survive 90 s>
- Controls: <keys / mouse / touch, with exact bindings>
- Camera: <fixed / follow with lag 0.15 s / orbit; FOV; height>
- States: start screen -> play -> game over (score, best, restart on R/Enter)
- HUD: <elements, position, font, size, color>
- Feedback and juice: <hit flash 80 ms white, screen shake 6 px decaying 200 ms, particle burst of 20 on collect, easing curves>
- Animation: <idle bob 4 px at 1.2 Hz, etc.>
- Audio: <if any>

## 6. Technical constraints
- Tool/engine: <Blender 4.x bpy, Cycles CPU, 32 samples / three.js r16x / ...>
- Required outputs: <exact paths and formats>
- Resolution: <1200x800>
- Performance: <render under N min / 60 fps on a laptop>

## 7. Work breakdown
1. Camera, framing, ground/background, lighting rig (gray placeholder of the subject)
2. Primary forms: body silhouette and proportions
3. Secondary parts: wheels, cabin, ...
4. Materials and colors
5. Small details
6. Final render settings, polish

## 8. Acceptance criteria
- AC-01 (hero.png): silhouette matches: nose-to-cabin-peak rise and tail drop at the stated positions
- AC-02 (hero.png): 4 wheels visible as in the reference, hubs chrome with 5 spokes
- AC-03 (hero.png): body color reads as #C8202B red under the scene light, not orange or pink
- AC-04 (hero.png): soft contact shadow under the object; no floating gap
- AC-05 (hero.png): camera angle and framing match: front-right three-quarter, slightly above, centered, fully in frame
- AC-06 (detail-cockpit.png): cockpit window shape and seat visible
- ...
- AC-final: side by side with hero.png, a viewer would call them the same object, with no major visible difference
```

## Sections added later (do not create them when writing the PRD)

The review step appends a `## Review` list of what it added or corrected, and each acceptance round appends a `## Polish round N` table. Example of one such round:

```markdown
## Polish round 1
| # | Defect (what is visibly wrong) | Target (from reference) | Where to change |
|---|---|---|---|
| 1 | cabin too tall, reads as a van | cabin peak 0.32 L, now 0.41 L | build_scene.py: make_cabin() height |
| 2 | red too orange | #C8202B base color; now #D8452A | body material |
```

## Writing tips

- Measure, do not guess: take bounding-box pixel ratios from the reference for proportions, and sample pixel colors in lit and shadowed areas (a lit surface reads brighter than its true base color).
- Name things the same way in the PRD, the code and the acceptance verdicts, so a failure maps to the code that owns it.
- One criterion checks one thing. "Looks good" is not a criterion.
