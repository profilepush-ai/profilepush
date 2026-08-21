import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.profilepush.app',
  appName: 'ProfilePush',
  webDir: 'dist',
  server: {
    url: 'https://profilepush.ai',
    androidScheme: 'https',
  },
};

export default config;
