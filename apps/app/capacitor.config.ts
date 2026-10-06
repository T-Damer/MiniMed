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
  ios: {
    // The web view is white until the page paints; the boot surface and the launch screen are this
    // colour, so the start has no white frame between them.
    backgroundColor: '#f3ecd9',
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
