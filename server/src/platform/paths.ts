import { resolve, sep } from 'node:path';
import { AppError } from './errors.js';

/**
 * Resolves `relativePath` within `cloneRoot` and verifies it does not escape
 * the clone directory (path traversal prevention).
 * Throws AppError('path_traversal', ..., 400) if the resolved path escapes.
 */
export function resolveAndValidatePath(cloneRoot: string, relativePath: string): string {
  const normalRoot = resolve(cloneRoot);
  const resolved = resolve(cloneRoot, relativePath);
  if (!resolved.startsWith(normalRoot + sep) && resolved !== normalRoot) {
    throw new AppError('path_traversal', `Path escapes clone directory: ${relativePath}`, 400);
  }
  return resolved;
}
