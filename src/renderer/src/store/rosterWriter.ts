/** One active disk writer per hive in this renderer. Development reloads can
 * leave an older module's unload listener alive; its boot snapshot must never
 * overwrite hires or edits made by the replacement store. */
const registryKey = Symbol.for('office-x.roster-writer-leases');
const globals = globalThis as typeof globalThis & { [key: symbol]: Map<string, symbol> | undefined };
const registry = globals[registryKey] ?? (globals[registryKey] = new Map());

export function claimRosterWriter(home: string | null, owners = registry): () => boolean {
  const key = home ?? '<unconfigured>';
  const token = Symbol();
  owners.set(key, token);
  return () => owners.get(key) === token;
}
