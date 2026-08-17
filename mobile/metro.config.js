const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Keep the React Native app as Metro's project root so dependencies resolve
// from mobile/node_modules, while allowing the shared protocol source in the
// repository-level src/ directory to be bundled.
const projectRoot = __dirname;
const repoRoot = path.resolve(__dirname, '..');
const mobileNodeModules = path.resolve(projectRoot, 'node_modules');
const repoNodeModules = path.resolve(repoRoot, 'node_modules');

const config = {
  projectRoot,
  watchFolders: [repoRoot],
  resolver: {
    // Shared files under repoRoot/src are outside projectRoot, so Metro's
    // normal hierarchical lookup would not walk into mobile/node_modules.
    // Explicitly expose the app dependency tree to those shared modules.
    nodeModulesPaths: [mobileNodeModules, repoNodeModules],
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
