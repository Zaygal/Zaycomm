const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Keep the React Native app as Metro's project root so dependencies resolve
// from mobile/node_modules, while allowing the shared protocol source in the
// repository-level src/ directory to be bundled.
const projectRoot = __dirname;
const repoRoot = path.resolve(__dirname, '..');

const config = {
  projectRoot,
  watchFolders: [repoRoot],
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
