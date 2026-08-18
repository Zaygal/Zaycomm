import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Animated, Easing, NativeEventEmitter, NativeModules, PermissionsAndroid, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {createIdentity, computeFingerprint, Identity} from '../src/identity/identity';

const SERVICE_UUID = '8F4D0001-7E2C-4C7D-9F11-7A9D00000001';
const PROTOCOL_VERSION = 1;
const nativeBle = NativeModules.ZaycommBle;
const events = nativeBle ? new NativeEventEmitter(nativeBle) : null;

type Peer = {id: string; address: string};
type PairingPayload = {scheme: 'zaycomm'; version: number; nodeId: string; publicKey: string; capabilities: string[]; nonce: string};
type Tab = 'home' | 'chats' | 'pair' | 'nearby' | 'settings';
type ProtocolState = 'IDLE' | 'SCANNING' | 'LINKING' | 'CONNECTED';
type Delivery = 'QUEUED' | 'RELAYING' | 'DELIVERED';

type Thread = {id: string; name: string; preview: string; unread: number; state: Delivery; time: string};

const COLORS = {bg: '#080c22', surface: '#121a3d', border: '#212b57', ink: '#eef1ff', dim: '#8891bd', signal: '#57e0ff', pulse: '#7c6bff'};
const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const ui = Platform.OS === 'android' ? 'sans-serif' : undefined;

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
      Animated.timing(scale, {toValue: 1.65, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
      Animated.timing(scale, {toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true}),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, scale]);
  return <Animated.View style={[styles.pulse, {transform: [{scale}]}]} />;
}

function SignalIcon({kind, active = false}: {kind: 'home' | 'chat' | 'pair' | 'nearby' | 'settings' | 'arrow'; active?: boolean}) {
  const color = active ? COLORS.signal : COLORS.dim;
  if (kind === 'arrow') return <View style={styles.arrowIcon}><View style={[styles.arrowStem, {backgroundColor: color}]} /><View style={[styles.arrowHeadA, {borderColor: color}]} /><View style={[styles.arrowHeadB, {borderColor: color}]} /></View>;
  if (kind === 'home') return <View style={styles.homeIcon}><View style={[styles.homeRoof, {borderColor: color}]} /><View style={[styles.homeBody, {borderColor: color}]} /></View>;
  if (kind === 'chat') return <View style={[styles.chatIcon, {borderColor: color}]} />;
  if (kind === 'pair') return <View style={styles.linkIcon}><View style={[styles.linkA, {borderColor: color}]} /><View style={[styles.linkB, {borderColor: color}]} /></View>;
  if (kind === 'nearby') return <View style={[styles.radarIcon, {borderColor: color}]}><View style={[styles.radarDot, {backgroundColor: color}]} /></View>;
  return <View style={[styles.settingsIcon, {borderColor: color}]}><View style={[styles.settingsCore, {backgroundColor: color}]} /></View>;
}

function StatePill({state}: {state: ProtocolState}) {
  const live = state !== 'IDLE';
  return <View style={[styles.statePill, live && styles.statePillLive]}><Pulse active={live} /><Text style={styles.statePillText}>{state}</Text></View>;
}

function DeliveryState({state}: {state: Delivery}) {
  const active = state !== 'DELIVERED';
  return <View style={styles.delivery}><Pulse active={active} /><Text style={[styles.deliveryText, state === 'DELIVERED' && styles.delivered]}>{state}</Text></View>;
}

export default function AppV2() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('home');
  const [nodeName, setNodeName] = useState('Zaycomm Node');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [pairing, setPairing] = useState<PairingPayload | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [linking, setLinking] = useState(false);
  const [transportActive, setTransportActive] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [scanMode, setScanMode] = useState(false);

  const bridgeAvailable = !!nativeBle;
  const peerCount = useMemo(() => peers.length, [peers]);
  const state: ProtocolState = connected.length > 0 ? 'CONNECTED' : linking ? 'LINKING' : transportActive ? 'SCANNING' : 'IDLE';
  const append = (line: string) => setLog(current => [line, ...current].slice(0, 30));

  useEffect(() => { const timer = setTimeout(() => setLoading(false), 900); return () => clearTimeout(timer); }, []);

  useEffect(() => {
    if (!events) return;
    const advertisement = events.addListener('ZaycommBleAdvertisement', (peer: Peer) => {
      setPeers(current => current.some(p => p.address === peer.address) ? current : [...current, peer]);
      append(`DISCOVERY • ${peer.id || peer.address}`);
    });
    const connection = events.addListener('ZaycommBleConnectionChanged', (event: {address: string; connected: boolean}) => {
      setLinking(false);
      setConnected(current => event.connected ? Array.from(new Set([...current, event.address])) : current.filter(a => a !== event.address));
      append(`${event.connected ? 'LINK UP' : 'LINK DOWN'} • ${event.address}`);
    });
    return () => { advertisement.remove(); connection.remove(); };
  }, []);

  const configureNode = () => {
    const nextIdentity = createIdentity();
    const payload: PairingPayload = {scheme: 'zaycomm', version: PROTOCOL_VERSION, nodeId: createNodeId(nextIdentity.publicKey), publicKey: bytesToHex(nextIdentity.publicKey), capabilities: ['ble'], nonce: randomHex(32)};
    setIdentity(nextIdentity);
    setPairing(payload);
    append(`IDENTITY READY • ${payload.nodeId}`);
    setTab('home');
  };

  const start = async () => {
    if (!identity || !pairing) { setTab('home'); return; }
    if (!bridgeAvailable) { append('BLE ERROR • native bridge unavailable'); return; }
    if (!(await requestAndroidBlePermissions())) { append('BLE BLOCKED • permission denied'); return; }
    try {
      await nativeBle.startAdvertising(nodeName);
      nativeBle.startScan();
      setTransportActive(true);
      append(`BLE ACTIVE • ${SERVICE_UUID.slice(0, 8)}…`);
    } catch (error) {
      setTransportActive(false);
      append(`BLE ERROR • ${String(error)}`);
    }
  };

  const connect = async (peer: Peer) => {
    if (!nativeBle) return;
    setLinking(true);
    append(`LINKING • ${peer.id || peer.address}`);
    try { await nativeBle.connect(peer.address); append(`LINK REQUEST SENT • ${peer.address}`); }
    catch (error) { setLinking(false); append(`CONNECT ERROR • ${String(error)}`); }
  };

  const openScan = () => {
    setScanMode(true);
    append('PAIR SCANNER • waiting for QR payload');
  };

  if (loading) return <SafeAreaView style={styles.splash}><View style={styles.splashMark}><Text style={styles.splashGlyph}>Z</Text></View><Text style={styles.splashTitle}>ZAYCOMM</Text><Text style={styles.splashMeta}>PRIVATE / OFFLINE / MESH</Text><View style={styles.loadingTrack}><View style={styles.loadingBar} /></View></SafeAreaView>;

  const home = <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.heroRow}><View><Text style={styles.eyebrow}>LOCAL NODE</Text><Text style={styles.heroTitle}>{identity ? nodeName : 'ZAYCOMM'}</Text><Text style={styles.heroSub}>{identity ? 'IDENTITY READY / OFFLINE MESH' : 'INITIAL SETUP'}</Text></View><StatePill state={state} /></View>

    <View style={styles.nodeCard}><View style={styles.rowBetween}><View><Text style={styles.mono}>NODE ID</Text><Text style={styles.nodeId}>{pairing?.nodeId ?? 'UNCONFIGURED'}</Text></View><View style={[styles.liveRing, state !== 'IDLE' && styles.liveRingActive]}><Pulse active={state !== 'IDLE'} /></View></View><View style={styles.divider} /><View style={styles.metrics}><View><Text style={styles.metricValue}>{peerCount}</Text><Text style={styles.metricLabel}>NEARBY</Text></View><View><Text style={styles.metricValue}>{connected.length}</Text><Text style={styles.metricLabel}>LINKED</Text></View><View><Text style={styles.metricValue}>{bridgeAvailable ? 'BLE' : '—'}</Text><Text style={styles.metricLabel}>TRANSPORT</Text></View></View></View>

    {!identity ? <View style={styles.actionCard}><Text style={styles.eyebrow}>FIRST BOOT</Text><Text style={styles.cardTitle}>Create local identity</Text><Text style={styles.cardText}>Generate the Ed25519 identity that anchors this node. Private key material stays on-device.</Text><Pressable style={styles.primary} onPress={configureNode}><Text style={styles.primaryText}>CREATE NODE</Text><SignalIcon kind="arrow" active /></Pressable></View> : <View style={styles.actionCard}><View style={styles.rowBetween}><Text style={styles.eyebrow}>TRANSPORT</Text><Text style={styles.stateText}>{state}</Text></View><Text style={styles.cardTitle}>{state === 'CONNECTED' ? 'Mesh link is live' : state === 'SCANNING' ? 'Listening for nearby nodes' : 'Start the offline network'}</Text><Text style={styles.cardText}>Bluetooth LE is the current transport. Internet is not required.</Text><Pressable style={styles.primary} onPress={start}><Text style={styles.primaryText}>{transportActive ? 'TRANSPORT ACTIVE' : 'START OFFLINE TRANSPORT'}</Text><SignalIcon kind="arrow" active /></Pressable></View>}

    {transportActive && <View style={styles.activity}><View style={styles.rowBetween}><Text style={styles.mono}>LIVE ACTIVITY</Text><Text style={styles.activityState}>RADIO ACTIVE</Text></View><Text style={styles.terminalLine}>listening / advertisements</Text><Text style={styles.terminalLine}>peers in range / {peerCount}</Text><Text style={styles.terminalLine}>authenticated links / {connected.length}</Text></View>}

    <View style={styles.sectionHeader}><Text style={styles.sectionHeading}>Recent activity</Text><Text style={styles.mono}>LIVE</Text></View>
    {log.length === 0 ? <View style={styles.emptyMini}><Text style={styles.cardText}>No protocol events yet. Start transport or pair a node.</Text></View> : <View style={styles.activity}>{log.slice(0, 4).map((line, index) => <Text key={`${line}-${index}`} style={styles.log}>{line}</Text>)}</View>}
  </ScrollView>;

  const chats = <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.heroRow}><View><Text style={styles.eyebrow}>END-TO-END</Text><Text style={styles.pageTitle}>Chats</Text></View><Text style={styles.mono}>{connected.length} LINKED</Text></View>
    {threads.length === 0 ? <View style={styles.empty}><View style={styles.emptyIcon}><SignalIcon kind="chat" active /></View><Text style={styles.cardTitle}>No conversations yet</Text><Text style={styles.cardText}>Paired nodes will appear here. Delivery state will follow the mesh: queued → relaying → delivered.</Text><Pressable style={styles.secondary} onPress={() => setTab('nearby')}><Text style={styles.secondaryText}>FIND A NODE</Text></Pressable></View> : threads.map(thread => <Pressable key={thread.id} style={styles.thread} onPress={() => setThreads(current => current.map(t => t.id === thread.id ? {...t, unread: 0} : t))}><View style={styles.avatar}><Text style={styles.avatarText}>{thread.name.slice(0, 1).toUpperCase()}</Text></View><View style={styles.threadInfo}><View style={styles.rowBetween}><Text style={styles.threadName}>{thread.name}</Text><Text style={styles.threadTime}>{thread.time}</Text></View><Text style={styles.threadPreview} numberOfLines={1}>{thread.preview}</Text><DeliveryState state={thread.state} /></View>{thread.unread > 0 && <View style={styles.unread}><Text style={styles.unreadText}>{thread.unread}</Text></View>}</Pressable>)}
    <View style={styles.protocolNote}><Text style={styles.mono}>MESSAGE PIPELINE</Text><Text style={styles.cardText}>Ratchet-encrypted content stays endpoint-to-endpoint. Relays only carry opaque frames.</Text></View>
  </ScrollView>;

  const pair = <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <Text style={styles.eyebrow}>SECURE BOOTSTRAP</Text><Text style={styles.pageTitle}>Pair</Text><Text style={styles.pageSub}>Show your public bootstrap by default. Scan is a deliberate second action.</Text>
    {!pairing ? <View style={styles.actionCard}><Text style={styles.cardTitle}>Create a node first</Text><Text style={styles.cardText}>Your public pairing payload is generated from the local identity.</Text><Pressable style={styles.primary} onPress={configureNode}><Text style={styles.primaryText}>CREATE NODE</Text><SignalIcon kind="arrow" active /></Pressable></View> : scanMode ? <View style={styles.scanner}><View style={styles.scanFrame}><View style={styles.scanLine} /></View><Text style={styles.cardTitle}>QR scanner ready</Text><Text style={styles.cardText}>Camera integration can feed the pairing payload here. No payload has been accepted yet.</Text><Pressable style={styles.secondary} onPress={() => setScanMode(false)}><Text style={styles.secondaryText}>SHOW MY QR</Text></Pressable></View> : <>
      <View style={styles.qrCard}><Text style={styles.qrLabel}>MY NODE / PUBLIC BOOTSTRAP</Text><View style={styles.qrWrap}><QRCode value={JSON.stringify(pairing)} size={220} ecl="L" quietZone={12} backgroundColor="#fff" color="#080c22" /></View><Text style={styles.qrId}>{pairing.nodeId}</Text><Text style={styles.qrMeta}>ZAYCOMM / BLE / V{pairing.version}</Text></View>
      <Pressable style={styles.secondary} onPress={openScan}><Text style={styles.secondaryText}>SCAN A NODE</Text></Pressable>
      <View style={styles.terminal}><Text style={styles.mono}>PUBLIC PAYLOAD</Text><Text style={styles.terminalLine}>scheme :: zaycomm</Text><Text style={styles.terminalLine}>capability :: ble</Text><Text style={styles.terminalLine}>key :: {pairing.publicKey.slice(0, 24)}…</Text></View>
    </>}
  </ScrollView>;

  const nearby = <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.heroRow}><View><Text style={styles.eyebrow}>BLE DISCOVERY</Text><Text style={styles.pageTitle}>Nearby</Text></View><View style={styles.countBox}><Text style={styles.countValue}>{peerCount}</Text><Text style={styles.countLabel}>NODES</Text></View></View>
    <View style={styles.activity}><View style={styles.rowBetween}><Text style={styles.mono}>{state === 'SCANNING' ? 'SCANNING' : 'DISCOVERY'}</Text><Text style={styles.activityState}>{connected.length} LINKED</Text></View><Text style={styles.cardText}>{transportActive ? 'Live advertisements update this list as they arrive.' : 'Start transport from Home to begin discovery.'}</Text></View>
    {peers.length === 0 ? <View style={styles.empty}><View style={styles.emptyIcon}><SignalIcon kind="nearby" active /></View><Text style={styles.cardTitle}>No nodes detected</Text><Text style={styles.cardText}>Run Zaycomm on another nearby device and start BLE transport.</Text></View> : peers.map(peer => <View key={peer.address} style={styles.peer}><View style={styles.peerMark}><Pulse active={transportActive} /></View><View style={styles.peerInfo}><Text style={styles.peerName}>{peer.id || 'ZAYCOMM NODE'}</Text><Text style={styles.peerAddress}>{peer.address}</Text><Text style={styles.peerMeta}>{connected.includes(peer.address) ? 'LINKED' : 'NEW / UNLINKED'}</Text></View><Pressable style={styles.connect} onPress={() => connect(peer)}><Text style={styles.connectText}>{connected.includes(peer.address) ? 'OPEN' : 'LINK'}</Text></Pressable></View>)}
  </ScrollView>;

  const settings = <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <Text style={styles.eyebrow}>SYSTEM</Text><Text style={styles.pageTitle}>Settings</Text>
    <View style={styles.card}><Text style={styles.section}>Node identity</Text><Text style={styles.label}>NODE NAME</Text><TextInput value={nodeName} onChangeText={setNodeName} style={styles.input} placeholder="Zaycomm Node" placeholderTextColor={COLORS.dim} /><Text style={styles.cardText}>This is the name advertised by this node over BLE.</Text>{identity && <><View style={styles.divider} /><Text style={styles.mono}>NODE ID</Text><Text style={styles.nodeId}>{pairing?.nodeId}</Text><Text style={styles.mono}>FINGERPRINT</Text><Text style={styles.fingerprint}>{computeFingerprint(identity.publicKey)}</Text></>}</View>
    <View style={styles.card}><Text style={styles.section}>Transport</Text><View style={styles.rowBetween}><Text style={styles.cardText}>Bluetooth LE</Text><Text style={styles.stateText}>{bridgeAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}</Text></View><View style={styles.rowBetween}><Text style={styles.cardText}>Runtime state</Text><Text style={styles.stateText}>{state}</Text></View></View>
    <View style={styles.dangerCard}><Text style={styles.section}>Identity management</Text><Text style={styles.cardText}>Regenerating identity changes this node's cryptographic identity and invalidates existing pairing trust.</Text><Pressable style={styles.dangerButton} onPress={() => Alert.alert('Regenerate Node Identity', 'This is a destructive identity change. Continue?', [{text: 'Cancel', style: 'cancel'}, {text: 'Regenerate', style: 'destructive', onPress: configureNode}])}><Text style={styles.dangerText}>REGENERATE NODE IDENTITY</Text></Pressable></View>
  </ScrollView>;

  const screen = tab === 'home' ? home : tab === 'chats' ? chats : tab === 'pair' ? pair : tab === 'nearby' ? nearby : settings;
  const tabs: {key: Tab; label: string; icon: 'home' | 'chat' | 'pair' | 'nearby' | 'settings'}[] = [
    {key: 'home', label: 'HOME', icon: 'home'}, {key: 'chats', label: 'CHATS', icon: 'chat'}, {key: 'pair', label: 'PAIR', icon: 'pair'}, {key: 'nearby', label: 'NEARBY', icon: 'nearby'}, {key: 'settings', label: 'SETTINGS', icon: 'settings'},
  ];

  return <SafeAreaView style={styles.root}>
    <View style={styles.header}><View style={styles.brandWrap}><View style={styles.brandMark}><Text style={styles.brandGlyph}>Z</Text></View><View><Text style={styles.brand}>ZAYCOMM</Text><Text style={styles.headerSub}>{identity ? 'LOCAL NODE' : 'INITIAL SETUP'}</Text></View></View><StatePill state={state} /></View>
    <View style={styles.screen}>{screen}</View>
    <View style={styles.nav}>{tabs.map(item => <Pressable key={item.key} style={styles.navItem} onPress={() => setTab(item.key)}><SignalIcon kind={item.icon} active={tab === item.key} /><Text style={[styles.navLabel, tab === item.key && styles.navActive]}>{item.label}</Text></Pressable>)}</View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.bg}, screen: {flex: 1}, content: {padding: 20, paddingBottom: 34, gap: 14},
  splash: {flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center'}, splashMark: {width: 76, height: 76, borderRadius: 22, backgroundColor: COLORS.signal, alignItems: 'center', justifyContent: 'center', marginBottom: 18}, splashGlyph: {fontSize: 40, color: COLORS.bg, fontWeight: '900', fontFamily: ui}, splashTitle: {fontSize: 28, color: COLORS.ink, fontWeight: '800', letterSpacing: 5, fontFamily: ui}, splashMeta: {fontSize: 9, color: COLORS.dim, letterSpacing: 2, marginTop: 8, fontFamily: mono}, loadingTrack: {width: 112, height: 3, backgroundColor: COLORS.border, marginTop: 25, borderRadius: 3}, loadingBar: {width: 72, height: 3, backgroundColor: COLORS.signal, borderRadius: 3},
  header: {height: 70, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border}, brandWrap: {flexDirection: 'row', alignItems: 'center', gap: 9}, brandMark: {width: 30, height: 30, borderRadius: 9, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center'}, brandGlyph: {fontSize: 16, color: COLORS.signal, fontWeight: '900'}, brand: {fontSize: 13, color: COLORS.ink, fontWeight: '800', letterSpacing: 2, fontFamily: ui}, headerSub: {fontSize: 7, color: COLORS.dim, letterSpacing: 1.5, marginTop: 2, fontFamily: mono},
  heroRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, eyebrow: {fontSize: 9, color: COLORS.signal, letterSpacing: 1.8, fontWeight: '700', fontFamily: ui}, heroTitle: {fontSize: 31, color: COLORS.ink, fontWeight: '800', letterSpacing: 0.2, marginTop: 3, fontFamily: ui}, heroSub: {fontSize: 8, color: COLORS.dim, letterSpacing: 1.1, marginTop: 2, fontFamily: mono}, pageTitle: {fontSize: 30, color: COLORS.ink, fontWeight: '800', marginTop: 3, fontFamily: ui}, pageSub: {fontSize: 13, lineHeight: 19, color: COLORS.dim, fontFamily: ui},
  statePill: {flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7}, statePillLive: {borderColor: COLORS.signal}, statePillText: {fontSize: 8, color: COLORS.dim, letterSpacing: 1.2, fontWeight: '800', fontFamily: mono}, pulse: {width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.signal},
  nodeCard: {backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 18, gap: 13}, rowBetween: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, mono: {fontSize: 8, color: COLORS.dim, letterSpacing: 1.6, fontWeight: '700', fontFamily: mono}, nodeId: {fontSize: 11, color: COLORS.signal, letterSpacing: 0.8, marginTop: 4, fontFamily: mono}, liveRing: {width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center'}, liveRingActive: {borderColor: COLORS.signal}, divider: {height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border}, metrics: {flexDirection: 'row', justifyContent: 'space-between'}, metricValue: {fontSize: 22, color: COLORS.ink, fontWeight: '800', fontFamily: ui}, metricLabel: {fontSize: 8, color: COLORS.dim, letterSpacing: 1.2, marginTop: 2, fontFamily: mono},
  actionCard: {backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 18, gap: 9}, cardTitle: {fontSize: 19, color: COLORS.ink, fontWeight: '700', fontFamily: ui}, cardText: {fontSize: 12, lineHeight: 18, color: COLORS.dim, fontFamily: ui}, stateText: {fontSize: 8, color: COLORS.signal, letterSpacing: 1.3, fontWeight: '800', fontFamily: mono}, primary: {minHeight: 49, backgroundColor: COLORS.signal, borderRadius: 11, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 4}, primaryText: {fontSize: 10, color: COLORS.bg, fontWeight: '800', letterSpacing: 1, fontFamily: ui}, secondary: {minHeight: 46, borderWidth: 1, borderColor: COLORS.signal, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15}, secondaryText: {fontSize: 9, color: COLORS.signal, fontWeight: '800', letterSpacing: 1, fontFamily: ui},
  activity: {backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 15, gap: 7}, activityState: {fontSize: 8, color: COLORS.signal, letterSpacing: 1.1, fontWeight: '800', fontFamily: mono}, terminalLine: {fontSize: 10, color: COLORS.dim, fontFamily: mono}, log: {fontSize: 9, color: COLORS.dim, fontFamily: mono}, sectionHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3}, sectionHeading: {fontSize: 14, color: COLORS.ink, fontWeight: '700', fontFamily: ui}, emptyMini: {paddingVertical: 4},
  empty: {alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, padding: 28, gap: 10}, emptyIcon: {width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 3},
  thread: {backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11}, avatar: {width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center'}, avatarText: {fontSize: 15, color: COLORS.signal, fontWeight: '800', fontFamily: ui}, threadInfo: {flex: 1, gap: 4}, threadName: {fontSize: 13, color: COLORS.ink, fontWeight: '700', fontFamily: ui}, threadTime: {fontSize: 8, color: COLORS.dim, fontFamily: mono}, threadPreview: {fontSize: 11, color: COLORS.dim, fontFamily: ui}, delivery: {flexDirection: 'row', alignItems: 'center', gap: 5}, deliveryText: {fontSize: 7, color: COLORS.signal, letterSpacing: 1, fontFamily: mono}, delivered: {color: COLORS.dim}, unread: {width: 21, height: 21, borderRadius: 11, backgroundColor: COLORS.signal, alignItems: 'center', justifyContent: 'center'}, unreadText: {fontSize: 8, color: COLORS.bg, fontWeight: '800'}, protocolNote: {padding: 14, gap: 7},
  qrCard: {backgroundColor: '#f7f8fc', borderRadius: 20, padding: 20, alignItems: 'center', gap: 11}, qrLabel: {fontSize: 9, color: '#2d3857', letterSpacing: 1.6, fontWeight: '800', fontFamily: ui}, qrWrap: {padding: 10, backgroundColor: '#fff', borderRadius: 8}, qrId: {fontSize: 15, color: COLORS.bg, letterSpacing: 1.7, fontWeight: '800', fontFamily: mono}, qrMeta: {fontSize: 8, color: '#65708d', letterSpacing: 1.2, fontWeight: '700', fontFamily: mono}, terminal: {backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 15, gap: 7}, scanner: {backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 20, alignItems: 'center', gap: 13}, scanFrame: {width: 245, height: 245, borderWidth: 1, borderColor: COLORS.signal, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden'}, scanLine: {height: 1, width: '86%', backgroundColor: COLORS.signal},
  countBox: {width: 58, height: 48, borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center'}, countValue: {fontSize: 17, color: COLORS.ink, fontWeight: '800', fontFamily: ui}, countLabel: {fontSize: 6, color: COLORS.dim, letterSpacing: 1, fontFamily: mono}, peer: {flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 13, gap: 11}, peerMark: {width: 25, alignItems: 'center'}, peerInfo: {flex: 1, gap: 3}, peerName: {fontSize: 13, color: COLORS.ink, fontWeight: '700', fontFamily: ui}, peerAddress: {fontSize: 8, color: COLORS.dim, fontFamily: mono}, peerMeta: {fontSize: 7, color: COLORS.signal, letterSpacing: 1, fontFamily: mono}, connect: {borderWidth: 1, borderColor: COLORS.signal, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 9}, connectText: {fontSize: 8, color: COLORS.signal, fontWeight: '800', letterSpacing: 1, fontFamily: ui},
  card: {backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 16, gap: 10}, section: {fontSize: 16, color: COLORS.ink, fontWeight: '700', fontFamily: ui}, label: {fontSize: 8, color: COLORS.dim, letterSpacing: 1.5, fontWeight: '700', fontFamily: mono}, input: {backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, color: COLORS.ink, paddingHorizontal: 12, paddingVertical: 11, fontFamily: ui}, fingerprint: {fontSize: 10, lineHeight: 17, color: COLORS.signal, fontFamily: mono}, dangerCard: {backgroundColor: COLORS.surface, borderWidth: 1, borderColor: '#4c3150', borderRadius: 16, padding: 16, gap: 10}, dangerButton: {borderWidth: 1, borderColor: '#9a5a78', borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center'}, dangerText: {fontSize: 8, color: '#e59ab7', letterSpacing: 1, fontWeight: '800', fontFamily: mono},
  nav: {height: 72, backgroundColor: COLORS.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, flexDirection: 'row', paddingBottom: Platform.OS === 'ios' ? 8 : 2}, navItem: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5}, navLabel: {fontSize: 7, color: COLORS.dim, letterSpacing: 0.8, fontWeight: '700', fontFamily: ui}, navActive: {color: COLORS.signal},
  arrowIcon: {width: 19, height: 19, alignItems: 'center', justifyContent: 'center'}, arrowStem: {width: 12, height: 2, borderRadius: 1}, arrowHeadA: {position: 'absolute', right: 2, width: 7, height: 7, borderTopWidth: 2, borderRightWidth: 2, transform: [{rotate: '45deg'}]}, arrowHeadB: {display: 'none'},
  homeIcon: {width: 20, height: 20, alignItems: 'center', justifyContent: 'flex-end'}, homeRoof: {position: 'absolute', top: 2, width: 12, height: 12, borderTopWidth: 2, borderLeftWidth: 2, transform: [{rotate: '45deg'}]}, homeBody: {width: 13, height: 10, borderWidth: 2, borderTopWidth: 0, borderRadius: 2}, chatIcon: {width: 18, height: 14, borderWidth: 2, borderRadius: 5, position: 'relative'}, pairIcon: {width: 20, height: 20}, linkIcon: {width: 22, height: 18}, linkA: {position: 'absolute', left: 1, top: 4, width: 12, height: 8, borderWidth: 2, borderRadius: 6, transform: [{rotate: '-25deg'}]}, linkB: {position: 'absolute', right: 1, bottom: 3, width: 12, height: 8, borderWidth: 2, borderRadius: 6, transform: [{rotate: '-25deg'}]}, radarIcon: {width: 20, height: 20, borderWidth: 2, borderRadius: 10, alignItems: 'center', justifyContent: 'center'}, radarDot: {width: 5, height: 5, borderRadius: 3}, settingsIcon: {width: 19, height: 19, borderWidth: 2, borderRadius: 10, alignItems: 'center', justifyContent: 'center'}, settingsCore: {width: 5, height: 5, borderRadius: 3},
});
