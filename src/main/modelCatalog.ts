/**
 * OFFICE-X model catalog loading.
 *
 * Keep the catalog shipped with the app as the source of truth. This fork does
 * not poll the upstream Munder Difflin repository for runtime data; the
 * renderer already has the bundled model catalog and falls back to it whenever
 * this optional overlay is absent.
 */
import type { ModelCatalog } from '../shared/modelCatalogPayload';

export interface RemoteCatalogResult {
  /** null tells the renderer to keep using the catalog compiled into the build. */
  catalog: ModelCatalog | null;
  fetchedAt: number;
  stale: boolean;
}

export async function loadModelCatalog(
  _cachePath: string,
  _opts: { force?: boolean } = {}
): Promise<RemoteCatalogResult> {
  return { catalog: null, fetchedAt: 0, stale: true };
}
