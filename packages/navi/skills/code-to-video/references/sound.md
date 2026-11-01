# Sound: music, voice-over and captions

Adapted in part from video-shotcraft (Apache-2.0, © Wei Yihao): the beat grid, back-timing and sync practice;
rewritten, with the numbers re-measured.

*start* marks a starting value to tune.

## Sources and the licence ledger

- Order: supplied audio (music, voice, a sonic logo), then a licensed library (Mixkit, Pixabay, Freesound per file,
  incompetech; read the terms at download; CC-BY-NC is not commercial), then the `sfx.py` kit or your own synthesis.
  A file you cannot trace is not used commercially.
- Log each file under plan.md's Decisions: file · title and author · source URL · licence · attribution · where used;
  copy each attribution into report.md. Keep stock audio in the work folder, never in the user's repository.
- You cannot audition: cut two or three candidates under the picture for a human to choose.

## Music: edit, never trim

- Choose by register, tempo and structure: a steady drum bed carries cues; a busy melody fights them. Prefer stems
  or the track's own short edits.
- **Cut on bar lines:** remove whole phrases (4, 8 or 16 bars) between downbeats A < B, keeping [0, A + d/2] and
  [B − d/2, end] with a d = 0.03 s crossfade (up to a bar for pads).
  `ffmpeg -i music.mp3 -filter_complex "[0:a]atrim=0:15.7982,asetpts=PTS-STARTPTS[a];[0:a]atrim=start=31.5055,asetpts=PTS-STARTPTS[b];[a][b]acrossfade=d=0.03:c1=tri:c2=tri" -ar 48000 edit.wav`
- **Back-time the ending:** the music's button (its last hit, `m_end` s into the file) lands on the picture's last hit
  at `p_end`: `music.offset = m_end − p_end + music.start`; if negative, start the music later or keep more phrases.
  Enter on a downbeat with a 0.3–1 s fade-in; end on the button and its tail, or fade over 2 s or more, never
  mid-phrase.
- Stretch at most 3–5% (`-af atempo=1.03`); beyond that, retime the picture.
- The timeline's `music` is `{file, gain_db, start, offset, fade_in, fade_out, duck_db}`. mix.py ducks it under the
  cues and WARNs when a cue does not clear it by the register's margin: lower the music or drop it.

## Picture cut to music

Fit the grid before the beat table, in float seconds; convert to frames last (a beat at 128 BPM is 14.0625 frames).

```sh
python3 -B <skill>/scripts/beatgrid.py music.mp3 122 --json grid.json
```

It fits `t_k = T0 + k·T` around the stated BPM (always pass it: octave and 3:2 errors fit well too); `--start` and
`--end` fit one section. Use the grid only when it prints ACCEPT; when it does not trust the phase, have a human check
on clicks that T0 is a downbeat.

- Cuts on grid beats, shots of 4 or 8 beats; accents and the last hit on real transients
  (`python3 -B <skill>/scripts/vqa.py onsets music.wav`); the biggest hits on the two or three strongest beats.
- Put the grid in the timeline as `beats: {bpm, t0}`; `beatFrame(k + 1, bpm, t0 * fps, fps)` (lib/time.js) is beat
  k's frame.
- A cut within 3 frames of its beat passes, within 1.5 is good; one offset on every cut is a pipeline offset.

## Voice-over

- Script first: about 2.5 words a second, 2 for calm, never above 3 (*start*); Mandarin about 4 characters a second.
  One idea per line; each line ends where a cut or hold begins.
- Draft with TTS to size the film, then swap in the final voice. macOS:
  `say -v Samantha -r 150 --file-format=WAVE --data-format=LEI16@48000 -o vo/01.wav "One line answers the question."`
  Its licence is personal and non-commercial, so the delivered film needs the final voice. Elsewhere `espeak-ng` or
  `piper` (check each voice's licence), then `ffmpeg -i tmp.wav -ar 48000 vo/01.wav`. Imitate a real person's voice
  only with their written consent.
- Measure each line (`ffprobe -v error -show_entries format=duration -of csv=p=0 vo/01.wav`) and size the scene from
  it: a 0.2–0.4 s lead-in, the line, a 0.4–0.8 s tail (*start*). Rewrite a line that does not fit; never speed a voice
  up by more than 5%.
- Each line is a cue with `anchor: "start"`, ducking the music by up to `duck_db` (8–12 for voice-led films). The
  voice is the loudest element; keep effects sparse under it. Report a draft voice as a draft.
- **A supplied take in one file:** its pauses mark the lines:
  `ffmpeg -hide_banner -nostats -i vo.wav -af silencedetect=noise=-40dB:d=0.4 -f null - 2>&1 | grep -oE 'silence_(start|end): [0-9.]+'`.
  Each silence_end starts the next line; expect one pause fewer than lines. Raise `d` when a pause splits a line; set
  `noise` 10 dB over the pauses when breath hides one. Keep the take as one cue; fit scenes and captions to it.

## Captions

From the script, never from recognition: each line's text, start and measured length. Split at phrase breaks into at
most 2 lines of 42 characters, at most 20 characters a second, 5/6 to 7 s each, at least 2 frames apart. CJK: cjk.md.
Burn-ins and SRT or WebVTT files: delivery.md. A supplied voice with no script: ask for one; a speech-to-text
transcript is a draft sidecar, never burned in until a human confirms the words.

## Report

Numbers, never "sounds great": loudness, range and true peak of the encoded file; each track's title, source, licence,
BPM, grid residuals and edits; the voice (supplied, final, draft or none) and its pace; where captions came from. Ask a
human to listen for timbre, the signature hit, a voice never masked, and an ending not cut mid-phrase.
