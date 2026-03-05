#!/usr/bin/env python3
"""
Offline tuner for gesture signal smoothing / hysteresis.
Usage:
  python3 tools/signal_tuner.py --input pinch_series.csv
CSV format: frame,pinch_dist,resize_raw
"""

from __future__ import annotations
import argparse
import csv
from dataclasses import dataclass


def ema(prev: float | None, val: float, alpha: float) -> float:
    return val if prev is None else prev + alpha * (val - prev)


@dataclass
class Stats:
    pinch_toggles: int = 0
    mean_resize: float = 0.0
    samples: int = 0


def run(rows, alpha: float, pinch_on: float, pinch_off: float):
    pinch = False
    last_resize = None
    stats = Stats()

    for r in rows:
      d = float(r["pinch_dist"])
      resize = float(r["resize_raw"])

      if not pinch and d <= pinch_on:
          pinch = True
          stats.pinch_toggles += 1
      elif pinch and d >= pinch_off:
          pinch = False
          stats.pinch_toggles += 1

      smooth = ema(last_resize, resize, alpha)
      last_resize = smooth
      stats.samples += 1
      stats.mean_resize += smooth

    if stats.samples:
      stats.mean_resize /= stats.samples
    return stats


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--alpha", type=float, default=0.38)
    p.add_argument("--pinch-on", type=float, default=0.048)
    p.add_argument("--pinch-off", type=float, default=0.062)
    args = p.parse_args()

    with open(args.input, newline="", encoding="utf-8") as f:
      rows = list(csv.DictReader(f))

    stats = run(rows, args.alpha, args.pinch_on, args.pinch_off)
    print("Signal tuning summary")
    print(f"samples={stats.samples}")
    print(f"pinch_toggles={stats.pinch_toggles}")
    print(f"mean_resize={stats.mean_resize:.4f}")


if __name__ == "__main__":
    main()
