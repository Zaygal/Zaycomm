#!/usr/bin/env sh
# Native ABI guard: prove every packaged native library can actually be loaded.
#
# Why this exists: Zaycomm shipped an APK that crashed on first launch with
#
#   UnsatisfiedLinkError: dlopen failed: cannot locate symbol
#   "__cxa_init_primary_exception" referenced by .../libNitroModules.so
#
# Nothing in the build caught it. The APK built, the bundle packed, the tests
# passed. The failure only appeared when Android tried to resolve the library's
# symbols at runtime. The cause was two toolchains in one APK: libNitroModules.so
# was compiled with clang 21 (whose libc++ exports __cxa_init_primary_exception)
# while the libc++_shared.so packaged alongside it came from clang 18 (which does
# not). This script checks that relationship directly.
#
# Method: for each packaged .so, collect its UNDEFINED C++ runtime symbols
# (__cxa_* / __gxx_*) and confirm each is DEFINED by the libc++_shared.so in the
# same ABI directory, or exported by the system loader (libc/libdl/libm/liblog,
# which Android always provides). Anything unresolved would fail dlopen on a
# device exactly as reported.
#
# Usage: sh abi-guard.sh <path-to.apk> [abi ...]

set -u

APK="$1"
if [ ! -f "$APK" ]; then
  echo "abi-guard: no APK at $APK"
  exit 2
fi

echo "== ABI guard: $(basename "$APK") =="
TMP=$(mktemp -d)
unzip -o -q "$APK" 'lib/*' -d "$TMP" 2>/dev/null || true

if [ ! -d "$TMP/lib" ]; then
  echo "no native libraries packaged; nothing to check"
  rm -rf "$TMP"
  exit 0
fi

# Android always provides these; a symbol resolved from them is fine.
SYS_RE='^(__cxa_atexit|__cxa_finalize|__android_log|__errno|malloc|free|dlopen|dlsym)$'

FAILED=0
for ABI_DIR in "$TMP"/lib/*/; do
  ABI=$(basename "$ABI_DIR")
  STL="$ABI_DIR/libc++_shared.so"
  if [ ! -f "$STL" ]; then
    echo "$ABI: WARNING no libc++_shared.so packaged"
    continue
  fi

  # Every dynamic symbol the packaged libc++ defines. @GLIBC-style version
  # suffixes are stripped so names compare by identity.
  readelf --dyn-syms --wide "$STL" 2>/dev/null \
    | awk '$7 != "UND" && $8 != "" {print $8}' \
    | sed 's/@.*//' | sort -u > "$TMP/defined.txt"

  echo "$ABI: libc++ exports $(wc -l < "$TMP/defined.txt") dynamic symbols"

  for LIB in "$ABI_DIR"*.so; do
    [ "$(basename "$LIB")" = "libc++_shared.so" ] && continue
    MISSING=""
    for SYM in $(readelf --dyn-syms --wide "$LIB" 2>/dev/null \
                   | awk '$7 == "UND" && ($8 ~ /^__cxa_/ || $8 ~ /^__gxx_/) {print $8}' \
                   | sed 's/@.*//' | sort -u); do
      echo "$SYM" | grep -qE "$SYS_RE" && continue
      grep -qx "$SYM" "$TMP/defined.txt" || MISSING="$MISSING $SYM"
    done
    if [ -n "$MISSING" ]; then
      echo "  FAIL $(basename "$LIB") needs symbols the packaged libc++ does not define:"
      for m in $MISSING; do echo "        $m"; done
      FAILED=1
    else
      echo "  ok   $(basename "$LIB")"
    fi
  done
done

rm -rf "$TMP"

if [ "$FAILED" -ne 0 ]; then
  echo
  echo "ABI GUARD FAILED: a packaged library needs C++ runtime symbols that"
  echo "Android will not resolve, so it will crash at dlopen on a device."
  echo "Typical cause: two toolchains in one APK. Pin android.ndkVersion in the"
  echo "root build.gradle ext so every native module, including ones compiled"
  echo "from source, resolves the same libc++."
  exit 1
fi
echo
echo "ABI GUARD PASSED: every native library resolves against the packaged libc++."
