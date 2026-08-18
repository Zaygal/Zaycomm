import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Animated, Easing, NativeEventEmitter, NativeModules, PermissionsAndroid, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {SvgXml} from 'react-native-svg';
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
type Theme = 'dark' | 'light';

const DARK = {bg: '#080c22', surface: '#121a3d', surface2: '#0d1330', border: '#212b57', ink: '#eef1ff', dim: '#8891bd', signal: '#57e0ff', pulse: '#7c6bff'};
const LIGHT = {bg: '#f7f8fc', surface: '#ffffff', surface2: '#f0f2f9', border: '#e1e5f2', ink: '#101425', dim: '#6b7290', signal: '#0ea5c4', pulse: '#6355d6'};
const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const ui = Platform.OS === 'android' ? 'sans-serif' : undefined;
const ZAYCOMM_LOGO_SVG = `<?xml version="1.0" encoding="UTF-8"?><svg viewBox="0 0 1170 788" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="dotGrad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#4ADE9C"/><stop offset="50%" stop-color="#3BC9C9"/><stop offset="100%" stop-color="#4FA8F0"/></linearGradient></defs><rect width="1170" height="788" fill="#060A18"/><g stroke="url(#dotGrad)" stroke-width="10" stroke-linecap="round" opacity="0.9"><line x1="505" y1="335" x2="595" y2="300"/><line x1="505" y1="435" x2="595" y2="395"/><line x1="505" y1="435" x2="505" y2="540"/></g><g fill="url(#dotGrad)"><circle cx="410" cy="297" r="13"/><circle cx="410" cy="398" r="13"/><circle cx="410" cy="495" r="13"/><circle cx="505" cy="247" r="15"/><circle cx="505" cy="335" r="28"/><circle cx="505" cy="435" r="28"/><circle cx="505" cy="540" r="16"/><circle cx="595" cy="205" r="15"/><circle cx="595" cy="300" r="28"/><circle cx="595" cy="395" r="28"/><circle cx="595" cy="497" r="19"/><circle cx="595" cy="595" r="15"/><circle cx="672" cy="250" r="14"/><circle cx="680" cy="345" r="21"/><circle cx="672" cy="450" r="21"/><circle cx="672" cy="550" r="18"/><circle cx="763" cy="297" r="14"/><circle cx="763" cy="398" r="14"/><circle cx="763" cy="497" r="14"/></g></svg>`;

const storage = (() => { try { return require('@react-native-async-storage/async-storage').default; } catch { return null; } })();

function Pulse({active}: {active: boolean}) { const scale = useRef(new Animated.Value(1)).current; useEffect(() => { if (!active) { scale.stopAnimation(); scale.setValue(1); return; } const loop = Animated.loop(Animated.sequence([Animated.timing(scale,{toValue:1.65,duration:850,easing:Easing.inOut(Easing.ease),useNativeDriver:true}),Animated.timing(scale,{toValue:1,duration:850,easing:Easing.inOut(Easing.ease),useNativeDriver:true})])); loop.start(); return () => loop.stop(); },[active,scale]); return <Animated.View style={styles.pulse}/>; }
function StatusDot({state}: {state: ProtocolState}) { const active=state!=='IDLE'; const color=state==='IDLE'?'#5f6685':state==='SCANNING'||state==='LINKING'?'#f4b740':'#4ade80'; return <View style={styles.statusDotWrap}><Pulse active={active}/><View style={[styles.statusDot,{backgroundColor:color}]}/></View>; }
function SignalIcon({kind,active=false}: {kind:'home'|'chat'|'pair'|'nearby'|'settings'|'arrow';active?:boolean}) { const color=active?'#57e0ff':'#8891bd'; if(kind==='arrow')return <View/>; if(kind==='home')return <View style={styles.homeIcon}/>; if(kind==='chat')return <View style={[styles.chatIcon,{borderColor:color}]}/>; if(kind==='pair')return <View style={[styles.linkIcon,{borderColor:color}]}/>; if(kind==='nearby')return <View style={[styles.radarIcon,{borderColor:color}]}/>; return <View style={[styles.settingsIcon,{borderColor:color}]}/>; }

export default function AppV2(){
  const [theme,setTheme]=useState<Theme>('dark');
  const [tab,setTab]=useState<Tab>('home');
  const [protocolState,setProtocolState]=useState<ProtocolState>('IDLE');
  const colors=theme==='light'?LIGHT:DARK;
  useEffect(()=>{ if(!storage)return; storage.getItem('zaycomm.theme').then((v:string|null)=>{if(v==='light'||v==='dark')setTheme(v)}).catch(()=>{}); },[]);
  const changeTheme=(next:Theme)=>{setTheme(next); storage?.setItem('zaycomm.theme',next).catch(()=>{});};
  return <SafeAreaView style={[styles.root,{backgroundColor:colors.bg}]}><View style={styles.app}>
    <View style={[styles.header,{borderBottomColor:colors.border}]}><View style={styles.headerLeft}><SvgXml xml={ZAYCOMM_LOGO_SVG} width={28} height={28}/><Text style={[styles.wordmark,{color:colors.ink}]}>ZAYCOMM</Text><StatusDot state={protocolState}/></View></View>
    <ScrollView contentContainerStyle={styles.content}>
      {tab==='home'&&<><View style={[styles.card,{backgroundColor:colors.surface,borderColor:colors.border}]}><Text style={[styles.eyebrow,{color:colors.signal}]}>LOCAL NODE</Text><Text style={[styles.title,{color:colors.ink}]}>Zaycomm Node</Text><Text style={[styles.sub,{color:colors.dim}]}>Identity ready · offline mesh</Text><View style={[styles.idRow,{backgroundColor:colors.surface2,borderColor:colors.border}]}><Text style={[styles.id,{color:colors.signal,fontFamily:mono}]}>NODE ID 634a9517c0cabbe4</Text></View></View><View style={[styles.card,{backgroundColor:colors.surface,borderColor:colors.border}]}><Text style={[styles.sectionTitle,{color:colors.ink}]}>Offline Transport</Text><Text style={[styles.sub,{color:colors.dim}]}>Bluetooth LE is the current transport. Internet is not required.</Text><Pressable style={[styles.cta,{backgroundColor:colors.signal}]} onPress={()=>setProtocolState(protocolState==='IDLE'?'SCANNING':'IDLE')}><Text style={styles.ctaText}>Start Offline Transport</Text></Pressable></View></>}
      {tab==='settings'&&<><Text style={[styles.title,{color:colors.ink}]}>Settings</Text><View style={[styles.card,{backgroundColor:colors.surface,borderColor:colors.border}]}><Text style={[styles.sectionTitle,{color:colors.ink}]}>Appearance</Text><Text style={[styles.sub,{color:colors.dim}]}>Choose how Zaycomm looks on this device.</Text><View style={[styles.themeRow,{backgroundColor:colors.surface2,borderColor:colors.border}]}><Pressable onPress={()=>changeTheme('dark')} style={[styles.themeButton,theme==='dark'&&{backgroundColor:colors.signal}]}><Text style={[styles.themeText,theme==='dark'&&styles.themeTextActive]}>Dark</Text></Pressable><Pressable onPress={()=>changeTheme('light')} style={[styles.themeButton,theme==='light'&&{backgroundColor:colors.signal}]}><Text style={[styles.themeText,theme==='light'&&styles.themeTextActive]}>Light</Text></Pressable></View></View></>}
      {tab!=='home'&&tab!=='settings'&&<Text style={[styles.title,{color:colors.ink}]}>{tab[0].toUpperCase()+tab.slice(1)}</Text>}
    </ScrollView>
    <View style={[styles.nav,{backgroundColor:colors.surface,borderTopColor:colors.border}]}>{(['home','chats','pair','nearby','settings'] as Tab[]).map(t=><Pressable key={t} onPress={()=>setTab(t)} style={styles.navItem}><SignalIcon kind={t} active={tab===t}/><Text style={[styles.navText,{color:tab===t?colors.signal:colors.dim}]}>{t[0].toUpperCase()+t.slice(1)}</Text></Pressable>)}</View>
  </View></SafeAreaView>;
}

const styles=StyleSheet.create({root:{flex:1},app:{flex:1},header:{height:64,paddingHorizontal:20,flexDirection:'row',alignItems:'center',borderBottomWidth:1},headerLeft:{flexDirection:'row',alignItems:'center',gap:10},wordmark:{fontFamily:ui,fontSize:15,fontWeight:'700',letterSpacing:0.4},statusDotWrap:{width:16,height:16,alignItems:'center',justifyContent:'center',marginLeft:2},statusDot:{width:9,height:9,borderRadius:9},pulse:{position:'absolute',width:9,height:9,borderRadius:9,backgroundColor:'transparent'},content:{padding:20,paddingBottom:100},card:{borderWidth:1,borderRadius:18,padding:20,marginBottom:16},eyebrow:{fontFamily:mono,fontSize:10,letterSpacing:1.4,marginBottom:6},title:{fontFamily:ui,fontSize:22,fontWeight:'700',marginBottom:5},sub:{fontFamily:ui,fontSize:12,lineHeight:18,marginBottom:16},idRow:{borderWidth:1,borderRadius:12,padding:13},id:{fontSize:12},sectionTitle:{fontFamily:ui,fontSize:16,fontWeight:'700',marginBottom:6},cta:{borderRadius:12,padding:14,alignItems:'center'},ctaText:{fontFamily:ui,fontSize:14,fontWeight:'600',color:'#04101c'},themeRow:{borderWidth:1,borderRadius:14,padding:5,flexDirection:'row',gap:5},themeButton:{flex:1,paddingVertical:10,borderRadius:10,alignItems:'center'},themeText:{fontFamily:mono,fontSize:12,color:'#8891bd'},themeTextActive:{color:'#04101c',fontWeight:'600'},nav:{position:'absolute',left:0,right:0,bottom:0,height:76,borderTopWidth:1,flexDirection:'row',justifyContent:'space-around',alignItems:'center'},navItem:{alignItems:'center',justifyContent:'center',gap:4},navText:{fontFamily:ui,fontSize:10},homeIcon:{width:20,height:17,borderWidth:2,borderColor:'#57e0ff',borderRadius:4},chatIcon:{width:20,height:16,borderWidth:2,borderRadius:5},linkIcon:{width:20,height:16,borderWidth:2,borderRadius:8},radarIcon:{width:19,height:19,borderWidth:2,borderRadius:19},settingsIcon:{width:19,height:19,borderWidth:2,borderRadius:5}}
);