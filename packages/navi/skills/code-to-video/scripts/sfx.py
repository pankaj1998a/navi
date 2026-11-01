#!/usr/bin/env python3
"""Synthesize a small, deterministic, license-free sound-effects kit (Python stdlib + ffmpeg).

  sfx.py kit OUTDIR [--seed N] [--key K] [--bed-dur S]   every sound + OUTDIR/kit.json
  sfx.py make NAME -o FILE.wav [--dur S] [--seed N] [--key K]
  sfx.py list

Files are 48 kHz stereo 24-bit PCM, peak-normalized to -1 dBFS; set levels per cue in the timeline.
kit.json records per sound: file, duration, anchor (seconds from the file start that must land on the
picture event), anchor_kind (peak = loudest 10 ms RMS window, end = last sample, start = first sample),
peak_dbfs, true_peak_dbtp, lufs (integrated; null when the sound is too short or quiet for ebur128's
400 ms gate), lufs_m_max (loudest 400 ms momentary loudness, comparable across one-shots), tags, use.
Same seed, Python, and ffmpeg build -> byte-identical files. The sounds were checked by spectrogram,
waveform, and numbers only; audition them before relying on taste.
"""
import sys

sys.dont_write_bytecode = True  # spec 2.0: set before any other import, so nothing is written into the skill folder
import argparse
import array
import json
import math
import operator
import os
import random
import re
import shutil
import subprocess
import tempfile
import wave

SR = 48000
TAU = 2.0 * math.pi
PEAK_DBFS = -1.0
FFMPEG = "ffmpeg"


def die(msg, code=2):
    print(f"sfx.py: error: {msg}", file=sys.stderr)
    sys.exit(code)


def ns(seconds):
    return max(1, int(round(seconds * SR)))


# ------------------------------------------------------------------ signal helpers (lists of floats)
def add_at(dst, src, at=0, gain=1.0):
    """dst[at + i] += gain * src[i], clipped to dst."""
    if at < 0:
        src, at = src[-at:], 0
    end = min(len(dst), at + len(src))
    if end <= at:
        return dst
    if gain == 1.0:
        dst[at:end] = map(operator.add, dst[at:end], src[:end - at])
    else:
        dst[at:end] = [d + gain * s for d, s in zip(dst[at:end], src)]
    return dst


def scale(x, g):
    return [v * g for v in x]


def mul(x, env):
    return list(map(operator.mul, x, env))


def white(rng, n):
    r = rng.random
    return [2.0 * r() - 1.0 for _ in range(n)]


def pink(rng, n):
    """Paul Kellet's refined pink filter on white noise (about -3 dB/octave, 10 Hz-20 kHz)."""
    r = rng.random
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0
    out = [0.0] * n
    for i in range(n):
        w = 2.0 * r() - 1.0
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.96900 * b2 + w * 0.1538520
        b3 = 0.86650 * b3 + w * 0.3104856
        b4 = 0.55000 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.0168980
        out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
        b6 = w * 0.115926
    return out


def svf(x, fc, q=0.707, mode="bp", step=8):
    """Topology-preserving state-variable filter (Zavalishin/Simper): stable at any cutoff and under fast
    modulation. fc is Hz, a number or a per-sample list (coefficients refresh every `step` samples).
    mode: lp, hp, or bp (bp has unity gain at fc)."""
    k = 1.0 / q
    ic1 = ic2 = 0.0
    n = len(x)
    out = [0.0] * n
    sweep = not isinstance(fc, (int, float))
    nyq = SR * 0.49

    def coefs(f):
        g = math.tan(math.pi * min(max(f, 5.0), nyq) / SR)
        a1 = 1.0 / (1.0 + g * (g + k))
        return a1, g * a1, g * g * a1

    a1, a2, a3 = coefs(fc[0] if sweep else fc)
    for i in range(n):
        if sweep and i % step == 0:
            a1, a2, a3 = coefs(fc[i])
        v0 = x[i]
        v3 = v0 - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2.0 * v1 - ic1
        ic2 = 2.0 * v2 - ic2
        if mode == "lp":
            out[i] = v2
        elif mode == "bp":
            out[i] = k * v1
        else:
            out[i] = v0 - k * v1 - v2
    return out


def lp1(x, fc):
    """One-pole low-pass (6 dB/octave)."""
    a = 1.0 - math.exp(-TAU * fc / SR)
    y = 0.0
    out = [0.0] * len(x)
    for i, v in enumerate(x):
        y += a * (v - y)
        out[i] = y
    return out


def hp1(x, fc):
    return list(map(operator.sub, x, lp1(x, fc)))


def pan_mono(x, p):
    """Equal-power pan of a mono list; p in [-1, 1] (constant or per-sample list)."""
    if isinstance(p, (int, float)):
        th = (p + 1.0) * math.pi / 4.0
        return scale(x, math.cos(th)), scale(x, math.sin(th))
    L = [v * math.cos((q + 1.0) * math.pi / 4.0) for v, q in zip(x, p)]
    R = [v * math.sin((q + 1.0) * math.pi / 4.0) for v, q in zip(x, p)]
    return L, R


def mode_tone(n, f, tau, amp=1.0, attack=0.0002, phase=0.0):
    """One resonant mode: a sine at f Hz decaying with time constant tau, after a short linear attack."""
    w = TAU * f / SR
    d = math.exp(-1.0 / (tau * SR))
    na = max(1, int(attack * SR))
    out = [0.0] * n
    e = amp
    for i in range(n):
        out[i] = math.sin(w * i + phase) * e * (i / na if i < na else 1.0)
        e *= d
    return out


def glide_tone(freqs, harmonics=((1, 1.0),), phase=0.0):
    """Phase-continuous oscillator following a per-sample frequency list; harmonics = ((k, amp), ...)."""
    out = [0.0] * len(freqs)
    ph = phase
    nyq = SR * 0.45
    for i, f in enumerate(freqs):
        ph += TAU * f / SR
        s = 0.0
        for k, a in harmonics:
            if k * f < nyq:
                s += a * math.sin(k * ph)
        out[i] = s
    return out


def cycle_table(m, cycles, harmonics, phases=None):
    """m samples holding exactly `cycles` periods of a band-limited wave: tiling it gives a steady tone
    at cycles * SR / m Hz with no per-sample work."""
    phases = phases or [0.0] * len(harmonics)
    base = TAU * cycles / m
    return [sum(a * math.sin(k * base * i + p) for (k, a), p in zip(harmonics, phases)) for i in range(m)]


def tile(table, n):
    reps = n // len(table) + 1
    return (table * reps)[:n]


def tone_tiled(f, n, harmonics, phases=None, cycles=8, amp=1.0):
    """Steady tone of length n at about f Hz (within ~1 cent) built by tiling a cycle table; the cost is
    one table, not n samples of oscillator work."""
    nyq = SR * 0.45
    hs = [(k, a * amp) for k, a in harmonics if k * f < nyq]
    m = max(8, int(round(cycles * SR / f)))
    return tile(cycle_table(m, cycles, hs, phases), n)


def fade(x, fin=0.0, fout=0.0):
    """Raised-cosine fades in place; times in seconds."""
    n = len(x)
    a, b = min(n, int(fin * SR)), min(n, int(fout * SR))
    for i in range(a):
        x[i] *= 0.5 - 0.5 * math.cos(math.pi * i / a)
    for i in range(b):
        x[n - 1 - i] *= 0.5 - 0.5 * math.cos(math.pi * i / b)
    return x


def pad(x, n):
    return x + [0.0] * (n - len(x)) if len(x) < n else x[:n]


# ------------------------------------------------------------------ ffmpeg helpers
def ff(args, inp=None):
    try:
        p = subprocess.run([FFMPEG, "-hide_banner", "-nostats"] + args, input=inp, capture_output=True)
    except FileNotFoundError:
        die("ffmpeg not found on PATH (install it, e.g. `brew install ffmpeg` or `apt install ffmpeg`)", 3)
    if p.returncode != 0:
        lines = p.stderr.decode(errors="replace").strip().splitlines()
        die(f"ffmpeg failed: {lines[-1] if lines else 'exit ' + str(p.returncode)}", 3)
    return p


def f32_bytes(L, R):
    a = array.array("f", [0.0]) * (2 * len(L))
    a[0::2] = array.array("f", L)
    a[1::2] = array.array("f", R)
    if sys.byteorder == "big":
        a.byteswap()
    return a.tobytes()


def ir_synth(rng, decay, predelay=0.01, bright=7000.0, dark=0.12):
    """Stereo impulse response: decorrelated noise with an exponential decay (-60 dB at `decay` s) whose
    low-pass cutoff glides from `bright` Hz down to bright*dark Hz, so the tail darkens like a real room."""
    n = ns(predelay + decay)
    pre = ns(predelay)
    k60 = math.log(1000.0) / (decay * SR)
    chans = []
    for _ in range(2):
        r = rng.random
        ir = [0.0] * n
        y = 0.0
        a = 0.0
        for i in range(pre, n):
            if (i - pre) % 32 == 0:
                u = (i - pre) / (n - pre)
                a = 1.0 - math.exp(-TAU * bright * (dark ** u) / SR)
            y += a * ((2.0 * r() - 1.0) - y)
            ir[i] = y * math.exp(-k60 * (i - pre))
        chans.append(ir)
    return chans


def reverb(L, R, rng, decay=1.0, wet=0.2, predelay=0.01, bright=7000.0, dark=0.12):
    """Dry + convolution reverb (ffmpeg afir with ir_synth). `wet` is the wet/dry energy ratio per channel
    as an amplitude (0.2 = reverberant energy 14 dB under the direct sound). Appends the tail."""
    irL, irR = ir_synth(rng, decay, predelay, bright, dark)
    m = len(irL)
    with tempfile.TemporaryDirectory(prefix="sfx-") as td:
        irp = os.path.join(td, "ir.f32")
        with open(irp, "wb") as fh:
            fh.write(f32_bytes(irL, irR))
        fmt = ["-f", "f32le", "-ar", str(SR), "-ac", "2"]
        p = ff(["-loglevel", "error"] + fmt + ["-i", "pipe:0"] + fmt + ["-i", irp, "-filter_complex",
               f"[0:a]apad=pad_len={m}[d];[d][1:a]afir[o]", "-map", "[o]", "-f", "f32le", "pipe:1"],
               inp=f32_bytes(L, R))
    a = array.array("f")
    a.frombytes(p.stdout)
    if sys.byteorder == "big":
        a.byteswap()
    wl, wr = list(a[0::2]), list(a[1::2])
    n = len(L) + m
    wl, wr = pad(wl, n), pad(wr, n)
    # Match wet energy per channel: a noise IR's magnitude at any one frequency is random, so on tonal
    # sounds one shared gain would leave the two channels several dB apart.
    def gain(dry, w):
        ed, ew = sum(v * v for v in dry), sum(v * v for v in w)
        return wet * math.sqrt(ed / ew) if ew > 0 else 0.0
    return add_at(pad(L, n), wl, 0, gain(L, wl)), add_at(pad(R, n), wr, 0, gain(R, wr))


# ------------------------------------------------------------------ finishing and measurement
def finish(L, R, kind, loop=False):
    """Remove DC/subsonics, trim the inaudible tail (not for end-anchored sounds, whose last sample is
    the anchor), de-click the edges, and peak-normalize to PEAK_DBFS. A loop is only normalized: a filter
    or fade at its edges would break the seam."""
    if loop:
        g = 10 ** (PEAK_DBFS / 20) / max(max(map(abs, L)), max(map(abs, R)), 1e-12)
        return scale(L, g), scale(R, g)
    L, R = hp1(L, 16.0), hp1(R, 16.0)
    peak = max(max(map(abs, L)), max(map(abs, R)), 1e-12)
    if kind != "end":
        floor = peak * 10 ** (-72 / 20)
        last = len(L) - 1
        while last > 0 and abs(L[last]) < floor and abs(R[last]) < floor:
            last -= 1
        n = min(len(L), last + 1 + ns(0.01))
        L, R = L[:n], R[:n]
        fade(L, 0.0003, 0.012)
        fade(R, 0.0003, 0.012)
    else:
        fade(L, 0.0003, 0.004)
        fade(R, 0.0003, 0.004)
    g = 10 ** (PEAK_DBFS / 20) / max(max(map(abs, L)), max(map(abs, R)), 1e-12)
    return scale(L, g), scale(R, g)


def rms_peak_time(L, R, win_s=0.010):
    """Start (s) of the loudest win_s window, energy averaged over both channels. mix.py measures
    untagged files the same way."""
    n = len(L)
    win = max(1, min(n, int(win_s * SR)))
    e = [a * a + b * b for a, b in zip(L, R)]
    acc = sum(e[:win])
    best, best_i = acc, 0
    for i in range(win, n):
        acc += e[i] - e[i - win]
        if acc > best:
            best, best_i = acc, i - win + 1
    return best_i / SR


def write_wav24(path, L, R):
    n = len(L)
    full = 8388607.0

    def ints(x):
        return array.array("i", [int(v * full + 8388608.5) - 8388608 for v in x])

    a = array.array("i", [0]) * (2 * n)
    a[0::2] = ints(L)
    a[1::2] = ints(R)
    if sys.byteorder == "big":
        a.byteswap()
    b = a.tobytes()
    out = bytearray(6 * n)
    out[0::3], out[1::3], out[2::3] = b[0::4], b[1::4], b[2::4]
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(bytes(out))


def loudness(path):
    """(integrated LUFS or None, max momentary LUFS or None, true peak dBTP) via ffmpeg ebur128."""
    af = "apad=pad_dur=0.4,ebur128=peak=true:framelog=info"
    err = ff(["-i", path, "-af", af, "-f", "null", "-"]).stderr.decode(errors="replace")
    head, _, summ = err.rpartition("Summary:")
    # ebur128 prints "M:%6.1f", so values <= -100 fuse with the label; take the whole token after it.
    ms = [float(t) for t in re.findall(r"\bM:\s*(\S+)", head)]
    ms = [v for v in ms if v > -100.0]
    integ = float(re.search(r"\bI:\s*(\S+)\s+LUFS", summ).group(1))
    tp = float(re.search(r"\bPeak:\s*(\S+)\s+dBFS", summ).group(1))
    return (None if integ <= -69.9 else integ), (max(ms) if ms else None), tp


# ------------------------------------------------------------------ generators: transients
# Every generator takes (rng, dur, key) and returns (L, R) float lists; finish() normalizes them.
def burst(rng, n, tau, fc, q=0.8):
    """Noise excitation: white noise with an exponential decay, band-passed at fc."""
    d = math.exp(-1.0 / (tau * SR))
    e, r = 1.0, rng.random
    x = [0.0] * n
    for i in range(min(n, int(tau * SR * 9))):
        x[i] = (2.0 * r() - 1.0) * e
        e *= d
    return svf(x, fc, q, "bp")


def modal_hit(rng, n, modes, noise_fc, noise_tau, noise_amp, spread=0.15):
    """Small struck object: damped modes (f, amp, tau) plus a band-passed noise transient. Stereo comes
    from partly decorrelated noise, so the image stays centred but not dead mono."""
    mono = [0.0] * n
    for f, a, tau in modes:
        add_at(mono, mode_tone(n, f * rng.uniform(0.99, 1.01), tau, a, phase=rng.uniform(0.0, 0.6)))
    common = burst(rng, n, noise_tau, noise_fc)
    L = add_at(list(mono), common, 0, noise_amp)
    R = add_at(list(mono), common, 0, noise_amp)
    add_at(L, burst(rng, n, noise_tau, noise_fc), 0, noise_amp * spread)
    add_at(R, burst(rng, n, noise_tau, noise_fc), 0, noise_amp * spread)
    return L, R


def g_click(variant):
    def gen(rng, dur, key):
        s, n = dur / 0.06, ns(dur)
        if variant == 1:
            modes = [(1850, 1.0, 0.0060), (3300, 0.50, 0.0035), (5200, 0.18, 0.0020), (640, 0.30, 0.0090)]
        else:
            modes = [(2080, 1.0, 0.0055), (3620, 0.45, 0.0030), (5850, 0.16, 0.0018), (715, 0.28, 0.0080)]
        L, R = modal_hit(rng, n, [(f, a, t * s) for f, a, t in modes], 3400 if variant == 1 else 3900,
                         0.0007, 0.55)
        L, R = svf(L, 9000, 0.6, "lp"), svf(R, 9000, 0.6, "lp")
        return reverb(L, R, rng, decay=0.25 * s, wet=0.06, predelay=0.004, bright=6000)
    return gen


def g_tick(rng, dur, key):
    s, n = dur / 0.04, ns(dur)
    L, R = modal_hit(rng, n, [(4100, 1.0, 0.0022 * s), (6650, 0.40, 0.0014 * s), (1250, 0.16, 0.0040 * s)],
                     6500, 0.0004, 0.45)
    return svf(L, 12000, 0.6, "lp"), svf(R, 12000, 0.6, "lp")


def g_pop(variant):
    def gen(rng, dur, key):
        s, n = dur / 0.16, ns(dur)
        f0, f1 = (540.0, 760.0) if variant == 1 else (640.0, 900.0)
        glide = 0.014 * s
        freqs = [f1 - (f1 - f0) * math.exp(-i / (glide * SR)) for i in range(n)]
        body = glide_tone(freqs, ((1, 1.0), (2, 0.16), (3, 0.04)))
        na, d = int(0.0012 * SR), math.exp(-1.0 / ((0.020 if variant == 1 else 0.018) * s * SR))
        e = 1.0
        for i in range(n):
            body[i] *= (i / na if i < na else 1.0) * e
            e *= d
        puff = svf(burst(rng, n, 0.003, 1800, 0.5), 2500, 0.7, "lp")
        mono = fade(add_at(body, puff, 0, 0.35), 0.0, 0.02)
        return reverb(list(mono), list(mono), rng, decay=0.35 * s, wet=0.10, predelay=0.006, bright=5000)
    return gen


def soft_clip(x, drive):
    k = math.tanh(drive)
    return [math.tanh(drive * v) / k for v in x]


def g_impact(rng, dur, key):
    """Sub drop + crack: one pitched sub gliding 152 -> 42 Hz with a fast-then-slow decay (one oscillator,
    so nothing beats), a 190/330 Hz thump that small speakers can reproduce, low-mid noise body, a 1 ms
    snap and a band-passed crack, light saturation, and a dark room tail. The attack is the loudest
    10 ms, so the anchor sits on the crack."""
    s = dur / 2.0
    n = ns(1.8 * s)
    t = [i / SR for i in range(n)]
    # Cosine-phase starts put the first crest at t = 0 (a 1.5 ms ramp keeps it click-free), so the
    # attack, not a later low crest, is the loudest 10 ms and the anchor lands on the crack.
    sub = glide_tone([42.0 + 110.0 * math.exp(-x / 0.035) for x in t], ((1, 1.0), (2, 0.08)), math.pi / 2)
    body = svf(white(rng, n), 420, 0.7, "lp")
    ts, tb = 0.5 * s, 0.08 * s
    thump = add_at(mode_tone(n, 190.0, 0.07 * s, 0.5, 0.0015, math.pi / 2),
                   mode_tone(n, 330.0, 0.04 * s, 0.25, 0.0015, math.pi / 2))
    for i in range(ns(0.0015)):
        sub[i] *= i / ns(0.0015)
    low = soft_clip([u * (0.65 * math.exp(-x / 0.018) + 0.35 * math.exp(-x / ts)) + 0.9 * b * math.exp(-x / tb)
                     for u, b, x in zip(sub, body, t)], 1.3)
    # Thump and crack stay outside the saturation so the attack keeps its edge over the sub's plateau.
    core = fade(add_at(low, thump), 0.0, 0.35 * s)
    snap = hp1(burst(rng, n, 0.0009, 5000, 0.5), 1500)
    L = add_at(list(core), snap, 0, 0.8)
    R = add_at(list(core), snap, 0, 0.8)
    add_at(L, burst(rng, n, 0.014 * s, 2800, 0.9), 0, 0.6)
    add_at(R, burst(rng, n, 0.014 * s, 2800, 0.9), 0, 0.6)
    # Round off the first millisecond's spikes (as a designer would clip a hit): the peak-to-loudness
    # ratio drops a few dB, so a mastered mix needs less limiting, and the attack stays the loudest part.
    pk = max(max(map(abs, L)), max(map(abs, R)))
    L, R = soft_clip(scale(L, 1.0 / pk), 2.2), soft_clip(scale(R, 1.0 / pk), 2.2)
    return reverb(L, R, rng, decay=1.6 * s, wet=0.22, predelay=0.003, bright=4000, dark=0.15)


def g_thud(rng, dur, key):
    """Muffled weight: a short pitched body 120 -> 52 Hz, a soft wooden knock, low-passed noise; no crack."""
    s, n = dur / 0.7, ns(dur * 0.8)
    t = [i / SR for i in range(n)]
    body = glide_tone([52.0 + 68.0 * math.exp(-x / 0.022) for x in t])
    knock = add_at(mode_tone(n, 165, 0.05 * s, 0.35), mode_tone(n, 395, 0.02 * s, 0.16))
    muff = svf(burst(rng, n, 0.035 * s, 160, 0.5), 250, 0.7, "lp")
    core = [b * math.exp(-x / (0.11 * s)) + k + 1.2 * m for b, k, m, x in zip(body, knock, muff, t)]
    core = fade(soft_clip(core, 1.3), 0.0, 0.12 * s)
    return reverb(list(core), list(core), rng, decay=0.45 * s, wet=0.12, predelay=0.008, bright=2500)


# ------------------------------------------------------------------ generators: air, builds, light
def arch(n, peak):
    """0 -> 1 -> 0 over n samples with the top at fraction `peak`, rounded at the top (sine-shaped)."""
    pk = max(1, min(n - 2, int(peak * n)))
    return [math.sin(0.5 * math.pi * (i / pk if i < pk else (n - 1 - i) / (n - 1 - pk))) for i in range(n)]


def balance(L, R, p):
    """Pan a stereo pair by a per-sample position p in [-1, 1]; unity at centre."""
    r2 = math.sqrt(2.0)
    return ([v * r2 * math.cos((q + 1.0) * math.pi / 4.0) for v, q in zip(L, p)],
            [v * r2 * math.sin((q + 1.0) * math.pi / 4.0) for v, q in zip(R, p)])


def comb_sweep(x, delays, amount):
    """y = x + amount * x(t - d(t)) with a fractional, per-sample delay in seconds: the moving notches of a
    passing object (the 'jet pass' colour of a fast whoosh)."""
    out = list(x)
    for i in range(len(x)):
        d = delays[i] * SR
        j = i - d
        k = int(j)
        if k >= 1:
            f = j - k
            out[i] += amount * (x[k] * (1.0 - f) + x[k + 1] * f)
    return out


def whoosh(rng, dur, peak=0.58, lo=280.0, hi=4200.0, q=1.2, comb=0.3, width=0.5, body=0.35,
           rise=2.0, fall=1.6, top=14000.0, floor=110.0, rev=(0.7, 0.18)):
    """Air moving past: pink noise through a band-pass whose centre rides the motion (lo -> hi at the
    peak -> lo), a low-mid body band (180-900 Hz, never sub rumble), an optional sweeping comb, a
    left-to-right pass, a high-pass at `floor` and a low-pass at `top`, and a little room."""
    n = ns(dur)
    a = arch(n, peak)
    pk = int(peak * n)
    env = [x ** (rise if i < pk else fall) for i, x in enumerate(a)]
    fc = [lo * (hi / lo) ** (x ** 0.8) for x in a]
    common = pink(rng, n)
    body_band = svf(common, [min(900.0, max(180.0, 0.3 * f)) for f in fc], 0.8, "bp")
    chans = []
    for _ in range(2):
        own = pink(rng, n)
        src = [0.8 * c + 0.45 * o for c, o in zip(common, own)]
        band = svf(src, fc, q, "bp")
        if comb:
            band = comb_sweep(band, [0.00035 + 0.0022 * (1.0 - x) for x in a], comb)
        sig = [(v + body * w) * e for v, w, e in zip(band, body_band, env)]
        sig = svf(svf(sig, floor, 0.7, "hp"), top, 0.7, "lp")
        chans.append(sig)
    # Fly-by: left before the peak, straight ahead at the peak (closest and loudest), right after.
    span = max(peak, 1.0 - peak)
    L, R = balance(chans[0], chans[1], [width * math.sin(0.5 * math.pi * max(-1.0, min(1.0, (i / (n - 1) - peak) / span)))
                                        for i in range(n)])
    return reverb(L, R, rng, decay=rev[0], wet=rev[1], predelay=0.01, bright=6000)


def g_whoosh(rng, dur, key):
    return whoosh(rng, dur)


def g_whoosh_long(rng, dur, key):
    return whoosh(rng, dur, peak=0.62, lo=170.0, hi=3200.0, q=1.0, comb=0.25, width=0.7, body=0.5,
                  rise=1.8, fall=1.4, top=10000.0, floor=80.0, rev=(1.2, 0.22))


def g_swoosh_soft(rng, dur, key):
    return whoosh(rng, dur, peak=0.55, lo=300.0, hi=1500.0, q=0.9, comb=0.0, width=0.25, body=0.3,
                  rise=1.6, fall=1.4, top=4500.0, floor=120.0, rev=(0.6, 0.15))


def g_riser(rng, dur, key):
    """Tension build that ends on the hit: a noise band opening 260 Hz -> 7 kHz, a detuned tone gliding
    up an octave and a fifth, a pulse accelerating from 3 to 18 Hz, widening stereo; the last sample is
    the anchor (an 8 ms fade lets the hit cut it off cleanly)."""
    n = ns(dur)
    u = [i / n for i in range(n)]
    fc = [260.0 * (7000.0 / 260.0) ** (x ** 1.25) for x in u]
    common = white(rng, n)
    chans = []
    for side in (0, 1):
        own = white(rng, n)
        w = [0.3 + 0.5 * x for x in u]  # decorrelate more as it rises: the image widens
        src = [c * (1.0 - k) + o * k for c, o, k in zip(common, own, w)]
        band = svf(src, fc, 1.4, "bp")
        det = 1.0 + (0.004 if side else -0.004)
        tone = glide_tone([110.0 * det * 3.0 ** (x ** 1.4) for x in u],
                          ((1, 1.0), (2, 0.45), (3, 0.28), (4, 0.15), (5, 0.09), (6, 0.05)))
        tone = svf(tone, [500.0 * 12.0 ** x for x in u], 0.8, "lp")
        chans.append(svf([0.8 * b + 0.32 * t for b, t in zip(band, tone)], 11000, 0.7, "lp"))
    ph, out = 0.0, ([0.0] * n, [0.0] * n)
    for i, x in enumerate(u):
        ph += TAU * (3.0 + 15.0 * x * x) / SR
        g = (0.03 + x ** 2.2) * (1.0 - 0.5 * x * (0.5 + 0.5 * math.cos(ph)))
        out[0][i] = chans[0][i] * g
        out[1][i] = chans[1][i] * g
    L, R = reverb(out[0], out[1], rng, decay=0.9, wet=0.22, predelay=0.012, bright=8000)
    return fade(L[:n], 0.0, 0.008), fade(R[:n], 0.0, 0.008)


def g_swell(rng, dur, key):
    """Soft crescendo into a reveal: an open sus2 chord brightening as it grows, a reversed-cymbal air
    layer, crest at 80% of the length, then a short release into the room."""
    crest = ns(0.8 * dur)
    rel = 0.18 * dur / 2.4
    n = crest + ns(7 * rel)
    env = [(i / crest) ** 2.6 if i < crest else math.exp(-(i - crest) / (rel * SR)) for i in range(n)]
    notes = [146.83, 220.0, 293.66, 329.63]
    dark = ((1, 1.0), (2, 0.2))
    bright = ((1, 1.0), (2, 0.5), (3, 0.33), (4, 0.25), (5, 0.18), (6, 0.12))
    # One centred chord: detuned copies per channel would beat in opposite phase (D3's 2nd harmonic
    # against D4) and tip the crest to one side. Width comes from the per-channel air and the room.
    d, b = [0.0] * n, [0.0] * n
    for j, f in enumerate(notes):
        fdet = f * (1.0 + (0.0025 if j % 2 else -0.0025))
        ph = [rng.uniform(0, TAU) for _ in range(6)]
        add_at(d, tone_tiled(fdet, n, dark, ph[:2], amp=1.0 - 0.15 * j))
        add_at(b, tone_tiled(fdet, n, bright, ph, amp=1.0 - 0.15 * j))
    chord = [(dv * (1.0 - e ** 0.7) + bv * e ** 0.7) * e * 0.25 for dv, bv, e in zip(d, b, env)]
    chans = []
    for side in (0, 1):
        air = svf(white(rng, n), 5000, 0.7, "hp")
        chans.append(fade([c + 0.35 * a * e ** 1.6 for c, a, e in zip(chord, air, env)], 0.0, 0.05))
    return reverb(chans[0], chans[1], rng, decay=1.4, wet=0.3, predelay=0.015, bright=7000)


def g_shimmer(rng, dur, key):
    """Glint of light: a breathy air band sweeping 4 -> 10 kHz plus five quick glass tings (pentatonic,
    ascending, with inharmonic overtones) spread across the stereo field, in a bright room. The first
    ting is the loudest moment, so the anchor sits at the start of the glint."""
    s, n = dur / 1.8, ns(dur * 0.8)
    t = [i / SR for i in range(n)]
    L, R = [0.0] * n, [0.0] * n
    sweep = [4000.0 * 2.5 ** min(1.0, x / (0.4 * s)) for x in t]
    for ch in (L, R):
        air = svf(white(rng, n), sweep, 0.8, "bp")
        add_at(ch, [v * min(1.0, x / 0.01) * math.exp(-x / (0.2 * s)) for v, x in zip(air, t)], 0, 0.4)
    notes = [2349.32, 2637.02, 2959.96, 3520.0, 3951.07]
    for j, f in enumerate(notes):
        at = ns((0.0, 0.045, 0.1, 0.165, 0.24)[j] * s)
        m = n - at
        ting = mode_tone(m, f, 0.25 * s, 1.0, 0.001)
        add_at(ting, mode_tone(m, f * 2.756, 0.1 * s, 0.3, 0.001))
        if f * 5.404 < 18000:
            add_at(ting, mode_tone(m, f * 5.404, 0.04 * s, 0.12, 0.001))
        # Left/right tings come in level-matched pairs so the glint stays centred at any --dur.
        tl, tr = pan_mono(ting, (0.0, -0.45, 0.45, -0.35, 0.35)[j])
        lv = (1.0, 0.56, 0.56, 0.4, 0.4)[j]
        add_at(L, tl, at, 0.32 * lv)
        add_at(R, tr, at, 0.32 * lv)
    return reverb(fade(L, 0, 0.1), fade(R, 0, 0.1), rng, decay=1.6 * s, wet=0.35, predelay=0.02,
                  bright=9000, dark=0.3)


def g_glitch(rng, dur, key):
    """Digital stutter: a run of hard-gated 12-45 ms fragments (bit-crushed tone, sample-and-hold noise, a
    falling zap, a repeated slice) panned alternately; the first fragment is the loudest and centred, so
    the anchor is its start."""
    n = ns(dur)
    L, R = [0.0] * n, [0.0] * n
    at, k, prev = 0, 0, None
    while at < n - ns(0.02):
        m = min(n - at, ns(rng.uniform(0.012, 0.045)))
        kind = ("crush", "hold", "zap", "repeat")[k % 4 if k < 4 else rng.randrange(4)]
        if kind == "repeat" and prev:
            sn = prev[:max(8, ns(0.006))]
            frag = (sn * (m // len(sn) + 1))[:m]
        elif kind == "crush":
            f, bits, hold = rng.uniform(400, 2400), rng.choice((3, 4, 5)), rng.choice((4, 6, 9))
            q = 2 ** (bits - 1)
            frag = [round(math.sin(TAU * f * (i - i % hold) / SR) * q) / q for i in range(m)]
        elif kind == "hold":
            hold, v, frag = rng.choice((8, 12, 24, 40)), 0.0, []
            for i in range(m):
                if i % hold == 0:
                    v = rng.uniform(-1, 1)
                frag.append(v)
        else:
            f0, f1, ph, frag = rng.uniform(2500, 4000), rng.uniform(150, 400), 0.0, []
            for i in range(m):
                ph += TAU * (f0 * (f1 / f0) ** (i / m)) / SR
                frag.append(1.0 if math.sin(ph) >= 0 else -1.0)
        frag = fade(frag, 0.0008, 0.0008)
        lv = 1.0 if k == 0 else rng.uniform(0.35, 0.75)
        fl, fr = pan_mono(frag, (0.55 if k % 2 else -0.55) if k else 0.0)
        add_at(L, fl, at, lv)
        add_at(R, fr, at, lv)
        prev = frag
        at += m + (0 if rng.random() < 0.4 else ns(rng.uniform(0.004, 0.02)))
        k += 1
    L, R = (svf(svf(x, 150, 0.7, "hp"), 9000, 0.7, "lp") for x in (L, R))
    return reverb(L, R, rng, decay=0.3, wet=0.08, predelay=0.005, bright=6000)


def keystroke(rng, L, R, at, space=False, level=1.0, pan=0.0, pitch=None, weight=0.55):
    """One key: a plastic key-down (modes + noise tick), the bottom-out a few ms later at `weight`, a soft
    key-up. pitch scales the modes (default: a random 0.94-1.06)."""
    v = rng.uniform(0.94, 1.06) if pitch is None else pitch
    if space:
        modes = [(1300 * v, 0.8, 0.006), (2350 * v, 0.4, 0.004), (230 * v, 0.9, 0.022), (520 * v, 0.4, 0.012)]
    else:
        modes = [(2300 * v, 1.0, 0.004), (3700 * v, 0.45, 0.0025), (5400 * v, 0.18, 0.0015), (430 * v, 0.5, 0.012)]
    n = ns(0.06)
    down = modal_hit(rng, n, modes, 3200 * v, 0.0005, 0.6)
    bottom = modal_hit(rng, n, [(f * 0.8, a * 0.5, t * 0.7) for f, a, t in modes], 2400, 0.0004, 0.4)
    up = modal_hit(rng, n, [(f * 1.15, a * 0.3, t * 0.6) for f, a, t in modes], 4200, 0.0003, 0.25)
    gl, gr = math.cos((pan + 1) * math.pi / 4) * 1.414, math.sin((pan + 1) * math.pi / 4) * 1.414
    for snd, off, g in ((down, 0, 1.0), (bottom, ns(rng.uniform(0.006, 0.009)), weight),
                        (up, ns(rng.uniform(0.055, 0.095)), 0.3 if not space else 0.45)):
        add_at(L, snd[0], at + off, g * level * gl)
        add_at(R, snd[1], at + off, g * level * gr)


def g_type_keys(rng, dur, key):
    """A typing run on its own clock: key-strokes about 8.5 per second with human jitter, an occasional
    lower space bar and a short pause after it, slightly varied level, pitch, and position. The first
    key-down (the anchor) is at the file start and the last on --dur; the file goes on 0.15 s for its
    release. It does not follow the glyphs on screen: for typing the viewer watches, place key-1..3 at
    the glyph times on a times layer (mix.py)."""
    n = ns(dur + 0.15)
    L, R = [0.0] * n, [0.0] * n
    sched, t, k = [], 0.0, 0
    while not sched or sched[-1][0] <= dur:  # ends with the first key past --dur
        space = k > 2 and rng.random() < 0.16
        level = 1.0 if k == 0 else 10 ** (rng.uniform(-2.5, 0.5) / 20)
        sched.append((t, space, level, rng.uniform(-0.25, 0.25)))
        t += min(0.2, max(0.06, rng.gauss(0.105, 0.028))) + (0.07 if space else 0.0)
        k += 1
    # Land the last key on --dur: stretch to the last key before it or squeeze in the one past it,
    # whichever changes the run's tempo less.
    before, after = sched[-2][0], sched[-1][0]
    if before > 0 and dur / before - 1 <= 1 - dur / after:
        sched.pop()
    f = dur / sched[-1][0]
    for t, space, level, pan in sched:
        keystroke(rng, L, R, ns(t * f), space, level, pan)
    L, R = svf(L, 10000, 0.7, "lp"), svf(R, 10000, 0.7, "lp")
    L, R = reverb(L, R, rng, decay=0.35, wet=0.1, predelay=0.006, bright=5000)
    return fade(L[:n], 0.0, 0.03), fade(R[:n], 0.0, 0.03)


# pitch, space-bar modes, bottom-out weight per take
KEY_TAKES = {"1": (1.0, False, 0.55), "2": (1.05, False, 0.55), "3": (0.955, False, 0.55),
             "space": (1.0, True, 0.55), "enter": (1.12, True, 0.9)}


def g_key(take):
    """One keystroke, for a times layer that types along with the glyphs on screen: three letter takes a
    few percent apart in pitch, the lower space bar, and a Return with a heavier bottom-out."""
    pitch, space, weight = KEY_TAKES[take]

    def gen(rng, dur, key):
        n = ns(dur)
        L, R = [0.0] * n, [0.0] * n
        keystroke(rng, L, R, 0, space, 1.0, 0.0, pitch, weight)
        L, R = svf(L, 10000, 0.7, "lp"), svf(R, 10000, 0.7, "lp")
        return reverb(L, R, rng, decay=0.35, wet=0.1, predelay=0.006, bright=5000)
    return gen


# ------------------------------------------------------------------ generator: ambient bed
NOTE_PC = {"C": 0, "C#": 1, "DB": 1, "D": 2, "D#": 3, "EB": 3, "E": 4, "F": 5, "F#": 6, "GB": 6,
           "G": 7, "G#": 8, "AB": 8, "A": 9, "A#": 10, "BB": 10, "B": 11}
# Semitones from the tonic: major I(add9) vi7 IVmaj7 Vsus4; minor i(add9) VImaj7 IIImaj7 VII.
PROGRESSIONS = {False: ((0, 7, 14, 16), (-3, 4, 7, 12), (-7, 0, 4, 9), (-5, 2, 7, 12)),
                True: ((0, 7, 14, 15), (-4, 3, 7, 12), (3, 10, 14, 19), (-2, 5, 10, 14))}


def parse_key(key):
    k = (key or "D").strip()
    minor = len(k) > 1 and k.endswith("m")
    pc = NOTE_PC.get((k[:-1] if minor else k).upper())
    if pc is None:
        die(f"unknown key {key!r}; use a note name with an optional m, e.g. C, F#, Bb, Am, C#m")
    return pc, minor


def g_bed(rng, dur, key):
    """Quiet ambient pad for under picture: four slow chords in the key (6 s each, 3 s crossfades),
    each note two slightly detuned voices per channel (slow beating, natural width), a timbre that
    brightens and darkens over 17 s, a soft sub an octave under the root, and a long dark room.
    No drums, no melody: it sits under SFX and voice."""
    pc, minor = parse_key(key)
    root = 43 + (pc - 7) % 12  # tonic between G2 and F#3
    n = ns(dur)
    T, X = 6.0, 3.0
    dark = ((1, 1.0), (2, 0.18), (3, 0.05))
    bright = ((1, 1.0), (2, 0.42), (3, 0.25), (4, 0.14), (5, 0.09), (6, 0.05), (7, 0.03))
    L, R = [0.0] * n, [0.0] * n
    k = 0
    while k * T < dur:
        a, b = max(0, ns(k * T - X / 2)), min(n, ns((k + 1) * T + X / 2))
        m = b - a
        rin = ns(1.5) if k == 0 else min(m, ns(X))
        rout = 0 if (k + 1) * T + X / 2 >= dur else min(m, ns(X))
        env = [1.0] * m
        for i in range(rin):
            env[i] = 0.5 - 0.5 * math.cos(math.pi * i / rin)
        for i in range(rout):
            env[m - 1 - i] = 0.5 - 0.5 * math.cos(math.pi * i / rout)
        bri = [0.5 - 0.5 * math.cos(TAU * (a + i) / (17.0 * SR)) for i in range(m)]
        trem = [0.55 + 0.45 * math.sin(TAU * (a + i) / (9.0 * SR) + k) for i in range(m)]
        chord = PROGRESSIONS[minor][k % 4]
        f_bass = 440.0 * 2 ** ((root + chord[0] - 12 - 69) / 12)
        f_top = 440.0 * 2 ** ((root + chord[-1] + 12 - 69) / 12)
        for side, out in ((0, L), (1, R)):
            dsum, bsum = [0.0] * m, [0.0] * m
            for j, semi in enumerate(chord):
                f = 440.0 * 2 ** ((root + semi - 69) / 12)
                lv = (0.75, 0.8, 0.7, 0.62)[j]
                for cents in ((-3.0, 2.0) if side == 0 else (-2.0, 3.0)):
                    fd = f * 2 ** ((cents + rng.uniform(-0.6, 0.6)) / 1200)
                    ph = [rng.uniform(0, TAU) for _ in range(7)]
                    add_at(dsum, tone_tiled(fd, m, dark, ph[:3], amp=lv))
                    add_at(bsum, tone_tiled(fd, m, bright, ph, amp=lv))
            add_at(dsum, tone_tiled(f_bass, m, ((1, 1.0),), amp=0.3))
            top = tone_tiled(f_top * (1.0 + (0.001 if side else -0.001)), m, ((1, 1.0), (2, 0.1)), amp=0.22)
            add_at(out, [(dv + (bv - dv) * w + tv * q) * e
                         for dv, bv, tv, w, q, e in zip(dsum, bsum, top, bri, trem, env)], a)
        k += 1
    L, R = reverb(L, R, rng, decay=3.5, wet=0.5, predelay=0.03, bright=5000, dark=0.2)
    return tuple(fade(svf(x[:n], 50, 0.7, "hp"), 0.0, 0.05) for x in (L, R))


def g_room(rng, dur, key):
    """Room tone, the air an effects-only film sits on instead of a pad: seeded pink noise band-limited to
    80 Hz-5 kHz, nearly mono (each side is a shared noise plus 0.3 of its own, correlation about 0.9, so a
    phone's mono fold keeps it), its level wandering slowly within +/-1 dB. Loopable: the last sample runs on
    into the first (the overrun crossfades into the head at equal power, and the wander repeats once per file),
    so mix.py can repeat it under a film of any length."""
    n, warm = ns(dur), ns(0.25)
    x = min(ns(0.5), n // 4)
    common = pink(rng, warm + n + x)
    chans = []
    for _ in range(2):
        side = [c + 0.3 * o for c, o in zip(common, pink(rng, len(common)))]
        s = svf(svf(side, 80.0, 0.707, "hp"), 5000.0, 0.707, "lp")[warm:]
        for i in range(x):
            u = 0.5 * math.pi * i / x
            s[i] = s[i] * math.sin(u) + s[n + i] * math.cos(u)
        chans.append(s[:n])
    # The wander: three slow sines with whole cycles per file, one level per 10 ms block.
    blk, ph = ns(0.01), [rng.uniform(0.0, TAU) for _ in range(3)]
    nb = -(-n // blk)
    w = [sum(math.sin(TAU * c * b / nb + p) / c for c, p in zip((1, 2, 3), ph)) for b in range(nb)]
    top = max(map(abs, w)) or 1.0
    env = [g for v in w for g in [10 ** (v / top / 20)] * blk][:n]
    return mul(chans[0], env), mul(chans[1], env)


# ------------------------------------------------------------------ registry and CLI
def entry(gen, dur, anchor, tags, use, loop=False):
    return {"gen": gen, "dur": dur, "anchor": anchor, "tags": tags, "use": use, "loop": loop}


SOUNDS = {
    "click-1": entry(g_click(1), 0.06, "peak", ["ui", "click"],
                     "Soft UI click: a 1 ms noise tick on small plastic-like resonances (0.6/1.9/3.3/5.2 kHz), "
                     "~40 ms decay, faint room. Button presses, toggles, cursor clicks; alternate with click-2."),
    "click-2": entry(g_click(2), 0.06, "peak", ["ui", "click"],
                     "click-1's sibling with resonances ~12% higher; alternate the two in rapid series."),
    "tick": entry(g_tick, 0.04, "peak", ["ui", "counter"],
                  "Tiny high tick (4.1/6.6 kHz, ~15 ms): counters, step indicators, clock-like progress; "
                  "lighter than a click."),
    "pop-1": entry(g_pop(1), 0.16, "peak", ["ui", "appear"],
                   "Short rounded pop: a tone gliding up 540->760 Hz in ~15 ms with a soft puff, ~0.1 s decay. "
                   "Dots, badges, small elements appearing; alternate with pop-2."),
    "pop-2": entry(g_pop(2), 0.16, "peak", ["ui", "appear"],
                   "pop-1's sibling a step higher (640->900 Hz); alternate the two in bursts."),
    "whoosh": entry(g_whoosh, 0.7, "peak", ["transition", "motion"],
                    "Fast air pass: a noise band rising to ~4 kHz and falling, travelling left to right. Whip "
                    "pans, quick wipes, fast slides; the cut goes on its anchor (its loudest moment)."),
    "whoosh-long": entry(g_whoosh_long, 1.6, "peak", ["transition", "motion"],
                         "Slower, heavier pass (peak ~3 kHz) with more low-mid body and a wider left-to-right "
                         "travel. Big camera moves, pull-backs, large reveals."),
    "swoosh-soft": entry(g_swoosh_soft, 0.9, "peak", ["transition", "soft"],
                         "Gentle, breathy swoosh, energy 150 Hz-3 kHz with little top end. Calm transitions, "
                         "camera pushes, cards sliding in."),
    "impact": entry(g_impact, 2.0, "peak", ["hit", "impact"],
                    "Deep hit: crack in the first ms, a sub glide 152->42 Hz, a 190/330 Hz thump, a ~1.5 s boom "
                    "into a dark room. The biggest landing or title hit, a few per film at most; phone speakers "
                    "reproduce only the crack and thump."),
    "thud": entry(g_thud, 0.7, "peak", ["hit", "soft"],
                  "Muffled weight without a crack: objects landing, cards stacking, soft downbeats."),
    "riser": entry(g_riser, 2.5, "end", ["build", "tension"],
                   "Tension build that ends at its last sample: a noise band opening to 7 kHz, a tone gliding up "
                   "an octave and a fifth, a pulse accelerating 3->18 Hz. Put its end on the hit, usually with "
                   "an impact; scale with --dur."),
    "shimmer": entry(g_shimmer, 1.8, "peak", ["light", "sparkle"],
                     "Glint: a breathy 4-10 kHz air band plus five quick glass tings, bright room tail. Light "
                     "sweeps, a sheen across a logo, success moments; once per film is plenty."),
    "glitch": entry(g_glitch, 0.42, "start", ["digital", "transition"],
                    "Digital stutter: bit-crushed tones, sample-and-hold noise, falling zaps, repeats; harsh by "
                    "design. Glitch transitions and error states only, mixed low."),
    "type-keys": entry(g_type_keys, 1.6, "start", ["foley", "typing"],
                       "Typing run on its own clock, ~8.5 keys per second with human jitter and an occasional "
                       "space bar; keys run to --dur (make --dur), anchor = first key. It does not follow the "
                       "screen: use it for typing the viewer cannot see or follow, key-1..3 for typing they watch."),
    "key-1": entry(g_key("1"), 0.2, "peak", ["foley", "typing"],
                   "One keystroke (key-down, bottom-out, key-up, ~0.15 s). One per typed glyph on a mix.py times "
                   "layer at the page's glyph times; cycle key-1, key-2, key-3 on letters."),
    "key-2": entry(g_key("2"), 0.2, "peak", ["foley", "typing"],
                   "key-1 about 5% higher; cycle it with key-1 and key-3."),
    "key-3": entry(g_key("3"), 0.2, "peak", ["foley", "typing"],
                   "key-1 about 4.5% lower; cycle it with key-1 and key-2."),
    "key-space": entry(g_key("space"), 0.2, "peak", ["foley", "typing"],
                       "The space bar: lower and longer than the letter keys; a times layer on the spaces' times."),
    "key-enter": entry(g_key("enter"), 0.25, "peak", ["foley", "typing"],
                       "Return: space-bar body with a heavier bottom-out. The key that runs a command: usually a "
                       "cue with its event, since it changes the state."),
    "swell": entry(g_swell, 2.4, "peak", ["build", "soft"],
                   "Soft crescendo on an open D-A-D-E chord with reversed-cymbal air; crests at 80% of --dur (the "
                   "anchor), then releases into a room tail. Calm reveals and gentle builds."),
    "bed": entry(g_bed, 30.0, "start", ["music", "ambient"],
                 "Quiet ambient pad: four slow chords in --key (default D; e.g. Am), warm and dark, no drums "
                 "or melody. Any length with --dur. A license-clean stand-in under SFX and voice, not a "
                 "substitute for composed music."),
    "room": entry(g_room, 20.0, "start", ["ambient", "room"],
                  "Room tone: quiet pink-noise air (80 Hz-5 kHz, nearly mono, a slow +/-1 dB wander), loopable. "
                  "mix.py lays it under every film with no music at the register's level, so cues never sit "
                  "on digital silence; no onsets, no pitch.", loop=True),
}


def synth(name, seed, dur, key):
    """One finished sound as (L, R), exactly as kit and make write it."""
    e = SOUNDS[name]
    rng = random.Random(f"{seed}:{name}")
    L, R = e["gen"](rng, dur or e["dur"], key)
    return finish(L, R, e["anchor"], e["loop"])


def render(name, seed, dur, key, path):
    """Synthesize one sound to path and return its kit.json entry."""
    e = SOUNDS[name]
    L, R = synth(name, seed, dur, key)
    write_wav24(path, L, R)
    d = len(L) / SR
    anchor = {"peak": rms_peak_time(L, R), "end": d, "start": 0.0}[e["anchor"]]
    integ, m_max, tp = loudness(path)
    peak = max(max(map(abs, L)), max(map(abs, R)))
    return {"file": os.path.basename(path), "duration": round(d, 6), "anchor": round(anchor, 6),
            "anchor_kind": e["anchor"], "peak_dbfs": round(20 * math.log10(peak), 2), "true_peak_dbtp": tp,
            "lufs": integ if d >= 0.4 else None, "lufs_m_max": m_max, "tags": e["tags"], "use": e["use"]}


def check_ffmpeg():
    if not shutil.which(FFMPEG):
        die("ffmpeg not found on PATH (install it, e.g. `brew install ffmpeg` or `apt install ffmpeg`)", 3)


def cmd_kit(a):
    check_ffmpeg()
    os.makedirs(a.outdir, exist_ok=True)
    sounds = {}
    for name in SOUNDS:
        dur = a.bed_dur if name == "bed" else None
        sounds[name] = render(name, a.seed, dur, a.key, os.path.join(a.outdir, name + ".wav"))
        s = sounds[name]
        print(f"{name:12s} {s['duration']:7.3f}s  anchor {s['anchor_kind']:5s} {s['anchor']:7.4f}s  "
              f"TP {s['true_peak_dbtp']:+5.1f} dBTP  M max {s['lufs_m_max']} LUFS")
    kit = {"sample_rate": SR, "seed": a.seed, "key": a.key, "generator": "sfx.py", "sounds": sounds}
    with open(os.path.join(a.outdir, "kit.json"), "w") as fh:
        json.dump(kit, fh, indent=2)
        fh.write("\n")
    print(f"wrote {len(sounds)} sounds and {os.path.join(a.outdir, 'kit.json')}")
    return 0


def cmd_make(a):
    check_ffmpeg()
    if a.name not in SOUNDS:
        die(f"unknown sound {a.name!r}; run `sfx.py list`")
    if a.dur is not None and not 0.02 <= a.dur <= 600:
        die("--dur must be between 0.02 and 600 seconds")
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    print(json.dumps(render(a.name, a.seed, a.dur, a.key, a.out)))
    return 0


def cmd_list(a):
    check_ffmpeg()
    print("lengths of the files `sfx.py kit` writes (seed 1, tails included; other seeds differ by up to "
          "~0.2 s; make --dur changes them)")
    for name, e in SOUNDS.items():
        # The bed ends on a 50 ms fade and room tone is a loop, so finish() keeps every sample: each file is
        # exactly its --dur (the bed's --bed-dur) long, and synthesizing it only to measure that would take seconds.
        d = e["dur"] if name in ("bed", "room") else len(synth(name, 1, None, "D")[0]) / SR
        print(f"{name:12s} {d:6.3f}s  anchor={e['anchor']:5s} {e['use']}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="sfx.py", description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog="examples:\n  sfx.py kit sound/kit\n  sfx.py make riser --dur 3.2 -o sound/riser-3.2.wav\n"
                                        "  sfx.py make bed --dur 42 --key Am -o sound/bed.wav")
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("kit", help="write every sound plus kit.json into OUTDIR")
    k.add_argument("outdir")
    k.add_argument("--seed", type=int, default=1, help="variation seed (default 1)")
    k.add_argument("--key", default="D", help="key of the bed, e.g. D, Bb, F#m (default D)")
    k.add_argument("--bed-dur", type=float, default=30.0, help="bed length in seconds (default 30)")
    m = sub.add_parser("make", help="write one sound; prints its kit.json entry")
    m.add_argument("name")
    m.add_argument("-o", "--out", required=True, help="output WAV path")
    m.add_argument("--dur", type=float, help="length in seconds (sweeps, builds, typing, bed stretch; "
                                             "hits scale their decay)")
    m.add_argument("--seed", type=int, default=1, help="variation seed (default 1)")
    m.add_argument("--key", default="D", help="key for bed, e.g. D, Bb, F#m (default D)")
    sub.add_parser("list", help="list the sounds with the file length kit writes, anchor kind, and use")
    a = ap.parse_args(argv)
    if a.cmd == "kit" and not 1.0 <= a.bed_dur <= 600:
        die("--bed-dur must be between 1 and 600 seconds")
    if a.cmd in ("kit", "make"):
        parse_key(a.key)
    return {"kit": cmd_kit, "make": cmd_make, "list": cmd_list}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
