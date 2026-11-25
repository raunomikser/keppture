import type { SkpLibraryCatalog, SkpLibraryEntry } from '../types/visualizer';
import { type SkpParsedModel, ingestModelFile } from './skpParser';

const CATALOG_URL = '/skp-library/catalog.json';
const FILES_BASE = '/skp-library/files/';

let catalogPromise: Promise<SkpLibraryEntry[]> | null = null;

/** Load the packaged truss index once; files are fetched lazily on drop. */
export function loadSkpLibraryCatalog(): Promise<SkpLibraryEntry[]> {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`SketchUp truss catalog HTTP ${res.status}`);
        return res.json() as Promise<SkpLibraryCatalog>;
      })
      .then((catalog) => catalog.entries ?? [])
      .catch((err) => {
        catalogPromise = null;
        throw err;
      });
  }
  return catalogPromise;
}

const modelPromises = new Map<string, Promise<SkpParsedModel>>();

/** Fetch and parse one catalog GLB, centering it and aligning its long axis to local X. */
export function loadSkpLibraryModel(entry: SkpLibraryEntry): Promise<SkpParsedModel> {
  const existing = modelPromises.get(entry.id);
  if (existing) return existing;

  const promise = fetch(`${FILES_BASE}${entry.fileName}`)
    .then((res) => {
      if (!res.ok) throw new Error(`Truss model HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const file = new File([blob], entry.fileName, { type: 'model/gltf-binary' });
      return ingestModelFile(file, { normalizeTruss: true });
    })
    .catch((err) => {
      modelPromises.delete(entry.id);
      throw err;
    });

  modelPromises.set(entry.id, promise);
  return promise;
}
