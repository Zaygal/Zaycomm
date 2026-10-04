#!/usr/bin/env sh
# Zaycomm startup-crash capture.
#
# Purpose: Sentry reported a crash in this build under environment
# "diagnostic-native", i.e. a native (not JS) failure. The Sentry event is
# behind a login we do not have, so this job reproduces the crash on a clean
# emulator and puts the evidence where it can actually be read: the job log and
# the step summary.
#
# Deliberate design choice: this job does NOT fail when the crash reproduces.
# A reproducing crash is the success condition. The verdict is printed, written
# to the run summary (readable in the GitHub mobile app without downloading an
# artifact) and the raw logcat is uploaded.
#
# Why a script file and not an inline `script:` block: the emulator action runs
# each LINE of an inline script in its own shell, so variables do not survive
# between lines and trailing backslashes are passed through literally. That
# cost this project's sibling repo three failed runs.

set -u

PKG=com.zaycomm.mobile
APK="$GITHUB_WORKSPACE/mobile/android/app/build/outputs/apk/diagnostic/app-diagnostic.apk"
WORK=/tmp/crash
mkdir -p "$WORK"
: > "$WORK/diag.txt"

echo "== installing $APK =="
ls -la "$APK"
if ! adb install -r "$APK" > "$WORK/install.txt" 2>&1; then
  echo "INSTALL FAILED"; cat "$WORK/install.txt"; exit 1
fi
grep -E "Success|Failure" "$WORK/install.txt" || true

echo "== clearing logcat =="
adb logcat -c

echo "== launching =="
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > "$WORK/launch.txt" 2>&1
tail -3 "$WORK/launch.txt" || true

# A startup crash kills the process within a couple of seconds, so the process
# is polled rather than slept through: the death moment is the signal.
echo "== watching the process =="
ALIVE=0
i=0
VERDICT="NO CRASH: still alive after 60s"
while [ "$i" -lt 12 ]; do
  i=$((i + 1))
  sleep 5
  if adb shell pidof "$PKG" > /dev/null 2>&1; then
    echo "  t+$((i * 5))s: alive"
    ALIVE=$((ALIVE + 1))
  else
    echo "  t+$((i * 5))s: process gone"
    if [ "$ALIVE" -gt 0 ]; then
      VERDICT="CRASH REPRODUCED: process started, then died at t+$((i * 5))s"
    else
      VERDICT="CRASH REPRODUCED: process never reached a live check (died within 5s)"
    fi
    break
  fi
done
echo "RESULT: $VERDICT"
echo "RESULT: $VERDICT" > "$WORK/verdict.txt"

echo "== dumping logcat =="
adb logcat -d > /tmp/logcat.txt
wc -l /tmp/logcat.txt

# Native failures announce themselves differently from Java ones: SIGSEGV /
# SIGABRT with a backtrace, a tombstone, or an abort message. Search for all of
# them plus anything Sentry or Hermes printed.
adb logcat -d > /dev/null 2>&1 || true
grep -nE "FATAL EXCEPTION|signal [0-9]+ \\(SIG|backtrace:|tombstone|Abort message|libhermes|libreactnativejni|libc  |Sentry|AndroidRuntime|ReactNativeJS" /tmp/logcat.txt > "$WORK/interesting.txt" 2>&1 || true
echo "== lines that matter: $(wc -l < "$WORK/interesting.txt") =="

FIRST=$(grep -nE "FATAL EXCEPTION|signal [0-9]+ \\(SIG|Abort message" /tmp/logcat.txt | head -1 | cut -d: -f1)
if [ -n "$FIRST" ]; then
  START=$((FIRST - 40))
  if [ "$START" -lt 1 ]; then START=1; fi
  END=$((FIRST + 120))
  sed -n "${START},${END}p" /tmp/logcat.txt > "$WORK/window.txt"
  echo "== crash window (lines $START-$END) =="
  cat "$WORK/window.txt"
else
  echo "== no FATAL/signal marker found; showing Sentry + JS lines =="
  grep -E "Sentry|ReactNativeJS|MWASCAFFOLD" /tmp/logcat.txt | tail -60 || true
fi

# The summary is the part that matters on a phone: readable in the GitHub app
# without downloading anything.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Zaycomm startup-crash capture"
    echo
    echo "**$VERDICT**"
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| package | \`$PKG\` |"
    echo "| logcat lines | $(wc -l < /tmp/logcat.txt) |"
    echo "| crash markers | $(wc -l < "$WORK/interesting.txt") |"
    echo
    if [ -n "$FIRST" ]; then
      echo '### Crash window'
      echo
      echo '```'
      cat "$WORK/window.txt"
      echo '```'
    else
      echo '### Sentry / JS lines'
      echo
      echo '```'
      grep -E "Sentry|ReactNativeJS" /tmp/logcat.txt | tail -40 || true
      echo '```'
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi

echo "== done (verdict above; raw log placed at /tmp/logcat.txt) =="
