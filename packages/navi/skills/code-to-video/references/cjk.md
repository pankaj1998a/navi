# Chinese, Japanese and Korean text

Adapted in part from huashu-design (MIT, © 2026 alchaincyf): CJK faces and type; rewritten.

## Faces

- Vendor a face covering every character on screen; the starter's faces are Latin only. OFL choices: Noto Sans SC,
  TC, JP or KR for read text; Noto Serif SC, TC or JP in heavy weights for display; LXGW WenKai TC (a kai face) for
  quotes and emphasis; Smiley Sans (GitHub atelier-anchor/smiley-sans) for titles only. At most two CJK families.
- Google Fonts subsets a face to the characters you send. List every on-screen line in film/copy.txt; refetch after any
  copy edit:

```sh
F="Noto Sans SC"; f=notosanssc
T=$(python3 -B -c 'import sys; print("".join(dict.fromkeys(open(sys.argv[1], encoding="utf-8").read().replace("\n", ""))))' film/copy.txt)
mkdir -p film/fonts/$f && for w in 400 900; do curl -sSG https://fonts.googleapis.com/css2 --data-urlencode "family=${F}:wght@$w" --data-urlencode "text=$T" | grep -o 'https://[^)]*' | xargs curl -sS -o film/fonts/$f/$f-$w.ttf; done
curl -sS -o film/fonts/$f/OFL.txt https://raw.githubusercontent.com/google/fonts/main/ofl/$f/OFL.txt
```

  Keep the braces in `${F}` (zsh mangles `$F:w`); css2 refuses about 2,000 characters at once. Declare each file with
  `format("truetype")`; `render.mjs --lint` names any character a fallback face drew.
- Latin face first, CJK face second, so Latin letters and digits keep the Latin design:
  `font-family: "Inter", "Noto Sans SC", sans-serif`. Set `<html lang>` to `zh-Hans`, `zh-Hant`, `ja` or `ko`.
- `font-synthesis: none`, so a weight you did not fetch shows as missing, never smeared or faux italic. Emphasise with
  weight, colour, the kai face or emphasis dots (`text-emphasis: dot`).

## Size, width, breaks

- Read CJK text is at least 40 px at 1080p (lint errors below it); captions at least 56 px.
- Each character and full-width mark is 1 em: a 56 px line holds about 30 across 16:9 title-safe, 14 in the 9:16
  safe box.
- Browsers break between any two characters. Break titles and captions by hand at phrase boundaries (`<br>`, or
  `word-break: keep-all` with `<wbr>` between phrases); `line-break: strict` keeps closing marks off a line's start.
- Tracking: read text 0 to +0.05 em; titles 0; display above 60 px −0.02 em to 0; never the Latin −0.05 em.
- Display contrast comes from weight (900 against 300 of one family). Vertical titles: `writing-mode: vertical-rl`,
  two-digit numbers upright with `text-combine-upright: all`.

## Punctuation

Chinese and Japanese use full-width marks (，。、！？「」) with no spaces around them, and half-width digits. In
captions, Simplified Chinese and Japanese replace commas and full stops with a space, Traditional Chinese drops full
stops and line-final commas, and Korean ends no line with either.

## Timing and motion

- `hold(after, {read: '#el'})` counts characters: Chinese 7 characters a second, Japanese 4, Korean 12 syllables,
  at least 1 s.
- Caption limits (Netflix; spaces and punctuation count): Chinese at most 16 characters a line and 9 a
  second, Japanese 13 and 4, Korean 16 and 12, at most 2 lines.
- Animate by phrase (2–6 characters), never character by character, except per-glyph pops on display captions of
  at most 6 characters, held at least 1 s after the last lands.
