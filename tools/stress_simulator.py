#!/usr/bin/env python3
"""
Synthetic stress simulator for gesture pipeline signals.
Generates noisy pinch/resize streams and reports jitter + toggle rates.
"""

from __future__ import annotations
import math
import random


def ema(prev, x, alpha):
    return x if prev is None else prev + alpha * (x - prev)


def run(frames=1800, alpha=0.38, pinch_on=0.048, pinch_off=0.062):
    pinch = False
    on_count = off_count = 0
    smooth_resize = None
    jitter_acc = 0.0
    prev = None

    for i in range(frames):
        t = i / 30.0
        # synthetic periodic signal + gaussian noise
        pinch_dist = 0.055 + 0.012 * math.sin(t * 2.4) + random.gauss(0, 0.004)
        resize_raw = 0.55 + 0.4 * math.sin(t * 1.4) + random.gauss(0, 0.08)
        resize_raw = max(0.0, min(1.0, resize_raw))

        if not pinch and pinch_dist <= pinch_on:
            pinch = True
            on_count += 1
        elif pinch and pinch_dist >= pinch_off:
            pinch = False
            off_count += 1

        smooth_resize = ema(smooth_resize, resize_raw, alpha)

        if prev is not None:
            jitter_acc += abs(smooth_resize - prev)
        prev = smooth_resize

    mean_jitter = jitter_acc / max(1, frames - 1)
    return {
        "frames": frames,
        "pinch_on_events": on_count,
        "pinch_off_events": off_count,
        "mean_smoothed_delta": round(mean_jitter, 6),
    }


if __name__ == "__main__":
    print(run())
