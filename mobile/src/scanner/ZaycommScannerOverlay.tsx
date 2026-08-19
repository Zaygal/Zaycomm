import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  status?: 'ready' | 'scanning' | 'detected' | 'error';
  message?: string;
};

export function ZaycommScannerOverlay({ status = 'ready', message }: Props) {
  const label = message ?? (
    status === 'detected'
      ? 'Zaycomm node detected'
      : status === 'error'
        ? 'Unable to scan this code'
        : status === 'scanning'
          ? 'Scanning for a Zaycomm node…'
          : 'Align the other node’s QR code inside the frame'
  );

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <View style={styles.frame}>
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
        {status === 'scanning' && <View style={styles.scanLine} />}
      </View>
      <View style={styles.statusPill}>
        <View style={[styles.dot, status === 'error' && styles.errorDot, status === 'detected' && styles.detectedDot]} />
        <Text style={styles.statusText}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 230,
    height: 230,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#57e0ff',
  },
  topLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  topRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  scanLine: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: '50%',
    height: 2,
    backgroundColor: '#57e0ff',
  },
  statusPill: {
    marginTop: 24,
    maxWidth: 310,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: 'rgba(8, 12, 34, 0.82)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 8,
    backgroundColor: '#57e0ff',
  },
  detectedDot: { backgroundColor: '#4ade9c' },
  errorDot: { backgroundColor: '#ff6b7d' },
  statusText: {
    color: '#eef1ff',
    fontSize: 13,
    fontWeight: '600',
  },
});
