export const getNestedValue = (obj: unknown, path: string): unknown => {
  return path.split('.').reduce((curr: unknown, key: string) => {
    if (curr && typeof curr === 'object' && key in curr) {
      return (curr as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
};
