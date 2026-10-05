#!/usr/bin/env python3
"""Assert every name this app imports from react-native-vision-camera exists.

Why this exists: ScanQrScreen imported `useCodeScanner`, a VisionCamera 4 API.
This project is on 5.x, which does not export it, so the import resolved to
undefined and calling it as a hook at mount threw "is not a function" - the app
died the instant the scanner opened, on a real phone, after five green CI runs.

Two lessons are baked into this file.

1. The first version used grep -E, which is line-based, so it never matched a
   multi-line import block and reported "no named imports found; nothing to
   check". A guard that silently checks nothing is worse than no guard: it
   reports success for the exact failure it was written to catch. Imports are
   parsed across lines here, not per line.

2. It self-tests. It looks for a name that is known to be absent from this
   package and refuses to report success unless its own detection fires. If the
   scanning logic ever breaks again, this fails loudly instead of passing.

Deliberately narrow: named imports from one package, which is where the real bug
was. It is not a typechecker and does not pretend to be one.
"""

from __future__ import annotations

import json
import os
import re
import sys

# A name this package is known NOT to export. Used to prove the detection works.
KNOWN_ABSENT = "useCodeScanner"

SOURCES = ("src", "App.tsx", "AppV2.tsx")


def repo_root() -> str:
    if os.environ.get("GITHUB_WORKSPACE"):
        return os.environ["GITHUB_WORKSPACE"]
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def collect_imports(root: str) -> set[str]:
    """Named imports from react-native-vision-camera across the whole app.

    Matches across newlines, which the line-based version did not.
    """
    pattern = re.compile(
        r"import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['\"]react-native-vision-camera['\"]",
        re.DOTALL,
    )
    names: set[str] = set()
    mobile = os.path.join(root, "mobile")
    for target in SOURCES:
        path = os.path.join(mobile, target)
        if os.path.isdir(path):
            for dirpath, _dirs, files in os.walk(path):
                for fn in files:
                    if fn.endswith((".ts", ".tsx")):
                        names |= _names_in(os.path.join(dirpath, fn), pattern)
        elif os.path.isfile(path):
            names |= _names_in(path, pattern)
    return names


def _names_in(path: str, pattern: re.Pattern[str]) -> set[str]:
    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return set()
    out: set[str] = set()
    for block in pattern.findall(text):
        for part in block.split(","):
            # drop `as` aliases and whitespace; imports carry no types here
            name = part.strip().split(" as ")[0].strip()
            if name:
                out.add(name)
    return out


def main() -> int:
    root = repo_root()
    pkg = os.path.join(root, "mobile", "node_modules", "react-native-vision-camera")
    if not os.path.isdir(pkg):
        print("import guard: react-native-vision-camera not installed; skipping")
        return 0

    with open(os.path.join(pkg, "package.json"), encoding="utf-8") as fh:
        version = json.load(fh).get("version", "unknown")

    names = collect_imports(root)
    print("import guard: react-native-vision-camera imports")
    print(f"              installed version: {version}")

    if not names:
        print("import guard: FAILED - collected zero names from the app source.")
        print("              This check cannot verify anything, so it must not pass.")
        return 1

    # Search the package's shipped sources for each name.
    haystack = []
    for sub in ("src", "lib"):
        base = os.path.join(pkg, sub)
        for dirpath, _dirs, files in os.walk(base):
            for fn in files:
                if fn.endswith((".ts", ".tsx", ".js", ".d.ts")):
                    try:
                        with open(os.path.join(dirpath, fn), encoding="utf-8",
                                  errors="ignore") as fh:
                            haystack.append(fh.read())
                    except OSError:
                        pass
    blob = "\n".join(haystack)

    def exported(name: str) -> bool:
        return re.search(r"\b" + re.escape(name) + r"\b", blob) is not None

    missing = []
    for name in sorted(names):
        if exported(name):
            print(f"  ok       {name}")
        else:
            print(f"  MISSING  {name}")
            missing.append(name)

    # Prove the detection works before trusting a pass.
    if exported(KNOWN_ABSENT):
        print(f"import guard: SELF-TEST FAILED - '{KNOWN_ABSENT}' was reported as")
        print("              present, but it is known to be absent. The detection")
        print("              logic is broken, so a pass here would be meaningless.")
        return 1
    print(f"  self-test ok: '{KNOWN_ABSENT}' is correctly detected as absent")

    if missing:
        print()
        print("IMPORT GUARD FAILED: this version of react-native-vision-camera does")
        print("not export the name(s) above. They resolve to undefined at runtime and")
        print("throw as soon as the screen using them mounts.")
        return 1

    print("import guard: every named import resolves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
