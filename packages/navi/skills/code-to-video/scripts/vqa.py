#!/usr/bin/env python3
"""vqa.py - measurable QA for a rendered video: delivery probe, motion, sound sync, loudness, review images, and the
review rounds (boards with codes, reviewer prompts, the findings ledger, the delivery gate).
Python 3.9+ standard library + ffmpeg/ffprobe on PATH. Exit 0 = no FAIL (gate: READY), 1 = at least one FAIL (gate:
NOT READY), 2 = refused (a round that may not start yet: the line names the file and what it lacks), 3 = tool error.

  pack     VIDEO --out DIR [--timeline T.json] [--sfx-stem STEM.wav] [--kit DIR] [--reference REF.mp4]
           [--kind mp4|alpha|gif|prores] [--spec SPEC] [--picture-only] [--max-hold-share SHARE]
           [--register calm|neutral|energetic] [--format FORMAT] [--no-vision]
           runs everything -> DIR/board.png (open first), summary.md, sheet.png, timeline.png, bursts/, phone/,
           metrics.json (+ sbs.png, reference-timeline.png with --reference). With DIR = qa/vN in a work folder (the
           parent of qa/ holding brief.txt and .c2v/state.json) it first refuses (exit 2) until looking is done (S15),
           then also writes the reviewer copy blind/ (board.png, bursts/, phone/, prompt.txt) and, while High or Medium
           findings are open, recheck/ (recheck-2/ ...), and prints each reviewer's muse line and the subagent fallback
  pack     --preflight --out qa/vN [--no-vision]   only S15's checks for that round: exit 0, or 2 with the refusal
  board    VIDEO --out DIR [--timeline T] [--tier S|R|M|L|LF] [--kind K] [--no-vision]   one board and metrics.json
           without the pack (the prototype: --out qa/proto); at tier L or LF also its reviewer copy, prompt and line;
           a round qa/vN is refused (exit 2): a round is a pack
  ledger   WORK                                    rebuild WORK/qa/ledger.json from the replies and packs only (S14)
  gate     WORK [--final FILE] [--no-blind REASON] [--no-vision]   READY or NOT READY, and the report block (S19)
  probe    VIDEO [--kind mp4] [--spec none]         codec, pix_fmt, CFR/VFR, color tags, faststart, alpha, audio format;
           with a --spec, loudness too
  motion   VIDEO [--timeline T | --exempt 0-1.5,10-12] [--register R] [--format F] [--max-hold-share SHARE] [--json]
           the frozen share, each hold against its need, still runs, events, judder, flashes
  layout   VIDEO|STILL.png ... [--timeline T] [--kind mp4|alpha] [--json]   empty edge bands, balance and subject size
           on 12 frames, or on render.mjs --stills images
  onsets   FILE [--af highpass=f=800]              audio onsets (time, peak, level); FILE may be a WAV stem
  sync     VIDEO [--timeline T] [--sfx-stem STEM] [--kit DIR]   sound vs picture offsets in ms and frames
  loudness VIDEO [--spec SPEC] [--timeline T] [--target LUFS] [--tp dBTP] [--normalize OUT.mp4]   integrated LUFS,
           LRA, true peak
  sheet    VIDEO OUT.png [--cells 12] [--timeline T]            contact sheet, time printed under every cell
  bursts   VIDEO OUTPREFIX [--at 3.0,6.0] [--timeline T]       5 consecutive frames around each event
  phone    VIDEO OUTDIR [--at 1.5,4] [--timeline T]            480 px wide frames (phone feed size)
  timeline VIDEO OUT.png [--timeline T] [--sfx-stem STEM]       strip: motion | visual events | audio | plan
  sbs      A B OUT.png [--height 440]              A, B = image file or video@seconds, side by side at one height
  doctor                                           ffmpeg/ffprobe versions and required filters
  selftest [--keep DIR]                            run maintainers/tests/vqa/test_vqa.py where it exists (not shipped)

--kind sets what the delivery probe expects: mp4 = H.264 High yuv420p, BT.709 tags, AAC (T8; default); alpha = ProRes
4444 .mov or VP9 .webm with a real alpha channel; gif = a palette GIF, no sound; prores = a ProRes 422 HQ master with
PCM. --spec sets only the loudness target (S17): calm, neutral or energetic judges against that register's accepted
range; auto (the default of pack and loudness) against the timeline's register, neutral when it names none; web, voice,
ebu or atsc against that destination, which wins when the brief names it; none skips loudness and keeps every
delivery check. Every range and true-peak ceiling is in scripts/registers.json.
Pacing: the frozen share is the binding measure, taken on the timeline's content_pass when it has one: frozen and
repeating (idle) frames, less those in alive holds of a kind the style card allows, beat rests and the final still's
poster allowance. Its WARN and FAIL lines come from scripts/registers.json by register and format (--register and
--format serve a film whose timeline names neither), with the hook rule for energetic, teaser and sting films and a
seam check for loops; an alpha overlay skips it. Declared holds neither exempt frames nor add to the share: an
undeclared still run WARNs, and holds over registers.json's share of the film (or --max-hold-share) are a NOTE. Each
hold's maximum comes from its need: read text at its reading speed, a chart's labelled values, a logo; twice that, a
breath the register's cap, the final hold the larger of the poster allowance and twice its need.
Timeline style declarations: "steps": [{start, end, every | rate, label}] (planned stepped animation: every = frames
each drawing is held, rate = drawings per second) and "effects": [{start, end, kind, label}] (flash, shake, glitch or
flicker, each at most 0.5 s; any other kind is a FAIL, since texture belongs to the style card) keep their repeats out
of the judder and still-run checks and their spikes out of the unplanned events. More than 3 full-frame flashes in any
one second FAIL whatever the timeline declares (WCAG 2.3.1). "signature": true on an event or cue: always burst.
Sync PASSes only on cues confirmed against a detected picture change (a planned land, transition or wave by its own
moment): one on time against its plan alone is placed to plan, not verified, and WARNs when the picture does not show
its planned event; a cue off, missing, or masked still withholds the PASS; a cue tied to the peak of a move with no
speed peak WARNs.
Review rounds: each board carries a four-character code drawn only as pixels, the reviewer copy a different one;
metrics.json keeps salted hashes of them. review.md opens with the author board's code (NO VISION under --no-vision),
then names every open High and Medium finding; a reviewer's reply follows its prompt.txt, opens CODE <the reviewer
board's code> and ends END <the number of finding lines>. ledger reads only reply files and packs; gate checks the
delivered file, its pack, loudness, review.md, the latest reply, open Highs, the tier's rounds (new.py's record), the
plan's starred lines, the pinned register, demands and placeholders.

FAIL blocks delivery (SKILL Q6). WARN needs a fix or a written reason. N/A: the check does not apply.
Numbers point at problems; eyes and ears decide whether they are problems.
"""
import sys

sys.dont_write_bytecode = True  # spec 2.0: the skill folder is a read-only snapshot
import argparse, hashlib, hmac, itertools, json, math, operator, os, re, secrets, shlex, shutil  # noqa: E402
import statistics, struct, subprocess, tempfile, uuid, zlib  # noqa: E402
from array import array  # noqa: E402

FF = ["ffmpeg", "-nostdin", "-hide_banner", "-nostats"]
# Calibrated on synthetic clips with known answers (see the selftest); change only with new measurements.
THR_STILL = 0.1      # near-static: 0.2 s centred mean of 320 px gray MAD (0-255 full range, 30-fps-equivalent)
MIN_RUN = 0.5        # list still runs from this length (s)
HOLD_SLACK = 0.25    # a still run counts as planned if it overlaps a hold and < this much lies outside all holds
# Frozen frames (spec S9.2-3); register and format numbers (limits, poster, hook, alive, rests) live in registers.json
FROZEN_E = 0.05      # frozen: 0.2 s centred mean of motion energy (320 px, Y + half of U and V, 30-fps-equivalent) ...
LOCAL_LEVELS, LOCAL_PX = 24, 50  # ... and fewer than 50 full-resolution pixels changing by more than 24 levels
IDLE_LAG, IDLE_RUN = (0.4, 2.0), 1.5  # idle: the picture matches itself at a lag in this range (s), over 1.5 s or more
THUMB_W = 32         # width of the Y thumbnails that find idle candidates (a thumbnail never differs more than its frame)
MOVING = 0.3         # a frame pair differing by more than this (30-fps-equivalent mean) is moving: the judder check's
                     # line, which S11's event kinds share
ALIVE_KINDS = ("boil", "idle", "ambient", "live-ui", "camera", "environment")  # S9.4, card motion.holds.alive
HOLD_KINDS = ("read", "chart", "logo", "breath")  # S10: what a hold is for
EFFECT_KINDS, EFFECT_MAX = ("flash", "shake", "glitch", "flicker"), 0.5  # S16: what effects excuse, and how long
READ_MOVING = 0.1    # S16: read text in an alive hold's read_box moves when its box moves on more than this share of the
                     # hold (a brief settle at the hold's edges is not moving read text)
EARLY_FAIL, LATE_FAIL = 0.045, 0.125  # ITU-R BT.1359 detectability: audio leading / lagging
REPEAT_MIN = 0.100   # rapid repeats closer than this fuse into a buzz
EVENT_MATCH = 0.1    # planned event <-> detected visual event tolerance (s)
EDGE_MIN = 4         # judder needs moving edges: per-pixel changes of this many levels (a quantized fade moves 1-3)
FLASH_DELTA, FLASH_DARK = 0.1, 0.8  # WCAG 2.3.1 general flash: a 10% swing of relative luminance, darker end under 0.8
FLASH_MAX = 3        # flashes (pairs of opposing swings) allowed in any one second, whatever the timeline declares
CLEAR_916 = (65 / 1080, 269 / 1920, 900 / 1080, 1248 / 1920)  # the cross-app clear box of a 9:16 frame (references/delivery.md) (x0, y0, x1, y1)


class ToolError(Exception):
    """A problem with the inputs or the toolchain (exit 3), as opposed to a QA finding."""


def run(cmd, cwd=None, binary=False):
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=not binary)
    except FileNotFoundError:
        raise ToolError(f"{cmd[0]} not found on PATH (install ffmpeg, e.g. 'brew install ffmpeg' or 'apt install ffmpeg')")
    if p.returncode != 0:
        err = p.stderr.decode(errors="replace") if binary else p.stderr
        last = [x for x in err.strip().splitlines() if x.strip()][-1:] or ["no message"]
        raise ToolError(f"{cmd[0]} failed ({p.returncode}): {last[0].strip()[:300]}")
    return p


def fnum(x, default=0.0):
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


def frac(s):
    try:
        n, d = str(s).split("/")
        return float(n) / float(d) if float(d) else 0.0
    except (ValueError, AttributeError):
        return 0.0


def ffprobe_json(path):
    if not os.path.isfile(path):
        raise ToolError(f"no such file: {path}")
    try:
        return json.loads(run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path]).stdout)
    except ToolError as e:
        raise ToolError(f"cannot read {path}: {e}")


def read_meta(path, key):
    """Parse ffmpeg metadata=print output into [(pts_time, value)]; whole tokens through float() (ffmpeg prints %g)."""
    rows, t = [], None
    with open(path) as fh:
        for line in fh:
            m = re.search(r"pts_time:(\S+)", line)
            if m:
                t = float(m.group(1)); continue
            if key in line and t is not None:
                v = line.split("=", 1)[1].strip()
                rows.append((t, float(v) if v not in ("-inf", "inf", "nan") else -120.0))
    return rows


class Media:
    """ffprobe facts for one file (video, or an audio-only stem)."""

    def __init__(self, path):
        self.path = path
        self.info = ffprobe_json(path)
        self.fmt = self.info.get("format", {})
        st = self.info.get("streams", [])
        self.v = next((s for s in st if s.get("codec_type") == "video"
                       and not s.get("disposition", {}).get("attached_pic")), None)
        self.a = next((s for s in st if s.get("codec_type") == "audio"), None)
        # picture length when there is a picture (an AAC tail can make the container longer), else the container's
        self.duration = fnum((self.v or {}).get("duration")) or fnum(self.fmt.get("duration")) or fnum((self.a or {}).get("duration"))
        if self.v:
            self.w, self.h = int(self.v.get("width", 0)), int(self.v.get("height", 0))
            sar = self.v.get("sample_aspect_ratio", "1:1")
            sar = frac(sar.replace(":", "/")) if sar not in ("0:1", "N/A") else 1.0
            self.dw = int(round(self.w * (sar or 1.0)))  # display width
            self.fps = frac(self.v.get("avg_frame_rate")) or frac(self.v.get("r_frame_rate")) or 30.0
        else:
            self.w = self.h = self.dw = 0
            self.fps = 0.0

    def frame_dur(self):
        return 1.0 / (self.fps or 30.0)


# ---------------------------------------------------------------- registers.json and the shipped style cards
HERE = os.path.dirname(os.path.abspath(__file__))
_CACHE = {}


REG_SECTIONS = ("registers", "formats", "destinations", "pacing", "holds", "precedence")  # what vqa.py reads of it


def registers():
    """scripts/registers.json beside this file: the one copy of every register and format number (spec S26). Missing,
    not JSON, or without a section vqa.py reads: a tool error naming the file."""
    if "reg" not in _CACHE:
        path = os.path.join(HERE, "registers.json")
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except OSError as e:
            raise ToolError(f"cannot read {path} (the skill's register and format numbers): {e.strerror}")
        except ValueError as e:
            raise ToolError(f"{path} is not valid JSON: {e}")
        lack = [k for k in REG_SECTIONS if not isinstance(doc, dict) or not isinstance(doc.get(k), (dict, list))]
        if lack:
            raise ToolError(f"{path} has no {', '.join(lack)} section: restore the skill's registers.json")
        _CACHE["reg"] = doc
    return _CACHE["reg"]


def shipped_cards():
    """{id: the card's JSON block} from scripts/style-cards.md beside this file (spec S27: one '## <id>: ...' section
    per card); empty when the file is absent. Only a shipped card grants a full waiver (S9.4 alive kinds, S9.5 beat
    rests, S12 emptiness, balance and dominant minimum); the film's own declarations are capped."""
    if "cards" not in _CACHE:
        path, cards = os.path.join(HERE, "style-cards.md"), {}
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            text = ""
        for sec in re.split(r"^## ", text, flags=re.M)[1:]:
            cid = sec.split(":", 1)[0].strip()
            blk = re.search(r"^```json\s*\n(.*?)^```", sec, re.M | re.S)
            if not blk:
                continue
            try:
                card = json.loads(blk.group(1))
            except ValueError as e:
                raise ToolError(f"{path}: card '{cid}' has a JSON block that does not parse ({e}); run new.py card-lint")
            if isinstance(card, dict):
                cards[cid] = card
                _CACHE.setdefault("card_text", {})[cid] = sec  # its prose: the blind prompt quotes the Reviewer line
        _CACHE["cards"] = cards
    return _CACHE["cards"]


def card_get(card, path, default=None):
    """A value at a dotted path in a card's JSON, or default."""
    for k in path.split("."):
        if not isinstance(card, dict) or k not in card:
            return default
        card = card[k]
    return card


def film_settings(tl, register=None, fmt=None):
    """(register, format, notes): the timeline's own register and format; --register and --format serve a film whose
    timeline does not pin them; a missing register reads as neutral with a NOTE (S9.10)."""
    R, notes = registers(), []
    out = {}
    for key, flag, allowed in (("register", register, R["registers"]), ("format", fmt, R["formats"])):
        own = tl.get(key) if tl else None
        if own and flag and flag != own:
            raise ToolError(f"the timeline pins {key} '{own}'; --{key} {flag} serves only a film whose timeline has no "
                            f"{key}")
        v = own or flag
        if v is not None and v not in allowed:
            raise ToolError(f"{key} '{v}' is not one of {', '.join(allowed)} (scripts/registers.json)")
        out[key] = v
    if not out["register"]:
        out["register"] = "neutral"
        notes.append("no register in the timeline or --register: read as neutral (S9.10)")
    return out["register"], out["format"], notes


def frozen_lines(reg, fmt):
    """(WARN %, FAIL %, provisional) of the frozen share for a register and format (S9.7)."""
    R = registers()
    f, add = R["registers"][reg]["frozen_share_pct"], R["formats"].get(fmt or "", {}).get("frozen_share_add_pct", 0)
    return f["warn"] + add, f["fail"] + add, bool(f.get("fail_provisional"))


def poster_allowance(dur, fmt):
    """P (S9.6): how much of the film's final still run is excused; 0 for formats without a poster."""
    R = registers()
    if R["formats"].get(fmt or "", {}).get("poster") is False:
        return 0.0
    row = next(r for r in R["pacing"]["poster_allowance"] if r["film_up_to_s"] is None or dur <= r["film_up_to_s"] + 1e-6)
    return min(row["s"], row["share"] * dur) if "share" in row else row["s"]


def hook_rule(reg, fmt, dur):
    """(applies, window s, shortest run s) of the hook rule (S9.8): energetic, or a teaser or sting in any register."""
    R = registers()
    h = R["pacing"]["hook_rule"]
    on = bool(R["registers"][reg]["hook"] or R["formats"].get(fmt or "", {}).get("hook"))
    return on, min(h["window_s"], h["window_share"] * dur), h["run_min_s"]


# ---------------------------------------------------------------- timeline JSON and intervals
def load_timeline(path):
    """Read <out>.timeline.json (render.mjs schema). Times are seconds in the clip (render.mjs already shifts --range)."""
    if not path:
        return None
    try:
        with open(path) as fh:
            tl = json.load(fh)
    except OSError as e:
        raise ToolError(f"cannot read timeline {path}: {e.strerror}")
    except ValueError as e:
        raise ToolError(f"timeline {path} is not valid JSON: {e}")
    if not isinstance(tl, dict):
        raise ToolError(f"timeline {path}: top level must be an object")

    def items(key):
        v = tl.get(key) or []
        if not isinstance(v, list):
            raise ToolError(f"timeline {path}: '{key}' must be a list")
        return v

    def num(obj, k, where):
        try:
            return float(obj[k])
        except (KeyError, TypeError, ValueError):
            raise ToolError(f"timeline {path}: {where} needs a numeric '{k}'")

    holds, events, cues, scenes = [], [], [], []
    for i, h in enumerate(items("holds")):
        s, e = num(h, "start", f"holds[{i}]"), num(h, "end", f"holds[{i}]")
        if e <= s:
            raise ToolError(f"timeline {path}: holds[{i}] ends before it starts")
        hold = {"start": s, "end": e, "purpose": str(h.get("purpose", "") or "")}
        # what the hold is for (S8, S10): kind, the read text render.mjs measured and its per-script counts, the need it
        # computed; alive kind and read_box [x0, y0, x1, y1] in the timeline's px (S9.4, S16)
        if h.get("kind") is not None:
            if h["kind"] not in HOLD_KINDS:
                raise ToolError(f"timeline {path}: holds[{i}] kind '{h['kind']}' is not one of {', '.join(HOLD_KINDS)}")
            hold["kind"] = h["kind"]
        for k in ("read", "read_text"):
            if isinstance(h.get(k), str) and h[k].strip():
                hold[k] = h[k]
        if isinstance(h.get("counts"), dict):
            hold["counts"] = {k: fnum(v) for k, v in h["counts"].items() if isinstance(v, (int, float))}
        if h.get("need") is not None:
            hold["need"] = num(h, "need", f"holds[{i}]")
        if h.get("chart") is not None:
            hold["chart"] = h["chart"]
        if h.get("logo") is True:
            hold["logo"] = True
        if h.get("alive") is not None:
            if h["alive"] not in ALIVE_KINDS:
                raise ToolError(f"timeline {path}: holds[{i}] alive '{h['alive']}' is not one of {', '.join(ALIVE_KINDS)}")
            hold["alive"] = h["alive"]
        if h.get("read_box") is not None:
            b = h["read_box"]
            if not (isinstance(b, list) and len(b) == 4 and all(numeric(x) for x in b) and b[2] > b[0] and b[3] > b[1]):
                raise ToolError(f"timeline {path}: holds[{i}] read_box must be [x0, y0, x1, y1] in px, x1 > x0, y1 > y0")
            hold["read_box"] = [float(x) for x in b]
        holds.append(hold)
    for i, ev in enumerate(items("events")):  # "signature": true marks the signature moment: the pack always bursts it
        events.append({"t": num(ev, "t", f"events[{i}]"), "kind": str(ev.get("kind", "event") or "event"),
                       "label": str(ev.get("label", "") or ""), "signature": ev.get("signature") is True})
    for i, c in enumerate(items("cues")):
        # without its own "anchor", mix.py places a kit sound by kit.json's anchor: apply_kit() resolves it the same way
        set_ = c.get("anchor") is not None
        cues.append({"id": str(c.get("id") or f"cue{i + 1}"), "t": num(c, "t", f"cues[{i}]"),
                     "sound": str(c.get("sound", "") or ""), "anchor": c["anchor"] if set_ else "peak", "anchor_set": set_,
                     "signature": c.get("signature") is True})
        # the move the cue is tied to and where on it (S8, S29 cue(sound, move, at)): 'peak', 'land' or 'start'
        if c.get("move") is not None:  # lib/film.js's cue() writes move_anchor; 'at' is the older name
            at = c.get("move_anchor", c.get("at"))
            if at not in ("peak", "land", "start"):
                raise ToolError(f"timeline {path}: cues[{i}] names move '{c['move']}' but its move_anchor is not peak, "
                                "land or start")
            cues[-1].update(move=str(c["move"]), at=at)
    for i, sc in enumerate(items("scenes")):
        scenes.append({"id": str(sc.get("id") or f"scene{i + 1}"), "start": num(sc, "start", f"scenes[{i}]"),
                       "end": num(sc, "end", f"scenes[{i}]"), "label": str(sc.get("label", "") or "")})
    # style declarations: planned stepped animation (each drawing held `every` frames: 2 on twos) and planned
    # frame-to-frame variation (flicker, shake, boil, glitch); the motion checks read them, flash safety ignores them
    steps, effects = [], []
    for key, out_ in (("steps", steps), ("effects", effects)):
        for i, x in enumerate(items(key)):
            s, e = num(x, "start", f"{key}[{i}]"), num(x, "end", f"{key}[{i}]")
            if e <= s:
                raise ToolError(f"timeline {path}: {key}[{i}] ends before it starts")
            sp = {"start": s, "end": e, "label": str(x.get("label", "") or "")}
            if key == "steps" and x.get("every") is None and x.get("rate") is not None:  # drawings per second (S16)
                rt = num(x, "rate", f"steps[{i}]")
                if rt <= 0:
                    raise ToolError(f"timeline {path}: steps[{i}] 'rate' is drawings per second, above 0")
                sp["rate"] = rt
            elif key == "steps":
                ev = num(x, "every", f"steps[{i}]")
                if ev < 1 or ev != int(ev):
                    raise ToolError(f"timeline {path}: steps[{i}] 'every' is the whole number of frames each drawing is "
                                    "held (2 on twos, 3 on threes), or give 'rate' in drawings per second")
                sp["every"] = int(ev)
            else:
                sp["kind"] = str(x.get("kind", "") or "effect")
            out_.append(sp)
    layers = []  # sound that follows the picture (mix.py layers[]): on the layer bus, listed, never sync-checked
    for i, la in enumerate(items("layers")):
        if not isinstance(la, dict) or not la.get("sound"):
            raise ToolError(f"timeline {path}: layers[{i}] needs a 'sound'")
        lid, snd = str(la.get("id", f"layer{i}")), la["sound"]
        if "times" in la:  # one hit of the sound (or of a list of sounds, cycled in order) at each time
            if not isinstance(la["times"], list):
                raise ToolError(f"timeline {path}: layers[{i}] 'times' must be a list of seconds")
            times = [num({"t": x}, "t", f"layers[{i}].times[{k}]") for k, x in enumerate(la["times"])]
            names = [str(x) for x in snd] if isinstance(snd, list) else [str(snd)]
            layers.append({"id": lid, "sound": names, "times": times, "anchor": la.get("anchor")})
        elif isinstance(snd, list):
            raise ToolError(f"timeline {path}: layers[{i}] has a list of sounds but no 'times' (one hit per time)")
        else:
            layers.append({"id": lid, "sound": str(snd), "start": num(la, "start", f"layers[{i}]") if "start" in la else 0.0})
    moves = []  # S8: {id, start, end, peak}: peak is the time of the move's analytic speed maximum, null at constant speed
    for i, mv in enumerate(items("moves")):
        if not isinstance(mv, dict) or not mv.get("id"):
            raise ToolError(f"timeline {path}: moves[{i}] needs an 'id'")
        if mv.get("peak") is not None and not numeric(mv["peak"]):
            raise ToolError(f"timeline {path}: moves[{i}] 'peak' is the time of the move's speed peak in s, or null")
        moves.append({"id": str(mv["id"]), "start": fnum(mv.get("start"), None), "end": fnum(mv.get("end"), None),
                      "has_peak": "peak" in mv, "peak": float(mv["peak"]) if mv.get("peak") is not None else None,
                      "land": fnum(mv.get("land"), None), "signature": mv.get("signature") is True})
    beats, odd_beats = tl.get("beats"), False  # S9.5: {bpm, t0}, the beat grid landings snap to
    if beats is not None:
        bpm, t0 = (fnum(beats.get("bpm"), None), fnum(beats.get("t0"), None)) if isinstance(beats, dict) else (None, None)
        beats = {"bpm": bpm, "t0": t0} if bpm is not None and t0 is not None and 0 < bpm <= 600 else None
        odd_beats = beats is None
    style = tl.get("style")
    style = str(style.get("id") or "") if isinstance(style, dict) else str(style or "")
    cp = tl.get("content_pass")  # S6: the capture with ambient layers hidden, beside the timeline unless absolute
    cp = os.path.join(os.path.dirname(os.path.abspath(path)), cp) if isinstance(cp, str) and cp else None
    content_alive = []  # S6: spans where a capped content layer changes; the content pass hides it, so S9 counts them alive
    for i, x in enumerate(items("content_alive")):
        s, e = num(x, "start", f"content_alive[{i}]"), num(x, "end", f"content_alive[{i}]")
        if e > s:
            content_alive.append((s, e))
    out = {}
    for key in ("register", "format"):
        v = tl.get(key)
        if v is not None and not isinstance(v, str):
            raise ToolError(f"timeline {path}: '{key}' must be a string")
        out[key] = v or None
    seams, bounds = [], [sc["start"] for sc in sorted(scenes, key=lambda x: x["start"])][1:]
    for i, x in enumerate(items("seams")):  # S18: the device that joins two beats; untimed ones take the next boundary
        if not isinstance(x, dict) or not str(x.get("kind") or "").strip():
            raise ToolError(f"timeline {path}: seams[{i}] needs a 'kind' (the device, e.g. dissolve)")
        t = fnum(x.get("t"), None) if x.get("t") is not None else (bounds[len(seams)] if len(seams) < len(bounds) else None)
        seams.append({"kind": str(x["kind"]).strip().lower(), "t": t})
    demands = {k: [str(v) for v in tl[k]] for k in ("names", "text") if isinstance(tl.get(k), list)}
    comp = tl.get("composition")  # the film's own composition declaration (plan or run-time card): capped waivers (S12)
    return {"path": path, "fps": fnum(tl.get("fps")), "duration": fnum(tl.get("duration")),
            "width": int(fnum(tl.get("width"))), "height": int(fnum(tl.get("height"))), "range": tl.get("range"),
            "holds": sorted(holds, key=lambda x: x["start"]), "events": sorted(events, key=lambda x: x["t"]),
            "cues": sorted(cues, key=lambda x: x["t"]), "scenes": sorted(scenes, key=lambda x: x["start"]),
            "music": tl.get("music") if isinstance(tl.get("music"), dict) else None, "layers": layers,
            "steps": sorted(steps, key=lambda x: x["start"]), "effects": sorted(effects, key=lambda x: x["start"]),
            "register": out["register"], "format": out["format"], "style": style or None,
            "composition": comp if isinstance(comp, dict) else None, "beats": beats, "content_pass": cp, "moves": moves,
            "odd_beats": odd_beats, "seams": seams, "demands": demands, "content_alive": content_alive}


def plan_spans(tl):
    """motion_data's keyword arguments from a timeline: planned holds and the steps and effects declarations."""
    return {"holds": tl["holds"], "steps": tl["steps"], "effects": tl["effects"]} if tl else {}


def read_kit(kitdir):
    """The 'sounds' object of kitdir/kit.json (sfx.py kit)."""
    path = os.path.join(kitdir, "kit.json")
    try:
        with open(path) as fh:
            sounds = json.load(fh).get("sounds")
    except OSError as e:
        raise ToolError(f"cannot read kit {path}: {e.strerror}")
    except (ValueError, AttributeError) as e:
        raise ToolError(f"kit {path} is not a kit.json from sfx.py: {e}")
    if not isinstance(sounds, dict):
        raise ToolError(f"kit {path} has no 'sounds' object: is it a kit.json from sfx.py?")
    return sounds


def apply_kit(tl, kitdir):
    """Anchor every cue without its own "anchor" the way mix.py places it: a sound kit.json lists takes its anchor_kind
    (riser = end; glitch, type-keys, bed = start; peak = loudest 10 ms; any other kind: its anchor in seconds). Returns a
    NOTE: with a kit, the cues it moved off 'peak'; without one, the cues that look like kit sounds (a bare name, no
    folder or extension) and are therefore measured at 'peak', which is wrong for a riser or a 'start' sound. A cue on a
    kit sound anchored at its peak also gets 'lead', the peak's seconds into the file (where its onset lies, for
    context_db)."""
    free = [c for c in (tl["cues"] if tl else []) if not c.get("anchor_set")]
    if kitdir:
        sounds = read_kit(kitdir)
        moved = []
        for c in tl["cues"] if tl else []:
            e = sounds.get(c["sound"])
            if not isinstance(e, dict):
                continue
            if e.get("anchor_kind") == "peak" and numeric(e.get("anchor")):
                c["lead"] = float(e["anchor"])  # its peak's seconds into the file: the sound starts that much earlier
            if c.get("anchor_set"):
                continue
            kind = e.get("anchor_kind")
            if kind in ("peak", "end", "start"):
                c["anchor"] = kind
            elif numeric(e.get("anchor")):
                c["anchor"] = float(e["anchor"])
            if c["anchor"] != "peak":
                moved.append(f"{c['id']} ({c['sound']}) = {kind if kind in ('end', 'start') else '%gs' % c['anchor']}")
        return ("anchors from kit.json (cues without their own): " + ", ".join(moved)) if moved else None
    named = [c for c in free if c["sound"] and "/" not in c["sound"] and not os.path.splitext(c["sound"])[1]]
    if not named:
        return None
    return ("cues naming kit sounds without their own \"anchor\" are measured at their loudest 10 ms ('peak'), but mix.py "
            "places them by kit.json's anchor (riser = end; glitch, type-keys, bed = start): pass --kit DIR to measure the "
            "same anchor: " + ", ".join(f"{c['id']} ({c['sound']})" for c in named[:12])
            + (f" and {len(named) - 12} more" if len(named) > 12 else ""))


def layer_spans(tl, kitdir, end_t):
    """One dict per timeline layer as mix.py plays it, cut to [0, end_t]: {id, sound, on, end, known, hits}. A continuous
    layer plays from its start for its file length (kit.json's duration, or the file's beside the timeline; to end_t
    when unknown) and has hits None. A times layer has hits = [(on, end)] per time inside the film, each with its
    sound's anchor on the time (the layer's "anchor", else kit.json's; unknown: up to 0.25 s before it)."""
    sounds = read_kit(kitdir) if kitdir and tl and tl["layers"] else {}
    base, lengths = os.path.dirname(os.path.abspath(tl["path"])) if tl else "", {}

    def length(name):  # (seconds or None, kit.json entry or None)
        e = sounds.get(name)
        if isinstance(e, dict) and numeric(e.get("duration")):
            return float(e["duration"]), e
        if name not in lengths:
            p = os.path.join(base, name)  # an absolute sound stays as is
            lengths[name] = fnum(ffprobe_json(p).get("format", {}).get("duration"), None) if os.path.isfile(p) else None
        return lengths[name], None

    out = []
    for la in (tl or {}).get("layers", []):
        if "times" not in la:
            dur, _ = length(la["sound"])
            on, end = max(0.0, la["start"]), min(end_t, la["start"] + dur) if dur else end_t
            if end > on:
                out.append({"id": la["id"], "sound": la["sound"], "on": round(on, 3), "end": round(end, 3),
                            "known": bool(dur), "hits": None})
            continue
        hits, known, anc = [], True, la.get("anchor")
        for k, t in enumerate(la["times"]):
            if not 0.0 <= t < end_t:
                continue  # mix.py skips a time outside the programme
            dur, e = length(la["sound"][k % len(la["sound"])])
            known = known and bool(dur)
            lead = (0.0 if anc == "start" else dur if anc == "end" and dur else float(anc) if numeric(anc)
                    else float(e["anchor"]) if e and numeric(e.get("anchor")) and anc in (None, "peak") else None)
            on = t - lead if lead is not None else t - min(dur or 0.25, 0.25)
            hits.append((round(max(0.0, on), 3), round(min(end_t, (t - (lead or 0.0)) + (dur or 0.25)), 3)))
        if hits:
            out.append({"id": la["id"], "sound": ", ".join(la["sound"]), "on": min(a for a, _ in hits),
                        "end": max(b for _, b in hits), "known": known, "hits": hits, "times": len(la["times"])})
    return out


def layer_windows(spans):
    """Where layer sound plays, for telling its onsets from stray sounds on the mix: each hit of a times layer."""
    return [w for s in spans for w in (s["hits"] or [(s["on"], s["end"])])]


def merge_intervals(iv):
    out = []
    for s, e in sorted(iv):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(s, e) for s, e in out]


def outside_spans(a, b, merged):
    """Parts of [a, b] not covered by the merged intervals."""
    spans, cur = [], a
    for s, e in merged:
        if e <= cur or s >= b:
            continue
        if s > cur:
            spans.append((cur, min(s, b)))
        cur = max(cur, e)
        if cur >= b:
            break
    if cur < b:
        spans.append((cur, b))
    return [(round(x, 3), round(y, 3)) for x, y in spans if y - x > 1e-6]


def parse_times(s):
    try:
        return [float(x) for x in s.split(",") if x.strip()] if s else []
    except ValueError:
        raise ToolError(f"bad time list '{s}': use seconds separated by commas, e.g. 1.5,4.2")


def parse_ranges(s):
    out = []
    for x in (s or "").split(","):
        if not x.strip():
            continue
        try:
            a, b = (float(y) for y in x.split("-"))
        except ValueError:
            raise ToolError(f"bad range '{x}': use start-end in seconds, e.g. 0-1.5,10.5-12")
        out.append({"start": a, "end": b, "purpose": "--exempt"})
    return out


# ---------------------------------------------------------------- PNG canvas with a built-in 5x7 font
_GLYPHS = {
    "A": "0E11111F111111", "B": "1E11111E11111E", "C": "0E11101010110E", "D": "1C12111111121C",
    "E": "1F10101E10101F", "F": "1F10101E101010", "G": "0E11101711110F", "H": "1111111F111111",
    "I": "0E04040404040E", "J": "0702020202120C", "K": "11121418141211", "L": "1010101010101F",
    "M": "111B1515111111", "N": "11111915131111", "O": "0E11111111110E", "P": "1E11111E101010",
    "Q": "0E11111115120D", "R": "1E11111E141211", "S": "0F10100E01011E", "T": "1F040404040404",
    "U": "1111111111110E", "V": "11111111110A04", "W": "1111111515150A", "X": "11110A040A1111",
    "Y": "1111110A040404", "Z": "1F01020408101F",
    "0": "0E11131519110E", "1": "040C040404040E", "2": "0E11010204081F", "3": "1F02040201110E",
    "4": "02060A121F0202", "5": "1F101E0101110E", "6": "0608101E11110E", "7": "1F010204080808",
    "8": "0E11110E11110E", "9": "0E11110F01020C",
    ".": "00000000000C0C", ":": "000C0C000C0C00", "-": "0000001F000000",
    "+": "0004041F040400", "/": "00010204081000", "%": "18190204081303", "(": "02040808080402",
    ")": "08040202020408", ">": "08040201020408", "<": "02040810080402", "=": "00001F001F0000",
    ",": "000000000C0408", "_": "0000000000001F", "'": "0C040800000000", "#": "0A0A1F0A1F0A0A",
    "!": "04040404040004", "?": "0E110102040004", "[": "0E08080808080E", "]": "0E02020202020E",
    "*": "0004150E150400", "&": "0C12140815120D", "@": "0E11010D15150E", '"': "0A0A0A00000000",
    "|": "04040404040404", "~": "00000815020000", " ": "00000000000000",
    "s": "00000E100E011E", "m": "00001A15151111",  # lowercase only as units after a digit: 1s never reads as 15
}
FONT = {k: [int(v[i:i + 2], 16) for i in range(0, 14, 2)] for k, v in _GLYPHS.items()}
_ASCII = {"→": "->", "←": "<-", "–": "-", "—": "-", "×": "X", "≥": ">=", "≤": "<=",
          "−": "-", "±": "+/-", "…": "...", "·": "|", "‘": "'", "’": "'", "“": '"',
          "”": '"', "°": "DEG"}


def font_text(s):
    s = "".join(_ASCII.get(ch, ch) for ch in str(s))
    parts = re.split(r"((?<=[0-9])(?:ms|s)(?![A-Za-z]))", s)
    s = "".join(x if i % 2 else x.upper() for i, x in enumerate(parts))
    return "".join(ch if ch in FONT else "?" for ch in s)


def write_png(path, w, h, px):
    stride = w * 3
    raw = b"".join(b"\x00" + bytes(px[y * stride:(y + 1) * stride]) for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                 + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


class Canvas:
    def __init__(self, w, h, bg=(255, 255, 255)):
        self.w, self.h = int(w), int(h)
        self.px = bytearray(bytes(bg) * (self.w * self.h))

    def rect(self, x0, y0, x1, y1, c):
        """Filled rectangle over [x0, x1) x [y0, y1), clipped."""
        x0, x1 = max(0, int(round(x0))), min(self.w, int(round(x1)))
        y0, y1 = max(0, int(round(y0))), min(self.h, int(round(y1)))
        if x1 <= x0 or y1 <= y0:
            return
        row = bytes(c) * (x1 - x0)
        for y in range(y0, y1):
            i = (y * self.w + x0) * 3
            self.px[i:i + len(row)] = row

    def outline(self, x0, y0, x1, y1, c, t=1):
        self.rect(x0, y0, x1, y0 + t, c); self.rect(x0, y1 - t, x1, y1, c)
        self.rect(x0, y0, x0 + t, y1, c); self.rect(x1 - t, y0, x1, y1, c)

    def vline(self, x, y0, y1, c, t=1):
        self.rect(x, y0, x + t, y1, c)

    def hdash(self, x0, x1, y, c, dash=6, gap=5):
        x = x0
        while x < x1:
            self.rect(x, y, min(x + dash, x1), y + 1, c); x += dash + gap

    def vdash(self, x, y0, y1, c, dash=4, gap=4):
        y = y0
        while y < y1:
            self.rect(x, y, x + 1, min(y + dash, y1), c); y += dash + gap

    def line(self, x0, y0, x1, y1, c, t=1):
        x0, y0, x1, y1 = (int(round(v)) for v in (x0, y0, x1, y1))
        dx, dy, sx, sy = abs(x1 - x0), -abs(y1 - y0), 1 if x0 < x1 else -1, 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.rect(x0, y0, x0 + t, y0 + t, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy; x0 += sx
            if e2 <= dx:
                err += dx; y0 += sy

    def tri_down(self, x, y, r, c):
        for k in range(r + 1):
            self.rect(x - (r - k), y + k, x + (r - k) + 1, y + k + 1, c)

    def diamond(self, x, y, r, c):
        for k in range(-r, r + 1):
            self.rect(x - (r - abs(k)), y + k, x + (r - abs(k)) + 1, y + k + 1, c)

    @staticmethod
    def text_w(s, scale=2):
        n = len(font_text(s))
        return max(0, n * 6 * scale - scale)

    def text(self, x, y, s, c, scale=2, bg=None):
        s = font_text(s)
        if bg is not None:
            self.rect(x - scale, y - scale, x + self.text_w(s, scale) + scale, y + 8 * scale, bg)
        for ch in s:
            for r, bits in enumerate(FONT[ch]):
                for col in range(5):
                    if bits & (16 >> col):
                        self.rect(x + col * scale, y + r * scale, x + (col + 1) * scale, y + (r + 1) * scale, c)
            x += 6 * scale
        return x

    def blit(self, x, y, w, h, data):
        """Paste raw RGB24 rows (w*h*3 bytes) with the top-left corner at x, y (clipped)."""
        for r in range(h):
            yy = y + r
            if 0 <= yy < self.h:
                x0, x1 = max(0, x), min(self.w, x + w)
                if x1 > x0:
                    i = (yy * self.w + x0) * 3
                    j = (r * w + (x0 - x)) * 3
                    self.px[i:i + (x1 - x0) * 3] = data[j:j + (x1 - x0) * 3]

    def save(self, path):
        write_png(path, self.w, self.h, self.px)


def fit_text(s, max_px, scale=2):
    """Truncate s to fit max_px at the given scale."""
    s = font_text(s)
    n = max(0, (max_px + scale) // (6 * scale))
    return s if len(s) <= n else (s[:max(0, n - 1)] + "." if n > 1 else "")


class LabelRows:
    """Greedy non-overlapping label placement in a few rows."""

    def __init__(self, rows):
        self.used = [[] for _ in range(rows)]

    def place(self, x0, x1):
        for i, row in enumerate(self.used):
            if all(x1 + 6 <= a or x0 >= b + 6 for a, b in row):
                row.append((x0, x1)); return i
        return None


# ---------------------------------------------------------------- probe
def top_level_boxes(path):
    """Order of top-level MP4/MOV boxes (ftyp, moov, mdat, ...)."""
    order = []
    with open(path, "rb") as fh:
        size_total = os.fstat(fh.fileno()).st_size
        pos = 0
        while pos + 8 <= size_total and len(order) < 64:
            fh.seek(pos)
            hdr = fh.read(8)
            size, typ = int.from_bytes(hdr[:4], "big"), hdr[4:8].decode("latin-1")
            if size == 1:
                size = int.from_bytes(fh.read(8), "big")
            elif size == 0:
                size = size_total - pos
            if size < 8:
                break
            order.append(typ)
            pos += size
    return order


KINDS = {"mp4": "H.264 High yuv420p, BT.709 tags, CFR, faststart, AAC 48 kHz (T8)",
         "alpha": "ProRes 4444 .mov or VP9 .webm whose alpha channel holds transparency (references/overlay.md)",
         "gif": "palette GIF with even frame delays, no sound (references/delivery.md)",
         "prores": "ProRes 422 HQ master, BT.709 tags, PCM 48 kHz (references/delivery.md)"}
QUIET_KINDS = ("gif", "alpha")  # no sound by design: their sound, sync and loudness are gated on the master's pack


def has_decoder(name):
    """Whether this ffmpeg has the video decoder `name` (libvpx-vp9 keeps VP9 alpha; the native decoder drops it)."""
    try:
        out = run(["ffmpeg", "-hide_banner", "-decoders"]).stdout
    except ToolError:
        return False
    return re.search(rf"^\s*V\S*\s+{re.escape(name)}\s", out, re.M) is not None


def alpha_shares(m, times):
    """[(t, share of pixels with any transparency, share fully transparent)] of the frames at these times, decoded with
    their alpha channel (VP9 through libvpx-vp9)."""
    dec = ["-c:v", "libvpx-vp9"] if m.v.get("codec_name") == "vp9" else []
    out = []
    for t in times:
        p = run(FF + ["-loglevel", "error", "-ss", f"{max(0.0, t):.4f}"] + dec + ["-i", m.path, "-frames:v", "1", "-an",
                 "-vf", "scale=160:-2:flags=neighbor,format=rgba", "-f", "rawvideo", "-"], binary=True)
        a = p.stdout[3::4]
        if a:
            out.append((round(t, 3), sum(1 for x in a if x < 255) / len(a), a.count(0) / len(a)))
    return out


def even_needs(pix):
    """(width, height) that this pixel format's chroma subsampling needs even."""
    p = pix or ""
    if p.startswith(("yuv420", "yuvj420", "yuva420", "nv12", "nv21", "p010", "p016")):
        return True, True
    if p.startswith(("yuv422", "yuvj422", "yuva422", "nv16", "y210")):
        return True, False
    return False, False


def probe_data(m, kind="mp4"):
    """Delivery facts and issues [(level, text)] against what --kind expects: mp4 = the T8 encode (H.264 High, yuv420p,
    BT.709 tags, CFR, faststart, AAC 48 kHz); alpha = a ProRes 4444 .mov or VP9 .webm whose alpha channel holds
    transparency; gif = a palette GIF with even frame delays; prores = a ProRes 422 HQ master with BT.709 tags and PCM."""
    fmt, facts, issues = m.fmt, {"lines": [], "kind": kind}, []
    L = facts["lines"]
    L.append(f"container: {fmt.get('format_name')}  duration={fnum(fmt.get('duration')):.3f}s  size={int(fnum(fmt.get('size'))) / 1e6:.2f}MB"
             f"  bitrate={fnum(fmt.get('bit_rate')) / 1e6:.2f}Mb/s  checked as --kind {kind}: {KINDS[kind]}")
    v, au, summary = m.v, m.a, []
    if not v:
        issues.append(("FAIL", "no video stream"))
    else:
        r, avg = frac(v.get("r_frame_rate")), frac(v.get("avg_frame_rate"))
        tags = {k: v.get(k, "unset") for k in ("color_range", "color_space", "color_transfer", "color_primaries")}
        pix, prof, codec = v.get("pix_fmt"), str(v.get("profile")), v.get("codec_name")
        sar = v.get("sample_aspect_ratio", "1:1")
        vt = v.get("tags") or {}
        amode = str(vt.get("alpha_mode") or vt.get("ALPHA_MODE") or "")
        L.append(f"video: {codec} {prof} L{v.get('level')} {m.w}x{m.h} SAR {sar} {pix} r_frame_rate={v.get('r_frame_rate')} "
                 f"avg_frame_rate={v.get('avg_frame_rate')} frames={v.get('nb_frames', '?')} start={v.get('start_time')} "
                 f"dur={v.get('duration')}" + (f" alpha_mode={amode}" if amode else ""))
        L.append("color: " + " ".join(f"{k}={x}" for k, x in tags.items()))
        facts.update(codec=codec, profile=prof, pix_fmt=pix, width=m.w, height=m.h, fps=round(m.fps, 3), color=tags)
        ew, eh = even_needs(pix)
        if (ew and m.w % 2) or (eh and m.h % 2):
            issues.append(("FAIL" if kind == "mp4" else "WARN", f"odd size {m.w}x{m.h}: {pix} needs an even "
                           + ("width and height" if eh else "width")))
        if kind == "mp4":
            if codec == "h264" and any(x in prof for x in ("4:4:4", "4:2:2", "High 10")):
                issues.append(("FAIL", f"H.264 '{prof}' with {pix}: QuickTime, Safari and most phones refuse it; "
                               "encode yuv420p (T8: scale=out_color_matrix=bt709:out_range=tv,format=yuv420p)"))
            elif pix not in ("yuv420p", "yuvj420p"):
                issues.append(("FAIL", f"pix_fmt {pix}: deliver 8-bit yuv420p (T8)"))
            if codec != "h264":
                issues.append(("WARN", f"codec {codec}: H.264 High is the format every player accepts (T8)"))
        elif kind == "alpha":
            if codec == "prores":
                if "4444" not in prof or not str(pix).startswith("yuva"):
                    issues.append(("FAIL", f"ProRes {prof} {pix} has no alpha channel: encode prores_ks -profile:v 4444 from "
                                   "format=yuva444p10le (references/overlay.md)"))
            elif codec == "vp9":
                if amode != "1":
                    issues.append(("FAIL", "VP9 without alpha_mode=1 has no alpha channel: encode libvpx-vp9 from "
                                   "format=yuva420p (references/overlay.md)"))
            elif re.match(r"^(yuva|gbrap|ya\d|rgba|bgra|argb|abgr)", str(pix)):
                issues.append(("WARN", f"{codec} {pix}: not one of the two alpha masters references/overlay.md covers (ProRes 4444 "
                               ".mov for editors, VP9 .webm for browsers)"))
            else:
                issues.append(("FAIL", f"{codec} {pix} has no alpha channel: deliver ProRes 4444 .mov or VP9 .webm (references/overlay.md)"))
            if not any(lv == "FAIL" for lv, _ in issues):
                if codec == "vp9" and not has_decoder("libvpx-vp9"):
                    issues.append(("WARN", "cannot check the alpha channel: this ffmpeg has no libvpx-vp9 decoder, and the "
                                   "native VP9 decoder drops alpha"))
                else:
                    sh = alpha_shares(m, [0.0, m.duration / 2, max(0.0, m.duration - 1.5 * m.frame_dur())])
                    facts["alpha"] = [{"t": t, "see_through": round(x, 3), "clear": round(z, 3)} for t, x, z in sh]
                    L.append("alpha: " + ", ".join(f"{t:.2f}s {x * 100:.0f}% see-through ({z * 100:.0f}% clear)"
                                                   for t, x, z in sh))
                    if sh and all(x == 0 for _, x, _ in sh):
                        issues.append(("FAIL", "the alpha channel is opaque in the first, middle and last frames: the page "
                                       "was not transparent (references/overlay.md), or an encode step dropped the alpha"))
                    elif sh and (sh[0][2] < 0.999 or sh[-1][2] < 0.999):
                        issues.append(("NOTE", "the first or last frame is not fully transparent: an overlay starts and "
                                       "ends transparent (T9)"))
        elif kind == "gif":
            if codec != "gif":
                issues.append(("FAIL", f"codec {codec}: --kind gif expects a GIF (references/delivery.md)"))
        elif kind == "prores":
            if codec != "prores":
                issues.append(("FAIL", f"codec {codec}: --kind prores expects a ProRes 422 HQ master (references/delivery.md)"))
            else:
                if prof != "HQ":
                    issues.append(("WARN", f"ProRes {prof}: the editor or broadcast master is 422 HQ (prores_ks "
                                   "-profile:v 3; references/delivery.md)"))
                if not str(pix).startswith("yuv422p10"):
                    issues.append(("WARN", f"pix_fmt {pix}: ProRes 422 HQ is yuv422p10le (references/delivery.md)"))
        missing = [k for k, x in tags.items() if x in ("unset", "unknown", "")]
        if kind != "gif":  # a GIF is palette RGB: no matrix, range or tags
            if pix == "yuvj420p" or tags["color_range"] == "pc":
                issues.append(("WARN", "full-range video: web and broadcast expect limited (tv) range"))
            if missing:
                issues.append(("WARN", f"color tags unset ({', '.join(missing)}): players guess and brand colors shift; "
                               "encode with the bt709 matrix and setparams (T8) or retag (references/delivery.md)"))
            elif m.h >= 720 and not all(tags[k] == "bt709" for k in ("color_space", "color_transfer", "color_primaries")):
                issues.append(("WARN", "HD video tagged " + "/".join(tags[k] for k in ("color_space", "color_transfer",
                               "color_primaries")) + " instead of bt709: check that matrix and tags agree (references/delivery.md)"))
        if sar not in ("1:1", "0:1", "N/A"):
            issues.append(("WARN", f"non-square pixels SAR {sar} (add setsar=1)"))
        pts = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time",
                   "-of", "csv=p=0", m.path]).stdout.split()
        pts = sorted(fnum(x, None) for x in pts if fnum(x, None) is not None)
        d = [b - a for a, b in zip(pts, pts[1:])]
        vfr = False
        if d:
            L.append(f"frame interval: min={min(d) * 1000:.2f}ms max={max(d) * 1000:.2f}ms (n={len(pts)})")
            if kind == "gif":  # delays are stored in 1/100 s: 15 fps alternates 60/70 ms, 30 fps 30/40 ms
                vfr = max(d) - min(d) > 0.0015
                if vfr:
                    issues.append(("WARN", f"uneven GIF frame delays ({min(d) * 1000:.0f}-{max(d) * 1000:.0f} ms): GIF stores "
                                   "delays in 1/100 s; use 10, 20, 25 or 50 fps (references/delivery.md)"))
            else:
                vfr = max(d) > 1.5 * max(min(d), 1e-6) or (avg and r and abs(r - avg) / r > 0.01)
                if vfr:
                    issues.append(("WARN", f"variable frame rate (frame intervals {min(d) * 1000:.1f}-{max(d) * 1000:.1f} ms): "
                                   "encode at a constant rate (-fps_mode cfr -r 30); analysis resamples to 30 fps"))
        facts["vfr"] = bool(vfr)
        if kind == "gif":
            summary.append(f"gif {m.w}x{m.h} {m.fps:.3g} fps, {'uneven' if vfr else 'even'} frame delays")
        else:
            summary.append(f"{codec} {prof} {pix} {m.w}x{m.h} {m.fps:.3g} fps {'VFR' if vfr else 'CFR'}, "
                           + ("bt709 tags" if not missing and tags["color_space"] == "bt709" else "color " + tags["color_space"])
                           + (", alpha" if kind == "alpha" and not any(lv == "FAIL" for lv, _ in issues) else ""))
    if au:
        sr, ch, acodec = au.get("sample_rate"), au.get("channels"), au.get("codec_name")
        L.append(f"audio: {acodec} {au.get('profile', '')} {sr}Hz ch={ch} layout={au.get('channel_layout')} "
                 f"bitrate={int(fnum(au.get('bit_rate'))) // 1000}k start={au.get('start_time')} dur={au.get('duration')}")
        facts["audio"] = {"codec": acodec, "sample_rate": sr, "channels": ch}
        if kind in QUIET_KINDS:
            issues.append(("WARN", f"an audio stream in a {kind} master: deliver the sound as a separate WAV and gate it on "
                           "the master's pack (references/delivery.md)"))
        else:
            if str(sr) != "48000":
                issues.append(("WARN", f"audio sample rate {sr} Hz: deliver 48000 Hz (T8)"))
            if kind == "mp4" and acodec != "aac":
                issues.append(("WARN", f"audio codec {acodec}: web delivery expects AAC-LC (T8)"))
            if kind == "prores" and not str(acodec).startswith("pcm_"):
                issues.append(("WARN", f"audio codec {acodec}: an editor or broadcast master carries PCM 48 kHz 24-bit "
                               "(references/delivery.md)"))
        if v and au.get("duration") and v.get("duration"):
            gap = fnum(au["duration"]) - fnum(v["duration"])
            if abs(gap) > m.frame_dur() + 1e-6:
                issues.append(("WARN", f"audio and video durations differ by {gap * 1000:+.0f} ms (> 1 frame)"))
        if v and au.get("start_time") not in (None, "N/A") and v.get("start_time") not in (None, "N/A"):
            off = fnum(au["start_time"]) - fnum(v["start_time"])
            if abs(off) > 0.001:
                issues.append(("WARN", f"audio starts {off * 1000:+.1f} ms relative to video in the container"))
        summary.append(f"{acodec} {sr // 1000 if isinstance(sr, int) else int(fnum(sr)) // 1000} kHz {ch} ch")
    else:
        L.append("audio: none")
        summary.append("no audio")
    if m.path.lower().endswith((".mp4", ".m4v", ".mov")):
        boxes = top_level_boxes(m.path)
        fast = "moov" in boxes and "mdat" in boxes and boxes.index("moov") < boxes.index("mdat")
        L.append(f"top-level boxes: {' '.join(boxes)}  faststart={'yes' if fast else 'NO'}")
        facts["faststart"] = fast
        if kind == "mp4":  # editors read a .mov master whole; only streamed files need moov first
            if not fast:
                issues.append(("WARN", "moov after mdat: web playback waits for the whole file "
                               "(remux: ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4)"))
            summary.append("faststart" if fast else "no faststart")
    if not any(lv in ("FAIL", "WARN") for lv, _ in issues):
        issues.append(("PASS", f"{kind}: " + ", ".join(summary)))
    facts["summary"] = ", ".join(summary)
    return facts, issues


def cmd_probe(a):
    m = Media(a.file)
    facts, issues = probe_data(m, a.kind)
    for line in facts["lines"]:
        print(line)
    for lv, text in issues:
        print(lv, "delivery:", text)
    loud = []
    if a.spec != "none":  # loudness only when a --spec is given
        if m.a:
            r = ebur128(a.file)
            print(f"loudness: integrated {r['I']:.1f} LUFS  LRA {r['LRA']:.1f} LU  true peak {r['TP']:.1f} dBTP")
            loud = loudness_verdicts(r, a.spec, register=None)
            for lv, text in loud:
                print(("N/A" if lv == "SILENT" else lv), "loudness:", text)
        else:
            print("N/A loudness: no audio stream" + (f" (a {a.kind} master carries none: gate its sound on the master's pack)"
                                                      if a.kind in QUIET_KINDS else ""))
    return 1 if any(lv == "FAIL" for lv, _ in issues + loud) else 0


# ---------------------------------------------------------------- motion
def analysis_rate(m):
    """Native rate for constant-frame-rate files from 10 to 60 fps, else 30 (VFR is resampled to CFR)."""
    r, avg = frac(m.v.get("r_frame_rate")), frac(m.v.get("avg_frame_rate"))
    if r and avg and abs(r - avg) / r < 0.01 and 10 <= avg <= 60:
        return round(avg, 3)
    return 30.0


def in_span(spans, a, b=None, slack=0.0):
    """The first span (dict with start and end) holding the time a, or all of [a, b]; None when none does."""
    b = a if b is None else b
    return next((x for x in spans if x["start"] - slack <= a and b <= x["end"] + slack), None)


def near_spans(spans, a, b, reach):
    """Every span that overlaps [a - reach, b + reach]: a drawing at a section boundary may take either section's grid
    (S16: a repeat straddling two adjacent steps spans counts as declared when either grid matches)."""
    return [x for x in spans if x["start"] <= b + reach and a - reach <= x["end"]]


def drawing_frames(sp, rate, fps):
    """A steps span's drawing length in analysis frames: its `every` (a whole number of film frames), or the analysis
    rate over its `rate` in drawings per second (possibly fractional: 12 drawings/s at 30 fps hold 2 and 3 frames)."""
    if "rate" in sp:
        return rate / sp["rate"]
    return max(1, round(sp["every"] * rate / (fps or rate)))


def on_grid(p, g):
    """Whether a drawing held p analysis frames sits on a steps grid of g frames per drawing: a whole multiple of g,
    or within one frame of one when g is fractional (a rate clock that does not divide the frame rate)."""
    if g <= 1:
        return False
    if abs(g - round(g)) < 1e-6:
        return p % round(g) == 0
    return abs(p - max(1, round(p / g)) * g) < 1.0


def effect_kind(sp):
    """Whether an effects span excuses its frames: only flash, shake, glitch and flicker do (S16); texture (noise, grain,
    boil) belongs to the card and the page's data-layer="texture", which the content pass hides."""
    return sp.get("kind") in EFFECT_KINDS


def flash_data(t, lum, rate):
    """Photosensitive flashes (WCAG 2.3.1 general flashes, measured on the whole frame): a transition is a monotone
    swing of the frame's mean relative luminance (0-1) by FLASH_DELTA or more whose darker end is under FLASH_DARK; a
    flash is a pair of opposing transitions. Returns the transitions and the busiest one-second window."""
    n, swings = len(lum), []
    if n > 1:  # zigzag with hysteresis FLASH_DELTA: a swing ends where the value turns back by FLASH_DELTA
        lo = hi = i = 0
        while i + 1 < n and lum[hi] - lum[lo] < FLASH_DELTA:
            i += 1
            lo, hi = (i if lum[i] < lum[lo] else lo), (i if lum[i] > lum[hi] else hi)
        if lum[hi] - lum[lo] >= FLASH_DELTA:
            up = hi > lo
            start, ext = (lo, hi) if up else (hi, lo)
            for i in range(i + 1, n):
                if (lum[i] > lum[ext]) == up and lum[i] != lum[ext]:
                    ext = i
                elif abs(lum[ext] - lum[i]) >= FLASH_DELTA:
                    swings.append((start, ext))
                    start, ext, up = ext, i, not up
            swings.append((start, ext))
    tr = [(round(t[a], 3), round(t[b], 3), round(lum[b] - lum[a], 3)) for a, b in swings
          if min(lum[a], lum[b]) < FLASH_DARK]
    best, span, j = 0, None, 0
    frames = [round(b * rate) for _, b, _ in tr]  # a window is one second of frames
    for k in range(len(tr)):
        while frames[k] - frames[j] >= round(rate):
            j += 1
        if k - j + 1 > best:
            best, span = k - j + 1, (tr[j][1], tr[k][1])
    return {"transitions": len(tr), "max_in_1s": best, "worst": span, "list": tr[:40]}


def motion_data(m, rate=None, width=320, thr=THR_STILL, min_run=MIN_RUN, holds=(), steps=(), effects=()):
    """Per-frame mean absolute luma difference (0-255 full-range scale) at the analysis rate and width.
    Statistics use 30-fps-equivalent values (raw x rate/30) so files with different frame rates compare.
    steps / effects: the timeline's style declarations (load_timeline); judder, still runs and unlisted events read
    them, the flash count does not. Keys starting with '_' hold per-frame arrays for drawing and are not printed."""
    if not m.v:
        raise ToolError(f"{m.path}: no video stream")
    rate = rate or analysis_rate(m)
    # edge.txt: the same difference with changes under EDGE_MIN levels zeroed, i.e. moving edges without fade wash;
    # lin.txt: mean relative luminance (sRGB decoded, x255) for the flash count
    graph = (f"[0:v]fps={rate},scale={width}:-2,format=gray,split=3[a][b][c];"
             "[a]tblend=all_mode=difference,split[a1][a2];"
             "[a1]signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=diff.txt[d];"
             f"[a2]lutyuv=y='if(gte(val,{EDGE_MIN}),val,0)',signalstats,"
             "metadata=print:key=lavfi.signalstats.YAVG:file=edge.txt[e];"
             "[b]signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=luma.txt[l];"
             "[c]lutyuv=y='255*if(lte(val,10.31475),val/3294.6,pow((val/255+0.055)/1.055,2.4))',signalstats,"
             "metadata=print:key=lavfi.signalstats.YAVG:file=lin.txt[f]")
    with tempfile.TemporaryDirectory() as td:
        run(FF + ["-loglevel", "error", "-i", os.path.abspath(m.path), "-filter_complex", graph]
            + [x for o in "delf" for x in ("-map", f"[{o}]", "-f", "null", "-")], cwd=td)
        diff = read_meta(os.path.join(td, "diff.txt"), "YAVG")
        edge = [y for _, y in read_meta(os.path.join(td, "edge.txt"), "YAVG")]
        luma = read_meta(os.path.join(td, "luma.txt"), "YAVG")
        lin = read_meta(os.path.join(td, "lin.txt"), "YAVG")
    t = [x for x, _ in diff]
    d = [y for _, y in diff]
    n = len(d)
    edge += [0.0] * (n - len(edge))
    if n < 3:
        raise ToolError(f"{m.path}: too few frames for a motion profile")
    d30 = [y * rate / 30.0 for y in d]
    w = max(1, round(0.2 * rate))  # 0.2 s centred mean: absorbs duplicated frames and keyframe pops
    s = []
    for i in range(n):
        lo, hi = max(0, i - w // 2), min(n, i - w // 2 + w)
        s.append(sum(d30[lo:hi]) / (hi - lo))
    static = [x < thr for x in s]
    fr_in = 1.0 / rate
    grid = {id(sp): drawing_frames(sp, rate, m.fps) for sp in steps}  # declared steps span -> frames per drawing
    fx = [x for x in effects if effect_kind(x)]  # only flash, shake, glitch and flicker excuse anything (S16)
    # inside a steps span a drawing held for its declared `every` frames is the style, not a still run: clear
    # near-static stretches no longer than that (a longer one is a hold, or a stall, and stays)
    sub_every = 0
    i = 0
    while i < n:
        if static[i]:
            j = i
            while j + 1 < n and static[j + 1]:
                j += 1
            g = max((grid[id(x)] for x in near_spans(steps, t[i] - fr_in, t[j], fr_in / 2)), default=0)
            if g > 1 and j - i + 1 <= math.ceil(g - 1e-6):
                for k in range(i, j + 1):
                    static[k] = False
                sub_every += j - i + 1
            i = j + 1
        else:
            i += 1
    exempt = [(h["start"], h["end"]) for h in holds]
    counted = [i for i in range(n) if not any(a_ <= t[i] <= b_ for a_, b_ in exempt)]  # planned holds excluded
    runs, i = [], 0
    while i < n:
        if static[i]:
            j = i
            while j + 1 < n and static[j + 1]:
                j += 1
            start = max(0.0, t[i] - 1.0 / rate)  # the interval begins at the earlier frame of the first pair
            dur = t[j] - start
            if dur >= min_run:
                runs.append({"start": round(start, 3), "end": round(t[j], 3), "dur": round(dur, 3)})
            i = j + 1
        else:
            i += 1
    per_sec = {}
    for x, y, st in zip(t, d30, static):
        per_sec.setdefault(int(x - 1e-9), []).append((y, st))
    secs = [{"sec": k, "mean": round(sum(y for y, _ in v) / len(v), 3), "max": round(max(y for y, _ in v), 2),
             "static": round(sum(st for _, st in v) / len(v), 2)} for k, v in sorted(per_sec.items())]
    # zero-change frames sandwiched inside motion: duplicated/dropped frames or whole-pixel snapping
    # (runs of 1-3 frames at most 0.3x of both moving neighbours; lossy encoders leave residue in duplicates)
    holes, dj, i = [], list(d), 1
    declared = {"steps": 0, "effects": 0}  # repeat frames the style declarations account for
    while i < n - 1:
        if d[i - 1] > 0.3 and d[i] <= 0.3 * d[i - 1]:
            j = i
            while j + 1 < n and d[j + 1] <= 0.3 * d[i - 1] and j - i < 3:
                j += 1
            # motion must go on past one of the two changes (2+ more steps within two repeat periods p): zero-change
            # frames between isolated changes in a still picture (a flash, a held pop, a cut) are events, not judder
            p = j - i + 2
            moving_on = (sum(x > 0.3 for x in d[max(0, i - 1 - 2 * p):i - 1]) >= 2
                         or sum(x > 0.3 for x in d[j + 2:j + 2 + 2 * p]) >= 2)
            # both neighbours must carry moving edges (changes of EDGE_MIN+ levels): a slow fade or dissolve of a large
            # area moves 1-3 levels on some frames and none on others (8-bit quantization), which is not judder
            if (moving_on and j - i < 3 and j + 1 < n and d[j + 1] > 0.3 and max(d[i:j + 1]) <= 0.3 * min(d[i - 1], d[j + 1])
                    and min(edge[i - 1], edge[j + 1]) > 0.3):
                for k in range(i, j + 1):
                    dj[k] = (d[i - 1] + d[j + 1]) / 2
                # a declared effect, or repeats on a declared steps grid (the drawing held a whole number of steps of
                # `every` frames), are the style: counted apart, never judder
                # any steps span within one drawing of the repeat may claim it (S16): a drawing at a section boundary
                if in_span(fx, t[i - 1], t[j + 1], slack=fr_in / 2):
                    declared["effects"] += j - i + 1
                elif any(on_grid(p, grid[id(x)]) for x in near_spans(steps, t[i - 1], t[j + 1], p * fr_in)):
                    declared["steps"] += j - i + 1
                else:
                    holes += range(i, j + 1)
            i = j + 1
        else:
            i += 1
    moving = sum(1 for x in d if x > 0.3) + len(holes) + declared["steps"] + declared["effects"]
    # events: single-frame spikes (cuts, pops, flashes) and starts of movement after a rest
    events = []
    for i in range(n):
        before = statistics.median(dj[max(0, i - 5):i]) if i > 0 else 0.0
        after = statistics.median(dj[i + 1:i + 6]) if i + 1 < n else 0.0
        base = max(before, after)
        left = dj[i - 1] if i > 0 else 0.0
        right = dj[i + 1] if i + 1 < n else 0.0
        # a tie goes to the earlier frame and the earliest spike within 0.15 s is kept: an event is the frame where the
        # change first becomes visible (a flash's onset, not its end; a cut, not a bigger speed peak just after it)
        if dj[i] >= 1.0 and dj[i] >= 1.5 * base + 0.5 and dj[i] > left and dj[i] >= right:
            if events and t[i] - events[-1]["t"] < 0.15:
                continue
            events.append({"t": round(t[i], 4), "kind": "spike", "mag": round(dj[i], 2)})
    rest = max(1, round(0.3 * rate))
    for i in range(rest, n - 2):
        if all(s[k] < thr for k in range(i - rest, i)) and d[i] >= 3 * thr and d[i + 1] >= thr and d[i + 2] >= thr:
            if not any(abs(e["t"] - t[i]) < 0.1 for e in events):
                events.append({"t": round(t[i], 4), "kind": "start", "mag": round(d[i], 2)})
    events.sort(key=lambda e: e["t"])
    for e in events:  # a declared effect's variation is planned: matched to planned events, never listed as unplanned
        sp = in_span(fx, e["t"], slack=fr_in / 2)
        if sp:
            e["effect"] = sp["kind"]
    lum = [y for _, y in luma]
    # 1-2 near-black frames between bright neighbours: a seam or a missing frame, not a designed dip to black
    black, k = [], 0
    while k < len(lum):
        if lum[k] < 10:
            j = k
            while j + 1 < len(lum) and lum[j + 1] < 10:
                j += 1
            nb = lum[max(0, k - 3):k] + lum[j + 1:j + 4]
            if j - k < 2 and k > 0 and j + 1 < len(lum) and nb and min(nb) > 40:
                black.append(round(luma[k][0], 3))
            k = j + 1
        else:
            k += 1
    hold_still = []
    for h in holds:
        idx = [i for i in range(n) if h["start"] <= t[i] <= h["end"]]
        if idx:
            hold_still.append({"start": h["start"], "end": h["end"], "still": round(sum(static[i] for i in idx) / len(idx), 2)})
    return {
        "analysis_rate": rate, "width": width, "threshold": thr, "samples": n,
        "near_static_share": round(sum(static[i] for i in counted) / max(1, len(counted)), 3),
        "near_static_share_all": round(sum(static) / n, 3),  # holds included: how still the whole film is
        "holds_excluded": bool(holds),
        "share_at": {str(k): round(sum(s[i] < k for i in counted) / max(1, len(counted)), 3) for k in (0.05, 0.1, 0.3, 1.0)},
        "low_p5": round(sorted(d)[n // 20], 4),
        "static_runs": runs, "per_second": secs,
        "quietest_seconds": [x["sec"] for x in sorted(secs, key=lambda x: x["mean"])[:3]],
        "events": events,
        "judder_holes": {"count": len(holes), "of_moving": moving, "times": [round(t[i], 3) for i in holes[:12]],
                         "declared": declared},
        "steps_sub_every": sub_every, "flashes": flash_data([x for x, _ in lin], [y / 255.0 for _, y in lin], rate),
        "black_frames": black, "hold_still": hold_still,
        "first_frame_luma": round(lum[0], 1) if lum else None, "last_frame_luma": round(lum[-1], 1) if lum else None,
        "_t": t, "_d30": d30, "_s": s, "_hole_t": [t[i] for i in holes],
        "_dj30": [y * rate / 30.0 for y in dj],  # judder holes filled: changes drawing to drawing (S11 event kinds)
    }


# ---------------------------------------------------------------- frozen share (S9)
def centred_mean(v, w):
    """The w-sample centred running mean of v (the window shrinks at the ends), in O(len(v))."""
    n, cs = len(v), [0.0]
    for x in v:
        cs.append(cs[-1] + x)
    out = []
    for i in range(n):
        lo, hi = max(0, i - w // 2), min(n, i - w // 2 + w)
        out.append((cs[hi] - cs[lo]) / max(1, hi - lo))
    return out


def raw_frames(path, size):
    """A rawvideo file of 16-bit grey frames, size values each, as a list of arrays."""
    a = array("H")
    with open(path, "rb") as fh:
        a.frombytes(fh.read())
    if sys.byteorder == "big":
        a.byteswap()
    return [a[k:k + size] for k in range(0, len(a) - size + 1, size)]


def changed_px(frames, w, h, gw, gh):
    """Changed-pixel counts from area-averaged 0/65535 masks of a w x h picture (gw x gh values a frame)."""
    return [sum(f) / 65535.0 * (w * h) / (gw * gh) for f in frames]


def frozen_pass(m, rate, boxes=None):
    """One ffmpeg pass over picture m at the analysis rate: per frame pair the motion energy (mean absolute difference
    at 320 px over Y plus half of U and V, 30-fps-equivalent), the count of full-resolution pixels changing by more than
    LOCAL_LEVELS (and the same count inside each box, in m's px), and per frame a 16-bit Y thumbnail THUMB_W wide for
    the idle candidate search. Counts come from area-averaged masks, which keep the sum exact."""
    W, H, boxes = m.w, m.h, boxes or {}
    gw = 64
    gh = max(1, round(gw * H / max(1, W)))
    lut = f"lutyuv=y='if(gt(val,{LOCAL_LEVELS}),255,0)',format=gray16le"
    g = [f"[0:v]fps={rate},split=2[full][sm]",
         f"[full]format=gray,split={1 + len(boxes)}[fl]" + "".join(f"[fb{i}]" for i in range(len(boxes))),
         f"[fl]tblend=all_mode=difference,{lut},scale={gw}:{gh}:flags=area[ol]",
         "[sm]scale=320:-2,format=yuv444p,split=2[c][th]",
         "[c]extractplanes=y+u+v[y][u][v];[y]split[y1][y2];[y1][y2][u][v]hstack=inputs=4,tblend=all_mode=difference,"
         "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=energy.txt[oe]",
         f"[th]extractplanes=y,format=gray16le,scale={THUMB_W}:-2:flags=area[ot]"]
    bsz = {}
    for i, (name, (x0, y0, x1, y1)) in enumerate(boxes.items()):
        bw, bh = max(1, x1 - x0), max(1, y1 - y0)
        bsz[name] = (bw, bh, min(8, bw), min(8, bh))
        g.append(f"[fb{i}]crop={bw}:{bh}:{x0}:{y0},tblend=all_mode=difference,{lut},"
                 f"scale={bsz[name][2]}:{bsz[name][3]}:flags=area[ob{i}]")
    outs = ["-map", "[oe]", "-f", "null", "-", "-map", "[ol]", "-f", "rawvideo", "local.raw", "-map", "[ot]",
            "-f", "rawvideo", "thumb.raw"]
    for i in range(len(boxes)):
        outs += ["-map", f"[ob{i}]", "-f", "rawvideo", f"box{i}.raw"]
    with tempfile.TemporaryDirectory() as td:
        run(FF + ["-loglevel", "error", "-i", os.path.abspath(m.path), "-filter_complex", ";".join(g)] + outs, cwd=td)
        rows = read_meta(os.path.join(td, "energy.txt"), "YAVG")
        local = changed_px(raw_frames(os.path.join(td, "local.raw"), gw * gh), W, H, gw, gh)
        thumb_bytes = os.path.getsize(os.path.join(td, "thumb.raw"))
        nf = len(rows) + 1
        tsize = thumb_bytes // 2 // max(1, nf)
        thumbs = raw_frames(os.path.join(td, "thumb.raw"), tsize) if tsize else []
        bc = {name: changed_px(raw_frames(os.path.join(td, f"box{i}.raw"), b[2] * b[3]), b[0], b[1], b[2], b[3])
              for i, (name, b) in enumerate(bsz.items())}
    n = min(len(rows), len(local))
    if n < 3:
        raise ToolError(f"{m.path}: too few frames for a frozen measure")
    # the mosaic is Y, Y, U, V side by side: twice its mean is Y plus half of U and V
    energy = [2.0 * y * rate / 30.0 for _, y in rows[:n]]
    return [x for x, _ in rows[:n]], energy, local[:n], {k: v[:n] for k, v in bc.items()}, thumbs


def frame_runs(ns):
    """An ffmpeg expression true for frame numbers n in the sorted list ns: one between() per contiguous run, reached by
    a binary search on n. ffmpeg refuses an expression nested about 100 deep, so a flat sum fails past 100 runs (a
    caret blinking on a still layout gets there); the search nests about log2(runs) deep, and `if` evaluates only the
    branch taken, so a frame costs O(log runs)."""
    runs = []
    for x in ns:
        if runs and x == runs[-1][1] + 1:
            runs[-1][1] = x
        else:
            runs.append([x, x])

    def tree(lo, hi):  # runs[lo:hi], at least one
        if hi - lo == 1:
            return f"between(n,{runs[lo][0]},{runs[lo][1]})"
        mid = (lo + hi) // 2
        return f"if(lt(n,{runs[mid][0]}),{tree(lo, mid)},{tree(mid, hi)})"
    return tree(0, len(runs)) if runs else "0"


def pair_diffs(m, rate, energy, pixels):
    """Exact idle-test values (S9.3) from one decode of picture m: for each (lag, f), frame f against frame f - lag.
    Returns ({pair: difference at 320 px over Y plus half of U and V} for the pairs in energy, {pair: count of
    full-resolution pixels changing by more than LOCAL_LEVELS} for the pairs in pixels). The frames the pairs use are
    selected once; per lag one branch pairs its later and earlier frames in order, so each pair is one comparison and
    the frames in flight are shared, at most the lag range of them."""
    en, px = {}, {}
    for lag, f in energy:
        en.setdefault(lag, set()).add(f)
    for lag, f in pixels:
        px.setdefault(lag, set()).add(f)
    if not en and not px:
        return {}, {}
    used = sorted({x for d in (en, px) for lag, fs in d.items() for f in fs for x in (f, f - lag)})
    pos = {f: i for i, f in enumerate(used)}
    lags, ts = sorted(en), "setpts=N/FRAME_RATE/TB"  # renumbered in order, so the k-th later and earlier frames pair
    gw = 64
    gh = max(1, round(gw * m.h / max(1, m.w)))
    g = [f"[0:v]fps={rate},trim=end_frame={used[-1] + 1},select='{frame_runs(used)}',{ts},split=2[sm][full]",
         "[sm]scale=320:-2,format=yuv444p,extractplanes=y+u+v[y][u][v];[y]split[y1][y2];[y1][y2][u][v]hstack=inputs=4,"
         f"split={2 * len(lags) + 1}[mz]" + "".join(f"[ma{i}][mb{i}]" for i in range(len(lags))) if en else
         "[sm]nullsink",
         f"[full]format=gray,split={2 * len(px) + (not en)}" + ("" if en else "[gz]")
         + "".join(f"[ga{i}][gb{i}]" for i in range(len(px))) if px else "[full]nullsink"]
    outs = ["-map", "[mz]" if en else "[gz]", "-f", "null", "-"]
    for i, lag in enumerate(lags):
        fs = sorted(en[lag])
        g.append(f"[ma{i}]select='{frame_runs([pos[f] for f in fs])}',{ts}[xa{i}];[mb{i}]select='"
                 f"{frame_runs([pos[f - lag] for f in fs])}',{ts}[xb{i}];[xa{i}][xb{i}]blend=all_mode=difference,"
                 f"signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=e{i}.txt,nullsink")
    for i, lag in enumerate(sorted(px)):
        fs = sorted(px[lag])
        g.append(f"[ga{i}]select='{frame_runs([pos[f] for f in fs])}',{ts}[ya{i}];[gb{i}]select='"
                 f"{frame_runs([pos[f - lag] for f in fs])}',{ts}[yb{i}];[ya{i}][yb{i}]blend=all_mode=difference,"
                 f"lutyuv=y='if(gt(val,{LOCAL_LEVELS}),255,0)',format=gray16le,scale={gw}:{gh}:flags=area[ol{i}]")
        outs += ["-map", f"[ol{i}]", "-f", "rawvideo", f"l{i}.raw"]
    E, C, graph = {}, {}, ";".join(g)
    with tempfile.TemporaryDirectory() as td:
        fg = ["-filter_complex", graph]
        if len(graph) > 100_000:  # one argument holds at most 128 KB on Linux; ffmpeg 4 to 8 read the script option
            with open(os.path.join(td, "graph.txt"), "w") as fh:
                fh.write(graph)
            fg = ["-filter_complex_script", "graph.txt"]
        run(FF + ["-loglevel", "error", "-i", os.path.abspath(m.path)] + fg + outs, cwd=td)
        for i, lag in enumerate(lags):
            fs, e = sorted(en[lag]), [2.0 * y for _, y in read_meta(os.path.join(td, f"e{i}.txt"), "YAVG")]
            if len(e) != len(fs):
                raise ToolError(f"{m.path}: the idle check compared {len(e)} of {len(fs)} frame pairs at lag {lag}")
            E.update(((lag, f), x) for f, x in zip(fs, e))
        for i, lag in enumerate(sorted(px)):
            fs = sorted(px[lag])
            c = changed_px(raw_frames(os.path.join(td, f"l{i}.raw"), gw * gh), m.w, m.h, gw, gh)
            if len(c) != len(fs):
                raise ToolError(f"{m.path}: the idle check counted {len(c)} of {len(fs)} frame pairs at lag {lag}")
            C.update(((lag, f), x) for f, x in zip(fs, c))
    return E, C


def idle_frames(m, rate, thumbs, still, thr_px):
    """Frames where the picture repeats itself (S9.3: it matches the frame at some lag from 0.4 to 2.0 s, under the
    frozen thresholds, over a run of at least 1.5 s), and how many exact pair passes ran. Stage 1: thumbnails test every
    lag (a thumbnail difference does not exceed the frame difference, rounding apart, so no repeat is missed) and give
    the candidate runs. Stage 2 settles them on exact pair values (pair_diffs; each pair compared once and kept): a
    candidate is checked whole (the 0.2 s centred mean of its pairs' differences under FROZEN_E and fewer than thr_px
    changed pixels, runs of 1.5 s or more marked idle) unless it can no longer mark a relevant frame: one not idle yet
    that belongs to a pair that is not frozen. A run can mark relevant frame r only through a pair whose later frame
    lies within lag after r, so one passing pair there is necessary (the window test); a run of `need` pairs holds a
    pair at every need-th index, so one passing sample is necessary too (used when the windows are larger). Tests and
    checks take the same sums, and frames only ever leave the relevant set, so the still pairs come out as if every
    candidate had been checked. Round 1 checks together the candidates whose reachable relevant frames do not overlap;
    the others wait, since round 1 may settle those frames, and round 2 checks every one that still can mark one.
    Cost: O(frames x lags x THUMB_W pixels) in Python for the candidates; then at most four pair passes, each one decode
    up to the last frame it uses (the energy over every tested pair's centred-mean window, the pixel counts where that
    energy passes, the two rounds), fetching each pair's energy and count at most once and only the candidates' own
    pairs (at most lags x frames); Python work linear in those pairs."""
    nf = len(thumbs)
    idle, info = [False] * nf, {"passes": 0, "pairs": 0, "lags": []}
    if nf < 3 or not thumbs or not len(thumbs[0]):
        return idle, info
    l0, l1 = max(1, math.ceil(IDLE_LAG[0] * rate - 1e-6)), min(nf - 1, math.floor(IDLE_LAG[1] * rate + 1e-6))
    w, need, size = max(1, round(0.2 * rate)), max(2, round(IDLE_RUN * rate)), len(thumbs[0]) * 257.0
    sub = operator.sub
    # a frame is worth checking only when the pair ending on it (or starting on it) is not already still
    moving = [False] + [not x for x in still] + [False] * max(0, nf - 1 - len(still))
    cands = []
    for lag in range(l0, l1 + 1):
        d = [sum(map(abs, map(sub, thumbs[f], thumbs[f - lag]))) / size for f in range(lag, nf)]
        ok, j = [x < FROZEN_E for x in centred_mean(d, w)], 0
        while j < len(ok):
            if not ok[j]:
                j += 1
                continue
            k = j
            while k + 1 < len(ok) and ok[k + 1]:
                k += 1
            fa, fb = lag + j, lag + k
            if k - j + 1 >= need and any(moving[f] or moving[min(nf - 1, f + 1)] for f in range(fa - lag, fb + 1)):
                cands.append((sum(d[j:k + 1]) / (k - j + 1), lag, fa, fb))
            j = k + 1
    E, C = {}, {}

    def fetch(energy, pixels):
        energy, pixels = [p for p in energy if p not in E], [p for p in pixels if p not in C]
        if energy or pixels:
            info["passes"] += 1
            info["pairs"] += len(set(energy) | set(pixels))
            e, c = pair_diffs(m, rate, energy, pixels)
            E.update(e)
            C.update(c)

    def span(fa, fb, f):  # the pairs whose differences f's centred mean takes, inside the candidate's run
        i, n = f - fa, fb - fa + 1
        return fa + max(0, i - w // 2), fa + min(n, i - w // 2 + w) - 1

    def calm(lag, fa, fb, f):  # the energy term at f: its centred mean inside the candidate's run under FROZEN_E
        a, b = span(fa, fb, f)
        return sum(E[(lag, q)] for q in range(a, b + 1)) / (b - a + 1) < FROZEN_E

    def passes(lag, fa, fb, f):  # the pixel count is fetched only where the energy term passes
        return calm(lag, fa, fb, f) and C[(lag, f)] < thr_px

    def relevant(f):  # marking f idle can still make a non-frozen pair still
        return not idle[f] and any(0 <= p < len(still) and not still[p] for p in (f - 1, f))

    def tests(lag, fa, fb):  # relevant frames, window indices (their windows merged in order), samples when fewer
        rel, win, hi = [r for r in range(fa - lag, fb + 1) if relevant(r)], [], fa - 1
        for r in rel:
            win += range(max(fa, r, hi + 1), min(fb, r + lag) + 1)
            hi = max(hi, min(fb, r + lag))
        smp = list(range(fa + need - 1, fb + 1, need))
        return rel, win, smp if len(win) > len(smp) else []

    pre = []
    for _, lag, fa, fb in cands:  # the tests of every candidate, from the frames relevant now: the energy of every
        _, win, smp = tests(lag, fa, fb)  # tested pair's window, then the count where that energy passes
        pre += [(lag, fa, fb, f) for f in win + smp]
    fetch({(lag, q) for lag, fa, fb, f in pre for q in range(span(fa, fb, f)[0], span(fa, fb, f)[1] + 1)}, ())
    fetch((), {(lag, f) for lag, fa, fb, f in pre if calm(lag, fa, fb, f)})
    todo = sorted(cands)
    for last in (False, True):
        batch, taken, wait = [], set(), []
        for cand in todo:
            _, lag, fa, fb = cand
            rel, win, smp = tests(lag, fa, fb)
            if smp and not any(passes(lag, fa, fb, f) for f in smp):
                continue  # no run of need pairs anywhere in it
            ok, cs = {f for f in win if passes(lag, fa, fb, f)}, [0]
            for f in range(fa, fb + 1):  # passing pairs counted in order: one look per relevant frame's window
                cs.append(cs[-1] + (f in ok))
            reach = {r for r in rel if cs[min(fb, r + lag) - fa + 1] > cs[max(fa, r) - fa]}
            if not reach:
                continue  # no run can mark a relevant frame, now or later
            if reach & taken and not last:
                wait.append(cand)
            else:
                batch.append(cand)
                taken |= reach
        fetch([(lag, f) for _, lag, fa, fb in batch for f in range(fa, fb + 1)],
              [(lag, f) for _, lag, fa, fb in batch for f in range(fa, fb + 1)])
        for _, lag, fa, fb in batch:
            ok, j = [passes(lag, fa, fb, f) for f in range(fa, fb + 1)], 0  # the very sums the tests took
            while j < len(ok):
                if not ok[j]:
                    j += 1
                    continue
                k = j
                while k + 1 < len(ok) and ok[k + 1]:
                    k += 1
                if k - j + 1 >= need:
                    for f in range(fa + j - lag, fa + k + 1):
                        idle[f] = True
                    info["lags"].append(round(lag / rate, 3))
                j = k + 1
        todo = wait
    return idle, info


def frozen_data(m, film_area=None, boxes=None, idle=True):
    """Spec S9.2-3 on picture m: per sample (frame pair, timed at its second frame) the motion energy on its 0.2 s
    centred mean and the pair's own changed-pixel count; `frozen`: that energy under FROZEN_E and fewer than LOCAL_PX
    full-resolution pixels changing by more than LOCAL_LEVELS (scaled by area to m's size; film_area is the film's own
    width x height, so a 640 px content pass counts about 6); `idle`: both frames repeat the picture at a lag (S9.3)."""
    rate = analysis_rate(m)
    t, energy, local, boxc, thumbs = frozen_pass(m, rate, boxes)
    w = max(1, round(0.2 * rate))
    thr_px = LOCAL_PX * (m.w * m.h) / max(1, film_area or m.w * m.h)
    s = centred_mean(energy, w)
    frozen = [a < FROZEN_E and b < thr_px for a, b in zip(s, local)]
    idle_f, info = idle_frames(m, rate, thumbs, frozen, thr_px) if idle else ([False] * (len(t) + 1), {})
    idle_s = [idle_f[k] and idle_f[k + 1] for k in range(len(t))]
    return {"path": m.path, "rate": rate, "width": m.w, "height": m.h, "threshold_px": round(thr_px, 2), "t": t,
            "energy": s, "raw_energy": energy, "local": local, "frozen": frozen, "idle": idle_s, "idle_info": info,
            "boxes": boxc}


def still_runs(fd):
    """Runs of still samples (frozen or idle): first and last sample, and the run's time span extended through
    neighbouring pairs that are still on their own (the centred mean trims about 0.1 s from each end of a still
    stretch), which the run-timed rules use: the hook's start and length, a beat rest's start, the poster."""
    t, n, dt = fd["t"], len(fd["t"]), 1.0 / fd["rate"]
    still = [a or b for a, b in zip(fd["frozen"], fd["idle"])]
    raw = [e < FROZEN_E and c < fd["threshold_px"] for e, c in zip(fd["raw_energy"], fd["local"])]
    runs, k, lo = [], 0, 0
    while k < n:
        if not still[k]:
            k += 1
            continue
        j = k
        while j + 1 < n and still[j + 1]:
            j += 1
        a, b = k, j
        while a > lo and raw[a - 1]:
            a -= 1
        while b + 1 < n and raw[b + 1] and not still[b + 1]:
            b += 1
        runs.append({"i": k, "j": j, "start": round(max(0.0, t[a] - dt), 3), "end": round(t[b], 3),
                     "dur": round(t[b] - t[a] + dt, 3), "idle": round(sum(fd["idle"][k:j + 1]) / (j - k + 1), 3),
                     "last": b == n - 1})
        lo, k = b + 1, j + 1
    return still, runs


def seam_levels(m):
    """Mean absolute difference between the last frame and the first at 320 px, Y plus half of U and V (S9.7 loop)."""
    h = even(320 * m.h / max(1, m.dw))
    plane = 320 * h

    def frames(pre, post):
        return run(FF + ["-loglevel", "error"] + pre + ["-i", m.path, "-an", "-vf", f"scale=320:{h},format=yuv444p"]
                   + post + ["-f", "rawvideo", "-"], binary=True).stdout
    first, last = frames([], ["-frames:v", "1"])[:3 * plane], frames(["-sseof", "-1"], [])[-3 * plane:]
    if len(first) < 3 * plane or len(last) < 3 * plane:
        raise ToolError(f"{m.path}: could not decode the first and last frames for the loop check")
    d = [sum(map(abs, map(operator.sub, first[q * plane:(q + 1) * plane], last[q * plane:(q + 1) * plane]))) / plane
         for q in range(3)]
    return d[0] + 0.5 * (d[1] + d[2])


def pacing_data(fd, tl, reg, fmt, card, dur, measured, loop_levels=None):
    """Spec S9: the frozen share, the binding pacing measure, and what is set apart from it. Still samples are frozen
    or idle (frozen_data). Inside a declared alive hold of a kind the chosen shipped card allows (motion.holds.alive)
    they count as alive-held, as do still samples of the content pass inside a span where a capped content layer
    changes (timeline content_alive, S6); a still run that starts within one frame after a beat landing (timeline
    beats {bpm, t0}, card energy.beat 'landings') and lasts at most one beat is a rest; the film's final still run is
    excused up to P (the poster). Declared holds neither exempt frames nor add to the share. Limits, poster, hook,
    alive and rest numbers come from registers.json. Returns the numbers and [(level, text)] verdicts."""
    R, t, n = registers(), fd["t"], len(fd["t"])
    dt = 1.0 / fd["rate"]
    still, runs = still_runs(fd)
    holds = tl["holds"] if tl else []
    allowed = card_get(card, "motion.holds.alive") if card else None
    allowed = {allowed} if isinstance(allowed, str) else set(allowed or [])
    alive, rest = [False] * n, [False] * n
    for h in holds:
        if h.get("alive") in allowed:
            for k in range(n):
                if still[k] and h["start"] <= t[k] - dt / 2 <= h["end"]:
                    alive[k] = True
    if str(measured).startswith("the content pass"):  # S6: there only the hidden capped layer changed
        for a, b in (tl or {}).get("content_alive") or []:
            for k in range(n):
                if still[k] and a <= t[k] - dt / 2 <= b:
                    alive[k] = True
    final = runs[-1] if runs and runs[-1]["last"] else None
    beats, beat_mode = (tl or {}).get("beats"), card_get(card, "energy.beat") if card else None
    rp = R["pacing"]["rest"]
    if beats and beat_mode == "landings":
        step = 60.0 / beats["bpm"]
        marks = [beats["t0"] + q * step for q in range(math.ceil(-beats["t0"] / step - 1e-9),
                                                       int((dur - beats["t0"]) / step) + 2)]
        for r in runs:
            if r is not final and r["dur"] <= rp["max_beats"] * step + dt / 2 and any(
                    -dt / 2 <= r["start"] - x <= rp["start_within_frames"] * dt + dt / 2 for x in marks):
                for k in range(r["i"], r["j"] + 1):
                    rest[k] = not alive[k]
    P = poster_allowance(dur, fmt)
    count = [still[k] and not alive[k] and not rest[k] for k in range(n)]
    if final and P > 0:
        cand = [k for k in range(final["i"], final["j"] + 1) if count[k]]
        for k in cand[max(0, len(cand) - int(round(P / dt))):]:
            count[k] = False
    share, alive_s, rest_s = sum(count) / n, sum(alive) / n, sum(rest) / n
    # the poster's printed length: the final run from its start (extended like the hook's) to the film's end, less
    # alive-held time, up to P
    poster_s = min(P, max(0.0, dur - final["start"] - dt * sum(alive[final["i"]:final["j"] + 1]))) if final and P > 0 else 0.0
    warn, fail, prov = frozen_lines(reg, fmt)
    on, window, run_min = hook_rule(reg, fmt, dur)
    # the hook reads what the share counts (alive-held and rest frames are not frozen), the final run left out whole
    frozen = [still[k] and not alive[k] and not rest[k] and not (final and final["i"] <= k <= final["j"]) for k in range(n)]
    hook = []
    for r in runs:
        k = r["i"]
        while k <= r["j"]:
            if not frozen[k]:
                k += 1
                continue
            j = k
            while j + 1 <= r["j"] and frozen[j + 1]:
                j += 1
            a = r["start"] if k == r["i"] else round(t[k] - dt, 3)
            b = r["end"] if j == r["j"] else round(t[j], 3)
            if a < window - 1e-9 and b - a >= run_min - 1e-9:
                hook.append({"start": a, "end": b, "dur": round(b - a, 3), "idle": r["idle"]})
            k = j + 1
    in_window = sum(max(0.0, min(t[k], window) - (t[k] - dt)) for k in range(n) if frozen[k])
    lg = max((r for r in runs if not all(alive[k] or rest[k] for k in range(r["i"], r["j"] + 1))),
             key=lambda r: r["dur"], default=None)  # an alive-held or rest run is not a frozen one
    setting = reg + (f", {fmt}" if fmt else "")
    V = []
    level = "FAIL" if share * 100 > fail + 1e-9 else "WARN" if share * 100 > warn + 1e-9 else "PASS"
    head = (f"frozen {share * 100:.1f}% of the film on {measured} (WARN above {warn:g}%, FAIL above {fail:g}% at "
            f"{setting}" + ("; the FAIL line is provisional until the stillness calibration, spec 2.6" if prov else "") + ")")
    if level == "PASS":
        V.append(("PASS", head + f"; alive {alive_s * 100:.0f}%, beat rests {rest_s * 100:.0f}%"))
    else:
        V.append((level, head + ": the picture does not change on that share whatever is declared; cut the dead time "
                  "or give it motion, never relabel it (S9)"))
    if alive_s * 100 > R["pacing"]["alive_share_warn_pct"] + 1e-9:
        V.append(("WARN", f"alive frames (alive holds, capped content layers) take {alive_s * 100:.0f}% of the film, "
                  f"over {R['pacing']['alive_share_warn_pct']}%: an alive hold is still a hold; cut it to what its purpose "
                  "needs (S9.4, S6)"))
    if rest_s * 100 > rp["share_warn_pct"] + 1e-9:
        V.append(("WARN", f"beat rests take {rest_s * 100:.0f}% of the film, over {rp['share_warn_pct']}% (S9.5)"))
    if on:
        why = "energetic" if R["registers"][reg]["hook"] else f"a {fmt}"
        for r in hook:
            V.append(("FAIL", f"hook: a {'repeating (idle)' if r['idle'] > 0.5 else 'frozen'} run {r['start']:.2f}-"
                      f"{r['end']:.2f}s ({r['dur']:.2f} s) starts inside the first {window:g} s of {why} film: the hook "
                      "must move; open on motion that reads (S9.8)"))
    if fmt == "loop" and loop_levels is not None and loop_levels >= R["formats"]["loop"]["seam_fail_levels"]:
        V.append(("FAIL", f"loop seam: the last frame differs from the first by {loop_levels:.1f} levels (mean): a loop's "
                  "last frame must lead into its first (S9.7)"))
    if beat_mode == "landings" and (tl or {}).get("odd_beats"):
        V.append(("NOTE", "the card counts beat landings, but the timeline's beats are not {bpm, t0} with 0 < bpm <= 600: "
                  "no rests are set apart (S9.5)"))
    nums = {"measured": measured, "file": fd["path"], "register": reg, "format": fmt, "warn_pct": warn, "fail_pct": fail,
            "fail_provisional": prov, "frozen_share": round(share, 4), "alive_share": round(alive_s, 4),
            "rest_share": round(rest_s, 4), "still_share": round(sum(still) / n, 4),
            "energy_still_share": round(sum(1 for e in fd["energy"] if e < FROZEN_E) / n, 4),  # energy term only (2.6)
            "idle_share": round(sum(fd["idle"]) / n, 4), "poster_allowance_s": round(P, 3),
            "poster_s": round(poster_s, 3), "hook": {"applies": on, "window_s": round(window, 3),
                                                             "frozen_s": round(in_window, 3),
                                                             "runs": [{k: r[k] for k in ("start", "end", "dur")}
                                                                      for r in hook]},
            "longest_run": {k: lg[k] for k in ("start", "end", "dur")} if lg else None, "verdict": level,
            "loop_seam_levels": None if loop_levels is None else round(loop_levels, 2),
            "runs": [dict({k: r[k] for k in ("start", "end", "dur", "idle")}, alive=all(alive[r["i"]:r["j"] + 1]),
                          rest=all(rest[r["i"]:r["j"] + 1]), final=r is final) for r in runs]}
    nums["line"] = (f"frozen {share * 100:.1f}% (WARN {warn:g}%, FAIL {fail:g}% at {setting}"
                    + (", provisional" if prov else "") + f"), alive {alive_s * 100:.1f}%, beat rests {rest_s * 100:.1f}%, "
                    f"poster {nums['poster_s']:.2f} of {P:.2f} s, longest frozen run "
                    + (f"{lg['dur']:.2f} s at {lg['start']:.2f}-{lg['end']:.2f}s" if lg else "none")
                    + f", frozen in the hook window (first {window:g} s) {in_window:.2f} s; measured on {measured}")
    nums["_still"], nums["_alive"], nums["_rest"], nums["_runs"] = still, alive, rest, runs
    return nums, V


def measured_picture(m, tl):
    """(Media, label, problem): the timeline's content pass when it exists and matches the delivered film's length and
    rate, else the delivered picture (S9.1); problem is the WARN text when a named content pass cannot be used."""
    cp = tl.get("content_pass") if tl else None
    if not cp:
        return m, "the delivered picture", None
    if not os.path.isfile(cp):
        return m, "the delivered picture", f"the timeline's content pass {cp} does not exist: measured the delivered picture"
    try:
        mc = Media(cp)
    except ToolError as e:  # an optional input: a render killed before its first frame leaves an empty file
        return m, "the delivered picture", (f"the content pass {os.path.basename(cp)} cannot be read "
                                            f"({str(e).rsplit(': ', 1)[-1]}): measured the delivered picture")
    if not mc.v or abs(mc.duration - m.duration) > 1.5 * m.frame_dur() or abs((mc.fps or 0) - m.fps) > 0.01:
        return m, "the delivered picture", (f"the content pass {os.path.basename(cp)} ({mc.duration:.3f} s, {mc.fps:.3g} fps) "
                                            f"is not this render ({m.duration:.3f} s, {m.fps:.3g} fps): measured the "
                                            "delivered picture")
    return mc, f"the content pass ({os.path.basename(cp)})", None


def pacing_checks(m, tl, md, register=None, fmt=None, alpha=False, max_share=None):
    """Spec S9, S10 and S16's hold checks for one film: which picture is measured, the frozen share and what is set
    apart from it, hook, loop and overlay rules, undeclared still runs (WARN, never FAIL: relabelling buys nothing),
    each hold's need and maximum, and alive holds (as declared, their read box, fully still). Returns
    ([(level, check, text)], data)."""
    V = []
    reg, fmt, notes = film_settings(tl, register, fmt)
    V += [("NOTE", "pacing", x) for x in notes]
    sid = tl.get("style") if tl else None
    card = shipped_cards().get(sid) if sid else None
    fr, dur = m.frame_dur(), m.duration
    hd = hold_data(tl["holds"], dur, fr, reg, fmt, max_share) if tl else None
    data = {"register": reg, "format": fmt, "style": sid, "card": "shipped" if card else "run-time" if sid else None,
            "holds": hd, "pacing": None, "frozen": None}
    holds = tl["holds"] if tl else []
    fd = None
    skips = registers()["formats"].get(fmt or "", {}).get("frozen_share") is False  # overlay (registers.json)
    if skips and alpha:
        V.append(("NOTE", "pacing", f"an {fmt} whose alpha channel the probe confirms: the frozen share is skipped, and "
                  "each hold is still checked against its need (S9.7)"))
    else:
        if skips:
            V.append(("NOTE", "pacing", f"format {fmt}, but no alpha channel was confirmed (pack checks it with --kind "
                      "alpha): the frozen share is measured as for any film"))
        mp, label, problem = measured_picture(m, tl)
        tw, th = (tl["width"], tl["height"]) if tl and tl["width"] and tl["height"] else (m.w, m.h)

        def read_boxes(p):  # alive holds' read boxes in picture p's px (S16)
            sx, sy, out = p.w / max(1, tw), p.h / max(1, th), {}
            for i, h in enumerate(holds):
                if h.get("alive") and h.get("read_box"):
                    x0, y0, x1, y1 = h["read_box"]
                    b = (max(0, int(x0 * sx)), max(0, int(y0 * sy)), min(p.w, int(math.ceil(x1 * sx))),
                         min(p.h, int(math.ceil(y1 * sy))))
                    if b[2] - b[0] >= 2 and b[3] - b[1] >= 2:
                        out[i] = b
            return out
        try:
            fd = frozen_data(mp, tw * th, read_boxes(mp))
        except ToolError as e:
            if mp is m:
                raise
            # a content pass whose header reads but whose frames do not decode: measured like a missing one (S9.1)
            mp, label, problem = m, "the delivered picture", (f"the content pass {os.path.basename(mp.path)} cannot be "
                                                               f"measured ({str(e).rsplit(': ', 1)[-1]}): measured the "
                                                               "delivered picture")
            fd = frozen_data(m, tw * th, read_boxes(m))
        if problem:
            V.append(("WARN", "pacing", problem))
        pd, pv = pacing_data(fd, tl, reg, fmt, card, dur, label, seam_levels(mp) if fmt == "loop" else None)
        V += [(lv, "pacing", text) for lv, text in pv]
        data["pacing"], data["frozen"] = pd, fd
        dt = 1.0 / fd["rate"]
        runs = [dict(r) for r, x in zip(pd["_runs"], pd["runs"]) if r["dur"] >= MIN_RUN - 1e-9 and not x["alive"]
                and not x["rest"]]
        if tl:
            for r in classify_runs(runs, holds):
                if not r["planned"]:
                    V.append(("WARN", "pacing", f"undeclared still {run_span(r)}" + (", repeating" if r["idle"] > 0.5
                                                                                      else "")
                              + f", {r['outside']:.2f}s outside holds at "
                              + ", ".join(f"{x:.2f}-{y:.2f}s" for x, y in r["outside_spans"])
                              + ": a frozen stretch the timeline does not declare; declaring it changes nothing in the "
                              "frozen share (S9.9)"))
        elif runs:
            V.append(("WARN", "pacing", f"{len(runs)} still run(s) >= {MIN_RUN:g} s and no timeline to tell holds from "
                      "freezes: " + ", ".join(run_span(r) for r in runs)))
        # S16: alive holds as declared, read text inside the read box still, an alive hold that shows nothing
        allowed = card_get(card, "motion.holds.alive") if card else None
        allowed = {allowed} if isinstance(allowed, str) else set(allowed or [])
        dfd = None
        for i, h in enumerate(holds):
            if not h.get("alive"):
                continue
            span = f"{h['start']:.2f}-{h['end']:.2f}s"
            if h["alive"] in allowed:
                V.append(("NOTE", "holds", f"hold {span} alive as declared ({h['alive']})"))
            else:
                V.append(("NOTE", "holds", f"hold {span} declares alive '{h['alive']}', which "
                          + (f"the shipped {sid} card does not allow" if card else "no shipped style card allows")
                          + ": its still frames count as frozen (S9.4)"))
            ks = [k for k, x in enumerate(fd["t"]) if h["start"] <= x - dt / 2 <= h["end"]]
            if i in fd["boxes"] and ks:
                mov = sum(1 for k in ks if fd["boxes"][i][k] >= fd["threshold_px"]) / len(ks)
                if mov > READ_MOVING + 1e-9:
                    V.append(("WARN", "holds", f"read text in hold {span}'s read box moves on {mov * 100:.0f}% of the hold: "
                              "while the hold is alive, its read text holds still (S16)"))
            if dfd is None:
                dfd = fd if mp is m else frozen_data(m, tw * th, idle=False)
            dk = [k for k, x in enumerate(dfd["t"]) if h["start"] <= x - dt / 2 <= h["end"]]
            if dk and all(dfd["frozen"][k] for k in dk):
                V.append(("NOTE", "holds", f"alive hold {span} ({h['alive']}) measures fully still on the delivered "
                          "picture: its loop is too small to see"))
    for h in (md or {}).get("hold_still", []):  # a still hold that drifts: alive holds report above instead
        src = next((x for x in holds if abs(x["start"] - h["start"]) < 1e-9 and abs(x["end"] - h["end"]) < 1e-9), {})
        if h["still"] < 0.5 and not src.get("alive"):
            V.append(("NOTE", "holds", f"hold {h['start']:.2f}-{h['end']:.2f}s is near-static for only "
                      f"{h['still'] * 100:.0f}% of its span: drift during a hold, or a mistimed hold"))
    if hd:
        V += [(lv, "holds", text) for lv, text in hd["issues"]]
    return V, data


# ---------------------------------------------------------------- layout (S12)
LAYOUT_FRAMES, LAYOUT_W = 12, 320  # evenly spaced grey frames this wide
INK_LEVELS = 24      # ink: a central-difference gradient |dx| + |dy| of this many levels or more
BAND_EMPTY = 0.25    # an edge band wider than this share of the frame with no ink is empty
OFF_BALANCE = 0.08   # the ink centroid this share of the width from the centre is off balance
DOMINANT_MIN = 0.40  # small subject: the content box's larger side under this share of the frame's larger side (a
                     # shipped card's composition.dominant_min, or composition.dominant[0], replaces it)


def ink_box(px, W, H):
    """S12 on one grey frame (W x H bytes): ink pixels have |dx| + |dy| >= INK_LEVELS (central differences); returns
    the content box (the 2.5-97.5 percentile of ink mass on each axis) in px, the ink-weighted centroid x and the ink
    count, or None for a frame with no ink."""
    cols, rows, tot, sx = [0] * W, [0] * H, 0, 0
    for y in range(1, H - 1):
        up, row, dn = px[(y - 1) * W:y * W], px[y * W:(y + 1) * W], px[(y + 1) * W:(y + 2) * W]
        k = 0
        for x, on in enumerate((abs(a - b) + abs(c - d) >= INK_LEVELS
                                for a, b, c, d in zip(row[2:], row[:-2], dn[1:-1], up[1:-1])), 1):
            if on:
                cols[x] += 1
                sx += x
                k += 1
        rows[y], tot = k, tot + k
    if not tot:
        return None

    def pct(v, q):
        acc = 0
        for i, x in enumerate(v):
            acc += x
            if acc >= q * tot:
                return i
        return len(v) - 1
    return (pct(cols, 0.025), pct(rows, 0.025), pct(cols, 0.975), pct(rows, 0.975)), sx / tot, tot


def layout_frames(m, alpha, stills=None, times=None):
    """[(t, W, H, grey bytes, alpha box or None)] for the LAYOUT_FRAMES evenly spaced frames at LAYOUT_W px (or at
    `times`, S18's beat midpoints). An alpha picture is composited over mid grey, and each frame carries the box of its
    pixels with alpha 16 or more. stills: [(t, image path)] measured instead, one frame each (c2v.py check's beat
    midpoints, spec 4.4)."""
    H = even(LAYOUT_W * m.h / max(1, m.dw))
    times = times if times is not None else [(k + 0.5) * m.duration / LAYOUT_FRAMES for k in range(LAYOUT_FRAMES)]
    jobs = stills or [(t, m.path) for t in times]
    dec = ["-c:v", "libvpx-vp9"] if alpha and m.v.get("codec_name") == "vp9" else []

    def one(job):
        (t, path), fmt = job, "rgba" if alpha else "gray"
        seek = [] if stills else ["-ss", f"{t:.3f}"]
        raw = run(FF + ["-loglevel", "error"] + seek + dec + ["-i", path, "-frames:v", "1", "-an", "-vf",
                  f"scale={LAYOUT_W}:{H},format={fmt}", "-f", "rawvideo", "-"], binary=True).stdout
        if not alpha:
            return t, LAYOUT_W, H, raw[:LAYOUT_W * H], None
        g, box = bytearray(LAYOUT_W * H), [LAYOUT_W, H, -1, -1]
        for i in range(min(len(raw) // 4, LAYOUT_W * H)):
            r, gg, b, al = raw[4 * i:4 * i + 4]
            g[i] = int(((0.299 * r + 0.587 * gg + 0.114 * b) * al + 128 * (255 - al)) / 255 + 0.5)
            if al >= 16:
                x, y = i % LAYOUT_W, i // LAYOUT_W
                box = [min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)]
        return t, LAYOUT_W, H, bytes(g), box if box[2] >= box[0] else None
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(6, os.cpu_count() or 4)) as ex:
        return list(ex.map(one, jobs))


def layout_data(m, tl, alpha=False, stills=None):
    """Spec S12: on LAYOUT_FRAMES evenly spaced frames, WARN an empty edge band (over BAND_EMPTY of the frame) on at
    least half the frames, an off-balance centroid (over OFF_BALANCE of the width) on at least half, and a small subject
    (the box's larger side under the dominant minimum) on at least half. A shipped card's composition waives fully
    (emptiness: the band; asymmetric or off-centre balance: the centroid, as a NOTE) and sets the dominant minimum;
    the film's own declaration (the timeline's composition, from plan.md or a run-time card) excuses at most half the
    frames. An alpha overlay is measured inside its alpha box, or skipped when that box is under the overlay format's
    share of the frame; a 9:16 frame's bands start at its clear box. Every waiver prints as a share of frames.
    Returns ([(level, text)], data)."""
    sid = tl.get("style") if tl else None
    card = shipped_cards().get(sid) if sid else None
    comp, own = card_get(card, "composition") or {}, (tl or {}).get("composition") or {}
    dmin = comp.get("dominant_min", (comp.get("dominant") or [None])[0] if isinstance(comp.get("dominant"), list) else None)
    dmin = float(dmin) if numeric(dmin) and 0 < dmin <= 1 else DOMINANT_MIN
    V, frames = [], layout_frames(m, alpha, stills)
    data = {"frames": [], "dominant_min": dmin, "card": sid if card else None, "alpha_box": None, "skipped": None,
            "warned": []}
    crop = None
    if alpha:
        bxs = [f[4] for f in frames if f[4]]
        if bxs:
            crop = (min(b[0] for b in bxs), min(b[1] for b in bxs), max(b[2] for b in bxs) + 1, max(b[3] for b in bxs) + 1)
        W0, H0 = frames[0][1], frames[0][2]
        share = (crop[2] - crop[0]) * (crop[3] - crop[1]) / (W0 * H0) if crop else 0.0
        data["alpha_box"] = [round(crop[0] / W0, 3), round(crop[1] / H0, 3), round(crop[2] / W0, 3),
                             round(crop[3] / H0, 3)] if crop else None
        least = registers()["formats"]["overlay"]["layout_min_alpha_box_pct"]
        if share * 100 < least:
            data["skipped"] = f"alpha box {share * 100:.0f}% of the frame"
            return [("NOTE", f"layout skipped: the overlay's alpha box covers {share * 100:.0f}% of the frame, under "
                     f"{least}% (S12)")], data
    res = []
    for t, W, H, px, _ in frames:
        if crop:  # measure inside the alpha box: crop the grey frame
            cw, ch = crop[2] - crop[0], crop[3] - crop[1]
            px = b"".join(px[(crop[1] + y) * W + crop[0]:(crop[1] + y) * W + crop[2]] for y in range(ch))
            W, H = cw, ch
        got = ink_box(px, W, H) if W >= 3 and H >= 3 else None
        if not got:
            res.append((t, None))
            data["frames"].append({"t": round(t, 3), "box": None})
            continue
        (x0, y0, x1, y1), cx, _ = got
        b0, b1, b2, b3 = (None if crop else clear_box(W, H)) or (0, 0, W, H)
        r = {"left": (x0 - b0) / W, "right": (b2 - 1 - x1) / W, "top": (y0 - b1) / H, "bottom": (b3 - 1 - y1) / H,
             "off": (cx - W / 2) / W, "major": max(x1 - x0, y1 - y0) / max(W, H)}
        res.append((t, r))
        ox, oy, fw, fh = (crop[0], crop[1], frames[0][1], frames[0][2]) if crop else (0, 0, W, H)
        data["frames"].append({"t": round(t, 3), "box": [round((ox + x0) / fw, 3), round((oy + y0) / fh, 3),
                                                         round((ox + x1) / fw, 3), round((oy + y1) / fh, 3)],
                               "centroid_x": round((ox + cx) / fw, 3), "bands": {k: round(r[k], 3) for k in
                                                                                 ("left", "right", "top", "bottom")},
                               "off": round(r["off"], 3), "major": round(r["major"], 3)})
    inked = [r for _, r in res if r]
    n, blank = len(inked), len(res) - len(inked)
    if not n:
        return [("NOTE", f"layout: no ink on any of {len(res)} frames (blank frames)")], data
    half = n / 2.0
    pct_rng = lambda vals: (f"{min(vals) * 100:.0f}-{max(vals) * 100:.0f}%" if round(min(vals) * 100) != round(max(vals) * 100)
                            else f"{min(vals) * 100:.0f}%")

    def waive(k, what, shipped_ok, own_ok, warn_text, rule):
        """The verdict for a rule broken on k of n frames, given a shipped and the film's own waiver."""
        if shipped_ok:
            V.append(("NOTE", f"{warn_text}: excused by the shipped {sid} card's {what} ({k} of {n} frames waived)"))
        elif own_ok and k <= half:
            V.append(("NOTE", f"{warn_text}: excused by the film's declared {what} ({k} of {n} frames waived; a "
                      "declaration excuses at most half)"))
        else:
            V.append(("WARN", warn_text + (f"; the film's declared {what} excuses at most {int(half)} of {n} frames, "
                                           "only a shipped card more" if own_ok else "") + " (S12)"))
            data["warned"].append(rule)
    flags = {i: [] for i in range(len(res))}
    for side, dim in (("left", "width"), ("right", "width"), ("top", "height"), ("bottom", "height")):
        hit = [r[side] for _, r in res if r and r[side] > BAND_EMPTY]
        for i, (_, r) in enumerate(res):
            if r and r[side] > BAND_EMPTY:
                flags[i].append(f"{side} band")
        if hit and len(hit) >= half:
            waive(len(hit), "emptiness", comp.get("emptiness") is True, own.get("emptiness") is True,
                  f"{side} band empty ({pct_rng(hit)} of the {dim}) on {len(hit)} of {n} frames: the subject leaves that "
                  "side of the frame unused; fill or recentre it", f"{side} band")
    off = [r["off"] for _, r in res if r and abs(r["off"]) > OFF_BALANCE]
    for i, (_, r) in enumerate(res):
        if r and abs(r["off"]) > OFF_BALANCE:
            flags[i].append("off balance")
    if off and len(off) >= half:
        side = "left" if sum(1 for x in off if x < 0) * 2 >= len(off) else "right"
        asym = ("asymmetric", "off-centre", "off-center")
        waive(len(off), "asymmetric balance", comp.get("balance") in asym, own.get("balance") in asym,
              f"off balance: the ink centroid sits {pct_rng([abs(x) for x in off])} of the width {side} of centre on "
              f"{len(off)} of {n} frames: recentre it unless the asymmetry is the design",
              "off balance")
    small = [r["major"] for _, r in res if r and r["major"] < dmin]
    for i, (_, r) in enumerate(res):
        if r and r["major"] < dmin:
            flags[i].append("small subject")
    if small and len(small) >= half:
        V.append(("WARN", f"small subject: the content box's larger side is {pct_rng(small)} of the frame's larger side on "
                  f"{len(small)} of {n} frames, under {dmin * 100:.0f}%" + (f" (the {sid} card's minimum)" if card and
                                                                           dmin != DOMINANT_MIN else "")
                  + ": the dominant element should own the frame (S12)"))
        data["warned"].append("small subject")
    for i, f in enumerate(data["frames"]):
        f["flags"] = flags[i]
    if not any(lv == "WARN" for lv, _ in V):
        V.insert(0, ("PASS", f"no empty band, off-balance centroid or small subject on half or more of {n} frames"
                     + (f" ({blank} blank)" if blank else "") + (" inside the overlay's alpha box" if crop else "")))
    return V, data


# ---------------------------------------------------------------- repetition (S18)
LAYOUT_SAME = 0.05   # two beats share a layout when every edge of their content boxes agrees within this share of the frame
SAME_RUN = 3         # this many beats in a row with one layout WARN


def native_seam(kind, native):
    """Whether a seam's device is the card's native one: its words appear in the card's free-text seams.native."""
    words = re.findall(r"[a-z0-9]+", kind.lower())
    return bool(words) and all(re.search(rf"\b{re.escape(w)}", native.lower()) for w in words)


def repetition_checks(m, tl, alpha=False):
    """Spec S18 [(level, text)]: SAME_RUN or more beats (timeline scenes) in a row whose content boxes (S12's ink box, on
    the frame at each beat's midpoint) agree within LAYOUT_SAME WARN; a seam device used again against the shipped card's
    seams.repeat (each-once: no device twice; native-may-repeat: only the card's native device repeats) WARNs; with no
    shipped card, or none that sets the rule, one device on more than half the seams (and on two or more) WARNs."""
    V, scenes = [], (tl or {}).get("scenes") or []
    if len(scenes) >= SAME_RUN:
        boxes = []
        for t, W, H, px, _ in layout_frames(m, alpha, times=[(sc["start"] + sc["end"]) / 2 for sc in scenes]):
            got = ink_box(px, W, H) if W >= 3 and H >= 3 else None
            boxes.append((got[0][0] / W, got[0][1] / H, got[0][2] / W, got[0][3] / H) if got else None)
        k = 0
        while k < len(boxes):
            j = k
            while boxes[k] and j + 1 < len(boxes) and boxes[j + 1] and all(
                    abs(x - y) <= LAYOUT_SAME + 1e-9 for x, y in zip(boxes[k], boxes[j + 1])):
                j += 1
            if j - k + 1 >= SAME_RUN:
                V.append(("WARN", f"same layout in beats {k + 1}-{j + 1} ({', '.join(sc['id'] for sc in scenes[k:j + 1])}): "
                          f"their content boxes agree within {LAYOUT_SAME * 100:.0f}% of the frame; change the composition "
                          "from beat to beat (S18)"))
            k = j + 1
    seams = (tl or {}).get("seams") or []
    if seams:
        count = {}
        for x in seams:
            count[x["kind"]] = count.get(x["kind"], 0) + 1
        sid = tl.get("style")
        card = shipped_cards().get(sid) if sid else None
        rule, native = card_get(card, "seams.repeat"), str(card_get(card, "seams.native") or "")
        for kind, n in sorted(count.items(), key=lambda x: (-x[1], x[0])):
            if rule in ("each-once", "native-may-repeat"):
                if n >= 2 and not (rule == "native-may-repeat" and native_seam(kind, native)):
                    V.append(("WARN", f"{kind} on {n} seams: the {sid} card's seams.repeat is {rule}"
                              + (f" (only its native device, {native}, repeats)" if rule == "native-may-repeat" else "")
                              + "; join the beats by what changes (S18)"))
            elif n >= 2 and n * 2 > len(seams):
                V.append(("WARN", f"{kind} on {n} of {len(seams)} seams: one device on most seams is a template; join the "
                          "beats by what changes (S18)"))
    return V


def alpha_confirmed(m):
    """True when the alpha probe (references/overlay.md) finds see-through pixels: an overlay then skips the frozen share (S9.7)
    and is measured inside its alpha box (S12)."""
    facts, _ = probe_data(m, "alpha")
    return bool(facts.get("alpha")) and any(x["see_through"] > 0 for x in facts["alpha"])


def cmd_layout(a):
    stills = None
    if len(a.file) > 1 or a.file[0].lower().endswith(".png"):  # c2v.py check: render.mjs --stills names still-<t>s.png
        stills = [(float(t.group(1)) if t else k, f) for k, f in enumerate(a.file)
                  for t in [re.search(r"still-(\d+(?:\.\d+)?)s\.png$", f)]]
    m = Media(a.file[0])
    if not m.v:
        raise ToolError(f"{a.file[0]}: no video stream")
    tl = load_timeline(a.timeline)
    V, data = layout_data(m, tl, a.kind == "alpha" and alpha_confirmed(m), stills)
    if a.json:
        print(json.dumps({"verdicts": [{"level": lv, "text": t} for lv, t in V], "layout": data}, indent=1))
    else:
        for f in data["frames"]:
            print(f"{f['t']:7.3f}s " + ("no ink" if not f.get("box") else
                                        f"box {f['box']} centroid {f['centroid_x']:.3f} bands {f['bands']} "
                                        f"{', '.join(f['flags']) or 'ok'}"))
        for lv, t in V:
            print(f"{lv} layout: {t}")
    return 0


def classify_runs(runs, holds):
    """A still run is planned when it overlaps a declared hold and < HOLD_SLACK of it lies outside all holds."""
    merged = merge_intervals([(h["start"], h["end"]) for h in holds])
    for r in runs:
        spans = outside_spans(r["start"], r["end"], merged)
        outside = sum(b - a for a, b in spans)
        r["outside"], r["outside_spans"] = round(outside, 3), spans
        r["planned"] = bool(merged) and r["dur"] - outside > 1e-6 and outside < HOLD_SLACK
        best = max(holds, key=lambda h: min(h["end"], r["end"]) - max(h["start"], r["start"]), default=None)
        r["hold"] = best["purpose"] if best and min(best["end"], r["end"]) > max(best["start"], r["start"]) else ""
    return runs


_LATIN = re.compile(r"[0-9A-Za-z\u00c0-\u024f]+(?:['\u2019-][0-9A-Za-z\u00c0-\u024f]+)*")
SCRIPT_KEYS = (("latin_words", "word", "words", "latin_s_per_word"), ("chinese_chars", "Chinese character",
               "Chinese characters", "chinese_chars_per_s"), ("japanese_chars", "Japanese character", "Japanese characters",
               "japanese_chars_per_s"), ("korean_syllables", "Korean syllable", "Korean syllables",
               "korean_syllables_per_s"))


def script_counts(text):
    """Per-script counts of read text (S10): Latin-script words; Chinese characters; Japanese characters (kana, and the
    Han characters of a text that has kana); Korean syllables."""
    kana = sum(1 for ch in text if "\u3040" <= ch <= "\u30ff")
    han = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff" or "\u3400" <= ch <= "\u4dbf")
    return {"latin_words": len(_LATIN.findall(text)), "chinese_chars": 0 if kana else han,
            "japanese_chars": kana + han if kana else 0,
            "korean_syllables": sum(1 for ch in text if "\uac00" <= ch <= "\ud7a3")}


def is_selector(s):
    """Whether a hold's `read` names an element (render.mjs measures its text, S8) rather than giving the text."""
    return bool(re.match(r"^\s*[#.\[]|^[A-Za-z][\w-]*[#.\[]", s))


EXPORTED = "render.mjs's measure"  # what a hold's need was counted from when only its exported need is known (S8)


def need_text(counted, need):
    """'5 words need 1.5 s', or 'need 1.5 s (render.mjs's measure)' when only the exported need is known."""
    return f"need {need:.1f} s ({EXPORTED})" if counted == EXPORTED else f"{counted} need {need:.1f} s"


def hold_need(h):
    """(kind, need in s or None, what was counted) for a declared hold (S10). read: max(1.0 s, the read text's words x
    0.3 s plus Chinese characters / 7, Japanese / 4 and Korean syllables / 12 per second), from render.mjs's counts,
    else its read_text, else its exported need; chart: 1.2 s + 0.3 s per labelled value (counts.values, else the
    exported need); logo: 1.0 s; breath: none. Numbers from registers.json."""
    H = registers()["holds"]
    counts = h.get("counts") or {}
    sc = {k: counts[k] for k, *_ in SCRIPT_KEYS if counts.get(k)}
    text = h.get("read_text") or (h["read"] if h.get("read") and not is_selector(h["read"]) else None)
    if not sc and text:
        sc = {k: v for k, v in script_counts(text).items() if v}
    kind = h.get("kind") or ("chart" if h.get("chart") is not None else "logo" if h.get("logo") else
                             "read" if sc or text or h.get("read") or h.get("need") is not None else "breath")
    if kind == "read":
        if sc:
            rd = H["reading"]
            need = max(H["need_s"]["read_min"], sum(sc.get(k, 0) * (rd[r] if k == "latin_words" else 1.0 / rd[r])
                                                    for k, _, _, r in SCRIPT_KEYS))
            return kind, need, " + ".join(f"{sc[k]:g} {one if sc[k] == 1 else many}" for k, one, many, _ in SCRIPT_KEYS
                                          if sc.get(k))
        if h.get("need") is not None:
            return kind, max(H["need_s"]["read_min"], h["need"]), EXPORTED
        return kind, None, "read text the timeline does not carry"
    if kind == "chart":
        if counts.get("values") is None and h.get("need") is not None:  # render.mjs measured it (S8)
            return kind, h["need"], EXPORTED
        v = counts.get("values", 0)
        return kind, H["need_s"]["chart"] + H["need_s"]["chart_per_value"] * v, f"a chart with {v:g} labelled values"
    if kind == "logo":
        return kind, H["need_s"]["logo"], "a logo"
    return "breath", None, "nothing to read"


def hold_data(holds, dur, fr, reg="neutral", fmt=None, max_share=None):
    """Spec S10: each declared hold's need and maximum, from what it is for: read, chart and logo holds at most 2 x
    their need; a breath (nothing to read) at most the register's breath cap; the final hold (the one that reaches the
    end) at most max(P, 2 x need), P being S9's poster allowance. Every hold over its cap WARNs, never FAILs: the
    frozen share (S9) is the binding pacing measure. Also the share of the film the holds cover (touching holds count
    as one): over max_share besides the final hold's poster part it is a NOTE (S9.9). Returns the numbers and
    [(level, text)] issues."""
    R = registers()
    max_share = registers()["pacing"]["declared_hold_share_note_pct"] / 100.0 if max_share is None else max_share
    spans = []  # [start, end, purposes], cut to the film
    for h in sorted(holds, key=lambda x: x["start"]):
        a, b = max(0.0, h["start"]), min(dur, h["end"])
        if b - a <= 1e-6:
            continue
        if spans and a <= spans[-1][1] + 1e-6:
            spans[-1][1] = max(spans[-1][1], b)
            spans[-1][2].append(h["purpose"])
        else:
            spans.append([a, b, [h["purpose"]]])
    held = sum(b - a for a, b, _ in spans)
    P = poster_allowance(dur, fmt)
    final_span = spans[-1] if spans and spans[-1][1] >= dur - 1.5 * fr else None
    poster = min(final_span[1] - final_span[0], P) if final_span else 0.0
    share, counted = round(held / max(dur, 1e-6), 3), round((held - poster) / max(dur, 1e-6), 3)  # one value for every text
    what = lambda s: " + ".join(p for p in s[2] if p) or "-"
    issues, rows = [], []
    if counted > max_share + 1e-9:
        issues.append(("NOTE", f"declared holds cover {share * 100:.0f}% of the film"
                       + (f" ({counted * 100:.0f}% not counting {poster:.2f} s of the final hold, the poster)" if poster else "")
                       + f", over {max_share * 100:g}%: a declared hold is still a still frame, and the frozen share counts "
                       "it as one (S9.9)"))
    cut = [h for h in holds if min(dur, h["end"]) - max(0.0, h["start"]) > 1e-6]
    last = max(cut, key=lambda h: (h["end"], h["start"]), default=None)
    breath, k = R["registers"][reg]["breath_cap_s"], R["holds"]["cap_x_need"]
    for h in cut:
        a, b = max(0.0, h["start"]), min(dur, h["end"])
        d = b - a
        kind, need, counted_what = hold_need(h)
        base = k * need if need is not None else breath if kind == "breath" else None
        final = h is last and b >= dur - 1.5 * fr
        cap = max(P, base or 0.0) if final else base
        rows.append({"start": round(a, 3), "end": round(b, 3), "dur": round(d, 3), "kind": kind,
                     "need": None if need is None else round(need, 3), "cap": None if cap is None else round(cap, 3),
                     "counted": counted_what, "final": final, "over": cap is not None and d > cap + 1e-6,
                     "purpose": h["purpose"], "alive": h.get("alive")})
        span = f"{a:.2f}-{b:.2f}s"
        if kind == "breath" and not h.get("kind"):
            issues.append(("WARN", f"hold {span} ({h['purpose'] or 'no purpose'}): give this hold its read text or a kind "
                           "(read, chart, logo, breath), so its need can be measured (S10)"))
        if cap is None:
            issues.append(("NOTE", f"hold {span} reads {h.get('read', 'its text')!r}, but the timeline carries no "
                           "measured read text (render.mjs exports read_text and counts, S8): its maximum is not checked"))
        elif d > cap + 1e-6:
            if final:
                why = (f"{need_text(counted_what, need)}; at most {cap:.1f} s" if need is not None
                       else f"nothing to read; at most {cap:.1f} s") + (f" (the {P:g} s poster allowance)"
                                                                         if P >= (base or 0.0) and P > 0 else "")
                issues.append(("WARN", f"final hold {d:.2f} s: {why}: end on the finished frame sooner, or keep it "
                               "moving (S10)"))
            elif need is not None:
                issues.append(("WARN", f"hold {span} lasts {d:.2f} s: {need_text(counted_what, need)}; at most "
                               f"{cap:.1f} s: cut it to what its purpose needs, or give the time to motion (S10)"))
            else:
                issues.append(("WARN", f"hold {span} lasts {d:.2f} s with nothing to read (a breath): at most {cap:g} s "
                               f"at {reg} (S10)"))
    lg = max(spans, key=lambda s: s[1] - s[0], default=None)
    return {"duration": round(dur, 3), "held": round(held, 3), "share": share, "poster": round(poster, 3),
            "counted": counted, "max_share": max_share, "allowance": round(P, 3), "holds": rows,
            "longest": {"start": round(lg[0], 3), "end": round(lg[1], 3), "dur": round(lg[1] - lg[0], 3),
                        "purpose": what(lg)} if lg else None, "issues": issues}


def holds_line(hd):
    """Each hold's kind, need and maximum, as the summary prints them (S10)."""
    return "; ".join(f"{r['start']:.2f}-{r['end']:.2f}s {r['kind']}" + (f" ({r['alive']})" if r.get("alive") else "")
                     + (f": {need_text(r['counted'], r['need'])}" if r["need"] is not None else "")
                     + (f", at most {r['cap']:.1f} s" if r["cap"] is not None else "")
                     + (" (final)" if r["final"] else "") + (" OVER" if r["over"] else "") for r in hd["holds"]) or "none"


KIND_WINDOW = 0.25  # a planned land, transition or wave is looked for within this much of its time (s)
PEAK_SHARE = 0.95   # a change within 5% of a transition's largest is its peak too: an ease-in-out has a flat top
KIND_LOOK = {"land": "no landing (the first still frame after motion)", "transition": "no peak change",
             "wave": "no first change after stillness"}


def kind_event(e, md, steps=(), fps=30.0):
    """The picture moment a planned event of kind land, transition or wave names (S11 c), or None: land, the first
    still frame after a motion burst; transition, the frame of peak change (any within PEAK_SHARE of it); wave, the
    first change after stillness. Changes are measured drawing to drawing (judder holes filled), and inside a steps
    span stillness must outlast one drawing. The nearest moment to the plan within KIND_WINDOW wins."""
    t, d, rate = md["_t"], md["_dj30"], md["analysis_rate"]
    n = len(t)
    q = max([3] + [math.ceil(drawing_frames(x, rate, fps)) + 1 for x in near_spans(steps, e["t"], e["t"], 0.0)])
    idx = [k for k in range(n) if abs(t[k] - e["t"]) <= KIND_WINDOW + 1e-9]
    if not idx:
        return None
    if e["kind"] == "transition":
        top = max(d[i] for i in idx)
        if top < MOVING:
            return None
        k = min((i for i in idx if d[i] >= PEAK_SHARE * top), key=lambda i: (abs(t[i] - e["t"]), i))
        return {"t": round(t[k], 4), "kind": "transition", "mag": round(d[k], 2)}
    if e["kind"] == "land":
        cand = [k for k in idx if d[k] > FROZEN_E and max(d[max(0, k - 6):k + 1]) >= MOVING and k + 1 < n
                and all(x <= FROZEN_E for x in d[k + 1:k + 1 + q])]
    else:
        cand = [k for k in idx if d[k] > FROZEN_E and k >= q and all(x <= FROZEN_E for x in d[k - q:k])]
    if not cand:
        return None
    k = min(cand, key=lambda i: (abs(t[i] - e["t"]), i))
    return {"t": round(t[k], 4), "kind": e["kind"], "mag": round(d[k], 2)}


def match_planned(planned, md, steps=(), fps=30.0, tol=EVENT_MATCH):
    """Planned events matched to what the picture shows (S11 c): land, transition and wave by their own moments
    (kind_event); any other kind to a detected spike or start within tol (match_events). Returns (planned events with
    'detected', detected events nothing matched)."""
    if not md:
        return [dict(e, detected=None) for e in planned], []
    det, used, got = md["events"], set(), {}
    fr = 1.0 / md["analysis_rate"]
    for i, e in enumerate(planned):
        if e["kind"] in KIND_LOOK:
            x = kind_event(e, md, steps, fps)
            got[i] = x if x and abs(x["t"] - e["t"]) <= tol + 1e-9 else None
            if got[i]:  # the spike at that moment is this event's, not an unplanned one
                used.update(j for j, y in enumerate(det) if abs(y["t"] - x["t"]) <= fr + 1e-6)
    rest = [(i, e) for i, e in enumerate(planned) if i not in got]
    pm, extra = match_events([e for _, e in rest], [y for j, y in enumerate(det) if j not in used], tol)
    for (i, _), r in zip(rest, pm):
        got[i] = r["detected"]
    return [dict(e, detected=got[i]) for i, e in enumerate(planned)], extra


def peak_cue_checks(tl):
    """S11 b: a cue tied to the peak of a move WARNs when that move has no speed peak (the timeline's moves, S8)."""
    V, moves = [], {mv["id"]: mv for mv in (tl or {}).get("moves", [])}
    for c in (tl or {}).get("cues", []):
        if c.get("at") != "peak":
            continue
        mv = moves.get(c["move"])
        if mv is None:
            V.append(("NOTE", f"cue {c['id']} at {c['t']:.3f}s is tied to the peak of move '{c['move']}', which the "
                      "timeline's moves do not list: its speed peak is not checked"))
        elif mv["has_peak"] and mv["peak"] is None:
            V.append(("WARN", f"cue {c['id']} at {c['t']:.3f}s ({c['sound']}) is anchored to the peak of a move with no "
                      f"speed peak: move '{c['move']}' runs at constant speed; ease it so it peaks, or tie the cue to the "
                      "move's start or land (S11)"))
    return V


def match_events(planned, detected, tol=EVENT_MATCH):
    used, out = set(), []
    for e in planned:
        c = [(abs(d["t"] - e["t"]), j) for j, d in enumerate(detected) if j not in used and abs(d["t"] - e["t"]) <= tol]
        if c:
            j = min(c)[1]; used.add(j)
            out.append(dict(e, detected=detected[j]))
        else:
            out.append(dict(e, detected=None))
    return out, [d for j, d in enumerate(detected) if j not in used]


def public(d):
    return {k: v for k, v in d.items() if not k.startswith("_")}


def run_span(r):
    return f"{r['start']:.2f}-{r['end']:.2f}s ({r['dur']:.2f}s)"


def flash_text(fl):
    a, b = fl["worst"]
    return (f"photosensitive safety: {fl['max_in_1s']} opposing luminance swings ({fl['max_in_1s'] / 2:g} flashes) within "
            f"one second at {a:.2f}-{b:.2f}s; at most {FLASH_MAX} full-frame flashes in any one second (WCAG 2.3.1), "
            "whatever the timeline declares: space them out, shrink them, or soften them below a 10% luminance swing (C8)")


def union_s(spans, dur):
    """Seconds of [0, dur] the spans (dicts with start and end) cover, overlaps counted once."""
    return sum(y - x for x, y in merge_intervals([(max(0.0, x["start"]), min(dur, x["end"])) for x in spans
                                                  if min(dur, x["end"]) > max(0.0, x["start"])]))


def grid_text(x):
    return f"every {x['every']}f" if "every" in x else f"at {x['rate']:g} drawings/s"


def declared_text(md, tl, dur):
    """What the timeline's steps and effects declarations took out of the judder and still-run checks, and how much of
    the film each covers (S16)."""
    jd = md["judder_holes"]["declared"]
    parts = [f"steps '{x['label'] or 'steps'}' {x['start']:.2f}-{x['end']:.2f}s {grid_text(x)}" for x in tl["steps"]]
    parts += [f"effect '{x['label'] or x['kind']}' ({x['kind']}) {x['start']:.2f}-{x['end']:.2f}s" for x in tl["effects"]]
    return ("declared styles: " + ", ".join(parts) + f"; steps cover {union_s(tl['steps'], dur) / max(dur, 1e-6) * 100:.0f}%"
            f" of the film, effects {union_s(tl['effects'], dur) / max(dur, 1e-6) * 100:.1f}%; not counted as judder: "
            f"{jd['steps']} repeat frame(s) on the steps grid, {jd['effects']} inside effects; {md['steps_sub_every']} "
            "near-static frame(s) of drawings held their declared steps; effects' spikes are not listed as unplanned "
            "events; neither removes a frame from the frozen share, and flash safety still applies")


def declaration_checks(tl):
    """S16: effects excuse only flash, shake, glitch and flicker, each span at most EFFECT_MAX s; any other kind is an
    error, since texture (noise, grain, boil) belongs to the card and the page's data-layer="texture"."""
    V = []
    for x in (tl or {}).get("effects", []):
        span, name = f"{x['start']:.2f}-{x['end']:.2f}s", x["label"] or x["kind"]
        if not effect_kind(x):
            V.append(("FAIL", "motion", f"effect '{name}' ({x['kind']}) {span}: effects are flash, shake, glitch and "
                      "flicker only, and this one excuses nothing; texture such as noise, grain or boil goes in the card's "
                      "texture and the page's data-layer=\"texture\", which the content pass hides (S16)"))
        elif x["end"] - x["start"] > EFFECT_MAX + 1e-6:
            V.append(("WARN", "motion", f"effect '{name}' ({x['kind']}) spans {x['end'] - x['start']:.2f} s ({span}): an "
                      f"effect covers at most {EFFECT_MAX:g} s; declare only the frames it changes (S16)"))
    return V


def holds_growth(out, held):
    """(version, declared hold seconds) of the lowest-numbered sibling pack qa/v*/metrics.json before this one (S10
    growth), or None. Older packs without the number are read through the timeline their metrics.json names."""
    me = re.match(r"^v(\d+)$", os.path.basename(os.path.normpath(out)))
    parent = os.path.dirname(os.path.abspath(out))
    if not me or not os.path.isdir(parent):
        return None
    sib = sorted((int(x[1:]), x) for x in os.listdir(parent)
                 if re.match(r"^v\d+$", x) and int(x[1:]) < int(me.group(1))
                 and os.path.isfile(os.path.join(parent, x, "metrics.json")))
    for _, name in sib[:1]:
        try:
            with open(os.path.join(parent, name, "metrics.json")) as fh:
                met = json.load(fh)
        except (OSError, ValueError):
            return None
        got = (met.get("holds") or {}).get("declared_s")
        if got is None:
            got = ((met.get("motion") or {}).get("declared_holds") or {}).get("held")
        if got is None and isinstance(met.get("timeline"), str):
            for cand in (met["timeline"], os.path.join(os.path.dirname(parent), met["timeline"])):
                if os.path.isfile(cand):
                    old = load_timeline(cand)
                    got = union_s(old["holds"], fnum(met.get("duration")) or old["duration"] or 1e9)
                    break
        return (name, round(float(got), 3)) if got is not None else None
    return None


def exempt_timeline(holds):
    """--exempt ranges as a timeline with holds only, so motion checks them like declared holds."""
    return {"path": "--exempt", "holds": holds, "events": [], "cues": [], "scenes": [], "steps": [], "effects": [],
            "layers": [], "music": None, "fps": 0.0, "duration": 0.0, "width": 0, "height": 0, "range": None,
            "register": None, "format": None, "style": None, "composition": None, "beats": None, "content_pass": None,
            "moves": [], "odd_beats": False, "seams": [], "demands": {}}


def cmd_motion(a):
    m = Media(a.file)
    tl = load_timeline(a.timeline)
    holds = tl["holds"] if tl else parse_ranges(a.exempt)
    known = bool(tl) or bool(a.exempt)
    md = motion_data(m, a.rate, a.width, a.thr, a.min_run, holds, **({k: tl[k] for k in ("steps", "effects")} if tl else {}))
    ptl, reg, fmt = tl or (exempt_timeline(holds) if a.exempt else None), getattr(a, "register", None), getattr(a, "format", None)
    alpha = registers()["formats"].get(film_settings(ptl, reg, fmt)[1] or "", {}).get("frozen_share") is False \
        and alpha_confirmed(m)  # only a format that skips the frozen share needs the alpha probe
    pv, pdata = pacing_checks(m, ptl, md, reg, fmt, alpha, a.max_hold_share)
    pd, hd = pdata["pacing"], pdata["holds"]
    if a.json:  # the verdicts the text form prints as FAIL, WARN or NOTE lines, and its exit code
        dv = declaration_checks(tl) + ([("FAIL", "motion", flash_text(md["flashes"]))]
                                       if md["flashes"]["max_in_1s"] > 2 * FLASH_MAX else [])
        out = public(md)
        out["pacing"] = public(pd) if pd else None
        out["holds"] = hd
        out["verdicts"] = [{"level": lv, "check": chk, "text": text} for lv, chk, text in pv + dv]
        print(json.dumps(out, indent=1))
        return 1 if any(lv == "FAIL" for lv, _, _ in pv + dv) else 0
    print(f"samples={md['samples']} @ {md['analysis_rate']}fps width={md['width']} thr={md['threshold']} -> near-static share "
          f"{md['near_static_share'] * 100:.1f}%  (share at 0.05/0.1/0.3/1.0: "
          f"{' / '.join(f'{v * 100:.0f}%' for v in md['share_at'].values())})" + ("  [planned holds excluded]" if holds else ""))
    if pd:
        print(f"pacing (S9): {pd['line']}")
    if known:
        print(f"declared holds: {hd['held']:.2f} of {hd['duration']:.2f} s ({hd['share'] * 100:.0f}%); each (S10): "
              + holds_line(hd))
    if md["low_p5"] > 0.05:
        print(f"NOTE 95% of frame pairs differ by more than {md['low_p5']}: grain or compression noise may hide the holds")
    runs = [r for r in (pd["runs"] if pd else []) if r["dur"] >= a.min_run - 1e-9]
    print(f"still runs >= {a.min_run:.1f}s (frozen or repeating): " + (", ".join(
        run_span(r) + (" alive" if r["alive"] else " rest" if r["rest"] else "") + (" final" if r["final"] else "")
        for r in runs) or "none"))
    if not known and runs:
        print("  (no holds declared: pass --timeline or --exempt to tell planned holds from frozen stretches)")
    for lv, chk, text in pv:
        if lv in ("FAIL", "WARN", "NOTE"):
            print(f"{lv} {chk}: {text}")
    print("per second (mean / near-static %): " + "  ".join(f"{x['sec']}:{x['mean']:.2f}/{x['static'] * 100:.0f}%" for x in md["per_second"]))
    print(f"quietest seconds: {md['quietest_seconds']}")
    print("events: " + (", ".join(f"{e['t']:.3f}s {e['kind']}({e['mag']})" + (f" [effect {e['effect']}]" if e.get("effect")
                                  else "") for e in md["events"]) or "none"))
    bad = sum(1 for lv, _, _ in pv if lv == "FAIL")
    jh = md["judder_holes"]
    if jh["count"]:
        print(f"WARN {jh['count']} zero-change frames inside motion (of {jh['of_moving']}) at {jh['times']}: duplicated or "
              "dropped frames, lower-rate animation in a higher-rate file, or whole-pixel snapping; a step or effect the "
              "plan scheduled is declared in the timeline's steps or effects")
    if tl and (tl["steps"] or tl["effects"]):
        print("NOTE " + declared_text(md, tl, m.duration))
    for lv, chk, text in declaration_checks(tl):
        bad += lv == "FAIL"
        print(f"{lv} {chk}: {text}")
    if md["flashes"]["max_in_1s"] > 2 * FLASH_MAX:
        bad += 1
        print("FAIL " + flash_text(md["flashes"]))
    if md["black_frames"]:
        print(f"WARN isolated near-black frames at {md['black_frames']}: a seam or a missing frame")
    if md["first_frame_luma"] is not None and md["first_frame_luma"] < 16:
        print(f"NOTE first frame is near black (luma {md['first_frame_luma']}); players without a poster show it as the preview")
    if md["last_frame_luma"] is not None and md["last_frame_luma"] < 16:
        print(f"NOTE last frame is near black (luma {md['last_frame_luma']})")
    return 1 if bad else 0


# ---------------------------------------------------------------- audio: decode, envelope, onsets
def decode_audio(path, sr=48000, af=None):
    """First audio stream as cumulative energy (sum over channels) per sample; None when there is no audio. Decoded as
    32-bit float: mix.py's stem sits before the limiter, often above 0 dBFS, and 16-bit would clip its hits flat."""
    info = ffprobe_json(path)
    au = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not au:
        return None
    ch = int(au.get("channels") or 2)
    raw = run(FF + ["-loglevel", "error", "-i", path, "-map", "0:a:0", "-vn"] + (["-af", af] if af else [])
              + ["-ar", str(sr), "-ac", str(ch), "-f", "f32le", "-acodec", "pcm_f32le", "-"], binary=True).stdout
    pcm = array("f")
    pcm.frombytes(raw[: len(raw) // (4 * ch) * (4 * ch)])
    if sys.byteorder == "big":
        pcm.byteswap()
    chans = [pcm[c::ch] for c in range(ch)] if ch > 1 else [pcm]
    e = map(operator.mul, chans[0], chans[0])
    for c in chans[1:]:
        e = map(operator.add, e, map(operator.mul, c, c))
    cs = array("d", [0.0])
    cs.extend(itertools.accumulate(e))
    return {"cs": cs, "nfr": len(cs) - 1, "ch": ch, "sr": sr, "path": path}


def win_db(A, a, b):
    ms = (A["cs"][b] - A["cs"][a]) / (max(1, b - a) * A["ch"])
    return max(-120.0, 10 * math.log10(ms)) if ms > 1e-12 else -120.0


def envelope(A, step=0.005, win=0.010):
    """RMS level in dBFS on a sliding window, one value per step (window centred on k*step)."""
    sr, n = A["sr"], A["nfr"]
    w, out = int(win * sr), []
    for k in range(int(n / (step * sr)) + 1):
        c = int(k * step * sr)
        a, b = max(0, c - w // 2), min(n, c + w // 2)
        out.append(win_db(A, a, b) if b > a else -120.0)
    return out


def onset_data(A, rise_db=10.0, gate_db=-50.0, refractory=0.04, win_ms=5.0, hop_ms=1.0):
    """Energy onsets: 5 ms RMS rising >= rise_db above the 30 ms floor, above the gate; onset = first 1 ms step within
    20 dB of the event's own peak (ignores codec pre-echo). Calibrated to <= 1.5 ms error on clean and bedded audio."""
    if not A:
        return []
    sr, nfr = A["sr"], A["nfr"]
    win, hop = int(sr * win_ms / 1000), int(sr * hop_ms / 1000)
    env = [((s + win / 2) / sr, win_db(A, s, s + win)) for s in range(0, nfr - win, hop)]
    look = int(30 / hop_ms)
    cand, last = [], -1.0
    for i in range(look, len(env)):
        t, v = env[i]
        floor = max(-90.0, min(x for _, x in env[i - look:i]))
        if v >= gate_db and v - floor >= rise_db and t - last >= refractory:
            cand.append((i, floor)); last = t
    out = []
    for k, (i, floor) in enumerate(cand):
        stop = min(len(env), i + int(60 / hop_ms), cand[k + 1][0] if k + 1 < len(cand) else len(env))
        peak_i = max(range(i, stop), key=lambda q: env[q][1])
        peak = env[peak_i][1]
        j = i
        while j > i - look and env[j - 1][1] >= max(floor + rise_db, peak - 20.0):
            j -= 1
        while env[j][1] < peak - 20.0 and j < peak_i:
            j += 1
        out.append({"t": round(env[j][0], 4), "peak_t": round(env[peak_i][0], 4),
                    "peak_db": round(peak, 1), "rise_db": round(peak - floor, 1)})
    return out


def end10(A, t_peak, peak_db, t1):
    """First 10 ms window after the peak whose RMS is 20 dB below it (the 'end' anchor, e.g. a riser's cut-off), searched
    up to t1. Its START is reported, as for 'peak', so an abrupt end measures at its last sample, not 5 ms later."""
    sr = A["sr"]
    w, hop = int(0.010 * sr), int(0.001 * sr)
    for c in range(int(t_peak * sr), min(int(t1 * sr), A["nfr"] - w), hop):
        if win_db(A, c, c + w) < peak_db - 20.0:
            return c / sr
    return A["nfr"] / sr if int(t1 * sr) > A["nfr"] - w else None  # still sounding where the audio stops


def levels(A, lo_t, hi_t, inside=False):
    """[(t, dB)]: 10 ms RMS windows starting every 1 ms in [lo_t, hi_t); inside=True keeps whole windows before hi_t."""
    sr = A["sr"]
    w, hop = int(0.010 * sr), int(0.001 * sr)
    lo, hi = max(0, int(lo_t * sr)), min(A["nfr"] - w, int(hi_t * sr) - (w if inside else 0))
    return [(c / sr, win_db(A, c, c + w)) for c in range(lo, hi, hop)]


def top_span(vals, k):
    """Indices of the window starts around vals[k] that stay within 1 dB of it, bridging dips shorter than 20 ms."""
    top = vals[k][1]
    i0 = i1 = k
    j = k - 1
    while j >= 0 and i0 - j <= 20:
        if vals[j][1] >= top - 1.0:
            i0 = j
        j -= 1
    j = k + 1
    while j < len(vals):
        if vals[j][1] >= top - 1.0:
            i1 = j
        elif j - i1 > 20:
            break
        j += 1
    return i0, i1


def context_db(A, onset, lo_t, hi_t):
    """The level a sound in [lo_t, hi_t] must rise 6 dB above: the quieter of the median 10 ms level over the 2 s
    around the span and over the second before its expected onset (when known, with at least 0.25 s of audio before
    it). Around alone lets a long sound's own body lift the median (a lone shimmer rings for 2 s: a false 'no sound
    stands out'); before alone flags a hit right after a louder riser that stops on it."""
    sr = A["sr"]
    w = int(0.010 * sr)
    mid = (lo_t + hi_t) / 2
    starts = [[c - w // 2 for c in range(max(w // 2, int((mid - 1) * sr)), min(A["nfr"] - w // 2, int((mid + 1) * sr)),
                                         w // 2)]]
    if onset is not None and onset >= 0.25:
        starts.append(list(range(max(0, int((onset - 1.0) * sr)), min(A["nfr"] - w, int(onset * sr) - w), w // 2)))
    got = [statistics.median([win_db(A, c, c + w) for c in cs]) for cs in starts if cs]
    return min(got) if got else None


def peak_near(A, lo_t, hi_t, end=False, onset=None):
    """The 'peak' anchor of the sound in [lo_t, hi_t]: the START of the loudest 10 ms RMS window (the definition mix.py
    and sfx.py place by), plus the span of window starts that stay within 1 dB of the top (gaps under 20 ms bridged): a
    flat, limited or noisy top makes the argmax arbitrary inside that span. Returns (t, level, top_lo, top_hi), or Nones
    when nothing there stands 6 dB above the level before its expected onset or around it (context_db): missing or buried.
    end=True, the peak an 'end' search starts from: whole windows inside the span (not the next cue's attack) and no
    context test (a riser's own long body fills the time before its end; the end search needs its own drop)."""
    vals = levels(A, lo_t, hi_t, end)
    if not vals:
        return None, None, None, None
    k = max(range(len(vals)), key=lambda i: vals[i][1])
    top = vals[k][1]
    ctx = None if end else context_db(A, onset, lo_t, hi_t)
    if top < -60.0 or (ctx is not None and top < ctx + 6.0):
        return None, None, None, None
    i0, i1 = top_span(vals, k)
    return vals[k][0], top, vals[i0][0], vals[i1][0]


def masker(A, cues, ci, lo_t, hi_t, top, top_lo):
    """Id of the earlier cue whose decaying tail, not cue ci's own sound, makes the loudest 10 ms of ci's span: that top
    starts within 30 ms of the span start, the sound was as loud just before the span (within 1 dB) and ends the span
    >= 3 dB lower, and an earlier cue at least as loud decays into the span without a 6 dB rise that no other planned cue
    explains (the loudest such cue is named). None when the top is the cue's own sound."""
    sr, nfr = A["sr"], A["nfr"]

    def lev(t):  # the 10 ms window starting at t
        a = min(max(0, int(t * sr)), nfr - 1)
        return win_db(A, a, min(nfr, a + int(0.010 * sr)))

    if top_lo - lo_t > 0.030 or max(lev(lo_t - k * 0.005) for k in range(1, 7)) < top - 1.0:
        return None
    if max(lev(hi_t - 0.010 - k * 0.005) for k in range(7)) > top - 3.0:  # whole windows ending the span
        return None
    best = None
    for j in range(ci - 1, -1, -1):
        tj = cues[j]["t"]
        if tj >= lo_t:
            continue
        if tj < lo_t - 3.0:
            break
        pk_t, pk = max(((tj + k * 0.005, lev(tj + k * 0.005)) for k in range(-10, 11)), key=lambda x: x[1])
        if pk < top or (best and pk <= best[1]):
            continue
        others = [x["t"] for k, x in enumerate(cues) if k not in (j, ci)]
        rmin, t, decays = pk, pk_t, True
        while t < lo_t and decays:
            v = lev(t)
            rmin = min(rmin, v)
            decays = v - rmin < 6.0 or any(abs(t - o) <= 0.05 for o in others)
            t += 0.005
        if decays:
            best = (cues[j]["id"], pk)
    return best[0] if best else None


def tail_bump(A, lo_t, hi_t):
    """Under a louder tail, the cue's own attack: the loudest 10 ms window in the span that stands >= 6 dB above the
    lowest level before it in the span and falls back >= 3 dB before the span ends (a pop on a boom, not ripple or the
    next cue's rise). Returns (t, level, top_lo, top_hi), or None when nothing in the span separates from the tail."""
    vals = levels(A, lo_t, hi_t)
    rmin, k = 1e9, None
    for i, (_, v) in enumerate(vals):
        rmin = min(rmin, v)
        if v - rmin >= 6.0 and v >= -60.0 and (k is None or v > vals[k][1]):
            k = i
    if k is None or min(v for _, v in vals[k:]) > vals[k][1] - 3.0:
        return None
    d = min(range(k + 1), key=lambda i: vals[i][1])  # the dip before it: the top span must not reach back into the tail
    i0, i1 = top_span(vals[d:], k - d)
    return vals[k][0], vals[k][1], vals[d + i0][0], vals[d + i1][0]


def anchor_time(onsets, k, anchor):
    """Measured time of an onset-based anchor for onset k: 'start', or a number of seconds into the sound."""
    o = onsets[k]
    if numeric(anchor):
        return o["t"] + float(anchor), "start+%.3gs" % float(anchor)
    return o["t"], "onset"


def cmd_onsets(a):
    A = decode_audio(a.file, af=a.af)
    if not A:
        print(f"{a.file}: no audio stream"); return 0
    ons = onset_data(A, a.rise, a.gate)
    print(f"{len(ons)} onsets (rise >= {a.rise} dB within 30 ms, gate {a.gate} dBFS, 5 ms RMS):")
    for o in ons:
        print(f"  {o['t']:.4f}s  peak {o['peak_t']:.4f}s  {o['peak_db']} dBFS  (+{o['rise_db']} dB)")
    close = [(x["t"], y["t"]) for x, y in zip(ons, ons[1:]) if y["t"] - x["t"] < REPEAT_MIN]
    if close:
        print("NOTE onsets closer than 100 ms (may fuse into a buzz rather than countable hits): "
              + ", ".join(f"{x:.3f}->{y:.3f}" for x, y in close))
    return 0


# ---------------------------------------------------------------- sync: sound vs picture vs plan
def sync_verdict(off, fr):
    """S3: ok within 1 frame either way; WARN beyond 1 frame early or late; FAIL beyond BT.1359 detectability
    (audio 45 ms early or 125 ms late)."""
    if off < -fr - 1e-6:
        if off < -EARLY_FAIL:
            return "FAIL", f"audio leads by {-off * 1000:.0f} ms (> 45 ms: detectable, BT.1359)"
        return "WARN", "sound early by more than 1 frame"
    if off > fr + 1e-6:
        if off > LATE_FAIL:
            return "FAIL", f"audio lags by {off * 1000:.0f} ms (> 125 ms: detectable, BT.1359)"
        return "WARN", "sound late by more than 1 frame (S3)"
    return "ok", ""


def numeric(anchor):
    return isinstance(anchor, (int, float)) and not isinstance(anchor, bool)


def tie_rank(c):
    """Order of cues on one frame: a sound that ends there owns the span before it, one that starts there the span after."""
    a = c.get("anchor")
    return 0 if a == "end" else 2 if a == "start" or numeric(a) else 1


def close_cues(times):
    """Planned cue times 1-100 ms apart: rapid repeats that fuse into a buzz (S3). Judged on the plan, since one sound
    can trigger two onsets (a crack and its sub drop); cues under 1 ms apart are one layered sound (a riser's end and a
    hit on the same frame), not a repeat."""
    ts = sorted(times)
    return [(x, y) for x, y in zip(ts, ts[1:]) if 0.001 <= y - x < REPEAT_MIN]


def sync_rows(A, onsets, fps, tl, md, window=0.25, layers=(), on_stem=False):
    """Rows pairing planned cues and picture events with measured sound. Offsets are audio minus reference (+ = late).
    With cues: a 'peak' (default) or 'end' anchor is measured on the 10 ms RMS inside the span the cue owns (up to
    halfway to its neighbours, at most the window); a 'start' or numeric anchor uses the onset whose anchor lies nearest.
    When an earlier cue's decaying tail is the loudest thing in the span, only an attack that rises 6 dB out of it is
    measured; otherwise the row is a WARN (cannot isolate: probably inaudible too) with no offset. An 'end' still
    sounding when the next cue starts is a NOTE, unless that cue is within one frame (a riser into a hit: then no gap
    before it is the check).
    The reference is the planned event that pairs with the cue (at its detected time when the picture shows it): each
    planned event pairs only with its nearest cue within the window, and every other cue is judged against its own time,
    so a stagger of pops after a flash is not timed to the flash. A row is 'confirmed' only when measured against a
    change the picture shows (md): a cue on time against a planned event the picture does not show WARNs (placed to
    plan, not verified; off_level keeps the offset's own verdict). Unplanned detected spikes are only reported (a camera
    move's speed peak is a spike too). layers: the (on, end) spans of layers present in A (measured on the mix); their
    onsets are not listed as stray sounds, and layers are never sync-checked.
    Without cues: each picture event takes the loudest onset within the window (the calibrated original)."""
    fr = 1.0 / (fps or 30.0)
    used, rows = set(), []
    pm, extra = match_planned(tl["events"] if tl else [], md, (tl or {}).get("steps", ()), fps)
    ppics = [{"t": e["detected"]["t"] if e["detected"] else e["t"], "t_plan": e["t"], "label": e["label"], "kind": e["kind"],
              "seen": bool(e["detected"]), "what": f"{e['kind']} (plan, {'seen' if e['detected'] else 'not seen'})"} for e in pm]
    dpics = [{"t": d["t"], "t_plan": None, "what": d["kind"], "label": ""} for d in extra if not d.get("effect")]
    cues = sorted(tl["cues"], key=lambda c: (c["t"], tie_rank(c))) if tl else []
    cands, unmeasured = [], {}
    for ci, c in enumerate(cues):  # candidates per cue: (|anchor - cue|, [onset indices], measured anchor time, how)
        anchor, cl = c.get("anchor", "peak"), []
        if not (anchor == "start" or numeric(anchor)):
            # each cue owns the span around it up to halfway to its neighbours (at most the window)
            lo = max(c["t"] - window, (cues[ci - 1]["t"] + c["t"]) / 2 if ci > 0 else -1e9)
            hi = min(c["t"] + window, (cues[ci + 1]["t"] + c["t"]) / 2 if ci + 1 < len(cues) else 1e9)
            tp, pk_db, top_lo, top_hi = peak_near(A, lo, hi, end=anchor == "end", onset=c["t"] - c.get("lead", 0.0))
            how = "peak"
            hidden = masker(A, cues, ci, lo, hi, pk_db, top_lo) if tp is not None else None
            if hidden:  # the span's loudest part is an earlier cue's tail: measure only an attack that rises out of it
                bump = tail_bump(A, lo, hi)
                if not bump:  # what hides it from the stem probably hides it from the ear: a design fix, not a NOTE
                    unmeasured[ci] = ("WARN", f"cannot isolate (masked by {hidden} tail), so it is probably inaudible too: "
                                      f"space it from {hidden}, shorten {hidden}'s sound, or give this moment deliberate "
                                      "silence", lo, hi, hidden)
                    cands.append(cl)
                    continue
                (tp, pk_db, top_lo, top_hi), how = bump, f"peak over {hidden} tail"
            if anchor == "end" and tp is not None:
                follow = cues[ci + 1] if ci + 1 < len(cues) else None
                stop = tp + 3.0 if follow is None else min(tp + 3.0, max(follow["t"], tp))
                mt, how, top = end10(A, tp, pk_db, stop), "end", None
                if mt is None and follow is not None and follow["t"] <= tp + 3.0:  # still sounding when the next cue starts
                    if follow["t"] - c["t"] > fr + 1e-6:
                        unmeasured[ci] = ("NOTE", f"cannot isolate its end (still sounding under {follow['id']})", lo, hi, None)
                        cands.append(cl)
                        continue
                    # a riser into a hit on one frame: no gap before the hit is all the stem can show
                    mt, how = follow["t"], f"end, runs into {follow['id']}"
            else:
                mt, top = tp, (top_lo, top_hi) if tp is not None and top_hi - top_lo > 0.02 else None
            if mt is not None and abs(mt - c["t"]) <= window:
                # this sound's own attacks and quieter tail re-triggers, so they are not listed as stray sounds
                back, nxt = (1.5 if anchor == "end" else 0.6), ((c["t"] + cues[ci + 1]["t"]) / 2 if ci + 1 < len(cues) else 1e9)
                own = [k for k, o in enumerate(onsets) if tp - back <= o["t"] <= tp + 0.002
                       or (tp < o["t"] <= min(tp + 1.5, nxt) and o["peak_db"] <= pk_db + 3.0)]
                cl.append((abs(mt - c["t"]), own, mt, how, top))
            cands.append(cl)
            continue
        for k, o in enumerate(onsets):
            if o["t"] > c["t"] + window or o["t"] < c["t"] - window - (float(anchor) if numeric(anchor) else 0.0):
                continue
            mt, how = anchor_time(onsets, k, anchor)
            if mt is not None and abs(mt - c["t"]) <= window:
                cl.append((abs(mt - c["t"]), [k], mt, how, None))
        cands.append(sorted(cl))
    nearest = [cl[0][1][0] if cl and len(cl[0][1]) == 1 else None for cl in cands]
    # each planned event pairs only with its nearest cue within the window (cues tied within 1 ms all pair: a riser's end
    # and an impact on one frame); every other cue is judged against its own planned time, not a neighbour's event
    claims = {}
    for i, p in enumerate(ppics):
        dist = [abs(p["t_plan"] - c["t"]) for c in cues]
        best_d = min(dist, default=window)
        for ci, x in enumerate(dist):
            if x <= window and x <= best_d + 0.001:
                claims.setdefault(ci, []).append((x, i))
    chosen = {ci: min(cl)[1] for ci, cl in claims.items()}  # a cue two events claim takes the nearer one
    pairs_with = {i: [cues[ci]["id"] for ci, j in sorted(chosen.items()) if j == i] for i in range(len(ppics))}
    p_used, d_near = set(), set()
    for ci, c in enumerate(cues):
        anchor = c.get("anchor", "peak")
        by_onset = anchor == "start" or numeric(anchor)
        cl = [x for x in cands[ci] if not (by_onset and x[1][0] in used)]
        best = cl[0] if cl else None
        if cl and by_onset:  # a much louder onset nobody else is nearest to beats a faint nearer one (a bed starting at a cut)
            loud = max(cl, key=lambda x: onsets[x[1][0]]["peak_db"])
            if (onsets[loud[1][0]]["peak_db"] - onsets[best[1][0]]["peak_db"] >= 15
                    and loud[1][0] not in [n for j, n in enumerate(nearest) if j != ci]):
                best = loud
        pic = ppics[chosen[ci]] if ci in chosen else None
        if pic:
            p_used.add(chosen[ci])
        near_d = [i for i, p in enumerate(dpics) if abs(p["t"] - c["t"]) <= window]
        d_near.update(near_d)
        others = [(p["t_plan"], pairs_with[i]) for i, p in enumerate(ppics)
                  if i != chosen.get(ci) and abs(p["t_plan"] - c["t"]) <= window and pairs_with[i]]
        row = {"kind": "cue", "id": c["id"], "plan_t": c["t"], "sound": c["sound"], "anchor": c.get("anchor", "peak"),
               "pic_t": pic["t"] if pic else None, "pic": pic["what"] if pic else None,
               "pic_seen": pic["seen"] if pic else None, "meas_t": None,
               "spikes": [dpics[i]["t"] for i in near_d], "events_of_others": others}
        if ci in unmeasured:  # no offset: the stem cannot show this cue apart from a neighbour's sound
            level, note, lo, hi, hidden = unmeasured[ci]
            used.update(k for k, o in enumerate(onsets) if lo <= o["t"] < hi)  # its attack or the tail's ripple: not strays
            row.update(level=level, note=note, masked=hidden)
        elif best is None:
            nothing = f"no sound stands out within +/-{window * 1000:.0f} ms of the cue"
            if pic and not pic["seen"]:  # the picture does not confirm the beat either: suspect the plan, not the sound
                note = (f"{nothing}, and its planned {pic['kind']} at {pic['t_plan']:.3f}s is not seen in the picture "
                        "either: check its burst (a timeline from another render, a beat that moved, or a change too soft "
                        "to detect) before blaming the sound")
            else:
                note = f"{nothing}: missing, masked{'' if on_stem else ' (try --sfx-stem)'}, or misplaced"
            row.update(level="WARN", note=note)
        else:
            _, ks, mt, how, top = best
            used.update(ks)
            ref = pic["t"] if pic else c["t"]
            level, note = sync_verdict(mt - ref, fr)
            if top and top[0] <= ref <= top[1] and level != "ok":  # the sound's loud top spans the reference time
                level, note = "ok", f"flat top {top[0]:.3f}-{top[1]:.3f}s covers the reference; the argmax inside it is arbitrary"
            if top:
                how += f", top {top[0]:.2f}-{top[1]:.2f}"
            off_level = level
            if pic and not pic["seen"] and md is not None and level == "ok":  # on time against the plan alone
                level, note = "WARN", ("placed to plan, not verified: open the burst (a change too soft to detect, a "
                                       "continuous move, or a beat that moved: re-time the cue to the change, or write why "
                                       "it stands)")
            # confirmed: measured against a change the picture shows; only these count toward a sync PASS
            row.update(meas_t=round(mt, 4), how=how, off_plan=round(mt - c["t"], 4), off=round(mt - ref, 4),
                       ref="picture" if pic else "cue", level=level, note=note, off_level=off_level,
                       confirmed=bool(pic and pic["seen"]))
        rows.append(row)
    if cues:
        refs = [p for i, p in enumerate(ppics) if i not in p_used] + [p for i, p in enumerate(dpics) if i not in d_near]
    else:
        # the first frame has no frame before it, so no picture change is ever detected there (S11 a)
        refs = [{"t": 0.0, "t_plan": None, "what": "first-frame", "label": "", "seen": False}] + ppics + dpics
    for p in sorted(refs, key=lambda x: x["t"]):
        cand = [(k, o) for k, o in enumerate(onsets) if abs(o["t"] - p["t"]) <= window and k not in used]
        if not cand:
            if p["what"] != "first-frame" and (not cues or p["t_plan"] is not None):
                rows.append({"kind": "event", "pic_t": p["t"], "pic": p["what"], "label": p["label"], "meas_t": None,
                             "level": "NOTE", "note": "no sound within the window (intended silence?)"})
            continue
        k, o = max(cand, key=lambda ko: (ko[1]["peak_db"], -abs(ko[1]["t"] - p["t"])))
        used.add(k)
        level, note = sync_verdict(o["t"] - p["t"], fr)
        if cues:  # the plan has cues and this pairing is not one of them: report, do not judge
            level, note = "NOTE", ("no planned cue; " + note if note else "no planned cue")
        rows.append({"kind": "event", "pic_t": p["t"], "pic": p["what"], "label": p["label"], "meas_t": o["t"], "how": "onset",
                     "off": round(o["t"] - p["t"], 4), "level": level, "note": note, "confirmed": p.get("seen", True),
                     "others": [round(x["t"], 3) for j, x in cand if j != k]})
    rows.sort(key=lambda r: r["plan_t"] if r["kind"] == "cue" else r["pic_t"])
    loudest = max((o["peak_db"] for o in onsets), default=-120.0)
    rest = [o for k, o in enumerate(onsets) if k not in used and o["peak_db"] >= loudest - 20.0
            and not any(a <= o["t"] < b for a, b in layers)]
    offs = [r["off"] for r in rows if r["kind"] == "cue" and r.get("off") is not None]
    hint = None
    if len(offs) >= 2 and abs(statistics.mean(offs)) > 0.010 and max(offs) - min(offs) < 0.006:
        hint = (f"every cue is off by about {statistics.mean(offs) * 1000:+.0f} ms: suspect one pipeline offset "
                "(AAC priming or a missing edit list, mux offset), not the cues")
    return rows, rest, hint


def verdict(r):
    """A sync row's verdict as printed: 'ok' only for a sound confirmed against a change the picture shows."""
    return "placed to plan" if r["level"] == "ok" and not r.get("confirmed") else r["level"]


def sync_report(rows, ncues, where=""):
    """(level, text, count) of the sync result, None when nothing was judged. Only sounds confirmed against a change the
    picture shows count toward a PASS (S3), and any sound off its reference, missing, or masked still withholds it; the
    rest on time are listed as placed to plan, not verified (a cue whose planned event the picture does not show WARNs on
    its own row and leaves the PASS to the confirmed cues). count: 'k of n ... confirmed ...' alone."""
    judged = [r for r in rows if r["level"] in ("ok", "WARN", "FAIL")]
    if not judged:
        return None
    ok = [r for r in judged if r["level"] == "ok" and r.get("confirmed")]
    bad = [r for r in judged if r["level"] != "ok" and r.get("off_level") != "ok"]  # not the unseen-event WARN
    placed = [r for r in judged if verdict(r) == "placed to plan"]
    at = lambda r: r["plan_t"] if r["kind"] == "cue" else r["pic_t"]
    level = "PASS" if ok and not bad else "NOTE"
    count = (f"{len(ok)} of {ncues or len(judged)} {'cues' if ncues else 'picture events with sound'} confirmed against a "
             "detected picture change")
    text = count
    if level == "PASS":
        w = max(ok, key=lambda r: abs(r["off"]))
        text += f", within 1 frame (S3){where} (worst {w['off'] * 1000:+.1f} ms at {at(w):.2f}s)"
    if placed:
        text += ("; placed to plan, not verified: open the burst: "
                 + ", ".join(f"{r['id'] if r['kind'] == 'cue' else r['pic']} at {at(r):.2f}s" for r in placed[:12])
                 + (f" and {len(placed) - 12} more" if len(placed) > 12 else ""))
    return level, text, count


def sync_line(r, fr):
    if r["kind"] == "cue":
        s = f"cue {r['id']:<12} plan {r['plan_t']:7.3f}s {r['sound'][:14]:<14} "
        if r["meas_t"] is None:
            return s + f"-> {r['level']} {r['note']}"
        s += f"sound {r['meas_t']:7.3f}s ({r['how']})  vs plan {r['off_plan'] * 1000:+6.1f} ms"
        if r["ref"] == "picture":
            s += f"  picture {r['pic_t']:.3f}s {r['pic']}  offset {r['off'] * 1000:+6.1f} ms ({r['off'] / fr:+.1f} f)"
        else:
            s += f"  ({r['off'] / fr:+.1f} f vs the cue; " + (
                "; ".join(f"planned event {t:.3f}s pairs with cue {', '.join(ids)}" for t, ids in r["events_of_others"])
                if r.get("events_of_others") else "no planned event in window")
            s += (f"; unplanned spike at {', '.join(f'{x:.3f}' for x in r['spikes'])}s)" if r.get("spikes") else ")")
        return s + f"  {verdict(r)}" + (f" {r['note']}" if r["note"] else "")
    s = f"picture {r['pic_t']:7.3f}s {r['pic']:<10} "
    if r["meas_t"] is None:
        return s + f"-> {r['note']}"
    s += f"sound {r['meas_t']:7.3f}s  offset {r['off'] * 1000:+6.1f} ms ({r['off'] / fr:+.1f} f)  {verdict(r)}"
    s += f" {r['note']}" if r["note"] else ""
    return s + (f"  [other onsets in window: {', '.join(f'{x:.3f}' for x in r['others'])}]" if r.get("others") else "")


def on_mix_extra(tl):
    """What besides the cues a mix holds and the SFX stem does not ('music', 'layers', both), or ''."""
    return " and ".join(k for k in ("music", "layers") if tl and tl[k])


def layers_note(spans, on_mix):
    def one(s):
        hits = "" if s["hits"] is None else f" {len(s['hits'])} hits" + (
            f" ({s['times'] - len(s['hits'])} of {s['times']} times outside the film)" if s["times"] > len(s["hits"]) else "")
        return (f"{s['id']} ({s['sound'][:48]}){hits} {s['on']:.2f}-{s['end']:.2f}s"
                + ("" if s["known"] else " (length unknown: pass --kit or keep the file beside the timeline)"))
    return ("layers (sound that follows the picture, continuous or one hit per listed time) are never sync-checked, and "
            "mix.py keeps them off the SFX stem: " + ", ".join(one(s) for s in spans[:12])
            + (f" and {len(spans) - 12} more" if len(spans) > 12 else "")
            + ("; measured on the mix, so onsets inside them are not listed as stray sounds" if on_mix else ""))


def cap_on_mix(rows, af, what="music"):
    """No SFX stem under planned music or layers: they, and the highpass that tames them, move slow sounds' peaks (a
    swoosh by about 100 ms), so a sync offset measured on the mix is a hint, not a verdict: cap it at WARN."""
    why = f"measured on the mix with {what}" + (f" after {af}" if af else "") + ": measure with --sfx-stem for a verdict"
    for r in rows:
        if r["level"] in ("WARN", "FAIL") and r.get("off_level") != "ok":  # an unseen picture event's WARN: not the mix's
            r["level"], r["note"] = "WARN", (r["note"] + "; " if r["note"] else "") + why


def hint_rows(rows, what):
    """A timeline with music or layers and no cues has no sync points: the SFX stem would be silent and the mix's onsets
    are beats and layer hits, so picture events paired with them are hints, never verdicts. Returns the NOTE."""
    for r in rows:
        if r["level"] in ("ok", "WARN", "FAIL"):
            r["level"] = "hint"
    return (f"no cues planned, so nothing is sync-checked and no SFX stem is needed: picture events paired with the "
            f"mix's onsets ({what}) are hints; music-led cuts are judged against the beat grid (S4)")


def cmd_sync(a):
    m = Media(a.file)
    tl = load_timeline(a.timeline)
    kit_note = apply_kit(tl, a.kit)
    src = a.sfx_stem or (a.file if m.a else None)
    ncues = len(tl["cues"]) if tl else 0
    if not src:
        if ncues:
            print(f"FAIL {ncues} cues planned but {a.file} has no audio stream (pass --sfx-stem or mux the mix)"); return 1
        print("N/A no audio stream and no planned cues"); return 0
    A = decode_audio(src, af=a.af)
    onsets = onset_data(A, a.rise, a.gate)
    md = motion_data(m, a.rate, a.width, a.thr, **plan_spans(tl))
    fr = m.frame_dur()
    spans = layer_spans(tl, a.kit, m.duration)
    rows, rest, hint = sync_rows(A, onsets, m.fps, tl, md, a.window, [] if a.sfx_stem else layer_windows(spans),
                                 on_stem=bool(a.sfx_stem))
    extra = on_mix_extra(tl)
    hints = not a.sfx_stem and bool(extra) and not ncues
    capped = not a.sfx_stem and bool(extra) and not hints
    if capped:
        cap_on_mix(rows, a.af, extra)
    no_cues = hint_rows(rows, extra) if hints else None
    print(f"video fps={m.fps:.3f} (1 frame = {fr * 1000:.1f} ms); window +/-{a.window * 1000:.0f} ms; offset = audio - "
          f"picture (+ = sound late); audio from {src}" + (f" with -af {a.af}" if a.af else ""))
    if not onsets:
        print("no audio onsets found (silence, or the gate is too high)")
    for r in rows:
        print("  " + sync_line(r, fr))
    if rest:
        print("  sounds with no cue or picture event within window: " + ", ".join(f"{o['t']:.3f}s" for o in rest))
    rep = sync_report(rows, ncues, " on the mix" if capped else "")
    if rep:
        print(f"{rep[0]} {rep[1]}")
    if hint:
        print("NOTE " + hint)
    for lv, text in peak_cue_checks(tl):
        print(f"{lv} {text}")
    if kit_note:
        print("NOTE " + kit_note)
    if spans:
        print("NOTE " + layers_note(spans, not a.sfx_stem))
    if capped:
        print(f"NOTE {extra} planned and no --sfx-stem was given: verdicts are capped at WARN (measure with --sfx-stem "
              "for a verdict)")
    if no_cues:
        print("NOTE " + no_cues)
    return 1 if any(r["level"] == "FAIL" for r in rows) or (ncues and not onsets) else 0


# ---------------------------------------------------------------- loudness
def ebur128(path, momentary=False):
    """Integrated loudness, LRA and true peak from the summary; momentary=True adds 'M': [(t, LUFS)] every 0.1 s (the
    board's strip, S13) from the same pass."""
    log = "info" if momentary else "quiet"
    p = run(FF + ["-i", path, "-map", "0:a:0", "-vn", "-af", f"ebur128=peak=true:framelog={log}", "-f", "null", "-"])
    txt = p.stderr[p.stderr.rfind("Summary:"):]

    def g(label, unit):
        mm = re.search(label + r":\s+(\S+)\s+" + unit, txt)
        return fnum(mm.group(1), -120.0) if mm else -120.0
    # the summary labels true peak "dBFS"; with peak=true it is dBTP
    out = {"I": g("I", "LUFS"), "LRA": g("LRA", "LU"), "TP": g("Peak", "dBFS")}
    if momentary:
        out["M"] = [(round(fnum(t), 2), fnum(v, -120.0)) for t, v in
                    re.findall(r"t:\s*([\d.]+)\s+TARGET:\S+\s+LUFS\s+M:\s*(\S+)", p.stderr)]
    return out


def spec_names():
    """--spec choices: the registers (S17), auto, the destinations (registers.json), none."""
    R = registers()
    return tuple(R["registers"]) + ("auto",) + tuple(R["destinations"]) + ("none",)


def loudness_spec(spec, register=None):
    """The loudness target of a --spec (S17): a register (calm, neutral, energetic), auto (the film's register;
    neutral when it names none, as mix.py masters it), or a destination (web, voice, ebu, atsc), which wins when the
    brief names it. Every number comes from scripts/registers.json. Returns {name, kind, target, range, tp, note}."""
    R, note = registers(), None
    if spec == "auto":
        if register and register not in R["registers"]:
            raise ToolError(f"register '{register}' is not one of {', '.join(R['registers'])} (scripts/registers.json)")
        spec = register or "neutral"
        if not register:
            note = "no register in the timeline: judged as neutral, as mix.py masters it (S17)"
    if spec in R["registers"]:
        L, kind = R["registers"][spec]["loudness"], "register"
    elif spec in R["destinations"]:
        L, kind = R["destinations"][spec], "destination"
    else:
        raise ToolError(f"--spec {spec}: one of {', '.join(spec_names())}")
    lo, hi = L["accept_lufs"]
    return {"name": spec, "kind": kind, "target": L["target_lufs"], "range": (lo, hi), "tp": L["true_peak_max_dbtp"],
            "note": note}


def loudness_verdicts(r, spec, target=None, tp=None, register=None):
    """[(level, text)] for measured loudness r against the spec (loudness_spec; --target and --tp override it, the
    target accepting +/-1 LU); silence is reported, never judged as loud or quiet."""
    if r["TP"] <= -90.0:
        return [("SILENT", "the audio track is digital silence")]
    if spec == "none" and target is None:
        return [("NOTE", f"loudness {r['I']:.1f} LUFS, true peak {r['TP']:.1f} dBTP, LRA {r['LRA']:.1f} LU (no target: --spec none)")]
    S = loudness_spec("auto" if spec == "none" else spec, register)
    tgt = S["target"] if target is None else target
    lo, hi = S["range"] if target is None else (target - 1.0, target + 1.0)
    ceil = S["tp"] if tp is None else tp
    what = (f"{S['name']}'s {lo:g} to {hi:g} LUFS (target {tgt:g})" if target is None
            else f"the {lo:g} to {hi:g} LUFS around --target {tgt:g}")
    out, outside = [], not lo - 1e-9 <= r["I"] <= hi + 1e-9
    if outside:
        out.append(("FAIL", f"integrated loudness {r['I']:.1f} LUFS is outside {what}; remaster (S5)"))
    if r["TP"] > ceil:
        out.append(("FAIL", f"true peak {r['TP']:.1f} dBTP is above the {ceil:g} dBTP ceiling"))
    plr, room = r["TP"] - r["I"], ceil - tgt
    if plr > room and outside:
        out.append(("NOTE", f"peak-to-loudness ratio {plr:.1f} dB > {room:.1f} dB: gain alone cannot reach {tgt:g} LUFS under "
                    f"{ceil:g} dBTP, so loudnorm would compress; tame the peaks in the mix first"))
    if not any(lv == "FAIL" for lv, _ in out):
        out.insert(0, ("PASS", f"loudness {r['I']:.1f} LUFS, true peak {r['TP']:.1f} dBTP, LRA {r['LRA']:.1f} LU, within "
                       f"{what}, true peak at most {ceil:g} dBTP"))
    if S["note"] and target is None:
        out.append(("NOTE", S["note"]))
    return out


def cmd_loudness(a):
    m = Media(a.file)
    if not m.a:
        print(f"N/A {a.file} has no audio stream" + (f" (a {a.kind} master carries none: gate its sound on the master's "
                                                       "pack)" if a.kind in QUIET_KINDS else "")); return 0
    r = ebur128(a.file)
    reg = (load_timeline(a.timeline) or {}).get("register") if getattr(a, "timeline", None) else None
    print(f"integrated {r['I']:.1f} LUFS  LRA {r['LRA']:.1f} LU  true peak {r['TP']:.1f} dBTP")
    vs = loudness_verdicts(r, a.spec, a.target, a.tp, reg)
    for lv, text in vs:
        print(("N/A" if lv == "SILENT" else lv), text)
    if a.normalize:
        S = loudness_spec("auto" if a.spec == "none" else a.spec, reg)
        tgt = a.target if a.target is not None else S["target"]
        ceil = a.tp if a.tp is not None else S["tp"]
        gain = tgt - r["I"]
        adur = fnum(m.a.get("duration")) or m.duration
        if r["TP"] + gain <= ceil - 0.3:  # exact gain on the R128 measurement, with 0.3 dB for AAC overshoot
            af, how = f"volume={gain:.2f}dB", f"linear gain {gain:+.2f} dB"
        else:  # gain alone would break the ceiling: two-pass loudnorm, which compresses
            flt = f"loudnorm=I={tgt}:TP={ceil}:LRA={a.lra}"
            p1 = run(FF + ["-i", a.file, "-map", "0:a:0", "-vn", "-af", flt + ":print_format=json", "-f", "null", "-"]).stderr
            j = json.loads(p1[p1.rfind("{"):p1.rfind("}") + 1])
            lra2 = max(a.lra, min(50.0, fnum(j["input_lra"]) + 1.0))
            af = (f"loudnorm=I={tgt}:TP={ceil}:LRA={lra2:.1f}:measured_I={j['input_i']}:measured_TP={j['input_tp']}"
                  f":measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true")
            how = "two-pass loudnorm (dynamic: it compresses; listen to the transients)"
        # loudnorm flushes ~100 ms of extra samples: trim the result to the source length
        run(FF + ["-loglevel", "error", "-y", "-i", a.file, "-map", "0:v?", "-map", "0:a:0", "-c:v", "copy", "-af",
                  f"{af},atrim=duration={adur:.6f}", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
                  a.normalize])
        r2 = ebur128(a.normalize)
        print(f"normalized with {how}")
        print(f"after: integrated {r2['I']:.1f} LUFS  LRA {r2['LRA']:.1f} LU  true peak {r2['TP']:.1f} dBTP -> {a.normalize}")
        vs = loudness_verdicts(r2, a.spec, a.target, a.tp, reg)
        for lv, text in vs:
            print(("N/A" if lv == "SILENT" else lv), "after:", text)
    return 1 if any(lv == "FAIL" for lv, _ in vs) else 0


# ---------------------------------------------------------------- frames: sheet, bursts, phone, side by side
INK, GREY, LIGHT, ACCENT = (20, 20, 28), (110, 110, 120), (225, 225, 230), (230, 90, 0)
MAGENTA = (255, 0, 200)


def even(x):
    return max(2, int(round(x / 2.0)) * 2)


def grab_frames(m, start, count, width, height=None):
    """Decode `count` consecutive frames from `start` s, scaled to width (height keeps the display aspect).
    Returns (w, h, [(pts, rgb_bytes)])."""
    height = height or even(width * m.h / max(1, m.dw))
    vf = f"showinfo,scale={width}:{height}:flags=area,setsar=1,format=rgb24"
    p = run(FF + ["-loglevel", "info", "-ss", f"{max(0.0, start):.4f}", "-copyts", "-i", m.path, "-an", "-sn", "-vf", vf,
                  "-frames:v", str(count), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], binary=True)
    pts = [fnum(x, None) for x in re.findall(r"pts_time:(\S+)", p.stderr.decode(errors="replace"))]
    size = width * height * 3
    frames = [(pts[i] if i < len(pts) else None, p.stdout[i * size:(i + 1) * size]) for i in range(len(p.stdout) // size)]
    return width, height, frames


def grab_at(m, t, width, height=None):
    """The frame on screen at time t (clamped to the last frame)."""
    fr = m.frame_dur()
    t = min(max(0.0, t), max(0.0, m.duration - fr))
    tg = math.floor(t / fr + 0.01) * fr  # event times carry 4 decimals: 11.3333 s is frame 340, not 339
    w, h, fs = grab_frames(m, tg - 0.25 * fr, 1, width, height)
    if not fs:
        w, h, fs = grab_frames(m, max(0.0, m.duration - 3 * fr), 3, width, height)
        fs = fs[-1:]
    if not fs:
        raise ToolError(f"{m.path}: could not decode a frame near {t:.3f}s")
    return w, h, fs[0]


def grab_many(m, times, width):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 4)) as ex:
        return list(ex.map(lambda t: grab_at(m, t, width), times))


def scene_at(tl, t):
    for sc in (tl or {}).get("scenes", []):
        if sc["start"] <= t < sc["end"]:
            return sc["id"]
    return ""


def media_title(m):
    return f"{os.path.basename(m.path)}  {m.duration:.2f}s  {m.w}X{m.h}  {m.fps:.3g} FPS"


def make_sheet(m, out, cells=12, tl=None, max_width=1600):
    """Contact sheet: cells at the midpoints of equal slices, the time (and scene) printed under every cell."""
    cells = max(1, cells)
    portrait = m.h > m.dw
    cols = min(cells, 6 if portrait else 4)
    rows = math.ceil(cells / cols)
    M, G, LBL, TOP = 8, 6, 24, 30
    cw = even((min(max_width, 1600) - 2 * M - G * (cols - 1)) / cols - 1)
    step = m.duration / cells
    times = [(k + 0.5) * step for k in range(cells)]
    got = grab_many(m, times, cw)
    ch = got[0][1]
    W = 2 * M + cols * cw + (cols - 1) * G
    H = TOP + M + rows * (ch + LBL) + (rows - 1) * G + M
    c = Canvas(W, H)
    c.text(M, 8, fit_text(media_title(m) + "  CONTACT SHEET", W - 2 * M), INK)
    shown = []
    for k, (w, h, (pts, rgb)) in enumerate(got):
        x = M + (k % cols) * (cw + G)
        y = TOP + M + (k // cols) * (ch + LBL + G)
        c.blit(x, y, w, h, rgb)
        c.outline(x - 1, y - 1, x + w + 1, y + h + 1, GREY)
        t = pts if pts is not None else times[k]
        shown.append(round(t, 3))
        lab = f"{t:.2f}s" + (f" {scene_at(tl, t)}" if tl else "")
        c.text(x + 2, y + h + 5, fit_text(lab, cw - 4), INK)
    c.save(out)
    return {"file": out, "cols": cols, "rows": rows, "cell_width": cw, "times": shown}


def make_burst(m, t, out, title="", cell_w=None):
    """Five consecutive frames: two before the frame nearest t (the earlier one when t falls halfway), that frame
    (outlined), two after."""
    fr = m.frame_dur()
    portrait = m.h > m.dw
    cw = cell_w or (216 if portrait else 312)
    tg = math.floor(t / fr + 0.5 - 1e-6) * fr  # decoding starts a quarter frame before the -2F frame: no float ties
    w, h, fs = grab_frames(m, max(0.0, tg - 2.25 * fr), 5, cw)
    if not fs:
        raise ToolError(f"{m.path}: no frames decoded near {t:.3f}s")
    M, G, LBL = 8, 6, 24
    W = 2 * M + 5 * cw + 4 * G
    lines, cur = [], f"BURST {t:.3f}s "
    for part in title.split(" + "):  # wrap the reasons onto as many lines as they need
        nxt = cur + (" + " if cur.strip() and not cur.endswith("s ") else " ") + part if cur else part
        if Canvas.text_w(nxt) > W - 2 * M and cur:
            lines.append(cur); cur = "+ " + part
        else:
            cur = nxt
    lines.append(cur)
    TOP = 12 + 18 * len(lines)
    c = Canvas(W, TOP + h + LBL + 2 * M)
    for i, line in enumerate(lines):
        c.text(M, 8 + 18 * i, fit_text(line, W - 2 * M), INK)
    hit = min(range(len(fs)), key=lambda i: abs((fs[i][0] if fs[i][0] is not None else -9) - tg))
    times, labels = [], []
    for i, (pts, rgb) in enumerate(fs):
        x, y = M + i * (cw + G), TOP + M
        c.blit(x, y, w, h, rgb)
        if i == hit:
            c.outline(x - 3, y - 3, x + w + 3, y + h + 3, ACCENT, 3)
        else:
            c.outline(x - 1, y - 1, x + w + 1, y + h + 1, GREY)
        # frames counted from the outlined one; the title keeps the exact time, which may fall between two frames
        labels.append(f"{i - hit:+d}F {pts:.3f}" if pts is not None else "?")
        c.text(x + 2, y + h + 6, fit_text(labels[-1], cw - 4), ACCENT if i == hit else INK)
        times.append(round(pts, 4) if pts is not None else None)
    c.save(out)
    return {"times": times, "labels": labels, "hit": hit}


def clear_box(w, h):
    """The cross-app clear box (references/delivery.md) in a w x h 9:16 frame as (x0, y0, x1, y1): 14% top, 35% bottom, 6% left and
    17% right stay clear of Reels, TikTok and Shorts UI; None for any other aspect (their boxes are title-safe)."""
    if abs(h / max(1, w) - 16 / 9) > 0.03:
        return None
    return tuple(int(round(f * s)) for f, s in zip(CLEAR_916, (w, h, w, h)))


def phone_pages(m, frames, outdir, prefix="page"):
    """Compose 480 px phone frames into pages a viewer shows at full size (<= ~1.1 MP each)."""
    if not frames:
        return []
    w, h = frames[0][1], frames[0][2]
    box = clear_box(w, h)
    M, G, LBL, TOP = 8, 8, 24, 48 if box else 30
    cols = max(1, min(3, int(1.15e6 // ((h + LBL + G + TOP) * (w + G))), (1568 - 2 * M + G) // (w + G)))
    page_w = 2 * M + cols * w + (cols - 1) * G
    rows = max(1, min(3, int((1.15e6 / page_w - TOP - M) // (h + LBL + G))))
    per, pages = cols * rows, []
    for p0 in range(0, len(frames), per):
        chunk = frames[p0:p0 + per]
        nr = math.ceil(len(chunk) / cols)
        c = Canvas(page_w, TOP + nr * (h + LBL + G) + M)
        c.text(M, 8, fit_text(f"PHONE SIZE ({w} PX WIDE): EVERY READ LINE MUST STILL READ", page_w - 2 * M), INK)
        if box:
            c.text(M, 26, fit_text("DASHED BOX = 9:16 CROSS-APP CLEAR BOX: KEEP TEXT AND KEY ACTION INSIDE (C2)",
                                   page_w - 2 * M), MAGENTA)
        for k, (t, fw, fh, rgb) in enumerate(chunk):
            x, y = M + (k % cols) * (w + G), TOP + (k // cols) * (h + LBL + G)
            c.blit(x, y, fw, fh, rgb)
            if box:  # app UI covers the frame outside it (references/delivery.md)
                x0, y0, x1, y1 = x + box[0], y + box[1], x + box[2], y + box[3]
                for dy in (0, 1):  # 2 px dashes stay visible at phone size on busy frames
                    c.hdash(x0, x1, y0 + dy, MAGENTA); c.hdash(x0, x1, y1 - dy, MAGENTA)
                    c.vdash(x0 + dy, y0, y1, MAGENTA); c.vdash(x1 - dy, y0, y1, MAGENTA)
            c.outline(x - 1, y - 1, x + fw + 1, y + fh + 1, GREY)
            c.text(x + 2, y + fh + 5, f"{t:.2f}s", INK)
        path = os.path.join(outdir, f"{prefix}-{len(pages) + 1}.png")
        c.save(path)
        pages.append(path)
    return pages


def phone_times(m, tl, md=None, limit=12):
    """(kept, dropped) times: scene midpoints and last frames, hold midpoints, planned events; else detected events,
    quarters and the end; past `limit`, an even spread is kept and the rest are returned as dropped."""
    fr = m.frame_dur()
    cand = []
    if tl and (tl["scenes"] or tl["holds"] or tl["events"]):
        for sc in tl["scenes"]:
            cand += [(sc["start"] + sc["end"]) / 2, sc["end"] - fr]
        cand += [(h["start"] + h["end"]) / 2 for h in tl["holds"]] + [e["t"] for e in tl["events"]]
    else:
        cand += [e["t"] for e in (md or {}).get("events", [])] + [m.duration * q for q in (0.25, 0.5, 0.75)]
    cand.append(m.duration - fr)
    out = []
    for t in sorted(min(max(0.0, x), m.duration - fr) for x in cand):
        if all(abs(t - u) >= 0.25 for u in out):
            out.append(t)
    if len(out) <= limit:
        return out, []
    keep = {round(i * (len(out) - 1) / (limit - 1)) for i in range(limit)}  # an even spread, always the last frame
    return [t for i, t in enumerate(out) if i in keep], [t for i, t in enumerate(out) if i not in keep]


def make_phone(m, times, outdir):
    os.makedirs(outdir, exist_ok=True)
    got = grab_many(m, times, 480)
    frames = []
    for t, (w, h, (pts, rgb)) in zip(times, got):
        tt = pts if pts is not None else t
        c = Canvas(w, h)
        c.blit(0, 0, w, h, rgb)
        c.save(os.path.join(outdir, f"{tt:07.3f}.png"))
        frames.append((tt, w, h, rgb))
    return phone_pages(m, frames, outdir), [round(f[0], 3) for f in frames]


def load_image_or_frame(spec, height):
    """'file.png' or 'video.mp4@4.5' -> (label, w, h, rgb) scaled to the given height."""
    path, t = spec, None
    if "@" in spec and not os.path.exists(spec):
        path, ts = spec.rsplit("@", 1)
        t = fnum(ts, None)
        if t is None:
            raise ToolError(f"bad time in '{spec}': use video.mp4@seconds")
    m = Media(path)
    if not m.v:
        raise ToolError(f"{path}: no picture")
    w = even(height * m.dw / max(1, m.h))
    if t is None and m.duration > 0.2 and m.v.get("codec_name") not in ("png", "mjpeg", "webp", "bmp", "tiff"):
        t = 0.0
    if t is None:
        p = run(FF + ["-loglevel", "error", "-i", path, "-frames:v", "1", "-vf", f"scale={w}:{height}:flags=area,setsar=1,format=rgb24",
                      "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], binary=True)
        return os.path.basename(path), w, height, p.stdout[: w * height * 3]
    w, h, (pts, rgb) = grab_at(m, t, w, height)
    return f"{os.path.basename(path)} @{(pts if pts is not None else t):.2f}s", w, h, rgb


def make_sbs(specs, out, height=440, title=""):
    """Pictures side by side at one height (same scale), labelled; specs are files or video@seconds."""
    items = [load_image_or_frame(s, height) for s in specs]
    M, G, TOP = 8, 12, 30 if title else 0
    W = 2 * M + sum(i[1] for i in items) + G * (len(items) - 1)
    c = Canvas(W, TOP + 26 + height + M)
    if title:
        c.text(M, 8, fit_text(title, W - 2 * M), INK)
    x = M
    for k, (lab, w, h, rgb) in enumerate(items):
        c.text(x, TOP + 6, fit_text(f"{'AB'[k] if k < 2 else k + 1}: {lab}", w), INK)
        c.blit(x, TOP + 26, w, h, rgb)
        c.outline(x - 1, TOP + 25, x + w + 1, TOP + 27 + h, GREY)
        x += w + G
    c.save(out)
    return out


def cmd_sheet(a):
    m = Media(a.file)
    r = make_sheet(m, a.out, a.cells, load_timeline(a.timeline), a.max_width)
    print(f"{a.out}: {r['cols']}x{r['rows']} cells, {r['cell_width']}px wide; cell times (row-major): "
          + " ".join(f"{x:.2f}" for x in r["times"]))
    return 0


BURSTS = 23  # bursts per pack besides the ending and signature moments; summary.md lists every moment left out


def burst_times(m, tl, md, budget=BURSTS):
    """Moments to burst, merged within 0.2 s: (kept, dropped), each [(t, title)] in time order. Always kept: every event
    or cue marked "signature": true, and the ending, with whatever merged into them. The budget then fills one tier at a
    time (planned events, near-black frames and judder; cues; scene starts and declared steps and effects; detected
    spikes outside effects); a tier that does not fit is sampled evenly over the film."""
    fr, items = m.frame_dur(), []
    if tl:
        items += [(e["t"], -1 if e.get("signature") else 0, f"{e['kind']} '{e['label']}' (plan)") for e in tl["events"]]
        items += [(c["t"], -1 if c.get("signature") else 1, f"cue {c['id']} ({c['sound']})") for c in tl["cues"]]
        items += [(sc["start"], 2, f"scene {sc['id']} starts") for sc in tl["scenes"] if sc["start"] > fr]
        items += [(x["start"], 2, f"steps '{x['label'] or 'steps'}' {grid_text(x)}") for x in tl.get("steps", ())]
        items += [(x["start"], 2, f"effect '{x['label'] or x['kind']}' ({x['kind']})") for x in tl.get("effects", ())]
    if md:
        items += [(e["t"], 3, f"detected {e['kind']} ({e['mag']})") for e in md["events"] if not e.get("effect")]
        items += [(t, 0, "near-black frame") for t in md["black_frames"]]
        prev = None
        for t in md.get("_hole_t", []):  # one burst per run of judder frames
            if prev is None or t - prev > 0.5:
                items.append((t, 0, "judder"))
            prev = t
    items.append((max(0.0, m.duration - 3 * fr), 9, "ending"))
    merged = []  # [t, tier, title, always kept]
    for t, pri, title in sorted(items, key=lambda x: (x[1], x[0])):
        near = [o for o in merged if abs(o[0] - t) < 0.2]
        if near:
            if title not in near[0][2]:
                near[0][2] += " + " + title
            near[0][3] = near[0][3] or pri in (-1, 9)
            continue
        merged.append([t, pri, title, pri in (-1, 9)])
    keep, dropped, left = [o for o in merged if o[3]], [], budget
    for pri in sorted({o[1] for o in merged if not o[3]}):
        tier = sorted((o for o in merged if o[1] == pri and not o[3]), key=lambda o: o[0])
        k = min(len(tier), max(0, left))
        pick = {int((j + 0.5) * len(tier) / k) for j in range(k)} if k else set()
        keep += [o for i, o in enumerate(tier) if i in pick]
        dropped += [o for i, o in enumerate(tier) if i not in pick]
        left -= k
    order = lambda xs: [(o[0], o[2]) for o in sorted(xs, key=lambda o: o[0])]
    return order(keep), order(dropped)


def left_out(what, shown, dropped, cmd):
    """The NOTE for moments a capped image set left out, with the command that makes them (--at appended)."""
    return (f"{what}: {shown} of {shown + len(dropped)} moments shown; none for "
            + ", ".join(f"{t:.3f}" + (f" {title.split(' + ')[0]}" if title else "") for t, title in dropped[:40])
            + (f" and {len(dropped) - 40} more (metrics.json lists them)" if len(dropped) > 40 else "")
            + f"; make the ones you need: {cmd} --at " + ",".join(f"{t:.3f}" for t, _ in dropped[:40]))


def vqa_cmd(*args):
    return " ".join(shlex.quote(x) for x in ("python3", "-B", os.path.abspath(__file__)) + args)


def cmd_bursts(a):
    m = Media(a.file)
    tl = load_timeline(a.timeline)
    dropped = []
    if a.at:
        items = [(t, "") for t in parse_times(a.at)]
    else:
        items, dropped = burst_times(m, tl, motion_data(m, **plan_spans(tl)))
    os.makedirs(os.path.dirname(a.outprefix) or ".", exist_ok=True)
    for t, title in items:
        out = f"{a.outprefix}_{t:07.3f}.png"
        got = make_burst(m, t, out, title)["times"]
        print(f"{out}: frames at " + " ".join(f"{x:.3f}" for x in got if x is not None) + (f"  ({title})" if title else ""))
    if dropped:
        print("NOTE " + left_out("bursts", len(items), dropped, vqa_cmd("bursts", a.file, a.outprefix + "-more")))
    return 0


def cmd_phone(a):
    m = Media(a.file)
    tl = load_timeline(a.timeline)
    times, dropped = (parse_times(a.at), []) if a.at else phone_times(m, tl, None if tl else motion_data(m))
    pages, shown = make_phone(m, times, a.outdir)
    print(f"{len(shown)} phone frames (480 px wide) in {a.outdir}: " + " ".join(f"{t:.2f}" for t in shown))
    print("pages: " + " ".join(pages))
    if dropped:
        print("NOTE " + left_out("phone frames", len(shown), [(t, "") for t in dropped],
                                 vqa_cmd("phone", a.file, os.path.join(a.outdir, "more"))))
    return 0


def cmd_sbs(a):
    out = make_sbs([a.a, a.b], a.out, a.height)
    print(f"{out}: {a.a} | {a.b} at {a.height} px high")
    return 0


# ---------------------------------------------------------------- timeline strip
C_GRID, C_LANE = (236, 236, 241), (190, 190, 198)
C_PLANNED, C_UNPLANNED, C_UNKNOWN = (205, 236, 205), (252, 200, 200), (250, 228, 180)
C_HOLD, C_MOTION, C_SPIKE, C_START = (0, 90, 220), (70, 70, 82), (225, 95, 0), (150, 150, 160)
C_AUDIO, C_ONSET, C_CUE, C_BAD, C_OK, C_WARN = (120, 196, 204), (0, 92, 104), (130, 40, 180), (210, 0, 0), (0, 140, 60), (225, 130, 0)


def tick_step(px_per_s, dur):
    for s in ((0.1, 0.2, 0.5) if dur < 2 else ()) + (1, 2, 5, 10, 15, 30, 60, 120, 300, 600):
        if s * px_per_s >= 46:
            return s
    return 1200


def draw_timeline(out, m, md, env, onsets, tl=None, runs=None, rows=None, audio_note=None, title="", curve=None,
                  thr=THR_STILL):
    """~1600x560 PNG: motion energy (still runs shaded, holds outlined) | detected visual events | audio RMS + onsets |
    plan (scenes, holds, planned events, cues with measured offsets) | seconds. curve: (times, energy, rate) to draw in
    the motion lane instead of md's (the pack draws the frozen measure, S9), with its threshold thr dashed."""
    W, H, X0, X1 = 1600, 560, 150, 1588
    PW, dur = X1 - X0, max(m.duration, 1e-3)
    L1, L2, L3, L4, AX = (32, 200), (206, 262), (268, 388), (394, 496), 498
    c = Canvas(W, H)
    X = lambda t: X0 + max(0.0, min(dur, t)) / dur * PW
    step = tick_step(PW / dur, dur)
    pps = PW / dur
    minor = (0.1 if pps >= 100 else 0.5 if pps >= 40 else 0) if step == 1 else (1 if pps >= 8 and step > 1 else 0)
    k = 0
    while k * step <= dur + 1e-9:  # gridlines first, under the data
        c.vline(X(k * step), L1[0], L4[1], C_GRID)
        k += 1
    head = f"{media_title(m)}  |  {title}" if title else media_title(m)
    c.text(4, 8, fit_text(head, W - 8), INK)
    # lane 1: motion energy
    y0, y1 = L1
    for r in runs or []:
        col = C_UNKNOWN if r.get("planned") is None else (C_PLANNED if r["planned"] else C_UNPLANNED)
        c.rect(X(r["start"]), y0, X(r["end"]), y1, col)
    lo, hi = -2.0, math.log10(300.0)
    Y = lambda v: y1 - (max(lo, min(hi, math.log10(max(v, 1e-6)))) - lo) / (hi - lo) * (y1 - y0 - 4)
    col_v = [0.0] * PW
    ts, vs, rate = curve or (md["_t"], md["_d30"], md["analysis_rate"])
    for t, v in zip(ts, vs):
        a, b = int((t - 1.0 / rate) / dur * PW), int(math.ceil(t / dur * PW))
        for x in range(max(0, a), min(PW, max(b, a + 1))):
            col_v[x] = max(col_v[x], v)
    for x, v in enumerate(col_v):
        if v > 0.01:
            c.rect(X0 + x, Y(v), X0 + x + 1, y1, C_MOTION)
    c.hdash(X0, X1, int(Y(thr)), C_BAD)
    for v, lab in ((100, "100"), (10, "10"), (1, "1"), (0.1, "0.1")):
        c.text(X0 - 4 - Canvas.text_w(lab), int(Y(v)) - 7, lab, C_BAD if v == 0.1 else GREY)
    for h in (tl or {}).get("holds", []):
        c.outline(X(h["start"]), y0 + 1, X(h["end"]) + 1, y1 - 1, C_HOLD, 2)
    c.text(4, y0 + 4, "MOTION", INK)
    c.text(4, y0 + 22, "LOG", GREY)
    # lane 2: detected visual events
    y0, y1 = L2
    lr = LabelRows(2)
    for e in md["events"]:
        x = int(X(e["t"]))
        if e["kind"] == "spike":
            c.rect(x, y0, x + 2, y1, C_SPIKE)
        else:
            c.rect(x, (y0 + y1) // 2, x + 1, y1, C_START)
        lab = f"{e['t']:.2f}"
        row = lr.place(x + 4, x + 4 + Canvas.text_w(lab))
        if row is not None:
            c.text(x + 4, y0 + 4 + row * 18, lab, C_SPIKE if e["kind"] == "spike" else GREY)
    for t in md.get("_hole_t", []):
        c.rect(X(t), y1 - 8, X(t) + 2, y1, C_BAD)
    for t in md.get("black_frames", []):
        c.rect(X(t) - 1, y0, X(t) + 3, y1, INK)
    c.text(4, y0 + 4, "VISUAL", INK)
    c.text(4, y0 + 22, "EVENTS", INK)
    # lane 3: audio envelope and onsets
    y0, y1 = L3
    c.text(4, y0 + 4, "AUDIO", INK)
    c.text(4, y0 + 22, "DBFS", GREY)
    if env:
        YA = lambda db: y1 - (max(-60.0, min(0.0, db)) + 60.0) / 60.0 * (y1 - y0 - 4)
        for db in (-20, -40):
            c.hdash(X0, X1, int(YA(db)), C_LANE)
            c.text(X0 - 4 - Canvas.text_w(str(db)), int(YA(db)) - 7, str(db), GREY)
        col_a, stp = [-120.0] * PW, 0.005
        for i, db in enumerate(env):
            a, b = int((i - 0.5) * stp / dur * PW), int(math.ceil((i + 0.5) * stp / dur * PW))
            for x in range(max(0, a), min(PW, max(b, a + 1))):
                col_a[x] = max(col_a[x], db)
        for x, db in enumerate(col_a):
            if db > -60:
                c.rect(X0 + x, YA(db), X0 + x + 1, y1, C_AUDIO)
        lr = LabelRows(2)
        loudest, last = max((o["peak_db"] for o in onsets), default=-120.0), None
        for o in onsets:
            x = int(X(o["t"]))
            if o["peak_db"] < loudest - 20.0:  # bed or music flutter: faint, unlabeled
                c.rect(x, y1 - 12, x + 1, y1, (170, 205, 210))
                continue
            c.rect(x, y0, x + 1, y1, C_ONSET)
            lab = f"{o['t']:.2f}"
            if lab == last:  # two attacks of one sound: one label
                continue
            last = lab
            row = lr.place(x + 3, x + 3 + Canvas.text_w(lab))
            if row is not None:
                c.text(x + 3, y0 + 4 + row * 18, lab, C_ONSET, bg=(255, 255, 255))
    if audio_note:
        bad = audio_note.startswith("!")
        note = audio_note.lstrip("!")
        c.text(X0 + (PW - Canvas.text_w(note)) // 2, (y0 + y1) // 2 - 7, note, C_BAD if bad else GREY, bg=(255, 255, 255))
    # lane 4: the plan
    y0, y1 = L4
    c.text(4, y0 + 4, "PLAN", INK)
    c.text(4, y0 + 22, "JSON", GREY)
    if not tl:
        msg = "NO TIMELINE: PASS --TIMELINE TO DRAW HOLDS, EVENTS AND CUES"
        c.text(X0 + (PW - Canvas.text_w(msg)) // 2, (y0 + y1) // 2 - 7, msg, GREY)
    else:
        for i, sc in enumerate(tl["scenes"]):
            xa, xb = X(sc["start"]), X(sc["end"])
            c.rect(xa, y0, xb, y0 + 20, (232, 232, 240) if i % 2 == 0 else (214, 214, 226))
            name = sc["id"] + (": " + sc["label"] if sc["label"] and sc["label"].lower() != sc["id"].lower() else "")
            c.text(int(xa) + 4, y0 + 3, fit_text(name, int(xb - xa) - 8), INK)
        for h in tl["holds"]:
            c.rect(X(h["start"]), y0 + 24, X(h["end"]), y0 + 36, (196, 214, 250))
            c.outline(X(h["start"]), y0 + 24, X(h["end"]) + 1, y0 + 36, C_HOLD, 1)
        lr = LabelRows(1)
        for e in tl["events"]:
            x = int(X(e["t"]))
            c.tri_down(x, y0 + 41, 6, C_SPIKE)
            lab = e["kind"]
            if lr.place(x + 9, x + 9 + Canvas.text_w(lab)) is not None:
                c.text(x + 9, y0 + 41, lab, C_SPIKE)
        lr = LabelRows(2)
        res = {r["id"]: r for r in rows or [] if r.get("kind") == "cue"}
        for cu in tl["cues"]:  # markers reserve their own space on the first label row
            lr.used[0].append((int(X(cu["t"])) - 4, int(X(cu["t"])) + 2))
        for cu in tl["cues"]:
            x, yc = int(X(cu["t"])), y0 + 66
            r, right = res.get(cu["id"]), x
            c.diamond(x, yc, 6, C_CUE)
            if r and r.get("meas_t") is not None:  # measured sound: a bar from the cue to it, coloured by verdict
                # green only when confirmed against a change the picture shows; on time against the plan alone: cue colour
                colr = {"ok": C_OK if r.get("confirmed") else C_CUE, "WARN": C_WARN}.get(r["level"], C_BAD)
                xm = int(X(r["meas_t"]))
                c.rect(min(x, xm), yc - 1, max(x, xm) + 1, yc + 2, colr)
                c.rect(xm - 1, yc - 9, xm + 2, yc + 10, colr)
                right = max(x, xm)
                lab = cu["id"] + ("" if r["level"] == "ok" else " NOT SEEN" if r.get("off_level") == "ok"
                                  else f" {r['off'] * 1000:+.0f}ms")
            elif r and (r["level"] == "NOTE" or r.get("masked")):  # nothing measured: another sound covers this cue
                colr, lab = (C_WARN if r.get("masked") else C_CUE), cu["id"] + " NOT ISOLATED"
            else:
                missing = bool(r) or (audio_note or "").startswith("!")
                colr, lab = (C_BAD if missing else C_CUE), cu["id"] + (" NO SOUND" if r or audio_note else "")
            row = lr.place(right + 9, right + 9 + Canvas.text_w(lab))
            if row is not None:
                c.text(right + 9, yc - 7 + row * 18, lab, C_CUE if colr in (C_OK, C_CUE) else colr)
    for lane in (L1, L2, L3, L4):
        c.outline(X0 - 1, lane[0], X1 + 1, lane[1] + 1, C_LANE)
    # time axis
    k = 0
    while k * step <= dur + 1e-9:
        x = int(X(k * step))
        c.rect(x, AX, x + 2, AX + 8, INK)
        lab = f"{k * step:g}s"
        c.text(min(max(0, x - Canvas.text_w(lab) // 2), W - Canvas.text_w(lab) - 2), AX + 11, lab, INK)
        k += 1
    if minor:
        k = 0
        while k * minor <= dur + 1e-9:
            c.rect(X(k * minor), AX, X(k * minor) + 1, AX + 4, GREY)
            k += 1
    # legend
    x, y = 4, 538
    for col, lab, kind in ((C_PLANNED, "STILL PLANNED", "box"), (C_UNPLANNED, "STILL UNPLANNED", "box"),
                           (C_UNKNOWN, "STILL NO PLAN", "box"), (C_HOLD, "HOLD", "outline"), (C_BAD, f"{thr:g} STILL", "dash"),
                           (C_SPIKE, "SPIKE", "bar"), (C_ONSET, "ONSET", "bar"), (C_CUE, "CUE", "diamond"),
                           (C_SPIKE, "EVENT", "tri"), (C_OK, "CONFIRMED", "bar"), (C_CUE, "PLACED", "bar"), (C_WARN, "WARN", "bar"),
                           (C_BAD, "FAIL", "bar")):
        if kind == "box":
            c.rect(x, y + 1, x + 14, y + 13, col); c.outline(x, y + 1, x + 14, y + 13, C_LANE)
        elif kind == "outline":
            c.outline(x, y + 1, x + 14, y + 13, col, 2)
        elif kind == "dash":
            c.hdash(x, x + 14, y + 7, col, 4, 3)
        elif kind == "bar":
            c.rect(x + 6, y, x + 8, y + 14, col)
        elif kind == "diamond":
            c.diamond(x + 7, y + 7, 6, col)
        else:
            c.tri_down(x + 7, y + 2, 6, col)
        x = c.text(x + 18, y + 1, lab, GREY) + 14
    c.save(out)
    return out


# ---------------------------------------------------------------- review rounds: codes, board, prompts, ledger
# A round is qa/vN (or qa/proto) inside the work folder new.py made: brief.txt, plan.md and .c2v/state.json beside qa/.
# No tool here takes the author's word that someone looked: codes exist only as pixels on the boards and as salted
# hashes in metrics.json, replies are checked against those hashes and the prompts' logged sha256, and the ledger is
# rebuilt from the reply files and the packs on every call (S13-S15).
CODE_CHARS = "ACEFHKMNPRTWXY3479"  # read off pixels with no 0/O, 1/I, 2/Z, 5/S, 6/G or 8/B to confuse
CODE_BOX, CODE_INK, CODE_SCALE = (255, 230, 0), (0, 0, 0), 6  # a CODE_BOX-filled box, its glyphs CODE_INK, 6 px a dot
CODE_KDF = 1_000_000  # pbkdf2-sha256 rounds per stored code: trying all 18^4 codes costs CPU-hours, not seconds (R11)
REPLY_MAX = 550       # characters in a reviewer's reply (S14)
BLIND_WORDS = {"sentence": 12, "remembered": 6, "show": 6, "finding": 6, "lines": 5}  # a full reply fits REPLY_MAX (M9)
RECHECK_WORDS = {"seen": 10, "recheck": 4}
RECHECK_PER_PROMPT = 8  # open findings per recheck prompt, worst first; more go to recheck-2, recheck-3, ...
MATCH_S = 0.5         # a blind finding keeps an open finding's id when their spans come within this (s), same tag
SCENE_REACH = 1.0     # with no timeline scenes, the signature's scene is this far either side of it (s)
REVIEW_STEPS = 20     # the reviewer's --max-model-steps
BOARD_W = 1600
SEVERITY = {"H": 3, "M": 2, "L": 1}
TAGS = ("idea", "clarity", "pacing", "frozen", "layout", "type", "motion", "seam", "sound", "sync", "name", "copy",
        "fact", "other")
GENERIC_WORDS = {"logo", "screen", "text", "card", "app", "video", "film"}  # never name the idea (S14)
STOP_WORDS = {"a", "an", "the", "of", "to", "in", "on", "and", "or", "with", "for", "its", "it", "as", "at", "by",
              "from", "into"}
TIER_RANK = {"S": 0, "R": 0, "M": 1, "L": 2, "LF": 3}
MUSE_FLAGS = ("--prompt-file", "--image", "--workspace", "--disable-write", "--disable-shell", "--disable-reminders",
              "--max-model-steps", "--session-id", "--config")
SKILL_ID = "code-to-video"
NOT_VERIFIED = ("Not verified by any tool: how it sounds; motion between sampled frames; facts; names drawn outside the "
                "page's text")
END_RE = re.compile(r"^END((?:[ \t]+\d+)+)[ \t]*$", re.M)
FINDING_RE = re.compile(r"^([HML]|RECHECK)[ \t]", re.M)


class Refused(Exception):
    """A round that may not start yet: exit 2 with one line naming the file and what is missing (S15)."""


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for blk in iter(lambda: fh.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def text_of(path):
    """A UTF-8 text file's contents, or None when it is missing or unreadable."""
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except (OSError, UnicodeDecodeError):
        return None


def json_of(path):
    """A JSON file's top-level object, or None when it is missing or not an object."""
    t = text_of(path)
    try:
        doc = json.loads(t) if t is not None else None
    except ValueError:
        return None
    return doc if isinstance(doc, dict) else None


def new_codes():
    """(author, reviewer): two different codes from CODE_CHARS, each holding a digit and a letter that is no hex digit,
    so no word, number, verdict or hash in a text file can hold one by chance."""
    def one():
        while True:
            c = "".join(secrets.choice(CODE_CHARS) for _ in range(4))
            if any(x in "3479" for x in c) and any(x in "HKMNPRTWXY" for x in c):
                return c
    a, r = one(), one()
    while r == a:
        r = one()
    return a, r


def code_hash(code, salt, rounds):
    return hashlib.pbkdf2_hmac("sha256", code.encode(), bytes.fromhex(salt), rounds).hex()


def code_record(**codes):
    """What metrics.json keeps of a board's codes: a salted pbkdf2-sha256 of each, never the code (S13, R11)."""
    salt = secrets.token_hex(16)
    return dict({"kdf": "pbkdf2_sha256", "rounds": CODE_KDF, "salt": salt},
                **{k: code_hash(c, salt, CODE_KDF) for k, c in codes.items()})


def code_ok(rec, which, text):
    """Whether text is the code rec keeps under which ('author' or 'reviewer')."""
    c = (text or "").strip().upper()
    if not isinstance(rec, dict) or not rec.get(which) or not re.fullmatch(f"[{CODE_CHARS}]{{4}}", c):
        return False
    try:
        return hmac.compare_digest(code_hash(c, rec["salt"], int(rec.get("rounds", CODE_KDF))), rec[which])
    except (KeyError, TypeError, ValueError):
        return False


def review_head(text):
    """What review.md opens with: ('code', the four characters), ('no-vision', None), or (None, the line)."""
    for line in (text or "").splitlines():
        s = line.strip().strip("#*>`_").strip()
        if not s:
            continue
        if re.match(r"no vision\b", s, re.I):
            return "no-vision", None
        m = re.match(rf"(?:code\b\W*)?([{CODE_CHARS}]{{4}})\b", s, re.I)
        return ("code", m.group(1).upper()) if m else (None, s[:40])
    return None, None


def review_missing(text, ids):
    """The finding ids review.md does not name."""
    return [i for i in ids if not re.search(rf"(?<![\w-]){re.escape(i)}(?![\w-])", text or "")]


def work_of(out):
    """(work folder, round name) when out is qa/vN or qa/proto inside a work folder (brief.txt or .c2v/state.json beside
    qa/), else (None, the folder's name). The names match in any case, since macOS's default filesystem folds case:
    qa/V1 is the folder qa/v1 there."""
    out = os.path.abspath(out)
    qa, name = os.path.split(out)
    work, low = os.path.dirname(qa), name.lower()
    if os.path.basename(qa).lower() == "qa" and (low == "proto" or re.fullmatch(r"v[1-9]\d*", low)) and any(
            os.path.isfile(os.path.join(work, *p)) for p in (("brief.txt",), (".c2v", "state.json"))):
        return work, low
    return None, name


def round_no(name):
    return 0 if name == "proto" else int(name[1:])


def state_of(work):
    return json_of(os.path.join(work, ".c2v", "state.json")) or {}


def rounds_of(work, upto=None):
    """[(name, n, folder, metrics)] of the packed rounds under work/qa: proto as n 0, then v1, v2, ..., up to n upto."""
    qa, out = os.path.join(work, "qa"), []
    for name in (os.listdir(qa) if os.path.isdir(qa) else []):
        if name == "proto" or re.fullmatch(r"v[1-9]\d*", name):
            met = json_of(os.path.join(qa, name, "metrics.json"))
            if met is not None and (upto is None or round_no(name) <= upto):
                out.append((name, round_no(name), os.path.join(qa, name), met))
    return sorted(out, key=lambda r: r[1])


def plan_value(text, key):
    """plan.md's 'Key: value' line as new.py reads it (bullets and bold allowed), its value without a trailing star."""
    m = re.search(rf"^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?{re.escape(key)}(?:\*\*)?[ \t]*:(?:\*\*)?[ \t]*(.*)$", text or "",
                  re.M)
    return re.sub(r"[ \t]*\*[ \t]*$", "", m.group(1)).strip() if m else None


def idea_record(work):
    """plan.md's Idea and Picture words lines and their sha256: what the first board freezes (S15)."""
    plan = text_of(os.path.join(work, "plan.md")) or ""
    idea, words = plan_value(plan, "Idea"), plan_value(plan, "Picture words")
    return {"idea": idea, "picture_words": words, "sha256": hashlib.sha256(json.dumps([idea, words]).encode()).hexdigest()}


def plan_register(plan):
    """(register, brief word or None, problem or None) from plan.md's 'Register: <r> (brief word: "<w>")' or
    '(brief word: none)', the line new.py fills."""
    v = plan_value(plan, "Register")
    if v is None:
        return None, None, "plan.md has no Register line"
    m = re.match(r"(\w+)\s*\(\s*brief word\s*:\s*(?:none|\"([^\"]+)\"|“([^”]+)”)\s*\)", v, re.I)
    if not m:
        return (v.split() or [None])[0], None, ("plan.md's Register line is not 'Register: <register> (brief word: "
                                                "\"<word>\")' or '(brief word: none)'")
    return m.group(1).lower(), m.group(2) or m.group(3), None


def stems(text):
    """Word stems for S14's picture-word match: lowercase words less a plural or verb ending, generic and stop words
    left out; Chinese, Japanese and Korean as character pairs."""
    out = set()
    for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
        if w in STOP_WORDS or w in GENERIC_WORDS:
            continue
        for suf in ("ing", "ed", "es", "s"):
            if len(w) - len(suf) >= 3 and w.endswith(suf):
                w = w[:-len(suf)]
                break
        out.add(w)
    for run_ in re.findall(r"[぀-ヿ㐀-鿿가-힯]+", text or ""):
        out |= {run_[i:i + 2] for i in range(max(1, len(run_) - 1))}
    return out


def names_idea(text, words):
    """Whether text holds one of the picture words' stems (a stem matches its own longer forms: line, lines)."""
    return any(a == b or (min(len(a), len(b)) >= 3 and (a.startswith(b) or b.startswith(a)))
               for a in stems(text) for b in words)


def signature_of(tl):
    """(time, kind, source) of the timeline's signature moment: an event marked "signature": true, else a move marked
    so (its speed peak, else its landing, else its middle); None when none is marked."""
    for e in (tl or {}).get("events", []):
        if e.get("signature"):
            return e["t"], e["kind"], "event"
    for mv in (tl or {}).get("moves", []):
        if mv.get("signature"):
            t = mv["peak"] if mv["peak"] is not None else mv["land"] if mv["land"] is not None else (
                (mv["start"] + mv["end"]) / 2 if mv["start"] is not None and mv["end"] is not None else None)
            if t is not None:
                return t, "move", "move"
    return None


def signature_scene(tl, t, dur):
    """[start, end] of the timeline scene holding time t, else SCENE_REACH either side of it (S14's SHOW rule)."""
    for sc in (tl or {}).get("scenes", []):
        if sc["start"] - 1e-6 <= t < sc["end"]:
            return [round(sc["start"], 3), round(sc["end"], 3)]
    return [round(max(0.0, t - SCENE_REACH), 3), round(min(dur, t + SCENE_REACH), 3)]


def fastest_move(md, fd):
    """The time of the largest motion energy (its 0.2 s mean), cuts left out: the board's burst when no signature is
    marked."""
    t, e = (fd["t"], fd["energy"]) if fd else (md["_t"], md["_s"])
    cuts = [x["t"] for x in md["events"] if x["kind"] == "cut"]
    best = max((k for k in range(len(t)) if all(abs(t[k] - c) > 0.15 for c in cuts)), key=lambda k: e[k], default=None)
    return t[best] if best is not None else 0.0


def decl_sha(tl):
    """sha256 of the declarations a sync result rests on (R7): planned events' times and kinds, cues' times, anchors
    and moves, and the moves' timing; None without a timeline."""
    if not tl:
        return None
    d = ([[e["t"], e["kind"]] for e in tl["events"]]
         + [[c["id"], c["t"], c["anchor"], c.get("move"), c.get("at")] for c in tl["cues"]]
         + [[mv["id"], mv["start"], mv["end"], mv["peak"], mv["land"]] for mv in tl["moves"]])
    return hashlib.sha256(json.dumps(d).encode()).hexdigest()


def ascii_text(s):
    """s with the font's stand-ins (';' as ','), every other non-ASCII character dropped: no '????' on a board."""
    return re.sub(r"[^\x20-\x7e]", "", "".join(_ASCII.get(ch, ch) for ch in str(s))).replace(";", ",")


def kind_title(title):
    """A burst title as kinds only (S13): "transition 'the repaint' (plan) + cue badge (beep)" -> "transition + cue"."""
    out = []
    for part in title.split(" + "):
        w = part.split()
        k = ("scene start" if w[:1] == ["scene"] else " ".join(w[:2]) if w[:1] in (["detected"], ["near-black"])
             else "effect " + part.rsplit("(", 1)[-1].rstrip(")") if w[:1] == ["effect"] and "(" in part
             else w[0] if w else "")
        k = ascii_text(k).strip()
        if k and k not in out:
            out.append(k)
    return " + ".join(out)


def wrap_px(s, max_px, lines=2, scale=2):
    """s in the board font, wrapped at spaces into at most `lines` lines of max_px (the last one cut with a '.')."""
    s, n, out = font_text(ascii_text(s)), max(1, (max_px + scale) // (6 * scale)), []
    while s and len(out) < lines:
        if len(s) <= n:
            out.append(s)
            s = ""
            break
        cut = s.rfind(" ", 0, n + 1)
        cut = cut if cut > n // 2 else n
        out.append(s[:cut].rstrip())
        s = s[cut:].lstrip()
    if s and out:
        out[-1] = out[-1][:max(0, n - 1)] + "."
    return out


def board_info(m, tl, md, pdata, ldata, rows, loud, name, V):
    """What one round's board shows (S13), from its measurements: header, the 12 contact times (each with its frozen,
    alive or rest tag and its layout box and WARN), the burst, the ending, the phone frame, the strip, the top lines."""
    fr, dur = m.frame_dur(), m.duration
    pd, hd, fd = pdata["pacing"], pdata["holds"], pdata["frozen"]
    cls = (["alive" if a else "rest" if r else "frozen" if s else None
            for s, a, r in zip(pd["_still"], pd["_alive"], pd["_rest"])] if pd else [])

    def tag(t):
        return cls[min(range(len(fd["t"])), key=lambda i: abs(fd["t"][i] - t))] if cls else None
    frames, warned = ldata.get("frames") or [], set(ldata.get("warned") or [])
    if len(frames) != LAYOUT_FRAMES:
        frames = [{"t": (k + 0.5) * dur / LAYOUT_FRAMES} for k in range(LAYOUT_FRAMES)]
    contact = [{"t": f["t"], "tag": tag(f["t"]), "box": f.get("box"), "outlined": bool(warned & set(f.get("flags") or []))}
               for f in frames]
    sig = signature_of(tl)
    burst = ({"t": round(sig[0], 3), "source": f"signature {sig[2]}", "kind": ascii_text(sig[1])} if sig else
             {"t": round(fastest_move(md, fd), 3), "source": "fastest move", "kind": "move"})
    holds = tl["holds"] if tl else []
    last = next((h for h in reversed(holds) if h["end"] >= dur - 1.5 * fr), None)
    runs = pd["runs"] if pd else []
    t_end, why = ((last["start"], "final hold") if last else (runs[-1]["start"], "final still")
                  if runs and runs[-1]["final"] else (dur - 1.0, "1 s before the end"))
    ending = [(round(min(max(0.0, t_end), max(0.0, dur - fr)), 3), why), (round(max(0.0, dur - fr), 3), "last frame")]
    best = max((r for r in (hd or {}).get("holds", []) if r.get("need")), key=lambda r: r["need"], default=None)
    longest = max(holds, key=lambda h: h["end"] - h["start"], default=None)
    pt, pwhy = ((best["start"] + best["end"]) / 2, "the hold with the most read text") if best else (
        ((longest["start"] + longest["end"]) / 2, "the longest hold") if longest else (dur - fr, "the last frame"))
    box = clear_box(480, even(480 * m.h / max(1, m.dw)))
    cues = [(r["plan_t"], r["level"] == "ok" and bool(r.get("confirmed"))) for r in rows or [] if r["kind"] == "cue"]
    if not cues and tl:
        cues = [(c["t"], False) for c in tl["cues"]]
    top = [v for v in V if v[0] == "FAIL"] + [v for v in V if v[0] == "WARN"]
    return {"title": name.upper() if name else "BOARD", "register": pdata["register"], "format": pdata["format"],
            "style": pdata["style"], "frozen": pd["frozen_share"] if pd else None, "contact": contact, "burst": burst,
            "ending": ending, "phone": {"t": round(min(max(0.0, pt), max(0.0, dur - fr)), 3), "why": pwhy, "width": 480,
                                        "clear_box": list(box) if box else None},
            "strip": {"t": fd["t"] if fd else md["_t"], "energy": fd["energy"] if fd else md["_s"], "cls": cls,
                      "rate": fd["rate"] if fd else md["analysis_rate"], "thr": FROZEN_E if fd else THR_STILL,
                      "holds": [(h["start"], h["end"]) for h in holds], "cues": cues,
                      "loud": (loud or {}).get("M")},
            "verdicts": top[:4]}


def board_frames(m, b):
    """The pictures both copies of a board show, decoded once: the contact strip, the burst, the ending, the phone frame."""
    M, G = 8, 6
    cols = 12 if m.h > m.dw else 6
    cw = even((BOARD_W - 2 * M - (cols - 1) * G) / cols - 1)
    bw = even((BOARD_W - 2 * M - 8 * G) / 7 - 1)
    fr = m.frame_dur()
    tg = math.floor(b["burst"]["t"] / fr + 0.5 - 1e-6) * fr
    burst = grab_frames(m, max(0.0, tg - 2.25 * fr), 5, bw)
    if not burst[2]:
        raise ToolError(f"{m.path}: no frames decoded near {b['burst']['t']:.3f}s for the board's burst")
    return {"cols": cols, "cw": cw, "bw": bw, "tg": tg, "contact": grab_many(m, [c["t"] for c in b["contact"]], cw),
            "burst": burst, "ending": grab_many(m, [t for t, _ in b["ending"]], bw),
            "phone": grab_at(m, b["phone"]["t"], 480)}


def draw_board(m, b, fs, code, reviewer=False):
    """One board (S13) as (Canvas, labels): the header with the code box, 12 frames with times, the burst, the ending,
    one phone frame, the 1600 x 160 strip. The author copy adds the frozen share, FROZEN, ALIVE and REST tags,
    layout-WARN outlines with content boxes, and the top FAIL and WARN lines; the reviewer copy shows none of them.
    labels: every time and kind label drawn, for metrics.json (no plan wording reaches a board)."""
    W, M, G, LBL, SEC, SH = BOARD_W, 8, 6, 22, 22, 160
    labels, dur, fr = [], max(m.duration, 1e-3), m.frame_dur()

    def lab(c, x, y, s, col=INK, w=None, scale=2):
        s = fit_text(ascii_text(s), w, scale) if w else font_text(ascii_text(s))
        labels.append(s)
        return c.text(x, y, s, col, scale)
    cols, cw, bw = fs["cols"], fs["cw"], fs["bw"]
    ch, rows = fs["contact"][0][1], math.ceil(len(fs["contact"]) / cols)
    bh, (pw, ph) = fs["burst"][1], fs["phone"][:2]
    pad = 2 * CODE_SCALE
    box_w, box_h = 4 * 6 * CODE_SCALE - CODE_SCALE + 2 * pad, 7 * CODE_SCALE + 2 * pad
    xt = M + pw + 18
    legend = ["STRIP BELOW: MOTION ENERGY; RED = FROZEN, AMBER = ALIVE HOLD, GREY = BEAT REST",
              "BLUE BARS = HOLDS. CUES: FILLED = ON A PICTURE CHANGE, HOLLOW = PLACED TO PLAN",
              "LINE = MOMENTARY LOUDNESS, -60 TO 0 LUFS"]
    if b["phone"]["clear_box"]:
        legend.append("DASHED BOX ON THE PHONE FRAME = 9:16 CROSS-APP CLEAR BOX")
    tops = [] if reviewer else [(lv, ln) for lv, chk, text in b["verdicts"]
                                for ln in wrap_px(f"{lv} {chk}: {text}", W - xt - M)]
    HEAD = box_h + 16
    y_c = HEAD + SEC
    y_b = y_c + rows * (ch + LBL + G) - G + SEC + 8
    y_p = y_b + bh + LBL + SEC + 8
    y_s = y_p + max(ph, 20 * (len(legend) + (len(tops) + 2 if tops else 0))) + LBL + SEC + 8
    c = Canvas(W, y_s + SH + M)
    x0 = W - M - box_w  # the code box: the first CODE_BOX pixels from the top; nothing else uses that colour
    c.rect(x0, 8, x0 + box_w, 8 + box_h, CODE_BOX)
    c.text(x0 + pad, 8 + pad, code, CODE_INK, CODE_SCALE)
    head_w = x0 - 2 * M
    reg = f"{b['title']} BOARD | {b['register'] or 'NO REGISTER'} | {b['format'] or 'NO FORMAT'} | STYLE {b['style'] or 'NONE'}"
    if not reviewer:
        reg += f" | FROZEN {b['frozen'] * 100:.1f}%" if b["frozen"] is not None else " | FROZEN SHARE SKIPPED"
    c.text(M, 12, fit_text(ascii_text(reg), head_w), INK)
    c.text(M, 36, fit_text(f"{m.duration:.2f}s {m.w}X{m.h} {m.fps:.3g} FPS", head_w), GREY)
    c.text(M, 60, fit_text("REVIEWER COPY: YOUR REPLY STARTS WITH THE CODE IN THE YELLOW BOX" if reviewer else
                           "AUTHOR COPY: REVIEW.MD STARTS WITH THE CODE IN THE YELLOW BOX", head_w), GREY)
    c.text(M, HEAD + 4, "12 FRAMES AT EQUAL STEPS", GREY)
    for k, (w, h, (pts, rgb)) in enumerate(fs["contact"]):
        x, y = M + (k % cols) * (cw + G), y_c + (k // cols) * (ch + LBL + G)
        c.blit(x, y, w, h, rgb)
        c.outline(x - 1, y - 1, x + w + 1, y + h + 1, GREY)
        cell = b["contact"][k]
        if not reviewer and cell["outlined"]:
            c.outline(x - 3, y - 3, x + w + 3, y + h + 3, C_BAD, 3)
        if not reviewer and cell.get("box"):
            bx = cell["box"]
            c.outline(x + bx[0] * w, y + bx[1] * h, x + bx[2] * w + 1, y + bx[3] * h + 1, MAGENTA, 2)
        tg = "" if reviewer or not cell["tag"] else " " + cell["tag"].upper()
        lab(c, x + 2, y + h + 5, f"{cell['t']:.2f}s{tg}", C_BAD if tg == " FROZEN" else INK, cw - 4)
    bu = b["burst"]
    xe = M + 5 * (bw + G) + 2 * G
    lab(c, M, y_b - SEC + 4, f"SIGNATURE {bu['t']:.3f}s {bu['kind']}" if bu["source"].startswith("signature")
        else f"FASTEST MOVE {bu['t']:.3f}s", INK, xe - M - 2 * G)
    lab(c, xe, y_b - SEC + 4, "ENDING", INK)
    w, h, frames = fs["burst"]
    hit = min(range(len(frames)), key=lambda i: abs((frames[i][0] if frames[i][0] is not None else -9) - fs["tg"]))
    for i, (pts, rgb) in enumerate(frames):
        x = M + i * (bw + G)
        c.blit(x, y_b, w, h, rgb)
        c.outline(x - 3, y_b - 3, x + w + 3, y_b + h + 3, ACCENT, 3) if i == hit else \
            c.outline(x - 1, y_b - 1, x + w + 1, y_b + h + 1, GREY)
        lab(c, x + 2, y_b + h + 6, f"{i - hit:+d}F {pts:.3f}" if pts is not None else f"{i - hit:+d}F", INK, bw - 4)
    for j, ((w, h, (pts, rgb)), (t, what)) in enumerate(zip(fs["ending"], b["ending"])):
        x = xe + j * (bw + G)
        c.blit(x, y_b, w, h, rgb)
        c.outline(x - 1, y_b - 1, x + w + 1, y_b + h + 1, GREY)
        lab(c, x + 2, y_b + h + 6, f"{what} {pts if pts is not None else t:.2f}s", INK, bw - 4)
    pt = b["phone"]["t"]
    lab(c, M, y_p - SEC + 4, f"PHONE 480 PX {pt:.2f}s", INK, pw)
    _, _, (pts, rgb) = fs["phone"]
    c.blit(M, y_p, pw, ph, rgb)
    c.outline(M - 1, y_p - 1, M + pw + 1, y_p + ph + 1, GREY)
    if b["phone"]["clear_box"]:
        bx0, by0, bx1, by1 = (v + o for v, o in zip(b["phone"]["clear_box"], (M, y_p, M, y_p)))
        for dy in (0, 1):
            c.hdash(bx0, bx1, by0 + dy, MAGENTA); c.hdash(bx0, bx1, by1 - dy, MAGENTA)
            c.vdash(bx0 + dy, by0, by1, MAGENTA); c.vdash(bx1 - dy, by0, by1, MAGENTA)
    y = y_p
    for line in legend:
        c.text(xt, y, fit_text(ascii_text(line), W - xt - M), GREY)
        y += 20
    if tops:
        c.text(xt, y + 20, fit_text("TOP FAIL AND WARN LINES (SUMMARY.MD HAS EVERY LINE):", W - xt - M), INK)
        y += 40
        for lv, line in tops:
            c.text(xt, y, line, C_BAD if lv == "FAIL" else C_WARN)
            y += 20
    # the strip: motion energy by class, holds, cues, momentary loudness, seconds
    SW, st = W - 2 * M, b["strip"]
    X = lambda t: M + max(0.0, min(dur, t)) / dur * SW  # noqa: E731
    c.text(M, y_s - SEC + 4, "MOTION | HOLDS | CUES | LOUDNESS", GREY)
    c.rect(M, y_s, M + SW, y_s + SH, (248, 248, 250))
    t, e, dt = st["t"], st["energy"], 1.0 / max(1e-6, st["rate"])
    emax = max([4 * st["thr"]] + list(e))
    colour = {"frozen": C_BAD, "alive": C_WARN, "rest": (160, 160, 170), None: C_MOTION}
    for k in range(len(t)):
        cl = st["cls"][k] if k < len(st["cls"]) else None
        xa, xb = X(t[k] - dt), X(t[k])
        c.rect(xa, y_s + 66 - min(1.0, e[k] / emax) * 62, max(xb, xa + 1), y_s + 66, colour[cl])
        if cl:
            c.rect(xa, y_s + 66, max(xb, xa + 1), y_s + 71, colour[cl])
    for a0, a1 in st["holds"]:
        c.rect(X(a0), y_s + 76, max(X(a1), X(a0) + 1), y_s + 86, C_HOLD)
    for tc, ok in st["cues"]:
        c.diamond(X(tc), y_s + 97, 6, C_CUE)
        if not ok:
            c.diamond(X(tc), y_s + 97, 3, (248, 248, 250))
    if st["loud"]:
        pts_ = [(X(tt), y_s + 144 - (min(0.0, max(-60.0, v)) + 60.0) / 60.0 * 36) for tt, v in st["loud"]]
        for (xa, ya), (xb, yb) in zip(pts_, pts_[1:]):
            c.line(xa, ya, xb, yb, C_ONSET)
    else:
        c.text(M + 4, y_s + 118, "NO AUDIO", GREY)
    step, k = tick_step(SW / dur, dur), 0
    while k * step <= dur + 1e-9:
        x = X(k * step)
        c.rect(x, y_s + 146, x + 1, y_s + 151, GREY)
        lab(c, x + 2, y_s + 151, f"{k * step:g}s", GREY, scale=1)
        k += 1
    return c, labels


def sound_text(m, loud, rows, ncues):
    """The blind prompt's measured sound: integrated loudness, cues, and how many land on a picture change (S14)."""
    if not m.a:
        return "no audio stream."
    if not loud or loud["TP"] <= -90.0:
        return "the audio track is digital silence."
    if rows is None:
        return f"{loud['I']:.1f} LUFS; {ncues} cues, not yet checked against the picture."
    k = sum(1 for r in rows if r["kind"] == "cue" and r["level"] == "ok" and r.get("confirmed"))
    return f"{loud['I']:.1f} LUFS; {ncues} cues, {k} on a picture change."


def card_lines(sid):
    """(the shipped card's Reviewer line or 'none declared', its facts line or None) for the blind prompt (spec 3.5);
    a run-time card gives neither."""
    card = shipped_cards().get(sid) if sid else None
    if not card:
        return "none declared", None
    m = re.search(r"^\*\*Reviewer\.\*\*\s*(.+)$", _CACHE.get("card_text", {}).get(sid, ""), re.M)
    facts = [(lab, card_get(card, path)) for lab, path in (("stage", "stage"), ("palette", "palette.logic"),
                                                           ("accent", "accent.meaning"), ("clock", "motion.clock.kind"),
                                                           ("holds", "motion.holds.kind"))]
    facts = "; ".join(f"{lab} {v.strip()}" for lab, v in facts if isinstance(v, str) and v.strip())
    return (m.group(1).strip() if m else "none declared"), facts or None


def blind_prompt(brief, reviewer, facts, sound):
    """S14's blind prompt: the brief verbatim, the card's Reviewer line and facts, measured sound; never the plan, never
    a FAIL or WARN line. Its word limits keep a reply with every field at its maximum within REPLY_MAX (M9)."""
    w = BLIND_WORDS
    return "\n".join([
        "You are a stranger judging a short video made from code. You did not make it and know nothing about it beyond",
        "the brief. You cannot watch or hear it; you see frames. Look first at board.png (attached, or in this folder):",
        "12 frames with times, the signature moment as 5 frames, the ending, a phone-size frame, and a strip of motion,",
        "holds and sound. Open bursts/ or phone/ here only to check a finding; open no other file and use no skill.",
        f'The brief, exactly as the user wrote it: """{brief}"""',
        f"Intended in this style, not defects: {reviewer}"] + ([f"Facts of this style: {facts}"] if facts else []) + [
        f"Sound, measured: {sound}",
        f"Reply in English in at most {REPLY_MAX} characters, these lines in this order, nothing else:",
        "CODE <the 4 characters in the box on board.png>",
        f"SENTENCE <what this video shows, at most {w['sentence']} words>",
        f"REMEMBERED <one image, at most {w['remembered']} words>",
        f"SHOW <seconds> <at most {w['show']} words: the frame you would show a friend>",
        "IDEA <0-10> (9-10 grown from this subject; 5-6 a style without an idea; 3-4 a template reskin)",
        f"Then up to {w['lines']} lines, worst first: <H|M|L> <start-end|all> <tag> <at most {w['finding']} words>",
        "END <the number of H, M and L lines>",
        "Tags: " + " ".join(TAGS) + ".",
        "H: a stranger would misread it or stop watching; a wrong or misspelled name; key text unreadable; a frozen or",
        "empty stretch the strip marks as longer than its words need; a flash hazard.",
        "M: a designer would fix it: a generic idea, a small or lopsided subject, slide-like pacing, the same layout or",
        "transition every beat, motion laid over a still layout, a constant-speed slide, an ending that sits too long,",
        "sound that fights the brief. L: polish.", ""])


def span_text(sp):
    return "all" if sp == "all" else f"{sp[0]:g}-{sp[1]:g} s"


def recheck_prompt(brief, idea, items):
    """S14's recheck prompt: the same reviewer board, the brief, the Idea line frozen at the first board, and open
    findings in the reviewers' own words; no other plan text, no FAIL or WARN line."""
    w = RECHECK_WORDS
    return "\n".join([
        "You are a stranger checking whether problems other reviewers saw in a short video made from code are still",
        "there. You did not make it. You cannot watch or hear it; you see frames. Look first at board.png (attached, or",
        "in this folder): 12 frames with times, the signature moment as 5 frames, the ending, a phone-size frame, and a",
        "strip of motion, holds and sound. Open no other file and use no skill.",
        f'The brief, exactly as the user wrote it: """{brief}"""',
        f'The idea the film was planned to act out: "{idea}"' if idea else
        "The idea the film was planned to act out was not written down.",
        "Problems earlier reviewers saw, in their words:"]
        + [f"{f['id']} ({f['sev']}, {span_text(f['span'])}, {f['tag']}): {f['text']}" for f in items] + [
        f"Reply in at most {REPLY_MAX} characters, these lines in this order, nothing else:",
        "CODE <the 4 characters in the box on board.png>",
        f"IDEA_SEEN <yes|partly|no> <at most {w['seen']} words: do these frames act out that idea?>",
        f"Then one line per problem above, in its order: RECHECK <id> <GONE|PRESENT|UNSURE> <at most {w['recheck']} "
        "words>",
        "END <the number of RECHECK lines>",
        "GONE only if these frames show the problem fixed; UNSURE if they cannot show it.", ""])


def write_prompt(d, text, ids=None):
    """Write d/prompt.txt; returns what metrics.json logs of it: its sha256, the reviewer's session id, the finding ids."""
    os.makedirs(d, exist_ok=True)
    data = text.encode("utf-8")
    with open(os.path.join(d, "prompt.txt"), "wb") as fh:
        fh.write(data)
    rec = {"sha256": hashlib.sha256(data).hexdigest(), "session_id": str(uuid.uuid4())}
    if ids is not None:
        rec["ids"] = ids
    return rec


def muse_route():
    """(usable, why not): `muse exec` on PATH listing every flag of the reviewer line, probed once with a limit
    (C2V_CHILD_TIMEOUT, at most 60 s; R16)."""
    if "muse" not in _CACHE:
        if not shutil.which("muse"):
            _CACHE["muse"] = (False, "muse is not on PATH")
        else:
            lim = min(60.0, fnum(os.environ.get("C2V_CHILD_TIMEOUT"), 60.0) or 60.0)
            try:
                p = subprocess.run(["muse", "exec", "--help"], stdin=subprocess.DEVNULL, capture_output=True, text=True,
                                   timeout=lim)
                lack = [f for f in MUSE_FLAGS if f not in p.stdout + p.stderr]
                _CACHE["muse"] = (not lack, f"muse exec lacks {', '.join(lack)}" if lack else "")
            except (OSError, subprocess.SubprocessError):
                _CACHE["muse"] = (False, f"muse exec --help gave no answer within {lim:g} s")
    return _CACHE["muse"]


def skill_off_args():
    """-c settings that switch this skill off for the reviewer (C4): each skills.activation map of the user's muse
    settings.json with code-to-video added as off, since a -c value replaces its whole map."""
    cfg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    act = ((json_of(os.path.join(cfg, "muse", "settings.json")) or {}).get("skills") or {})
    act = act.get("activation") if isinstance(act, dict) and isinstance(act.get("activation"), dict) else {}
    out = []
    for scope, key in (("user", f"$CONFIG_DIR/skills/{SKILL_ID}/SKILL.md"),
                       ("bundled", f"bundled://muse-core/skills/{SKILL_ID}/SKILL.md")):
        cur = act.get(scope) if isinstance(act.get(scope), dict) else {}
        out += ["-c", f"skills.activation.{scope}=" + json.dumps(dict(cur, **{key: "off"}), separators=(",", ":"))]
    return out


def launch_line(d, sid):
    """The reviewer line for folder d (S14, C4): run inside d, its workspace, read-only, no reminders, this skill off,
    its own session id; stdout to reply.txt, stderr appended to launch.log, in the background. It ends by appending
    '# exit N', muse's exit status, to launch.log: the record launch_facts reads (muse's own stderr lines are written
    by a healthy run too). Stopping the line by its PID passes the stop on to muse, and records '# exit 143'."""
    argv = (["muse", "exec", "--prompt-file", "prompt.txt", "--image", "board.png", "--workspace", ".", "--disable-write",
             "--disable-shell", "--disable-reminders", "--max-model-steps", str(REVIEW_STEPS), "--session-id", sid]
            + skill_off_args())
    return f"(cd {shlex.quote(os.path.relpath(d))} && {{ {' '.join(shlex.quote(x) for x in argv)} > reply.txt " \
           "2>> launch.log & p=$!; trap 'kill $p' TERM INT; wait $p; echo \"# exit $?\" >> launch.log; }) &"


def review_instructions(work, folders, prompts):
    """What the pack and board print for the reviewers (S14): the exact line per prompt folder, then the subagent
    fallback; the fallback alone when muse cannot run here."""
    ok, why = muse_route()
    out = []
    if ok:
        out.append("Reviewers (S14): run each line exactly as printed, from this folder; each starts one fresh reviewer:")
        out += [launch_line(d, prompts[p]["session_id"]) for p, d in folders]
        out.append("If a line fails (its launch.log ends '# exit N', N not 0), or its reply.txt is still incomplete after "
                   "one rerun of the same line (then add the line '# incomplete' to launch.log):")
    else:
        out.append(f"Reviewers (S14): no muse route here ({why}). For each of "
                   + ", ".join(os.path.relpath(d) for _, d in folders) + ":")
    out.append("give that folder's prompt.txt, unchanged, to a fresh subagent with that folder's board.png; save its "
               "whole reply, verbatim, as reply.txt there and add the line '# route subagent: complete' to launch.log "
               "there; if no subagent can run, add '# route subagent failed: <why>' to launch.log instead.")
    out.append("Then: " + vqa_cmd("ledger", os.path.relpath(work)))
    return out


def copy_pngs(src, dst):
    """The reviewer folder's own copy of src's PNGs (S13), replacing the ones an earlier pack put there."""
    os.makedirs(dst, exist_ok=True)
    for f in os.listdir(dst):
        if f.endswith(".png"):
            os.remove(os.path.join(dst, f))
    for f in sorted(os.listdir(src)) if os.path.isdir(src) else []:
        if f.endswith(".png"):
            shutil.copyfile(os.path.join(src, f), os.path.join(dst, f))


# ---------------------------------------------------------------- the findings ledger (S14)
def normal(text):
    return "\n".join(x.strip() for x in (text or "").replace("\r", "").splitlines())


def reply_complete(text):
    """(complete, why not) by S14's END rule, the one c2v.py's complete() applies: the last END line counts the H, M, L
    or RECHECK lines above it, all together (END n) or per severity (END h m l)."""
    ends = list(END_RE.finditer(text))
    if not ends:
        return False, "no END line"
    want, sev = [int(x) for x in ends[-1].group(1).split()], FINDING_RE.findall(text[:ends[-1].start()])
    got = [len(sev)] if len(want) == 1 else [sev.count(k) for k in "HML"] if len(want) == 3 else None
    return (True, "") if got == want else (False, f"END {' '.join(map(str, want))} but {len(sev)} finding lines")


FINDING_LINE = re.compile(r"([HML])\s+(all|(\d+(?:\.\d+)?)\s*s?(?:\s*(?:[-\u2010-\u2015\u2212]|to)\s*(\d+(?:\.\d+)?)\s*s?)?)"
                          r"\s+([A-Za-z]+)\b[\s:,-]*(.*)$")  # a span as the board prints it (1.50s-2.00s), any dash


def parse_reply(text):
    """The fields of a blind or recheck reply in S14's grammar. A finding's span may carry the board's 's' and any dash,
    or be one time; a finding line (counted by END) that still does not read is filed as span all with its tag, else
    'other', and listed in 'unread' with any RECHECK line that does not read; any other line that fits no field is
    ignored."""
    r = {"code": None, "sentence": None, "remembered": None, "show_t": None, "idea": None, "findings": [], "seen": None,
         "seen_words": "", "rechecks": [], "unread": []}
    for s in normal(text).splitlines():
        m = re.match(r"(CODE|SENTENCE|REMEMBERED|SHOW|IDEA|IDEA_SEEN)\b[:\s]*(.*)$", s)
        key, rest = (m.group(1), m.group(2).strip()) if m else (None, "")
        if key == "CODE" and r["code"] is None:
            r["code"] = (rest.split() or [""])[0]
        elif key in ("SENTENCE", "REMEMBERED"):
            r[key.lower()] = rest
        elif key == "SHOW":
            t = re.match(r"(\d+(?:\.\d+)?)", rest)
            r["show_t"] = float(t.group(1)) if t else None
        elif key == "IDEA":
            v = re.match(r"(\d+)", rest)
            r["idea"] = min(10, int(v.group(1))) if v else None
        elif key == "IDEA_SEEN":
            v = re.match(r"(yes|partly|no)\b[\s:,-]*(.*)$", rest, re.I)
            if v:
                r["seen"], r["seen_words"] = v.group(1).lower(), v.group(2).strip()
        else:
            f = FINDING_LINE.match(s)
            k = re.match(r"RECHECK\s+(F-\d+-\d+)\s+(GONE|PRESENT|UNSURE)\b[\s:,-]*(.*)$", s, re.I)
            if f:
                a_b = None if f.group(2) == "all" else sorted(float(x) for x in (f.group(3), f.group(4) or f.group(3)))
                tag, words = f.group(5).lower(), f.group(6).strip()
                r["findings"].append((f.group(1), "all" if a_b is None else [round(a_b[0], 3), round(a_b[1], 3)],
                                      tag if tag in TAGS else "other", words if tag in TAGS else f"{f.group(5)} {words}"))
            elif k:
                r["rechecks"].append((k.group(1), k.group(2).upper(), k.group(3).strip()))
            elif re.match(r"[HML][ \t]", s):  # counted by END, so never dropped: span all, its tag or 'other'
                ws = s[1:].split()
                at = next((i for i, x in enumerate(ws[:2]) if x.strip(":,.").lower() in TAGS), None)
                tag = "other" if at is None else ws[at].strip(":,.").lower()
                r["findings"].append((s[0], "all", tag, " ".join(ws if at is None else ws[at + 1:])))
                r["unread"].append((s, f"filed as {s[0]} all {tag}"))
            elif FINDING_RE.match(s):
                r["unread"].append((s, "not counted: its finding stays as it was"))
    return r


def spans_meet(a, b):
    """S14: two finding spans match when both are 'all', or when they overlap or come within MATCH_S."""
    if a == "all" or b == "all":
        return a == b
    return a[0] - MATCH_S <= b[1] + 1e-9 and b[0] - MATCH_S <= a[1] + 1e-9


def launch_facts(path):
    """(route, both routes failed) from a reviewer folder's launch.log. The muse route failed only on a record of it:
    '# exit N' with N not 0 (the printed line appends it; c2v.py writes it too), or c2v.py's '# timed out',
    '# incomplete' and '# refused' lines ('# incomplete' is also what the fallback asks for after a rerun); muse's own
    stderr lines are no failure, since a healthy run writes them too. The subagent route failed on the
    '# route subagent failed:' line the fallback asks for. A c2v.py `round --reviewer CMD` call ('# route custom:') is
    no muse route: a folder that holds one never shows both routes failed (R8, M4; else `round --reviewer false`, then
    `review --failed`, would pass --no-blind at tier M)."""
    t = text_of(path)
    if t is None:
        return None, False
    lines = [x.strip() for x in t.splitlines() if x.strip()]
    sub = [x for x in lines if x.startswith("# route subagent")]
    sub_failed = any(x.startswith("# route subagent failed") for x in sub)
    runs = [re.match(r"# (?:exit (-?\d+)\b|(timed out|incomplete|refused)\b)", x) for x in lines]
    line_failed = any(r_ and (r_.group(2) or int(r_.group(1)) != 0) for r_ in runs)
    custom = any(x.startswith("# route custom") for x in lines)
    route = "subagent" if sub and not sub_failed else "custom" if custom else "muse"
    return route, sub_failed and line_failed and not custom


def ledger_pins(work):
    """The replies qa/ledger.json filed before: {round/folder: {sha256, text, prompt, partial}} (S14, M2)."""
    reps = (json_of(os.path.join(work, "qa", "ledger.json")) or {}).get("replies")
    return {k: v for k, v in reps.items() if isinstance(v, dict)} if isinstance(reps, dict) else {}


def filed_reply(q, pname, key, rel, prompt, pins):
    """(text, partial, message) of the reply in q/pname that the ledger may use: the pinned text once the ledger filed
    it (a later edit of reply.txt changes nothing), else a complete reply.txt, else a partial one once both routes
    failed; (None, False, why) while there is none, or while prompt.txt differs from the sha256 the pack logged (B2)."""
    d, want = os.path.join(q, pname), prompt.get("sha256")
    try:
        have = sha256_file(os.path.join(d, "prompt.txt"))
    except OSError:
        have = None
    if not isinstance(want, str) or have != want:
        return None, False, (f"{rel}/prompt.txt changed after the pack wrote it: its reply is refused; pack the round "
                             "again for a fresh prompt (S14, B2)" if have else
                             f"{rel}/prompt.txt is missing: its reply is refused (S14, B2)")
    cur, pin = text_of(os.path.join(d, "reply.txt")), pins.get(key)
    if isinstance(pin, dict) and pin.get("prompt") == want and pin.get("session") == prompt.get("session_id") and \
            isinstance(pin.get("text"), str) and pin.get("sha256") == hashlib.sha256(pin["text"].encode()).hexdigest():
        return pin["text"], bool(pin.get("partial")), (None if cur is None or cur == pin["text"] else
                                                      f"{rel}/reply.txt changed after the ledger filed it: the filed "
                                                      "reply stands (S14)")
    if cur is None or not cur.strip():
        return None, False, None
    ok, why = reply_complete(normal(cur))
    if ok:
        return cur, False, None
    if launch_facts(os.path.join(d, "launch.log"))[1]:
        return cur, True, f"{rel}/reply.txt: incomplete ({why}) and both routes failed: the partial reply stands (S14)"
    return None, False, (f"{rel}/reply.txt: incomplete: rerun the same prompt once on the same route ({why}); a second "
                         "failure switches route; if both routes fail, record it in launch.log and the partial reply "
                         "stands (S14)")


def build_ledger(work, upto=None, pins=None):
    """S14's findings ledger, rebuilt from the reply files and the packs alone, up to round n upto: {findings, open,
    pins (every filed reply's first text, for the pack's own prompt: a round packed again starts afresh), facts (per
    round: blind reply, route), messages}. Of qa/ledger.json only the pins are read back, so nothing the author
    writes under qa/ changes a finding (S14 c)."""
    old, findings, msgs, facts, by_id = dict(pins or {}), [], [], {}, {}
    pins = dict(old)
    rounds = rounds_of(work, upto)
    first_v = next((r for r in rounds if r[1] >= 1 and isinstance(r[3].get("signature"), dict)), None)
    frozen = next((r[3]["idea"] for r in rounds if isinstance(r[3].get("idea"), dict)), None)
    words = stems((frozen or {}).get("picture_words"))

    def close(f, why):
        f["status"], f["closed_by"] = "closed", why
    for name, n, q, met in rounds:
        seq, raised = itertools.count(1), set()
        info = facts[name] = {"blind": None, "route": None, "both_failed": False, "rechecks": []}
        smet = met if n == 0 or not first_v else first_v[3]  # SHOW is judged on v1's signature (S14)
        sig, scene = smet.get("signature"), smet.get("signature_scene")

        def add(sev, tag, span, text, rule, src):
            f = {"id": f"F-{n}-{next(seq)}", "sev": sev, "tag": tag, "span": span, "text": text, "rule": rule,
                 "round": name, "source": src, "status": "open", "closed_by": None, "unsure": 0, "answers": []}
            findings.append(f)
            by_id[f["id"]] = f
            return f

        def bump(f, sev, src):  # raised again: keeps its id and the higher severity
            f["sev"] = sev if SEVERITY[sev] > SEVERITY[f["sev"]] else f["sev"]
            f["answers"].append(f"{src}: raised again")
        prompts = met.get("prompts") if isinstance(met.get("prompts"), dict) else {}
        for pname in sorted(prompts, key=lambda p: (p != "blind", int(p.rsplit("-", 1)[1])
                                                    if re.fullmatch(r"recheck-\d+", p) else 1)):
            key, rel = f"{name}/{pname}", f"qa/{name}/{pname}"
            route, failed = launch_facts(os.path.join(q, pname, "launch.log"))
            if pname == "blind":
                info["route"], info["both_failed"] = route, failed
            held = old.get(key)
            if not (isinstance(held, dict) and held.get("prompt") == prompts[pname].get("sha256")
                    and held.get("session") == prompts[pname].get("session_id")):
                pins.pop(key, None)  # another pack's pin: the round was packed again, so its new reviewer counts
            text, partial, why = filed_reply(q, pname, key, rel, prompts[pname], old)
            if why:
                msgs.append(why)
            if text is None:
                continue
            r = parse_reply(text)
            if not code_ok(met.get("codes"), "reviewer", r["code"]):
                msgs.append(f"{rel}/reply.txt: CODE does not match board {name}'s reviewer code: refused (S14)")
                continue
            pin = {"sha256": hashlib.sha256(text.encode()).hexdigest(), "text": text,
                   "prompt": prompts[pname].get("sha256"), "session": prompts[pname].get("session_id"),
                   "partial": partial}
            pins[key] = pin
            msgs += [f"{rel}/reply.txt: '{line[:70]}' does not read as "
                     + ("'<H|M|L> <start-end|all> <tag> <words>'" if line[0] in "HML" else
                        "'RECHECK <id> <GONE|PRESENT|UNSURE> <words>'") + f": {what} (S14)"
                     for line, what in r["unread"] if (line[0] in "HML") == (pname == "blind")]
            if pname == "blind":
                info["blind"] = "partial" if partial and r["sentence"] else "partial, no SENTENCE" if partial else "ok"
                if info["blind"] == "partial, no SENTENCE":
                    continue  # counts only once CODE and SENTENCE arrived (S14)
                used = set()
                for sev, span, tag, wds in r["findings"]:
                    hit = next((f for f in findings if f["status"] == "open" and f["rule"] == "blind" and f["tag"] == tag
                                and f["id"] not in used and spans_meet(f["span"], span)), None)
                    if hit:
                        bump(hit, sev, key)
                        raised.add(hit["id"])
                    else:
                        hit = add(sev, tag, span, wds, "blind", key)
                    used.add(hit["id"])
                derived = []
                if r["idea"] is not None and r["idea"] <= 6:
                    derived.append(("H" if r["idea"] <= 4 else "M", "idea", f"IDEA {r['idea']} of 10: "
                                    + ("a template reskin" if r["idea"] <= 4 else "a style without an idea")))
                if sig and scene and r["show_t"] is not None and not scene[0] - 1e-6 <= r["show_t"] <= scene[1] + 1e-6:
                    derived.append(("M", "upstaged", f"signature upstaged: the frame to show a friend ({r['show_t']:g} "
                                    f"s) lies outside the signature's scene ({scene[0]:g}-{scene[1]:g} s)"))
                if words and (r["sentence"] or r["remembered"]) and not names_idea(
                        f"{r['sentence'] or ''} {r['remembered'] or ''}", words):
                    derived.append(("M", "not-named", "idea not named: neither the sentence nor the remembered image "
                                    "names what the film was planned to show"))
                for sev, rule, txt in derived:
                    hit = next((f for f in findings if f["status"] == "open" and f["rule"] == rule), None)
                    if hit:
                        bump(hit, sev, key)
                        raised.add(hit["id"])
                    else:
                        add(sev, "idea", "all", txt, rule, key)
                continue
            info["rechecks"].append(pname)
            ids = set(prompts[pname].get("ids") or [])
            if r["seen"] == "yes":
                for f in findings:
                    if f["status"] == "open" and f["rule"] == "idea-seen" and f["round"] != name:
                        close(f, f"recheck {name}: IDEA_SEEN yes")
            elif r["seen"] in ("no", "partly"):
                sev = "H" if r["seen"] == "no" else "M"
                hit = next((f for f in findings if f["status"] == "open" and f["rule"] == "idea-seen"), None)
                if hit:
                    bump(hit, sev, key)
                else:
                    add(sev, "idea", "all", f"IDEA_SEEN {r['seen']}" + (f": {r['seen_words']}" if r["seen_words"] else ""),
                        "idea-seen", key)
            for fid, state, wds in r["rechecks"]:
                f = by_id.get(fid)
                if not f or f["status"] != "open" or (ids and fid not in ids):
                    continue
                f["answers"].append(f"{key}: {state}")
                if state == "GONE":
                    f["unsure"] = 0
                    if fid in raised:
                        f["answers"][-1] += ", but the same round's blind reply raised it again: open"
                    else:
                        close(f, f"recheck {name}: GONE" + (f" ({wds})" if wds else ""))
                elif state == "PRESENT":
                    f["unsure"] = 0
                else:
                    f["unsure"] += 1
                    if f["unsure"] >= 2 and f["sev"] == "H":
                        f["sev"] = "M"
                        f["answers"][-1] += ": a High answered UNSURE twice in a row is now a Medium"
    vr = [r for r in rounds if r[1] >= 1]
    if vr:  # sound and sync findings also close on the latest pack's measured line (S14), sync only with the
        lname, ln, _, lmet = vr[-1]  # declarations unchanged since the finding (R7)
        sync, loud = lmet.get("sync") or {}, (lmet.get("audio") or {}).get("loudness")
        reg, R = (lmet.get("settings") or {}).get("register"), registers()
        reg = lmet["spec"] if lmet.get("spec") in R["destinations"] else reg if reg in R["registers"] else "neutral"
        loud_ok = bool(loud) and loud.get("TP", -120.0) > -90.0 and not any(
            lv == "FAIL" for lv, _ in loudness_verdicts(loud, reg))
        decl = {r[0]: r[3].get("decl_sha256") for r in rounds}
        for f in findings:
            if f["status"] != "open" or round_no(f["round"]) >= ln:
                continue
            if f["tag"] == "sync" and sync.get("n") and sync.get("k") == sync.get("n") and decl.get(f["round"]) and \
                    decl[f["round"]] == lmet.get("decl_sha256"):
                close(f, f"measured at {lname}: sync {sync['k']} of {sync['n']} cues confirmed against the picture, the "
                      f"declarations unchanged since {f['round']} (R7)")
            elif f["tag"] == "sound" and loud_ok:
                close(f, f"measured at {lname}: loudness {loud['I']:.1f} LUFS within {reg}'s range")
    return {"findings": findings, "open": [f["id"] for f in findings if f["status"] == "open"], "pins": pins,
            "facts": facts, "messages": msgs}


def finding_line(f):
    return f"{f['id']} {f['sev']} {span_text(f['span'])} {f['tag']}: {f['text']} ({f['source'].replace('/', ' ')})"


def cmd_ledger(a):
    work = os.path.abspath(a.work)
    if not rounds_of(work):
        raise Refused(f"{a.work}: no packed round under qa/: pack one first ({vqa_cmd('pack', 'VIDEO', '--out', 'qa/v1')})")
    L = build_ledger(work, pins=ledger_pins(work))
    with open(os.path.join(work, "qa", "ledger.json"), "w") as fh:
        json.dump({"schema": 1, "about": "rebuilt by vqa.py ledger from the reply files and packs only (S14): editing it "
                   "changes nothing but the filed replies' pins", "findings": L["findings"], "open": L["open"],
                   "replies": L["pins"], "rounds": L["facts"]}, fh, indent=1)
    for msg in L["messages"]:
        print(msg)
    op = [f for f in L["findings"] if f["status"] == "open"]
    print(f"qa/ledger.json: {len(op)} open finding(s) of {len(L['findings'])}" + (":" if op else ""))
    for f in sorted(op, key=lambda f: -SEVERITY[f["sev"]]):
        print("  " + finding_line(f))
    lname, _, lq, lmet = rounds_of(work)[-1]
    prompts = lmet.get("prompts") if isinstance(lmet.get("prompts"), dict) else {}
    waiting = [(p, os.path.join(lq, p)) for p in sorted(prompts) if f"{lname}/{p}" not in L["pins"]]
    if waiting:
        print(f"Round {lname} still waits for {len(waiting)} reply(ies):")
        for line in review_instructions(work, waiting, prompts):
            print(line)
    return 0


# ---------------------------------------------------------------- looking enforced (S15) and the gate (S19)
def new_py():
    """scripts/new.py beside this file as a module, for its tier rule and round budgets (S24), or None when absent."""
    if "new" not in _CACHE:
        path, mod = os.path.join(HERE, "new.py"), None
        if os.path.isfile(path):
            import importlib.util
            try:
                spec = importlib.util.spec_from_file_location("c2v_new_py", path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
            except Exception:  # noqa: BLE001 - a new.py that does not import leaves the recorded tier standing
                mod = None
        _CACHE["new"] = mod
    return _CACHE["new"]


def tier_of(work, duration=None):
    """(tier, rounds, note): the tier new.py recorded in .c2v/state.json, raised to the tier new.py's own rule gives for
    brief.txt and the film's duration when scripts/new.py sits beside this file (M3; never plan.md's Tier line), and
    its round budget from new.py, else from the record. (None, None, why) without a record."""
    st, nm = state_of(work), new_py()
    rec = st.get("tier") if st.get("tier") in TIER_RANK else None
    tier, note = rec, None
    dur = duration if duration is not None else st.get("duration_s")
    if nm is not None and hasattr(nm, "guess_tier"):
        try:
            got = nm.guess_tier(st.get("revise"), st.get("reference"), dur, text_of(os.path.join(work, "brief.txt")) or "")
        except Exception:  # noqa: BLE001 - the recorded tier stands
            got = None
        if got and got[0] in TIER_RANK and (tier is None or TIER_RANK[got[0]] > TIER_RANK[tier]):
            note = f"tier {got[0]} by new.py's rule ({got[1]}), stricter than the recorded {rec or 'none'} (M3)"
            tier = got[0]
    if tier is None:
        return None, None, "no tier in .c2v/state.json: run new.py init for this work folder"
    rounds = (getattr(nm, "ROUNDS", None) or {}).get(tier) if nm is not None else None
    if rounds is None and tier == rec and isinstance(st.get("rounds"), int):
        rounds = st["rounds"]
    return tier, rounds, note


def check_review(work, name, met, ids, no_vision):
    """S15: qa/<name>/review.md exists, starts with that board's author code (NO VISION under --no-vision) and names
    every id in ids; raises Refused with the file and what is missing."""
    path, board = f"qa/{name}/review.md", "the prototype board" if name == "proto" else f"board {name}"
    text = text_of(os.path.join(work, "qa", name, "review.md"))
    first = "NO VISION" if no_vision else f"{board}'s code"
    if text is None:
        raise Refused(f"write {path}: {first} first, then " + (f"one line per open finding ({', '.join(ids)})" if ids
                                                                else "what you saw"))
    kind, val = review_head(text)
    if not (kind == "code" and code_ok(met.get("codes"), "author", val) or kind == "no-vision" and no_vision):
        raise Refused(f"{path} does not start with {board}'s code" + (" (or NO VISION)" if no_vision else
                                                                      " (NO VISION needs --no-vision)"
                                                                      if kind == "no-vision" else ""))
    miss = review_missing(text, ids)
    if miss:
        raise Refused(f"{path} names no line for {', '.join(miss)}")


def blind_seen(L, name):
    """Whether round `name` has a blind reply carrying its reviewer code that counts (S14: a partial one only with
    CODE and SENTENCE)."""
    return (L["facts"].get(name) or {}).get("blind") in ("ok", "partial")


def preflight(work, name, no_vision=False):
    """S15: whether round `name` (vN) may be packed: at tiers M, L and LF, v1 waits for the prototype board, its
    review.md and (L, LF) its blind reply or a recorded failure of both routes; round N+1 waits for qa/vN/review.md
    with board N's code and every open High and Medium id, and at M, L and LF for round N's blind reply (I8). Raises
    Refused; returns the tier."""
    n, (tier, _, _) = round_no(name), tier_of(work)
    have = {r[0]: r for r in rounds_of(work)}
    if tier in ("M", "L", "LF") and n == 1:
        p = have.get("proto")
        if not p:
            raise Refused(f"make the prototype board first (tier {tier}, S15): "
                          + vqa_cmd("board", "renders/proto.mp4", "--out", "qa/proto",
                                    *(["--tier", tier] if tier != "M" else [])))
        check_review(work, "proto", p[3], [], no_vision)
        if tier != "M":
            L = build_ledger(work, upto=0, pins=ledger_pins(work))
            if not blind_seen(L, "proto") and not L["facts"].get("proto", {}).get("both_failed"):
                raise Refused("qa/proto/blind/reply.txt has no reply carrying the prototype's reviewer code: run the "
                              "reviewer line the board printed, or record both routes failing in qa/proto/blind/"
                              "launch.log (S15)")
    if n >= 2:
        prev = f"v{n - 1}"
        if prev not in have:
            raise Refused(f"qa/{prev} has no pack: pack the rounds in order (S15)")
        L = build_ledger(work, upto=n - 1, pins=ledger_pins(work))
        check_review(work, prev, have[prev][3], [f["id"] for f in L["findings"] if f["status"] == "open"
                                                 and f["sev"] in "HM"], no_vision)
        if tier in ("M", "L", "LF") and not blind_seen(L, prev) and not L["facts"].get(prev, {}).get("both_failed"):
            raise Refused(f"qa/{prev}/blind/reply.txt has no reply carrying board {prev}'s reviewer code: file round "
                          f"{n - 1}'s blind reply (or record both routes failing in its launch.log) before round {n} "
                          "(S15, I8)")
    return tier


def starred(plan):
    """[(key, why)] of the starred plan lines not filled yet (S19 (8)): the keys whose templates/plan.md prompt ends in
    ' *', judged by new.py's blank() rule; without the template, the Idea and Picture words lines the tools read."""
    tpl = text_of(os.path.join(os.path.dirname(HERE), "templates", "plan.md"))
    keys = {"Idea": None, "Picture words": None}
    if tpl is not None:
        keys = {}
        for line in tpl.splitlines():
            m = re.match(r"^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?([A-Z][\w ]{0,40}?)(?:\*\*)?[ \t]*:(.*)$", line)
            if m and m.group(2).rstrip().endswith("*"):
                keys[m.group(1).strip()] = re.sub(r"[ \t]*\*[ \t]*$", "", m.group(2)).strip()
    out = []
    for key, prompt in keys.items():
        v = plan_value(plan, key)
        s = " ".join((v or "").split())
        why = ("missing" if v is None else "empty" if not s else "still the template's prompt"
               if prompt and s == " ".join(prompt.split()) else "a placeholder"
               if "__" in s or re.fullmatch(r"[\s.…_?<>\[\]()-]*|tbd|todo|n/?a|none", s, re.I) else None)
        if why:
            out.append((key, why))
    return out, tpl is not None


def register_problem(reg, word, brief, st=None):
    """S19 (9): why plan.md's register is not pinned to the brief, or None: a quoted word or phrase must appear in
    brief.txt, in any language; 'none' is only the default register's (I2) or, after new.py look, the chosen card's."""
    R = registers()
    if reg not in R["registers"]:
        return f"plan.md's Register line names no register ({', '.join(R['registers'])})"
    if word is None:
        dflt, lk = R["precedence"]["register"]["default"], ((st or {}).get("look") or {}).get("register") or {}
        if reg == dflt or reg == lk.get("value") and str(lk.get("source")).startswith("card "):
            return None
        return f"plan.md pins {reg} with no brief word: only {dflt} or the chosen card's register goes without one (I2)"
    if not re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", brief, re.I):  # new.py look takes the same words
        return f"plan.md pins {reg} with the brief word \"{word}\", which is not in brief.txt"


def placeholders(work):
    """film/ HTML files still holding the starter's [data-placeholder] element (S19 (10); render.mjs lint fails on it)."""
    out, root = [], os.path.join(work, "film")
    for d, subs, names in os.walk(root):
        subs[:] = [x for x in subs if x not in ("node_modules", ".git")]
        for f in names:
            if f.endswith((".html", ".htm")) and re.search(r"<[^>]*\sdata-placeholder\b", text_of(os.path.join(d, f)) or ""):
                out.append(os.path.relpath(os.path.join(d, f), work))
    return sorted(out)


def gate_block(work, a):
    """(ready, block lines, notes) of S19's gate; the block is what report.md pastes verbatim."""
    R, notes, reasons, top = registers(), [], [], []
    vr = [r for r in rounds_of(work) if r[1] >= 1]
    if not vr:
        raise Refused(f"{a.work}: no packed round under qa/: pack qa/v1 first")
    lname, ln, lq, lmet = vr[-1]
    proto = next((r for r in rounds_of(work, 0)), None)
    plan, brief, st = text_of(os.path.join(work, "plan.md")) or "", text_of(os.path.join(work, "brief.txt")) or "", \
        state_of(work)
    final = a.final or (os.path.join(work, "final.mp4") if os.path.isfile(os.path.join(work, "final.mp4"))
                        else lmet.get("video"))
    fname = os.path.basename(final or "final.mp4")
    m = Media(final) if final and os.path.isfile(final) else None
    tier, base, tnote = tier_of(work, m.duration if m else None)
    if tnote:
        notes.append(tnote)
    if tier is None:
        reasons.append(tnote)
        tier, base = "S", 1
    base = base or 1
    # (1) the delivered file passes the probe for its kind; (2) the latest pack is of it and has no FAIL
    kind, facts = lmet.get("kind") or "mp4", None
    if m is None:
        reasons.append(f"{fname} does not exist: copy the last packed render there")
    else:
        facts, issues = probe_data(m, kind)
        bad = [t for lv, t in issues if lv == "FAIL"]
        if bad:
            reasons.append(f"{fname} fails the {kind} delivery probe: {bad[0]}")
        if lmet.get("video_sha256") != sha256_file(final):
            reasons.append(f"{fname} is not the file qa/{lname} packed: pack the delivered file, or deliver that one")
    fails = [v for v in lmet.get("verdicts", []) if v.get("level") == "FAIL"]
    if fails:
        reasons.append(f"qa/{lname} has {len(fails)} FAIL ({fails[0]['check']}: {fails[0]['text'][:100]})")
    # (9) the register pinned to the brief; (3) loudness against it, or the pack's destination spec (S17)
    reg, word, rprob = plan_register(plan)
    rprob = rprob or register_problem(reg, word, brief, st)
    if rprob:
        reasons.append(rprob)
    packed = (lmet.get("settings") or {}).get("register")
    first = (vr[0][3].get("plan_register") or {}).get("value")
    if first and reg and first != reg:
        top.append(f"Register changed since {vr[0][0]}: {first} -> {reg}")
    if reg in R["registers"] and packed and packed != reg:
        reasons.append(f"qa/{lname} was judged as {packed}, but plan.md pins {reg}: set the timeline's register and pack "
                       "again")
    judge = reg if reg in R["registers"] else packed if packed in R["registers"] else "neutral"
    if lmet.get("spec") in R["destinations"]:
        judge = lmet["spec"]  # delivery.md maps the brief's destination to the pack's --spec
    loud = (lmet.get("audio") or {}).get("loudness")
    if loud and loud.get("TP", -120.0) > -90.0:
        lv_ = loudness_verdicts(loud, judge)
        reasons += [t.split("; remaster")[0] for lv, t in lv_ if lv == "FAIL"]
        S = loudness_spec(judge)
        loud_line = (f"Loudness: {loud['I']:.1f} LUFS integrated, true peak {loud['TP']:.1f} dBTP, LRA {loud['LRA']:.1f} "
                     f"LU, against {judge}'s {S['range'][0]:g} to {S['range'][1]:g} LUFS (target {S['target']:g}), true "
                     f"peak at most {S['tp']:g} dBTP: " + ("outside" if any(lv == "FAIL" for lv, _ in lv_) else "within"))
    else:
        loud_line = "Loudness: " + ("digital silence" if loud else "no audio stream") + " (nothing to judge)"
    # (4) the delivered round's review.md carries its board's code
    head = review_head(text_of(os.path.join(lq, "review.md")))
    if head == (None, None):
        reasons.append(f"qa/{lname}/review.md is missing: write board {lname}'s code first")
    elif not (head[0] == "code" and code_ok(lmet.get("codes"), "author", head[1]) or head[0] == "no-vision"
              and a.no_vision):
        reasons.append(f"qa/{lname}/review.md does not start with board {lname}'s code")
    # --no-blind: at S and R; at M only once both routes failed on the delivered round; never at L or LF
    L = build_ledger(work, pins=ledger_pins(work))
    nb_ok = False
    if a.no_blind is not None:
        if tier in ("S", "R"):
            nb_ok = True
        elif tier == "M":
            nb_ok = (L["facts"].get(lname) or {}).get("both_failed", False)
            if not nb_ok:
                reasons.append(f"--no-blind at tier M needs qa/{lname}/blind/launch.log to show both reviewer routes "
                               "failed (a failed muse run, '# exit N' as the printed line records it, then a '# route "
                               "subagent failed:' line)")
        else:
            reasons.append(f"--no-blind is never accepted at tier {tier}: a fresh blind reviewer must see the film")
        if a.no_vision and nb_ok and tier in ("S", "R"):
            nb_ok = False
            reasons.append("--no-vision with --no-blind: no one would look at the frames")
    # (5) the latest blind reply is of the delivered picture; (6) no High open; (7) the tier's rounds
    seen = [r[0] for r in vr if blind_seen(L, r[0])]
    failed = [r[0] for r in vr if (L["facts"].get(r[0]) or {}).get("both_failed")]
    need_blind = tier in ("M", "L", "LF") or a.no_vision
    if need_blind and lname not in seen and not (nb_ok and (tier != "M" or lname in failed)):
        reasons.append(f"the delivered picture ({lname}) was never seen by a fresh reviewer (last: "
                       f"{seen[-1] if seen else 'none'})")
    highs = [f for f in L["findings"] if f["status"] == "open" and f["sev"] == "H"]
    if highs:
        reasons.append("open High: " + "; ".join(f"{f['id']} ({f['text']})" for f in highs))
    if len(vr) < base:
        reasons.append(f"tier {tier} needs {base} rounds; {len(vr)} packed")
    if tier in ("M", "L", "LF"):
        counted = [x for x in [r[0] for r in vr] if x in seen or (nb_ok and x in failed)]
        if len(counted) < base:
            lack = [r[0] for r in vr if r[0] not in counted]
            reasons.append(f"tier {tier} needs a fresh blind reviewer on {base} rounds: {', '.join(lack)} "
                           f"{'has' if len(lack) == 1 else 'have'} no blind reply carrying the reviewer code")
        if tier in ("L", "LF") and not blind_seen(L, "proto"):
            reasons.append(f"tier {tier} needs the prototype's blind reply (qa/proto/blind/reply.txt)")
        # (8) the prototype's code at M, L and LF
        ph = review_head(text_of(os.path.join(work, "qa", "proto", "review.md")))
        if not proto:
            reasons.append(f"tier {tier} needs the prototype board (qa/proto)")
        elif not (ph[0] == "code" and code_ok(proto[3].get("codes"), "author", ph[1]) or ph[0] == "no-vision"
                  and a.no_vision):
            reasons.append("qa/proto/review.md does not start with the prototype board's code")
    # (8) the starred plan lines
    miss, has_tpl = starred(plan)
    if not has_tpl:
        notes.append("no templates/plan.md beside the scripts folder: checked only the Idea and Picture words lines")
    if miss:
        reasons.append("plan.md's starred lines are not filled: " + "; ".join(f"{k} ({why})" for k, why in miss))
    # (10) no demand removed since init (unless plan.md's Decisions logs it); no placeholder left in film/
    dem, have = st.get("demands") or {}, lmet.get("demands")
    want = {k: [str(x) for x in dem.get(k) or []] for k in ("names", "text")}
    dec = plan[plan.find("Decisions:"):] if "Decisions:" in plan else ""
    if any(want.values()) and not isinstance(have, dict):
        reasons.append(f"qa/{lname}'s timeline records no names or text lists: the demands cannot be checked")
    gone = [x for k in ("names", "text") for x in want[k] if isinstance(have, dict) and x not in (have.get(k) or [])]
    unlogged = [x for x in gone if x not in dec]
    if unlogged:
        reasons.append("a demand was removed since init: " + ", ".join(f'"{x}"' for x in unlogged)
                       + " (keep it, or log why under plan.md's Decisions)")
    ph_files = placeholders(work)
    if ph_files:
        reasons.append(f"{', '.join(ph_files)} still holds the starter's placeholder ([data-placeholder]): replace it "
                       "with the film")
    # notices: the frozen Idea and the signature's time
    frozen = next(((r[0], r[3]["idea"]) for r in rounds_of(work) if isinstance(r[3].get("idea"), dict)), None)
    if frozen and frozen[1].get("sha256") != idea_record(work)["sha256"]:
        top.append(f"Idea changed since {'the prototype' if frozen[0] == 'proto' else frozen[0]}: the ledger and the "
                   "recheck prompts keep the frozen line")
    sigs = [(r[0], r[3]["signature"]) for r in vr if isinstance(r[3].get("signature"), dict)]
    if len(sigs) > 1 and abs(sigs[0][1]["t"] - sigs[-1][1]["t"]) > 0.5 / max(1.0, fnum(lmet.get("fps"), 30.0)):
        top.append(f"signature moved after {sigs[0][0]}: {sigs[0][1]['t']:.3f}s -> {sigs[-1][1]['t']:.3f}s")
    # the round budget: S and R 1, M, L and LF 2, plus one more only while a High is open; then a draft
    budget = base + (1 if tier in ("M", "L", "LF") and highs else 0)
    draft = bool(highs) and len(vr) >= budget
    ready = not reasons
    lines = [f"NOT BLIND-REVIEWED: {a.no_blind}"] if a.no_blind is not None else []
    lines.append("READY" if ready else "NOT READY: " + (f"draft after {len(vr)} of {budget} rounds, the tier {tier} "
                                                        "budget; " if draft else "") + "; ".join(reasons))
    if a.no_vision:
        lines.append("NO VISION: the author saw no frames; fresh reviewers did the looking")
    lines += top
    pd, hd = lmet.get("pacing"), lmet.get("holds")
    lines.append(f"File: {fname}: " + (facts["summary"] if facts else "missing") + (
        f"; sha256 {lmet.get('video_sha256', '')[:12]}" if m else ""))
    lines.append(loud_line)
    if pd:
        lg, hk = pd.get("longest_run"), pd.get("hook") or {}
        lines.append(f"Pacing: frozen {pd['frozen_share'] * 100:.1f}%, alive {pd['alive_share'] * 100:.1f}%, rest "
                     f"{pd['rest_share'] * 100:.1f}%, declared holds {((hd or {}).get('share') or 0) * 100:.1f}%; "
                     f"poster {pd['poster_s']:.2f} of {pd['poster_allowance_s']:.2f} s; longest frozen run "
                     + (f"{lg['dur']:.2f} s at {lg['start']:.2f}-{lg['end']:.2f}s" if lg else "none")
                     + f"; frozen in the hook window (first {hk.get('window_s', 0):g} s) {hk.get('frozen_s', 0):.2f} s")
    else:
        lines.append("Pacing: the frozen share was skipped (an overlay whose alpha the probe confirms)")
    over = [x for x in (hd or {}).get("items", []) if x.get("over")]
    lines.append("Holds over their cap: " + ("; ".join(f"{x['start']:.2f}-{x['end']:.2f}s {x['kind']} {x['dur']:.2f} s, "
                                                        f"at most {x['cap']:.1f} s" for x in over) or "none"))
    lay = [f"{v['level']} {v['text']}" for v in lmet.get("verdicts", []) if v.get("check") in ("layout", "repetition")]
    lines.append("Layout: " + ("; ".join(lay) or "not measured"))
    sy = lmet.get("sync") or {}
    lines.append(f"Sync: {sy['k']} of {sy['n']} cues confirmed against a picture change" if sy.get("n") else
                 "Sync: no cues planned")
    rv = []
    for r in vr:
        fct = L["facts"].get(r[0]) or {}
        rv.append(f"{r[0]} " + (f"blind ({fct['route'] or 'no launch.log'}" + ("" if fct["route"] == "muse" else
                                                                                ", route unverified")
                                + (", partial" if fct["blind"] == "partial" else "") + ")" if blind_seen(L, r[0])
                                else "both routes failed" if r[0] in failed else "no blind reply")
                  + (f" + recheck x{len(fct['rechecks'])}" if fct.get("rechecks") else ""))
    if proto:
        rv.insert(0, "proto " + ("blind" if blind_seen(L, "proto") else "no blind reply"))
    lines.append(f"Reviewers: tier {tier}, {len(vr)} round(s) of a budget of {budget}"
                 + (" (LF: chapters are not tracked by vqa.py)" if tier == "LF" else "") + "; " + "; ".join(rv)
                 + (f"; --no-blind: {a.no_blind}" if a.no_blind is not None else "")
                 + "; muse session logs not checked")
    meds = [f for f in L["findings"] if f["status"] == "open" and f["sev"] == "M"]
    lines.append("Open Mediums: " + ("; ".join(f"{f['id']} ({f['tag']}, {span_text(f['span'])}): {f['text']}"
                                               for f in meds) or "none"))
    sty = lmet.get("styles") or {}
    lines.append(f"Styles: effects {sty.get('effects', 0) * 100:.1f}% of the film, steps {sty.get('steps', 0) * 100:.1f}%"
                 "; texture text not measured by vqa.py (render.mjs lint marks it)")
    lines.append(f"Demands: names {json.dumps(want['names'], ensure_ascii=False)}, lines "
                 f"{json.dumps(want['text'], ensure_ascii=False)}"
                 + (f"; removed with a logged reason: {', '.join(x for x in gone if x in dec)}" if set(gone) - set(unlogged)
                    else ""))
    lines.append(NOT_VERIFIED)
    return ready, lines, notes


def cmd_gate(a):
    ready, lines, notes = gate_block(os.path.abspath(a.work), a)
    for n_ in notes:
        print(f"note: {n_}", file=sys.stderr)
    print("\n".join(lines))
    return 0 if ready else 1


def cmd_board(a):
    """S13: one board without the full pack (the prototype: --out qa/proto): board.png with its author code and
    metrics.json; at tier L and LF also its reviewer copy with bursts/ and phone/, the blind prompt and the line. A
    round qa/vN of a work folder is refused: the gate reads a round as the delivered pack (sound, sync, S15's checks)."""
    out = a.out
    work, name = work_of(out)
    if work and name != "proto":  # a round is a pack: it measures sound and sync, and S15 says when it may start
        rnd = os.path.relpath(os.path.join(work, "qa", name))
        raise Refused(f"{os.path.relpath(out)} is review round {name}: make it with "
                      f"{vqa_cmd('pack', a.video, '--out', rnd)}; board makes only the prototype board "
                      "(--out qa/proto) or a board outside a work folder's qa/ (S13, S15, S19)")
    m = Media(a.video)
    if not m.v:
        raise ToolError(f"{a.video}: no video stream")
    tl = load_timeline(a.timeline)
    tier = a.tier or (tier_of(work)[0] if work else None)
    os.makedirs(out, exist_ok=True)
    md = motion_data(m, **plan_spans(tl))
    alpha = a.kind == "alpha" and alpha_confirmed(m)
    pv, pdata = pacing_checks(m, tl, md, None, None, alpha, None)
    lv_, ldata = layout_data(m, tl, alpha)
    V = list(pv) + [(lv, "layout", t) for lv, t in lv_]
    loud = ebur128(m.path, momentary=True) if m.a else None
    b = board_info(m, tl, md, pdata, ldata, None, loud, name, V)
    codes, blind = new_codes(), bool(work) and tier in ("L", "LF")
    fs = board_frames(m, b)
    canvas, labels = draw_board(m, b, fs, codes[0])
    canvas.save(os.path.join(out, "board.png"))
    prompts, folders = {}, []
    if blind:
        d = os.path.join(out, "blind")
        os.makedirs(os.path.join(d, "bursts"), exist_ok=True)
        draw_board(m, b, fs, codes[1], reviewer=True)[0].save(os.path.join(d, "board.png"))
        clean_outputs(os.path.join(d, "bursts"))
        for t, title in ((b["burst"]["t"], b["burst"]["kind"]), (b["ending"][1][0], "ending")):
            make_burst(m, t, os.path.join(d, "bursts", f"{t:07.3f}-{slug(title)}.png"), title)
        clean_outputs(os.path.join(d, "phone"))
        make_phone(m, [b["phone"]["t"]], os.path.join(d, "phone"))
        prompts["blind"] = write_prompt(d, blind_prompt(text_of(os.path.join(work, "brief.txt")) or "",
                                                        *card_lines(pdata["style"]),
                                                        sound_text(m, loud, None, len(tl["cues"]) if tl else 0)))
        folders.append(("blind", d))
    sig = signature_of(tl)
    metrics = {"video": m.path, "video_sha256": sha256_file(m.path), "round": name, "tier": tier, "kind": a.kind,
               "duration": m.duration, "width": m.w, "height": m.h, "fps": m.fps, "timeline": tl["path"] if tl else None,
               "codes": code_record(**({"author": codes[0], "reviewer": codes[1]} if blind else {"author": codes[0]})),
               "idea": idea_record(work) if work else None, "prompts": prompts, "decl_sha256": decl_sha(tl),
               "signature": {"t": round(sig[0], 3), "kind": sig[1], "source": sig[2]} if sig else None,
               "signature_scene": signature_scene(tl, sig[0], m.duration) if sig else None,
               "settings": {k: pdata[k] for k in ("register", "format", "style", "card")},
               "verdicts": [{"level": lv, "check": chk, "text": text} for lv, chk, text in V],
               "board": {"file": "board.png", "burst": b["burst"], "ending": b["ending"], "phone": b["phone"],
                         "contact": [round(x["t"], 3) for x in b["contact"]], "labels": labels}}
    with open(os.path.join(out, "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=1)
    rel = os.path.relpath(out)
    print(f"{rel}/board.png: open it; then write {rel}/review.md starting with "
          + ("NO VISION" if a.no_vision else "the code in its yellow box") + ", then what is weak in the move (S15)")
    for line in review_instructions(work, folders, prompts) if folders else []:
        print(line)
    return 0


# ---------------------------------------------------------------- pack
LEVELS = ("FAIL", "WARN", "PASS", "N/A")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:28] or "frame"


def clean_outputs(d):
    """Remove images a previous pack wrote into d (only our own name patterns), so stale frames never mislead."""
    if not os.path.isdir(d):
        return
    for f in os.listdir(d):
        if re.match(r"^(\d{3}\.\d{3}(-[a-z0-9-]+)?|page-\d+|more_\d{3}\.\d{3})\.png$", f):
            os.remove(os.path.join(d, f))


def make_sbs_sheet(m, mr, out, pairs=6, height=200):
    """Yours (left) and the reference (right) at the same height, at matching fractions of each duration."""
    fr_ = [(k + 0.5) / pairs for k in range(pairs)]
    mine = grab_many(m, [f * m.duration for f in fr_], even(height * m.dw / max(1, m.h)))
    ref = grab_many(mr, [f * mr.duration for f in fr_], even(height * mr.dw / max(1, mr.h)))
    wa, wb = mine[0][0], ref[0][0]
    M, G, GP, LBL, TOP = 8, 6, 22, 24, 30
    pair_w = wa + G + wb
    per_row = 2 if 2 * pair_w + GP + 2 * M <= 1600 else 1
    rows = math.ceil(pairs / per_row)
    W = 2 * M + per_row * pair_w + (per_row - 1) * GP
    c = Canvas(W, TOP + rows * (height + LBL + G) + M)
    c.text(M, 8, fit_text(f"SAME SCALE: YOURS (LEFT) | REFERENCE (RIGHT) {os.path.basename(mr.path)}", W - 2 * M), INK)
    for k in range(pairs):
        x = M + (k % per_row) * (pair_w + GP)
        y = TOP + (k // per_row) * (height + LBL + G)
        for (w, h, (pts, rgb)), xx, col in ((mine[k], x, INK), (ref[k], x + wa + G, GREY)):
            c.blit(xx, y, w, h, rgb)
            c.outline(xx - 1, y - 1, xx + w + 1, y + h + 1, GREY)
            c.text(xx + 2, y + h + 5, fit_text(f"{(pts or 0):.2f}s", w - 4), col)
    c.save(out)
    return out


def ref_profile(mr, md):
    spikes = [e for e in md["events"] if e["kind"] == "spike"]
    return {"file": mr.path, "duration": round(mr.duration, 3), "near_static_share": md["near_static_share"],
            "share_at": md["share_at"], "static_runs": len(md["static_runs"]),
            "static_seconds": round(sum(r["dur"] for r in md["static_runs"]), 2),
            "spikes_per_min": round(len(spikes) / max(mr.duration, 1e-3) * 60, 1),
            "mean_motion": round(statistics.mean(md["_d30"]), 3) if md["_d30"] else 0.0}


def write_summary(path, m, a, tl, V, looks, nums, notices=()):
    n = {lv: sum(1 for v in V if v[0] == lv) for lv in LEVELS}
    L = [f"# QA pack: {os.path.basename(m.path)} - {n['FAIL']} FAIL, {n['WARN']} WARN, {n['PASS']} PASS"]
    L += [f"**{x}**" for x in notices] + [
         f"{m.duration:.2f} s | {m.w}x{m.h} | {m.fps:.3g} fps | timeline: {os.path.basename(tl['path']) if tl else 'none'} | "
         f"kind: {a.kind} | spec: {a.spec} | audio: {nums.get('audio_src') or 'none'}", "", "## Verdicts"]
    for lv in LEVELS:
        L += [f"- {lv} {chk}: {text}" for lv2, chk, text in V if lv2 == lv]
    L += ["", "## Look at, in order"]
    k = 0
    for p, why in looks:  # p None: a line about the images above (what a capped set left out)
        k += p is not None
        L.append(f"   - {why}" if p is None else f"{k}. `{p}`: {why}")
    L += ["", "## Numbers"] + nums["lines"]
    notes = [f"- {chk}: {text}" for lv, chk, text in V if lv == "NOTE"]
    if notes:
        L += ["", "## Notes"] + notes
    L += ["", "Numbers point at problems; frames and ears decide. You cannot hear: report measured loudness and sync, "
          "never 'sounds good' (S6)."]
    with open(path, "w") as fh:
        fh.write("\n".join(L) + "\n")


def sync_text(r, fr):
    if r["kind"] == "cue":
        if r["meas_t"] is None:
            return f"cue {r['id']} at {r['plan_t']:.2f}s: {r['note']}"
        if r["ref"] != "picture":
            ref = "its planned time"
        elif r.get("pic_seen") is False:  # the plan stands in for a change the picture does not show
            ref = f"its planned {r['pic'].split(' (')[0]} at {r['pic_t']:.3f}s, which the picture does not show"
        else:
            ref = f"the picture event at {r['pic_t']:.3f}s ({r['pic']})"
        return (f"cue {r['id']} at {r['plan_t']:.2f}s: sound {r['meas_t']:.3f}s ({r['how']}) is {r['off'] * 1000:+.0f} ms "
                f"({r['off'] / fr:+.1f} f) from {ref}: {r['note']}")
    return f"picture {r['pic']} at {r['pic_t']:.3f}s: sound at {r['meas_t']:.3f}s, {r['off'] * 1000:+.0f} ms ({r['off'] / fr:+.1f} f): {r['note']}"


def sync_table(rows, fr):
    T = ["| what | plan | sound | vs plan | picture | offset | verdict |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        if r["kind"] == "cue":
            meas = "-" if r["meas_t"] is None else f"{r['meas_t']:.3f} ({r['how']})"
            vsp = "-" if r["meas_t"] is None else f"{r['off_plan'] * 1000:+.1f} ms"
            pic = (f"{r['pic_t']:.3f} {r['pic']}" if r.get("pic_t") is not None
                   else ("unplanned spike " + ", ".join(f"{x:.3f}" for x in r["spikes"])) if r.get("spikes")
                   else "; ".join(f"({t:.3f} pairs with {', '.join(ids)})" for t, ids in r["events_of_others"])
                   if r.get("events_of_others") else "-")
            # an offset only against a change the picture shows: a plan the picture does not confirm is no reference
            off = "-" if not r.get("confirmed") else f"{r['off'] * 1000:+.1f} ms ({r['off'] / fr:+.1f} f)"
            T.append(f"| cue {r['id']} ({r['sound']}) | {r['plan_t']:.3f} | {meas} | {vsp} | {pic} | {off} | {verdict(r)} |")
        else:
            meas = "-" if r["meas_t"] is None else f"{r['meas_t']:.3f}"
            off = "-" if not r.get("confirmed") else f"{r['off'] * 1000:+.1f} ms ({r['off'] / fr:+.1f} f)"
            T.append(f"| picture event | - | {meas} | - | {r['pic_t']:.3f} {r['pic']} | {off} | {verdict(r)} |")
    return T


def cmd_pack(a):
    out = a.out
    work, name = work_of(out)  # a round qa/vN of a work folder: looking is enforced first (S15)
    no_vision = getattr(a, "no_vision", False)
    tier = preflight(work, name, no_vision) if work and name != "proto" else None
    if getattr(a, "preflight", False):
        print(f"preflight: {os.path.relpath(out)} may be packed" + (f" (tier {tier})" if tier else "") if work else
              f"preflight: {out} is not qa/vN in a work folder: nothing to check")
        return 0
    if not a.video:
        raise ToolError("pack needs VIDEO (only --preflight runs without one)")
    m = Media(a.video)
    if not m.v:
        raise ToolError(f"{a.video}: no video stream")
    tl = load_timeline(a.timeline)
    kit_note = apply_kit(tl, a.kit)
    for sub in ("", "bursts", "phone"):
        os.makedirs(os.path.join(out, sub), exist_ok=True)
        if sub:
            clean_outputs(os.path.join(out, sub))
            clean_outputs(os.path.join(out, sub, "more"))
    V, N, fr = [], [], m.frame_dur()
    add = lambda lv, chk, text: V.append((lv, chk, text))
    facts, issues = probe_data(m, a.kind)
    for lv, text in issues:
        add(lv, "delivery", text)
    quiet = a.kind in QUIET_KINDS
    if tl is None:
        add("WARN", "timeline", "no --timeline: still runs, planned events and cues are not checked against the plan")
    else:
        if tl["duration"] and abs(tl["duration"] - m.duration) > 1.5 * fr:
            add("WARN", "timeline", f"timeline lasts {tl['duration']:.3f}s, the video {m.duration:.3f}s: is it this render's timeline?")
        if tl["width"] and tl["height"] and (tl["width"], tl["height"]) != (m.w, m.h):
            if abs(tl["width"] / tl["height"] - m.dw / max(1, m.h)) < 0.01:  # a scaled copy: the plan's times still hold
                add("NOTE", "timeline", f"timeline size {tl['width']}x{tl['height']}, video {m.w}x{m.h}: a scaled copy "
                    "of the same aspect, checked against the same plan")
            else:
                add("WARN", "timeline", f"timeline size {tl['width']}x{tl['height']} differs from the video {m.w}x{m.h} "
                    "in aspect: pack each re-composed variant with its own render's timeline (references/delivery.md)")
        if tl["fps"] and abs(tl["fps"] - m.fps) > 0.01:
            add("NOTE", "timeline", f"timeline fps {tl['fps']:g} vs video {m.fps:.3f}")
        if tl.get("range"):
            add("NOTE", "timeline", f"range render {json.dumps(tl['range'])}: times are relative to the clip")
    # pacing: the frozen share on the measured picture (S9), each hold against its need (S10), alive holds (S16)
    md = motion_data(m, **plan_spans(tl))
    alpha = bool(facts.get("alpha")) and any(x["see_through"] > 0 for x in facts["alpha"])
    pv, pdata = pacing_checks(m, tl, md, getattr(a, "register", None), getattr(a, "format", None), alpha,
                              a.max_hold_share)
    V += pv
    pd, hd = pdata["pacing"], pdata["holds"]
    runs = [dict(r) for r in pd["runs"]] if pd else []
    for r in runs:
        r["planned"] = None
    if tl and runs:
        classify_runs(runs, tl["holds"])
    lv_layout, ldata = layout_data(m, tl, alpha)  # S12; the board draws its boxes and WARN outlines from it
    V += [(lv, "layout", text) for lv, text in lv_layout]
    V += [(lv, "repetition", text) for lv, text in repetition_checks(m, tl, alpha)]  # S18
    growth = holds_growth(out, hd["held"]) if hd else None
    if growth and hd["held"] - growth[1] > registers()["holds"]["growth_warn_s"] + 1e-9:
        add("WARN", "holds", f"holds grew {growth[1]:.1f} -> {hd['held']:.1f} s since {growth[0]}: fix the film, not the "
            "holds (S10)")
    jh = md["judder_holes"]
    bt, bdrop = burst_times(m, tl, md)
    if jh["count"]:
        add("WARN", "motion", f"{jh['count']} zero-change frames inside moving edges at "
            f"{', '.join(f'{x:.3f}' for x in jh['times'])}: judder; its bursts show which: a repeated, dropped, or "
            "lower-rate frame or whole-pixel snapping is a render defect (T1); a step the plan scheduled (typing, a "
            "counter, stepped animation) or a planned flicker clears by declaring its span in the timeline's steps "
            "(with its every) or effects (Q5)")
    if tl and (tl["steps"] or tl["effects"]):
        add("NOTE", "motion", declared_text(md, tl, m.duration))
    fl = md["flashes"]
    if fl["max_in_1s"] > 2 * FLASH_MAX:
        add("FAIL", "motion", flash_text(fl))
    if md["black_frames"]:
        add("WARN", "motion", "isolated near-black frame(s) at " + ", ".join(f"{x:.3f}s" for x in md["black_frames"])
            + ": a seam or a missing frame")
    V += declaration_checks(tl)
    if md["first_frame_luma"] is not None and md["first_frame_luma"] < 16:
        add("NOTE", "motion", f"first frame is near black (luma {md['first_frame_luma']}): players without a poster show it")
    if md["last_frame_luma"] is not None and md["last_frame_luma"] < 16:
        add("NOTE", "motion", f"last frame is near black (luma {md['last_frame_luma']}): the last frame should be a poster (C0)")
    # planned events vs what the picture shows
    pm, extra = match_planned(tl["events"] if tl else [], md, tl["steps"] if tl else (), m.fps)
    for e in pm:
        if not e["detected"]:
            add("WARN" if e["kind"] == "cut" else "NOTE", "events", f"planned {e['kind']} at {e['t']:.3f}s ('{e['label']}') shows "
                f"{KIND_LOOK.get(e['kind'], 'no single-frame change')} within +/-0.1 s: fine for a continuous move, "
                "otherwise check its burst")
    seen = [e for e in pm if e["detected"]]
    if pm and len(seen) == len(pm):
        add("PASS", "events", f"{len(seen)}/{len(pm)} planned events seen in the picture (worst "
            f"{max(abs(e['detected']['t'] - e['t']) for e in seen) * 1000:.0f} ms from plan)")
    extra = [e for e in extra if not e.get("effect")]  # a declared effect's variation is planned
    if extra and tl:
        burst_at = [t for t, _ in bt]
        add("NOTE", "events", "visual events the timeline does not list (cut, pop, flash, or a sharp speed peak; see its "
            "burst): " + ", ".join(f"{e['t']:.3f}s {e['kind']}" + ("" if any(abs(e["t"] - x) < 0.2 for x in burst_at)
                                                                  else " (no burst)") for e in extra[:10]))
    # audio: presence, sync, loudness
    ncues = len(tl["cues"]) if tl else 0
    music, extra = bool(tl and tl["music"]), on_mix_extra(tl)
    spans = layer_spans(tl, a.kit, m.duration)
    src = a.sfx_stem or (m.path if m.a else None)
    af = a.af
    hints = bool(src) and not a.sfx_stem and bool(extra) and not ncues  # nothing cued: no stem, nothing to sync-check
    capped = bool(src) and not a.sfx_stem and bool(extra) and not hints  # on the mix under music or layers: capped
    if (capped or hints) and music and not af:  # tames kick drums and beds; layers keep the full band (typing is all highs)
        af = "highpass=f=800"
    loud = ebur128(m.path, momentary=True) if m.a else None  # momentary values: the board's strip (S13)
    silent = loud is not None and loud["TP"] <= -90.0
    audio_note = None
    if not m.a:
        if (ncues or music) and quiet:
            add("N/A", "audio", f"a {a.kind} master carries no sound: its {ncues} cue(s), sync and loudness are gated on "
                "the master's pack (references/delivery.md)")
            audio_note = f"NO AUDIO: {a.kind.upper()} MASTER, SOUND GATED ON THE MASTER"
        elif ncues or music:
            if a.picture_only:
                add("NOTE", "audio", f"picture-only round: {ncues} planned cue(s) not checked against sound")
                audio_note = f"NO AUDIO: PICTURE-ONLY ROUND, {ncues} CUES UNCHECKED"
            else:
                add("FAIL", "audio", f"the timeline plans {ncues} cue(s) but the video has no audio stream: mux the mix "
                    "(mix.py ... --video V --mux OUT), or pass --picture-only for a picture-only round")
                audio_note = f"!NO AUDIO STREAM BUT {ncues} CUES PLANNED"
        else:
            add("N/A", "audio", "no audio stream and no planned cues: sync and loudness do not apply")
            audio_note = "NO AUDIO STREAM"
    elif silent:
        add("FAIL" if ncues else "N/A", "audio", "the audio track is digital silence"
            + (f" but {ncues} cue(s) are planned" if ncues else " and no cues are planned"))
        audio_note = ("!" if ncues else "") + "SILENT AUDIO TRACK"
    A = decode_audio(src, af=af) if src and not (silent and not a.sfx_stem) else None
    onsets = onset_data(A) if A else []
    env = envelope(A) if A else None
    on_mix = bool(src) and not a.sfx_stem
    rows, rest, hint = sync_rows(A, onsets, m.fps, tl, md, layers=layer_windows(spans) if on_mix else [],
                                 on_stem=bool(a.sfx_stem)) if A \
        else ([], [], None)
    if A and capped:
        cap_on_mix(rows, af, extra)
        add("NOTE", "sync", f"{extra} {'is' if extra == 'music' else 'are'} planned and no --sfx-stem was given: onsets "
            "measured on the mix" + (f" after {af}, which moves slow sounds' peaks" if af else "") + "; sync verdicts are "
            "capped at WARN (measure with --sfx-stem for a verdict)")
    if A and hints:
        add("NOTE", "sync", hint_rows(rows, extra))
    if A and kit_note:
        add("NOTE", "sync", kit_note)
    if spans:
        add("NOTE", "sync", layers_note(spans, on_mix))
    judged = [r for r in rows if r["level"] in ("ok", "WARN", "FAIL")]
    for r in judged:
        if r["level"] != "ok":
            add(r["level"], "sync", sync_text(r, fr))
    unmeasured = [r for r in rows if r["kind"] == "cue" and r["level"] == "NOTE"]
    for r in unmeasured:
        add("NOTE", "sync", sync_text(r, fr))
    rep = sync_report(rows, ncues, " on the mix" if capped else "")
    if rep:  # PASS only on sounds confirmed against the picture; else a NOTE that counts them
        add(rep[0], "sync", rep[1] + (f"; {len(unmeasured)} more not isolated (see Notes)"
                                      if unmeasured and rep[0] == "PASS" else ""))
    if hint:
        add("NOTE", "sync", hint)
    for lv, text in peak_cue_checks(tl):
        add(lv, "sync", text)
    cue_t = sorted(c["t"] for c in tl["cues"]) if tl else []
    close_c = close_cues(cue_t)
    if close_c:
        add("WARN", "sync", "cues closer than 100 ms fuse into a buzz (S3): " + ", ".join(f"{x:.3f}->{y:.3f}" for x, y in close_c[:6]))
    close = [(x["t"], y["t"]) for x, y in zip(onsets, onsets[1:]) if y["t"] - x["t"] < REPEAT_MIN]
    if close and not cue_t:
        add("NOTE", "sync", "onsets closer than 100 ms (repeats fuse into a buzz, S3; or one sound with two attacks): "
            + ", ".join(f"{x:.3f}->{y:.3f}" for x, y in close[:6]))
    if rest:
        add("NOTE", "sync", "sounds with no cue or picture event: " + ", ".join(f"{o['t']:.3f}s" for o in rest[:12]))
    if loud and not silent:  # by the film's register unless --spec names a destination (S17)
        for lv, text in loudness_verdicts(loud, a.spec, register=pdata["register"]):
            add(lv, "loudness", text)
    # images
    looks = []
    cells = min(30, max(12, math.ceil(m.duration / 2.5)))
    make_sheet(m, os.path.join(out, "sheet.png"), cells, tl)
    looks.append(("sheet.png", f"{cells} frames at equal steps, time under each: write the stranger's sentence first (Q2)"))
    if m.duration / cells > 2.5:
        add("NOTE", "images", f"sheet: {cells} cells (the cap) at {m.duration / cells:.1f} s steps; past ~2 min also pack "
            "each chapter (references/delivery.md)")
    fd = pdata["frozen"]
    draw_timeline(os.path.join(out, "timeline.png"), m, md, env, onsets, tl, runs, rows, audio_note,
                  ("TIMELINE " + os.path.basename(tl["path"])) if tl else "NO TIMELINE",
                  curve=(fd["t"], fd["energy"], fd["rate"]) if fd else None, thr=FROZEN_E if fd else THR_STILL)
    looks.append(("timeline.png", "motion energy of the measured picture (frozen and repeating runs shaded, holds "
                  "outlined) | visual events | audio and onsets | plan and cue offsets"))
    from concurrent.futures import ThreadPoolExecutor
    kinds = [kind_title(title) for _, title in bt]  # images carry times and kinds, never plan wording (S13)
    names = [f"bursts/{t:07.3f}-{slug(k.split(' + ')[0])}.png" for (t, _), k in zip(bt, kinds)]
    with ThreadPoolExecutor(max_workers=min(6, os.cpu_count() or 4)) as ex:
        list(ex.map(lambda i: make_burst(m, bt[i][0], os.path.join(out, names[i]), kinds[i]), range(len(bt))))
    looks += [(nm, title) for nm, (t, title) in zip(names, bt)]
    if bdrop:
        add("NOTE", "images", left_out("bursts", len(bt), bdrop, vqa_cmd("bursts", a.video, os.path.join(out, "bursts", "more"))))
        looks.append((None, f"{len(bdrop)} more moments have no burst (the cap is {BURSTS} plus the ending and signature "
                      "moments): Notes list them with the command that bursts them"))
    ptimes, pdrop = phone_times(m, tl, md)
    pages, shown = make_phone(m, ptimes, os.path.join(out, "phone"))
    looks.append((", ".join("phone/" + os.path.basename(p) for p in pages),
                  f"{len(shown)} frames at 480 px wide (single frames beside them): every read line must still read (C1)"))
    if pdrop:
        add("NOTE", "images", left_out("phone frames", len(shown), [(t, "") for t in pdrop],
                                       vqa_cmd("phone", a.video, os.path.join(out, "phone", "more"))))
        looks.append((None, f"{len(pdrop)} more phone moments not shown: Notes list them with the command that makes them"))
    # the board (S13): the author copy here; in a work folder the reviewer copy, its prompts and their lines (S14)
    b = board_info(m, tl, md, pdata, ldata, rows, loud, name, V)
    codes, fs = new_codes(), board_frames(m, b)
    canvas, labels = draw_board(m, b, fs, codes[0])
    canvas.save(os.path.join(out, "board.png"))
    looks.insert(0, ("board.png", "Open this first; open other images only when a verdict line names them"))
    sig, cur_sig, notices, prompts, folders, idea = signature_of(tl), None, [], {}, [], None
    if sig:
        cur_sig = {"t": round(sig[0], 3), "kind": sig[1], "source": sig[2]}
    if work:
        n = round_no(name)
        earlier = [r for r in rounds_of(work) if r[1] < n]
        idea = idea_record(work)
        frozen = next(((r[0], r[3]["idea"]) for r in earlier if isinstance(r[3].get("idea"), dict)), None)
        if frozen and frozen[1].get("sha256") != idea["sha256"]:
            notices.append(f"Idea changed since {'the prototype' if frozen[0] == 'proto' else frozen[0]}: plan.md's Idea "
                           f"or Picture words line differs from the one frozen at qa/{frozen[0]}; the ledger and the "
                           "recheck prompts keep the frozen line; log why under plan.md's Decisions (S15)")
        first = next(((r[0], r[3]["signature"]) for r in earlier if r[1] >= 1 and isinstance(r[3].get("signature"), dict)),
                     None)
        if first and cur_sig and abs(first[1]["t"] - cur_sig["t"]) > fr / 2:
            notices.append(f"signature moved after {first[0]}: {first[1]['t']:.3f}s -> {cur_sig['t']:.3f}s; the ledger "
                           f"keeps {first[0]}'s time for SHOW (S15)")
        brief = text_of(os.path.join(work, "brief.txt")) or ""
        bd = os.path.join(out, "blind")
        os.makedirs(bd, exist_ok=True)
        rcanvas = draw_board(m, b, fs, codes[1], reviewer=True)[0]
        rcanvas.save(os.path.join(bd, "board.png"))
        for sub in ("bursts", "phone"):
            copy_pngs(os.path.join(out, sub), os.path.join(bd, sub))
        prompts["blind"] = write_prompt(bd, blind_prompt(brief, *card_lines(pdata["style"]),
                                                         sound_text(m, loud, rows, ncues)))
        folders.append(("blind", bd))
        L = build_ledger(work, upto=n - 1, pins=ledger_pins(work)) if n >= 1 else None
        items = sorted((f for f in (L or {}).get("findings", []) if f["status"] == "open"),
                       key=lambda f: -SEVERITY[f["sev"]])
        fz = (frozen[1] if frozen else idea).get("idea")
        if any(f["sev"] in "HM" for f in items):  # from round 2, while a High or Medium is open (S14)
            for i in range(0, len(items), RECHECK_PER_PROMPT):
                pname = "recheck" if not i else f"recheck-{i // RECHECK_PER_PROMPT + 1}"
                d = os.path.join(out, pname)
                os.makedirs(d, exist_ok=True)
                rcanvas.save(os.path.join(d, "board.png"))
                chunk = items[i:i + RECHECK_PER_PROMPT]
                prompts[pname] = write_prompt(d, recheck_prompt(brief, fz, chunk), [f["id"] for f in chunk])
                folders.append((pname, d))
        for x in os.listdir(out):  # an earlier pack's recheck folders this round no longer asks
            if re.fullmatch(r"recheck(-\d+)?", x) and x not in prompts:
                for f in ("prompt.txt", "board.png"):
                    if os.path.isfile(os.path.join(out, x, f)):
                        os.remove(os.path.join(out, x, f))
    prof = None
    if a.reference:
        mr = Media(a.reference)
        mdr = motion_data(mr)
        rA = decode_audio(mr.path) if mr.a else None
        rons = onset_data(rA) if rA else []
        for r in mdr["static_runs"]:
            r["planned"] = None
        draw_timeline(os.path.join(out, "reference-timeline.png"), mr, mdr, envelope(rA) if rA else None, rons, None,
                      mdr["static_runs"], None, None if rA else "NO AUDIO STREAM", "REFERENCE")
        make_sbs_sheet(m, mr, os.path.join(out, "sbs.png"))
        looks += [("sbs.png", "same scale, matching fractions of each film: is any beat of yours smaller or emptier? (Q6)"),
                  ("reference-timeline.png", "the reference's motion and sound rhythm, same lanes")]
        prof = ref_profile(mr, mdr)
        mine = ref_profile(m, md)
        share_all = sum(x < THR_STILL for x in md["_s"]) / max(1, len(md["_s"]))
        N.append(f"- Reference {os.path.basename(mr.path)}: near-static {prof['near_static_share'] * 100:.0f}% (yours "
                 f"{share_all * 100:.0f}% with holds), at 0.3: {prof['share_at']['0.3'] * 100:.0f}%; spikes/min "
                 f"{prof['spikes_per_min']} (yours {mine['spikes_per_min']}); still runs {prof['static_runs']} totalling "
                 f"{prof['static_seconds']}s; mean motion {prof['mean_motion']} (yours {mine['mean_motion']})")
    # numbers
    fmt_run = lambda r: (run_span(r) + (" repeating" if r["idle"] > 0.5 else "") + (
        " alive" if r["alive"] else " rest" if r["rest"] else "") + (" final" if r["final"] else "")
        + (" declared" + (f" ({r['hold']})" if r.get("hold") else "") if r["planned"]
           else " UNDECLARED" if r["planned"] is False else ""))
    N.insert(0, "- Still runs >= 0.5 s (frozen or repeating): " + ("; ".join(fmt_run(r) for r in runs
                                                                         if r["dur"] >= MIN_RUN - 1e-9) or "none"))
    N.insert(1, f"- Pacing (S9): {pd['line'] if pd else 'frozen share skipped (overlay)'}"
             + (f"; declared holds {hd['share'] * 100:.1f}% ({hd['held']:.2f} of {hd['duration']:.2f} s)" if hd else ""))
    if hd:
        N.insert(2, "- Holds (S10, need and maximum): " + holds_line(hd))
    N.insert(3 if hd else 2, "- Visual events: " + (", ".join(f"{e['t']:.3f}s {e['kind']} ({e['mag']})" + (f" [effect {e['effect']}]"
             if e.get("effect") else "") for e in md["events"][:40]) or "none")
             + (f" and {len(md['events']) - 40} more" if len(md["events"]) > 40 else "")
             + (f"; judder frames {jh['count']}" if jh["count"] else "")
             + f"; flashes: at most {fl['max_in_1s']} luminance swings in one second (limit {2 * FLASH_MAX})")
    if rows:
        N.append(f"- Sync ({rep[2] if rep else 'nothing judged'}; offset = sound - picture, + = late; "
                 f"1 frame = {fr * 1000:.1f} ms; audio: {os.path.basename(src)}" + (f", -af {af}" if af else "") + "):")
        N += [""] + sync_table(rows, fr) + [""]
    if loud:
        N.append(f"- Loudness: {loud['I']:.1f} LUFS integrated, LRA {loud['LRA']:.1f} LU, true peak {loud['TP']:.1f} dBTP")
    N.append(f"- Probe: {facts['summary']}")
    write_summary(os.path.join(out, "summary.md"), m, a, tl, V, looks,
                  {"lines": N, "audio_src": (os.path.basename(src) + (" (SFX stem)" if a.sfx_stem else "")) if src else None},
                  notices)
    counts = {lv: sum(1 for v in V if v[0] == lv) for lv in LEVELS + ("NOTE",)}
    sync_k = sum(1 for r in rows if r["kind"] == "cue" and r["level"] == "ok" and r.get("confirmed"))
    preg = plan_register(text_of(os.path.join(work, "plan.md")) or "") if work else (None, None, None)
    metrics = {"video": m.path, "duration": m.duration, "width": m.w, "height": m.h, "fps": m.fps, "kind": a.kind, "spec": a.spec,
               "timeline": tl["path"] if tl else None, "counts": counts,
               # the round's review record (S13-S15): codes only as salted hashes, never in a text file
               "round": name if work else None, "tier": tier, "video_sha256": sha256_file(m.path),
               "codes": code_record(**({"author": codes[0], "reviewer": codes[1]} if work else {"author": codes[0]})),
               "prompts": prompts, "idea": idea, "plan_register": {"value": preg[0], "word": preg[1]} if work else None,
               "signature": cur_sig, "signature_scene": signature_scene(tl, sig[0], m.duration) if sig else None,
               "decl_sha256": decl_sha(tl), "sync": {"k": sync_k, "n": ncues, "text": rep[2] if rep else None},
               "styles": {k: round(union_s(tl[k], m.duration) / max(m.duration, 1e-6), 4) if tl else 0.0
                          for k in ("effects", "steps")},
               "demands": tl["demands"] if tl and tl["demands"] else None, "notices": notices,
               "board": {"file": "board.png", "burst": b["burst"], "ending": b["ending"], "phone": b["phone"],
                         "contact": [round(x["t"], 3) for x in b["contact"]], "labels": labels},
               "verdicts": [{"level": lv, "check": chk, "text": text} for lv, chk, text in V],
               "probe": {k: v for k, v in facts.items() if k != "lines"}, "motion": public(md),
               "planned_events": [dict(e, detected=e["detected"]) for e in pm],
               "audio": {"source": src, "filter": af, "onsets": onsets, "sync": rows, "unmatched_onsets": rest,
                         "loudness": {k: v for k, v in loud.items() if k != "M"} if loud else None,
                         "layers": [{"id": s["id"], "sound": s["sound"], "on": s["on"], "end": s["end"], "length_known": s["known"],
                                    "hits": None if s["hits"] is None else len(s["hits"])} for s in spans]},
               "settings": {k: pdata[k] for k in ("register", "format", "style", "card")}, "layout": ldata,
               "pacing": public(pd) if pd else None,
               "holds": {"declared_s": hd["held"], "share": hd["share"], "allowance_s": hd["allowance"],
                         "items": hd["holds"], "grew_from": list(growth) if growth else None} if hd else None,
               "images": [p for p, _ in looks if p], "reference": prof,
               "left_out": {"bursts": [{"t": round(t, 3), "why": title} for t, title in bdrop],
                            "phone": [round(t, 3) for t in pdrop]}}
    with open(os.path.join(out, "metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=1)
    for x in notices:
        print(x)
    print(f"{out}/summary.md: {counts['FAIL']} FAIL, {counts['WARN']} WARN, {counts['PASS']} PASS")
    for lv in ("FAIL", "WARN"):
        for lv2, chk, text in V:
            if lv2 == lv:
                print(f"{lv} {chk}: {text}")
    if work:
        rel = os.path.relpath(out)
        print(f"Open {rel}/board.png first, then write {rel}/review.md: "
              + ("NO VISION" if no_vision else "the code in its yellow box") + " first, then one line per open finding "
              f"(the next pack refuses until it does, S15)")
        for line in review_instructions(work, folders, prompts):
            print(line)
    return 1 if counts["FAIL"] else 0


def cmd_timeline(a):
    m = Media(a.file)
    tl = load_timeline(a.timeline)
    holds = tl["holds"] if tl else []
    md = motion_data(m, **plan_spans(tl))
    runs = md["static_runs"]
    if tl:
        classify_runs(runs, holds)
    else:
        for r in runs:
            r["planned"] = None
    src = a.sfx_stem or (a.file if m.a else None)
    A = decode_audio(src, af=a.af) if src else None
    onsets = onset_data(A) if A else []
    rows = sync_rows(A, onsets, m.fps, tl, md)[0] if A else []
    ncues = len(tl["cues"]) if tl else 0
    note = None if A else (f"!NO AUDIO STREAM BUT {ncues} CUES PLANNED" if ncues else "NO AUDIO STREAM")
    draw_timeline(a.out, m, md, envelope(A) if A else None, onsets, tl, runs, rows, note,
                  ("TIMELINE " + os.path.basename(tl["path"])) if tl else "NO TIMELINE")
    print(f"{a.out}: {len(runs)} still runs, {len(md['events'])} visual events, {len(onsets)} onsets, {ncues} cues")
    return 0


# ---------------------------------------------------------------- doctor
REQUIRED_FILTERS = ("fps", "scale", "format", "split", "tblend", "lutyuv", "signalstats", "metadata", "showinfo", "setsar",
                    "select", "ebur128", "loudnorm", "aresample", "highpass")
REQUIRED_ENCODERS = ("libx264", "aac", "ffv1", "pcm_s16le", "pcm_f32le")


def cmd_doctor(a):
    ok = sys.version_info >= (3, 9)
    print(f"python {sys.version.split()[0]}" + ("" if ok else "  FAIL: needs Python 3.9+"))
    for tool in ("ffmpeg", "ffprobe"):
        path = shutil.which(tool)
        if not path:
            print(f"FAIL {tool} not found on PATH (macOS: brew install ffmpeg; Debian/Ubuntu: apt install ffmpeg)")
            ok = False
            continue
        print(f"{tool}: {path} ({run([tool, '-version']).stdout.splitlines()[0]})")
    if shutil.which("ffmpeg"):
        flt = set(re.findall(r"^\s*[T.][S.]\s+(\S+)\s+\S+->\S+", run(["ffmpeg", "-hide_banner", "-filters"]).stdout, re.M))
        enc = set(re.findall(r"^\s*[VAS][.A-Z]{5}\s+(\S+)", run(["ffmpeg", "-hide_banner", "-encoders"]).stdout, re.M))
        for group, names, pool, need in (("filters", REQUIRED_FILTERS, flt, True), ("encoders", REQUIRED_ENCODERS, enc, True),
                                         ("optional", ("drawtext", "zscale", "aac_at"), flt | enc, False)):
            miss = [x for x in names if x not in pool]
            if miss and need:
                ok = False
                print(f"FAIL {group} missing: {', '.join(miss)} (install a full ffmpeg build)")
            else:
                print(f"{group}: " + ", ".join(f"{x}{'' if x in pool else ' (absent; not needed)'}" for x in names))
    print("PASS toolchain ready" if ok else "FAIL toolchain incomplete")
    return 0 if ok else 1


# ---------------------------------------------------------------- selftest (S20: the maintainer test, not shipped)
def cmd_selftest(a):
    """Run maintainers/tests/vqa/test_vqa.py (the ground-truth cases that lived here) when this checkout has it."""
    test = os.path.join(os.path.dirname(HERE), "maintainers", "tests", "vqa", "test_vqa.py")
    if not os.path.isfile(test):
        print("maintainer test, not shipped: the selftest lives in the code-to-video repo's maintainers/tests/vqa/")
        return 0
    lim = fnum(os.environ.get("C2V_CHILD_TIMEOUT"), 0.0) or None  # an injected limit; none by default
    try:
        return subprocess.run([sys.executable, "-B", test, os.path.dirname(HERE)] + (["--keep", a.keep] if a.keep
                                                                                    else []), timeout=lim).returncode
    except subprocess.TimeoutExpired:
        raise ToolError(f"{test} ran past C2V_CHILD_TIMEOUT ({lim:g} s)")


# ---------------------------------------------------------------- CLI
class Parser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        sys.stderr.write(f"{self.prog}: error: {message}\n")
        sys.exit(3)


def main():
    try:  # the parser's --register, --format and --spec choices come from registers.json: unreadable is a tool error
        registers()
    except ToolError as e:
        print(f"vqa.py: error: {e}", file=sys.stderr)
        sys.exit(3)
    ap = Parser(prog="vqa.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True, parser_class=Parser, metavar="COMMAND")

    def sub(name, fn, helptext):
        p = sp.add_parser(name, help=helptext, description=helptext)
        p.set_defaults(f=fn)
        return p

    def tl_arg(p):
        p.add_argument("--timeline", help="<out>.timeline.json from render.mjs (scenes, holds, events, cues, layers, "
                       "steps, effects)")

    def kit_arg(p):
        p.add_argument("--kit", metavar="DIR", help="the kit folder given to mix.py (kit.json): cues without their own "
                       "\"anchor\" are measured at the kit's anchor, as mix.py places them (riser = end; glitch, type-keys, "
                       "bed = start); without it they are measured at 'peak'")

    def motion_args(p):
        p.add_argument("--rate", type=float, default=None, help="analysis fps (default: native if CFR 10-60, else 30)")
        p.add_argument("--width", type=int, default=320, help="analysis width in px (calibrated at 320)")
        p.add_argument("--thr", type=float, default=THR_STILL, help="near-static threshold on the 0.2 s mean (calibrated 0.1)")

    def share(s):  # a fraction: 35 would silently switch the check off
        v = fnum(s, -1.0)
        if not 0 < v <= 1:
            raise argparse.ArgumentTypeError(f"'{s}' is not a share of the film from 0 to 1 (0.35 = 35%)")
        return v

    def hold_arg(p):
        p.add_argument("--max-hold-share", type=share, default=None, metavar="SHARE",
                       help="NOTE when declared holds cover more than this share of the film, not counting the final "
                       "hold's poster part (default: registers.json pacing.declared_hold_share_note_pct)")

    def film_args(p):
        R = registers()
        p.add_argument("--register", choices=tuple(R["registers"]), help="for a film whose timeline has no register: "
                       "sets the frozen-share lines, the hook rule and the breath cap (default neutral, with a NOTE)")
        p.add_argument("--format", choices=tuple(R["formats"]), help="for a film whose timeline has no format: data "
                       "raises the frozen lines, overlay skips the frozen share, loop checks its seam, teaser and sting "
                       "add the hook rule")

    def kind_arg(p):
        p.add_argument("--kind", choices=tuple(KINDS), default="mp4", help="what the delivery probe expects: mp4 = H.264 "
                       "High yuv420p, BT.709 tags, AAC (T8; default); alpha = ProRes 4444 .mov or VP9 .webm with a real "
                       "alpha channel; gif = a palette GIF, no sound; prores = a ProRes 422 HQ master with PCM")

    def spec_arg(p, default, extra=""):
        p.add_argument("--spec", choices=spec_names(), default=default,
                       help="loudness target only (S17): calm, neutral or energetic judges against that register's "
                       "accepted range; auto against the timeline's register (neutral when it names none, as mix.py "
                       "masters it); web, voice, ebu or atsc against that destination's spec, which wins when the brief "
                       f"names it; none = no loudness verdict{extra}; every number is in scripts/registers.json "
                       f"(default {default})")

    def nv_arg(p):
        p.add_argument("--no-vision", action="store_true", help="the author cannot view images: review.md opens with NO "
                       "VISION instead of the board's code, and only fresh reviewers' replies count as looking")

    def onset_args(p):
        p.add_argument("--af", help="audio pre-filter, e.g. highpass=f=800 to ignore kick drums and beds")
        p.add_argument("--rise", type=float, default=10.0, help="onset rise in dB within 30 ms")
        p.add_argument("--gate", type=float, default=-50.0, help="ignore onsets quieter than this (dBFS)")

    p = sub("pack", cmd_pack, "the whole QA pack: board.png, summary.md, sheet.png, timeline.png, bursts/, phone/, "
            "metrics.json; in a work folder also the reviewer copy, prompts and lines (blind/, recheck/), after S15's checks")
    p.add_argument("video", nargs="?", help="the render to pack (omit with --preflight)")
    p.add_argument("--out", required=True, help="output folder, e.g. qa/v3")
    p.add_argument("--preflight", action="store_true", help="only check that this round may start (S15): exit 0 or 2 "
                   "with the file and what it lacks; writes nothing")
    nv_arg(p)
    tl_arg(p)
    p.add_argument("--sfx-stem", help="SFX-only stem from mix.py: clean onsets for sync under music; needed only when "
                   "the timeline plans cues")
    kit_arg(p)
    p.add_argument("--reference", help="reference film: adds its motion profile, reference-timeline.png and sbs.png")
    kind_arg(p)
    spec_arg(p, "auto", "; the delivery checks stay")
    p.add_argument("--af", help="audio pre-filter for onsets when there is no stem (default with music: highpass=f=800)")
    p.add_argument("--picture-only", action="store_true",
                   help="a picture-only review round: planned cues without an audio stream are noted, not failed")
    hold_arg(p)
    film_args(p)
    p = sub("board", cmd_board, "one board without the pack (S13): board.png with its code and metrics.json; at tier L "
            "or LF also the reviewer copy, blind prompt and reviewer line (the prototype: --out qa/proto; a round qa/vN "
            "is a pack, so board refuses it)")
    p.add_argument("video")
    p.add_argument("--out", required=True, help="output folder, e.g. qa/proto")
    tl_arg(p)
    p.add_argument("--tier", choices=tuple(TIER_RANK), help="the film's tier (default: the work folder's .c2v/state.json)")
    kind_arg(p)
    nv_arg(p)
    p = sub("ledger", cmd_ledger, "rebuild qa/ledger.json from the reviewers' replies and the packs only (S14); print the "
            "open findings and the replies still awaited")
    p.add_argument("work", help="the work folder (the parent of qa/), e.g. .")
    p = sub("gate", cmd_gate, "READY or NOT READY for delivery, and the block report.md pastes verbatim (S19)")
    p.add_argument("work", help="the work folder (the parent of qa/), e.g. .")
    p.add_argument("--final", metavar="FILE", help="the delivered file (default: WORK/final.mp4, else the latest pack's "
                   "video)")
    p.add_argument("--no-blind", metavar="REASON", help="no fresh blind reviewer: accepted at tiers S and R, at M only when "
                   "the delivered round's blind/launch.log shows both routes failed, never at L or LF; the block opens "
                   "NOT BLIND-REVIEWED")
    nv_arg(p)
    p = sub("probe", cmd_probe, "delivery facts and warnings: codec, pix_fmt, CFR, color tags, faststart, alpha, audio; "
            "loudness too when a --spec is given")
    p.add_argument("file")
    kind_arg(p)
    spec_arg(p, "none")
    p = sub("motion", cmd_motion, "near-static share, still runs vs planned holds, per-second energy, events, judder")
    p.add_argument("file")
    tl_arg(p)
    p.add_argument("--exempt", help="planned holds without a timeline, e.g. 0-1.5,10.5-12")
    motion_args(p)
    p.add_argument("--min-run", type=float, default=MIN_RUN, help="list still runs from this length (s)")
    hold_arg(p)
    film_args(p)
    p.add_argument("--json", action="store_true")
    p = sub("layout", cmd_layout, "the layout check on 12 evenly spaced frames, or on still PNGs: empty edge bands, an "
            "off-balance centroid, a small subject (S12; the pack runs it too)")
    p.add_argument("file", nargs="+", help="a video, or still PNGs (render.mjs --stills writes still-<t>s.png)")
    tl_arg(p)
    kind_arg(p)
    p.add_argument("--json", action="store_true")
    p = sub("onsets", cmd_onsets, "audio onsets: time, peak time, level, rise")
    p.add_argument("file")
    onset_args(p)
    p = sub("sync", cmd_sync, "sound vs picture vs plan, offsets in ms and frames")
    p.add_argument("file")
    tl_arg(p)
    p.add_argument("--sfx-stem", help="measure onsets on this stem instead of the file's audio")
    kit_arg(p)
    p.add_argument("--window", type=float, default=0.25, help="pairing window in seconds")
    onset_args(p)
    motion_args(p)
    p = sub("loudness", cmd_loudness, "integrated loudness, LRA, true peak vs the register's range or a destination's spec; "
            "optional two-pass loudnorm")
    p.add_argument("file")
    spec_arg(p, "auto")
    tl_arg(p)
    kind_arg(p)
    p.add_argument("--target", type=float, default=None, help="override the integrated target (LUFS)")
    p.add_argument("--tp", type=float, default=None, help="override the true-peak ceiling (dBTP)")
    p.add_argument("--lra", type=float, default=11.0, help="loudnorm LRA for --normalize")
    p.add_argument("--normalize", metavar="OUT", help="write a loudnorm (linear when possible) copy and re-measure it")
    p = sub("sheet", cmd_sheet, "contact sheet with the time (and scene) under every cell")
    p.add_argument("file")
    p.add_argument("out")
    p.add_argument("--cells", type=int, default=12)
    p.add_argument("--max-width", type=int, default=1600)
    tl_arg(p)
    p = sub("bursts", cmd_bursts, "5 consecutive frames around each event (default: planned + detected events and the ending)")
    p.add_argument("file")
    p.add_argument("outprefix")
    p.add_argument("--at", help="explicit times, e.g. 3.0,6.0")
    tl_arg(p)
    p = sub("phone", cmd_phone, "480 px wide frames: scene midpoints and ends, hold midpoints, events")
    p.add_argument("file")
    p.add_argument("outdir")
    p.add_argument("--at", help="explicit times, e.g. 1.5,4.2")
    tl_arg(p)
    p = sub("timeline", cmd_timeline, "PNG strip: motion | visual events | audio and onsets | plan, with second ticks")
    p.add_argument("file")
    p.add_argument("out")
    tl_arg(p)
    p.add_argument("--sfx-stem")
    p.add_argument("--af")
    p = sub("sbs", cmd_sbs, "two pictures side by side at the same height; each is an image or video@seconds")
    p.add_argument("a")
    p.add_argument("b")
    p.add_argument("out")
    p.add_argument("--height", type=int, default=440, help="picture height in px (440: two 16:9 frames fit 1600 px)")
    sub("doctor", cmd_doctor, "check ffmpeg/ffprobe, versions, required filters and encoders")
    p = sub("selftest", cmd_selftest, "run the maintainer test maintainers/tests/vqa/test_vqa.py when this checkout has "
            "it (S20); a shipped copy prints 'maintainer test, not shipped'")
    p.add_argument("--keep", metavar="DIR", help="build and keep the test's clips and packs in DIR")
    a = ap.parse_args()
    try:
        rc = a.f(a)
    except ToolError as e:
        print(f"vqa.py {a.cmd}: error: {e}", file=sys.stderr)
        rc = 3
    except Refused as e:
        print(f"vqa.py {a.cmd}: refused: {e}", file=sys.stderr)
        rc = 2
    except KeyboardInterrupt:
        rc = 130
    except Exception:
        import traceback
        traceback.print_exc()
        print(f"vqa.py {a.cmd}: internal error (exit 3); the traceback above is a tool bug, not a QA finding", file=sys.stderr)
        rc = 3
    sys.exit(rc)


if __name__ == "__main__":
    main()
