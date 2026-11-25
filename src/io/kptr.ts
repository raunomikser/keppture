import JSZip from 'jszip';
import { createInitialDmxUniverses, DmxUniversesMap } from '../gdtf/dmxEngine';
import { GdtfProfile } from '../gdtf/types';
import {
  getVfsAssets,
  RawGdtfAsset,
  restoreGdtfProfileFromAssets,
} from '../gdtf/vfsAndCache';
import {
  deserializeSkpModel,
  registerSkpModel,
  serializeSkpModel,
  SerializedSkpModel,
  SkpParsedModel,
} from '../skp/skpParser';
import { ProjectDocument } from '../types/visualizer';

export const KPTR_MIME = 'application/x-capture-project+zip';
const KPTR_FORMAT = 'kptr';
const KPTR_VERSION = 1;
const GENERATOR = 'Keppture Lighting Visualizer';

/** Complete project state stored in one .kptr container. */
export interface KptrProject extends ProjectDocument {
  dmxUniverses: DmxUniversesMap;
  gdtfProfiles: GdtfProfile[];
  skpModels: SkpParsedModel[];
}

interface KptrManifest {
  format: 'kptr';
  version: number;
  mimeType: string;
  generator: string;
  createdAt: string;
  core: string;
  assetCounts: {
    gdtfProfiles: number;
    skpModels: number;
  };
}

interface KptrPayload {
  core: ProjectDocument;
  dmx: Record<string, string>;
  gdtfProfileIds: string[];
  skpModelIds: string[];
}

interface KptrGdtfIndex {
  profileId: string;
  assets: Array<{
    path: string;
    mimeType: string;
    size: number;
    file: string;
  }>;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function safeZipPath(prefix: string, rawPath: string, index: number): string {
  const segments = rawPath
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..');
  const tail = segments.join('/') || `asset-${index}`;
  return `${prefix}/${String(index).padStart(3, '0')}-${tail}`;
}

export function isKptrFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.kptr') || file.type === KPTR_MIME;
}

/**
 * Write a .kptr container: an uncompressed `mimetype` marker, a versioned
 * manifest, the JSON project core, DMX universe bytes, GDTF packages with
 * their original VFS assets, and serialized SKP models.
 */
export async function exportKptr(project: KptrProject): Promise<Blob> {
  const zip = new JSZip();
  zip.file('mimetype', KPTR_MIME, { compression: 'STORE' });

  const gdtfProfileIds: string[] = [];
  for (const profile of project.gdtfProfiles) {
    const dir = `assets/gdtf/${encodeURIComponent(profile.id)}`;
    const assets = getVfsAssets(profile.id);
    const entries = assets.map((asset, index) => ({
      path: asset.path,
      mimeType: asset.mimeType,
      size: asset.data.byteLength,
      file: safeZipPath(dir, asset.path, index),
    }));

    zip.file(`${dir}/profile.json`, JSON.stringify(profile, null, 2));
    zip.file(
      `${dir}/index.json`,
      JSON.stringify({ profileId: profile.id, assets: entries } satisfies KptrGdtfIndex, null, 2),
    );
    entries.forEach((entry, index) => {
      zip.file(entry.file, assets[index].data);
    });
    gdtfProfileIds.push(profile.id);
  }

  const skpModelIds: string[] = [];
  for (const model of project.skpModels) {
    const path = `assets/skp/${encodeURIComponent(model.id)}.json`;
    zip.file(path, JSON.stringify(serializeSkpModel(model), null, 2));
    skpModelIds.push(model.id);
  }

  const core: ProjectDocument = {
    version: project.version,
    metadata: project.metadata,
    objects: project.objects,
    layers: project.layers,
    viewports: project.viewports,
    snapshots: project.snapshots,
    cameraPresets: project.cameraPresets,
  };

  const dmx: Record<string, string> = {};
  for (const [key, buffer] of Object.entries(project.dmxUniverses)) {
    const view = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    dmx[key] = bytesToBase64(view);
  }

  const payload: KptrPayload = {
    core,
    dmx,
    gdtfProfileIds,
    skpModelIds,
  };
  zip.file('project.json', JSON.stringify(payload, null, 2));

  const manifest: KptrManifest = {
    format: KPTR_FORMAT,
    version: KPTR_VERSION,
    mimeType: KPTR_MIME,
    generator: GENERATOR,
    createdAt: new Date().toISOString(),
    core: 'project.json',
    assetCounts: {
      gdtfProfiles: gdtfProfileIds.length,
      skpModels: skpModelIds.length,
    },
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Read a .kptr container and rehydrate all runtime registries it contains. */
export async function importKptr(input: File | Blob | ArrayBuffer): Promise<KptrProject> {
  const zip = await JSZip.loadAsync(input);

  const marker = zip.file('mimetype');
  if (!marker) throw new Error('Not a .kptr file: missing mimetype marker');
  const mime = (await marker.async('string')).trim();
  if (mime !== KPTR_MIME) throw new Error(`Unsupported .kptr mime type: ${mime}`);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('Corrupt .kptr file: missing manifest.json');
  const manifest = JSON.parse(await manifestFile.async('string')) as KptrManifest;
  if (manifest.format !== KPTR_FORMAT) {
    throw new Error(`Unsupported project format: ${String(manifest.format)}`);
  }
  if (manifest.version > KPTR_VERSION) {
    throw new Error(
      `This .kptr file was written by a newer version (v${manifest.version}); current support is v${KPTR_VERSION}.`,
    );
  }

  const projectFile = zip.file(manifest.core || 'project.json');
  if (!projectFile) throw new Error('Corrupt .kptr file: missing project.json');
  const payload = JSON.parse(await projectFile.async('string')) as KptrPayload;
  const core = payload.core;
  if (!core || !core.metadata || !Array.isArray(core.objects)) {
    throw new Error('Corrupt .kptr file: invalid project core');
  }

  const dmxUniverses = createInitialDmxUniverses();
  for (const [key, encoded] of Object.entries(payload.dmx || {})) {
    const universe = Number(key);
    if (!Number.isFinite(universe)) continue;
    dmxUniverses[universe] = base64ToBytes(encoded);
  }

  const gdtfProfiles: GdtfProfile[] = [];
  for (const profileId of payload.gdtfProfileIds || []) {
    const dir = `assets/gdtf/${encodeURIComponent(profileId)}`;
    const profileFile = zip.file(`${dir}/profile.json`);
    const indexFile = zip.file(`${dir}/index.json`);
    if (!profileFile || !indexFile) {
      throw new Error(`Corrupt .kptr file: missing GDTF profile "${profileId}"`);
    }
    const profile = JSON.parse(await profileFile.async('string')) as GdtfProfile;
    const index = JSON.parse(await indexFile.async('string')) as KptrGdtfIndex;
    const assets: RawGdtfAsset[] = [];
    for (const item of index.assets) {
      const assetFile = zip.file(item.file);
      if (!assetFile) {
        throw new Error(`Corrupt .kptr file: missing GDTF asset "${item.path}"`);
      }
      assets.push({
        path: item.path,
        mimeType: item.mimeType,
        data: await assetFile.async('arraybuffer'),
      });
    }
    gdtfProfiles.push(await restoreGdtfProfileFromAssets(profile, assets));
  }

  const skpModels: SkpParsedModel[] = [];
  for (const modelId of payload.skpModelIds || []) {
    const modelFile = zip.file(`assets/skp/${encodeURIComponent(modelId)}.json`);
    if (!modelFile) {
      throw new Error(`Corrupt .kptr file: missing SKP model "${modelId}"`);
    }
    const serialized = JSON.parse(await modelFile.async('string')) as SerializedSkpModel;
    const model = deserializeSkpModel(serialized);
    registerSkpModel(model);
    skpModels.push(model);
  }

  return {
    ...core,
    version: core.version || KPTR_VERSION,
    dmxUniverses,
    gdtfProfiles,
    skpModels,
  };
}
