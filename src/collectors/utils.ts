// src/collectors/utils.ts

/**
 * Extracts a nested value from an object using a dot-separated path.
 * extractByPath({ a: { b: [1,2] } }, 'a.b') → [1,2]
 * Returns the original data if path is empty/undefined.
 */
export function extractByPath(data: unknown, path: string | undefined): unknown {
  if (!path) return data;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return acc;
  }, data);
}
