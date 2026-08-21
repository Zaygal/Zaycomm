import {DeviceEventEmitter,EmitterSubscription,NativeModules,PermissionsAndroid} from 'react-native';
import {introduceZaycommQrIdentity,QrIdentityResult} from './qrIdentity';

export type ZaycommQrEvent={payload:string;length:number;identity?:QrIdentityResult};

const scanner=NativeModules.ZaycommCameraScanner;
let scanRequested=false;

// Camera startup is tied to the explicit Nearby scan action. The camera is
// prepared immediately after permission resolves, before React navigates to
// the Pair surface, so the Pair identity QR cannot flash underneath it.
const originalCameraRequest=PermissionsAndroid.request.bind(PermissionsAndroid);
PermissionsAndroid.request=async(permission:any,...args:any[])=>{
  const result=await originalCameraRequest(permission,...args);
  if(permission===PermissionsAndroid.PERMISSIONS.CAMERA&&result===PermissionsAndroid.RESULTS.GRANTED){
    scanRequested=true;
    scanner?.prepareAnalysis?.().catch(()=>{});
  }
  return result;
};

export function subscribeToZaycommQr(
  onDetected:(event:ZaycommQrEvent)=>void,
):EmitterSubscription{
  scanRequested=false;
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