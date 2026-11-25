import { GdtfLibraryEntry } from '../types/visualizer';
import { GdtfProfile } from './types';
import { ingestGdtfArchive } from './vfsAndCache';

const CATALOG_URL = '/gdtf-library/catalog.json';
const FILES_BASE = '/gdtf-library/';

let catalogPromise: Promise<GdtfLibraryEntry[]> | null = null;

/** Load the lightweight library index once. Entries reference real .gdtf archives. */
export function loadGdtfLibraryCatalog(): Promise<GdtfLibraryEntry[]> {
  if (!catalogPromise) {
    catalogPromise = fetch(CATALOG_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`GDTF catalog HTTP ${res.status}`);
        return res.json() as Promise<GdtfLibraryEntry[]>;
      })
      .catch((err) => {
        catalogPromise = null;
        throw err;
      });
  }
  return catalogPromise;
}

const profilePromises = new Map<string, Promise<GdtfProfile>>();

/**
 * Fetch and parse the real .gdtf archive for a catalog entry on demand.
 * The parsed profile is also cached in IndexedDB by ingestGdtfArchive.
 */
export function loadGdtfLibraryProfile(entry: GdtfLibraryEntry): Promise<GdtfProfile> {
  if (!entry.file) return Promise.reject(new Error(`No GDTF file for "${entry.name}"`));
  const key = entry.file;
  const existing = profilePromises.get(key);
  if (existing) return existing;

  const promise = fetch(FILES_BASE + entry.file)
    .then((res) => {
      if (!res.ok) throw new Error(`GDTF file HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const fileName = entry.file!.split('/').pop() || `${entry.id}.gdtf`;
      return ingestGdtfArchive(blob, fileName);
    })
    .catch((err) => {
      profilePromises.delete(key);
      throw err;
    });
  profilePromises.set(key, promise);
  return promise;
}
