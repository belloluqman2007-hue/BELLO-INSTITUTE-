#!/usr/bin/env python3
"""
EduSphere promo — original underscore & SFX, synthesized with numpy.

A warm, premium product-film score:
  A  0-15    The challenge     — warm minor pad, no percussion
  B  15-53   EduSphere arrives — pad + soft pluck arpeggio + sub bass
  C  53-128  Feature journey   — full groove: pad, arp, bass, soft ticks
  D  128-166 Community/schools — pad + arp settle, gentle swells
  E  166-end Finale            — full stack, uplifting resolve (C major lift)

All audio is generated from oscillators/noise — original, licence-clean.
"""
import os, sys
import numpy as np

VENV = "/home/user/video-tools/venv/bin/python"
OUT = "/home/user/video-tools/assets/audio"
os.makedirs(OUT, exist_ok=True)

sr = 44100
DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 182.0
N = int(DUR * sr)
t = np.arange(N) / sr

def adsr_env(t0, dur, a=0.01, d=0.05, s=0.7, r=0.2, n=N):
    """Vectorised ADSR-ish envelope (trapezoid)."""
    e = np.zeros(n)
    i0 = int(t0 * sr); i1 = min(n, int((t0 + dur) * sr))
    if i1 <= i0:
        return e
    seg = np.arange(i1 - i0) / sr
    env = np.minimum(1.0, seg / max(a, 1e-4))
    rel_start = dur - r
    tail = np.clip((dur - seg) / max(r, 1e-4), 0.0, 1.0)
    env = np.minimum(env, tail)
    e[i0:i1] = env * s
    return e

def sine(f, phase=0.0):
    return np.sin(2 * np.pi * f * t + phase)

def vibrato_sine(f, depth=0.10, rate=4.8):
    return np.sin(2 * np.pi * f * t + depth * np.sin(2 * np.pi * rate * t))

# ------------- harmonic plan -------------
CHORDS = {
    "Am": ([110.0, 261.63, 329.63, 440.0], 55.0),
    "F":  ([174.61, 440.0, 261.63, 349.23], 43.65),
    "C":  ([261.63, 329.63, 392.0, 523.25], 65.41),
    "G":  ([196.0, 246.94, 293.66, 392.0], 49.0),
}
names = (["Am", "F", "C", "G"] * 8 + ["Am", "F", "C", "C"])
seq = []
tt = 0.0
for nm in names:
    seq.append((nm, tt, 4.0)); tt += 4.0
    if tt > DUR + 4: break

# ------------- PAD (throughout) -------------
pad = np.zeros(N)
for nm, t0, ln in seq:
    freqs, _ = CHORDS[nm]
    env = adsr_env(t0, ln + 0.4, a=1.6, r=1.9, s=0.9)
    for f in freqs:
        pad += (np.sin(2 * np.pi * f * 0.9985 * t + 0.4 * np.sin(2 * np.pi * 0.13 * t))
                + np.sin(2 * np.pi * f * 1.0015 * t)) * 0.055 * env
pad = np.tanh(pad * 1.2) * 0.8

# ------------- ARP pluck (from 15s) -------------
arp = np.zeros(N)
scale = [220.0, 261.63, 329.63, 440.0, 523.25, 659.26]
ti, k, step = 15.0, 0, 0.5
while ti < DUR - 2.0:
    f = scale[(k * 2 + (k // 4)) % len(scale)]
    if (k // 8) % 4 == 3:
        f = scale[(k * 3 + 1) % len(scale)]
    i0 = int(ti * sr); i1 = min(N, int((ti + 0.5) * sr))
    if i1 > i0:
        seg = np.arange(i1 - i0) / sr
        pluck = (np.sin(2 * np.pi * f * seg) + 0.3 * np.sin(4 * np.pi * f * seg)) \
            * np.exp(-seg * 9.0) * np.minimum(1.0, seg / 0.006)
        # gentle stereo-ish detune for width
        arp[i0:i1] += pluck * 0.20
    ti += step; k += 1

# ------------- SUB BASS (from 25s) -------------
bass = np.zeros(N)
for nm, t0, ln in seq:
    t0b = max(t0, 25.0)
    lnb = (t0 + ln) - t0b
    if lnb <= 0 or t0b >= DUR - 1.5:
        continue
    _, bf = CHORDS[nm]
    env = adsr_env(t0b, lnb + 0.25, a=0.30, r=0.9)
    bass += sine(bf) * 0.42 * env

# ------------- TICKS (soft shaker 53→128s) -------------
ticks = np.zeros(N)
rng = np.random.default_rng(7)
tt, alt = 53.0, 0
while tt < min(128.0, DUR - 2):
    i0 = int(tt * sr); ln = int(0.05 * sr)
    i1 = min(N, i0 + ln)
    if i1 > i0:
        seg = np.arange(i1 - i0) / sr
        noise = rng.standard_normal(i1 - i0)
        # approximate high-shelf: differentiate
        noise = np.diff(np.concatenate([[0.0], noise])) * 0.5
        g = 0.055 if alt else 0.032
        ticks[i0:i1] += noise * np.exp(-seg * 60) * g * 100
    tt += 0.25; alt = 1 - alt

# ------------- SWELLS -------------
swell = np.zeros(N)
def add_swell(t0, dur, peak):
    global swell
    i0 = int(t0 * sr); i1 = min(N, int((t0 + dur) * sr))
    if i1 <= i0: return
    seg = np.arange(i1 - i0) / sr
    env = (seg / dur) ** 2
    env *= np.clip((dur - seg) / (dur * 0.25), 0, 1)
    acc = np.zeros(i1 - i0)
    for f in (261.63, 329.63, 392.0, 523.25):
        acc += np.sin(2 * np.pi * f * seg) * 0.25
    swell[i0:i1] += acc * env * peak / 4
add_swell(13.5, 4.0, 0.35)
add_swell(50.0, 4.5, 0.30)
add_swell(126.0, 5.0, 0.35)
add_swell(DUR - 16.0, 6.0, 0.5)

# ------------- FINALE lift (last 12s: C major resolve) -------------
fin = np.zeros(N)
fin_t = DUR - 12.0
for f in (261.63, 329.63, 392.0, 523.25, 659.26):
    env = adsr_env(fin_t, 12.0, a=2.4, r=4.5)
    fin += sine(f) * 0.11 * env
fin += bass * 0  # placeholder (bass continues underneath)

# ------------- section gating -------------
gate = np.ones(N)
def dip(t0, t1, level, w=1.5):
    i0, i1 = int(t0 * sr), min(N, int(t1 * sr))
    if i1 <= i0: return
    seg = np.ones(i1 - i0) * level
    wseg = int(w * sr)
    seg[:wseg] = np.linspace(1.0, level, wseg)
    seg[-wseg:] = np.linspace(level, 1.0, wseg)
    gate[i0:i1] = seg

mix = pad * 0.9 + arp * 0.8 + bass + ticks * 0.9 + swell + fin * 1.1
# soft-clip + normalize to -1.5 dBFS
mix = np.tanh(mix * 1.05)
mix *= 0.8414 / max(1e-6, np.max(np.abs(mix)))

# subtle stereo width: Haas-ish 6ms delay R with slight LP
dly = int(0.006 * sr)
right = np.concatenate([np.zeros(dly), mix[:-dly]])
left = mix
stereo = np.stack([left, right], axis=1)

def write_wav(path, data):
    import wave
    q = np.clip(data, -1.0, 1.0)
    q16 = (q * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes(q16.tobytes())

write_wav(f"{OUT}/music.wav", stereo)
print("music.wav ok", f"{DUR:.1f}s")

# ------------- SFX -------------
def sfx_chime():
    L = int(2.4 * sr); ts = np.arange(L) / sr
    a = np.sin(2 * np.pi * 659.26 * ts) * np.exp(-6.5 * ts)
    i = int(0.16 * sr)
    b = np.zeros(L); seg = ts[:L - i]
    b[i:] = np.sin(2 * np.pi * 987.77 * seg) * np.exp(-7.5 * seg)
    return np.stack([a + b * 0.8] * 2, 1) * app_env(L)[:, None] * 0.5

def app_env(L):
    e = np.ones(L)
    r = int(0.4 * sr)
    e[-r:] = np.linspace(1, 0, r)
    return e

def sfx_whoosh():
    L = int(1.4 * sr); ts = np.arange(L) / sr
    n = np.random.default_rng(3).standard_normal(L)
    # simple low-pass via cumulative smoothing
    kern = np.ones(24) / 24
    n = np.convolve(n, kern, mode="same")
    env = np.minimum(1, ts / 0.45) * np.clip((1.4 - ts) / 0.6, 0, 1)
    m = n / np.max(np.abs(n)) * env * 0.32
    return np.stack([m] * 2, 1)

def sfx_rise():
    L = int(1.8 * sr); ts = np.arange(L) / sr
    n = np.random.default_rng(9).standard_normal(L)
    kern = np.ones(32) / 32
    n = np.convolve(n, kern, mode="same")
    env = (ts / 1.8) ** 2
    m = n / np.max(np.abs(n)) * env * 0.36
    return np.stack([m] * 2, 1)

def sfx_click():
    L = int(0.28 * sr); ts = np.arange(L) / sr
    m = np.sin(2 * np.pi * 1180 * ts) * np.exp(-40 * ts) * 0.5
    return np.stack([m] * 2, 1)

write_wav(f"{OUT}/sfx-chime.wav", sfx_chime())
write_wav(f"{OUT}/sfx-whoosh.wav", sfx_whoosh())
write_wav(f"{OUT}/sfx-rise.wav", sfx_rise())
write_wav(f"{OUT}/sfx-click.wav", sfx_click())
print("sfx ok")
