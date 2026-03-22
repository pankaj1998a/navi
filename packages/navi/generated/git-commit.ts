/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generated git commit information for telemetry.
 * This file is auto-generated during the build process.
 */

// Git commit hash at build time
export const GIT_COMMIT_INFO = process.env['GIT_COMMIT_HASH'] || 'development';

// CLI version from package.json
export const CLI_VERSION = process.env['npm_package_version'] || '0.0.0-dev';
