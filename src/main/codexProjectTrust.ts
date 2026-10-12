import { parse } from 'toml';

/** Regenerating hive hooks must not erase folder decisions Codex saved in its
 * isolated home. Explicit global decisions still take precedence; this never
 * trusts a new folder or copies stale worker hooks/settings into the seed. */
export function preserveCodexProjectTrust(globalConfig: string, workerConfig: string): string {
  const globalProjects = parse(globalConfig).projects ?? {};
  const workerProjects = parse(workerConfig).projects ?? {};
  let config = globalConfig;
  for (const [path, project] of Object.entries(workerProjects)) {
    if (Object.prototype.hasOwnProperty.call(globalProjects, path)) continue;
    const level = (project as { trust_level?: unknown } | null)?.trust_level;
    if (level !== 'trusted' && level !== 'untrusted') continue;
    config += `\n[projects.${JSON.stringify(path)}]\ntrust_level = ${JSON.stringify(level)}\n`;
  }
  // Refuse to overwrite a saved decision with an invalid merged config (e.g.
  // a global inline projects table that cannot be extended with table headers).
  parse(config);
  return config;
}
