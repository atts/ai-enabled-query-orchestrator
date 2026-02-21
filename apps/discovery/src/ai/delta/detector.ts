export function detectMissingFields(
  requested: string[],
  existing: string[],
): string[] {
  return requested.filter((field) => !existing.includes(field));
}
