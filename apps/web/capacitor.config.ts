import type { CapacitorConfig } from '@capacitor/cli';

/** The Android app wraps the same web build (`pnpm build:native`). */
const config: CapacitorConfig = {
  appId: 'com.sensinth.app',
  appName: 'Sensinth',
  webDir: 'dist',
  android: {
    // Sensors and audio must not be throttled while the app is in front.
    backgroundColor: '#0e1317',
  },
};

export default config;
