import {DeviceEventEmitter, EmitterSubscription} from 'react-native';

export type ZaycommQrEvent={payload:string;length:number};

/**
 * React Native-side scanner event hook.
 *
 * The native CameraX/ML Kit module emits `ZaycommQrDetected` through the
 * React Native device event emitter. Keeping this listener isolated lets the
 * Pair UI consume scanner events without changing AppV2 in this step.
 */
export function subscribeToZaycommQr(
  onDetected:(event:ZaycommQrEvent)=>void,
):EmitterSubscription{
  return DeviceEventEmitter.addListener('ZaycommQrDetected',onDetected);
}
