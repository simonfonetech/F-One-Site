"""Summarise systematic computed-style differences from visual_audit.py."""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


REPORT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("output/visual-audit/report.json")
DATA = json.loads(REPORT.read_text(encoding="utf-8"))
STYLE_KEYS = (
    "color",
    "backgroundColor",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "display",
    "alignItems",
    "justifyContent",
    "gap",
    "margin",
    "padding",
    "borderRadius",
)


def pair_elements(left: list[dict], right: list[dict]):
    right_by_signature: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for element in right:
        right_by_signature[(element["tag"], element["text"])].append(element)
    seen: Counter[tuple[str, str]] = Counter()
    for element in left:
        signature = (element["tag"], element["text"])
        index = seen[signature]
        seen[signature] += 1
        matches = right_by_signature[signature]
        if index < len(matches):
            yield element, matches[index]


def compact(value):
    if isinstance(value, list):
        return "/".join(value)
    return value


for viewport in ("desktop", "mobile"):
    for page in ("home", "about", "phones", "connectivity", "blog"):
        live = DATA[f"live-{page}-{viewport}"]
        local = DATA[f"local-{page}-{viewport}"]
        print(f"\n## {page} / {viewport}")
        print(
            "document:",
            f"{live['document']['width']}x{live['document']['height']}",
            "->",
            f"{local['document']['width']}x{local['document']['height']}",
        )
        for label in ("body", "header"):
            if not live[label] or not local[label]:
                continue
            changed = [
                f"{key}={compact(live[label][key])}->{compact(local[label][key])}"
                for key in STYLE_KEYS
                if live[label][key] != local[label][key]
            ]
            if changed:
                print(f"{label}: " + "; ".join(changed))

        pairs = list(pair_elements(live["content"], local["content"]))
        print(f"matched content: {len(pairs)}/{len(live['content'])}/{len(local['content'])}")
        for key in STYLE_KEYS:
            differences = Counter(
                (str(compact(left[key])), str(compact(right[key])))
                for left, right in pairs
                if left[key] != right[key]
            )
            if differences:
                common = ", ".join(
                    f"{before}->{after} ({count})"
                    for (before, after), count in differences.most_common(4)
                )
                print(f"  {key}: {common}")

        button_pairs = list(pair_elements(live["buttons"], local["buttons"]))
        for left, right in button_pairs:
            changed = [
                f"{key} {compact(left[key])}->{compact(right[key])}"
                for key in STYLE_KEYS
                if left[key] != right[key]
            ]
            if changed:
                print(f"  button {left['text'][:45]!r}: " + "; ".join(changed))

        print("carousels:", len(live["carousels"]), "->", len(local["carousels"]))
        for index, (left, right) in enumerate(zip(live["carousels"], local["carousels"]), 1):
            print(
                f"  {index}: rect {left['rect']} -> {right['rect']}; "
                f"children {left['children']}->{right['children']}; "
                f"class {left['className']!r}->{right['className']!r}"
            )
