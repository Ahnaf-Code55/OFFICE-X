/** Parse the opt-in GitHub owner/repository setting used by release checks. */
export function parseReleaseRepository(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : undefined;
}
