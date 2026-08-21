import {DeviceEventEmitter,EmitterSubscription,NativeModules,PermissionsAndroid} from 'react-native';
import {introduceZaycommQrIdentity,QrIdentityResult} from './qrIdentity';

export type ZaycommQrEvent={payload:string;length:number;identity?:QrIdentityResult};

const scanner=NativeModules.ZaycommCameraScanner;

// The current AppV2 scan action already requests CAMERA permission. Keep the
// camera start attached to that explicit request so Nearby -> Scan QR opens
// the native CameraX preview instead of navigating to the Pair surface.
const originalCameraRequest=PermissionsAndroid.request.bind(PermissionsAndroid);
PermissionsAndroid.request=async(permission:any,...args:any[])=>{
  const result=await originalCameraRequest(permission,...args);
  if(permission===PermissionsAndroid.PERMISSIONS.CAMERA&&result===PermissionsAndroid.RESULTS.GRANTED){
    try { await scanner?.prepareAnalysis?.(); } catch {}
  }
  return result;
};

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
