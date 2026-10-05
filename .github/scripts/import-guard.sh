#!/usr/bin/env bash
# Assert that every name this app imports from react-native-vision-camera
# actually exists in the installed version of that package.
#
# Why this exists: ScanQrScreen imported `useCodeScanner`, which is a
# VisionCamera 4 API. This project is on 5.x, which does not export it, so the
# import resolved to undefined and calling it as a hook at mount threw
# "is not a function" - the app died the instant the scanner opened, on a real
# phone, after five CI runs had gone green. TypeScript would have caught that
# import; this repo has no typecheck gate. This guards the exact class of failure
# that actually shipped, and does not pretend to be a typechecker.
#
# Deliberately narrow: it checks named imports from one package, because that is
# where the real bug was.
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/../.." && pwd)}"
PKG="$ROOT/mobile/node_modules/react-native-vision-camera"

if [ ! -d "$PKG" ]; then
  echo "import guard: react-native-vision-camera is not installed; nothing to check"
  exit 0
fi

echo "import guard: checking named imports from react-native-vision-camera"
echo "              installed version: $(node -p "require('$PKG/package.json').version" 2>/dev/null || echo unknown)"

names=$(grep -rhoE "import[[:space:]]*\{[^}]*\}[[:space:]]*from[[:space:]]*'react-native-vision-camera'" \
  "$ROOT/mobile/src" "$ROOT/mobile/AppV2.tsx" "$ROOT/mobile/App.tsx" 2>/dev/null \
  | sed -E "s/.*\{(.*)\}.*/\1/" | tr ',' '\n' | tr -d ' ' | sort -u | grep -v '^$' || true)

if [ -z "$names" ]; then
  echo "import guard: no named imports found; nothing to check"
  exit 0
fi

fail=0
while read -r name; do
  [ -z "$name" ] && continue
  if grep -rqE "\\b${name}\\b" "$PKG/src" "$PKG/lib" 2>/dev/null; then
    printf '  ok    %s\n' "$name"
  else
    printf '  MISSING  %s\n' "$name"
    fail=1
  fi
done <<< "$names"

if [ "$fail" -ne 0 ]; then
  echo
  echo "IMPORT GUARD FAILED: the code imports a name this version of"
  echo "react-native-vision-camera does not export. That resolves to undefined at"
  echo "runtime and throws as soon as the screen using it mounts."
  exit 1
fi

echo "import guard: every named import resolves"
