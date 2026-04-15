const { existsSync } = require('fs');
const { join } = require('path');

// The binary is moved to packages/native/bin/
const bindingPath = join(__dirname, '..', 'bin', 'navi-native.node');

if (existsSync(bindingPath)) {
  module.exports = require(bindingPath);
} else {
  // Try local first (for dev)
  try {
     module.exports = require('../bin/navi-native.node');
  } catch (e) {
     console.error('Failed to load @navi-ai/native binary. Missing navi-native.node in bin directory.');
     throw e;
  }
}
