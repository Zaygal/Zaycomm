import {DeviceEventEmitter,EmitterSubscription,NativeModules} from 'react-native';
import {introduceZaycommQrIdentity,QrIdentityResult} from './qrIdentity';

export type ZaycommQrEvent={payload:string;length:number;identity?:QrIdentityResult};

const scanner=NativeModules.ZaycommCameraScanner;

export function subscribeToZaycommQr(
  onDetected:(event:ZaycommQrEvent)=>void,
):EmitterSubscription{
  const subscription=DeviceEventEmitter.addListener('ZaycommQrDetected',(event:{payload:string;length:number})=>{
    try {
      const identity=introduceZaycommQrIdentity(event.payload);
      scanner?.release?.().catch(()=>{});
      onDetected({...event,identity});
    } catch {
      // Ignore non-Zaycomm QR payloads; the native scanner filters most invalid frames.
    }
  });
  const originalRemove=subscription.remove.bind(subscription);
  subscription.remove=()=>{
    scanner?.release?.().catch(()=>{});
    originalRemove();
  };
  return subscription;
}

export async function startZaycommQrScanner():Promise<boolean>{
  if(!scanner?.prepareAnalysis)return false;
  try {
    return Boolean(await scanner.prepareAnalysis());
  } catch {
    return false;
  }
}

export async function stopZaycommQrScanner():Promise<void>{
  try { await scanner?.release?.(); } catch {}
}
