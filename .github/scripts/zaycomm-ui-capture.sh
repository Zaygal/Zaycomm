#!/usr/bin/env bash
set -euo pipefail

OUT="$GITHUB_WORKSPACE/film/raw/zaycomm-ui"
mkdir -p "$OUT"

adb wait-for-device
adb shell settings put system screen_off_timeout 600000 || true
adb shell input keyevent KEYCODE_WAKEUP || true
adb shell input keyevent KEYCODE_HOME
sleep 1
adb shell am start -n com.zaycomm.mobile/.MainActivity
sleep 8

tap_text() {
  local needle="$1"
  local xml="/tmp/window.xml"
  adb shell uiautomator dump "$xml" >/dev/null 2>&1 || true
  adb shell cat "$xml" > /tmp/window-local.xml 2>/dev/null || true
  python3 - "$needle" /tmp/window-local.xml <<'PY'
import re,sys,html,subprocess
needle=sys.argv[1]
xml=open(sys.argv[2],encoding="utf-8",errors="ignore").read()
m=re.search(r'text="([^"]*'+re.escape(needle)+r'[^"]*)".*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',xml)
if not m:
    raise SystemExit(2)
x1,y1,x2,y2=map(int,m.groups()[1:])
print((x1+x2)//2,(y1+y2)//2)
PY
}

tap_text_optional() {
  local needle="$1" coords
  if coords="$(tap_text "$needle" 2>/dev/null)"; then
    read -r x y <<<"$coords"
    adb shell input tap "$x" "$y"
    sleep 2
    return 0
  fi
  return 1
}

capture() {
  local name="$1"
  adb exec-out screencap -p > "$OUT/$name.png"
}

capture "01-launch"

# First boot: create the real local node if this emulator starts fresh.
if coords="$(tap_text "CREATE NODE" 2>/dev/null)"; then
  read -r x y <<<"$coords"
  adb shell input tap "$x" "$y"
  sleep 3
  capture "02-home"
else
  capture "02-home"
fi

# Capture each real tab using the text exposed by the actual React Native UI.
for tab in "Chats" "Pair" "Nearby" "Settings"; do
  if tap_text_optional "$tab"; then
    capture "tab-$(echo "$tab" | tr '[:upper:]' '[:lower:]')"
  fi
done

# Record a short real-UI walkthrough. No synthetic frames are added.
adb shell screenrecord --time-limit 35 --bit-rate 8000000 /sdcard/zaycomm-ui.mp4 &
REC_PID=$!
sleep 2
for tab in "Home" "Pair" "Nearby" "Chats" "Settings"; do
  tap_text_optional "$tab" || true
  sleep 3
done
sleep 2
kill "$REC_PID" 2>/dev/null || true
wait "$REC_PID" 2>/dev/null || true
adb pull /sdcard/zaycomm-ui.mp4 "$OUT/zaycomm-ui-real.mp4"

# Preserve evidence about the capture environment.
adb shell getprop ro.build.version.release > "$OUT/android-version.txt"
adb shell wm size > "$OUT/display-size.txt"
adb shell pm path com.zaycomm.mobile > "$OUT/package-path.txt"

test -s "$OUT/zaycomm-ui-real.mp4"
test -s "$OUT/01-launch.png"
test -s "$OUT/02-home.png"

echo "Real Zaycomm UI capture complete:"
ls -lh "$OUT"
