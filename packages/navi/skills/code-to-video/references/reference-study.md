# Studying a reference video

A reference is a quality and energy bar, not a style template. Study how it moves and sounds over time, and never load
the video itself into your context.

## Measure it

```sh
python3 -B <skill>/scripts/vqa.py pack ref.mp4 --spec none --out study/ref
ffmpeg -v info -i ref.mp4 -vf "select='gt(scene,0.1)',showinfo" -an -f null - 2>&1 | grep -o 'pts_time:[0-9.]*'
```

The pack gives a contact sheet with times, bursts of consecutive frames around every change, the motion and sound
strip, frozen runs, onsets and loudness. Keep its numbers and ignore its verdict lines: they judge the reference's own
encode and pacing against your tools. The second line prints cut times; 0.1 catches cuts between similar frames that
0.3 misses.

## Write study/reference.md

1. **A timestamped beat list:** what happens, what dominates the frame and how much of it, the motion or camera move,
   the transition, and what the sound does. Note where it accelerates, holds, cuts, and lets sound carry a change.
2. **Measurements:** cuts per minute, frozen share and the longest frozen run, subject size, movement per frame (from
   the bursts), loudness.
3. **An adoption table**, one row per technique: what it is · how the reference does it · adopt, adapt or reject, and
   why.

Close with what you will match (craft level, pace, energy, frame share, how long it holds, cut rate) and what you will
not copy.

## Match the bar, not the film

- Unless the user asks you to match its look, never reuse its palette, type, layouts, transitions, slogans, wording,
  example data, names, numbers or order of beats.
- Copying hides in content: its data and wording in your style are still copied. It hides in structure too: if your
  beat table maps one to one onto its beat list (the same opener, headline, feature moments and finale), you have
  copied it in new colours. Compare the two before building, and rebuild the structure from your own idea.
- Asked to match the look: adopt its motion grammar shot by shot through the adoption table, never its content, data,
  wording or brand assets. If the look is a named style with no card, read new-style.md.

## Compare every round

Add `--reference ref.mp4` to each round's pack:

```sh
python3 -B <skill>/scripts/vqa.py pack renders/v2-final.mp4 --timeline renders/v2.timeline.json --sfx-stem sound/sfx-stem.wav --kit sound/kit --reference ref.mp4 --out qa/v2
```

`qa/v2/sbs.png` sets your frames beside the reference's at the same scale and at matching points in each film, and
`reference-timeline.png` shows its rhythm in the same lanes as yours. Open sbs.png each round: a beat of yours whose
dominant element is smaller, or sits in more empty space, fails composition. Fix it with scale, position, framing or
cut rhythm, never with ambient motion, and count it among the five issues in qa/v2/review.md.
