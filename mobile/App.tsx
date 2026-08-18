import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, Easing, NativeEventEmitter, NativeModules, PermissionsAndroid, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {createIdentity, computeFingerprint, Identity} from '../src/identity/identity';

const SERVICE_UUID = '8F4D0001-7E2C-4C7D-9F11-7A9D00000001';
const PROTOCOL_VERSION = 1;
const nativeBle = NativeModules.ZaycommBle;
const events = nativeBle ? new NativeEventEmitter(nativeBle) : null;

type Peer = {id: string; address: string};
type PairingPayload = {scheme: 'zaycomm'; version: number; nodeId: string; publicKey: string; capabilities: string[]; nonce: string};
type Tab = 'home' | 'pair' | 'nearby' | 'settings';

function bytesToHex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
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
  return Object.values(result).every(v => v === PermissionsAndroid.RESULTS.GRANTED);
}

function Pulse({active}: {active: boolean}) {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { scale.stopAnimation(); scale.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, {toValue: 1.5, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
      Animated.timing(scale, {toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, scale]);
  return <Animated.View style={styles.pulse} />;
}

function LiveCount({value}: {value: number}) {
  const scale = useRef(new Animated.Value(1)).current;
  const last = useRef(value);
  useEffect(() => {
    if (last.current !== value) {
      last.current = value;
      scale.setValue(1.35);
      Animated.spring(scale, {toValue: 1, friction: 5, tension: 120, useNativeDriver: true}).start();
    }
  }, [value, scale]);
  return <Animated.Text style={[styles.metricValue, {transform: [{scale}]}]}>{value}</Animated.Text>;
}

function NavIcon({tab, active}: {tab: Tab; active: boolean}) {
  const glyph = tab === 'home' ? '⌂' : tab === 'pair' ? '⌁' : tab === 'nearby' ? '◎' : '⚙';
  return <Text style={[styles.navIcon, active && styles.navActive]}>{glyph}</Text>;
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
  const [transportActive, setTransportActive] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const bridgeAvailable = !!nativeBle;
  const peerCount = useMemo(() => peers.length, [peers]);
  const append = (line: string) => setLog(current => [line, ...current].slice(0, 30));

  useEffect(() => { const timer = setTimeout(() => setLoading(false), 700); return () => clearTimeout(timer); }, []);

  useEffect(() => {
    if (!events) return;
    const advertisement = events.addListener('ZaycommBleAdvertisement', (peer: Peer) => {
      setPeers(current => current.some(p => p.address === peer.address) ? current : [...current, peer]);
    });
    const connection = events.addListener('ZaycommBleConnectionChanged', (event: {address: string; connected: boolean}) => {
      setConnected(current => event.connected ? Array.from(new Set([...current, event.address])) : current.filter(a => a !== event.address));
      append(`${event.connected ? 'LINK UP' : 'LINK DOWN'} • ${event.address}`);
    });
    return () => { advertisement.remove(); connection.remove(); };
  }, []);

  const configureNode = () => {
    const nextIdentity = createIdentity();
    const payload: PairingPayload = {scheme: 'zaycomm', version: PROTOCOL_VERSION, nodeId: createNodeId(nextIdentity.publicKey), publicKey: bytesToHex(nextIdentity.publicKey), capabilities: ['ble'], nonce: randomHex(32)};
    setIdentity(nextIdentity); setPairing(payload); setStatus('Node configured'); append(`IDENTITY READY • ${payload.nodeId}`); setTab('home');
  };

  const start = async () => {
    if (!identity || !pairing) { setStatus('Configure this node first'); setTab('home'); return; }
    if (!bridgeAvailable) { setStatus('Native BLE bridge unavailable'); return; }
    if (!(await requestAndroidBlePermissions())) { setStatus('Bluetooth permissions denied'); append('BLE BLOCKED • permission denied'); return; }
    try {
      await nativeBle.startAdvertising(nodeName);
      nativeBle.startScan();
      setTransportActive(true); setStatus('Discovering Zaycomm nodes'); append(`BLE ACTIVE • ${SERVICE_UUID.slice(0, 8)}…`);
    } catch (error) {
      setTransportActive(false); setStatus('Bluetooth transport failed'); append(`BLE ERROR • ${String(error)}`);
    }
  };

  const connect = async (peer: Peer) => {
    append(`CONNECTING • ${peer.id || peer.address}`);
    try { await nativeBle.connect(peer.address); append(`LINK REQUEST SENT • ${peer.address}`); }
    catch (error) { append(`CONNECT ERROR • ${String(error)}`); }
  };

  if (loading) return (
    <SafeAreaView style={styles.splash}>
      <View style={styles.splashMark}><Text style={styles.splashGlyph}>Z</Text></View>
      <Text style={styles.splashTitle}>ZAYCOMM</Text>
      <Text style={styles.splashMeta}>OFFLINE MESH / INITIALIZING</Text>
      <View style={styles.loadingTrack}><View style={styles.loadingBar} /></View>
    </SafeAreaView>
  );

  const home = (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heroRow}>
        <View><Text style={styles.eyebrow}>LOCAL NODE</Text><Text style={styles.hero}>ZAYCOMM</Text><Text style={styles.heroSub}>IDENTITY-FIRST / OFFLINE</Text></View>
        <View style={styles.livePill}><Pulse active={transportActive} /><Text style={styles.liveText}>{transportActive ? 'LIVE' : 'IDLE'}</Text></View>
      </View>

      <View style={styles.nodeCard}>
        <View style={styles.nodeHeader}><View><Text style={styles.mono}>NODE STATUS</Text><Text style={styles.nodeName}>{nodeName}</Text></View><View style={[styles.statusDot, transportActive && styles.statusDotLive]} /></View>
        <Text style={styles.nodeId}>{pairing?.nodeId ?? 'UNCONFIGURED'}</Text>
        <View style={styles.divider} />
        <View style={styles.metrics}><View><LiveCount value={peerCount} /><Text style={styles.metricLabel}>NEARBY</Text></View><View><Text style={styles.metricValue}>{connected.length}</Text><Text style={styles.metricLabel}>LINKED</Text></View><View><Text style={styles.metricValue}>{bridgeAvailable ? 'BLE' : '—'}</Text><Text style={styles.metricLabel}>BRIDGE</Text></View></View>
      </View>

      {!identity ? (
        <View style={styles.actionCard}><Text style={styles.eyebrow}>FIRST BOOT</Text><Text style={styles.cardTitle}>Create local identity</Text><Text style={styles.cardText}>Generate the Ed25519 identity that anchors this node. Private material stays on-device.</Text><Pressable style={styles.primary} onPress={configureNode}><Text style={styles.primaryText}>CREATE NODE</Text><Text style={styles.primaryArrow}>→</Text></Pressable></View>
      ) : (
        <View style={styles.actionCard}><View style={styles.rowBetween}><Text style={styles.eyebrow}>TRANSPORT</Text><Text style={styles.stateText}>{transportActive ? 'SCANNING' : 'READY'}</Text></View><Text style={styles.cardTitle}>{transportActive ? 'Listening for nearby nodes' : 'Start the offline network'}</Text><Text style={styles.cardText}>Bluetooth LE is the transport. Internet is not required.</Text><Pressable style={styles.primary} onPress={start}><Text style={styles.primaryText}>{transportActive ? 'TRANSPORT ACTIVE' : 'START OFFLINE TRANSPORT'}</Text><Text style={styles.primaryArrow}>→</Text></Pressable></View>
      )}

      {transportActive && <View style={styles.activity}><View style={styles.rowBetween}><Text style={styles.mono}>LIVE ACTIVITY</Text><Text style={styles.activityState}>● RADIO ACTIVE</Text></View><Text style={styles.terminalLine}>▰ listening / advertisements</Text><Text style={styles.terminalLine}>▰ peers in range / {peerCount}</Text><Text style={styles.terminalLine}>▰ authenticated links / {connected.length}</Text></View>}

      <Text style={styles.sectionHeading}>Quick access</Text>
      <View style={styles.quickRow}><Pressable style={styles.quick} onPress={() => setTab('pair')}><Text style={styles.quickGlyph}>⌁</Text><Text style={styles.quickTitle}>PAIR</Text><Text style={styles.quickMeta}>Public QR bootstrap</Text></Pressable><Pressable style={styles.quick} onPress={() => setTab('nearby')}><Text style={styles.quickGlyph}>◎</Text><Text style={styles.quickTitle}>NEARBY</Text><Text style={styles.quickMeta}>{peerCount} live discovery result{peerCount === 1 ? '' : 's'}</Text></Pressable></View>
    </ScrollView>
  );

  const pair = (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>SECURE BOOTSTRAP</Text><Text style={styles.pageTitle}>Pairing</Text><Text style={styles.pageSub}>Exchange public data first. Trust and transport remain device-local.</Text>
      {!pairing ? <View style={styles.actionCard}><Text style={styles.cardTitle}>No node identity</Text><Text style={styles.cardText}>Create this device's identity to generate a pairing QR.</Text><Pressable style={styles.primary} onPress={configureNode}><Text style={styles.primaryText}>CREATE NODE</Text><Text style={styles.primaryArrow}>→</Text></Pressable></View> : <>
        <View style={styles.qrCard}><Text style={styles.qrLabel}>SCAN THIS NODE</Text><View style={styles.qrWrap}><QRCode value={JSON.stringify(pairing)} size={220} ecl="L" quietZone={12} backgroundColor="#fff" color="#07111f" onError={(error: unknown) => append(`QR ERROR • ${String(error)}`)} /></View><Text style={styles.qrId}>{pairing.nodeId}</Text><Text style={styles.qrMeta}>ZAYCOMM / BLE / V{pairing.version}</Text></View>
        <View style={styles.terminal}><Text style={styles.mono}>PUBLIC BOOTSTRAP</Text><Text style={styles.terminalLine}>scheme :: zaycomm</Text><Text style={styles.terminalLine}>capability :: ble</Text><Text style={styles.terminalLine}>key :: {pairing.publicKey.slice(0, 24)}…</Text></View>
      </>}
    </ScrollView>
  );

  const nearby = (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heroRow}><View><Text style={styles.eyebrow}>BLE DISCOVERY</Text><Text style={styles.pageTitle}>Nearby</Text></View><View style={styles.countBox}><LiveCount value={peerCount} /></View></View>
      <View style={styles.activity}><View style={styles.rowBetween}><Text style={styles.mono}>{transportActive ? '● SCANNING' : '○ SCANNER IDLE'}</Text><Text style={styles.activityState}>{connected.length} LINKED</Text></View><Text style={styles.cardText}>{transportActive ? 'Discovery reacts to advertisements as they arrive.' : 'Start transport to discover nearby Zaycomm nodes.'}</Text></View>
      {peers.length === 0 ? <View style={styles.empty}><Text style={styles.emptyGlyph}>⌁</Text><Text style={styles.cardTitle}>No nodes detected</Text><Text style={styles.cardText}>Run Zaycomm on another device nearby and start its BLE transport.</Text></View> : peers.map(peer => <View key={peer.address} style={styles.peer}><View style={styles.peerMark}><Pulse active={transportActive} /></View><View style={styles.peerInfo}><Text style={styles.peerName}>{peer.id || 'ZAYCOMM NODE'}</Text><Text style={styles.peerAddress}>{peer.address}</Text></View><Pressable style={styles.connect} onPress={() => connect(peer)}><Text style={styles.connectText}>LINK</Text></Pressable></View>)}
      {log.length > 0 && <View style={styles.terminal}><Text style={styles.mono}>NODE ACTIVITY</Text>{log.slice(0, 8).map((line, index) => <Text key={`${line}-${index}`} style={styles.log}>{line}</Text>)}</View>}
    </ScrollView>
  );

  const settings = (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>SYSTEM</Text><Text style={styles.pageTitle}>Settings</Text>
      <View style={styles.card}><Text style={styles.section}>Node profile</Text><Text style={styles.label}>NODE NAME</Text><TextInput value={nodeName} onChangeText={setNodeName} style={styles.input} placeholder="Zaycomm Node" placeholderTextColor="#536a7c" /><Text style={styles.cardText}>Used when this device advertises over BLE.</Text></View>
      <View style={styles.card}><Text style={styles.section}>Identity</Text><View style={styles.rowBetween}><Text style={styles.cardText}>Status</Text><Text style={styles.stateText}>{identity ? 'CONFIGURED' : 'NOT CONFIGURED'}</Text></View>{identity && <><View style={styles.divider} /><Text style={styles.mono}>NODE ID</Text><Text style={styles.nodeId}>{pairing?.nodeId}</Text><Text style={styles.mono}>FINGERPRINT</Text><Text style={styles.fingerprint}>{computeFingerprint(identity.publicKey)}</Text></>}</View>
      <View style={styles.card}><Text style={styles.section}>Runtime</Text><Text style={styles.cardText}>Protocol v{PROTOCOL_VERSION}</Text><Text style={styles.cardText}>{bridgeAvailable ? 'Native BLE bridge loaded' : 'Native BLE bridge unavailable'}</Text><Text style={styles.cardText}>Internet dependency: none</Text></View>
    </ScrollView>
  );

  const screen = tab === 'home' ? home : tab === 'pair' ? pair : tab === 'nearby' ? nearby : settings;
  const tabs: Tab[] = ['home', 'pair', 'nearby', 'settings'];
  return <SafeAreaView style={styles.root}><View style={styles.header}><View><Text style={styles.brand}>ZAYCOMM</Text><Text style={styles.headerSub}>{identity ? 'PRIVATE OFFLINE NODE' : 'INITIAL SETUP'}</Text></View><View style={styles.local}><View style={styles.localDot} /><Text style={styles.localText}>LOCAL</Text></View></View><View style={styles.screen}>{screen}</View><View style={styles.nav}>{tabs.map(item => <Pressable key={item} style={styles.navItem} onPress={() => setTab(item)}><NavIcon tab={item} active={tab === item} /><Text style={[styles.navLabel, tab === item && styles.navActive]}>{item === 'home' ? 'HOME' : item === 'pair' ? 'PAIR' : item === 'nearby' ? 'NEARBY' : 'SETTINGS'}</Text></Pressable>)}</View></SafeAreaView>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#06101d'}, screen: {flex: 1}, content: {padding: 20, paddingBottom: 30, gap: 14},
  splash: {flex: 1, backgroundColor: '#06101d', alignItems: 'center', justifyContent: 'center'}, splashMark: {width: 74, height: 74, borderRadius: 22, backgroundColor: '#00d4ff', alignItems: 'center', justifyContent: 'center', marginBottom: 18}, splashGlyph: {fontSize: 40, color: '#03101b', fontWeight: '900'}, splashTitle: {fontSize: 27, color: '#fff', fontWeight: '900', letterSpacing: 5}, splashMeta: {fontSize: 9, color: '#5c7488', letterSpacing: 2, marginTop: 8}, loadingTrack: {width: 110, height: 3, backgroundColor: '#13283b', marginTop: 25, borderRadius: 3}, loadingBar: {width: 70, height: 3, backgroundColor: '#00d4ff'},
  header: {height: 68, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#07131f', borderBottomWidth: 1, borderBottomColor: '#10283a'}, brand: {fontSize: 16, color: '#fff', fontWeight: '900', letterSpacing: 2.5}, headerSub: {fontSize: 8, color: '#587387', letterSpacing: 1.5, marginTop: 2}, local: {flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#16374b', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6}, localDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: '#00d4ff'}, localText: {fontSize: 8, color: '#80b5c4', letterSpacing: 1.2, fontWeight: '800'},
  heroRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, eyebrow: {fontSize: 9, color: '#00d4ff', letterSpacing: 2.2, fontWeight: '900'}, hero: {fontSize: 31, color: '#fff', fontWeight: '900', letterSpacing: 1}, heroSub: {fontSize: 8, color: '#597387', letterSpacing: 1.5, marginTop: 2}, pageTitle: {fontSize: 30, color: '#fff', fontWeight: '900', marginTop: 2}, pageSub: {fontSize: 13, lineHeight: 19, color: '#738b9e'}, livePill: {flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: '#153b4d', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7}, liveText: {fontSize: 8, color: '#87bdca', letterSpacing: 1.5, fontWeight: '900'}, pulse: {width: 7, height: 7, borderRadius: 4, backgroundColor: '#00d4ff'},
  nodeCard: {backgroundColor: '#091927', borderWidth: 1, borderColor: '#143149', borderRadius: 18, padding: 18, gap: 12}, nodeHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, mono: {fontSize: 8, color: '#557489', letterSpacing: 2, fontWeight: '900'}, nodeName: {fontSize: 20, color: '#fff', fontWeight: '800', marginTop: 4}, nodeId: {fontSize: 11, color: '#76bfd0', letterSpacing: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'}, statusDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: '#30485a'}, statusDotLive: {backgroundColor: '#00d4ff'}, divider: {height: StyleSheet.hairlineWidth, backgroundColor: '#173047'}, metrics: {flexDirection: 'row', justifyContent: 'space-between'}, metricValue: {fontSize: 22, color: '#fff', fontWeight: '900'}, metricLabel: {fontSize: 8, color: '#4e697d', letterSpacing: 1.5, marginTop: 2},
  actionCard: {backgroundColor: '#092033', borderWidth: 1, borderColor: '#104d65', borderRadius: 18, padding: 18, gap: 9}, cardTitle: {fontSize: 19, color: '#fff', fontWeight: '850'}, cardText: {fontSize: 12, lineHeight: 18, color: '#7d96a8'}, rowBetween: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, stateText: {fontSize: 8, color: '#00d4ff', letterSpacing: 1.4, fontWeight: '900'}, primary: {minHeight: 48, backgroundColor: '#00d4ff', borderRadius: 11, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 4}, primaryText: {fontSize: 10, color: '#03101b', fontWeight: '900', letterSpacing: 1}, primaryArrow: {fontSize: 18, color: '#03101b', fontWeight: '900'},
  activity: {backgroundColor: '#06131e', borderWidth: 1, borderColor: '#12384d', borderRadius: 15, padding: 15, gap: 7}, activityState: {fontSize: 8, color: '#00d4ff', letterSpacing: 1.2, fontWeight: '900'}, terminalLine: {fontSize: 10, color: '#68a9ba', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'}, sectionHeading: {fontSize: 13, color: '#a5b8c5', fontWeight: '800', marginTop: 3}, quickRow: {flexDirection: 'row', gap: 12}, quick: {flex: 1, minHeight: 100, backgroundColor: '#091927', borderWidth: 1, borderColor: '#143149', borderRadius: 15, padding: 15, gap: 5}, quickGlyph: {fontSize: 22, color: '#00d4ff'}, quickTitle: {fontSize: 10, color: '#fff', fontWeight: '900', letterSpacing: 1.5}, quickMeta: {fontSize: 9, color: '#60798b'},
  card: {backgroundColor: '#091927', borderWidth: 1, borderColor: '#143149', borderRadius: 16, padding: 16, gap: 9}, section: {fontSize: 16, color: '#fff', fontWeight: '800'}, label: {fontSize: 8, color: '#557489', letterSpacing: 1.7, fontWeight: '900'}, input: {backgroundColor: '#06131e', borderWidth: 1, borderColor: '#17384b', borderRadius: 10, color: '#fff', paddingHorizontal: 12, paddingVertical: 11}, fingerprint: {fontSize: 10, lineHeight: 17, color: '#76bfd0', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'},
  qrCard: {backgroundColor: '#f5f8fa', borderRadius: 20, padding: 20, alignItems: 'center', gap: 11}, qrLabel: {fontSize: 10, color: '#31485a', letterSpacing: 2, fontWeight: '900'}, qrWrap: {padding: 10, backgroundColor: '#fff', borderRadius: 8}, qrId: {fontSize: 15, color: '#07111f', letterSpacing: 2, fontWeight: '900'}, qrMeta: {fontSize: 8, color: '#637483', letterSpacing: 1.5, fontWeight: '800'}, terminal: {backgroundColor: '#040b12', borderWidth: 1, borderColor: '#153246', borderRadius: 14, padding: 15, gap: 7}, log: {fontSize: 9, color: '#5f9eae', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'},
  countBox: {width: 48, height: 48, borderRadius: 14, backgroundColor: '#0a1e2c', borderWidth: 1, borderColor: '#17485e', alignItems: 'center', justifyContent: 'center'}, empty: {alignItems: 'center', backgroundColor: '#091927', borderRadius: 17, borderWidth: 1, borderColor: '#143149', padding: 28, gap: 8}, emptyGlyph: {fontSize: 34, color: '#1a526b'}, peer: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#091927', borderWidth: 1, borderColor: '#143149', borderRadius: 15, padding: 13, gap: 11}, peerMark: {width: 25, alignItems: 'center'}, peerInfo: {flex: 1}, peerName: {fontSize: 13, color: '#fff', fontWeight: '800'}, peerAddress: {fontSize: 8, color: '#536d80', marginTop: 3, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'}, connect: {borderWidth: 1, borderColor: '#00d4ff', borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9}, connectText: {fontSize: 8, color: '#00d4ff', fontWeight: '900', letterSpacing: 1},
  nav: {height: 67, backgroundColor: '#07131f', borderTopWidth: 1, borderTopColor: '#10283a', flexDirection: 'row', paddingBottom: Platform.OS === 'ios' ? 9 : 2}, navItem: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2}, navIcon: {fontSize: 20, color: '#3d586c'}, navActive: {color: '#00d4ff'}, navLabel: {fontSize: 7, color: '#3d586c', letterSpacing: 1, fontWeight: '900'},
});
