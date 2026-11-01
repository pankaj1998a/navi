#!/usr/bin/env python3
"""Mix a timeline's sound cues into a placed, ducked, mastered WAV (Python stdlib + ffmpeg).

  mix.py TIMELINE.json --kit KITDIR --out mix.wav [--stem sfx-stem.wav] [--target LUFS] [--tp DBTP]
         [--video in.mp4 --mux out.mp4]

1. Every cue's anchor lands on its time, sample-exact: the anchor is the cue's "anchor" (start | peak |
   end | seconds into the file), else the kit.json anchor for kit sounds, else the loudest 10 ms RMS
   window of the file. Placement is `adelay` in samples after gain and pan; a sound whose head would
   start before 0 s is trimmed.
2. Cues are summed with amix normalize=0 (no 1/N scaling) and padded to the timeline duration.
3. The optional music bed gets gain, offset, start, S-curve fades, and sidechain ducking keyed by the
   SFX bus (so voice-over cues duck it too), capped at duck_db.
4. Layers are continuous sounds that follow the picture rather than mark an instant (a servo whir
   made from joint speeds, typing heard but not watched, room tone). Each plays from its start for its file length
   (no loop; a head before 0 s is trimmed, the rest is cut at the programme end) with gain, pan, S-curve
   fades (a fade-out ends where the layer stops), and optional ducking under the cues as for the music.
   They sum into the master on their own bus and stay out of the SFX stem, which remains the cue bus
   that vqa.py measures. A layer with "times" instead places one hit of its sound at each time (the
   sound's anchor on the time, sample-exact, as for a cue), cycling a list of sounds in order, at
   gain_db plus a fixed level pattern within +/-vary_db (seeded by the layer id, so every run is the
   same): keys typed on screen, on the layer bus rather than among the sync-checked cues.
   With no music, room tone plays under the whole programme instead of a pad: the kit's `room` (sfx.py), or
   one synthesized for this mix when the kit has none, looped at the register's room-tone level, 20 ms in,
   0.4 s out, never ducked. A format whose sound_by_default is false (overlay) gets none.
5. Mastering: one exact gain to the register's loudness target (the timeline's "register": calm, neutral or
   energetic; none means neutral; the numbers live in registers.json), then a 4x-oversampled,
   latency-compensated limiter under its true-peak ceiling; re-measured and corrected until within 0.1 LU.
   --target and --tp override the register (a NOTE says so). The gain never makes the limiter take more than
   12 dB off the peaks (warns above 6 dB); if the target needs more, the level is held and reported.
   Output: 48 kHz stereo 24-bit WAV, exactly the timeline duration.
6. --stem writes the cue bus alone (no music, no layers) at the master gain, before the limiter (32-bit
   float WAV), for onset checks (vqa.py --sfx-stem).
7. --video/--mux: copies the video stream, encodes the mix as AAC at 256 kb/s, and compares presented
   durations (how long players present each stream): ffprobe's stream durations, which follow the MP4
   edit lists, cross-checked against the edit lists read from the file. Decoded length is no measure:
   ffmpeg's decoder skips the encoder priming but plays the end padding (+3 to +36 ms in tests).
   aac_at (macOS) is tried first and kept only if its audio matches the video within 1 ms; it pads its
   edit list to whole 1024-sample AAC frames (up to 21 ms long), so it passes only when the programme
   fills whole frames (1 length in 16 at 30 fps). Otherwise native aac, whose edit list is exact to the
   millisecond. Loudness and true peak are re-measured after encoding; if the codec overshoots, the
   limiter ceiling is lowered and the master redone. The timeline must match the video's duration
   (within half a frame).
8. Checks (WARN or NOTE; they never change the exit status):
   - Cue margin: each cue's loudest 400 ms momentary loudness around its anchor (the cue alone at its gain and
     pan, K-weighted as in BS.1770, windows holding the anchor on a 10 ms grid) minus the ducked music bed's over
     the same window must reach the register's cue margin; the fix is to lower the bed or drop it. Room tone is
     not checked: its level is the register's, not the timeline's.
   - A music bed that neither the brief nor the style card asks for: in the nearest .c2v/state.json at or above the
     timeline, new.py's demands.music is false and the card in force (look.style_card, the copy `new.py look` made)
     names no sound.bed in its JSON. No state.json or no demands.music: not judged; a state.json or card that
     cannot be read or parsed, or a look.style_card that is not a path: a NOTE, and not judged.
   - A cue that starts before 0 s or lands within 0.15 s of the start; audio that goes digitally silent (under
     -90 dBFS) more than 100 ms before the picture ends; music or room tone that drops to digital silence for
     more than 100 ms between its fades.
   - NOTE the loudness range, and a near-mono master (left-right correlation over 0.98) when cues are panned.

Timeline keys used: duration (required), fps, register, format, cues[] {id, t, sound, gain_db, anchor, pan}, music {file,
gain_db, start, offset, fade_in, fade_out, duck_db}, layers[] {id, sound, start, gain_db, pan, fade_in,
fade_out, duck_db} or, with times, {id, sound (a name or path, or a list of them), times[], gain_db, pan,
vary_db, duck_db, anchor} (no start or fades: each time is programme seconds, like a cue's t); music
defaults: gain_db 0, start 0, offset 0, fade_in 1, fade_out 2, duck_db 6 (0 = no ducking); layer
defaults: start 0, gain_db 0, pan 0, fade_in 0, fade_out 0, duck_db 0, vary_db 0. Paths resolve against
the timeline's folder; a cue or layer sound (or music file) that names a kit.json entry uses the kit
file. A "range" key is ignored: render.mjs has already shifted times into the clip.

Exit status: 0 = targets met; 1 = written but loudness or true peak missed (see WARN); 2 = bad input;
3 = ffmpeg/ffprobe missing or failed.
"""
import sys

sys.dont_write_bytecode = True  # spec 2.0: set before any other import, so nothing is written into the skill folder
import argparse
import array
import itertools
import json
import math
import operator
import os
import random
import re
import shutil
import struct
import subprocess
import tempfile
import zlib

SR = 48000
FF = ["ffmpeg", "-hide_banner", "-nostats"]
HERE = os.path.dirname(os.path.abspath(__file__))
# BS.1770 K-weighting at 48 kHz (high shelf, then the RLB high-pass), as ffmpeg biquads.
KW = ("biquad=b0=1.53512485958697:b1=-2.69169618940638:b2=1.19839281085285:a0=1:a1=-1.69065929318241:"
      "a2=0.73248077421585,biquad=b0=1:b1=-2:b2=1:a0=1:a1=-1.99004745483398:a2=0.99007225036621")
M_WIN, M_STEP = int(0.4 * SR), int(0.01 * SR)  # momentary-loudness window and the margin search step
LEAD_IN_S, GAP_S, SILENT_DBFS, MONO_CORR = 0.15, 0.1, -90.0, 0.98
ROOM_FADES = (0.02, 0.4)


class MixError(Exception):
    pass


def fail(msg, code=2):
    print(f"mix.py: error: {msg}", file=sys.stderr)
    sys.exit(code)


def run(cmd, binary=False):
    try:
        p = subprocess.run(cmd, capture_output=True, text=not binary)
    except FileNotFoundError:
        fail(f"{cmd[0]} not found on PATH (install ffmpeg, e.g. `brew install ffmpeg` or `apt install ffmpeg`)", 3)
    if p.returncode != 0:
        err = p.stderr if not binary else p.stderr.decode(errors="replace")
        tail = "\n".join(err.strip().splitlines()[-6:])
        fail(f"{cmd[0]} failed ({' '.join(cmd[:6])} ...):\n{tail}", 3)
    return p


def probe(path):
    """(duration s, channels, sample rate) of the first audio stream."""
    out = run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
               "stream=channels,sample_rate,duration:format=duration", "-of", "json", path]).stdout
    info = json.loads(out)
    if not info.get("streams"):
        raise MixError(f"{path}: no audio stream")
    st = info["streams"][0]
    dur = st.get("duration") or info.get("format", {}).get("duration")
    if dur in (None, "N/A"):
        raise MixError(f"{path}: duration unknown")
    return float(dur), int(st["channels"]), int(st["sample_rate"])


def video_info(path):
    out = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
               "stream=duration,nb_frames,avg_frame_rate:format=duration", "-of", "json", path]).stdout
    info = json.loads(out)
    if not info.get("streams"):
        raise MixError(f"{path}: no video stream")
    st = info["streams"][0]
    num, _, den = st.get("avg_frame_rate", "0/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 0.0
    dur = st.get("duration")
    if dur in (None, "N/A"):
        dur = info.get("format", {}).get("duration")
    if st.get("nb_frames") not in (None, "N/A") and fps > 0:
        dur = int(st["nb_frames"]) / fps
    return float(dur), fps


def loudness(path, stream="0:a:0"):
    """Integrated LUFS, true peak dBTP, LRA LU of a file's audio via ebur128 (whole tokens -> float())."""
    err = run(FF + ["-i", path, "-map", stream, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
    summ = err[err.rfind("Summary:"):]
    grab = lambda label, unit: float(re.search(label + r":\s*(\S+)\s+" + unit, summ).group(1))
    return grab(r"\bI", "LUFS"), grab(r"\bPeak", "dBFS"), grab(r"\bLRA", "LU")


def decode(path, af=None):
    """Decode to interleaved float32 stereo at 48 kHz, through the filter chain af when given."""
    raw = run(FF + ["-v", "error", "-i", path, "-map", "0:a:0"] + (["-af", af] if af else [])
              + ["-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], binary=True).stdout
    a = array.array("f")
    a.frombytes(raw[: len(raw) // 8 * 8])
    if sys.byteorder == "big":
        a.byteswap()
    return a


def anchor_points(path, win_s=0.010):
    """(peak, onset) in seconds: start of the loudest win_s RMS window (energy averaged over both
    channels; sfx.py measures kit sounds the same way) and the first sample above -20 dB of the
    file's sample peak."""
    a = decode(path)
    n = len(a) // 2
    if n == 0:
        raise MixError(f"{path}: no samples")
    e = [a[2 * i] * a[2 * i] + a[2 * i + 1] * a[2 * i + 1] for i in range(n)]
    win = max(1, min(n, int(win_s * SR)))
    acc = sum(e[:win])
    best, best_i = acc, 0
    for i in range(win, n):
        acc += e[i] - e[i - win]
        if acc > best:
            best, best_i = acc, i - win + 1
    lim = max(e) * 0.01
    onset = next(i for i, v in enumerate(e) if v >= lim)
    return best_i / SR, onset / SR


# ------------------------------------------------------------------ timeline, kit, cue plan
def num(v, what, lo=None, hi=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise MixError(f"{what} must be a number, got {v!r}")
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise MixError(f"{what} = {v} is outside [{lo}, {hi}]")
    return float(v)


def load_json(path, what):
    try:
        with open(path) as fh:
            return json.load(fh)
    except OSError as e:
        raise MixError(f"cannot read {what} {path}: {e.strerror}")
    except json.JSONDecodeError as e:
        raise MixError(f"{what} {path} is not valid JSON: {e}")


class Sources:
    """Resolves sound names to files and caches each file's probe and measured anchor points."""

    def __init__(self, kit, kitdir, base):
        self.kit, self.kitdir, self.base, self.cache = kit, kitdir, base, {}

    def resolve(self, name, what):
        if not isinstance(name, str) or not name:
            raise MixError(f"{what}: sound must be a kit name or a file path, got {name!r}")
        if self.kit and name in self.kit.get("sounds", {}):
            entry = self.kit["sounds"][name]
            path = os.path.join(self.kitdir, entry["file"])
            if not os.path.isfile(path):
                raise MixError(f"{what}: kit sound {name!r} lists {path}, which does not exist")
            return path, entry
        path = name if os.path.isabs(name) else os.path.join(self.base, name)
        if not os.path.isfile(path):
            hint = "" if self.kit else " (no --kit given)"
            raise MixError(f"{what}: {name!r} is neither a kit sound{hint} nor a file ({path})")
        return path, None

    def info(self, path):
        if path not in self.cache:
            self.cache[path] = {"probe": probe(path), "points": None}
        return self.cache[path]["probe"]

    def points(self, path):
        self.info(path)
        if self.cache[path]["points"] is None:
            self.cache[path]["points"] = anchor_points(path)
        return self.cache[path]["points"]


def anchor_offset(anchor, entry, path, fdur, src, what):
    """Seconds into the file that must land on the cue time, and a label for the table."""
    if anchor is None:
        if entry:
            return float(entry["anchor"]), f"{entry['anchor_kind']}(kit)"
        return src.points(path)[0], "peak"
    if anchor == "start":
        return 0.0, "start"
    if anchor == "end":
        return fdur, "end"
    if anchor == "peak":
        if entry and entry.get("anchor_kind") == "peak":
            return float(entry["anchor"]), "peak(kit)"
        return src.points(path)[0], "peak"
    return num(anchor, f"{what} anchor", 0.0, fdur), "seconds"


def plan_cues(tl, src, dur):
    plans, n_total = [], int(round(dur * SR))
    for i, c in enumerate(tl.get("cues") or []):
        if not isinstance(c, dict):
            raise MixError(f"cues[{i}] must be an object")
        cid = str(c.get("id", f"cue{i}"))
        what = f"cue {cid!r}"
        if "sound" not in c or "t" not in c:
            raise MixError(f"{what}: needs 'sound' and 't'")
        t = num(c["t"], f"{what} t")
        gain = num(c.get("gain_db", 0.0), f"{what} gain_db", -120.0, 24.0)
        pan = num(c.get("pan", 0.0), f"{what} pan", -1.0, 1.0)
        path, entry = src.resolve(c["sound"], what)
        fdur, ch, rate = src.info(path)
        off, kind = anchor_offset(c.get("anchor"), entry, path, fdur, src, what)
        p = {"id": cid, "sound": c["sound"], "path": path, "t": t, "anchor": off, "kind": kind, "gain": gain,
             "pan": pan, "channels": ch, "rate": rate, "fdur": fdur, "note": ""}
        if not 0.0 <= t < dur:
            p["note"] = f"skipped: t is outside the programme (0-{dur:g} s)"
            p["skip"] = True
            plans.append(p)
            continue
        start = t - off
        p["head"] = 0
        if start < 0:
            p["head"] = int(round(-start * SR))
            p["note"] = f"head trimmed {-start:.3f} s (starts before 0 s)"
            start = 0.0
        p["start"] = start
        p["delay"] = int(round(start * SR))
        if p["delay"] >= n_total:
            p["note"], p["skip"] = "skipped: starts after the programme end", True
        plans.append(p)
    return plans


# ------------------------------------------------------------------ filter graph
def to_stereo_48k(channels, rate):
    steps = ["pan=stereo|c0=c0|c1=c0"] if channels == 1 else []  # mono: unity in both channels, not -3 dB
    if rate != SR:
        steps.append(f"aresample={SR}")
    return steps + ["aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"]


def pan_coefs(p):
    """(a, b, c, d): left = a*L + b*R, right = c*L + d*R. Constant-power pan of the mid (L+R) signal, side
    untouched: unity at 0, never more than +3 dB on one channel, so wide stereo sounds keep their width around
    the new centre."""
    th = (p + 1.0) * math.pi / 4.0
    kl, kr = math.sqrt(2.0) * math.cos(th), math.sqrt(2.0) * math.sin(th)
    return (kl + 1) / 2, (kl - 1) / 2, (kr - 1) / 2, (kr + 1) / 2


def pan_filter(p):
    a, b, c, d = pan_coefs(p)
    return f"pan=stereo|c0={a:.6f}*c0+{b:.6f}*c1|c1={c:.6f}*c0+{d:.6f}*c1"


# Sidechain ducker: a hard compressor keyed by the SFX bus (+12 dB key gain, -40 dBFS threshold) whose
# output is blended with the dry bed so the dip can never exceed duck_db (mix = 1 - 10^(-duck_db/20)).
DUCK = {"threshold": 0.01, "ratio": 20, "attack": 15, "release": 350, "knee": 2, "level_sc": 4}


def duck_filter(duck_db):
    d = DUCK
    return (f"sidechaincompress=threshold={d['threshold']}:ratio={d['ratio']}:attack={d['attack']}:"
            f"release={d['release']}:knee={d['knee']}:link=maximum:detection=peak:level_sc={d['level_sc']}:"
            f"mix={1.0 - 10 ** (-duck_db / 20):.6f}")


def hit_chains(p, j, inputs, g):
    """Times layer j, built like the cue bus: one input per distinct file, fanned out to its hits; per hit:
    head trim, gain, pan, sample-exact delay. Appends to inputs and g; returns the hits' labels."""
    by_path, src_label = {}, {}
    for h in p["hits"]:
        by_path.setdefault(h["path"], []).append(h)
    for m, (path, users) in enumerate(by_path.items()):
        k = inputs.count("-i")
        inputs += ["-i", path]
        labels = [f"[y{j}_{m}_{i}]" for i in range(len(users))]
        fmt = ",".join(to_stereo_48k(users[0]["channels"], users[0]["rate"]))
        g.append(f"[{k}:a]{fmt}" + (f",asplit={len(users)}" if len(users) > 1 else "") + "".join(labels))
        for h, lab in zip(users, labels):
            src_label[id(h)] = lab
    out = []
    for i, h in enumerate(p["hits"]):
        steps = [f"atrim=start_sample={h['head']},asetpts=PTS-STARTPTS"] if h["head"] else []
        steps.append(f"volume={h['gain']:.4f}dB")
        if p["pan"]:
            steps.append(pan_filter(p["pan"]))
        steps.append(f"adelay=delays={h['delay']}S:all=1")
        g.append(src_label[id(h)] + ",".join(steps) + f"[h{j}_{i}]")
        out.append(f"[h{j}_{i}]")
    return out


def build_graph(plans, music, layers, n_total):
    """One ffmpeg input per distinct cue file (asplit fans it out to its cues, so hundreds of cues stay
    within the open-file limit); per cue: head trim, gain, pan, sample-exact delay. The cue bus [sfx] is
    the stem; music and layers (one input each; a times layer one per distinct file) join it only in the
    premaster [pre]. The bed (the music, else room tone) is also tapped as [bed] where it joins the premaster,
    for the checks; the third value says whether there is one."""
    inputs, g, src_label = [], [], {}
    live = [p for p in plans if not p.get("skip")]
    groups = {}
    for p in live:
        groups.setdefault(p["path"], []).append(p)
    for path, users in groups.items():
        k = inputs.count("-i")
        inputs += ["-i", path]
        labels = [f"[s{k}_{j}]" for j in range(len(users))]
        fmt = ",".join(to_stereo_48k(users[0]["channels"], users[0]["rate"]))
        g.append(f"[{k}:a]{fmt}" + (f",asplit={len(users)}" if len(users) > 1 else "") + "".join(labels))
        for p, lab in zip(users, labels):
            src_label[id(p)] = lab
    for i, p in enumerate(live):
        steps = []
        if p["head"]:
            steps.append(f"atrim=start_sample={p['head']},asetpts=PTS-STARTPTS")
        steps.append(f"volume={p['gain']:.4f}dB")
        if p["pan"]:
            steps.append(pan_filter(p["pan"]))
        steps.append(f"adelay=delays={p['delay']}S:all=1")
        g.append(src_label[id(p)] + ",".join(steps) + f"[c{i}]")
    fit = f"apad=whole_len={n_total},atrim=end_sample={n_total}"
    if live:
        g.append("".join(f"[c{k}]" for k in range(len(live)))
                 + f"amix=inputs={len(live)}:normalize=0:duration=longest,{fit}[sfx]")
    else:
        g.append(f"anullsrc=r={SR}:cl=stereo,atrim=end_sample={n_total}[sfx]")
    lay = [p for p in layers if not p.get("skip")]
    if not music and not lay:
        g.append("[sfx]asplit=2[pre][stem]")
        return inputs, ";".join(g), False
    # Music and each layer: head trim, gain, pan, sample-exact delay, S-curve fades, optional ducking keyed
    # by the cue bus. sidechaincompress and amix stop when one input ends, so finite inputs let a key or bus
    # that ends first drop another input's last frames at random, depending on decoder timing. Their inputs
    # are therefore endless (apad) and [pre] is cut to length at the end.
    conts = [dict(music, head=int(round(music["offset"] * SR)), pan=0.0, delay=int(round(music["start"] * SR)),
                  on=music["start"])] if music else []
    buses, keys = [], []
    for j, p in enumerate(conts + lay):
        if p.get("hits"):
            hl = hit_chains(p, j, inputs, g)
            g.append("".join(hl) + (f"amix=inputs={len(hl)}:normalize=0:duration=longest," if len(hl) > 1 else "")
                     + f"{fit},apad[b{j}]")
        else:
            k = inputs.count("-i")
            inputs.extend((["-stream_loop", "-1"] if p.get("loop") else []) + ["-i", p["path"]])
            steps = to_stereo_48k(p["channels"], p["rate"])
            if p["head"]:
                steps.append(f"atrim=start_sample={p['head']},asetpts=PTS-STARTPTS")
            steps.append(f"volume={p['gain']:.4f}dB")
            if p["pan"]:
                steps.append(pan_filter(p["pan"]))
            steps.append(f"adelay=delays={p['delay']}S:all=1")
            if p["fade_in"] > 0:
                steps.append(f"afade=t=in:st={p['on']:.6f}:d={p['fade_in']:.6f}:curve=hsin")
            if p["fade_out"] > 0:
                steps.append(f"afade=t=out:st={p['end'] - p['fade_out']:.6f}:d={p['fade_out']:.6f}:curve=hsin")
            g.append(f"[{k}:a]" + ",".join(steps) + f",{fit},apad[b{j}]")
        if p["duck_db"] > 0:
            keys.append(f"[k{j}]")
            g.append(f"[k{j}]apad[kp{j}];[b{j}][kp{j}]{duck_filter(p['duck_db'])}[d{j}]")
        buses.append(f"[d{j}]" if p["duck_db"] > 0 else f"[b{j}]")
    bed = 0 if music else next((j for j, p in enumerate(lay) if p.get("room")), None)
    if bed is not None:
        g.append(f"{buses[bed]}asplit=2[bedm][bedt];[bedt]atrim=end_sample={n_total}[bed]")
        buses[bed] = "[bedm]"
    g.append(f"[sfx]asplit={2 + len(keys)}[sfxA]{''.join(keys)}[stem]")
    g.append("[sfxA]apad[sfxP]")
    buses.insert(1 if music else 0, "[sfxP]")  # music, cue bus, layers
    g.append("".join(buses) + f"amix=inputs={len(buses)}:normalize=0:duration=first,atrim=end_sample={n_total}[pre]")
    return inputs, ";".join(g), bed is not None


def plan_music(tl, src, dur):
    m = tl.get("music")
    if not m:
        return None
    if not isinstance(m, dict) or "file" not in m:
        raise MixError("music must be an object with a 'file'")
    path, _ = src.resolve(m["file"], "music")
    fdur, ch, rate = src.info(path)
    mu = {"path": path, "file": m["file"], "channels": ch, "rate": rate,
          "gain": num(m.get("gain_db", 0.0), "music gain_db", -120.0, 24.0),
          "start": num(m.get("start", 0.0), "music start", 0.0, dur),
          "offset": num(m.get("offset", 0.0), "music offset", 0.0, fdur),
          "fade_in": num(m.get("fade_in", 1.0), "music fade_in", 0.0, dur),
          "fade_out": num(m.get("fade_out", 2.0), "music fade_out", 0.0, dur),
          "duck_db": num(m.get("duck_db", 6.0), "music duck_db", 0.0, 40.0)}
    mu["end"] = min(dur, mu["start"] + fdur - mu["offset"])
    mu["fade_out"] = min(mu["fade_out"], mu["end"] - mu["start"])
    mu["note"] = "" if mu["end"] >= dur - 1e-6 else (
        f"music ends at {mu['end']:.2f} s, before the programme ends at {dur:g} s; it fades out there "
        f"(make a longer bed: sfx.py make bed --dur {math.ceil(dur + mu['offset'])})")
    return mu


def plan_layers(tl, src, dur):
    """Each layer plays [on, end) of the programme: from its start (a head before 0 s is trimmed) for its
    file length, cut at the programme end; fades are clamped to that span."""
    raw = tl.get("layers")
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise MixError("layers must be a list of objects")
    plans = []
    for i, la in enumerate(raw):
        if not isinstance(la, dict):
            raise MixError(f"layers[{i}] must be an object")
        lid = str(la.get("id", f"layer{i}"))
        what = f"layer {lid!r}"
        if "sound" not in la:
            raise MixError(f"{what}: needs 'sound'")
        if "times" in la:
            plans.append(plan_hits(la, lid, what, src, dur))
            continue
        if isinstance(la["sound"], list):
            raise MixError(f"{what}: a list of sounds needs 'times' (one hit per time, cycling the list)")
        path, _ = src.resolve(la["sound"], what)
        fdur, ch, rate = src.info(path)
        start = num(la.get("start", 0.0), f"{what} start")
        p = {"id": lid, "sound": la["sound"], "path": path, "channels": ch, "rate": rate, "start": start,
             "gain": num(la.get("gain_db", 0.0), f"{what} gain_db", -120.0, 24.0),
             "pan": num(la.get("pan", 0.0), f"{what} pan", -1.0, 1.0),
             "fade_in": num(la.get("fade_in", 0.0), f"{what} fade_in", 0.0, dur),
             "fade_out": num(la.get("fade_out", 0.0), f"{what} fade_out", 0.0, dur),
             "duck_db": num(la.get("duck_db", 0.0), f"{what} duck_db", 0.0, 40.0),
             "on": max(0.0, start), "end": min(dur, start + fdur), "head": 0, "note": ""}
        if p["end"] - p["on"] < 1.0 / SR:
            p["skip"] = True
            p["note"] = f"skipped: it plays {start:g}-{start + fdur:g} s, outside the programme (0-{dur:g} s)"
            plans.append(p)
            continue
        notes = []
        if start < 0:
            p["head"] = int(round(-start * SR))
            notes.append(f"head trimmed {-start:.3f} s")
        if start + fdur > dur + 0.5 / SR:
            notes.append(f"cut at the programme end ({start + fdur - dur:.3f} s unplayed"
                         + (")" if p["fade_out"] else "; add a fade_out to avoid an abrupt stop)"))
        p["note"] = "; ".join(notes)
        p["delay"] = int(round(p["on"] * SR))
        p["fade_in"] = min(p["fade_in"], p["end"] - p["on"])
        p["fade_out"] = min(p["fade_out"], p["end"] - p["on"])
        plans.append(p)
    return plans


def plan_hits(la, lid, what, src, dur):
    """A times layer: one hit per time, the sound's anchor on the time (as for a cue; a head before 0 s is
    trimmed, a time outside the programme skipped), sounds cycled in list order, and each hit at gain_db
    plus a level drawn within +/-vary_db from a generator seeded by the layer id. A level is drawn for
    every listed time, so skipping one never shifts the others' levels or sounds."""
    for k in ("fade_in", "fade_out"):
        if la.get(k):
            raise MixError(f"{what}: a times layer has no {k}; set the hits' level with gain_db and vary_db")
    names = la["sound"] if isinstance(la["sound"], list) else [la["sound"]]
    times = la["times"]
    if not names:
        raise MixError(f"{what}: the sound list is empty")
    if not isinstance(times, list):
        raise MixError(f"{what}: times must be a list of seconds")
    gain = num(la.get("gain_db", 0.0), f"{what} gain_db", -120.0, 24.0)
    vary = num(la.get("vary_db", 0.0), f"{what} vary_db", 0.0, 24.0)
    files = []
    for name in names:
        path, entry = src.resolve(name, what)
        fdur, ch, rate = src.info(path)
        off, _ = anchor_offset(la.get("anchor"), entry, path, fdur, src, what)
        files.append({"path": path, "fdur": fdur, "channels": ch, "rate": rate, "anchor": off})
    rng, n_total, hits = random.Random(zlib.crc32(lid.encode("utf-8"))), int(round(dur * SR)), []
    for k, t in enumerate(times):
        t = num(t, f"{what} times[{k}]")
        level = gain + (vary * (2.0 * rng.random() - 1.0) if vary > 0 else 0.0)
        f = files[k % len(files)]
        start = t - f["anchor"]
        head = int(round(-start * SR)) if start < 0 else 0
        delay = int(round(max(0.0, start) * SR))
        if 0.0 <= t < dur and delay < n_total and head < int(round(f["fdur"] * SR)):
            hits.append(dict(f, t=t, gain=level, head=head, delay=delay, start=max(0.0, start)))
    p = {"id": lid, "sound": la["sound"], "times": len(times), "hits": hits, "gain": gain, "vary": vary,
         "pan": num(la.get("pan", 0.0), f"{what} pan", -1.0, 1.0),
         "duck_db": num(la.get("duck_db", 0.0), f"{what} duck_db", 0.0, 40.0), "note": ""}
    if not hits:
        p["skip"] = True
        p["note"] = (f"skipped: none of its {len(times)} times is heard inside the programme (0-{dur:g} s)" if times
                     else "skipped: no times")
        return p
    p["on"] = min(h["start"] for h in hits)
    p["end"] = min(dur, max(h["start"] + h["fdur"] - h["head"] / SR for h in hits))
    if len(hits) < len(times):
        p["note"] = (f"{len(times) - len(hits)} of {len(times)} times skipped: outside the programme (0-{dur:g} s) "
                     f"or heard only before 0 s")
    return p


def plan_room(src, gain, dur):
    """The room-tone layer of a film with no music: the kit's `room`, else one sfx.py synthesizes into the temp
    folder (path None until then), looped under the whole programme at the register's level."""
    path = src.resolve("room", "room tone")[0] if src.kit and "room" in src.kit.get("sounds", {}) else None
    ch, rate = src.info(path)[1:] if path else (2, SR)
    fi, fo = (min(f, dur / 2) for f in ROOM_FADES)
    return {"id": "room", "sound": "room", "path": path, "channels": ch, "rate": rate, "gain": gain, "pan": 0.0,
            "fade_in": fi, "fade_out": fo, "duck_db": 0.0, "start": 0.0, "on": 0.0, "end": dur, "head": 0, "delay": 0,
            "loop": True, "room": True, "note": "room tone: no music, so it plays under the whole film (looped)"}


def bed_asked(timeline):
    """Whether the brief or the style card asks for a music bed (S21), from new.py's records in the nearest
    .c2v/state.json at or above the timeline's folder: demands.music (the brief asks for music), else a non-empty
    sound.bed in the JSON of the card in force (look.style_card: the copy `new.py look` made in the work folder; null
    for an open or brand look). (True or False, None); (None, None) with no record to judge by (no state.json, or
    no demands.music in it); (None, NOTE) when a record cannot be read: state.json or the card cannot be opened, is
    not UTF-8 or its JSON does not parse (nested too deep included), or look.style_card is neither empty nor a path.
    The record decides one WARN, so none of these stops the mix."""
    d = os.path.dirname(os.path.abspath(timeline))
    while not os.path.isfile(os.path.join(d, ".c2v", "state.json")):
        if os.path.dirname(d) == d:
            return None, None
        d = os.path.dirname(d)
    path = os.path.join(d, ".c2v", "state.json")
    try:
        with open(path, encoding="utf-8") as fh:  # new.py writes UTF-8
            st = json.load(fh)
    except (OSError, ValueError, RecursionError) as e:  # not JSON or not UTF-8; json recurses per nesting level
        return None, (f"cannot read {path} ({e.strerror if isinstance(e, OSError) else e}): the music bed is not "
                      f"checked against the brief or the card")
    dm = st.get("demands") if isinstance(st, dict) else None
    if not isinstance(dm, dict) or not isinstance(dm.get("music"), bool):
        return None, None
    look = st.get("look")
    card = look.get("style_card") if isinstance(look, dict) else None
    if dm["music"] or not card:  # the brief asks, or no card is in force (no look yet, or an open or brand look)
        return dm["music"], None
    if not isinstance(card, str):  # new.py writes a path or null; a hand edit can leave true, a number or a list
        return None, (f"cannot read the style card named in {path} (look.style_card is not a path): the brief asks "
                      f"for no music, and whether the card names a bed is not checked")
    path = os.path.join(d, card)
    try:
        with open(path, encoding="utf-8") as fh:
            block = re.search(r"^```[ \t]*json[ \t]*\r?\n(.*?)^```", fh.read(), re.M | re.S | re.I)
        if not block:
            raise ValueError("no ```json block")
        cj = json.loads(block.group(1))
    except (OSError, ValueError, RecursionError) as e:
        return None, (f"cannot read the style card {path} ({e.strerror if isinstance(e, OSError) else e}): the brief "
                      f"asks for no music, and whether the card names a bed is not checked")
    sound = cj.get("sound") if isinstance(cj, dict) else None
    bed = sound.get("bed") if isinstance(sound, dict) else None
    return isinstance(bed, str) and bool(bed.strip()), None


# ------------------------------------------------------------------ checks: cue margins, silences, width
def csum(x):
    return array.array("d", itertools.accumulate(x, initial=0.0))


def cue_margins(plans, bed_wav, n_total):
    """(cue, LU) per live cue: its loudest 400 ms momentary loudness around the anchor (the cue alone at its gain
    and pan, over the windows of a 10 ms grid that hold the anchor) minus the ducked bed's over that window. A short
    cue reads the same in every window that holds it, so of the windows within 0.1 LU of its loudest the middle one
    is taken. The bed's K-weighted energy is summed per 10 ms block; each cue file's L*L, L*R and R*R per sample,
    which its pan and gain combine exactly."""
    b, blk, nw = decode(bed_wav, KW), M_STEP, M_WIN // M_STEP
    bed = csum(sum(map(operator.mul, x, x)) for x in (b[i:i + 2 * blk] for i in range(0, len(b), 2 * blk)))
    del b
    sums, out = {}, []
    for p in plans:
        if p.get("skip"):
            continue
        if p["path"] not in sums:
            a = decode(p["path"], ",".join(to_stereo_48k(p["channels"], p["rate"]) + [KW]))
            sums[p["path"]] = [csum(map(operator.mul, x, y)) for x, y in
                               ((a[0::2], a[0::2]), (a[0::2], a[1::2]), (a[1::2], a[1::2]))]
        S, (ca, cb, cc, cd), w = sums[p["path"]], pan_coefs(p["pan"]), 10 ** (p["gain"] / 10)
        k = (w * (ca * ca + cc * cc), 2 * w * (ca * cb + cc * cd), w * (cb * cb + cd * cd))
        off, m0, ws = p["head"] - p["delay"], int(round(p["t"] * SR)) // blk + 1, []
        for m in range(m0, m0 + nw):  # window [m - nw, m) in blocks
            lo, hi = max(0, m - nw), min(len(bed) - 1, m)
            i, j = max(p["head"], lo * blk + off), min(len(S[0]) - 1, min(hi * blk, n_total) + off)
            ws.append((sum(kk * (c[j] - c[i]) for kk, c in zip(k, S)) if j > i else 0.0, lo, hi))
        top = max(w[0] for w in ws)
        near = [w for w in ws if w[0] >= top * 10 ** -0.01]
        ec, lo, hi = near[len(near) // 2]
        if ec > 0:
            eb = bed[hi] - bed[lo]
            out.append((p, 10 * math.log10(ec / eb) if eb > 0 else math.inf))
    return out


def silent_runs(a, lo, hi, thr):
    """(start s, length s) of each run of digital silence (both channels under thr) longer than GAP_S in frames
    [lo, hi) of interleaved stereo a, in 1 ms blocks."""
    runs, start, blk = [], None, SR // 1000
    for f in itertools.chain(range(lo, hi, blk), [hi]):
        quiet = f < hi and max(map(abs, a[2 * f:2 * min(hi, f + blk)])) < thr
        if quiet and start is None:
            start = f
        elif not quiet and start is not None:
            if f - start > GAP_S * SR:
                runs.append((start / SR, (f - start) / SR))
            start = None
    return runs


def audio_end(a, thr):
    """Frames up to and including the last sample of interleaved stereo a at or above thr (0 if none)."""
    i = len(a)
    while i > 0:
        j = max(0, i - SR // 5)
        seg = a[j:i]
        if max(map(abs, seg)) >= thr:
            return (j + max(k for k, v in enumerate(seg) if abs(v) >= thr)) // 2 + 1
        i = j
    return 0


# ------------------------------------------------------------------ mastering, stem, mux
def limiter_supports_latency():
    return "latency" in run(FF + ["-h", "filter=alimiter"]).stdout


def master(pre, out, gain_db, ceiling_db, n_total, latency_ok):
    """Exact gain, then a 4x-oversampled limiter at ceiling_db. The limiter's 1 ms look-ahead is
    compensated (latency=1, or trimmed by hand on older ffmpeg) so the master stays sample-aligned."""
    lim = f"alimiter=limit={10 ** (ceiling_db / 20):.6f}:attack=1:release=50:level=false"
    lim += ":latency=1" if latency_ok else ",atrim=start_sample=192,asetpts=PTS-STARTPTS"
    af = (f"volume={gain_db:.4f}dB,aresample=192000,{lim},aresample={SR},"
          f"apad=whole_len={n_total},atrim=end_sample={n_total}")
    run(FF + ["-v", "error", "-y", "-i", pre, "-af", af, "-ar", str(SR), "-c:a", "pcm_s24le", out])


MAX_SHAVE_DB = 12.0   # never limit peaks harder than this to reach the loudness target
WARN_SHAVE_DB = 6.0


def master_to_target(pre, out, i0, tp0, target, ceiling, n_total, latency_ok, gain=None):
    """Gain to the loudness target, re-measured until within 0.1 LU. The gain is capped so the limiter
    takes at most MAX_SHAVE_DB off the premaster's true peak; returns capped=True when that cap held
    the level below the target."""
    g_max = ceiling + MAX_SHAVE_DB - tp0
    g = min(g_max, target - i0 if gain is None else gain)
    capped, hist = False, []
    for _ in range(6):
        master(pre, out, g, ceiling, n_total, latency_ok)
        i1, tp1, lra1 = loudness(out)
        hist.append((g, i1))
        if abs(i1 - target) <= 0.1:
            break
        if g >= g_max - 1e-6 and i1 < target:
            capped = True
            break
        # Secant step: under heavy limiting 1 dB of gain buys less than 1 LU, so scale by the measured slope.
        slope = 1.0
        if len(hist) > 1 and abs(hist[-1][0] - hist[-2][0]) > 1e-6:
            slope = min(1.0, max(0.15, (hist[-1][1] - hist[-2][1]) / (hist[-1][0] - hist[-2][0])))
        g = min(g_max, g + (target - i1) / slope)
    return g, i1, tp1, lra1, capped


def aac_encoders():
    """aac_at (macOS AudioToolbox; research: least true-peak overshoot) first when ffmpeg has it, then native aac."""
    return (["aac_at"] if re.search(r"\baac_at\b", run(FF + ["-encoders"]).stdout) else []) + ["aac"]


def stream_seconds(path, sel):
    out = run(["ffprobe", "-v", "error", "-select_streams", sel, "-show_entries", "stream=duration",
               "-of", "csv=p=0", path]).stdout.strip()
    return float(out.splitlines()[0]) if out and out.splitlines()[0] not in ("N/A", "") else float("nan")


def boxes(b, a, z):
    """(type, payload start, end) of each MP4 box in b[a:z]."""
    while a + 8 <= z:
        size, typ = struct.unpack_from(">I4s", b, a)
        hdr = 16 if size == 1 else 8
        size = struct.unpack_from(">Q", b, a + 8)[0] if size == 1 else (size or z - a)
        if size < hdr:
            return
        yield typ, a + hdr, a + size
        a += size


def read_moov(path):
    with open(path, "rb") as fh:
        while True:
            head = fh.read(16)
            if len(head) < 8:
                return b""
            size, typ = struct.unpack_from(">I4s", head)
            hdr = 16 if size == 1 else 8
            if size == 1:
                size = struct.unpack_from(">Q", head, 8)[0]
            if typ == b"moov":
                fh.seek(fh.tell() - len(head) + hdr)
                return fh.read(size - hdr) if size else fh.read()
            if size < hdr:
                return b""
            fh.seek(fh.tell() - len(head) + size)


def edit_lists(path):
    """{'vide' | 'soun': (presented s, media time of the first edit in s)} from each track's edit list
    (trak/edts/elst; timescales from mvhd and mdhd). Players present the sum of the non-empty edit
    segments, starting at that media time: for AAC, after the encoder's priming samples."""
    moov, out, movie_ts = read_moov(path), {}, 1000
    for typ, a, z in boxes(moov, 0, len(moov)):
        if typ == b"mvhd":
            movie_ts = struct.unpack_from(">I", moov, a + (20 if moov[a] == 1 else 12))[0]
        if typ != b"trak":
            continue
        kind, ts, segs = None, None, None
        for t2, a2, z2 in boxes(moov, a, z):
            if t2 not in (b"edts", b"mdia"):
                continue
            for t3, a3, z3 in boxes(moov, a2, z2):
                if t3 == b"elst":
                    v1, n = moov[a3] == 1, struct.unpack_from(">I", moov, a3 + 4)[0]
                    segs = [struct.unpack_from(">Qq" if v1 else ">Ii", moov, a3 + 8 + i * (20 if v1 else 12)) for i in range(n)]
                elif t3 == b"mdhd":
                    ts = struct.unpack_from(">I", moov, a3 + (20 if moov[a3] == 1 else 12))[0]
                elif t3 == b"hdlr":
                    kind = moov[a3 + 8:a3 + 12].decode("latin-1")
        if kind and ts and segs:
            first = next((mt for _, mt in segs if mt >= 0), 0)
            out[kind] = (sum(sd for sd, mt in segs if mt >= 0) / movie_ts, first / ts)
    return out


def presented(path):
    """Presented seconds of the first video and audio stream (ffprobe; its MP4 demuxer applies the edit
    lists), the edit lists' own figures, and the audio priming the edit list skips."""
    el = edit_lists(path)
    return {"video_s": stream_seconds(path, "v:0"), "audio_s": stream_seconds(path, "a:0"),
            "edit_list_s": {k: round(v[0], 6) for k, v in el.items()},
            "priming_samples": round(el["soun"][1] * SR) if "soun" in el else None}


def mux(video, wav, out, encoders):
    """Copy the picture and encode the mix as AAC 256k with each encoder in turn until the presented audio
    matches the presented video within 1 ms; the last encoder is kept regardless. Returns one presented()
    record per encode, the kept one last."""
    tried = []
    for enc in encoders:
        run(FF + ["-v", "error", "-y", "-i", video, "-i", wav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
                  "-c:a", enc, "-b:a", "256k", "-ar", str(SR), "-movflags", "+faststart", out])
        tried.append(dict(presented(out), encoder=enc))
        if abs(tried[-1]["audio_s"] - tried[-1]["video_s"]) <= 0.001:
            break
    return tried


# ------------------------------------------------------------------ main
def lead_ms(p, src):
    """How long before the cue time the sound becomes audible (its -20 dB onset), in ms."""
    onset = src.points(p["path"])[1]
    head = p["head"] / SR
    onset_prog = p["start"] + max(0.0, onset - head)
    return (p["t"] - onset_prog) * 1000.0


def mix(a):
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            fail(f"{tool} not found on PATH (install ffmpeg, e.g. `brew install ffmpeg` or `apt install ffmpeg`)", 3)
    tl = load_json(a.timeline, "timeline")
    if not isinstance(tl, dict):
        raise MixError("the timeline must be a JSON object")
    base = os.path.dirname(os.path.abspath(a.timeline))
    dur = num(tl.get("duration"), "timeline duration", 0.05, 36000.0)
    fps = num(tl.get("fps", 30), "timeline fps", 1.0, 1000.0)
    kit, kitdir = None, None
    if a.kit:
        kitdir = os.path.abspath(a.kit)
        kit = load_json(os.path.join(kitdir, "kit.json"), "kit")
    src = Sources(kit, kitdir, base)
    plans = plan_cues(tl, src, dur)
    music = plan_music(tl, src, dur)
    layers = plan_layers(tl, src, dur)
    live = [p for p in plans if not p.get("skip")]
    if not live and not music and all(p.get("skip") for p in layers):
        raise MixError("nothing to mix: no cue or layer lands inside the programme and there is no music")
    R = load_json(os.path.join(HERE, "registers.json"), "registers")
    reg = tl.get("register")
    if reg is not None and str(reg) not in R["registers"]:
        raise MixError(f"timeline register must be one of {', '.join(R['registers'])}, got {reg!r}")
    rg = R["registers"][reg or "neutral"]
    chk = {"reg": reg or "neutral", "need": rg["cue_margin_lu"], "rec": {},
           "lines": [] if reg else [("NOTE", "the timeline names no register: mastered as neutral")]}
    if a.target is None:
        a.target = rg["loudness"]["target_lufs"]
    else:
        chk["lines"].append(("NOTE", f"--target {a.target:g} overrides the {chk['reg']} register's "
                                     f"{rg['loudness']['target_lufs']:g} LUFS"))
    if a.tp is None:
        a.tp = rg["loudness"]["true_peak_max_dbtp"]
    if (not music and R["formats"].get(str(tl.get("format")), {}).get("sound_by_default", True)
            and not any(p["id"] == "room" for p in layers)):  # a timeline's own room layer replaces it
        layers.append(plan_room(src, rg["room_tone_db"], dur))
    n_total = int(round(dur * SR))
    for p in live:
        p["lead"] = lead_ms(p, src)
        if p["head"] or p["start"] <= 0:
            chk["lines"].append(("WARN", f"cue {p['id']} starts on the first sample: move it or give the film a "
                                         f"lead-in" + (f" ({p['head'] / SR:.3f} s of its head is cut)" if p["head"] else "")))
        elif p["t"] < LEAD_IN_S:
            chk["lines"].append(("WARN", f"cue {p['id']} lands {p['t']:.2f} s after the first sample: move it or "
                                         f"give the film a lead-in"))
    asked, why = bed_asked(a.timeline) if music else (None, None)
    if why:
        chk["lines"].append(("NOTE", why))
    if asked is False:
        chk["lines"].append(("WARN", "a music bed plays, but the brief asks for no music and no style card names a "
                                     "bed (new.py's .c2v/state.json and style-card.md): drop `music` and let room "
                                     "tone play"))
    for path in (a.out, a.stem, a.mux):
        if path:
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="mix-") as td:
        room = next((p for p in layers if p.get("room")), None)
        if room and not room["path"]:
            room["path"] = os.path.join(td, "room.wav")
            run([sys.executable, "-B", os.path.join(HERE, "sfx.py"), "make", "room", "-o", room["path"]])
        inputs, graph, has_bed = build_graph(plans, music, layers, n_total)
        pre, bus, bedw = (os.path.join(td, f) for f in ("pre.wav", "bus.wav", "bed.wav"))
        run(FF + ["-v", "error", "-y", *inputs, "-filter_complex", graph,
                  "-map", "[pre]", "-ar", str(SR), "-c:a", "pcm_f32le", pre,
                  "-map", "[stem]", "-ar", str(SR), "-c:a", "pcm_f32le", bus]
            + (["-map", "[bed]", "-ar", str(SR), "-c:a", "pcm_f32le", bedw] if has_bed else []))
        i0, tp0, _ = loudness(pre)
        if i0 <= -69.9:
            raise MixError("the mix is silent or below -70 LUFS; check cue gains and files")
        latency_ok = limiter_supports_latency()
        ceiling = a.tp - 0.5  # the 4x-oversampled limiter leaves ~0.2-0.3 dB of inter-sample overshoot
        g, i1, tp1, lra1, capped = master_to_target(pre, a.out, i0, tp0, a.target, ceiling, n_total, latency_ok)
        for _ in range(3):
            if tp1 <= a.tp:
                break
            ceiling -= (tp1 - a.tp) + 0.1
            g, i1, tp1, lra1, capped = master_to_target(pre, a.out, i0, tp0, a.target, ceiling, n_total,
                                                        latency_ok, g)
        aac = None
        if a.video:
            vdur, vfps = video_info(a.video)
            if abs(vdur - dur) > 0.5 / (vfps or fps):
                raise MixError(f"the video lasts {vdur:.3f} s but the timeline says {dur:.3f} s; mux the "
                               f"timeline that was rendered with this video")
            encoders, rejected = aac_encoders(), []
            for r in range(4):
                tried = mux(a.video, a.out, a.mux, encoders)
                rejected += tried[:-1]
                encoders = [tried[-1]["encoder"]]  # padding depends only on the length: skip rejected encoders
                ia, tpa, lraa = loudness(a.mux)
                if tpa <= a.tp or r == 3:
                    break
                ceiling -= (tpa - a.tp) + 0.1  # the codec overshot: lower the ceiling, redo the master
                g, i1, tp1, lra1, capped = master_to_target(pre, a.out, i0, tp0, a.target, ceiling, n_total,
                                                            latency_ok, g)
            kept = tried[-1]
            aac = {"file": a.mux, "encoder": kept["encoder"], "bitrate": "256k", "I": ia, "TP": tpa, "LRA": lraa,
                   "video_s": round(kept["video_s"], 6), "audio_s": round(kept["audio_s"], 6),
                   "edit_list_s": kept["edit_list_s"], "priming_samples": kept["priming_samples"],
                   "rejected": [{"encoder": t["encoder"], "audio_minus_video_ms": round((t["audio_s"] - t["video_s"]) * 1e3, 3)}
                                for t in rejected]}
        if a.stem:
            run(FF + ["-v", "error", "-y", "-i", bus, "-af", f"volume={g:.4f}dB", "-c:a", "pcm_f32le", a.stem])
        checks(chk, a, plans, music, room, has_bed and bedw, g, lra1, dur, n_total)
    shaved = max(0.0, tp0 + g - ceiling)
    report(a, tl, dur, fps, plans, music, layers, i0, tp0, g, i1, tp1, lra1, ceiling, shaved, aac, capped, chk)
    ok = abs(i1 - a.target) <= 0.5 and tp1 <= a.tp and (aac is None or (aac["TP"] <= a.tp and abs(aac["I"] - a.target) <= 0.5))
    return 0 if ok else 1


def checks(chk, a, plans, music, room, bedw, g, lra, dur, n_total):
    """Cue margins over the music bed, gaps in the bed, the audio's end and width (spec S21, S22), on the files
    as written: the tapped bed at its premaster level (silence judged at the master gain g), and the master."""
    lines, need, live = chk["lines"], chk["need"], [p for p in plans if not p.get("skip")]
    if music and bedw:
        # Shown rounded down to 0.1 LU, so the printed margin plus the printed fix always reaches the need.
        ms = [(p, math.floor(m * 10) / 10 if math.isfinite(m) else None) for p, m in cue_margins(plans, bedw, n_total)]
        chk["rec"]["margins_lu"] = {p["id"]: m for p, m in ms}
        for p, m in ms:
            if m is not None and m < need:
                lines.append(("WARN", f"cue {p['id']} sits {abs(m):.1f} LU {'over' if m >= 0 else 'under'} the bed "
                                      f"({chk['reg']} needs {need:g}): lower the bed by {math.ceil(need - m):g} dB "
                                      f"or drop it"))
    if bedw:
        b, bed = decode(bedw), music or room
        span = (bed["start"] + bed["fade_in"], bed["end"] - bed["fade_out"])
        for t0, n in silent_runs(b, int(span[0] * SR), int(span[1] * SR), 10 ** ((SILENT_DBFS - g) / 20)):
            lines.append(("WARN", f"the {'music bed' if music else 'room tone'} drops to digital silence for "
                                  f"{n:.2f} s at {t0:.2f} s: a planned bed never stops mid-film"))
    m = decode(a.out)
    end = audio_end(m, 10 ** (SILENT_DBFS / 20))
    chk["rec"]["audio_end_s"] = round(end / SR, 4)
    if n_total - end > GAP_S * SR:
        lines.append(("WARN", f"the audio ends {(n_total - end) / SR:.2f} s before the picture (silent from "
                              f"{end / SR:.2f} s of {dur:g} s): carry a sound, the bed or room tone to the end"))
    lines.append(("NOTE", f"loudness range {lra:.1f} LU (LRA)"))
    L, R = m[0::2], m[1::2]
    ll, rr, lr = (sum(map(operator.mul, x, y)) for x, y in ((L, L), (R, R), (L, R)))
    corr = lr / math.sqrt(ll * rr) if ll > 0 and rr > 0 else 1.0
    chk["rec"]["lr_correlation"] = round(corr, 4)
    if corr > MONO_CORR and any(p["pan"] for p in live):
        lines.append(("NOTE", f"near-mono master: left-right correlation {corr:.3f} although cues are panned"))


def report(a, tl, dur, fps, plans, music, layers, i0, tp0, g, i1, tp1, lra1, ceiling, shaved, aac, capped, chk):
    room, own = any(p.get("room") for p in layers), [p for p in layers if not p.get("room")]
    n_lay = sum(not p.get("skip") for p in own)
    print(f"timeline {a.timeline}: {dur:g} s at {fps:g} fps, {sum(not p.get('skip') for p in plans)} cues"
          + (f", {n_lay} layer{'s' if n_lay != 1 else ''}" if own else "")
          + (f", music {music['file']}" if music else ", no music") + (", room tone" if room else "")
          + f"; register {chk['reg']}")
    print(f"  {'cue':<14} {'sound':<16} {'t (s)':>8} {'anchor (s)':>18} {'start (s)':>10} {'lead':>8} "
          f"{'gain':>6} {'pan':>5}")
    for p in plans:
        if p.get("skip"):
            print(f"  {p['id'][:14]:<14} {os.path.basename(str(p['sound']))[:16]:<16} {p['t']:8.3f}  {p['note']}")
            continue
        print(f"  {p['id'][:14]:<14} {os.path.basename(str(p['sound']))[:16]:<16} {p['t']:8.3f} "
              f"{p['kind'] + ' ' + format(p['anchor'], '.4f'):>18} {p['start']:10.4f} {p['lead']:6.0f}ms "
              f"{p['gain']:6.1f} {p['pan']:+5.2f}" + (f"  {p['note']}" if p["note"] else ""))
    if layers:
        print(f"  {'layer':<14} {'sound':<16} {'plays (s)':>15} {'gain':>6} {'pan':>5}  fades, ducking "
              f"(own bus, not in the SFX stem)")
    for p in layers:
        if "hits" in p:
            names = p["sound"] if isinstance(p["sound"], list) else [p["sound"]]
            label = os.path.basename(str(names[0])) + (f" +{len(names) - 1}" if len(names) > 1 else "")
            head = f"  {p['id'][:14]:<14} {label[:16]:<16}"
            if p.get("skip"):
                print(f"{head} {p['note']}")
                continue
            ts = [h["t"] for h in p["hits"]]
            print(f"{head} {p['on']:7.3f}-{p['end']:<7.3f} {p['gain']:6.1f} {p['pan']:+5.2f}  "
                  + (f"{len(ts)} hits at {min(ts):.3f}-{max(ts):.3f} s" if len(ts) > 1 else f"1 hit at {ts[0]:.3f} s")
                  + (f", level +/-{p['vary']:g} dB" if p["vary"] else "") + ", "
                  + (f"ducks up to {p['duck_db']:g} dB" if p["duck_db"] > 0 else "no ducking")
                  + (f"  {p['note']}" if p["note"] else ""))
            continue
        head = f"  {p['id'][:14]:<14} {os.path.basename(str(p['sound']))[:16]:<16}"
        if p.get("skip"):
            print(f"{head} {p['note']}")
            continue
        print(f"{head} {p['on']:7.3f}-{p['end']:<7.3f} {p['gain']:6.1f} {p['pan']:+5.2f}  "
              f"{p['fade_in']:g}/{p['fade_out']:g} s, "
              + (f"ducks up to {p['duck_db']:g} dB" if p["duck_db"] > 0 else "no ducking")
              + (f"  {p['note']}" if p["note"] else ""))
    if music:
        print(f"  music: gain {music['gain']:+.1f} dB, {music['start']:g}-{music['end']:.3f} s from offset "
              f"{music['offset']:g} s, fades {music['fade_in']:g}/{music['fade_out']:g} s, ducks up to "
              f"{music['duck_db']:g} dB under the cues")
        if music["note"]:
            print(f"WARN {music['note']}")
    print(f"premaster {i0:7.2f} LUFS  TP {tp0:+6.2f} dBTP  (TP {tp0 - i0:.1f} dB above I; the limiter shaves "
          f"{shaved:.1f} dB off the loudest peaks)")
    print(f"master    {i1:7.2f} LUFS  TP {tp1:+6.2f} dBTP  LRA {lra1:.1f} LU  (target {a.target:g} LUFS, "
          f"TP <= {a.tp:g}; gain {g:+.2f} dB, limiter ceiling {ceiling:.2f} dBFS)")
    soft = chk["reg"] != "energetic"  # calm and neutral: lower the loudest cues, never raise or add a bed
    if capped:
        print(f"WARN {a.target:g} LUFS needs more than {MAX_SHAVE_DB:g} dB of peak limiting: the loudest peaks sit far "
              f"above the average level. The gain was held at {g:+.1f} dB ({i1:.1f} LUFS). Lower the loudest cues, "
              + ("or accept this level" if soft else "add a bed or longer sounds, or accept this level"))
    elif shaved > WARN_SHAVE_DB:
        print(f"WARN the limiter shaves up to {shaved:.1f} dB off the loudest peaks, which flattens hits; lower "
              f"the loudest cue gains" + ("" if soft else " or raise the quieter material or the bed"))
    if abs(i1 - a.target) > 0.5 or tp1 > a.tp:
        print("WARN master missed the loudness or true-peak target")
    for level, text in chk["lines"]:
        print(f"{level} {text}")
    print(f"wrote {a.out} ({int(round(dur * SR))} samples = {dur:g} s, 48 kHz stereo 24-bit)")
    if a.stem:
        print(f"wrote {a.stem} (cue bus only, no music or layers; at the master gain, before the limiter; "
              f"32-bit float)")
    if aac:
        d = (aac["audio_s"] - aac["video_s"]) * 1000
        prime = (f"the edit list skips {aac['priming_samples']} priming samples" if aac["priming_samples"] is not None
                 else "no audio edit list, so the encoder priming plays")
        print(f"wrote {aac['file']}: {aac['encoder']} {aac['bitrate']} -> {aac['I']:.2f} LUFS, TP {aac['TP']:+.2f} dBTP; "
              f"presented video {aac['video_s']:.3f} s, audio {aac['audio_s']:.3f} s (audio - video {d:+.1f} ms; {prime})")
        for t in aac["rejected"]:
            print(f"  {t['encoder']} not kept: its edit list makes the audio {t['audio_minus_video_ms']:+.1f} ms longer than "
                  f"the video (aac_at pads to whole 1024-sample AAC frames); re-encoded with {aac['encoder']}")
        el = aac["edit_list_s"]
        off = [f"{k} {el[k]:.3f} s, ffprobe {aac[s]:.3f} s" for k, s in (("vide", "video_s"), ("soun", "audio_s"))
               if k in el and abs(el[k] - aac[s]) > 0.001]
        if off:
            print("WARN the edit lists and ffprobe disagree on presented duration: " + "; ".join(off))
        if aac["TP"] > a.tp:
            print("WARN true peak after AAC encoding is above the target")
        if abs(d) > 1.0:
            print("WARN the presented audio and video durations differ by more than 1 ms")
    rec = {"out": a.out, "duration": dur, "register": chk["reg"], "target_lufs": a.target, "tp_max_dbtp": a.tp,
           "premaster_I": i0, "premaster_TP": tp0, "gain_db": round(g, 3),
           "I": i1, "TP": tp1, "LRA": lra1, "ceiling_dbfs": round(ceiling, 3), "shaved_db": round(shaved, 2),
           "capped": capped,
           "aac": aac, "stem": a.stem,
           "cues": [{"id": p["id"], "t": p["t"], "anchor": round(p["anchor"], 6), "anchor_kind": p["kind"],
                     "start": round(p["start"], 6)} for p in plans if not p.get("skip")]}
    if layers:
        rec["layers"] = [{"id": p["id"], "sound": p["sound"], "on": round(p["on"], 6), "end": round(p["end"], 6),
                          "gain_db": p["gain"], "pan": p["pan"], "duck_db": p["duck_db"], "vary_db": p["vary"],
                          "hits": [{"t": h["t"], "start": round(h["start"], 6), "gain_db": round(h["gain"], 4)}
                                   for h in p["hits"]]} if "hits" in p else
                         {"id": p["id"], "sound": p["sound"], "on": round(p["on"], 6), "end": round(p["end"], 6),
                          "gain_db": p["gain"], "pan": p["pan"], "fade_in": round(p["fade_in"], 6),
                          "fade_out": round(p["fade_out"], 6), "duck_db": p["duck_db"]}
                         for p in layers if not p.get("skip")]
    rec.update(chk["rec"])
    print(json.dumps(rec))


def main(argv=None):
    # The report quotes paths and cue ids stdout may not encode (a lone surrogate, CJK on a cp1252 pipe): escape them,
    # so printing never raises after the mix is written and the exit status stays the mix's
    sys.stdout.reconfigure(errors="backslashreplace")
    ap = argparse.ArgumentParser(prog="mix.py", description=__doc__.split("\n\n")[0],
                                 epilog=__doc__.split("\n\n", 2)[2], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("timeline", help="timeline JSON (render.mjs writes <out>.timeline.json)")
    ap.add_argument("--kit", help="folder with kit.json from `sfx.py kit` (needed when cues, layers, or music "
                                  "name kit sounds)")
    ap.add_argument("--out", required=True, help="mastered WAV to write")
    ap.add_argument("--stem", help="also write the SFX stem here (the cue bus only: no music, no layers)")
    ap.add_argument("--target", type=float, help="integrated loudness, LUFS (default: the timeline register's "
                                                 "target in registers.json)")
    ap.add_argument("--tp", type=float, help="true-peak ceiling, dBTP (default: the register's, registers.json)")
    ap.add_argument("--video", help="picture to mux with (its video stream is copied)")
    ap.add_argument("--mux", help="output video with the mix as AAC (needs --video)")
    a = ap.parse_args(argv)
    if bool(a.video) != bool(a.mux):
        fail("--video and --mux go together")
    if a.target is not None and not -40.0 <= a.target <= -5.0:
        fail("--target must be between -40 and -5 LUFS")
    if a.tp is not None and not -9.0 <= a.tp <= 0.0:
        fail("--tp must be between -9 and 0 dBTP")
    if a.video and not os.path.isfile(a.video):
        fail(f"--video {a.video} does not exist")
    for opt, path, exts in (("--out", a.out, (".wav",)), ("--stem", a.stem, (".wav",)),
                            ("--mux", a.mux, (".mp4", ".mov", ".m4v"))):
        if path and not path.lower().endswith(exts):
            fail(f"{opt} must end with {' or '.join(exts)}")
    try:
        return mix(a)
    except MixError as e:
        fail(str(e))


if __name__ == "__main__":
    sys.exit(main())
