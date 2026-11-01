---
name: code-to-video
description: "Make finished videos from code: launch teasers, product promos, animated explainers, data stories, logo stings, transparent overlays, vertical clips, and UI or code walkthroughs, in Latin or CJK text. Renders HTML, CSS, SVG or canvas frame by frame, mixes synced sound, and has a fresh reviewer check each version. Use when the deliverable is a rendered video or GIF built from code, or a substantial revision of one. Not for editing existing footage, in-app UI animation, text-to-video models, interactive 3D pages or games (web3d), or Blender modeling and rendering (blender); a film may still include a three.js scene or a Blender render."
argument-hint: "<what the video is for, length, aspect>"
metadata:
  short-description: Make finished videos from code
source: https://github.com/mslsrc/tbh/blob/main/projects/tbh/crates/plugins/core/CREDITS.md#skillscode-to-video
license: Apache-2.0 AND MIT AND OFL-1.1
experimental-gate: code_to_video
user-invocable: false
---

# Code to video

Make a finished piece that communicates an idea, not a collection of animated screens. A one-prompt request includes planning, producing, reviewing, and correcting the actual video. Scripts check what a script can; your judgment goes into the film. `<skill>` is this skill's folder and is read-only: work only in `video-work/<slug>/` and run every command below from there. Read this file now and open a reference only on its trigger (last section): every file you read rides along on every later call.

Adapted in part from video-shotcraft, motionmaxxing and huashu-design; see the core plugin's CREDITS.md.

## Set up

Save the request, verbatim, as `video-work/<slug>/brief.txt`: the blind reviewer sees this file, never your plan. Then, in that folder:

```
python3 -B <skill>/scripts/new.py init . --brief-file brief.txt
```

Add `--reference FILE` for a supplied reference video, `--revise DIR` to revise an earlier film. It copies the starter to `film/`, writes `plan.md`, finds node, python, ffmpeg and a browser, installs the renderer here, and prints the tier, the register and its brief word, the demands, and your reading set. If it stops, tell the user exactly what it says is missing and how to install it, then stop; never install system packages yourself or spend more than a few minutes on setup (troubleshooting.md).

## Find the film in the brief

- Identify the audience, the one thing they should remember, claims that need checking, supplied assets, duration, aspect ratio, sound, and destination; give every unknown a stated default. Confirm the exact names and lines new.py found; delete a false one only with a reason under Decisions.
- **Format and length.** Check the format and length new.py printed against the brief. If one is wrong (a film with lower thirds read as an overlay, a loop read as a promo), delete plan.md and run init again with `--format KIND`, `--duration SECONDS` or `--aspect RATIO`.
- **Register.** Confirm the brief word new.py quoted: subtle, quiet or calm make any genre calm, and a destination's own loudness spec wins. The scripts take loudness, the bed and the stillness limits from the register, so never change it to pass a check.
- A reference is a **quality and energy bar, not a style template**: study its motion and sound over time (reference-study.md) and, unless the user asks to match it, reuse none of its palette, type, layouts, wording, data, names, numbers, or order of beats.
- Every genre has an obvious version. Launch: logo reveal, tagline, feature cards, UI montage, glowing lockup. Explainer: title card, three labelled boxes with arrows, a checklist, a summary card. Data story: a bar grows, a number counts up, a caption fades in, the next chart. Logo sting: a shape scales up with a glow and a whoosh. UI walkthrough: the whole window at desktop size, a wandering cursor, tooltips popping. Models add their own: a giant cropped word, a circle wipe, a dot that becomes the logo, "X becomes Y becomes the logo". Treat both as the baseline to beat; use one only when it is this subject's idea, and let the logo arrive by cause (a click, a result, a camera move).
- Find a single visual idea that carries the whole piece (a metaphor, a transformation, a continuous camera journey, a typographic system), so each beat grows out of the one before instead of being a separate slide. If a still could deliver it, it is not yet a film idea. If a rival's logo would fit it unchanged, it is not yours yet.
- Before choosing, sketch two or three directions in words that differ in mechanism (the core picture and action), not palette, and say in one sentence why yours fits the audience, message and assets. A brand or a named style fixes the look, never the idea, so direction is always open.

## Choose the look

Choose it after plan.md has its Idea, Hook and Signature: the look follows the idea, and new.py refuses until then.

- **No named style and no brand assets** (most briefs): an **open look**, designed from the idea. Fill plan.md's Look line, then run `python3 -B <skill>/scripts/new.py look . open`. Derive the palette from the idea or the subject's real content: two or three colours and a neutral ladder, each with a one-line source. Do not fall back on the model default (near-black, one cyan or purple accent, grain) unless the idea needs it.
- **A named style, or an idea whose picture is a medium a card covers**: run `python3 -B <skill>/scripts/new.py styles .`, read every line, then `new.py look . <id>`, which prints the card. Say on the Look line why the idea needs that medium.
- **A brand's own system**: `new.py look . brand`, every value from its assets. **A named style with no card**: new-style.md.

The card wins over defaults in this file. These never change: a designed stage, never the starter's placeholder (lint fails it); read text at least 32 px at 1080p after every scale (captions 56 px; Chinese, Japanese and Korean 40 px), 4.5:1 contrast, inside title-safe (in a 9:16 feed, inside the box the board's phone frame draws); one palette and one motion voice; a reason for every cut; the card's device on every fast move; at most 3 full-frame flashes in any second; a finished last frame, not necessarily a lockup; an overlay starts and ends transparent.

## Direct the timeline

- For each beat, know what the viewer should understand or feel, what dominates the frame, how it moves into the next beat, and what sound marks the change. Build a setup, a transformation, and a memorable resolution.
- Match ambition to the register. To impress, plan one signature moment only motion can deliver, prototype it first, and hook the viewer: something moves and reads in the first half second (in a teaser or sting, on frame 0). For calm, restraint is the craft, but calm means slow, not frozen. Something visibly happens in nearly every second. One transition device on every cut is a template, not direction.
- Compose for the screen, not a slide. The dominant element owns about 40% of the frame unless the card makes emptiness the point, and the frame is balanced. Fewer, larger, well-composed elements beat a crowded interface. Change the composition from beat to beat. Energy comes from changes of scale, position and framing (camera moves, entrances past the frame edge, type that fills the screen, match cuts), never from drift, light sweeps or particles over a held layout: the checks hide ambient layers, so they buy nothing.
- A held frame should be a deliberate beat, typically followed by a bigger change. Give each hold its read text and let `hold()` size it: about 0.3 s a word, at least 1 s; Chinese 7 characters a second (Japanese 4, Korean 12). The last frame sits at most plan.md's poster allowance (Settings line) unless its words need longer. The signature moment gets the most frame, the clearest sound, and a beat of air before it.
- Show interfaces, code and terminals as a camera would: a close-up on the few lines that matter, filling the frame.
- In a data story, show one number or comparison per beat, labelled on the mark, never in a legend; keep object constancy (the bar that grows is the bar that moves on); every number has a source.
- Keep facts and assets coherent. Check claims; never present invented numbers as measured. Read every rendered word: each name's exact spelling and case everywhere, names and counts that agree across beats, no state before its cause. Use a supplied mark's own pixels.
- Design sound with picture: appearances, presses, cuts, transformations and the resolve get a cue on the frame where the change first shows, or a chosen silence. Use a coherent music arc, dynamics, and silence. Calm films get few, soft sounds; energetic films get dense, frame-exact cues and a loudness arc.

## Build with the starter

The default is an HTML page from the starter, rendered frame by frame; Remotion and other renderers have references (last section). The card or plan.md's Look line is the page's explicit style; it wins over any web-design skill.

- `film/film.js` holds the one timeline. Make every time with the helpers in `film/lib/README.md` (`enter`, `exit`, `move`, `hold`, `cue`, `seam`) and mark one move `signature: true`. `cue()` takes its time from its move, so retiming a move retimes its sound: never write a time twice.
- Every frame is a pure function of `t`: no clock, timers, CSS transitions, playing video, or unseeded randomness.
- `node <skill>/scripts/render.mjs film/index.html --out renders/vN.mp4` renders the delivery file and `renders/vN.timeline.json`. While building: `--stills 1.5,4.2` (key frames on one sheet), `--range a-b --draft` (a quick clip), `--lint` (until it reports no error; read every WARN), `--speed` (fast moves).
- Give each fast move the card's device, or render with `--motion-blur`. If blur fails, those frames stay sharp and the render says so: keep the easing and lengthen the move; never make a hero move linear to dodge blur.
- Mark text `data-lint="texture"` only when no viewer needs to read it.
- Never overwrite a reviewed render; the next one is vN+1.
- A three.js scene inside the film: mark its canvas `data-layer="content"` and read other.md. A Blender render to composite: other.md.

## Sound

- Sources, in order: supplied audio; a licensed library with a ledger; the synthesized kit, `python3 -B <skill>/scripts/sfx.py kit sound/kit`.
- `python3 -B <skill>/scripts/mix.py renders/vN.timeline.json --kit sound/kit --out sound/vN-mix.wav --stem sound/vN-stem.wav --video renders/vN.mp4 --mux renders/vN-final.mp4` masters to the register's target and lays room tone under a film without music. Add a music bed only when the brief asks for music or the card names one. Fix a margin WARN by lowering the bed or dropping it, never by limiting harder.
- Honour a request for silence or for supplied music. You cannot hear: report what was measured and what a human should listen for.

## Production loop (required)

Tiers and rounds are what new.py printed: S and R one round; M two; L two, plus a blind look at the prototype; LF two per chapter; one more only while a High is open. Every round gets a fresh blind reviewer.

1. **Plan**: fill plan.md before building any beat.
2. **Prototype** (M, L): build only the signature beat, then:
   ```
   node <skill>/scripts/render.mjs film/index.html --range a-b --out renders/proto.mp4
   python3 -B <skill>/scripts/vqa.py board renders/proto.mp4 --out qa/proto
   ```
   Open qa/proto/board.png; write its code and what is weak in qa/proto/review.md. At L, add `--tier L` and run the reviewer line it prints (as in step 4). Fix the move before building the rest.
3. **Draft**: every beat, lint clean, render, mix and mux.
4. **Review round** on the latest `renders/vN-final.mp4`:
   ```
   python3 -B <skill>/scripts/vqa.py pack renders/vN-final.mp4 --timeline renders/vN.timeline.json --sfx-stem sound/vN-stem.wav --kit sound/kit --out qa/vN
   ```
   It refuses until the last round's review.md is complete. At once, start each reviewer line it prints (blind every round; recheck from round 2) in the background, exactly as printed, and save its PID. A line looks like `muse exec --prompt-file qa/vN/blind/prompt.txt --image qa/vN/blind/board.png --disable-write --disable-shell --max-model-steps 20 > qa/vN/blind/reply.txt 2> qa/vN/blind/launch.log`. If `muse` is missing, fails, or is still running after 10 minutes (stop it by its PID), give the prompt unchanged to its own fresh subagent with the board and save its whole reply to that reply.txt. A reply without END: rerun the same prompt once. Never edit, shorten or add to a prompt.
   Meanwhile open qa/vN/board.png and write qa/vN/review.md: its code first; then, before rereading the plan, one sentence describing the board as a stranger would; then your answer to "Which frame would a stranger screenshot? If not the signature, the signature is weak."; then the five issues that hurt the viewer most.
   When the replies are in, run `python3 -B <skill>/scripts/vqa.py ledger .` and add to review.md one line per open finding id with the change you will make. Fix with real changes to idea, composition, timing or framing. Findings bind: one closes only when the film changes and a later fresh reviewer stops raising it. Never clear one by declaring a hold, an alive kind or a content layer, moving an event onto its sound, renaming the signature, editing the Idea or Picture words lines, adding motion the viewer does not need, or arguing. Log a deliberate exception in plan.md before the round that meets it; it is reported, never a pass.
5. **Gate**: copy the last reviewed `renders/vN-final.mp4` unchanged to final.mp4, then `python3 -B <skill>/scripts/vqa.py gate . --final final.mp4`. Only S and R, or M after both reviewer routes failed, may add `--no-blind "<reason>"`. After the round budget, deliver anyway: a draft whose report opens with its NOT READY lines.
6. **Deliver** final.mp4 and report.md (where the user asked, else here): the idea in one line; the gate block verbatim; deliberate exceptions; what you could not watch or hear; what in the work folder can be deleted. Never claim you watched or heard what you only measured.

## Load only when

- a named style has no card: `references/new-style.md`
- a reference video is supplied: `references/reference-study.md`
- voice-over, supplied or requested music, or music drives the cut: `references/sound.md`
- Chinese, Japanese or Korean copy: `references/cjk.md`
- the product's real UI appears: `references/ui-capture.md`
- more than one aspect, a GIF, caption files, ProRes or WebM, posters, a destination's spec, or a film over 3 minutes: `references/delivery.md`
- a transparent overlay (lower third, title): `references/overlay.md`
- an install or render error, or any command silent for 2 minutes: `references/troubleshooting.md`
- Remotion is in use or asked for: `references/renderers/remotion.md`
- Manim, a three.js scene inside the film, Lottie, ffmpeg-only work, or a Blender render to composite: `references/renderers/other.md`
