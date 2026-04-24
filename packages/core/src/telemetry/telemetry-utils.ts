/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLanguageFromFilePath } from '../util/language-detection.ts';

export function getProgrammingLanguage(
  args: Record<string, unknown>,
): string | undefined {
  const filePath = args['file_path'] || args['path'] || args['absolute_path'];
  if (typeof filePath === 'string') {
    return getLanguageFromFilePath(filePath);
  }
  return undefined;
}
