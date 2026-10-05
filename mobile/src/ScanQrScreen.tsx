// mobile/src/ScanQrScreen.tsx
// Nearby -> Scan QR Code.
//
// The scanner lives here, in the Nearby flow, not in Pair. Pair only ever
// displays this device's own code.
//
// The screen owns exactly one job: turn a camera frame into a payload string
// and hand it up. It does not decode, validate or authenticate anything, and
// it does not decide whether a peer is trusted. Once a code is captured the
// camera is torn down immediately so the user is never stranded on a live
// viewfinder while authentication runs.

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Camera,
  isScannedCode,
  useCameraDevice,
  useCameraPermission,
  useObjectOutput,
} from 'react-native-vision-camera';
import type { PeerAuthStage } from './peerAuth';

export interface ScanQrResult {
  ok: boolean;
  stage: PeerAuthStage;
  code?: string;
  message?: string;
  nodeId?: string;
}

interface Palette {
  bg: string;
  surface: string;
  border: string;
  ink: string;
  dim: string;
  signal: string;
  success: string;
  warning: string;
  red: string;
}

interface Props {
  c: Palette;
  stage: PeerAuthStage;
  result: ScanQrResult | null;
  onCaptured: (raw: string) => void;
  onClose: () => void;
  onRetry: () => void;
}

const STAGE_LABEL: Record<PeerAuthStage, string> = {
  idle: 'SCANNER READY',
  scanning: 'POINT AT A ZAYCOMM CODE',
  captured: 'CODE CAPTURED',
  validating: 'VALIDATING IDENTITY',
  authenticating: 'AUTHENTICATING DEVICE',
  verified: 'AUTHENTICATED',
  failed: 'NOT AUTHENTICATED',
};

export default function ScanQrScreen({ c, stage, result, onCaptured, onClose, onRetry }: Props) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [captured, setCaptured] = useState(false);
  const [manual, setManual] = useState('');
  const [showManual, setShowManual] = useState(false);

  const onCodeScanned = useCallback(
    (codes: { value?: string }[]) => {
      if (captured) return;
      const value = codes.find((code) => typeof code.value === 'string' && code.value.length > 0)?.value;
      if (!value) return;
      // Set first so no further frames are accepted while the camera unmounts.
      setCaptured(true);
      onCaptured(value);
    },
    [captured, onCaptured]
  );

  // VisionCamera 5 has no useCodeScanner - it was a v4 API, and calling it here
  // threw 'is not a function' at mount, killing the app the instant the scanner
  // opened. v5 delivers scanned objects through an output attached to the Camera
  // view instead: useObjectOutput({types}) hands back a CameraObjectOutput whose
  // callback receives ScannedObject instances, and a QR one is a ScannedCode
  // whose `value` is the payload. The mapping below keeps the capture logic above
  // untouched.
  const objectOutput = useObjectOutput({
    types: ['qr'],
    onObjectsScanned: (objects: any[]) => {
      const codes = objects
        .filter((o) => isScannedCode(o) && typeof o.value === 'string' && o.value.length > 0)
        .map((o) => ({ value: o.value as string }));
      if (codes.length > 0) onCodeScanned(codes);
    },
  });

  // The viewfinder is live only while nothing has been captured and no result
  // is in flight. This is what closes the camera after a successful capture.
  const scanning = !captured && (stage === 'idle' || stage === 'scanning');
  const busy = stage === 'captured' || stage === 'validating' || stage === 'authenticating';
  const accent = stage === 'verified' ? c.success : stage === 'failed' ? c.red : c.signal;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.bg }]}>
      <View style={s.head}>
        <View>
          <Text style={[s.kicker, { color: c.signal }]}>NEARBY / SCAN</Text>
          <Text style={[s.title, { color: c.ink }]}>Scan QR Code</Text>
        </View>
        <Pressable onPress={onClose} style={[s.close, { borderColor: c.border }]}>
          <Text style={[s.closeText, { color: c.dim }]}>CLOSE</Text>
        </Pressable>
      </View>

      <View style={[s.viewport, { borderColor: c.border, backgroundColor: c.surface }]}>
        {scanning && hasPermission && device ? (
          <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={[objectOutput]} />
        ) : (
          <View style={s.viewportIdle}>
            {busy ? (
              <ActivityIndicator color={c.signal} />
            ) : (
              <View style={[s.tick, { borderColor: accent }]}>
                <Text style={[s.tickMark, { color: accent }]}>
                  {stage === 'verified' ? '✓' : stage === 'failed' ? '✕' : '⌾'}
                </Text>
              </View>
            )}
            <Text style={[s.stateLabel, { color: accent }]}>{STAGE_LABEL[stage]}</Text>
            {result?.message ? (
              <Text style={[s.stateText, { color: c.dim }]}>{result.message}</Text>
            ) : null}
            {result?.code ? <Text style={[s.codeText, { color: c.dim }]}>{result.code}</Text> : null}
          </View>
        )}
        {scanning && !hasPermission ? (
          <View style={s.viewportIdle}>
            <Text style={[s.stateLabel, { color: c.warning }]}>CAMERA PERMISSION NEEDED</Text>
            <Text style={[s.stateText, { color: c.dim }]}>
              Zaycomm needs the camera to read a node code.
            </Text>
            <Pressable onPress={() => requestPermission()} style={[s.cta, { backgroundColor: c.signal }]}>
              <Text style={s.ctaText}>ALLOW CAMERA</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {stage === 'failed' ? (
        <Pressable onPress={onRetry} style={[s.cta, { backgroundColor: c.signal }]}>
          <Text style={s.ctaText}>SCAN AGAIN</Text>
        </Pressable>
      ) : null}

      {stage === 'verified' ? (
        <Pressable onPress={onClose} style={[s.cta, { backgroundColor: c.success }]}>
          <Text style={s.ctaText}>DONE</Text>
        </Pressable>
      ) : null}

      {stage === 'idle' || stage === 'scanning' ? (
        <View style={s.manualWrap}>
          {showManual ? (
            <>
              <Text style={[s.stateText, { color: c.dim }]}>
                For devices without a working camera. Paste a node code exactly as scanned.
              </Text>
              <TextInput
                value={manual}
                onChangeText={setManual}
                multiline
                placeholder="zaycomm code payload"
                placeholderTextColor={c.dim}
                style={[s.input, { color: c.ink, borderColor: c.border, backgroundColor: c.surface }]}
              />
              <Pressable
                onPress={() => {
                  if (!manual.trim()) return;
                  setCaptured(true);
                  onCaptured(manual.trim());
                }}
                style={[s.cta, { backgroundColor: c.signal }]}>
                <Text style={s.ctaText}>AUTHENTICATE FROM CODE</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setShowManual(true)} style={[s.secondary, { borderColor: c.border }]}>
              <Text style={[s.secondaryText, { color: c.signal }]}>ENTER CODE MANUALLY</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 16 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  kicker: { fontFamily: 'monospace', fontSize: 9, letterSpacing: 1.4, fontWeight: '700', marginBottom: 5 },
  title: { fontSize: 22, fontWeight: '800' },
  close: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 },
  closeText: { fontFamily: 'monospace', fontSize: 9, letterSpacing: 1.1, fontWeight: '700' },
  viewport: {
    height: 320,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
    marginTop: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewportIdle: { alignItems: 'center', padding: 18 },
  tick: { width: 54, height: 54, borderRadius: 27, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tickMark: { fontSize: 24, fontWeight: '800' },
  stateLabel: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1.2, fontWeight: '700', marginTop: 14 },
  stateText: { fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 8 },
  codeText: { fontFamily: 'monospace', fontSize: 9, letterSpacing: 1, marginTop: 6 },
  cta: {
    minHeight: 44,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 12,
  },
  ctaText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: '#04101c' },
  secondary: { borderWidth: 1, borderRadius: 11, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: 'monospace', fontSize: 10, letterSpacing: 1.1, fontWeight: '700' },
  manualWrap: { marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 70, padding: 10, fontSize: 10, fontFamily: 'monospace' },
});
