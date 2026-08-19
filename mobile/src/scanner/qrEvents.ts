import {DeviceEventEmitter,EmitterSubscription,NativeModules} from 'react-native';
import {introduceZaycommQrIdentity,QrIdentityResult} from './qrIdentity';

export type ZaycommQrEvent={payload:string;length:number;identity?:QrIdentityResult};

const scanner=NativeModules.ZaycommCameraScanner;

/**
 * Pair/Nearby scanner hook. A valid Zaycomm QR is introduced to the existing
 * identity model before the event is delivered to the UI. No transport is
 * started here; routing/connection remains a separate layer.
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
  scanner?.prepareAnalysis?.().catch(()=>{});
  const originalRemove=subscription.remove.bind(subscription);
  subscription.remove=()=>{
    scanner?.release?.().catch(()=>{});
    originalRemove();
  };
  return subscription;
}
