#!/usr/bin/env python3
"""Generate a dark tech bed for the Fieldwork walkthrough (~30s)."""
import sys
from pathlib import Path

import numpy as np
import wave

sr = 44100
dur = 30.5
n = int(sr * dur)
t = np.arange(n) / sr
rng = np.random.default_rng(7)


def adsr(length, a=0.01, d=0.05, s=0.7, r=0.1):
    ea, ed, er = int(a * sr), int(d * sr), int(r * sr)
    es = max(0, length - ea - ed - er)
    parts = []
    if ea:
        parts.append(np.linspace(0, 1, ea, endpoint=False))
    if ed:
        parts.append(np.linspace(1, s, ed, endpoint=False))
    if es:
        parts.append(np.full(es, s))
    if er:
        parts.append(np.linspace(s, 0, er))
    e = np.concatenate(parts) if parts else np.zeros(0)
    if len(e) < length:
        e = np.pad(e, (0, length - len(e)))
    return e[:length]


out = np.zeros(n)
bpm = 92
beat = 60.0 / bpm

bassline = [55.0, 55.0, 58.27, 49.0, 55.0, 41.2, 46.25, 49.0]
for i, f0 in enumerate(bassline * 10):
    start = int(i * beat * sr)
    length = int(beat * 0.98 * sr)
    if start >= n:
        break
    length = min(length, n - start)
    tt = np.arange(length) / sr
    sig = np.zeros(length)
    for h in range(1, 8):
        sig += (1 / h) * np.sin(2 * np.pi * f0 * h * tt + 0.15 * np.sin(2 * np.pi * 3.1 * tt))
        sig += (0.7 / h) * np.sin(2 * np.pi * (f0 * 1.007) * h * tt)
    sig = np.tanh(sig * 1.8)
    k = 28
    sig = np.convolve(sig, np.ones(k) / k, mode="same")
    sig *= adsr(length, 0.008, 0.08, 0.75, 0.12) * 0.48
    out[start : start + length] += sig

for i in range(int(dur / beat)):
    start = int(i * beat * sr)
    length = int(0.22 * sr)
    if start + length > n:
        break
    tt = np.arange(length) / sr
    freq = 170 * np.exp(-tt * 32) + 38
    phase = np.cumsum(2 * np.pi * freq / sr)
    kick = np.sin(phase) * adsr(length, 0.001, 0.03, 0.35, 0.15)
    click = rng.normal(0, 1, length) * adsr(length, 0.0003, 0.002, 0.05, 0.01) * 0.25
    out[start : start + length] += np.tanh((kick + click) * 3.0) * 0.95

for i in range(int(dur / (beat * 2))):
    start = int((i * 2 * beat + beat) * sr)
    length = int(0.16 * sr)
    if start + length > n:
        break
    tt = np.arange(length) / sr
    body = np.sin(2 * np.pi * 180 * np.exp(-tt * 20) * tt) * adsr(length, 0.001, 0.02, 0.2, 0.1)
    noise = rng.normal(0, 1, length)
    noise = noise - np.convolve(noise, np.ones(25) / 25, mode="same")
    sn = body * 0.45 + noise * adsr(length, 0.001, 0.015, 0.25, 0.1) * 0.7
    out[start : start + length] += sn * 0.55

for i in range(int(dur / (beat / 4))):
    start = int(i * (beat / 4) * sr)
    length = int((0.04 if i % 2 == 0 else 0.07) * sr)
    if start + length > n:
        break
    hat = rng.normal(0, 1, length)
    hat = hat - np.convolve(hat, np.ones(8) / 8, mode="same")
    amp = 0.16 if i % 4 == 2 else (0.1 if i % 2 else 0.07)
    if i % 16 in (7, 15):
        amp *= 1.4
        length = min(int(0.12 * sr), n - start)
        hat = rng.normal(0, 1, length)
        hat = hat - np.convolve(hat, np.ones(6) / 6, mode="same")
    out[start : start + len(hat)] += hat * adsr(len(hat), 0.0004, 0.005, 0.2, 0.03) * amp

stab_notes = [220.0, 233.08, 174.61, 196.0]
for bi, f0 in enumerate(stab_notes):
    for rep in range(4):
        start = int((rep * 8 * beat + [0, 0.5, 4, 4.5][bi] * beat) * sr)
        length = int(0.28 * sr)
        if start < 0 or start + length > n:
            continue
        tt = np.arange(length) / sr
        stab = np.zeros(length)
        for h, a in [(1, 1), (2, 0.5), (3, 0.3), (5, 0.15)]:
            stab += a * np.sin(2 * np.pi * f0 * h * tt)
        stab = np.tanh(stab * 1.4) * adsr(length, 0.005, 0.06, 0.3, 0.15)
        out[start : start + length] += stab * 0.22

for i in range(int(dur / (beat * 8))):
    r0 = int((i * 8 * beat + 6 * beat) * sr)
    rl = int(2 * beat * sr)
    if r0 + rl > n:
        break
    tt = np.arange(rl) / sr
    noise = rng.normal(0, 1, rl)
    sweep = np.sin(2 * np.pi * (90 + 2400 * (tt / tt[-1]) ** 2.2) * tt)
    e = (tt / tt[-1]) ** 2.5
    out[r0 : r0 + rl] += (noise * 0.25 + sweep * 0.35) * e * 0.55
    i0 = int(i * 8 * beat * sr)
    il = int(0.55 * sr)
    if i0 + il > n:
        continue
    tt = np.arange(il) / sr
    boom = np.sin(np.cumsum(2 * np.pi * (70 * np.exp(-tt * 8) + 28) / sr)) * adsr(
        il, 0.002, 0.05, 0.4, 0.35
    )
    crash = rng.normal(0, 1, il) * adsr(il, 0.001, 0.05, 0.3, 0.4)
    out[i0 : i0 + il] += boom * 0.9 + crash * 0.35

for f, amp in [(110, 0.15), (164.81, 0.1), (220, 0.08), (277.18, 0.06)]:
    pad = np.sin(2 * np.pi * f * t + 0.3 * np.sin(2 * np.pi * 0.05 * t))
    pad += 0.3 * np.sin(2 * np.pi * f * 2 * t)
    pump = 0.35 + 0.65 * (0.5 + 0.5 * np.cos(2 * np.pi * t / beat))
    out += pad * pump * amp * 0.35

out = np.tanh(out * 1.15)
fi = int(0.35 * sr)
fo = int(1.8 * sr)
out[:fi] *= np.linspace(0, 1, fi)
out[-fo:] *= np.linspace(1, 0, fo)
out = out / (np.max(np.abs(out)) or 1) * 0.94
L = out
R = out * 0.97 + np.roll(out, 280) * 0.05
stereo = np.clip(np.stack([L, R], 1), -1, 1)
pcm = (stereo * 32767.0).astype(np.int16)

path = Path(sys.argv[1] if len(sys.argv) > 1 else "public/videos/audio/fieldwork-badass.wav")
path.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(path), "w") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes(pcm.tobytes())
print(path)
