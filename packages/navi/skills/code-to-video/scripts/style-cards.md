# Style cards

One section per shipped look. Nobody reads this file whole: `new.py styles` prints one index line per card,
`new.py look <id>` prints the chosen card, saves it in the work folder and merges its JSON block into film/style.js,
and `new.py card-lint --all` checks every card against the template. The cards condense this skill's own style studies.
Adapted in part from lemo-opuscar (MIT, © LemoLab: fields that keep a card from becoming a template) and
saas-motion-kit (MIT, © its contributors: the card structure); rewritten.

## 3d-render: 3D Render (3D渲染)

**Fit.** Use for briefs that sell a material or a feeling: premium launches, brand moments, a short-name hero. Not for dense explainers, interfaces, charts, or long names. Confused with: isometric clay (fixed axes, no focus blur); liquid (one gradient body under gravity); glass-gradient (light behind flat glass).
**Reviewer.** Soft lit materials, shallow focus and a camera that never stops are intended; judge the hero's material and whether it dominates.
**Transfer.** Every object is a material lit by one light in one space: the subject's noun as a tactile object; its verb as a physical event.
**Variation.** Structures: a drop and its impact; a slow orbit around one object; objects arriving one by one. Openings: a blurred foreground pulling back to the hero; an object already falling; light sweeping on. Endings: the hero settled while the camera drifts; the world recoloured by the hit; a pull-back to a still life.
**Pitfalls.** A hero too short to dominate → fewer words, at most two rows. Pale low-contrast light reads as a CSS gradient → dark crevices, a saturated hero, strong speculars. Far repeated geometry aliases → fade it into haze. A hit between frames → an impact move: its hit lands on the first contact frame.
**Fidelity.** A ray-marched or CSS-shaded scene stands in for real 3D assets.
**Ref (n=1).** A 24/s picture; a fall reaching about 164 px/f with shutter blur; hero 57% of the width, 34% of the height; last 2 s energy 1.22 then 0.36, never still.

```json
{"register": ["neutral", "energetic"], "mood": "premium", "stage": "lit",
 "ground": {"material": "soft repeated forms fading into haze", "motion": "reacts to impacts"},
 "palette": {"logic": "material", "roles": "soft field, one saturated hero material"},
 "accent": {"meaning": "hero"}, "light": "soft key and rim; speculars are shading", "depth": "focus blur and haze",
 "texture": {"kind": "none"},
 "type": {"display": "inflated glossy letters", "read": "small tracked capitals",
  "faces": {"display": ["Rammetto One", "Titan One", "Dela Gothic One"], "read": ["Manrope", "Sora"]}},
 "motion": {"clock": {"kind": "stepped", "fps": 24, "rates": {"picture": 24}}, "curves": "gravity, settle",
  "blur": {"translation": "drawn", "pop": "crisp", "camera": "drawn", "impact": "drawn"}, "arrival": "drop",
  "overshoot": {"kind": "small", "squash": "on contact"}, "holds": {"kind": "alive", "alive": "camera"},
  "camera": "never stops: slow dolly or orbit, focus pulls"},
 "energy": {"shape": "build", "punch_max": {"flash": 0, "slam": 1, "shake": 0}, "beat": "none", "counts": "debris in hero materials, never filler dust"},
 "seams": {"native": "depth reveal or impact recolour", "never": ["hard cuts"], "repeat": "each-once"},
 "sound": {"bed": "music", "cues": "the impact on a beat after a dropout"},
 "composition": {"dominant": [0.3, 0.6], "emptiness": false, "balance": "centred"},
 "guards": {}, "start": {"hero_height_share": 0.3, "read_drift_pxf": 1, "contact_squash": 0.15},
 "helpers": ["look.clock", "film.move", "film.hold"], "expect": []}
```

## bauhaus: Bauhaus Geometric (几何构成包豪斯)

**Fit.** Use for design, architecture, music and culture events, posters cut to a beat, brand systems of primitives. Not for warm lifestyle stories, photo- or interface-led content. Confused with: flat-vector (rounded shapes that overshoot); Swiss kinetic type (type alone on a grid); morph (one shape becoming the next).
**Reviewer.** Primitives snap onto the grid without overshoot and rest between beats; the rests are rhythm, not freezes. Judge the grid, the landings and the balance.
**Transfer.** Every element is a primitive on the module grid that lands on a beat: the subject's noun as circles, squares and triangles; its verb as a landing or a turn.
**Variation.** Structures: a poster that builds itself beat by beat; primitives rearranging into a figure; a pattern that tiles and reassembles. Openings: a construction line draws in; one circle lands; the ground inverts to ink. Endings: the finished poster held; the group turning into its last balance; tiles flipping back to bare paper beside the name.
**Pitfalls.** Primitives off the grid → every edge on a module line. Soft eased fades float → short snaps that land on the beat, then rest. The textbook triad layout → primitives that depict the subject. Pure white and neon primaries → warm paper, slightly muted primaries.
**Fidelity.** Vector shapes stand in for printed poster ink.
**Ref (n=1).** Paper 56–70% of the frame, vermilion 8.5–10.8%, yellow 5.3–5.7%, cobalt 2.5–7.1%, ink 5–12%; snaps of 4–7 frames starting 133–200 ms early and landing within a frame of the beat; rests of 8–17 frames.

```json
{"register": ["energetic", "neutral"], "mood": "", "stage": "flat",
 "ground": {"material": "warm paper with a faint module grid", "hexes": ["#F7EFDF", "#DDD4C8"], "motion": "static"},
 "palette": {"logic": "triad", "hexes": ["#EA3E34", "#FDBF06", "#1F50A7", "#111010"], "roles": "equal primaries and warm ink; a beat may invert to ink"},
 "accent": {"meaning": "none"}, "light": "none", "depth": "overlap", "texture": {"kind": "none"},
 "type": {"display": "heavy geometric sans, set across and up", "read": "geometric sans", "texture_text": "furniture",
  "faces": {"display": ["Jost", "League Spartan", "Josefin Sans"], "read": ["Jost", "Kumbh Sans"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "beat-snap",
  "blur": {"translation": "directional", "pop": "crisp", "camera": "crisp", "impact": "crisp"},
  "arrival": "unfold from an edge, drop, or open from a corner", "overshoot": {"kind": "none"},
  "holds": {"kind": "still"}, "camera": "locked"},
 "energy": {"shape": "even-high", "punch_max": {"flash": 0, "slam": 0, "shake": 0}, "beat": "landings", "counts": "rests between landings are beat rests"},
 "seams": {"native": "a landing on the beat", "never": ["crossfade"], "repeat": "each-once"},
 "sound": {"bed": "a strict drum pattern", "cues": "kicks under landings"},
 "composition": {"dominant": [0.4, 0.9], "emptiness": false, "balance": "asymmetric"},
 "guards": {}, "start": {"snap_frames": [4, 7]},
 "helpers": ["time.beatFrame", "film.move", "look.directional"], "expect": []}
```

## collage: Cut-out Collage (拼贴剪贴)

**Fit.** Use for editorial, zine, music, culture and retro-print briefs, festivals, witty explainers. Not for luxury minimalism, precise interfaces, or photos that may not be cut. Confused with: sticker-explainer (die-cut stickers moving smoothly); hand-drawn (lines redrawn, never cut).
**Reviewer.** Cut paper moved on threes, visible scissor edges, tape and halftone are intended; judge the composition around one focal cut-out and each slap's timing.
**Transfer.** Every element is a physical cut-out with a margin and one shadow: the subject's noun as a found photo or engraving; its verb as a slap, a tear or a hinge.
**Variation.** Structures: a page that fills piece by piece; a torn-paper journey; a hinge opening onto a new world. Openings: scissors along a dashed line; a masthead slapped on; a page torn away. Endings: a cover page held; a last tear revealing a bare board; a stamp on the final piece.
**Pitfalls.** Smooth eased tweens read as a slide deck → key positions on the drawing clock. Holds frozen dead, or jittering every frame → one small nudge per drawing. Clean vector edges look digital → torn rims, scissor margins, tape. Rainbow palettes kill the print look → paper neutrals, black, one signal colour.
**Fidelity.** Canvas halftones and polygon tears stand in for real cut photos and engravings, which need rights.
**Ref (n=1).** 12.08 drawings/s, frame gaps of 2 and 3 equally often; one signal colour on 61% of the closing frame; about 270 ms of silence before the biggest hit.

```json
{"register": ["energetic", "neutral"], "mood": "playful", "stage": "medium-cutpaper",
 "ground": {"material": "kraft or paper board with fibre", "motion": "static"},
 "palette": {"logic": "roles", "roles": "paper neutrals, black, one signal colour; cut photos keep theirs"},
 "accent": {"meaning": "signature"}, "light": "none", "depth": "one short soft shadow per piece",
 "texture": {"kind": "halftone", "changes": "never"},
 "type": {"display": "condensed grotesque on torn tape", "read": "typewriter mono", "texture_text": "material", "reveal": "slap",
  "faces": {"display": ["Anton", "Oswald", "Big Shoulders Display"], "read": ["Courier Prime", "IBM Plex Mono"]}},
 "motion": {"clock": {"kind": "stepped", "fps": 30, "rates": {"drawings": 12}}, "curves": "key-pose",
  "blur": {"translation": "crisp", "pop": "crisp", "camera": "crisp", "impact": "crisp"},
  "arrival": "from-oversize slap", "overshoot": {"kind": "drawn-key"},
  "holds": {"kind": "alive", "alive": "boil"}, "camera": "locked"},
 "energy": {"shape": "build", "punch_max": {"flash": 1, "slam": 2, "shake": 0}, "beat": "none", "counts": "a slap's event sits on the drawing where it lands"},
 "seams": {"native": "a tear", "never": ["crossfade"], "repeat": "each-once"},
 "sound": {"bed": "noisy lo-fi", "cues": "paper and scissor foley"},
 "composition": {"dominant": [0.3, 0.6], "emptiness": false, "balance": "asymmetric"},
 "guards": {}, "start": {"nudge_px": 1, "nudge_deg": 0.25, "halftone_cell_px": 9, "slap_scale": 1.3},
 "helpers": ["look.clock", "film.nudge", "look.halftone"],
 "expect": ["paper and scissor timbres stay logged foley until S23"]}
```

## flat-vector: Flat Vector (扁平矢量)

**Fit.** Use for friendly consumer, fintech or education promos and explainers told through one character-like object. Not for premium or serious registers, interface walkthroughs, or exact data. Confused with: bauhaus (grid primitives, no overshoot); morph (one shape becoming the next); sticker-explainer (stickers with margins).
**Reviewer.** Flat shapes with no lighting, gradient or grain are intended, and pops overshoot on purpose; judge whether one hero object causes each change.
**Transfer.** One hero object causes every change: the subject's noun as a rounded character-object; its verb as the bounce, launch or pop it sets off.
**Variation.** Structures: a chain reaction set off by the hero; a portal into a scene; a grid built cell by cell. Openings: the hero falls in and squashes; one pop on an empty ground; a swoop. Endings: the hero at rest under one expanding ring; the grid collapsing into one shape; the hero's trail becoming the name.
**Pitfalls.** Clip art in unrelated hues and mixed corner radii → a role table, one radius family. Pops sharing one ease and landing together → staggered pops with real overshoot. Weightless symmetric bounces → hold the contact squash, stretch along the speed, decay each rebound. A white or grey ground → a saturated ground, cream for white.
**Fidelity.** Inline vector shapes posed in closed form stand in for rigged character animation.
**Ref (n=1).** On ones; ground 42% of a busy frame; hero accent 7%; contact squash 2.1:1 held 2 frames; rebounds of 143 then 18 px; a launch of about 505 px in one frame, smeared; pops +25%.

```json
{"register": ["neutral", "energetic"], "mood": "friendly", "stage": "flat",
 "ground": {"material": "one saturated mid-dark colour; a lighter tint for far shapes", "motion": "static"},
 "palette": {"logic": "roles", "roles": "ground, one hero accent, up to three supporting brights, cream for white, navy for black"},
 "accent": {"meaning": "hero"}, "light": "none", "depth": "overlap and tints", "texture": {"kind": "none"},
 "type": {"display": "heavy rounded wordmark", "read": "rounded geometric sans",
  "faces": {"display": ["Fredoka", "Baloo 2", "Nunito"], "read": ["Nunito", "Rubik"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "gravity, bounce",
  "blur": {"translation": "smear", "pop": "crisp", "camera": "crisp", "impact": "crisp"},
  "arrival": "from-zero pops, staggered", "overshoot": {"kind": "pop", "max_pct": 25},
  "holds": {"kind": "still"}, "camera": "a slow push while the scene builds"},
 "energy": {"shape": "build", "punch_max": {"flash": 1, "slam": 2, "shake": 0}, "beat": "none", "counts": "bursts only from a contact"},
 "seams": {"native": "the hero's own motion", "never": ["crossfade"], "repeat": "each-once"},
 "sound": {"bed": "upbeat music", "cues": "a thump per contact, whooshes on launches"},
 "composition": {"dominant": [0.4, 0.8], "emptiness": false, "balance": "centred"},
 "guards": {}, "start": {"pop_stagger_frames": [3, 4], "rebound_heights": [0.3, 0.09]},
 "helpers": ["film.move", "film.enter", "look.smear"], "expect": []}
```

## glass-gradient: Diffuse-Gradient Glassmorphism (弥散渐变玻璃拟态)

**Fit.** Use for calm launches of software, AI assistants, OS features, wellness or premium tech with a soft interface. Not for data-dense, warm, handmade or print briefs. Confused with: liquid (a glossy body under gravity); 3d-render (lit materials in depth); generic purple glass (one glow behind a centred title).
**Reviewer.** Slow light drifting behind a still read layer is intended, and nothing hits; judge whether each glass layer has a job and whether text reads over it.
**Transfer.** Every surface is glass over moving light: the subject's noun as a panel, lens or control; its verb as one refraction or a change of focus.
**Variation.** Structures: one drift through layered glass; a travelling lens that reveals; panels assembling into an interface. Openings: a field resolving from black; a bead growing into a panel; copy bent by a passing lens. Endings: the lens resting on the key word; panels racking out to the product; fields dimming under one line.
**Pitfalls.** Glass everywhere around a centred title → one job per layer. Dark gradients band after encoding → static grain. White text on bright glass fails contrast → dark or tinted glass under read text. A lens doubles the text beneath → mask the plain line under it. Blur on every layer → one sharp plane.
**Fidelity.** CSS gradients and backdrop blur stand in for shader light fields and real refraction.
**Ref (n=1).** 89% of frames change, at low energy (mean frame difference 1.81); ground 19–25% near-black; white 0.5–2.2%; 2 sound onsets in 10.5 s.

```json
{"register": ["calm"], "mood": "premium", "stage": "emissive",
 "ground": {"material": "near-black under soft analogous colour fields", "motion": "drift", "period_min_s": 15, "drift_max_pxf": 0.5},
 "palette": {"logic": "field", "roles": "blue, violet and cyan fields; never one purple"},
 "accent": {"meaning": "white-light", "max_share": 0.03}, "light": "ground fields, unclipped; at most one added effect",
 "depth": "frosted panels at three depths at most", "texture": {"kind": "static-grain"},
 "type": {"display": "light geometric sans, open spacing", "read": "white geometric sans",
  "faces": {"display": ["Manrope", "Outfit", "Urbanist"], "read": ["Manrope", "Figtree"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "soft, camera",
  "blur": {"translation": "crisp", "pop": "crisp", "camera": "crisp", "impact": "none"},
  "arrival": "from-blur", "overshoot": {"kind": "none"}, "holds": {"kind": "alive", "alive": "ambient", "read_layer": "still, with a read box"},
  "camera": "parallax drift by depth"},
 "energy": {"shape": "calm", "punch_max": {"flash": 0, "slam": 0, "shake": 0}, "beat": "none"},
 "seams": {"native": "refraction", "never": ["flash", "shake", "slam", "particles"], "repeat": "native-may-repeat"},
 "sound": {"bed": "soft pad", "cues": "swells as reveals land", "never": ["impacts"]},
 "composition": {"dominant": [0.4, 0.8], "emptiness": false, "balance": "off-centre"},
 "guards": {"peak_pxf_30fps": 45, "read_contrast_min": 4.5}, "start": {"entrance_s": [1.0, 1.4], "grain_rms": 3.5},
 "helpers": ["look.ground", "look.grain", "film.hold"], "expect": []}
```

## hand-drawn: Frame-by-frame Hand-drawn Animation (逐帧手绘)

**Fit.** Use for warm, handmade, playful briefs: food, makers, kids, indie apps, a mascot explainer. Not for dense interfaces or data, premium-tech minimalism, or photoreal product truth. Confused with: collage (cut paper on threes, never redrawn); flat-vector (vector tweens on ones); line-art (one continuous stroke).
**Reviewer.** Drawings step on twos and lines boil by design; a boiling held drawing is a live hold. Judge poses, spacing and timing, not smoothness.
**Transfer.** Every change is a drawn pose on the drawing clock: the subject's noun as a character or prop; its verb as an action with squash and stretch.
**Variation.** Structures: a three-beat gag; a transformation chain; a chase. Openings: lights snap on; a character enters; a line draws itself. Endings: a held pose with one bounce; a character exits leaving the title; an iris closing on a gesture.
**Pitfalls.** Eased tweens on stepped time read as laggy vector → pose each drawing. Even strokes look digital → re-seed the line every drawing. Boil on every output frame buzzes → tie it to the drawing clock. Photographic blur → drawn smears and speed lines. A fourth accent → three at most.
**Fidelity.** An SVG displacement re-seeded per drawing stands in for hand-inked line variation.
**Ref (n=1).** 18.3 drawings/s mean over ones and twos; ink 5–11 px at 1080p; impact drawings 2 frames; a dropout of about 60 ms before the biggest hit.

```json
{"register": ["energetic", "neutral"], "mood": "playful", "stage": "medium-paper",
 "ground": {"material": "warm animation paper with fibre", "motion": "per-drawing"},
 "palette": {"logic": "roles", "roles": "paper, dark ink, two or three flat saturated accents, white highlights"},
 "accent": {"meaning": "hero"}, "light": "none", "depth": "none: no shadows, no gradients",
 "texture": {"kind": "paper", "changes": "per-drawing"},
 "type": {"display": "hand-lettered capitals with an ink outline", "read": "hand-printed capitals", "reveal": "draw-on",
  "faces": {"display": ["Bangers", "Titan One"], "read": ["Patrick Hand", "Gochi Hand"], "cjk": ["LXGW WenKai", "Ma Shan Zheng"]}},
 "motion": {"clock": {"kind": "stepped", "fps": 24, "rates": {"action": 24, "acting": 12}}, "curves": "key-pose",
  "blur": {"translation": "smear", "pop": "crisp", "camera": "crisp", "impact": "drawn"}, "arrival": "from-zero in one to three drawings",
  "overshoot": {"kind": "drawn-key"}, "holds": {"kind": "alive", "alive": "boil"}, "camera": "locked"},
 "energy": {"shape": "build", "punch_max": {"flash": 3, "slam": 2, "shake": 0}, "beat": "none", "counts": "impact drawings are flashes; squash landings are entrances"},
 "seams": {"native": "pose-to-pose action", "never": ["crossfade", "eased slide"], "repeat": "each-once"},
 "sound": {"bed": "none or a light acoustic loop", "cues": "plucks, mallets, pitch glides, bells", "never": ["photographic whooshes"]},
 "composition": {"dominant": [0.4, 0.7], "emptiness": false, "balance": "centred"},
 "guards": {"min_stroke_px": 5}, "start": {"pop_drawings": [1, 3]},
 "helpers": ["look.clock", "look.paper", "look.boil", "look.smear"],
 "expect": ["cartoon timbres stay logged foley until S23"]}
```

## hud: Cyberpunk HUD (赛博朋克HUD)

**Fit.** Use for a system that detects, scans, locates or decides: security, AI and vision features, space, automotive, gaming. Not for warm, human or kids' brands, calm premium pieces, or long reading. Confused with: synthwave (neon grid and chrome, music-led); generic sci-fi dashboards (no single system state).
**Reviewer.** Dim, dense telemetry is texture, not copy to read; judge the bright read layer and the decisive state change.
**Transfer.** Everything on screen reads out one system's state: the subject's noun as the target the instruments lock onto; its verb as a scan, a lock or a mode switch.
**Variation.** Structures: boot, search, lock; one instrument filling the frame; a mode switch repainting every panel. Openings: a scan-slit power-on; a reticle expanding; counters rolling. Endings: the locked state held with live counters; a push into the target; instruments powering down to one readout.
**Pitfalls.** Empty panels → rows, waveforms and dumps. The message drowned in texture → a separate bright read layer at the read floor or larger. Several hues at once → one hue per state. Proportional digits jitter → tabular digits. Random flicker → structured micro-motion: a caret, a pulse, easing counters.
**Fidelity.** Flat vector rings and conic sweeps stand in for holographic volumes and real bloom.
**Ref (n=1).** Ground 73% of the frame; telemetry cap height about 7 px at 1080p; reticle expands in about 13 frames; lock wipe about 4 frames; final hold 2.0 s, alive, with a 1 Hz pulse.

```json
{"register": ["energetic", "neutral"], "mood": "", "stage": "emissive",
 "ground": {"material": "near-black tinted toward the ink", "motion": "static"},
 "palette": {"logic": "ramp", "roles": "one emissive ramp, a second hue for the decided state"},
 "accent": {"meaning": "state"}, "light": "one uniform bloom on emissive strokes", "depth": "none",
 "texture": {"kind": "scanlines"},
 "type": {"display": "squared technical sans or mono", "read": "bright mono readout", "texture_text": "telemetry", "reveal": "decode",
  "faces": {"display": ["Share Tech Mono", "Chakra Petch", "Orbitron"], "read": ["JetBrains Mono", "IBM Plex Mono"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30, "rates": {"decode": 15}}, "curves": "mechanical, entrance",
  "blur": {"translation": "crisp", "pop": "crisp", "camera": "crisp", "impact": "crisp"},
  "arrival": "drawn-on through a scan slit", "overshoot": {"kind": "none"},
  "holds": {"kind": "alive", "alive": "live-ui", "read_layer": "still"}, "camera": "one push into the target"},
 "energy": {"shape": "build", "punch_max": {"flash": 1, "slam": 0, "shake": 0}, "beat": "pulse", "counts": "effects only on glitch frames"},
 "seams": {"native": "the lock: a radial mode wipe", "never": ["soft dissolve"], "repeat": "each-once"},
 "sound": {"bed": "low drone", "cues": "data ticks, blips, a noise burst into the lock"},
 "composition": {"dominant": [0.5, 0.75], "emptiness": false, "balance": "centred"},
 "guards": {}, "start": {"glitch_max_s": 0.5},
 "helpers": ["look.clock", "look.scanlines", "film.flash"],
 "expect": ["telemetry timbres stay logged foley until S23"]}
```

## isometric: Isometric 2.5D (等轴2.5D)

**Fit.** Use for a system, place or process shown as a miniature world that builds itself: cities, logistics, product ecosystems, overviews. Not for intimate stories, interface walkthroughs, or dense copy. Confused with: 3d-render (lit materials with focus blur); flat-vector (a flat front view).
**Reviewer.** A miniature world on fixed axes builds itself and small props idle in holds; text faces the camera. Judge occlusion, scale and what the build explains.
**Transfer.** Every object is a block on one grid in one projection: the subject's noun as a building or machine; its verb as something that drops in, grows or connects.
**Variation.** Structures: an empty grid that assembles; a colour flood across the model; a tour from zone to zone. Openings: the first tile drops; a road draws across the grid; a pull-in onto one block. Endings: the world with idling props; one zone lit while the rest dims; a pull-back handing the frame to the name.
**Pitfalls.** Props too small read as noise → fewer, larger props. An unassigned rainbow reads as clip art → one hue per material, matched lightness. Flat faces look dated → bevels and contact shadows. Text flat on the ground → stand it up, facing the camera. Creation-order drawing breaks occlusion → sort by footprint depth.
**Fidelity.** Flat-shaded vector faces stand in for soft-lit rendered materials.
**Ref (n=1).** A view about 30° up with slight long-lens perspective; falls reach about 81 px/f and stop within 3 frames; the end hold drifts 0.63 px/f, never still.

```json
{"register": ["neutral"], "mood": "", "stage": "lit",
 "ground": {"material": "a soft studio sweep under the model", "motion": "static"},
 "palette": {"logic": "material", "roles": "a pastel hue per zone, one saturated colour for the name"},
 "accent": {"meaning": "key-text"}, "light": "one side key; faces shade top, left, right",
 "depth": "occlusion, stacking, contact shadows; no focus blur", "texture": {"kind": "none"},
 "type": {"display": "chunky extruded sans on the grid", "read": "flat panel labels facing the camera",
  "faces": {"display": ["Rubik", "Archivo Black", "Russo One"], "read": ["Rubik", "Lexend"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "gravity, bounce",
  "blur": {"translation": "directional", "pop": "crisp", "camera": "directional", "impact": "crisp"},
  "arrival": "drop", "overshoot": {"kind": "small"},
  "holds": {"kind": "alive", "alive": "idle"}, "camera": "one slow continuous move, then a pull-back"},
 "energy": {"shape": "build", "punch_max": {"flash": 0, "slam": 1, "shake": 0}, "beat": "none", "counts": "a staggered mass drop is one technique"},
 "seams": {"native": "assembly", "never": ["hard cut to another angle"], "repeat": "each-once"},
 "sound": {"bed": "light music", "cues": "tile hits, a swell on the flood"},
 "composition": {"dominant": [0.5, 0.9], "emptiness": false, "balance": "centred"},
 "guards": {"text_plane_max_deg": 10}, "start": {"prop_min_px": 100},
 "helpers": ["film.move", "look.directional", "film.hold"], "expect": []}
```

## line-art: Line Art (线条动画)

**Fit.** Use for one idea growing from a single gesture: craft, architecture, heritage brands, origin stories, calm titles and logo reveals. Not for dense data, interfaces, fast promos, or photoreal products. Confused with: hand-drawn (boiling lines, fills); morph (filled shapes becoming each other); whiteboard sketch (a visible hand).
**Reviewer.** One continuous line and wide empty space are intended, and the pen pauses on purpose; judge the path, the pen's pace and the one fill.
**Transfer.** Every new idea grows out of the same line: the subject's noun as the shape the line draws; its verb as the line continuing into the next shape.
**Variation.** Structures: one line drawing a chain of ideas; a single figure drawn, then filled; a diagram traced stop by stop. Openings: a pen point on an empty ground; the line entering from an edge; a dot growing into a stroke. Endings: a pull-back revealing the whole drawing; one closed shape filling into the mark; the line running off the edge.
**Pitfalls.** A rushed pen → draw less, not faster. Strokes under the guard width measure frozen → keep the guard width. A stock icon row → one narrative line. A visible retrace → a path that never doubles back. Glow on everything → light only the pen tip and the fill.
**Fidelity.** A dash-offset vector path stands in for a pen on paper.
**Ref (n=1).** Pen median 29 px/f; pauses of 6–7 frames; the fill grows in about 3 frames; ground about 94% and line about 2.5% of the last frame; halo of 3–5 code values within about 7 px.

```json
{"register": ["calm"], "mood": "premium", "stage": "flat",
 "ground": {"material": "one low-key hue with a soft centre lift", "motion": "static"},
 "palette": {"logic": "accent", "roles": "one ground hue and one metal for line, fill and type"},
 "accent": {"meaning": "signature"}, "light": "a centre lift, a faint line halo",
 "depth": "none", "texture": {"kind": "static-grain"},
 "type": {"display": "widely tracked classical serif capitals", "read": "small flanked capitals", "reveal": "draw-on",
  "faces": {"display": ["Cinzel", "Cormorant Garamond", "Marcellus"], "read": ["Cormorant Garamond", "EB Garamond"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "pen",
  "blur": {"translation": "none", "pop": "crisp", "camera": "none", "impact": "none"},
  "arrival": "drawn-on", "overshoot": {"kind": "none"}, "holds": {"kind": "still"},
  "camera": "follows the pen, stops when it stops"},
 "energy": {"shape": "calm", "punch_max": {"flash": 0, "slam": 0, "shake": 0}, "beat": "landings", "counts": "pen pauses after strokes are rests"},
 "seams": {"native": "the continuing line", "never": ["cut", "crossfade"], "repeat": "native-may-repeat"},
 "sound": {"bed": "pen on paper", "cues": "a soft bell on each pause"},
 "composition": {"dominant": [0.2, 0.6], "emptiness": true, "balance": "centred"},
 "guards": {"min_stroke_px": 3}, "start": {"pen_pxf": 30, "pause_frames": [6, 7]},
 "helpers": ["time.beatFrame", "film.hold", "look.grain"], "expect": []}
```

## liquid: Liquid Flow (液态流动)

**Fit.** Use for drinks, cosmetics, food, wellness, paint, music, any idea of flow or of one drop, letters formed from liquid. Not for data, interfaces, or hard geometric identities. Confused with: glass-gradient (light behind glass, no gravity); 3d-render (solid lit materials); morph (flat outlines interpolating).
**Reviewer.** Continuous flow, merging and dripping are intended, and the picture never fully stops; judge the hero's legibility and the one drop that matters.
**Transfer.** Everything is one body of liquid under gravity and surface tension: the subject's noun as the shape the liquid settles into; its verb as a drop, a merge or a split.
**Variation.** Structures: one drop's journey; puddles merging into a form; a dive into the drop and out into a new scene. Openings: a drop falling in; a ripple on a still surface; a splash already moving. Endings: letters settled with drips still running; the liquid draining to leave the name; a last ripple fading.
**Pitfalls.** Goo bridges letters and closes counters → open tracking, a smaller blur. A gradient per blob breaks the one-body read → one gradient across the frame. Blobs without speculars read as stickers → speculars and a darker lower rim. A contact between frames → snap events to frames. Tiny ripples vanish on a phone → keep the hero big.
**Fidelity.** A vector goo filter stands in for translucent refraction and true fluid simulation.
**Ref (n=1).** The fall accelerates from 25.8 to 88.2 px/f into contact while stretching to 1.43–1.56 times as tall as wide; hold energy 0.51–0.62, never still.

```json
{"register": ["neutral", "energetic"], "mood": "fresh", "stage": "lit",
 "ground": {"material": "one deep dark hue over a glossy mirror floor", "motion": "static"},
 "palette": {"logic": "accent", "roles": "dark neutrals and one continuous gradient across all the liquid"},
 "accent": {"meaning": "hero"}, "light": "speculars, a darker lower rim", "depth": "a mirror floor and reflections",
 "texture": {"kind": "static-grain"},
 "type": {"display": "heavy soft serif made of liquid", "read": "small serif caption",
  "faces": {"display": ["DM Serif Display", "Gloock", "Abril Fatface"], "read": ["Gloock", "Lora"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "gravity, jelly",
  "blur": {"translation": "smear", "pop": "smear", "camera": "shutter", "impact": "smear"},
  "arrival": "drop", "overshoot": {"kind": "jelly"}, "holds": {"kind": "alive", "alive": "ambient"},
  "camera": "mostly still; one fast truck after the splash"},
 "energy": {"shape": "build", "punch_max": {"flash": 0, "slam": 1, "shake": 0}, "beat": "none", "counts": "the splash is the one slam"},
 "seams": {"native": "merging", "never": ["hard cut"], "repeat": "each-once"},
 "sound": {"bed": "light music or room tone", "cues": "a plink on each contact frame"},
 "composition": {"dominant": [0.3, 0.6], "emptiness": false, "balance": "centred"},
 "guards": {}, "start": {"ripple_min_px": 20},
 "helpers": ["look.smear", "look.grain", "film.cue"], "expect": []}
```

## morph: Shape Morph (形变动画)

**Fit.** Use for stories told as a chain of metaphors, app intros, an icon becoming the mark. Not for dense information, interface demos, or exact geometry. Confused with: flat-vector (a hero that bounces); liquid (a fluid body under gravity); a logo sting (one reveal, no chain).
**Reviewer.** The repeated morph is the style's seam, not a repeated trick, and one icon on an empty field is intended; judge whether each shape is the next step.
**Transfer.** Each new picture is made from the last shape: the subject's noun as where the chain arrives; its verb as the morph that gets there.
**Variation.** Structures: a chain of three or four metaphors; one shape cycling through states; a before and after in one shape. Openings: a dot on an empty field; an object starting to bend; an iris opening from the hero. Endings: the last shape in its own idle loop; the shape breaking into parts that fly off; an iris closing to an empty ground.
**Pitfalls.** Crossfades or scale swaps → interpolate outlines resampled by path length to one point count and winding. Twisting in-betweens → start each outline at the same angle from its centroid. An arbitrary icon chain → each shape shares a part with the last. A translucent vector iris breaks byte-identical renders → draw soft irises on canvas.
**Fidelity.** Point-resampled vector outlines stand in for hand-keyed shape animation.
**Ref (n=1).** Morphs of 12–15 frames on a bell-shaped curve; holds of 7–14 frames; an iris of 6 frames, its edge up to about 230 px/f; the icon 13–25% of the width.

```json
{"register": ["neutral", "energetic"], "mood": "", "stage": "flat",
 "ground": {"material": "one flat colour with a soft vignette", "motion": "changes only by an iris"},
 "palette": {"logic": "roles", "roles": "a flat accent ground, the hero contrasting by lightness, dark ink"},
 "accent": {"meaning": "ground"}, "light": "none", "depth": "none", "texture": {"kind": "none"},
 "type": {"display": "geometric sans", "read": "geometric sans",
  "faces": {"display": ["Outfit", "Sora", "Urbanist"], "read": ["Outfit", "Sora"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "symmetric",
  "blur": {"translation": "shutter", "pop": "crisp", "camera": "crisp", "impact": "crisp"},
  "arrival": "from the previous shape", "overshoot": {"kind": "none"},
  "holds": {"kind": "alive", "alive": "idle"}, "camera": "locked"},
 "energy": {"shape": "build", "punch_max": {"flash": 0, "slam": 0, "shake": 0}, "beat": "none"},
 "seams": {"native": "the morph", "never": ["crossfade", "cut between shapes"], "repeat": "native-may-repeat", "events": "kind transition at each morph's biggest change"},
 "sound": {"bed": "warm and continuous", "cues": "gliding swooshes peaking on each biggest change"},
 "composition": {"dominant": [0.15, 0.35], "emptiness": true, "balance": "centred"},
 "guards": {}, "start": {"morph_frames": [12, 15], "hold_frames": [7, 14], "outline_points": 240},
 "helpers": ["film.seam", "film.move", "film.hold"], "expect": []}
```

## pixel: 16-bit Pixel Art (像素风)

**Fit.** Use for games, retro tech, developer culture, nostalgic or playful brands, title screens and loops. Not for luxury, photoreal products, long reading, or non-integer delivery sizes. Confused with: hud and synthwave (a CRT overlay on smooth art); isometric pixel art (a world on fixed axes).
**Reviewer.** Whole-pixel stepping, an indexed palette and dithering are intended, and slow layers step by design; judge readability at integer scale.
**Transfer.** Everything is drawn on the art grid in the palette: the subject's noun as a sprite; its verb as a game action.
**Variation.** Structures: a level scrolling to a goal; a title screen coming alive; time of day passing by palette swaps. Openings: a CRT power-on; a sprite walking in; text typing on. Endings: a level-clear moment with blinking text; a palette swap to night; a title screen with a blinking prompt.
**Pitfalls.** Smoothed or fractional scaling → author on the grid, scale by a whole number. Subpixel motion or eased slides → round every position to the grid. Mixed pixel sizes → rasterize type on the art grid. Gradients, grain, glow or blur → dither instead. An overdone CRT smears the art → light scanlines.
**Fidelity.** A canvas framebuffer of palette slots stands in for console hardware.
**Ref (n=1).** The camera moves on ones while layers snap (ground about 2 art px per frame); sprite cycles at 7.5–10 fps; typing at 10 glyphs per second; impact flashes of 2 frames.

```json
{"register": ["energetic"], "mood": "playful", "stage": "medium-pixel",
 "ground": {"material": "parallax layers of sky and tiles", "motion": "scrolls in whole art pixels"},
 "palette": {"logic": "indexed", "roles": "one fixed indexed palette; every pixel on it"},
 "accent": {"meaning": "key-text"}, "light": "drawn in palette", "depth": "parallax layers and dark outlines",
 "texture": {"kind": "scanlines"},
 "type": {"display": "chunky pixel font on the art grid", "read": "pixel font on the art grid", "reveal": "typing",
  "faces": {"display": ["Press Start 2P", "Silkscreen", "Pixelify Sans"], "read": ["Silkscreen", "VT323"], "cjk": ["DotGothic16", "Zpix"]}},
 "motion": {"clock": {"kind": "snapped", "fps": 30, "rates": {"art": 15}}, "curves": "mechanical",
  "blur": {"translation": "crisp", "pop": "crisp", "camera": "crisp", "impact": "crisp"},
  "arrival": "at-size: whole-pixel drops and bounces", "overshoot": {"kind": "none"},
  "holds": {"kind": "alive", "alive": "idle"}, "camera": "scrolls on ones; layers snap to the art grid"},
 "energy": {"shape": "build", "punch_max": {"flash": 3, "slam": 1, "shake": 1}, "beat": "pulse", "counts": "two-frame impact flashes are flashes"},
 "seams": {"native": "a palette swap", "never": ["crossfade", "blur"], "repeat": "each-once"},
 "sound": {"bed": "chiptune", "cues": "blips while typing, noise hits"},
 "composition": {"dominant": [0.4, 0.8], "emptiness": false, "balance": "centred"},
 "guards": {"integer_scale": true}, "start": {"sprite_fps": [7.5, 10], "typing_glyphs_per_s": 10},
 "helpers": ["look.clock", "look.dither", "look.scanlines"],
 "expect": ["chiptune timbres stay logged foley until S23"]}
```

## sticker-explainer: Sticker Explainer (贴纸风科普)

**Fit.** Use for popular-science and product explainers that take one everyday object apart, for broad social audiences. Not for calm premium registers or topics with no object to cut out. Confused with: collage (torn cut-outs on threes); flat-vector (no margins or shadows); generic infographics (charts without objects).
**Reviewer.** Die-cut stickers with white borders and soft shadows, quick whip pans and short chapters are intended; judge whether each chapter's object carries its fact.
**Transfer.** Every object is a die-cut sticker on one canvas: the subject's noun as the hero sticker taken apart; its verb as stickers flying into a chart or list.
**Variation.** Structures: one object taken apart chapter by chapter; facts flying as stickers into charts; a map filled sticker by sticker. Openings: the hero sticker slapped on; a whip onto the first chapter; a number counting up. Endings: the hero number under a slow creep; a pull-back over the whole canvas; stickers peeling off a bare canvas.
**Pitfalls.** Thin margins or a hard black shadow read as clip art → a white margin, a two-layer tinted shadow. Accent-coloured objects blur the system → the accent marks graphics only. Equal stickers in a row → one hero much larger, the rest rotated. Whips without smear strobe → directional smear. Chapters too short to read → give each its reading time.
**Fidelity.** Flat illustrated stickers stand in for rendered or photographed ones.
**Ref (n=1).** On ones, no still run of 0.5 s or more; whips of 0.5–0.6 s; chapters of 1.0–1.9 s; end card 1.3 s; margin about 18 px at 1080p; accent 0.9–7.3%.

```json
{"register": ["neutral", "energetic"], "mood": "playful", "stage": "flat",
 "ground": {"material": "flat light paper with a faint dot grid", "motion": "static"},
 "palette": {"logic": "roles", "roles": "ink, one grey and one accent for graphics; objects keep their own colours"},
 "accent": {"meaning": "key-text"}, "light": "none", "depth": "two-layer sticker shadows only", "texture": {"kind": "none"},
 "type": {"display": "heavy sans headline", "read": "heavy sans", "texture_text": "furniture",
  "faces": {"display": ["Archivo Black", "Bricolage Grotesque", "Rubik"], "read": ["Rubik", "Bricolage Grotesque"], "cjk": ["Noto Sans SC", "Smiley Sans"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "camera, settle",
  "blur": {"translation": "directional", "pop": "crisp", "camera": "directional", "impact": "directional"},
  "arrival": "slides up with blur and settles", "overshoot": {"kind": "small"},
  "holds": {"kind": "creep", "creep_max_pct": 1}, "camera": "whips across one canvas"},
 "energy": {"shape": "even-high", "punch_max": {"flash": 0, "slam": 1, "shake": 0}, "beat": "none"},
 "seams": {"native": "the whip", "never": ["crossfade"], "repeat": "native-may-repeat"},
 "sound": {"bed": "music on a grid", "cues": "a low hit per chapter change"},
 "composition": {"dominant": [0.25, 0.5], "emptiness": false, "balance": "asymmetric"},
 "guards": {}, "start": {"whip_s": [0.5, 0.65], "margin_short_side_pct": 1.2},
 "helpers": ["look.directional", "film.move", "film.hold"], "expect": []}
```

## synthwave: Retro Synthwave (复古Synthwave)

**Fit.** Use for nostalgia and night energy: music releases, gaming, racing, nightlife, retro events, merch drops. Not for trust-first messages, minimal premium brands, or sound-off pieces. Confused with: hud (one-hue instruments, no grid floor); vaporwave (pastel, slowed and ironic).
**Reviewer.** Neon, a perspective grid, chrome type and tape texture are intended, and the world keeps driving under held titles; judge the beat lock and the title.
**Transfer.** Everything is light on a night grid moving to the beat: the subject's noun as a chrome title on the horizon; its verb as a downbeat slam.
**Variation.** Structures: a drive toward the horizon; a tape that starts and stops; a build dropping on the beat. Openings: a tape start-up on twos; the grid lighting beat by beat; a neon sign flickering on. Endings: the chrome title over the moving grid; the sun sinking; the pulse slowing to a held poster frame.
**Pitfalls.** Muddy chrome → a hard horizon split, a white edge, a dark extrude. A strobing grid → smear near lines by their travel. A title off the beat → slam on the downbeat. Heavy noise kills the read → a light overlay.
**Fidelity.** One canvas world and CSS chrome stand in for a 3D road scene and real tape.
**Ref (n=1).** A start-up on twos of about 1 s; a grid pulse within a frame after the beat; near-line smear about 30 px wide at 1080p; a slam of 2 frames.

```json
{"register": ["energetic"], "mood": "nostalgic", "stage": "emissive",
 "ground": {"material": "violet-black night, magenta grid floor", "hexes": ["#0f0316", "#16062b"], "motion": "drives forward"},
 "palette": {"logic": "genre", "hexes": ["#330b49", "#ac2d92"], "roles": "purple-magenta ramps, a warm sun, cyan lights"},
 "accent": {"meaning": "signature"}, "light": "neon bloom spills; glow cores clip to white", "depth": "a one-point perspective grid",
 "texture": {"kind": "temporal-noise", "changes": "every-2f"},
 "type": {"display": "extended heavy chrome sans", "read": "small spaced capitals", "reveal": "slap",
  "faces": {"display": ["Michroma", "Audiowide", "Orbitron"], "script": ["Mr Dafoe", "Kaushan Script", "Pacifico"], "read": ["VT323", "Share Tech Mono"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30, "rates": {"start-up": 15}}, "curves": "slam, entrance",
  "blur": {"translation": "smear", "pop": "crisp", "camera": "smear", "impact": "crisp"},
  "arrival": "from-oversize slam", "overshoot": {"kind": "none"},
  "holds": {"kind": "alive", "alive": "environment"}, "camera": "one steady dolly"},
 "energy": {"shape": "build", "punch_max": {"flash": 2, "slam": 1, "shake": 0}, "beat": "pulse", "counts": "each beat is an event; glitch frames are effects; tape noise never is"},
 "seams": {"native": "the beat", "never": ["a CRT power-off as the last frame"], "repeat": "each-once"},
 "sound": {"bed": "drum-driven synth music", "cues": "a riser, the slam on the downbeat"},
 "composition": {"dominant": [0.4, 0.8], "emptiness": false, "balance": "centred"},
 "guards": {}, "start": {},
 "helpers": ["look.clock", "look.noise", "time.beatFrame"], "expect": []}
```

## variety-text: Variety-show Captions (综艺花字)

**Fit.** Use for comic entertainment and lifestyle clips for Chinese-speaking social audiences, vertical first. Not for serious or premium registers, data, Latin-only copy, or flash-sensitive viewers. Confused with: sticker-explainer (calm, no punches); collage (cut paper on threes); plain subtitles (a flat line that never reacts).
**Reviewer.** Loud stroked captions, stamps, shakes and white flashes are intended; judge each punch's timing against the joke and every caption's read.
**Transfer.** Every caption is a three-layer sticker reacting to the joke and the beat: the subject's noun as the footage; its verb as the punch.
**Variation.** Structures: setup, punch, aftershock; a list of reactions, one per beat; a countdown to a reveal. Openings: a stripe banner wiping in; a caption typing on; a crash zoom. Endings: the subject under a hopping caption; a white-flash cut to a stamp; a wipe to a clean plate.
**Pitfalls.** Heavy rings clog dense glyphs → an open rounded face, a slim white ring. A flat fill reads as a subtitle → three layers, a gradient, a hard drop. Per-glyph pops on long captions stall the read → pop only short captions, held a second after the last glyph lands. Meme copy and sounds read cheap → write the joke for this subject.
**Fidelity.** Footage is required; an illustrated plate stands in for tests only.
**Ref (n=1).** 99% of frames change; pops +9% at 4 frames; glyph stagger 1–2 frames; crash steps of 1.40× and 1.54×; at most 2 flash swings per second.

```json
{"register": ["energetic"], "mood": "comic", "stage": "footage",
 "ground": {"material": "photo or video plates", "motion": "a slow push"},
 "palette": {"logic": "candy", "roles": "saturated candy hues, white, one dark outline"},
 "accent": {"meaning": "key-text"}, "light": "none", "depth": "a hard drop under captions", "texture": {"kind": "none"},
 "type": {"display": "rounded heavy CJK, three layers per glyph", "read": "heavy CJK sans", "reveal": "glyph-pop",
  "faces": {"display": ["ZCOOL KuaiLe", "Smiley Sans", "Noto Sans SC"], "read": ["Noto Sans SC", "Smiley Sans"]}},
 "motion": {"clock": {"kind": "smooth", "fps": 30}, "curves": "pop, slam",
  "blur": {"translation": "crisp", "pop": "crisp", "camera": "crisp", "impact": "crisp"},
  "arrival": "from-zero per glyph", "overshoot": {"kind": "pop", "max_pct": 10},
  "holds": {"kind": "alive", "alive": "idle"}, "camera": "crash-zoom steps only"},
 "energy": {"shape": "even-high", "punch_max": {"flash": 6, "slam": 6, "shake": 6}, "beat": "pulse", "counts": "each shake and flash declared over exactly its frames; the flash cap still applies"},
 "seams": {"native": "a white-flash cut or crash zoom", "never": ["slow dissolve"], "repeat": "native-may-repeat"},
 "sound": {"bed": "busy, on the beat", "cues": "a boom per punch, a tick per typed glyph", "never": ["meme sounds"]},
 "composition": {"dominant": [0.3, 0.6], "emptiness": false, "balance": "centred"},
 "guards": {}, "start": {"pop_overshoot_pct": 9, "pop_peak_s": 0.133, "caption_chars_max": 6, "hold_after_last_s": 1},
 "helpers": ["film.flash", "film.shake", "time.stagger"], "expect": []}
```
