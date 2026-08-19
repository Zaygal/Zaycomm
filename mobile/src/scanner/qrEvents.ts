import {DeviceEventEmitter,EmitterSubscription,NativeModules} from 'react-native';

export type ZaycommQrEvent={payload:string;length:number};

const scanner=NativeModules.ZaycommCameraScanner;

/**
 * Pair-screen scanner hook. Subscribing starts the native camera analysis;
 * removing the subscription releases it again.
 */
export function subscribeToZaycommQr(
  onDetected:(event:ZaycommQrEvent)=>void,
):EmitterSubscription{
  const subscription=DeviceEventEmitter.addListener('ZaycommQrDetected',onDetected);
  scanner?.prepareAnalysis?.().catch(()=>{});
  const originalRemove=subscription.remove.bind(subscription);
  subscription.remove=()=>{
    scanner?.release?.().catch(()=>{});
    originalRemove();
  };
  return subscription;
}
