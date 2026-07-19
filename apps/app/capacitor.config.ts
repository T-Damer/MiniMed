import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.localmed.search',
  appName: 'LocalMed Search',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
