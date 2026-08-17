const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Zaycomm keeps the shared TypeScript protocol code in the repository-level
// src/ directory, one level above the React Native mobile app.
const repoRoot = path.resolve(__dirname, '..');

const config = {
  projectRoot: repoRoot,
  watchFolders: [__dirname],
};

module.exports = mergeConfig(getDefaultConfig(repoRoot), config);
