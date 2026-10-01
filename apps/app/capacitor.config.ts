import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.localmed.search',
  appName: 'LocalMed Search',
  webDir: 'dist',
  // Prereleases ship as debug builds, where Capacitor would echo every bridge call and result
  // (SQL rows, query text) to logcat: slow on large results and against the no-clinical-logs rule.
  loggingBehavior: 'none',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      style: 'DEFAULT',
      hidden: false,
    },
  },
};

export default config;
