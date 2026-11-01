#!/usr/bin/env python3
"""Fit a straight beat grid t_k = t0 + k*T to music (Python stdlib + ffmpeg).

  beatgrid.py MUSIC [BPM] [--start S] [--end S] [--json out.json] [--librosa]

Method: onset strength in 4 bands (ffmpeg filters at 16 kHz; rise in log energy between 24 ms windows
every 6 ms), tempo by autocorrelation (70-180 BPM with a prior at 120, or +-5% around BPM), a period and
phase search on the onset grid, then least squares on the strongest onset near each beat, dropping
residuals beyond 3 MADs. Kicks belong on the beat: when the low band is stronger half a beat later, the
grid moves half a beat. Bars are not detected: beat 0 is the first beat, not necessarily a downbeat.

Accept the grid when the residual median is < 10 ms, p95 <= 15 ms, >= 70% of beats fit, and the BPM is
within 1% of the track's stated BPM. Octave and 3:2 errors pass the other checks, so pass the stated BPM
as BPM; without it the BPM is unverified and the octave and 3:2 alternatives are listed. Trust the phase
when the kick on/off-beat ratio is >= 1.5; otherwise listen to clicks on the grid.

--start/--end fit one section (seconds into the file); reported times stay file times.
--json writes bpm, period, beat 0, every beat time, residual stats, the checks and the octave check
(- for stdout). --librosa adds librosa's beat_track (tightness 400) fitted the same way, when librosa
imports (uv run --no-project --with librosa python3 beatgrid.py ...); its phase can lock to hi-hats.

Exit status: 0 = grid accepted; 1 = fitted, but a check failed or the BPM is unverified; 2 = bad input or
no steady beat; 3 = ffmpeg missing or failed.
"""
import argparse
import array
import itertools as it
import json
import math
import operator as op
import os
import shutil
import statistics as st
import subprocess
import sys

SR, HOP, W = 16000, 96, 384                  # 24 ms windows every 6 ms
DT, C0 = HOP / SR, (W / 2 + HOP) / SR        # onset step j -> time j * DT + C0
BANDS = ["lowpass=f=150", "bandpass=f=400:width_type=o:w=1.5", "bandpass=f=1500:width_type=o:w=1.5", "highpass=f=4000"]
MAX_MEDIAN_MS, MAX_P95_MS, MIN_FIT, BPM_TOL, MIN_KICK = 10.0, 15.0, 0.70, 0.01, 1.5


class GridError(Exception):
    pass


def band_rises(path, start, end):
    """Per band, the rise in log energy between successive windows; and the section length in seconds."""
    trim = f"atrim=start={start}" + (f":end={end}" if end else "") + ",asetpts=PTS-STARTPTS," if start or end else ""
    fc = (f"[0:a]{trim}aformat=channel_layouts=mono,aresample={SR},asplit=4[s0][s1][s2][s3];"
          + ";".join(f"[s{i}]{b}[b{i}]" for i, b in enumerate(BANDS)) + ";[b0][b1][b2][b3]join=inputs=4:channel_layout=4.0[o]")
    proc = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-filter_complex", fc, "-map", "[o]", "-f", "s16le", "-"],
                          capture_output=True)
    if proc.returncode:
        raise GridError(f"ffmpeg could not decode {path}: {proc.stderr.decode(errors='replace').strip()[-300:]}")
    x = array.array("h", proc.stdout[: len(proc.stdout) // 8 * 8])
    if sys.byteorder == "big":
        x.byteswap()
    rise = []
    for c in range(4):
        cs = [0, *it.accumulate(map(op.mul, x[c::4], x[c::4]))]
        e = [math.log10(1 + (cs[i + W] - cs[i]) / W) for i in range(0, len(cs) - 1 - W, HOP)]
        rise.append([max(0.0, q - p) for p, q in zip(e, e[1:])])
    return rise, len(x) / 4 / SR


def on(s, T, t0, k=0.0):
    """Signal at each grid beat (+k beats), the max within +-1 step."""
    js = (round((t0 + (n + k) * T - C0) / DT) for n in range(int(len(s) * DT / T)))
    return [max(s[max(0, j - 1):j + 2]) for j in js if 0 <= j < len(s)]


def fit(rise, hint):
    o = list(map(sum, zip(*rise)))
    if len(o) * DT < 8 * 60 / (hint * 0.95 if hint else 70):
        raise GridError("the music is too short: a grid needs at least 8 beats")
    m, sd = st.fmean(o), st.pstdev(o)
    if sd == 0:
        raise GridError("no onsets: the music is silent or constant")
    o = [(v - m) / sd for v in o]
    lo, hi = int(60 / (hint * 1.05 or 180) / DT) - 1, int(60 / (hint / 1.05 or 70) / DT) + 2
    ac = {L: sum(map(op.mul, o, o[L:])) for L in range(lo, hi)}
    L = max(list(ac)[1:-1], key=lambda L: ac[L] * math.exp(-0.5 * math.log2(60 / L / DT / 120) ** 2))
    den = ac[L - 1] - 2 * ac[L] + ac[L + 1]
    T = DT * (L + (0.5 * (ac[L - 1] - ac[L + 1]) / den if den else 0.0))
    T, t0 = max(((T * (1 + 5e-4 * j), i * DT) for j in range(-10, 11) for i in range(int(T / DT))),
                key=lambda g: st.fmean(on(o, *g)))
    pk = [(j * DT + C0, o[j]) for j in range(1, len(o) - 1) if o[j] > max(o[j - 1], 1.0) and o[j] >= o[j + 1]]
    r = None
    for w in (0.04, 0.03, 0.025, 0.025):     # strongest onset near each beat; fit; drop > 3 MAD
        near = {}
        for t, v in pk:
            n = round((t - t0) / T)
            if abs(t - t0 - n * T) <= w and v > near.get(n, (0, 0))[1]:
                near[n] = (t, v)
        p = [(n, t) for n, (t, v) in near.items() if not r or abs(t - t0 - n * T) <= max(3 * 1.4826 * st.median(r), 0.01)]
        if len(p) < 8:
            raise GridError(f"no steady beat: only {len(p)} onsets sit near a straight grid")
        km, tm = st.fmean(n for n, _ in p), st.fmean(t for _, t in p)
        T = sum((n - km) * (t - tm) for n, t in p) / sum((n - km) ** 2 for n, _ in p)
        t0 = tm - T * km
        r = sorted(abs(t - t0 - n * T) for n, t in p)
    kon, koff = sum(on(rise[0], T, t0)), sum(on(rise[0], T, t0, 0.5)) + 1e-9   # kicks belong on the beat
    flipped = koff > kon
    if flipped:
        t0, kon, koff = t0 + T / 2, koff, kon
    return {"T": T, "t0": t0, "fit": len(p) * T / (len(o) * DT), "median": r[len(r) // 2],
            "p95": r[int(0.95 * (len(r) - 1))], "max": r[-1], "n": len(p), "kick": min(kon / koff, 99), "flipped": flipped}


def librosa_fit(path, start, end):
    import numpy as np
    import librosa
    y, sr = librosa.load(path, sr=None, mono=True, offset=start, duration=(end - start) if end else None)
    b = librosa.beat.beat_track(y=y, sr=sr, tightness=400, units="time")[1]
    if len(b) < 8:
        raise GridError(f"librosa found {len(b)} beats")
    k, keep = np.arange(len(b)), np.ones(len(b), bool)
    for _ in range(3):                       # least squares, drop > 3 MAD (>= 10 ms), refit
        T, t0 = np.polyfit(k[keep], b[keep], 1)
        r = np.abs(b - t0 - k * T)
        keep = r <= max(3 * 1.4826 * np.median(r[keep]), 0.01)
    return {"bpm": round(60 / T, 3), "beat0_s": round((t0 + start) % T, 4), "beats": len(b), "kept": int(keep.sum()),
            "residual_ms": {"median": round(1e3 * float(np.median(r[keep])), 2),
                            "p95": round(1e3 * float(np.percentile(r[keep], 95)), 2)}}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="beatgrid.py", description=__doc__.split("\n\n")[0],
                                 epilog=__doc__.split("\n\n", 2)[2], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("music", help="audio or video file with music (anything ffmpeg decodes)")
    ap.add_argument("bpm", nargs="?", type=float, help="the track's stated BPM: search +-5%% around it (recommended)")
    ap.add_argument("--start", type=float, default=0.0, help="fit from this time, s (default 0)")
    ap.add_argument("--end", type=float, help="fit up to this time, s (default: the end)")
    ap.add_argument("--json", metavar="PATH", help="write the full result as JSON (- = stdout)")
    ap.add_argument("--librosa", action="store_true", help="also fit librosa's beats, if librosa imports")
    a = ap.parse_args(argv)
    if a.bpm is not None and not 30 <= a.bpm <= 300:
        ap.error("BPM must be between 30 and 300")
    if a.start < 0 or (a.end is not None and a.end <= a.start):
        ap.error("need 0 <= --start < --end")
    if not os.path.isfile(a.music):
        ap.error(f"{a.music}: no such file")
    if not shutil.which("ffmpeg"):
        print("beatgrid.py: error: ffmpeg not found on PATH (brew install ffmpeg / apt install ffmpeg)", file=sys.stderr)
        return 3
    try:
        rise, dur = band_rises(a.music, a.start, a.end)
        g = fit(rise, a.bpm or 0.0)
    except GridError as e:
        print(f"beatgrid.py: error: {e}", file=sys.stderr)
        return 3 if str(e).startswith("ffmpeg") else 2
    T, bpm = g["T"], 60 / g["T"]
    beat0 = g["t0"] % T
    beats = [round(a.start + beat0 + n * T, 4) for n in range(int((dur - beat0) / T) + 1) if beat0 + n * T < dur]
    alts = {k: round(bpm * f, 3) for k, f in (("x1/2", 0.5), ("x2/3", 2 / 3), ("x3/2", 1.5), ("x2", 2.0))}
    match = None if a.bpm is None else abs(bpm / a.bpm - 1) <= BPM_TOL
    checks = {"residual_median": g["median"] * 1e3 < MAX_MEDIAN_MS, "residual_p95": g["p95"] * 1e3 <= MAX_P95_MS,
              "fitted": g["fit"] >= MIN_FIT, "bpm_matches_stated": match}
    accepted = all(checks.values())  # an unverified BPM (None) is not accepted
    print(f"BPM {bpm:.3f}  beat 0 at {a.start + beat0:.4f} s  fitted {100 * g['fit']:.0f}% of beats  residual median "
          f"{1e3 * g['median']:.1f} ms  p95 {1e3 * g['p95']:.1f} ms  kick on/off-beat ratio {g['kick']:.1f}")
    print(f"  grid: T={T:.5f} T0={a.start + beat0:.4f}  beat(n) = T0 + n*T, {len(beats)} beats from "
          f"{a.start:g} to {a.start + dur:.2f} s" + ("; moved half a beat onto the kicks" if g["flipped"] else ""))
    fails = []
    if not checks["residual_median"]:
        fails.append(f"residual median {1e3 * g['median']:.1f} ms (needs < {MAX_MEDIAN_MS:g})")
    if not checks["residual_p95"]:
        fails.append(f"p95 {1e3 * g['p95']:.1f} ms (needs <= {MAX_P95_MS:g})")
    if not checks["fitted"]:
        fails.append(f"{100 * g['fit']:.0f}% of beats fit (needs >= {100 * MIN_FIT:.0f}%: tempo change, breakdown, or "
                     "no steady beat; fit only the section you use, or pin cuts to onsets)")
    if match is False:
        fails.append(f"BPM is not within 1% of the stated {a.bpm:g}")
    if fails:
        print("REJECT grid: " + "; ".join(fails))
    elif match is None:
        print(f"UNVERIFIED BPM: the residual and fit checks pass, but octave and 3:2 errors pass them too; rerun with "
              f"the track's stated BPM (if it is {alts['x1/2']:g}, {alts['x2/3']:g}, {alts['x3/2']:g} or {alts['x2']:g}, "
              f"this grid is wrong)")
    else:
        print(f"ACCEPT grid: median < {MAX_MEDIAN_MS:g} ms, p95 <= {MAX_P95_MS:g} ms, >= {100 * MIN_FIT:.0f}% fitted, "
              f"BPM within 1% of the stated {a.bpm:g}")
    print(f"  phase: {'trust it' if g['kick'] >= MIN_KICK else 'listen to clicks on the grid before trusting it'} "
          f"(kick on/off-beat ratio {g['kick']:.1f}, threshold {MIN_KICK:g})")
    lib = None
    if a.librosa:
        try:
            lib = librosa_fit(a.music, a.start, a.end)
            print(f"  librosa: BPM {lib['bpm']:.3f}  beat 0 at {lib['beat0_s']:.4f} s  residual median "
                  f"{lib['residual_ms']['median']:.1f} ms  p95 {lib['residual_ms']['p95']:.1f} ms  ({lib['kept']}/{lib['beats']} beats)")
        except ImportError:
            print("  librosa: not importable; run under `uv run --no-project --with librosa python3 ...`")
        except GridError as e:
            print(f"  librosa: {e}")
    res = {"file": a.music, "start": a.start, "end": round(a.start + dur, 4), "bpm": round(bpm, 4), "period_s": round(T, 6),
           "beat0_s": round(a.start + beat0, 4), "beats": beats, "fitted": round(g["fit"], 3), "onsets_fitted": g["n"],
           "residual_ms": {k: round(1e3 * g[k], 2) for k in ("median", "p95", "max")},
           "kick_ratio": round(g["kick"], 2), "phase_trusted": g["kick"] >= MIN_KICK, "moved_half_beat": g["flipped"],
           "octave": {"stated_bpm": a.bpm, "matches_stated": match, "alternatives": alts},
           "checks": checks, "accepted": accepted, "librosa": lib}
    if a.json:
        text = json.dumps(res)
        if a.json == "-":
            print(text)
        else:
            os.makedirs(os.path.dirname(os.path.abspath(a.json)), exist_ok=True)
            with open(a.json, "w") as fh:
                fh.write(text + "\n")
    return 0 if accepted else 1


if __name__ == "__main__":
    sys.exit(main())
