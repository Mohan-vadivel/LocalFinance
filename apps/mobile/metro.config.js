// Expo's default config already understands pnpm workspaces (watches the repo root, resolves hoisted modules).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
