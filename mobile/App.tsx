import React, {useEffect, useMemo, useState} from 'react';
import {NativeEventEmitter, NativeModules, PermissionsAndroid, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {createIdentity, computeFingerprint, Identity} from '../src/identity/identity';

const SERVICE_UUID = '8F4D0001-7E2C-4C7D-9F11-7A9D00000001';
const PROTOCOL_VERSION = 1;

const nativeBle = NativeModules.ZaycommBle;
const events = nativeBle ? new NativeEventEmitter(nativeBle) : null;

type Peer = {id: string; address: string};

type PairingPayload = {
  scheme: 'zaycomm';
  version: number;
  nodeId: string;
  publicKey: string;
  capabilities: string[];
  nonce: string;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytesToHex(bytes).slice(0, length);
}

function createNodeId(publicKey: Uint8Array): string {
  return computeFingerprint(publicKey).replace(/\s/g, '').slice(0, 16);
}

async function requestAndroidBlePermissions() {
  if (Platform.OS !== 'android' || Platform.Version < 31) return true;
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
  ]);
  return Object.values(result).every(value => value === PermissionsAndroid.RESULTS.GRANTED);
}

export default function App() {
  const [nodeName, setNodeName] = useState('Zaycomm Node');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [pairing, setPairing] = useState<PairingPayload | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [status, setStatus] = useState('Not configured');
  const [log, setLog] = useState<string[]>([]);

  const append = (line: string) => setLog(current => [line, ...current].slice(0, 40));
  const bridgeAvailable = !!nativeBle;
  const peerCount = useMemo(() => peers.length, [peers]);

  useEffect(() => {
    if (!events) return;
    const advertisement = events.addListener('ZaycommBleAdvertisement', (peer: Peer) => {
      setPeers(current => current.some(p => p.address === peer.address) ? current : [...current, peer]);
    });
    const connection = events.addListener('ZaycommBleConnectionChanged', (event: {address: string; connected: boolean}) => {
      setConnected(current => event.connected ? Array.from(new Set([...current, event.address])) : current.filter(a => a !== event.address));
      append(`${event.connected ? 'Connected' : 'Disconnected'} ${event.address}`);
    });
    return () => { advertisement.remove(); connection.remove(); };
  }, []);

  const configureNode = () => {
    const nextIdentity = createIdentity();
    const payload: PairingPayload = {
      scheme: 'zaycomm',
      version: PROTOCOL_VERSION,
      nodeId: createNodeId(nextIdentity.publicKey),
      publicKey: bytesToHex(nextIdentity.publicKey),
      capabilities: ['ble'],
      nonce: randomHex(32),
    };
    setIdentity(nextIdentity);
    setPairing(payload);
    setStatus('Node configured');
    append(`Identity generated • ${payload.nodeId}`);
  };

  const start = async () => {
    if (!identity || !pairing) {
      setStatus('Configure this node first');
      return;
    }
    if (!bridgeAvailable) {
      setStatus('Native BLE bridge unavailable');
      return;
    }
    if (!(await requestAndroidBlePermissions())) {
      setStatus('Bluetooth permissions denied');
      return;
    }
    await nativeBle.startAdvertising(nodeName);
    nativeBle.startScan();
    setStatus('Discovering Zaycomm nodes');
    append(`BLE active • service ${SERVICE_UUID}`);
  };

  const connect = async (peer: Peer) => {
    await nativeBle.connect(peer.address);
    append(`Connected to ${peer.address}`);
  };

  const qrValue = pairing ? JSON.stringify(pairing) : '';

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>ZAYCOMM</Text>
        <Text style={styles.title}>Offline Node</Text>
        <Text style={styles.subtitle}>Identity-first onboarding • BLE transport • TypeScript protocol core</Text>

        <View style={styles.card}>
          <Text style={styles.section}>1. Configure this device</Text>
          <Text style={styles.label}>Node name</Text>
          <TextInput value={nodeName} onChangeText={setNodeName} style={styles.input} placeholder="Alice" placeholderTextColor="#718096" />
          <Text style={styles.meta}>A new Ed25519 identity is generated locally.</Text>
          <Text style={styles.meta}>Private identity material is never placed in the pairing QR.</Text>
          {identity && pairing ? (
            <>
              <Text style={styles.identity}>Node ID: {pairing.nodeId}</Text>
              <Text style={styles.meta}>Fingerprint: {computeFingerprint(identity.publicKey)}</Text>
            </>
          ) : null}
          <Pressable style={styles.button} onPress={configureNode}>
            <Text style={styles.buttonText}>{identity ? 'REGENERATE NODE IDENTITY' : 'CREATE NODE'}</Text>
          </Pressable>
        </View>

        {pairing ? (
          <View style={styles.card}>
            <Text style={styles.section}>2. Pair another device</Text>
            <Text style={styles.meta}>Scan this QR from another Zaycomm device. It contains public bootstrap data only.</Text>
            <View style={styles.qrWrap}>
              <QRCode
                value={qrValue}
                size={220}
                ecl="L"
                quietZone={12}
                backgroundColor="#ffffff"
                color="#07111f"
                onError={(error: unknown) => append(`QR error • ${String(error)}`)}
              />
            </View>
            <Text style={styles.pairingCode}>{pairing.nodeId}</Text>
            <Text style={styles.meta}>BLE capability • protocol v{pairing.version}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.section}>3. Start offline transport</Text>
          <Text style={styles.meta}>Transport: Bluetooth LE</Text>
          <Text style={styles.meta}>Internet: not required</Text>
          <Text style={styles.meta}>Bridge: {bridgeAvailable ? 'available' : 'not loaded'}</Text>
          <Pressable style={styles.button} onPress={start}>
            <Text style={styles.buttonText}>START NODE</Text>
          </Pressable>
          <Text style={styles.status}>{status}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Nearby Zaycomm nodes ({peerCount})</Text>
          {peers.length === 0 ? <Text style={styles.empty}>No Zaycomm BLE advertisements yet.</Text> : peers.map(peer => (
            <View key={peer.address} style={styles.peer}>
              <View>
                <Text style={styles.peerName}>{peer.id || 'Zaycomm peer'}</Text>
                <Text style={styles.meta}>{peer.address}</Text>
              </View>
              <Pressable style={styles.smallButton} onPress={() => connect(peer)}>
                <Text style={styles.buttonText}>CONNECT</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Transport log</Text>
          <Text style={styles.meta}>Connected peers: {connected.length}</Text>
          {log.map((line, index) => <Text key={`${line}-${index}`} style={styles.log}>{line}</Text>)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#07111f'},
  content: {padding: 24, gap: 16},
  kicker: {fontSize: 13, letterSpacing: 3, color: '#00d4ff', fontWeight: '700'},
  title: {fontSize: 36, fontWeight: '800', color: '#fff'},
  subtitle: {fontSize: 15, color: '#9fb0c3', marginBottom: 8},
  card: {backgroundColor: '#0d1b2e', borderRadius: 18, padding: 18, gap: 10},
  label: {fontSize: 12, color: '#9fb0c3'},
  input: {backgroundColor: '#12243a', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12},
  meta: {fontSize: 12, color: '#8fa1b5'},
  identity: {fontSize: 13, color: '#90e0ef', fontWeight: '700'},
  button: {backgroundColor: '#00d4ff', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8},
  smallButton: {backgroundColor: '#00d4ff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9},
  buttonText: {fontSize: 12, fontWeight: '800', color: '#03101b'},
  status: {fontSize: 13, color: '#90e0ef'},
  section: {fontSize: 17, fontWeight: '700', color: '#fff'},
  empty: {fontSize: 13, color: '#718096'},
  peer: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#20344d'},
  peerName: {fontSize: 14, color: '#fff', fontWeight: '600'},
  pairingCode: {fontSize: 16, letterSpacing: 2, color: '#fff', textAlign: 'center', fontWeight: '800'},
  qrWrap: {alignItems: 'center', padding: 18, backgroundColor: '#fff', borderRadius: 14, alignSelf: 'center'},
  log: {fontSize: 11, color: '#90e0ef'},
});
