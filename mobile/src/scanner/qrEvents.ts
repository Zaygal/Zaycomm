import {DeviceEventEmitter,EmitterSubscription,NativeModules,PermissionsAndroid} from 'react-native';
import {introduceZaycommQrIdentity,QrIdentityResult} from './qrIdentity';

export type ZaycommQrEvent={payload:string;length:number;identity?:QrIdentityResult};

const scanner=NativeModules.ZaycommCameraScanner;
let scanRequested=false;

// The Nearby action owns scanner startup. Permission is requested first, then
// the native scanner is started on the next turn so the Pair surface has time
// to mount its QR event subscription. The native scanner renders its own
// dedicated camera surface above the React UI; Pair is only the existing
// result/identity surface and must never be mistaken for the camera screen.
const originalCameraRequest=PermissionsAndroid.request.bind(PermissionsAndroid);
PermissionsAndroid.request=async(permission:any,...args:any[])=>{
  const result=await originalCameraRequest(permission,...args);
  if(permission===PermissionsAndroid.PERMISSIONS.CAMERA&&result===PermissionsAndroid.RESULTS.GRANTED){
    scanRequested=true;
    setTimeout(()=>{
      if(scanRequested)scanner?.prepareAnalysis?.().catch(()=>{});
    },250);
  }
  return result;
};

export function subscribeToZaycommQr(
  onDetected:(event:ZaycommQrEvent)=>void,
):EmitterSubscription{
  scanRequested=true;
  const subscription=DeviceEventEmitter.addListener('ZaycommQrDetected',(event:{payload:string;length:number})=>{
    try {
      const identity=introduceZaycommQrIdentity(event.payload);
      scanRequested=false;
      scanner?.release?.().catch(()=>{});
      onDetected({...event,identity});
    } catch {
      scanner?.release?.().catch(()=>{});
    }
  });
  const originalRemove=subscription.remove.bind(subscription);
  subscription.remove=()=>{
    scanRequested=false;
    scanner?.release?.().catch(()=>{});
    originalRemove();
  };
  return subscription;
}

export async function startZaycommQrScanner():Promise<boolean>{
  if(!scanner?.prepareAnalysis)return false;
  scanRequested=true;
  return Boolean(await scanner.prepareAnalysis());
}

export async function stopZaycommQrScanner():Promise<void>{
  scanRequested=false;
  await scanner?.release?.();
}
