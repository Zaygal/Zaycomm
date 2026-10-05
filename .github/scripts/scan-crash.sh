#!/usr/bin/env bash
# Reproduce the "tap SCAN QR CODE -> app dies" crash and capture the exception.
#
# Why this exists: the scanner screen mounts three VisionCamera hooks
# (useCameraDevice, useCameraPermission, useCodeScanner) before any of its render
# guards run. If one of them throws, the app dies the instant the scanner opens -
# which is exactly the reported symptom. Guessing at the cause produced two wrong
# hypotheses already; this drives the real app to the real tap and prints the
# actual exception.
#
# It installs the APK artifact that is already built, so it reproduces against the
# exact binary that is failing on the device, and it pre-grants the camera
# permission so the permission dialog is not a variable.
#
# Outcome is written to the run summary. Exits 0 either way: a reproduction is a
# result, not a CI failure.
set -u

ADB="adb -s emulator-5554"
PKG="com.zaycomm.mobile"
APK="${1:?usage: scan-crash.sh /path/to/app-diagnostic.apk}"
OUT="scan-crash-logcat.txt"

echo "== waiting for device =="
$ADB wait-for-device
until [ "$($ADB shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
$ADB shell input keyevent 82 >/dev/null 2>&1 || true

echo "== installing $APK =="
$ADB install -r -g "$APK" 2>&1 | tail -3

echo "== pre-granting camera permission (removes the dialog as a variable) =="
$ADB shell pm grant "$PKG" android.permission.CAMERA 2>&1 | tail -1 || true

echo "== clearing logcat and launching =="
$ADB logcat -c 2>/dev/null || true
$ADB shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 20

alive() { $ADB shell pidof "$PKG" 2>/dev/null | tr -d '\r' | grep -q '[0-9]'; }

if ! alive; then
  echo "RESULT: APP DIED BEFORE THE SCANNER WAS REACHED"
  $ADB logcat -d > "$OUT" 2>/dev/null || true
  exit 0
fi
echo "app is up (pid $($ADB shell pidof $PKG | tr -d '\r'))"

# Tap a UI element by its visible text, located from a uiautomator dump rather
# than a guessed coordinate. Prints what it did so a failure is diagnosable.
tap_text() {
  local want="$1" label="$2"
  $ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  $ADB pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1
  if [ ! -s /tmp/ui.xml ]; then echo "  $label: no dump"; return 1; fi
  local xy
  xy=$(python3 - "$want" <<'PY'
import re, sys, xml.etree.ElementTree as ET
want = sys.argv[1].upper()
try:
    root = ET.parse('/tmp/ui.xml').getroot()
except Exception as e:
    print(""); sys.exit(0)
for n in root.iter('node'):
    hay = ((n.get('text') or '') + ' ' + (n.get('content-desc') or '')).upper()
    if want in hay:
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds') or '')
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            if x2 > x1 and y2 > y1:
                print(f"{(x1+x2)//2} {(y1+y2)//2}"); sys.exit(0)
print("")
PY
)
  if [ -z "$xy" ]; then echo "  $label: not on screen"; return 1; fi
  echo "  $label: tapping at $xy"
  $ADB shell input tap $xy
  return 0
}

echo "== driving to the scanner: NEARBY tab, then SCAN QR CODE =="
tap_text "NEARBY" "NEARBY tab" || true
sleep 4
tap_text "SCAN QR" "SCAN QR CODE button" || true

echo "== watching the process for 25s =="
died_at=""
for i in 5 10 15 20 25; do
  sleep 5
  if alive; then echo "  t+${i}s: alive"; else echo "  t+${i}s: DEAD"; died_at="$i"; break; fi
done

$ADB logcat -d > "$OUT" 2>/dev/null || true

echo
echo "== evidence =="
if [ -n "$died_at" ]; then
  echo "RESULT: CRASH REPRODUCED - process died about ${died_at}s after the scan button was tapped"
else
  echo "RESULT: NO CRASH in this run - process survived; the scanner may have opened. See 'SCAN QR' line above."
fi
echo
echo "--- fatal / exception lines ---"
grep -aE 'FATAL EXCEPTION|AndroidRuntime|UnsatisfiedLinkError|dlopen|Cannot read|undefined is not|TypeError|Error:|Exception|libVisionCamera|VisionCamera|NitroModules|abort' "$OUT" | head -40 || true
echo
echo "--- react-native / JS thread lines ---"
grep -aE 'ReactNativeJS|Hermes|Sentry|Zaycomm' "$OUT" | head -25 || true

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Scan-QR crash reproduction"
    echo
    if [ -n "$died_at" ]; then
      echo "**CRASH REPRODUCED** - died ~${died_at}s after tapping SCAN QR CODE."
    else
      echo "**NO CRASH** in this run (process survived)."
    fi
    echo
    echo '```'
    grep -aE 'FATAL EXCEPTION|AndroidRuntime|UnsatisfiedLinkError|dlopen|Cannot read|undefined is not|TypeError|libVisionCamera|VisionCamera|NitroModules|abort|ReactNativeJS' "$OUT" | head -30 || echo "(no matching lines)"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
fi
