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
# Print what is on screen, always, and keep the dump as an artifact. Without
# this the only record of a failed run is a logcat, and a harness that cannot
# show you the screen cannot be debugged - which is exactly how four runs got
# spent reporting "scanner button absent" without ever revealing why.
peek() {
  local label="$1" tag="${2:-ui}"
  $ADB shell uiautomator dump /sdcard/peek.xml >/dev/null 2>&1
  $ADB pull /sdcard/peek.xml "dump-$tag.xml" >/dev/null 2>&1
  if [ ! -s "dump-$tag.xml" ]; then echo "  [$label] no dump available"; return 0; fi
  echo "  [$label] on screen:"
  python3 - "dump-$tag.xml" <<'PY'
import sys, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    raise SystemExit
seen = []
for n in root.iter('node'):
    t = (n.get('text') or '').strip() or (n.get('content-desc') or '').strip()
    if t and n.get('bounds'):
        seen.append(t)
print("     " + ' | '.join(dict.fromkeys(seen))[:600])
PY
}

tap_text() {
  local want="$1" label="$2" where="${3:-any}"
  $ADB shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  $ADB pull /sdcard/ui.xml "dump-tap-$label.xml" >/dev/null 2>&1
  if [ ! -s "dump-tap-$label.xml" ]; then echo "  $label: no dump"; return 1; fi

  # The real screen height, not an assumed one. The fallback of 2340 was TALLER
  # than this emulator's screen, so the bottom-region test rejected every tab
  # candidate and reported that NEARBY did not exist - while the dump plainly
  # showed 'NEARBY' in the tab bar on screen. A filter that hides the thing you
  # are looking for is worse than no filter.
  local real_h
  real_h=$($ADB shell wm size 2>/dev/null | sed -n 's/.*: *[0-9]*x\([0-9]*\).*/\1/p' | tr -d '\r')
  [ -z "$real_h" ] && real_h=2340

  hits=$(python3 - "$want" "$where" "$real_h" <<'PY'
import re, sys, xml.etree.ElementTree as ET
want, where, real_h = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    root = ET.parse('/tmp/ui.xml').getroot()
except Exception:
    sys.exit(0)
m0 = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', root.get('bounds') or '')
screen_h = real_h or (int(m0.group(4)) if m0 else 2340)
for n in root.iter('node'):
    text = (n.get('text') or '').strip()
    desc = (n.get('content-desc') or '').strip()
    # Case-sensitive SUBSTRING. Equality failed on 'CREATE NODE' and 'NEARBY'
    # that the dump showed on screen: a node's text carries more than the label.
    # Case sensitivity is the part that matters - it is what stops 'NEARBY' from
    # matching the content heading 'Nearby', which is the bug that sent an
    # earlier version of this script tapping dead space.
    if want not in text and want not in desc:
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
#
# Whether that tap matched is now reported. It used to be `|| true` inside an
# `if`, so the "node identity requested" line printed either way and read like
# evidence when it was not.
peek "at launch" launch
if tap_text "CREATE NODE" "CREATE NODE button"; then
  echo "  node identity requested; waiting for the app to settle"
  sleep 25
  peek "after create node" after-create
else
  echo "  no CREATE NODE button - the app is already past onboarding"
  peek "after create node" after-create
fi

if tap_text "NEARBY" "NEARBY tab" bottom; then
  echo "  NEARBY tab tapped"
else
  echo "  NEARBY tab not found"
fi
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

echo
echo "== how the process died: crash or kill? =="
# Sentry reports crashes. It cannot report a process the system kills: a SIGKILL
# leaves no exception and no tombstone, so there is nothing for an SDK to send.
# 'Even Sentry isn't catching it' is therefore evidence, not an absence of
# evidence - and this separates the two cases explicitly instead of inferring.
# Scoped to our own package. The first version matched any `ActivityManager:
# Killing` line, which is the emulator reaping unrelated apps (chrome,
# setupwizard, onetimeinitializer) - it reported KILLED on a run where the crash
# was never even reached. A classifier that fires on other apps is not evidence.
if grep -aqE "Killing [0-9]+:${PKG}|lowmemorykiller.*${PKG}|lmkd.*${PKG}|ANR in ${PKG}|Force stopping ${PKG}" "$OUT"; then
  echo "  KILLED: the system ended OUR process. Sentry could not have reported this."
  grep -aE "Killing [0-9]+:${PKG}|lowmemorykiller.*${PKG}|lmkd.*${PKG}|ANR in ${PKG}|Force stopping ${PKG}" "$OUT" | head -6
elif grep -aqE "FATAL EXCEPTION|am_crash|signal 11|signal 6|SIGSEGV|SIGABRT|abort message|libc *: Fatal signal" "$OUT"; then
  echo "  CRASHED: a real fault was recorded. Sentry should have caught this."
  grep -aE 'FATAL EXCEPTION|am_crash|signal 11|signal 6|SIGSEGV|SIGABRT|abort message|libc *: Fatal signal' "$OUT" | head -8
else
  echo "  INDETERMINATE: no kill and no fault line in this log."
fi
echo
echo "== anything at all from our package =="
grep -aiE 'zaycomm' "$OUT" | grep -avE 'Installing|installed|PackageManager|Downloading|Created app' | tail -15

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
