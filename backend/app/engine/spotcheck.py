"""Spot check of auto-approved items (section 8.6)."""
from __future__ import annotations

import math
import random


def size(k: int, fraction: float = 0.20, minimum: int = 2) -> int:
    if k <= 0:
        return 0
    return min(k, max(minimum, math.ceil(fraction * k)))


def pick(item_ids: list[str], seed: int, fraction: float = 0.20, minimum: int = 2) -> list[str]:
    ids = sorted(item_ids, key=lambda s: (len(s), s))
    n = size(len(ids), fraction, minimum)
    return sorted(random.Random(seed).sample(ids, n), key=lambda s: (len(s), s))
