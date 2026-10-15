export type PackCatalogEntry = {
  lang: string;
  version: string;
  lemma_filename: string;
  lemma_download_url: string;
  tag: string;
  corpus: {
    "Data source"?: string;
    "Corpora used"?: string;
    "Note"?: string;
  }[];
};

const PACK_CATALOG_SNAPSHOT_KEY = "pack-catalog-snapshot-v1";

function hasWindow() {
  return typeof window !== "undefined";
}

export function readPackCatalogSnapshot() {
  if (!hasWindow()) {
    return [] as PackCatalogEntry[];
  }

  const raw = window.localStorage.getItem(PACK_CATALOG_SNAPSHOT_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PackCatalogEntry[]) : [];
  } catch {
    window.localStorage.removeItem(PACK_CATALOG_SNAPSHOT_KEY);
    return [];
  }
}

export function writePackCatalogSnapshot(packs: PackCatalogEntry[]) {
  if (!hasWindow()) {
    return;
  }

  window.localStorage.setItem(PACK_CATALOG_SNAPSHOT_KEY, JSON.stringify(packs));
}
