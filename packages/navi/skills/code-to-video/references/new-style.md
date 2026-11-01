# A named style with no card

Adapted in part from lemo-opuscar (MIT, © 2026 LemoLab): the card fields; rewritten.

1. **Check the list again.** A card that fits under another name or through its "confused with" line is the card; a
   brand system is `look brand`.
2. **Start from the nearest card.** `python3 -B <skill>/scripts/new.py look . new:<name>` copies it to
   `style-card.md`, never into `<skill>`. Rewrite every field.
3. **Pick the source.** A reference video:
   `python3 -B <skill>/scripts/vqa.py pack ref.mp4 --spec none --out study/ref` (sheet, bursts, still runs, strip,
   onsets; never load the video; ignore its delivery verdicts). A named style alone: its defining conventions,
   every number "(start)". The brief alone: change only what it forces.
4. **Rules, not content.** No subject, copy, layout, name, file path, hash or BPM from any source; the palette in
   words, never hexes (card-lint refuses them); faces as a class plus two or three OFL options.
5. **Every field.** Fit: use for, not for, confused with (the nearest card and the one trait that differs).
   Reviewer: at most 30 words on what is intended that a stranger might call a defect. Transfer: the rule every object
   obeys; the subject's noun and verb in the style. Variation: three structures, openings and endings, one ending not
   a lockup. Pitfalls: three to six, failure → fix. Fidelity: what the HTML path stands in for. Ref (n=1): measured
   numbers. JSON: every key; the tools read register, `motion.clock`, `motion.blur`, `motion.holds`, `energy`,
   `composition` and `guards`. Each number sits in the JSON, carries "(start)", or is on the Ref line.
6. **Lint it.** `python3 -B <skill>/scripts/new.py card-lint style-card.md` until it passes, then run
   step 2's `look` again so `film/style.js` takes your values.
7. **Prove one move:** render the native move (`--range` over 2–3 s, `--out renders/style-test.mp4`), run
   `--lint` and `--speed`, then open the board of
   `python3 -B <skill>/scripts/vqa.py board renders/style-test.mp4 --out qa/style`. Fix each FAIL or WARN, or trace it
   to a card field and log a deliberate exception in plan.md. A run-time card's `expect` lines are ignored; its
   emptiness waives the empty-band WARN on half the frames at most.
