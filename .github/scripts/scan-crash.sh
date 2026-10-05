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

# Tap a UI element located from a uiautomator dump rather than a guessed
# coordinate, matching the visible text EXACTLY and case-sensitively.
#
# The case sensitivity is the whole point. The first version matched
# case-insensitively, so "NEARBY" also matched the page heading "Nearby" in the
# content area, tapped dead space at y=303, never switched tabs, and reported
# "no crash" having never reached the scanner. The tab label is upper case; the
# heading is not. Match exactly and the collision disappears.
#
# It also takes an optional region, retries every candidate rather than only the
# first, and confirms the screen actually changed.
tap_text() {
  local want="$1" label="$2" where="${3:-any}"
  $ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  $ADB pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1
  if [ ! -s /tmp/ui.xml ]; then echo "  $label: no dump"; return 1; fi

  hits=$(python3 - "$want" "$where" <<'PY'
import re, sys, xml.etree.ElementTree as ET
want, where = sys.argv[1], sys.argv[2]
try:
    root = ET.parse('/tmp/ui.xml').getroot()
except Exception:
    sys.exit(0)
m0 = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', root.get('bounds') or '')
screen_h = int(m0.group(4)) if m0 else 2340
for n in root.iter('node'):
    text = (n.get('text') or '').strip()
    desc = (n.get('content-desc') or '').strip()
    if text != want and desc != want:
        continue
    m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds') or '')
    if not m:
        continue
    x1, y1, x2, y2 = map(int, m.groups())
    if x2 <= x1 or y2 <= y1:
        continue
    cy = (y1 + y2) // 2
    if where == 'bottom' and cy < screen_h * 0.85:
        continue
    print("%d %d" % ((x1 + x2) // 2, cy))
PY
)

  if [ -z "$hits" ]; then
    echo "  $label: no exact match for '$want'. What IS on screen:"
    python3 - <<'PY'
import xml.etree.ElementTree as ET
try:
    root = ET.parse('/tmp/ui.xml').getroot()
except Exception:
    raise SystemExit
seen = []
for n in root.iter('node'):
    t = (n.get('text') or '').strip()
    if t and (t.isupper() or len(t) > 3):
        seen.append(t)
print("     " + ' | '.join(dict.fromkeys(seen))[:400])
PY
    return 1
  fi

  local n=0
  while read -r x y; do
    [ -z "$x" ] && continue
    n=$((n+1))
    echo "  $label: tapping candidate $n at ($x,$y)"
    $ADB shell input tap "$x" "$y"
    sleep 3
    if [ "$want" = "NEARBY" ]; then
      $ADB shell uiautomator dump /sdcard/ui2.xml >/dev/null 2>&1
      $ADB pull /sdcard/ui2.xml /tmp/ui2.xml >/dev/null 2>&1
      if grep -aq 'SCAN QR CODE' /tmp/ui2.xml 2>/dev/null; then
        echo "    -> the Nearby screen is up"
        break
      fi
    fi
  done <<< "$hits"
  return 0
}

echo "== driving to the scanner =="
# A fresh install opens on first-boot onboarding ("FIRST BOOT / Create your
# local node"). In that state the tab bar has four tabs and no NEARBY tab at
# all, so the scanner is unreachable until a node identity exists. Create it the
# way a human would, then wait for the five-tab app.
if tap_text "CREATE NODE" "CREATE NODE button" || true; then
  echo "  node identity requested; waiting for the app to settle"
  sleep 25
fi

tap_text "NEARBY" "NEARBY tab" bottom || true
sleep 3
$ADB shell uiautomator dump /sdcard/ui3.xml >/dev/null 2>&1
$ADB pull /sdcard/ui3.xml /tmp/ui3.xml >/dev/null 2>&1
if grep -aq 'SCAN QR CODE' /tmp/ui3.xml 2>/dev/null; then
  echo "  scanner button is present"
else
  echo "  WARNING: scanner button absent - this run proves nothing about the crash"
  reached_scanner=no
fi
tap_text "SCAN QR CODE" "SCAN QR CODE button" || true

reached_scanner=${reached_scanner:-yes}
echo "== watching the process for 25s =="
died_at=""
for i in 5 10 15 20 25; do
  sleep 5
  if alive; then echo "  t+${i}s: alive"; else echo "  t+${i}s: DEAD"; died_at="$i"; break; fi
done

$ADB logcat -d > "$OUT" 2>/dev/null || true

echo
echo "== evidence =="
if [ "${reached_scanner:-yes}" = "no" ]; then
  echo "RESULT: INCONCLUSIVE - the scanner button was never reached, so this run says nothing"
elif [ -n "$died_at" ]; then
  echo "RESULT: CRASH REPRODUCED - process died about ${died_at}s after the scan button was tapped"
else
  echo "RESULT: NO CRASH - scanner opened and the process survived"
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
