import JSZip from 'jszip';
import { GdtfProfile, GdtfVfsEntry } from './types';
import { parseGdtfDescriptionXml } from './xmlParser';

const DB_NAME = 'capture_gdtf_cache_v1';
const STORE_NAME = 'profiles';
const DB_VERSION = 1;

interface CachedGdtfRecord {
  id: string;
  profile: GdtfProfile;
  assets: Array<{
    path: string;
    mimeType: string;
    data: ArrayBuffer;
  }>;
}

// In-memory Virtual File System: profileId -> (normalizedPath -> GdtfVfsEntry)
const vfsStore = new Map<string, Map<string, GdtfVfsEntry>>();

function guessMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.glb')) return 'model/gltf-binary';
  if (lower.endsWith('.gltf')) return 'model/gltf+json';
  if (lower.endsWith('.bin')) return 'application/octet-stream';
  if (lower.endsWith('.3ds')) return 'application/x-3ds';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.xml')) return 'application/xml';
  return 'application/octet-stream';
}

function normalizeVfsKey(p: string): string {
  return p.replace(/^\.?\//, '').replace(/\\/g, '/').toLowerCase();
}

export function getVfsMap(profileId: string): Map<string, GdtfVfsEntry> | undefined {
  return vfsStore.get(profileId);
}

export interface RawGdtfAsset {
  path: string;
  mimeType: string;
  data: ArrayBuffer;
}

/** Raw VFS payloads for a profile, used by the .kptr project container. */
export function getVfsAssets(profileId: string): RawGdtfAsset[] {
  const map = vfsStore.get(profileId);
  if (!map) return [];
  return Array.from(map.values()).map((entry) => ({
    path: entry.path,
    mimeType: entry.mimeType,
    data: entry.data.slice(0),
  }));
}

/** Register a profile restored from a .kptr file in both memory and IndexedDB. */
export async function restoreGdtfProfileFromAssets(
  profile: GdtfProfile,
  assets: RawGdtfAsset[],
): Promise<GdtfProfile> {
  registerVfsAssets(profile.id, assets);
  await saveRecordToDb({ id: profile.id, profile, assets });
  return profile;
}

/**
 * Look up a VFS asset by exact relative path, basename, or filename without extension
 * (GDTF description.xml frequently omits file extensions on Model File & MediaFileName).
 */
export function resolveVfsAsset(
  profileId: string,
  refName?: string,
  preferredExtensions?: string[],
): GdtfVfsEntry | undefined {
  if (!refName) return undefined;
  const map = vfsStore.get(profileId);
  if (!map) return undefined;

  const clean = normalizeVfsKey(refName);
  const direct = map.get(clean);
  if (direct) return direct;

  const base = clean.split('/').pop() || clean;
  for (const [key, entry] of map.entries()) {
    const keyBase = key.split('/').pop() || key;
    if (keyBase === base) return entry;
    const keyNoExt = keyBase.replace(/\.[^.]+$/, '');
    if (keyNoExt === base) {
      if (!preferredExtensions || preferredExtensions.some((ext) => keyBase.endsWith(ext))) {
        return entry;
      }
    }
  }
  return undefined;
}

function registerVfsAssets(
  profileId: string,
  rawAssets: Array<{ path: string; mimeType: string; data: ArrayBuffer }>,
) {
  // Revoke previous object URLs if replacing profile
  const prev = vfsStore.get(profileId);
  if (prev) {
    for (const entry of prev.values()) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  }

  const map = new Map<string, GdtfVfsEntry>();
  for (const item of rawAssets) {
    const norm = normalizeVfsKey(item.path);
    const blob = new Blob([item.data], { type: item.mimeType });
    const objectUrl = URL.createObjectURL(blob);
    map.set(norm, {
      path: item.path,
      mimeType: item.mimeType,
      size: item.data.byteLength,
      objectUrl,
      data: item.data,
    });
  }
  vfsStore.set(profileId, map);
}

function openGdtfDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRecordToDb(record: CachedGdtfRecord): Promise<void> {
  try {
    const db = await openGdtfDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable in private/restricted context; memory VFS still works
  }
}

export async function restoreCachedGdtfProfiles(): Promise<GdtfProfile[]> {
  try {
    const db = await openGdtfDb();
    const records = await new Promise<CachedGdtfRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as CachedGdtfRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();

    const profiles: GdtfProfile[] = [];
    for (const rec of records) {
      registerVfsAssets(rec.id, rec.assets);
      profiles.push(rec.profile);
    }
    return profiles;
  } catch {
    return [];
  }
}

export async function deleteCachedGdtfProfile(profileId: string): Promise<void> {
  const prev = vfsStore.get(profileId);
  if (prev) {
    for (const entry of prev.values()) {
      URL.revokeObjectURL(entry.objectUrl);
    }
    vfsStore.delete(profileId);
  }
  try {
    const db = await openGdtfDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(profileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

/**
 * Unpack a .gdtf ZIP archive client-side with JSZip, validate description.xml,
 * populate the in-memory VFS with object URLs, parse DIN SPEC 15800 XML,
 * and persist in IndexedDB.
 */
export async function ingestGdtfArchive(
  input: File | ArrayBuffer | Blob,
  fileName: string,
): Promise<GdtfProfile> {
  const zip = await JSZip.loadAsync(input);

  // Locate description.xml at package root
  let descriptionFile = zip.file('description.xml');
  if (!descriptionFile) {
    const matchKey = Object.keys(zip.files).find(
      (k) => !zip.files[k].dir && k.replace(/^\.?\//, '').toLowerCase() === 'description.xml',
    );
    if (matchKey) {
      descriptionFile = zip.file(matchKey);
    }
  }
  if (!descriptionFile) {
    throw new Error(`Invalid GDTF archive "${fileName}": missing description.xml at package root.`);
  }

  const xmlText = await descriptionFile.async('string');

  const rawAssets: Array<{ path: string; mimeType: string; data: ArrayBuffer }> = [];
  const vfsFiles: string[] = [];

  const fileEntries = Object.entries(zip.files);
  for (const [entryPath, zipObj] of fileEntries) {
    if (zipObj.dir) continue;
    const norm = normalizeVfsKey(entryPath);
    if (norm === 'description.xml') continue;
    const data = await zipObj.async('arraybuffer');
    const mimeType = guessMimeType(entryPath);
    rawAssets.push({ path: entryPath, mimeType, data });
    vfsFiles.push(entryPath);
  }

  const profile = parseGdtfDescriptionXml(xmlText, fileName, vfsFiles);
  registerVfsAssets(profile.id, rawAssets);

  await saveRecordToDb({
    id: profile.id,
    profile,
    assets: rawAssets,
  });

  return profile;
}

/** Helper to render a procedural gobo PNG into an ArrayBuffer for sample GDTF package */
function renderProceduralGoboPng(
  pattern: 'radial' | 'starburst' | 'bars' | 'dots' | 'thumb',
): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#FFFFFF';

  if (pattern === 'thumb') {
    ctx.fillStyle = '#1B3311';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#6BC938';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 16, 92, 22);
    ctx.strokeRect(26, 38, 76, 44);
    ctx.beginPath();
    ctx.arc(64, 72, 24, 0, Math.PI * 2);
    ctx.stroke();
  } else if (pattern === 'radial') {
    ctx.translate(64, 64);
    for (let i = 0; i < 8; i++) {
      ctx.rotate((Math.PI * 2) / 8);
      ctx.beginPath();
      ctx.moveTo(10, -4);
      ctx.lineTo(54, -10);
      ctx.lineTo(54, 10);
      ctx.lineTo(10, 4);
      ctx.closePath();
      ctx.fill();
    }
  } else if (pattern === 'starburst') {
    ctx.translate(64, 64);
    for (let i = 0; i < 12; i++) {
      ctx.rotate((Math.PI * 2) / 12);
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(56, -4);
      ctx.lineTo(56, 4);
      ctx.closePath();
      ctx.fill();
    }
  } else if (pattern === 'bars') {
    for (let x = 18; x <= 102; x += 22) {
      ctx.fillRect(x, 16, 10, 96);
    }
  } else if (pattern === 'dots') {
    ctx.beginPath();
    ctx.arc(64, 64, 11, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(new ArrayBuffer(0));
        return;
      }
      blob.arrayBuffer().then(resolve);
    }, 'image/png');
  });
}

/**
 * Generates an authentic DIN SPEC 15800 .gdtf ZIP package in memory via JSZip
 * and runs it through the full client-side ingestGdtfArchive pipeline.
 */
export async function generateAndImportSampleGdtf(): Promise<{
  profile: GdtfProfile;
  archiveBlob: Blob;
}> {
  const zip = new JSZip();

  const descriptionXml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<GDTF DataVersion="1.2">
  <FixtureType CanHaveChildren="Yes" Description="Enterprise 16-bit Hybrid Profile Moving Head with CMY/RGB mixing, Rotating Gobo Wheel, and Motorized Zoom" FixtureTypeID="D7F4B210-9E44-4A81-8C1F-884015800001" LongName="ApexBeam 700 Hybrid Profile" Manufacturer="Aether Stage Optics" Name="ApexBeam 700" RefFT="" ShortName="AB700" Thumbnail="thumbnail">
    <AttributeDefinitions>
      <ActivationGroups>
        <ActivationGroup Name="PanTilt"/>
        <ActivationGroup Name="ColorRGB"/>
        <ActivationGroup Name="Gobo1"/>
        <ActivationGroup Name="Beam"/>
      </ActivationGroups>
      <FeatureGroups>
        <FeatureGroup Name="Dimmer" Pretty="Dimmer">
          <Feature Name="Dimmer"/>
        </FeatureGroup>
        <FeatureGroup Name="Position" Pretty="Position">
          <Feature Name="PanTilt"/>
        </FeatureGroup>
        <FeatureGroup Name="Color" Pretty="Color">
          <Feature Name="RGB"/>
        </FeatureGroup>
        <FeatureGroup Name="Gobo" Pretty="Gobo">
          <Feature Name="Gobo"/>
        </FeatureGroup>
        <FeatureGroup Name="Beam" Pretty="Beam">
          <Feature Name="Beam"/>
        </FeatureGroup>
      </FeatureGroups>
      <Attributes>
        <Attribute Feature="Dimmer.Dimmer" Name="Dimmer" PhysicalUnit="None" Pretty="Dim"/>
        <Attribute ActivationGroup="PanTilt" Feature="Position.PanTilt" Name="Pan" PhysicalUnit="Angle" Pretty="P"/>
        <Attribute ActivationGroup="PanTilt" Feature="Position.PanTilt" Name="Tilt" PhysicalUnit="Angle" Pretty="T"/>
        <Attribute ActivationGroup="ColorRGB" Feature="Color.RGB" Name="ColorAdd_R" PhysicalUnit="ColorComponent" Pretty="R"/>
        <Attribute ActivationGroup="ColorRGB" Feature="Color.RGB" Name="ColorAdd_G" PhysicalUnit="ColorComponent" Pretty="G"/>
        <Attribute ActivationGroup="ColorRGB" Feature="Color.RGB" Name="ColorAdd_B" PhysicalUnit="ColorComponent" Pretty="B"/>
        <Attribute ActivationGroup="Gobo1" Feature="Gobo.Gobo" Name="Gobo1" PhysicalUnit="None" Pretty="G1"/>
        <Attribute ActivationGroup="Beam" Feature="Beam.Beam" Name="Zoom" PhysicalUnit="Angle" Pretty="Zoom"/>
        <Attribute Feature="Beam.Beam" Name="Focus1" PhysicalUnit="Percent" Pretty="Focus"/>
        <Attribute Feature="Beam.Beam" Name="Shutter1" PhysicalUnit="Frequency" Pretty="Sh"/>
      </Attributes>
    </AttributeDefinitions>
    <Wheels>
      <Wheel Name="GoboWheel1">
        <Slot Color="0.3127,0.3290,100.0" Name="Open"/>
        <Slot Color="0.3127,0.3290,100.0" MediaFileName="radial_breakup" Name="Radial Breakup"/>
        <Slot Color="0.3127,0.3290,100.0" MediaFileName="starburst" Name="Starburst"/>
        <Slot Color="0.3127,0.3290,100.0" MediaFileName="linear_bars" Name="Linear Bars"/>
        <Slot Color="0.3127,0.3290,100.0" MediaFileName="ring_dots" Name="Ring Dots"/>
      </Wheel>
    </Wheels>
    <Models>
      <Model Height="0.12" Length="0.36" Name="Base" PrimitiveType="Base1_1" Width="0.28"/>
      <Model Height="0.28" Length="0.32" Name="Yoke" PrimitiveType="Yoke" Width="0.12"/>
      <Model Height="0.32" Length="0.22" Name="Head" PrimitiveType="Head" Width="0.22"/>
      <Model Height="0.02" Length="0.16" Name="Beam" PrimitiveType="Cylinder" Width="0.16"/>
    </Models>
    <Geometries>
      <Geometry Model="Base" Name="Base" Position="{1.0,0.0,0.0,0.0}{0.0,1.0,0.0,0.0}{0.0,0.0,1.0,0.0}{0.0,0.0,0.0,1.0}">
        <Axis Model="Yoke" Name="Yoke" Position="{1.0,0.0,0.0,0.0}{0.0,1.0,0.0,-0.20}{0.0,0.0,1.0,0.0}{0.0,0.0,0.0,1.0}">
          <Axis Model="Head" Name="Head" Position="{1.0,0.0,0.0,0.0}{0.0,1.0,0.0,-0.16}{0.0,0.0,1.0,0.0}{0.0,0.0,0.0,1.0}">
            <Beam BeamAngle="20.0" BeamRadius="0.08" BeamType="Spot" ColorTemperature="6500.0" FieldAngle="24.0" LuminousFlux="18000.0" Model="Beam" Name="Beam" Position="{1.0,0.0,0.0,0.0}{0.0,1.0,0.0,-0.17}{0.0,0.0,1.0,0.0}{0.0,0.0,0.0,1.0}" PowerConsumption="700.0"/>
          </Axis>
        </Axis>
      </Geometry>
    </Geometries>
    <DMXModes>
      <DMXMode Geometry="Base" Name="16-bit Hybrid (13 ch)">
        <DMXChannels>
          <DMXChannel DMXBreak="1" Default="32768/2" Geometry="Yoke" Offset="1,2">
            <LogicalChannel Attribute="Pan">
              <ChannelFunction Attribute="Pan" DMXFrom="0/2" Default="32768/2" Name="Pan" PhysicalFrom="-270.0" PhysicalTo="270.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="39321/2" Geometry="Head" Offset="3,4">
            <LogicalChannel Attribute="Tilt">
              <ChannelFunction Attribute="Tilt" DMXFrom="0/2" Default="39321/2" Name="Tilt" PhysicalFrom="-120.0" PhysicalTo="120.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="55000/2" Geometry="Beam" Offset="5,6">
            <LogicalChannel Attribute="Dimmer">
              <ChannelFunction Attribute="Dimmer" DMXFrom="0/2" Default="55000/2" Name="Dimmer" PhysicalFrom="0.0" PhysicalTo="100.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="120/1" Geometry="Beam" Offset="7">
            <LogicalChannel Attribute="ColorAdd_R">
              <ChannelFunction Attribute="ColorAdd_R" DMXFrom="0/1" Default="120/1" Name="Red" PhysicalFrom="0.0" PhysicalTo="100.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="235/1" Geometry="Beam" Offset="8">
            <LogicalChannel Attribute="ColorAdd_G">
              <ChannelFunction Attribute="ColorAdd_G" DMXFrom="0/1" Default="235/1" Name="Green" PhysicalFrom="0.0" PhysicalTo="100.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="255/1" Geometry="Beam" Offset="9">
            <LogicalChannel Attribute="ColorAdd_B">
              <ChannelFunction Attribute="ColorAdd_B" DMXFrom="0/1" Default="255/1" Name="Blue" PhysicalFrom="0.0" PhysicalTo="100.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="0/1" Geometry="Beam" Offset="10">
            <LogicalChannel Attribute="Gobo1">
              <ChannelFunction Attribute="Gobo1" DMXFrom="0/1" Default="0/1" Name="Gobo Select" PhysicalFrom="0.0" PhysicalTo="4.0" Wheel="GoboWheel1">
                <ChannelSet DMXFrom="0/1" Name="Open" WheelSlotIndex="1"/>
                <ChannelSet DMXFrom="50/1" Name="Radial Breakup" WheelSlotIndex="2"/>
                <ChannelSet DMXFrom="100/1" Name="Starburst" WheelSlotIndex="3"/>
                <ChannelSet DMXFrom="150/1" Name="Linear Bars" WheelSlotIndex="4"/>
                <ChannelSet DMXFrom="200/1" Name="Ring Dots" WheelSlotIndex="5"/>
              </ChannelFunction>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="85/1" Geometry="Beam" Offset="11">
            <LogicalChannel Attribute="Zoom">
              <ChannelFunction Attribute="Zoom" DMXFrom="0/1" Default="85/1" Name="Zoom" PhysicalFrom="8.0" PhysicalTo="42.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="128/1" Geometry="Beam" Offset="12">
            <LogicalChannel Attribute="Focus1">
              <ChannelFunction Attribute="Focus1" DMXFrom="0/1" Default="128/1" Name="Focus" PhysicalFrom="0.0" PhysicalTo="100.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="255/1" Geometry="Beam" Offset="13">
            <LogicalChannel Attribute="Shutter1">
              <ChannelFunction Attribute="Shutter1" DMXFrom="0/1" Name="Closed" PhysicalFrom="0.0" PhysicalTo="0.0"/>
              <ChannelFunction Attribute="Shutter1" DMXFrom="32/1" Name="Strobe" PhysicalFrom="1.0" PhysicalTo="18.0"/>
              <ChannelFunction Attribute="Shutter1" DMXFrom="215/1" Default="255/1" Name="Open" PhysicalFrom="1.0" PhysicalTo="1.0"/>
            </LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
      <DMXMode Geometry="Base" Name="8-bit Compact (8 ch)">
        <DMXChannels>
          <DMXChannel DMXBreak="1" Default="128/1" Geometry="Yoke" Offset="1">
            <LogicalChannel Attribute="Pan">
              <ChannelFunction Attribute="Pan" DMXFrom="0/1" Default="128/1" Name="Pan" PhysicalFrom="-270.0" PhysicalTo="270.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="154/1" Geometry="Head" Offset="2">
            <LogicalChannel Attribute="Tilt">
              <ChannelFunction Attribute="Tilt" DMXFrom="0/1" Default="154/1" Name="Tilt" PhysicalFrom="-120.0" PhysicalTo="120.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="220/1" Geometry="Beam" Offset="3">
            <LogicalChannel Attribute="Dimmer">
              <ChannelFunction Attribute="Dimmer" DMXFrom="0/1" Default="220/1" Name="Dimmer" PhysicalFrom="0.0" PhysicalTo="100.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="120/1" Geometry="Beam" Offset="4">
            <LogicalChannel Attribute="ColorAdd_R">
              <ChannelFunction Attribute="ColorAdd_R" DMXFrom="0/1" Default="120/1" Name="Red" PhysicalFrom="0.0" PhysicalTo="100.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="235/1" Geometry="Beam" Offset="5">
            <LogicalChannel Attribute="ColorAdd_G">
              <ChannelFunction Attribute="ColorAdd_G" DMXFrom="0/1" Default="235/1" Name="Green" PhysicalFrom="0.0" PhysicalTo="100.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="255/1" Geometry="Beam" Offset="6">
            <LogicalChannel Attribute="ColorAdd_B">
              <ChannelFunction Attribute="ColorAdd_B" DMXFrom="0/1" Default="255/1" Name="Blue" PhysicalFrom="0.0" PhysicalTo="100.0"/>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="0/1" Geometry="Beam" Offset="7">
            <LogicalChannel Attribute="Gobo1">
              <ChannelFunction Attribute="Gobo1" DMXFrom="0/1" Default="0/1" Name="Gobo Select" PhysicalFrom="0.0" PhysicalTo="4.0" Wheel="GoboWheel1">
                <ChannelSet DMXFrom="0/1" Name="Open" WheelSlotIndex="1"/>
                <ChannelSet DMXFrom="50/1" Name="Radial Breakup" WheelSlotIndex="2"/>
                <ChannelSet DMXFrom="100/1" Name="Starburst" WheelSlotIndex="3"/>
                <ChannelSet DMXFrom="150/1" Name="Linear Bars" WheelSlotIndex="4"/>
                <ChannelSet DMXFrom="200/1" Name="Ring Dots" WheelSlotIndex="5"/>
              </ChannelFunction>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel DMXBreak="1" Default="90/1" Geometry="Beam" Offset="8">
            <LogicalChannel Attribute="Zoom">
              <ChannelFunction Attribute="Zoom" DMXFrom="0/1" Default="90/1" Name="Zoom" PhysicalFrom="8.0" PhysicalTo="42.0"/>
            </LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;

  zip.file('description.xml', descriptionXml);

  const [thumb, g1, g2, g3, g4] = await Promise.all([
    renderProceduralGoboPng('thumb'),
    renderProceduralGoboPng('radial'),
    renderProceduralGoboPng('starburst'),
    renderProceduralGoboPng('bars'),
    renderProceduralGoboPng('dots'),
  ]);

  zip.file('thumbnail.png', thumb);
  zip.file('wheels/radial_breakup.png', g1);
  zip.file('wheels/starburst.png', g2);
  zip.file('wheels/linear_bars.png', g3);
  zip.file('wheels/ring_dots.png', g4);

  const archiveBlob = await zip.generateAsync({ type: 'blob' });
  const profile = await ingestGdtfArchive(archiveBlob, 'Aether_ApexBeam_700.gdtf');
  return { profile, archiveBlob };
}
