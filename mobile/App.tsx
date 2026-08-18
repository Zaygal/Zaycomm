import React, {useEffect, useMemo, useState} from 'react';
import {NativeEventEmitter, NativeModules, PermissionsAndroid, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {createIdentity, computeFingerprint, Identity} from '../src/identity/identity';

const SERVICE_UUID = '8F4D0001-7E2C-4C7D-9F11-7A9D00000001';
const PROTOCOL_VERSION = 1;
const nativeBle = NativeModules.ZaycommBle;
const events = nativeBle ? new NativeEventEmitter(nativeBle) : null;

type Peer = {id: string; address: string};
type PairingPayload = {scheme: 'zaycomm'; version: number; nodeId: string; publicKey: string; capabilities: string[]; nonce: string};
type Tab = 'home' | 'pair' | 'transport' | 'settings';

function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytesToHex(bytes).slice(0, length);
}
function createNodeId(publicKey: Uint8Array): string { return computeFingerprint(publicKey).replace(/\s/g, '').slice(0, 16); }

async function requestAndroidBlePermissions() {
  if (Platform.OS !== 'android' || Platform.Version < 31) return true;
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
  ]);
  return Object.values(result).every(value => value === PermissionsAndroid.RESULTS.GRANTED);
}

function Icon({name, active = false}: {name: string; active?: boolean}) {
  const symbols: Record<string, string> = {home: '⌂', pair: '⌁', transport: '◉', settings: '⚙'};
  return <Text style={[styles.navIcon, active && styles.navIconActive]}>{symbols[name] || '•'}</Text>;
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('home');
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
    const timer = setTimeout(() => setLoading(false), 650);
    return () => clearTimeout(timer);
  }, []);

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
    const payload: PairingPayload = {scheme: 'zaycomm', version: PROTOCOL_VERSION, nodeId: createNodeId(nextIdentity.publicKey), publicKey: bytesToHex(nextIdentity.publicKey), capabilities: ['ble'], nonce: randomHex(32)};
    setIdentity(nextIdentity); setPairing(payload); setStatus('Node configured'); append(`Identity generated • ${payload.nodeId}`); setTab('home');
  };

  const start = async () => {
    if (!identity || !pairing) { setStatus('Configure this node first'); setTab('home'); return; }
    if (!bridgeAvailable) { setStatus('Native BLE bridge unavailable'); return; }
    if (!(await requestAndroidBlePermissions())) { setStatus('Bluetooth permissions denied'); return; }
    try {
      await nativeBle.startAdvertising(nodeName);
      nativeBle.startScan();
      setStatus('Discovering Zaycomm nodes');
      append(`BLE active • service ${SERVICE_UUID}`);
    } catch (error) {
      setStatus('Bluetooth transport failed to start');
      append(`BLE error • ${String(error)}`);
    }
  };

  const connect = async (peer: Peer) => {
    try { await nativeBle.connect(peer.address); append(`Connected to ${peer.address}`); }
    catch (error) { append(`Connection error • ${String(error)}`); }
  };

  const qrValue = pairing ? JSON.stringify(pairing) : '';

  if (loading) return (
    <SafeAreaView style={styles.splash}>
      <View style={styles.logoMark}><Text style={styles.logoGlyph}>Z</Text></View>
      <Text style={styles.splashTitle}>ZAYCOMM</Text>
      <Text style={styles.splashMeta}>PRIVATE • OFFLINE • CONNECTED</Text>
      <View style={styles.loadingTrack}><View style={styles.loadingBar} /></View>
    </SafeAreaView>
  );

  const renderHome = () => (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heroRow}>
        <View><Text style={styles.eyebrow}>OFFLINE NODE</Text><Text style={styles.title}>Your node</Text></View>
        <View style={styles.liveDot}><View style={styles.dot} /><Text style={styles.liveText}>{identity ? 'READY' : 'SETUP'}</Text></View>
      </View>

      <View style={styles.nodeCard}>
        <View style={styles.nodeTop}><View style={styles.nodeAvatar}><Text style={styles.nodeAvatarText}>Z</Text></View><View style={styles.nodeInfo}><Text style={styles.nodeName}>{nodeName}</Text><Text style={styles.nodeSub}>{identity ? `ID ${pairing?.nodeId}` : 'Identity not configured'}</Text></View></View>
        <View style={styles.divider} />
        <View style={styles.stats}><View><Text style={styles.statValue}>{peerCount}</Text><Text style={styles.statLabel}>NEARBY</Text></View><View><Text style={styles.statValue}>{connected.length}</Text><Text style={styles.statLabel}>CONNECTED</Text></View><View><Text style={styles.statValue}>{bridgeAvailable ? 'ON' : 'OFF'}</Text><Text style={styles.statLabel}>BRIDGE</Text></View></View>
      </View>

      {!identity ? <View style={styles.card}><Text style={styles.section}>Create your identity</Text><Text style={styles.meta}>Your Ed25519 identity stays on this device. Private identity material never enters the pairing QR.</Text><Pressable style={styles.primary} onPress={configureNode}><Text style={styles.primaryText}>CREATE NODE</Text><Text style={styles.arrow}>→</Text></Pressable></View> : (
        <View style={styles.card}><View style={styles.cardHeader}><Text style={styles.section}>Node status</Text><Text style={styles.statusPill}>{status}</Text></View><Text style={styles.meta}>Bluetooth Low Energy is the transport layer. Internet access is not required.</Text><Pressable style={styles.primary} onPress={start}><Text style={styles.primaryText}>{status === 'Discovering Zaycomm nodes' ? 'TRANSPORT ACTIVE' : 'START OFFLINE TRANSPORT'}</Text><Text style={styles.arrow}>→</Text></Pressable></View>
      )}

      <Text style={styles.sectionHeading}>Quick actions</Text>
      <View style={styles.actionGrid}><Pressable style={styles.action} onPress={() => setTab('pair')}><Text style={styles.actionIcon}>▣</Text><Text style={styles.actionTitle}>Pair device</Text><Text style={styles.actionMeta}>QR bootstrap</Text></Pressable><Pressable style={styles.action} onPress={() => setTab('transport')}><Text style={styles.actionIcon}>◉</Text><Text style={styles.actionTitle}>Nearby nodes</Text><Text style={styles.actionMeta}>{peerCount} discovered</Text></Pressable></View>

      <View style={styles.card}><View style={styles.cardHeader}><Text style={styles.section}>Security</Text><Text style={styles.secure}>● LOCAL</Text></View><Text style={styles.meta}>Identity-first architecture • public bootstrap only • encrypted transport foundation.</Text></View>
    </ScrollView>
  );

  const renderPair = () => (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>PAIRING</Text><Text style={styles.title}>Connect privately</Text><Text style={styles.subtitle}>Exchange public bootstrap data. Private identity material stays local.</Text>
      {!pairing ? <View style={styles.card}><Text style={styles.section}>No node identity yet</Text><Text style={styles.meta}>Create this device's identity before generating a pairing QR.</Text><Pressable style={styles.primary} onPress={configureNode}><Text style={styles.primaryText}>CREATE NODE</Text><Text style={styles.arrow}>→</Text></Pressable></View> : <>
        <View style={styles.qrCard}><Text style={styles.qrTitle}>SCAN TO PAIR</Text><View style={styles.qrWrap}><QRCode value={qrValue} size={220} ecl="L" quietZone={12} backgroundColor="#ffffff" color="#07111f" onError={(error: unknown) => append(`QR error • ${String(error)}`)} /></View><Text style={styles.pairingCode}>{pairing.nodeId}</Text><Text style={styles.metaCenter}>Public bootstrap • BLE • protocol v{pairing.version}</Text></View>
        <View style={styles.card}><Text style={styles.section}>Your fingerprint</Text><Text style={styles.fingerprint}>{computeFingerprint(identity!.publicKey)}</Text><Text style={styles.meta}>Verify this fingerprint when establishing trust with another node.</Text></View>
      </>}
    </ScrollView>
  );

  const renderTransport = () => (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heroRow}><View><Text style={styles.eyebrow}>TRANSPORT</Text><Text style={styles.title}>Nearby</Text></View><View style={[styles.transportBadge, status === 'Discovering Zaycomm nodes' && styles.transportBadgeActive]}><Text style={styles.transportBadgeText}>{status === 'Discovering Zaycomm nodes' ? 'SCANNING' : 'IDLE'}</Text></View></View>
      <View style={styles.card}><View style={styles.transportRow}><View style={styles.transportIcon}><Text style={styles.actionIcon}>◉</Text></View><View style={styles.nodeInfo}><Text style={styles.section}>Bluetooth LE</Text><Text style={styles.meta}>{bridgeAvailable ? 'Native bridge available' : 'Native bridge unavailable'}</Text></View></View><Pressable style={styles.primary} onPress={start}><Text style={styles.primaryText}>START SCAN</Text><Text style={styles.arrow}>→</Text></Pressable></View>
      <Text style={styles.sectionHeading}>Discovered nodes · {peerCount}</Text>
      <View style={styles.card}>{peers.length === 0 ? <View style={styles.emptyState}><Text style={styles.emptyIcon}>⌁</Text><Text style={styles.section}>Nothing nearby yet</Text><Text style={styles.metaCenter}>Start transport on two Zaycomm devices to discover each other.</Text></View> : peers.map(peer => <View key={peer.address} style={styles.peer}><View style={styles.peerAvatar}><Text style={styles.peerAvatarText}>Z</Text></View><View style={styles.nodeInfo}><Text style={styles.peerName}>{peer.id || 'Zaycomm peer'}</Text><Text style={styles.meta}>{peer.address}</Text></View><Pressable style={styles.connectButton} onPress={() => connect(peer)}><Text style={styles.connectText}>CONNECT</Text></Pressable></View>)}</View>
      {log.length > 0 && <View style={styles.card}><Text style={styles.section}>Activity</Text>{log.slice(0, 8).map((line, index) => <Text key={`${line}-${index}`} style={styles.log}>{line}</Text>)}</View>}
    </ScrollView>
  );

  const renderSettings = () => (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>SYSTEM</Text><Text style={styles.title}>Settings</Text>
      <View style={styles.card}><Text style={styles.section}>Node profile</Text><Text style={styles.label}>Node name</Text><TextInput value={nodeName} onChangeText={setNodeName} style={styles.input} placeholder="Zaycomm Node" placeholderTextColor="#718096" /><Text style={styles.meta}>This name is used when advertising over BLE.</Text></View>
      <View style={styles.card}><Text style={styles.section}>Identity</Text><View style={styles.settingRow}><Text style={styles.meta}>Identity status</Text><Text style={styles.settingValue}>{identity ? 'Configured' : 'Not configured'}</Text></View>{identity && <><View style={styles.settingRow}><Text style={styles.meta}>Node ID</Text><Text style={styles.settingValue}>{pairing?.nodeId}</Text></View><View style={styles.settingRow}><Text style={styles.meta}>Key type</Text><Text style={styles.settingValue}>Ed25519</Text></View></>}</View>
      <View style={styles.card}><Text style={styles.section}>About Zaycomm</Text><Text style={styles.meta}>Identity-first offline communication over Bluetooth LE.</Text><Text style={styles.meta}>Protocol version {PROTOCOL_VERSION} • React Native mobile shell</Text></View>
    </ScrollView>
  );

  const screen = tab === 'home' ? renderHome() : tab === 'pair' ? renderPair() : tab === 'transport' ? renderTransport() : renderSettings();
  return <SafeAreaView style={styles.root}><View style={styles.appHeader}><View><Text style={styles.brand}>ZAYCOMM</Text><Text style={styles.headerStatus}>{identity ? 'Private offline node' : 'Welcome'}</Text></View><View style={styles.headerBadge}><View style={styles.dot} /><Text style={styles.headerBadgeText}>LOCAL</Text></View></View><View style={styles.screen}>{screen}</View><View style={styles.bottomNav}>{(['home','pair','transport','settings'] as Tab[]).map(item => <Pressable key={item} style={styles.navItem} onPress={() => setTab(item)}><Icon name={item} active={tab === item} /><Text style={[styles.navLabel, tab === item && styles.navLabelActive]}>{item === 'home' ? 'Home' : item === 'pair' ? 'Pair' : item === 'transport' ? 'Nearby' : 'Settings'}</Text></Pressable>)}</View></SafeAreaView>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#07111f'}, screen: {flex: 1}, content: {padding: 20, paddingBottom: 28, gap: 14},
  splash: {flex: 1, backgroundColor: '#07111f', alignItems: 'center', justifyContent: 'center'}, logoMark: {width: 72, height: 72, borderRadius: 22, backgroundColor: '#00d4ff', alignItems: 'center', justifyContent: 'center', marginBottom: 18}, logoGlyph: {fontSize: 38, fontWeight: '900', color: '#03101b'}, splashTitle: {fontSize: 28, fontWeight: '900', letterSpacing: 5, color: '#fff'}, splashMeta: {fontSize: 9, letterSpacing: 2, color: '#6f849a', marginTop: 8}, loadingTrack: {width: 110, height: 3, backgroundColor: '#172a40', borderRadius: 3, marginTop: 28, overflow: 'hidden'}, loadingBar: {width: 65, height: 3, backgroundColor: '#00d4ff'},
  appHeader: {height: 68, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#15263a'}, brand: {fontSize: 14, fontWeight: '900', letterSpacing: 3, color: '#fff'}, headerStatus: {fontSize: 10, color: '#71869b', marginTop: 3}, headerBadge: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0d1b2e', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20}, headerBadgeText: {fontSize: 9, fontWeight: '800', color: '#90e0ef'}, dot: {width: 6, height: 6, borderRadius: 3, backgroundColor: '#00d4ff'},
  heroRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, eyebrow: {fontSize: 10, fontWeight: '800', letterSpacing: 2, color: '#00d4ff'}, title: {fontSize: 30, fontWeight: '800', color: '#fff', marginTop: 3}, subtitle: {fontSize: 13, color: '#8194a9', lineHeight: 19}, liveDot: {flexDirection: 'row', alignItems: 'center', gap: 6}, liveText: {fontSize: 9, fontWeight: '800', color: '#90e0ef'},
  nodeCard: {backgroundColor: '#0d1b2e', borderRadius: 22, padding: 18, borderWidth: 1, borderColor: '#17304a'}, nodeTop: {flexDirection: 'row', alignItems: 'center'}, nodeAvatar: {width: 52, height: 52, borderRadius: 17, backgroundColor: '#00d4ff', alignItems: 'center', justifyContent: 'center'}, nodeAvatarText: {fontSize: 26, fontWeight: '900', color: '#03101b'}, nodeInfo: {flex: 1, marginLeft: 12}, nodeName: {fontSize: 17, fontWeight: '700', color: '#fff'}, nodeSub: {fontSize: 10, color: '#72879d', marginTop: 4}, divider: {height: StyleSheet.hairlineWidth, backgroundColor: '#1c3047', marginVertical: 17}, stats: {flexDirection: 'row', justifyContent: 'space-between', paddingRight: 28}, statValue: {fontSize: 18, fontWeight: '800', color: '#fff'}, statLabel: {fontSize: 8, letterSpacing: 1.2, color: '#71869b', marginTop: 3},
  card: {backgroundColor: '#0d1b2e', borderRadius: 18, padding: 17, gap: 10, borderWidth: 1, borderColor: '#12263d'}, cardHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, section: {fontSize: 16, fontWeight: '700', color: '#fff'}, sectionHeading: {fontSize: 14, fontWeight: '700', color: '#c9d5e1', marginTop: 4}, label: {fontSize: 11, color: '#8194a9'}, meta: {fontSize: 12, color: '#8194a9', lineHeight: 18}, metaCenter: {fontSize: 11, color: '#8194a9', lineHeight: 17, textAlign: 'center'}, statusPill: {fontSize: 9, fontWeight: '800', color: '#90e0ef', backgroundColor: '#102d40', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10}, secure: {fontSize: 9, fontWeight: '800', color: '#90e0ef'},
  primary: {backgroundColor: '#00d4ff', borderRadius: 12, paddingHorizontal: 15, paddingVertical: 14, marginTop: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, primaryText: {fontSize: 11, fontWeight: '900', letterSpacing: .4, color: '#03101b'}, arrow: {fontSize: 20, fontWeight: '500', color: '#03101b'}, actionGrid: {flexDirection: 'row', gap: 12}, action: {flex: 1, backgroundColor: '#0d1b2e', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#12263d'}, actionIcon: {fontSize: 23, color: '#00d4ff'}, actionTitle: {fontSize: 13, fontWeight: '700', color: '#fff', marginTop: 10}, actionMeta: {fontSize: 10, color: '#71869b', marginTop: 3},
  qrCard: {backgroundColor: '#0d1b2e', borderRadius: 20, padding: 18, alignItems: 'center', gap: 12}, qrTitle: {fontSize: 10, fontWeight: '900', letterSpacing: 2, color: '#90e0ef'}, qrWrap: {alignItems: 'center', padding: 16, backgroundColor: '#fff', borderRadius: 16}, pairingCode: {fontSize: 15, letterSpacing: 2, color: '#fff', fontWeight: '800'}, fingerprint: {fontSize: 11, lineHeight: 19, color: '#90e0ef', fontWeight: '600'},
  transportBadge: {backgroundColor: '#172337', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14}, transportBadgeActive: {backgroundColor: '#10384a'}, transportBadgeText: {fontSize: 9, fontWeight: '900', color: '#8ba0b4'}, transportRow: {flexDirection: 'row', alignItems: 'center'}, transportIcon: {width: 46, height: 46, borderRadius: 14, backgroundColor: '#10283c', alignItems: 'center', justifyContent: 'center'}, peer: {flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#20344d'}, peerAvatar: {width: 40, height: 40, borderRadius: 13, backgroundColor: '#132c42', alignItems: 'center', justifyContent: 'center'}, peerAvatarText: {fontSize: 16, fontWeight: '900', color: '#90e0ef'}, peerName: {fontSize: 14, color: '#fff', fontWeight: '600'}, connectButton: {backgroundColor: '#00d4ff', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 9}, connectText: {fontSize: 9, fontWeight: '900', color: '#03101b'}, emptyState: {alignItems: 'center', paddingVertical: 25, gap: 8}, emptyIcon: {fontSize: 35, color: '#00d4ff'}, log: {fontSize: 10, color: '#90e0ef', lineHeight: 17},
  input: {backgroundColor: '#12243a', color: '#fff', borderRadius: 11, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14}, settingRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7}, settingValue: {fontSize: 11, color: '#90e0ef', fontWeight: '700', maxWidth: '55%'},
  bottomNav: {height: 74, paddingBottom: 7, paddingTop: 8, paddingHorizontal: 10, flexDirection: 'row', backgroundColor: '#091625', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#172a40'}, navItem: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2}, navIcon: {fontSize: 20, color: '#526a80'}, navIconActive: {color: '#00d4ff'}, navLabel: {fontSize: 9, color: '#526a80', fontWeight: '700'}, navLabelActive: {color: '#90e0ef'},
});
