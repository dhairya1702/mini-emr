#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


ASSIGNMENT = re.compile(r"^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=.*$")


def invalid_lines(path: Path) -> list[int]:
    if not path.exists():
        return []
    invalid: list[int] = []
    for number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if not ASSIGNMENT.match(line):
            invalid.append(number)
    return invalid


def main(arguments: list[str]) -> int:
    failed = False
    for raw_path in arguments:
        path = Path(raw_path)
        lines = invalid_lines(path)
        if lines:
            failed = True
            print(f"{path}: invalid dotenv syntax on line(s) {', '.join(map(str, lines))}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
