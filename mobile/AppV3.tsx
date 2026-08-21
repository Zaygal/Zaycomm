import React,{useEffect,useState}from'react';
import{DeviceEventEmitter,NativeEventEmitter,NativeModules,PermissionsAndroid,Platform,Pressable,StyleSheet,Text,View}from'react-native';
import AsyncStorage from'@react-native-async-storage/async-storage';
import AppV2 from'./AppV2';
import{computeFingerprint}from'../src/identity/identity';

type Peer={id:string;address:string};
type Identity={nodeId:string;publicKey:string};
const nativeBle=NativeModules.ZaycommBle;
const bleEvents=nativeBle?new NativeEventEmitter(nativeBle):null;
const scanner=NativeModules.ZaycommCameraScanner;
const TRUSTED_KEY='zaycomm.trustedPeers';
const DISMISSED_KEY='zaycomm.homeAuthDismissed';

function validIdentity(payload:string):Identity{
 const value=JSON.parse(payload) as Record<string,unknown>;
 if(value.scheme!=='zaycomm'||value.version!==1)throw new Error('INVALID_ZAYCOMM_QR');
 if(typeof value.nodeId!=='string'||!/^[0-9a-f]{16}$/i.test(value.nodeId))throw new Error('INVALID_NODE_ID');
 if(typeof value.publicKey!=='string'||!/^[0-9a-f]{64}$/i.test(value.publicKey))throw new Error('INVALID_PUBLIC_KEY');
 const nodeId=value.nodeId.toLowerCase();
 const publicKey=value.publicKey.toLowerCase();
 const fingerprint=computeFingerprint(new Uint8Array(publicKey.match(/.{1,2}/g)!.map(x=>parseInt(x,16)))).replace(/\s/g,'').slice(0,16).toLowerCase();
 if(fingerprint!==nodeId)throw new Error('PEER_NODE_ID_MISMATCH');
 return{nodeId,publicKey};
}

export default function AppV3(){
 const[peer,setPeer]=useState<Peer|null>(null),[linked,setLinked]=useState(false),[dismissed,setDismissed]=useState<string[]>([]),[authenticatedAddress,setAuthenticatedAddress]=useState<string|null>(null),[step,setStep]=useState<'prompt'|'scanning'|'verified'>('prompt'),[identity,setIdentity]=useState<Identity|null>(null),[error,setError]=useState('');
 useEffect(()=>{AsyncStorage.getItem(DISMISSED_KEY).then(v=>{try{setDismissed(v?JSON.parse(v):[])}catch{setDismissed([])}})},[]);
 useEffect(()=>{if(!bleEvents)return;const ad=bleEvents.addListener('ZaycommBleAdvertisement',(p:Peer)=>{setPeer(p);setAuthenticatedAddress(null)});const link=bleEvents.addListener('ZaycommBleConnectionChanged',(e:{address:string;connected:boolean})=>{if(e.connected){setLinked(true)}else{setLinked(false);setAuthenticatedAddress(null);setPeer(current=>current?.address===e.address?null:current)}});return()=>{ad.remove();link.remove()}},[]);
 useEffect(()=>{if(!linked||!peer)return;const sub=DeviceEventEmitter.addListener('ZaycommQrDetected',(event:{payload:string})=>{try{const result=validIdentity(event.payload);setIdentity(result);setStep('verified');setError('')}catch(e){setError(`QR rejected: ${String(e)}`)}finally{scanner?.release?.().catch(()=>{})}});return()=>sub.remove()},[linked,peer]);
 const visible=!!peer&&linked&&!dismissed.includes(peer.address)&&authenticatedAddress!==peer.address;
 useEffect(()=>{if(visible){setStep('prompt');setIdentity(null);setError('')}},[visible]);
 const dismiss=async()=>{if(!peer)return;const next=[...new Set([...dismissed,peer.address])];setDismissed(next);await AsyncStorage.setItem(DISMISSED_KEY,JSON.stringify(next));await scanner?.release?.();setPeer(null);setAuthenticatedAddress(null)};
 const begin=async()=>{setError('');if(Platform.OS==='android'){const r=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);if(r!==PermissionsAndroid.RESULTS.GRANTED){setError('Camera permission is required to authenticate this node.');return}}try{const ok=await scanner?.prepareAnalysis?.();if(!ok){setError('The QR camera is unavailable.');return}setStep('scanning')}catch(e){setError(`Unable to start QR scanner: ${String(e)}`)}};
 const cancel=async()=>{await scanner?.release?.();setStep('prompt')};
 const trust=async()=>{if(!identity||!peer)return;try{const current=JSON.parse((await AsyncStorage.getItem(TRUSTED_KEY))||'[]');const next=[...new Set([...current,identity.nodeId])];await AsyncStorage.setItem(TRUSTED_KEY,JSON.stringify(next));setAuthenticatedAddress(peer.address);setStep('prompt');setIdentity(null);setError('');await scanner?.release?.()}catch(e){setError(`Unable to save trust: ${String(e)}`)}};
 return <><AppV2/>{visible&&<View style={s.backdrop}><View style={s.card}><View style={s.header}><View><Text style={s.kicker}>NEW NODE DETECTED</Text><Text style={s.title}>Authenticate device</Text></View><Pressable onPress={dismiss}><Text style={s.close}>×</Text></Pressable></View><Text style={s.copy}>A BLE link is active. Authentication is separate from transport. Scan the other device's Zaycomm identity QR to establish trust.</Text><View style={s.node}><View style={s.dot}/><View style={{flex:1}}><Text style={s.label}>BLE LINKED NODE</Text><Text style={s.id}>{peer.id||peer.address}</Text></View></View>{step==='prompt'&&<Pressable style={s.button} onPress={begin}><Text style={s.buttonText}>SCAN IDENTITY QR</Text></Pressable>}{step==='scanning'&&<View style={s.scanBox}><Text style={s.scanTitle}>CAMERA ACTIVE</Text><Text style={s.scanCopy}>Hold the other device's Zaycomm identity QR inside the camera frame.</Text><Pressable style={s.secondary} onPress={cancel}><Text style={s.secondaryText}>CANCEL SCAN</Text></Pressable></View>}{step==='verified'&&identity&&<View style={s.verify}><Text style={s.kicker}>IDENTITY VERIFIED</Text><Text style={s.verifyId}>{identity.nodeId}</Text><Text style={s.scanCopy}>The QR public key cryptographically matches the displayed node ID. Confirm the device before trusting it.</Text><Pressable style={s.button} onPress={trust}><Text style={s.buttonText}>TRUST THIS NODE</Text></Pressable></View>}{error!==''&&<Text style={s.error}>{error}</Text>}</View></View>}</>;
}

const s=StyleSheet.create({backdrop:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(3,6,20,.72)',justifyContent:'flex-end',zIndex:999},card:{backgroundColor:'#121a3d',borderTopLeftRadius:28,borderTopRightRadius:28,borderWidth:1,borderColor:'#29345f',padding:22,paddingBottom:30},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},kicker:{fontSize:10,fontWeight:'800',letterSpacing:1.7,color:'#57e0ff'},title:{fontSize:23,fontWeight:'800',color:'#eef1ff',marginTop:6},close:{fontSize:30,lineHeight:28,color:'#8891bd'},copy:{fontSize:13,lineHeight:20,color:'#aeb6dc',marginTop:14},node:{marginTop:16,padding:14,borderRadius:16,borderWidth:1,borderColor:'#29345f',flexDirection:'row',alignItems:'center',gap:12},dot:{width:10,height:10,borderRadius:5,backgroundColor:'#4ade9c'},label:{fontSize:9,fontWeight:'800',letterSpacing:1,color:'#8891bd'},id:{fontFamily:Platform.OS==='ios'?'Menlo':'monospace',fontSize:13,color:'#eef1ff',marginTop:4},button:{marginTop:18,padding:16,borderRadius:15,backgroundColor:'#57e0ff',alignItems:'center'},buttonText:{fontSize:11,fontWeight:'900',letterSpacing:1,color:'#07101e'},secondary:{marginTop:14,padding:13,borderRadius:14,borderWidth:1,borderColor:'#39456f',alignItems:'center'},secondaryText:{fontSize:10,fontWeight:'800',letterSpacing:1,color:'#aeb6dc'},scanBox:{marginTop:16,padding:18,borderRadius:18,borderWidth:1,borderColor:'#57e0ff55',backgroundColor:'#0d1330'},scanTitle:{fontSize:11,fontWeight:'900',letterSpacing:1.5,color:'#57e0ff'},scanCopy:{fontSize:12,lineHeight:19,color:'#aeb6dc',marginTop:7},verify:{marginTop:16,padding:17,borderRadius:18,borderWidth:1,borderColor:'#4ade9c55',backgroundColor:'#0d2a2a'},verifyId:{fontFamily:Platform.OS==='ios'?'Menlo':'monospace',fontSize:18,fontWeight:'800',color:'#eef1ff',marginTop:8},error:{fontSize:12,lineHeight:18,color:'#ff6b7d',marginTop:12}});