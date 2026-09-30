// Gradle compiles Kotlin first; webpack reloads only the completed bundle.
config.watchOptions = { ...config.watchOptions, ignored: ['**/*.kt', '**/node_modules/**'] };
if (config.devServer) {
  config.devServer.host = '127.0.0.1';
  config.devServer.port = 4174;
  config.devServer.open = false;
  config.devServer.hot = false;
  config.devServer.liveReload = true;
  config.devServer.static = config.devServer.static.map((entry) =>
    typeof entry === 'string' ? { directory: entry, watch: false } : { ...entry, watch: false },
  );
}
