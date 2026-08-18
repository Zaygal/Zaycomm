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

Sentry.captureMessage('Zaycomm diagnostic build started', 'info');

// Startup crash instrumentation. These markers intentionally do not change
// application behavior; they establish exactly how far the process gets
// through the known 700ms splash -> Home boundary.
setTimeout(() => {
  Sentry.addBreadcrumb({
    category: 'zaycomm.startup',
    message: '600ms: still alive before expected Home transition',
    level: 'info',
  });
  Sentry.captureMessage('Zaycomm startup checkpoint: 600ms', 'info');
}, 600);

setTimeout(() => {
  Sentry.addBreadcrumb({
    category: 'zaycomm.startup',
    message: '690ms: immediately before expected Home transition',
    level: 'info',
  });
  Sentry.captureMessage('Zaycomm startup checkpoint: 690ms', 'info');
}, 690);

setTimeout(() => {
  Sentry.addBreadcrumb({
    category: 'zaycomm.startup',
    message: '900ms: process survived expected Home transition',
    level: 'info',
  });
  Sentry.captureMessage('Zaycomm startup checkpoint: 900ms', 'info');
}, 900);

export default Sentry;
