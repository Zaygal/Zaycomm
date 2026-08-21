import React,{useEffect,useState}from'react';
import{NativeEventEmitter,NativeModules}from'react-native';
import AsyncStorage from'@react-native-async-storage/async-storage';
import AppV2 from'./AppV2';
import HomeAuthenticationOverlay from'./HomeAuthenticationOverlay';

type Peer={id:string;address:string};
const nativeBle=NativeModules.ZaycommBle;const events=nativeBle?new NativeEventEmitter(nativeBle):null;const DISMISSED_KEY='zaycomm.homeAuthDismissed';

export default function AppV3(){
 const[peer,setPeer]=useState<Peer|null>(null);const[dismissed,setDismissed]=useState<string[]>([]);
 useEffect(()=>{AsyncStorage.getItem(DISMISSED_KEY).then(v=>{try{setDismissed(v?JSON.parse(v):[])}catch{setDismissed([])}})},[]);
 useEffect(()=>{if(!events)return;const ad=events.addListener('ZaycommBleAdvertisement',(p:Peer)=>{setPeer(p)});const link=events.addListener('ZaycommBleConnectionChanged',(e:{address:string;connected:boolean})=>{if(!e.connected)setPeer(current=>current?.address===e.address?null:current)});return()=>{ad.remove();link.remove()}},[]);
 const visible=!!peer&&!dismissed.includes(peer.address);
 const dismiss=async()=>{if(!peer)return;const next=[...dismissed,peer.address];setDismissed(next);await AsyncStorage.setItem(DISMISSED_KEY,JSON.stringify(next));setPeer(null)};
 return <><AppV2/>{peer&&<HomeAuthenticationOverlay visible={visible} peer={peer} onDismiss={dismiss}/>}</>;
}
