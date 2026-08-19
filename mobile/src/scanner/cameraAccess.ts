export type CameraAccessState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'ready' }
  | { status: 'denied'; message: string }
  | { status: 'error'; message: string };

export function cameraPermissionMessage(reason: 'denied' | 'blocked' | 'error'): string {
  switch (reason) {
    case 'denied':
      return 'Camera access is required to scan a Zaycomm device. Allow camera access and try again.';
    case 'blocked':
      return 'Camera access is blocked. Enable camera permission in your device settings, then try again.';
    case 'error':
      return 'Zaycomm could not start the camera. Please try again.';
  }
}

export function cameraDeniedState(reason: 'denied' | 'blocked' | 'error'): CameraAccessState {
  if (reason === 'error') return { status: 'error', message: cameraPermissionMessage(reason) };
  return { status: 'denied', message: cameraPermissionMessage(reason) };
}
