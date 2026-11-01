# Delivery: destinations, variants, GIF, masters, captions, posters, long films

The commands ran on FFmpeg 8.1; check your build once:
`ffmpeg -hide_banner -encoders | grep -E 'libx264|prores_ks|libvpx-vp9|aac_at'`. Encode once from frames or a
lossless master: each extra lossy generation costs quality. *start* marks a starting value.

## Destinations

The destination's own spec sheet wins, and for loudness it wins over the register. To master to one, run
`python3 -B <skill>/scripts/vqa.py loudness renders/v3-final.mp4 --spec ebu`: each FAIL line names that spec's target
or true-peak ceiling. Pass them to `mix.py --target` and `--tp`, then pack the new file with the same `--spec`.

| Destination | Picture | Sound | `--spec` |
|---|---|---|---|
| web and social feeds, YouTube | the render as it is | AAC 48 kHz stereo | `web` if the brief names one, else the register's |
| podcast or voice-led web explainer | the render | AAC | `voice` |
| chat and docs | H.264, CRF 20–23, at most 1920 px wide (*start*) | AAC 128–192k | the register's |
| slides (PowerPoint, Keynote, Google Slides) | H.264 and AAC in MP4; frame 0 designed; captions burned in | AAC | the register's |
| broadcast, editor handoff | the broadcaster's sheet, else ProRes 422 HQ (below) | PCM 48 kHz 24-bit | `ebu` (EBU R128) or `atsc` (ATSC A/85) |

- Slides: PowerPoint's Compress Media drops subtitle tracks, so burn captions in; cap the bitrate for Microsoft 365
  with `-maxrate 8M -bufsize 8M` on a re-encode.

## Aspect variants

Re-compose every aspect from the same timeline; never crop or letterbox the 16:9 film. Sizes: 16:9 1920×1080, 9:16
1080×1920, 1:1 1080×1080, 4:5 1080×1350. The page sizes its stage from `window.__videoRender` and sets a `portrait`
class when height exceeds width (4:5 gets it, 1:1 does not: give each aspect its own layout rules). Stills, lint, then
the render, each variant in its own folder with its own timeline:

```sh
node <skill>/scripts/render.mjs film/index.html --width 1080 --height 1920 --stills 1.5,6.5 --out renders/9x16/v3.mp4
node <skill>/scripts/render.mjs film/index.html --width 1080 --height 1920 --lint --out renders/9x16/v3.mp4
node <skill>/scripts/render.mjs film/index.html --width 1080 --height 1920 --out renders/9x16/v3.mp4
```

Then mix, mux and pack it (Final check below). In 9:16, text stays inside the dashed box on the pack's phone pages,
and burned-in captions sit in its lower part. A shorter cut drops beats, never shortens holds. A smaller copy of one
aspect is one downscale of its final file; write both numbers (small 9:16 is `scale=720:1280`):
`ffmpeg -i final.mp4 -vf "scale=1280:720:flags=lanczos" -c:v libx264 -preset slow -crf 18 -c:a copy -movflags +faststart final_1280x720.mp4`.

## GIF

```sh
ffmpeg -i final.mp4 -vf "fps=20,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" final.gif
```

- 20 or 25 fps: GIF stores delays in hundredths of a second, so 15 and 30 fps come out uneven. It loops forever.
- `dither=none` for flat UI and type; `dither=bayer:bayer_scale=4` when gradients band (about 30% more bytes).
- A GIF is 5–7× the bytes of a 720 px MP4, silent, and 256 colours a frame: where the page can play video, ship a
  muted looping MP4.

## Editor and broadcast masters

ProRes 422 HQ with 24-bit PCM, tagged BT.709, from frames (`render.mjs … --frames-dir frames`) and the mix:

```sh
ffmpeg -framerate $FPS -i frames/frame-%06d.png -i sound/mix.wav -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv422p10le,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv" -c:v prores_ks -profile:v 3 -vendor apl0 -c:a pcm_s24le final_prores.mov
```

`$FPS` is the film's fps (its timeline.json); `-framerate` goes before `-i` (image sequences default to 25 fps).
Stems on request: `mix.py --stem` writes the cues alone. Masters with alpha: overlay.md.

## Captions

- **Burn in** for muted autoplay, inside the page, so the type matches the film; many ffmpeg builds lack the
  `subtitles` and `drawtext` filters.
- **Sidecars** come from the script and the timeline (sound.md): at most 42 characters a line and 2 lines, 20
  characters a second, 5/6 to 7 s on screen, 2 frames apart. SRT numbers each cue and writes
  `00:00:01,500 --> 00:00:03,200`; WebVTT opens with `WEBVTT` and writes `00:00:01.500 --> 00:00:03.200`.
- **Soft tracks:** `ffmpeg -i final.mp4 -i final.en.srt -map 0 -map 1 -c copy -c:s mov_text -metadata:s:s:0 language=eng -movflags +faststart final_subs.mp4`;
  in WebM, `-c:s webvtt` from the `.vtt`.

## Posters and frame 0

- Take the frame that states the idea, the signature moment or the settled last frame, never one mid-move:
  `ffmpeg -ss 7.5 -i final.mp4 -frames:v 1 -update 1 final_poster.png` is frame-exact.
- The last frame: `rm -f final_poster.png; ffmpeg -v error -sseof -0.5 -i final.mp4 -update 1 final_poster.png; test -s final_poster.png || echo "no poster written"`.
  ffmpeg exits 0 even when it writes nothing, so check that every extracted image exists.
- Players show frame 0 before play: design it, and look at it.

## Banding and quick fixes

- Gradients band in 8-bit H.264 even at CRF 18. Fix it in the design first; keep CRF at 18 or lower; if bands remain,
  add lib/look.js's static grain (marked texture, so the checks ignore it).
- `moov` after `mdat`: `ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`.
- Colour tags missing on a file encoded with the BT.709 matrix:
  `ffmpeg -i in.mp4 -c copy -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1 out.mp4`.
  Matrix and tags must agree; re-encoding from frames is better still.

## Final check of each file

- A byte-identical copy of the gated final.mp4 needs nothing more.
- Any other MP4 with sound (a downscale, a re-encode, an aspect variant) gets its own pack, with the timeline and stem
  of the render it came from, and you open its board:
  `python3 -B <skill>/scripts/vqa.py pack final_9x16.mp4 --timeline renders/9x16/v3.timeline.json --sfx-stem sound/9x16-stem.wav --kit sound/kit --out qa/final-9x16`.
- A GIF or a ProRes master is probed as its own kind: `python3 -B <skill>/scripts/vqa.py probe final.gif --kind gif`,
  or `--kind prores --spec ebu` (or `atsc`). Check that its length is within a frame of the MP4's, and look at its
  first and last frames.
- List every file in report.md with its probed spec. Name each after final.mp4 and what it is (`final_9x16.mp4`,
  `final.en.srt`, `final_poster.png`); never overwrite a reviewed render.

## Films over 3 minutes

- Plan chapters of one to three minutes in plan.md, each with its own one-line idea and beat table, joined by one
  chapter device (a title that settles into a section label, or the same push) with the same sound every time.
- Rounds and budgets count per chapter, at least two rounds each; the gate checks them. Re-pack only chapters whose
  picture or sound changed, and pack the full film before the gate.
- Long renders: `--workers N` spreads the frames over N browsers.
- YouTube chapters: `0:00 Title` lines in the description, the first at 0:00, at least three, each at least 10 s.
