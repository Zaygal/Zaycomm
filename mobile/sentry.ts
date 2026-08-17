import * as Sentry from '@sentry/react-native';

// Keep Sentry initialization in its own dependency so it executes before
// App.tsx is evaluated. This is important for startup-crash diagnostics.
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
  message: 'Sentry initialized before App.tsx evaluation',
  level: 'info',
});

// Diagnostic marker. This lets us verify that the new APK is actually
// communicating with the Zaycomm Sentry project before reproducing the crash.
Sentry.captureMessage('Zaycomm diagnostic build started', 'info');

export default Sentry;
