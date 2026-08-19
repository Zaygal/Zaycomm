import {DeviceEventEmitter,EmitterSubscription,NativeModules,PermissionsAndroid} from 'react-native';
import {introduceZaycommQrIdentity,QrIdentityResult} from './qrIdentity';

export type ZaycommQrEvent={payload:string;length:number;identity?:QrIdentityResult};

const scanner=NativeModules.ZaycommCameraScanner;
let scanRequested=false;

// The existing Nearby button requests CAMERA permission before switching to
// the Pair route. Record that explicit action so merely opening Pair never
// starts the camera. This is a one-shot gate consumed by the Pair subscriber.
const originalCameraRequest=PermissionsAndroid.request.bind(PermissionsAndroid);
PermissionsAndroid.request=async(permission:any,...args:any[])=>{
  if(permission===PermissionsAndroid.PERMISSIONS.CAMERA) scanRequested=true;
  return originalCameraRequest(permission,...args);
};

export function subscribeToZaycommQr(
  onDetected:(event:ZaycommQrEvent)=>void,
):EmitterSubscription{
  if(scanRequested){
    scanRequested=false;
    scanner?.prepareAnalysis?.().catch(()=>{});
  }
  const subscription=DeviceEventEmitter.addListener('ZaycommQrDetected',(event:{payload:string;length:number})=>{
    try {
      const identity=introduceZaycommQrIdentity(event.payload);
      scanner?.release?.().catch(()=>{});
      onDetected({...event,identity});
    } catch {
      scanner?.release?.().catch(()=>{});
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
