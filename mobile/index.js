import * as Sentry from '@sentry/react-native';
import {AppRegistry} from 'react-native';
import App from './App';

// Initialize Sentry before the application component is imported into the
// React tree so startup JavaScript failures are captured as early as possible.
Sentry.init({
  dsn: 'https://99202c61c489b29c7786155723317700@o4511926121201664.ingest.de.sentry.io/4511926169632848',
  environment: 'diagnostic',
  debug: true,
  enabled: true,
  enableNative: true,
  enableNativeCrashHandling: true,
  autoInitializeNativeSdk: true,
  enableNdk: true,
  enableTombstone: true,
  attachThreads: true,
  enableAutoSessionTracking: true,
  tracesSampleRate: 0,
});

Sentry.addBreadcrumb({
  category: 'zaycomm.startup',
  message: 'index.js loaded; Sentry initialized',
  level: 'info',
});

// Diagnostic marker: confirms that Sentry can receive events from this build.
Sentry.captureMessage('Zaycomm diagnostic build started', 'info');

// Must match MainActivity#getMainComponentName().
AppRegistry.registerComponent('ZaycommMobile', () => Sentry.wrap(App));
