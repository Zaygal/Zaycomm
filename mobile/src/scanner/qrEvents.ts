import {DeviceEventEmitter,EmitterSubscription,NativeModules} from 'react-native';
import {introduceZaycommQrIdentity,QrIdentityResult} from './qrIdentity';

export type ZaycommQrEvent={payload:string;length:number;identity?:QrIdentityResult};

const scanner=NativeModules.ZaycommCameraScanner;

/**
 * Subscribes to scanner results only. Camera lifecycle is deliberately owned
 * by the explicit "Scan QR Code" action, not by the Pair tab.
 */
export function subscribeToZaycommQr(
  onDetected:(event:ZaycommQrEvent)=>void,
):EmitterSubscription{
  const subscription=DeviceEventEmitter.addListener('ZaycommQrDetected',(event:{payload:string;length:number})=>{
    try {
      const identity=introduceZaycommQrIdentity(event.payload);
      onDetected({...event,identity});
    } catch {
      // Invalid payload handling belongs to the dedicated scanner UX phase.
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
  return Boolean(await scanner.prepareAnalysis());
}

export async function stopZaycommQrScanner():Promise<void>{
  await scanner?.release?.();
}
