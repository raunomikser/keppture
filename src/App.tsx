import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FilePlus2, FolderOpen, Maximize2, Minimize2, Save } from 'lucide-react';
import { CadViewport } from './components/CadViewport';
import { FixtureGroupsIcon } from './components/Icons';
import { FileMenuBar, RecentFileEntry } from './components/FileMenuBar';
import { PaneFrame } from './components/PaneFrame';
import { ProjectPanel } from './components/ProjectPanel';
import {
  INITIAL_CAMERA_PRESETS,
  INITIAL_FIXTURE_GROUPS,
  INITIAL_LAYERS,
  INITIAL_PROJECT_METADATA,
  INITIAL_SCENE_OBJECTS,
  INITIAL_SNAPSHOTS,
  INITIAL_VIEWPORTS,
  LIBRARY_CATALOG,
} from './data/initialScene';
import {
  createInitialDmxUniverses,
  DmxUniversesMap,
  resolveGdtfDmxState,
  writeDmxRawValue,
  writeGdtfDefaultsToBuffer,
} from './gdtf/dmxEngine';
import { loadGdtfLibraryCatalog, loadGdtfLibraryProfile } from './gdtf/libraryCatalog';
import { loadSkpLibraryCatalog, loadSkpLibraryModel } from './skp/skpLibraryCatalog';
import { GdtfProfile } from './gdtf/types';
import { exportKptr, importKptr, isKptrFile, KptrProject } from './io/kptr';
import {
  deleteCachedGdtfProfile,
  generateAndImportSampleGdtf,
  ingestGdtfArchive,
  restoreCachedGdtfProfiles,
} from './gdtf/vfsAndCache';
import {
  generateAndImportSampleSkp,
  ingestModelFile,
  SkpParsedModel,
} from './skp/skpParser';
import { TransformGhostItem } from './three/ghostPreview';
import { findTrussSnap } from './three/trussSnap';
import { findCaptureMaterial } from './three/materialsLibrary';
import {
  CameraPreset,
  DesignCategory,
  GdtfLibraryEntry,
  LayerItem,
  LibraryCatalogItem,
  LightingSnapshot,
  ObjectKind,
  PaneId,
  ProjectDocument,
  ProjectMetadata,
  ProjectTab,
  SceneObject,
  SkpLibraryEntry,
  ViewportId,
  ViewportSettings,
} from './types/visualizer';

const LOCAL_RECENT_STORAGE_KEY = 'capture_recent_projects_v1';

const IS_MAC = /Mac|iPhone|iPad/.test(
  (typeof navigator !== 'undefined' && navigator.userAgent) || '',
);
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
};

async function pickSaveHandle(suggestedName: string): Promise<FileSystemFileHandle | null> {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (!picker) return null;
  try {
    return await picker({
      suggestedName,
      types: [{ description: 'Capture Lighting Project', accept: { 'application/x-capture-project+zip': ['.kptr'] } }],
    });
  } catch {
    return null;
  }
}

function snapPlacedTruss(newObj: SceneObject, existing: SceneObject[]): SceneObject {
  const snap = findTrussSnap(
    [{ id: newObj.id, startPos: newObj.position, position: newObj.position }],
    [newObj, ...existing],
  );
  if (!snap) return newObj;
  return { ...newObj, position: snap.position, rotation: snap.rotation };
}

async function writeToFileHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

const ToolbarButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, onClick, children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={onClick}
    className="w-[25px] h-[25px] flex items-center justify-center rounded-[4px] text-[#B8B8B8] hover:bg-[#3A3A3A] hover:text-white active:bg-[#505050] transition-colors"
  >
    {children}
  </button>
);

export default function App() {
  const [maximizedPane, setMaximizedPane] = useState<PaneId | null>(null);
  const [poppedOutPanes, setPoppedOutPanes] = useState<Record<PaneId, boolean>>({
    alpha: false,
    beta: false,
    gamma: false,
    project: false,
  });
  const [popPositions, setPopPositions] = useState<Record<PaneId, { x: number; y: number }>>({
    alpha: { x: 48, y: 52 },
    beta: { x: 180, y: 76 },
    gamma: { x: 90, y: 140 },
    project: { x: 260, y: 120 },
  });

  const [viewports, setViewports] = useState<Record<ViewportId, ViewportSettings>>(INITIAL_VIEWPORTS);
  const [objects, setObjects] = useState<SceneObject[]>(INITIAL_SCENE_OBJECTS);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [transformGhostItems, setTransformGhostItems] = useState<TransformGhostItem[] | null>(null);
  const [metadata, setMetadata] = useState<ProjectMetadata>(INITIAL_PROJECT_METADATA);
  const [layers, setLayers] = useState<LayerItem[]>(INITIAL_LAYERS);
  const [snapshots, setSnapshots] = useState<LightingSnapshot[]>(INITIAL_SNAPSHOTS);
  const [cameraPresets, setCameraPresets] = useState<CameraPreset[]>(INITIAL_CAMERA_PRESETS);
  const [cameraCommand, setCameraCommand] = useState<{
    nonce: number;
    targetViewportId?: ViewportId;
    preset?: CameraPreset;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<ProjectTab>('Design');
  const [activeCategory, setActiveCategory] = useState<DesignCategory>('Project');

  // GDTF, DMX & SketchUp .skp Runtime States
  const [gdtfProfiles, setGdtfProfiles] = useState<GdtfProfile[]>([]);
  const [gdtfLibraryEntries, setGdtfLibraryEntries] = useState<GdtfLibraryEntry[]>([]);
  const [skpModels, setSkpModels] = useState<SkpParsedModel[]>([]);
  const [skpLibraryEntries, setSkpLibraryEntries] = useState<SkpLibraryEntry[]>([]);
  const [dmxUniverses, setDmxUniverses] = useState<DmxUniversesMap>(() => createInitialDmxUniverses());
  const [dmxSweepActive, setDmxSweepActive] = useState(false);
  const [recentCatalogIds, setRecentCatalogIds] = useState<string[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_RECENT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as RecentFileEntry[]) : [];
    } catch {
      return [];
    }
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const nextIdCounter = useRef(1);
  const openFileInputRef = useRef<HTMLInputElement>(null);
  const saveHandleRef = useRef<FileSystemFileHandle | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const lastLockedToastAtRef = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 3200);
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => {
        showToast('Fullscreen is not available in this browser');
      });
    }
  }, [showToast]);

  const notifyLockedLayer = useCallback(() => {
    const now = Date.now();
    if (now - lastLockedToastAtRef.current > 2000) {
      lastLockedToastAtRef.current = now;
      showToast('Objects on a locked layer cannot be modified');
    }
  }, [showToast]);

  // Restore cached GDTF profiles from IndexedDB on startup
  useEffect(() => {
    void restoreCachedGdtfProfiles().then((profiles) => {
      if (profiles.length > 0) {
        setGdtfProfiles(profiles);
      }
    });
  }, []);

  // Load the packaged index of real .gdtf archives (lazy profile parsing on drop)
  useEffect(() => {
    void loadGdtfLibraryCatalog()
      .then(setGdtfLibraryEntries)
      .catch(() => setGdtfLibraryEntries([]));
  }, []);

  // Load the packaged index of real SketchUp truss models (lazy GLB loading on drop)
  useEffect(() => {
    void loadSkpLibraryCatalog()
      .then(setSkpLibraryEntries)
      .catch(() => setSkpLibraryEntries([]));
  }, []);

  // Live DMX Sweep animation loop updating universe bytes in real time
  useEffect(() => {
    if (!dmxSweepActive) return;
    const id = window.setInterval(() => {
      const t = performance.now() / 1000;
      setDmxUniverses((prev) => {
        const next: DmxUniversesMap = {
          1: new Uint8Array(prev[1]),
          2: new Uint8Array(prev[2]),
          3: new Uint8Array(prev[3]),
          4: new Uint8Array(prev[4]),
        };

        for (const obj of objects) {
          if (obj.kind !== 'gdtf-fixture' || !obj.gdtfProfileId) continue;
          const profile = gdtfProfiles.find((p) => p.id === obj.gdtfProfileId);
          if (!profile) continue;
          const mode =
            profile.dmxModes.find((m) => m.name === obj.gdtfModeName) ?? profile.dmxModes[0];
          if (!mode) continue;
          const u = obj.dmxUniverse ?? 1;
          const baseAddr = obj.dmxAddress ?? 1;
          const buf = next[u];
          if (!buf) continue;

          for (const ch of mode.dmxChannels) {
            const attr = ch.logicalChannels[0]?.attribute || '';
            const maxRaw = Math.pow(256, ch.offset.length) - 1;
            if (attr === 'Pan') {
              const norm = 0.5 + 0.18 * Math.sin(t * 1.4);
              writeDmxRawValue(buf, baseAddr, ch.offset, norm * maxRaw);
            } else if (attr === 'Tilt') {
              const norm = 0.58 + 0.14 * Math.cos(t * 1.8);
              writeDmxRawValue(buf, baseAddr, ch.offset, norm * maxRaw);
            } else if (attr === 'ColorAdd_R') {
              writeDmxRawValue(buf, baseAddr, ch.offset, (0.5 + 0.5 * Math.sin(t * 1.1)) * maxRaw);
            } else if (attr === 'ColorAdd_B') {
              writeDmxRawValue(buf, baseAddr, ch.offset, (0.5 + 0.5 * Math.cos(t * 1.1)) * maxRaw);
            }
          }
        }
        return next;
      });
    }, 65);
    return () => window.clearInterval(id);
  }, [dmxSweepActive, objects, gdtfProfiles]);

  const handleUpdateViewport = useCallback((id: ViewportId, patch: Partial<ViewportSettings>) => {
    setViewports((prev) => {
      const current = prev[id];
      const nextProj = patch.projection;
      const lastOrthoProjection =
        patch.lastOrthoProjection ??
        (nextProj && nextProj !== 'Perspective'
          ? nextProj
          : nextProj === 'Perspective' && current.projection !== 'Perspective'
            ? current.projection
            : current.lastOrthoProjection);
      return {
        ...prev,
        [id]: { ...current, ...patch, lastOrthoProjection },
      };
    });
  }, []);

  const handleSelectObject = useCallback(
    (id: string | null, mode: 'replace' | 'toggle' = 'replace') => {
      setSelectedObjectIds((prev) => {
        if (id === null) {
          return mode === 'replace' ? [] : prev;
        }
        if (mode === 'toggle') {
          return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        }
        return [id];
      });
      if (id !== null) {
        setActiveTab('Design');
        setActiveCategory('Selected Items');
      }
    },
    [],
  );

  const handleSelectMultiple = useCallback((ids: string[], additive: boolean) => {
    setSelectedObjectIds((prev) => {
      if (additive) {
        const merged = new Set(prev);
        for (const id of ids) merged.add(id);
        return Array.from(merged);
      }
      return ids;
    });
    if (ids.length > 0) {
      setActiveTab('Design');
      setActiveCategory('Selected Items');
    }
  }, []);

  const handleMoveObjects = useCallback(
    (moves: Array<{ id: string; position: [number, number, number] }>) => {
      const lockedLayerIds = new Set(layersRef.current.filter((l) => l.locked).map((l) => l.id));
      const objById = new Map(objectsRef.current.map((o) => [o.id, o]));
      const moveMap = new Map<string, [number, number, number]>();
      let skippedLocked = false;

      for (const m of moves) {
        const existing = objById.get(m.id);
        if (existing?.layerId && lockedLayerIds.has(existing.layerId)) {
          skippedLocked = true;
          continue;
        }
        moveMap.set(m.id, m.position);
      }

      if (skippedLocked) {
        notifyLockedLayer();
      }
      if (moveMap.size === 0) return;

      setObjects((prev) =>
        prev.map((obj) => {
          const p = moveMap.get(obj.id);
          return p ? { ...obj, position: p } : obj;
        }),
      );
    },
    [notifyLockedLayer],
  );

  const handleUpdateObjects = useCallback(
    (ids: string[], patch: Partial<SceneObject>) => {
      const lockedLayerIds = new Set(layersRef.current.filter((l) => l.locked).map((l) => l.id));
      const objById = new Map(objectsRef.current.map((o) => [o.id, o]));
      const unlockedIds: string[] = [];
      let skippedLocked = false;

      for (const id of ids) {
        const existing = objById.get(id);
        if (existing?.layerId && lockedLayerIds.has(existing.layerId)) {
          skippedLocked = true;
          continue;
        }
        unlockedIds.push(id);
      }

      if (skippedLocked) {
        notifyLockedLayer();
      }
      if (unlockedIds.length === 0) return;

      const idSet = new Set(unlockedIds);
      setObjects((prev) => {
        const updated = prev.map((obj) => (idSet.has(obj.id) ? { ...obj, ...patch } : obj));

        // Sync fixture attribute edits back into DMX universe bytes for GDTF fixtures
        const gdtfChanged = updated.filter((o) => idSet.has(o.id) && o.kind === 'gdtf-fixture' && o.gdtfProfileId);
        if (
          gdtfChanged.length > 0 &&
          (patch.intensity !== undefined ||
            patch.shutter !== undefined ||
            patch.pan !== undefined ||
            patch.tilt !== undefined ||
            patch.beamAngle !== undefined ||
            patch.color !== undefined ||
            patch.gobo !== undefined)
        ) {
          setDmxUniverses((prevDmx) => {
            const nextDmx: DmxUniversesMap = {
              1: new Uint8Array(prevDmx[1]),
              2: new Uint8Array(prevDmx[2]),
              3: new Uint8Array(prevDmx[3]),
              4: new Uint8Array(prevDmx[4]),
            };
            for (const fx of gdtfChanged) {
              const profile = gdtfProfiles.find((p) => p.id === fx.gdtfProfileId);
              const mode =
                profile?.dmxModes.find((m) => m.name === fx.gdtfModeName) ?? profile?.dmxModes[0];
              if (!profile || !mode) continue;
              const buf = nextDmx[fx.dmxUniverse ?? 1];
              if (!buf) continue;
              const baseAddr = fx.dmxAddress ?? 1;

              for (const ch of mode.dmxChannels) {
                const logical = ch.logicalChannels[0];
                const cf = logical?.channelFunctions[0];
                if (!logical || !cf) continue;
                // Real GDTF files sometimes repeat the first function's attribute
                // on every logical channel; the logical channel is authoritative.
                const attr = logical.attribute || cf.attribute;
                const colorComponent =
                  attr === 'ColorAdd_R' || attr === 'Red' || attr === 'ColorRGB_Red' ? 'r' :
                  attr === 'ColorAdd_G' || attr === 'Green' || attr === 'ColorRGB_Green' ? 'g' :
                  attr === 'ColorAdd_B' || attr === 'Blue' || attr === 'ColorRGB_Blue' ? 'b' :
                  null;
                const maxRaw = Math.pow(256, ch.offset.length) - 1;
                if (attr === 'Dimmer' && (patch.intensity !== undefined || patch.shutter !== undefined)) {
                  const dimmer = patch.shutter === false
                    ? 0
                    : (patch.intensity ?? fx.intensity ?? 0.85);
                  writeDmxRawValue(buf, baseAddr, ch.offset, dimmer * maxRaw);
                } else if (attr === 'Pan' && patch.pan !== undefined) {
                  const t = (patch.pan - cf.physicalFrom) / Math.max(1, cf.physicalTo - cf.physicalFrom);
                  writeDmxRawValue(buf, baseAddr, ch.offset, t * maxRaw);
                } else if (attr === 'Tilt' && patch.tilt !== undefined) {
                  const t = (patch.tilt - cf.physicalFrom) / Math.max(1, cf.physicalTo - cf.physicalFrom);
                  writeDmxRawValue(buf, baseAddr, ch.offset, t * maxRaw);
                } else if (attr === 'Zoom' && patch.beamAngle !== undefined) {
                  const t = (patch.beamAngle - cf.physicalFrom) / Math.max(1, cf.physicalTo - cf.physicalFrom);
                  writeDmxRawValue(buf, baseAddr, ch.offset, t * maxRaw);
                } else if (patch.color !== undefined && colorComponent) {
                  const hex = patch.color.replace('#', '');
                  const r = parseInt(hex.slice(0, 2), 16) / 255;
                  const g = parseInt(hex.slice(2, 4), 16) / 255;
                  const b = parseInt(hex.slice(4, 6), 16) / 255;
                  const comp = colorComponent === 'r' ? r : colorComponent === 'g' ? g : b;
                  writeDmxRawValue(buf, baseAddr, ch.offset, comp * maxRaw);
                } else if (attr.startsWith('Gobo') && patch.gobo !== undefined && cf.wheel) {
                  const matchSet = cf.channelSets.find(
                    (cs) => cs.name.toLowerCase() === patch.gobo?.toLowerCase(),
                  );
                  if (matchSet) {
                    writeDmxRawValue(buf, baseAddr, ch.offset, matchSet.dmxFrom + 5);
                  }
                }
              }
            }
            return nextDmx;
          });
        }

        return updated;
      });
    },
    [gdtfProfiles, notifyLockedLayer],
  );

  const handleWriteDmxChannel = useCallback(
    (universe: number, baseAddr: number, offsets: number[], raw: number) => {
      setDmxUniverses((prev) => {
        const buf = new Uint8Array(prev[universe] ?? new Uint8Array(512));
        writeDmxRawValue(buf, baseAddr, offsets, raw);
        return { ...prev, [universe]: buf };
      });
    },
    [],
  );

  const handleDeleteObjects = useCallback(
    (ids: string[]) => {
      const lockedLayerIds = new Set(layersRef.current.filter((l) => l.locked).map((l) => l.id));
      const objById = new Map(objectsRef.current.map((o) => [o.id, o]));
      const deletableIds: string[] = [];
      let skippedLocked = false;

      for (const id of ids) {
        const existing = objById.get(id);
        if (existing?.layerId && lockedLayerIds.has(existing.layerId)) {
          skippedLocked = true;
          continue;
        }
        deletableIds.push(id);
      }

      if (skippedLocked) {
        notifyLockedLayer();
      }
      if (deletableIds.length === 0) return;

      const idSet = new Set(deletableIds);
      setObjects((prev) => prev.filter((obj) => !idSet.has(obj.id)));
      setSelectedObjectIds((curr) => curr.filter((id) => !idSet.has(id)));
    },
    [notifyLockedLayer],
  );

  const handleDuplicateObjects = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    const createdIds: string[] = [];
    setObjects((prev) => {
      const clones: SceneObject[] = [];
      for (const source of prev) {
        if (!idSet.has(source.id)) continue;
        const newId = `${source.kind}-${Date.now()}-${nextIdCounter.current++}`;
        createdIds.push(newId);
        clones.push({
          ...source,
          id: newId,
          name: `${source.name} Copy`,
          position: [
            Number((source.position[0] + 0.8).toFixed(2)),
            source.position[1],
            source.position[2],
          ],
          channel: source.channel ? source.channel + 1 : undefined,
          dmxAddress: source.dmxAddress
            ? Math.min(500, source.dmxAddress + (source.dmxFootprint ?? 8))
            : undefined,
        });
      }
      return [...prev, ...clones];
    });
    if (createdIds.length > 0) {
      setSelectedObjectIds(createdIds);
    }
  }, []);

  const placeCatalogItem = useCallback(
    (item: LibraryCatalogItem, position?: [number, number, number]) => {
      const count = nextIdCounter.current++;
      const newId = `${item.kind}-user-${Date.now()}-${count}`;

      setRecentCatalogIds((prev) => [item.id, ...prev.filter((x) => x !== item.id)].slice(0, 12));

      setObjects((prev) => {
        const fixtureCount = prev.filter(
          (o) => o.kind === 'moving-head' || o.kind === 'led-par' || o.kind === 'gdtf-fixture',
        ).length;
        const defaultPos: [number, number, number] = position ?? [
          Number((((count % 5) - 2) * 0.9).toFixed(2)),
          item.defaultHeight,
          0,
        ];

        const nextAddress = prev.reduce((max, o) => {
          if (o.dmxUniverse === 1 && o.dmxAddress) {
            return Math.max(max, o.dmxAddress + (o.dmxFootprint ?? 8));
          }
          return max;
        }, 1);

        const isFx = item.kind === 'moving-head' || item.kind === 'led-par';
        const isEffect = item.kind === 'co2-jet' || item.kind === 'flame-jet';
        const isSmoke = item.kind === 'smoke-volume';
        const existingSmoke = prev.find((o) => o.kind === 'smoke-volume');
        const newObj: SceneObject = {
          id: newId,
          name: `${item.name} ${count}`,
          kind: item.kind,
          position: defaultPos,
          rotation: [0, 0, 0],
          layerId: undefined,
          length: item.defaultLength ?? (item.kind === 'truss' ? 4.0 : item.kind === 'stage-deck' ? 2.0 : undefined),
          width: item.defaultWidth ?? (item.kind === 'stage-deck' ? 2.0 : undefined),
          subType: item.subType,
          materialPreset: item.materialPreset,
          make: item.manufacturer,
          dmxUniverse: isFx || isEffect ? (nextAddress > 480 ? 2 : 1) : undefined,
          dmxAddress: isFx || isEffect ? (nextAddress > 480 ? 1 : nextAddress) : undefined,
          dmxFootprint: isEffect ? 1 : item.dmxFootprint,
          channel: isFx
            ? 400 + fixtureCount + 1
            : isEffect
              ? 700 + fixtureCount + 1
              : undefined,
          intensity: isFx ? 0.85 : isEffect ? 1 : undefined,
          color: item.defaultColor,
          beamAngle: isEffect ? (item.defaultBeamAngle ?? 8) : item.defaultBeamAngle,
          height: isEffect ? (item.defaultLength ?? 4) : undefined,
          gobo: item.goboName,
          pan: isFx ? 0 : undefined,
          tilt: item.kind === 'moving-head' ? 20 : item.kind === 'led-par' ? -25 : undefined,
          smokeLegacyModel: isSmoke ? (existingSmoke?.smokeLegacyModel ?? false) : undefined,
          smokeSpeed: isSmoke ? (existingSmoke?.smokeSpeed ?? 0) : undefined,
          smokeAutoSize: isSmoke ? false : undefined,
          smokeWidth: isSmoke ? (item.defaultLength ?? 200) : undefined,
          smokeHeight: isSmoke ? (item.defaultHeight ? item.defaultHeight * 2 : 50) : undefined,
          smokeDepth: isSmoke ? (item.defaultWidth ?? 60) : undefined,
          smokeDensity: isSmoke ? 1.3 : undefined,
          smokeVariation: isSmoke ? 100 : undefined,
          smokeEdgeSoftness: isSmoke ? 37.9 : undefined,
          smokePatch: isSmoke ? 'Unpatched' : undefined,
        };
        return [...prev, snapPlacedTruss(newObj, prev)];
      });

      // Placement only selects — never steal focus by switching the right pane.
      setSelectedObjectIds([newId]);
      if (item.kind === 'co2-jet' || item.kind === 'flame-jet') {
        showToast(`Placed ${item.name} — switch a viewport to Live for the animated plume`);
      }
    },
    [showToast],
  );

  const handleDropLibraryItem = useCallback(
    (kind: ObjectKind, position: [number, number, number], catalogId?: string) => {
      const found =
        (catalogId ? LIBRARY_CATALOG.find((c) => c.id === catalogId) : undefined) ??
        LIBRARY_CATALOG.find((c) => c.kind === kind) ??
        LIBRARY_CATALOG[0];
      placeCatalogItem(found, position);
    },
    [placeCatalogItem],
  );

  const handlePlaceGdtfProfile = useCallback(
    (profile: GdtfProfile, modeName?: string, position?: [number, number, number]) => {
      const mode = (modeName ? profile.dmxModes.find((m) => m.name === modeName) : undefined) ?? profile.dmxModes[0];
      const count = nextIdCounter.current++;
      const newId = `gdtf-${Date.now()}-${count}`;

      const nextAddress = objects.reduce((max, o) => {
        if ((o.dmxUniverse ?? 1) === 1 && o.dmxAddress) {
          return Math.max(max, o.dmxAddress + (o.dmxFootprint ?? 8));
        }
        return max;
      }, 1);
      const univ = nextAddress > 480 ? 2 : 1;
      const addr = nextAddress > 480 ? 1 : nextAddress;

      // Write initial GDTF defaults to universe buffer
      const nextBuf = new Uint8Array(dmxUniverses[univ] ?? new Uint8Array(512));
      if (mode) {
        writeGdtfDefaultsToBuffer(profile, mode.name, nextBuf, addr);
      }
      const resolved = resolveGdtfDmxState(profile, mode?.name, nextBuf, addr);
      setDmxUniverses((prev) => ({ ...prev, [univ]: nextBuf }));

      const fixtureCount = objects.filter(
        (o) => o.kind === 'moving-head' || o.kind === 'led-par' || o.kind === 'gdtf-fixture',
      ).length;

      const newObj: SceneObject = {
        id: newId,
        name: `${profile.metadata.name} ${count}`,
        kind: 'gdtf-fixture',
        gdtfProfileId: profile.id,
        gdtfModeName: mode?.name,
        position: position ?? [Number((((count % 5) - 2) * 1.1).toFixed(2)), 4.42, -1.2],
        rotation: [0, 0, 0],
        layerId: undefined,
        make: profile.metadata.manufacturer,
        dmxUniverse: univ,
        dmxAddress: addr,
        dmxFootprint: mode?.footprint ?? 13,
        channel: 500 + fixtureCount + 1,
        intensity: resolved.dimmer,
        color: resolved.colorHex,
        beamAngle: resolved.beamAngleDeg,
        pan: resolved.panDeg,
        tilt: resolved.tiltDeg,
        gobo: resolved.goboSlotName,
        goboMediaFile: resolved.goboMediaFile,
      };

      setObjects((prev) => [...prev, newObj]);
      // Keep the user's current panel; the fixture is selected and ready to move.
      setSelectedObjectIds([newId]);
      showToast(`Placed GDTF fixture "${profile.metadata.name}" (${univ}.${String(addr).padStart(3, '0')})`);
    },
    [objects, dmxUniverses, showToast],
  );

  const handleChangeGdtfMode = useCallback(
    (objectId: string, modeName: string) => {
      const obj = objectsRef.current.find((o) => o.id === objectId);
      if (!obj || obj.kind !== 'gdtf-fixture' || !obj.gdtfProfileId) return;
      const profile = gdtfProfiles.find((p) => p.id === obj.gdtfProfileId);
      if (!profile) return;
      const mode = profile.dmxModes.find((m) => m.name === modeName);
      if (!mode) return;

      const univ = obj.dmxUniverse ?? 1;
      const addr = obj.dmxAddress ?? 1;
      const nextBuf = new Uint8Array(dmxUniverses[univ] ?? new Uint8Array(512));
      // Clear the previous footprint, then apply the new mode's real GDTF defaults.
      for (let i = 0; i < (obj.dmxFootprint ?? mode.footprint) && addr - 1 + i < 512; i++) {
        nextBuf[addr - 1 + i] = 0;
      }
      writeGdtfDefaultsToBuffer(profile, mode.name, nextBuf, addr);
      const resolved = resolveGdtfDmxState(profile, mode.name, nextBuf, addr);

      setDmxUniverses((prev) => ({ ...prev, [univ]: nextBuf }));
      setObjects((prev) =>
        prev.map((o) =>
          o.id === objectId
            ? {
                ...o,
                gdtfModeName: mode.name,
                dmxFootprint: mode.footprint,
                intensity: resolved.dimmer,
                color: resolved.colorHex,
                beamAngle: resolved.beamAngleDeg,
                pan: resolved.panDeg,
                tilt: resolved.tiltDeg,
                gobo: resolved.goboSlotName,
                goboMediaFile: resolved.goboMediaFile,
              }
            : o,
        ),
      );
      showToast(`${obj.name} → ${mode.name} (${mode.footprint} DMX channels)`);
    },
    [gdtfProfiles, dmxUniverses, showToast],
  );

  const handlePlaceSkpModel = useCallback(
    (
      model: SkpParsedModel,
      position?: [number, number, number],
      entry?: SkpLibraryEntry,
    ) => {
      const count = nextIdCounter.current++;
      const newId = `skp-inst-${Date.now()}-${count}`;
      const newObj: SceneObject = {
        id: newId,
        name: entry?.name ?? model.fileName.replace(/\.[^.]+$/, ''),
        kind: 'skp-model',
        skpModelId: model.id,
        skpCatalogId: entry?.id,
        trussEndpoints: entry?.endpoints,
        length: entry?.dimensions[0],
        sectionWidth: entry?.sectionWidth,
        sectionHeight: entry?.sectionHeight,
        trussType: entry ? 'Rectangular Section' : undefined,
        position: position ?? [0, 0, -1.5],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        layerId: undefined,
      };
      setObjects((prev) => [...prev, snapPlacedTruss(newObj, prev)]);
      setSelectedObjectIds([newId]);
      if (entry) {
        showToast(`Placed ${entry.name} — connectors snap when ends meet`);
      } else {
        showToast(`Imported 3D model "${model.fileName}" (${model.componentCount} nodes)`);
      }
    },
    [showToast],
  );

  const handleApplyMaterialToObjects = useCallback(
    (materialId: string, targetIds?: string[]) => {
      const matDef = findCaptureMaterial(materialId);
      const ids = (targetIds ?? selectedObjectIds).filter((id) => {
        const obj = objectsRef.current.find((o) => o.id === id);
        return obj && obj.kind !== 'smoke-volume';
      });
      if (ids.length === 0) {
        showToast('Materials can only be dragged onto or applied to an existing object');
        return;
      }
      handleUpdateObjects(ids, { materialPreset: materialId });
      const targetName =
        ids.length === 1
          ? objectsRef.current.find((o) => o.id === ids[0])?.name ?? 'object'
          : `${ids.length} objects`;
      showToast(`Applied material "${matDef?.name ?? materialId}" to ${targetName}`);
    },
    [selectedObjectIds, handleUpdateObjects, showToast],
  );

  const handleDropMaterial = useCallback(
    (materialId: string, hitObjectId: string | null) => {
      if (!hitObjectId) {
        showToast('Materials cannot be placed on empty space — drag directly onto an object');
        return;
      }
      const target = objectsRef.current.find((o) => o.id === hitObjectId);
      if (!target || target.kind === 'smoke-volume') {
        showToast('Materials cannot be applied to volumetric smoke domains');
        return;
      }
      handleApplyMaterialToObjects(materialId, [hitObjectId]);
    },
    [handleApplyMaterialToObjects, showToast],
  );

  const handleImportGdtfFile = useCallback(
    async (file: File) => {
      const profile = await ingestGdtfArchive(file, file.name);
      setGdtfProfiles((prev) => [profile, ...prev.filter((p) => p.id !== profile.id)]);
      showToast(`Parsed GDTF "${profile.metadata.manufacturer} ${profile.metadata.name}"`);
    },
    [showToast],
  );

  const handleLoadSampleGdtf = useCallback(async () => {
    const { profile } = await generateAndImportSampleGdtf();
    setGdtfProfiles((prev) => [profile, ...prev.filter((p) => p.id !== profile.id)]);
    showToast(`Loaded sample GDTF: ${profile.metadata.name}`);
  }, [showToast]);

  const handleDeleteGdtfProfile = useCallback((profileId: string) => {
    void deleteCachedGdtfProfile(profileId);
    setGdtfProfiles((prev) => prev.filter((p) => p.id !== profileId));
  }, []);

  const handleImportSkpFile = useCallback(
    async (file: File, placeAt?: [number, number, number]) => {
      const model = await ingestModelFile(file);
      setSkpModels((prev) => [model, ...prev]);
      handlePlaceSkpModel(model, placeAt);
    },
    [handlePlaceSkpModel],
  );

  const handleLoadSampleSkp = useCallback(() => {
    const model = generateAndImportSampleSkp();
    setSkpModels((prev) => [model, ...prev]);
    handlePlaceSkpModel(model, [0, 0, -2.1]);
  }, [handlePlaceSkpModel]);

  const handleDropExternalFiles = useCallback(
    async (files: FileList, position: [number, number, number]) => {
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        try {
          if (lower.endsWith('.gdtf') || lower.endsWith('.zip')) {
            const profile = await ingestGdtfArchive(file, file.name);
            setGdtfProfiles((prev) => [profile, ...prev.filter((p) => p.id !== profile.id)]);
            handlePlaceGdtfProfile(profile, undefined, [position[0], 4.42, position[2]]);
          } else if (
            lower.endsWith('.skp') ||
            lower.endsWith('.glb') ||
            lower.endsWith('.gltf') ||
            lower.endsWith('.obj')
          ) {
            await handleImportSkpFile(file, position);
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : `Failed to import ${file.name}`);
        }
      }
    },
    [handlePlaceGdtfProfile, handleImportSkpFile, showToast],
  );

  // === FILE MENU ACTIONS ===
  const recordRecentProject = useCallback((name: string) => {
    const entry: RecentFileEntry = {
      id: `recent-${Date.now()}`,
      name,
      savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setRecentFiles((prev) => {
      const next = [entry, ...prev.filter((r) => r.name !== name)].slice(0, 6);
      try {
        localStorage.setItem(LOCAL_RECENT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  }, []);

  const buildDocument = (): ProjectDocument => ({
    version: 1,
    metadata,
    objects,
    layers,
    viewports,
    snapshots,
    cameraPresets,
  });

  const buildKptrProject = (): KptrProject => ({
    ...buildDocument(),
    dmxUniverses,
    gdtfProfiles,
    skpModels,
  });

  const persistAutosave = (doc: ProjectDocument) => {
    try {
      localStorage.setItem('capture_last_saved_project', JSON.stringify(doc));
    } catch {
      // Ignore quota errors; the .kptr download is the durable copy.
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyDocument = useCallback((doc: ProjectDocument): boolean => {
    if (!doc || !doc.metadata || !Array.isArray(doc.objects)) return false;
    setObjects(doc.objects);
    setMetadata(doc.metadata);
    if (Array.isArray(doc.layers)) setLayers(doc.layers);
    if (doc.viewports) setViewports(doc.viewports);
    if (Array.isArray(doc.snapshots)) setSnapshots(doc.snapshots);
    if (Array.isArray(doc.cameraPresets)) setCameraPresets(doc.cameraPresets);
    return true;
  }, []);

  const applyKptrProject = useCallback(
    (project: KptrProject) => {
      if (!applyDocument(project)) throw new Error('invalid project core');
      setDmxUniverses(project.dmxUniverses);
      setGdtfProfiles(project.gdtfProfiles);
      setSkpModels(project.skpModels);
    },
    [applyDocument],
  );

  const handleSaveProject = useCallback(async () => {
    const fileName = (metadata.project.trim() || 'Untitled - Demo') + '.kptr';
    persistAutosave(buildDocument());
    try {
      const blob = await exportKptr(buildKptrProject());
      if (saveHandleRef.current) {
        await writeToFileHandle(saveHandleRef.current, blob);
        showToast(`Saved "${fileName}"`);
      } else {
        const handle = await pickSaveHandle(fileName);
        if (handle) {
          saveHandleRef.current = handle;
          await writeToFileHandle(handle, blob);
          showToast(`Saved "${fileName}"`);
        } else {
          downloadBlob(blob, fileName);
          showToast(`Downloaded "${fileName}"`);
        }
      }
      recordRecentProject(fileName);
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Could not save "${fileName}"`);
    }
  }, [
    metadata,
    objects,
    layers,
    viewports,
    snapshots,
    cameraPresets,
    dmxUniverses,
    gdtfProfiles,
    skpModels,
    recordRecentProject,
    showToast,
  ]);

  const handleSaveProjectAs = useCallback(async () => {
    const fileName = (metadata.project.trim() || 'Capture-Project') + '.kptr';
    persistAutosave(buildDocument());
    try {
      const blob = await exportKptr(buildKptrProject());
      const handle = await pickSaveHandle(fileName);
      if (handle) {
        saveHandleRef.current = handle;
        await writeToFileHandle(handle, blob);
        showToast(`Saved "${fileName}"`);
      } else {
        saveHandleRef.current = null;
        downloadBlob(blob, fileName);
        showToast(`Downloaded "${fileName}"`);
      }
      recordRecentProject(fileName);
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Could not save "${fileName}"`);
    }
  }, [
    metadata,
    objects,
    layers,
    viewports,
    snapshots,
    cameraPresets,
    dmxUniverses,
    gdtfProfiles,
    skpModels,
    recordRecentProject,
    showToast,
  ]);

  const handleExportLegacyJson = useCallback(() => {
    const fileName = (metadata.project.trim() || 'Capture-Project') + '.json';
    downloadBlob(
      new Blob([JSON.stringify(buildDocument(), null, 2)], { type: 'application/json' }),
      fileName,
    );
    recordRecentProject(fileName);
    showToast(`Downloaded "${fileName}"`);
  }, [metadata, objects, layers, viewports, snapshots, cameraPresets, recordRecentProject, showToast]);

  const handleNewProject = useCallback(() => {
    gdtfProfiles.forEach((profile) => void deleteCachedGdtfProfile(profile.id));
    setObjects(INITIAL_SCENE_OBJECTS);
    setMetadata(INITIAL_PROJECT_METADATA);
    setLayers(INITIAL_LAYERS);
    setViewports(INITIAL_VIEWPORTS);
    setSnapshots(INITIAL_SNAPSHOTS);
    setCameraPresets(INITIAL_CAMERA_PRESETS);
    setDmxUniverses(createInitialDmxUniverses());
    setGdtfProfiles([]);
    setSkpModels([]);
    setSelectedObjectIds([]);
    saveHandleRef.current = null;
    showToast('Reset workspace to New Demo scene');
  }, [gdtfProfiles, showToast]);

  const handleOpenProjectFile = useCallback(
    async (file: File) => {
      try {
        if (isKptrFile(file)) {
          applyKptrProject(await importKptr(file));
        } else {
          const doc = JSON.parse(await file.text()) as ProjectDocument;
          if (!applyDocument(doc)) throw new Error('unrecognized project structure');
        }
        saveHandleRef.current = null;
        recordRecentProject(file.name);
        showToast(`Opened "${file.name}"`);
      } catch (err) {
        showToast(
          `Could not open "${file.name}": ${err instanceof Error ? err.message : 'invalid file'}`,
        );
      }
    },
    [applyDocument, applyKptrProject, recordRecentProject, showToast],
  );

  const handleImportFixtureDataFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.gdtf') || lower.endsWith('.zip')) {
        try {
          const profile = await ingestGdtfArchive(file, file.name);
          setGdtfProfiles((prev) => [profile, ...prev.filter((p) => p.id !== profile.id)]);
          handlePlaceGdtfProfile(profile);
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Failed to parse GDTF package');
        }
      } else if (lower.endsWith('.csv')) {
        const text = await file.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        let importedCount = 0;
        const added: SceneObject[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map((c) => c.trim());
          if (cols.length < 3) continue;
          const [name, chStr, patchStr] = cols;
          const [uStr, aStr] = (patchStr || '1.1').split('.');
          added.push({
            id: `csv-fx-${Date.now()}-${i}`,
            name: name || `Fixture ${i}`,
            kind: 'moving-head',
            position: [Number(((i - 1) * 1.1 - 2).toFixed(2)), 4.42, -1.0],
            rotation: [0, 0, 0],
            layerId: undefined,
            channel: Number(chStr) || 100 + i,
            dmxUniverse: Number(uStr) || 1,
            dmxAddress: Number(aStr) || 1,
            dmxFootprint: 16,
            intensity: 0.8,
            color: '#FFFFFF',
            beamAngle: 20,
            pan: 0,
            tilt: 22,
          });
          importedCount++;
        }
        if (added.length > 0) {
          setObjects((prev) => [...prev, ...added]);
          showToast(`Imported ${importedCount} fixtures from CSV "${file.name}"`);
        }
      }
    },
    [handlePlaceGdtfProfile, showToast],
  );

  const handleImportProjectContentFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const bundle = JSON.parse(String(reader.result)) as ProjectDocument;
          if (Array.isArray(bundle.objects)) {
            const merged = bundle.objects.map((o, idx) => ({
              ...o,
              id: `${o.id}-merged-${Date.now()}-${idx}`,
            }));
            setObjects((prev) => [...prev, ...merged]);
            showToast(`Merged ${merged.length} objects from "${file.name}"`);
          }
        } catch {
          showToast(`Could not merge "${file.name}"`);
        }
      };
      reader.readAsText(file);
    },
    [showToast],
  );

  const handleExportModel = useCallback(() => {
    const lines = ['# Capture Lighting Visualizer OBJ Export'];
    let vIdx = 1;
    for (const o of objects) {
      lines.push(`o ${o.name.replace(/\s+/g, '_')}`);
      const [x, y, z] = o.position;
      const hw = (o.length ?? 0.4) / 2;
      const hh = 0.25;
      const hd = (o.width ?? 0.4) / 2;
      const verts = [
        [x - hw, y - hh, z - hd],
        [x + hw, y - hh, z - hd],
        [x + hw, y + hh, z - hd],
        [x - hw, y + hh, z - hd],
        [x - hw, y - hh, z + hd],
        [x + hw, y - hh, z + hd],
        [x + hw, y + hh, z + hd],
        [x - hw, y + hh, z + hd],
      ];
      for (const v of verts) lines.push(`v ${v[0].toFixed(3)} ${v[1].toFixed(3)} ${v[2].toFixed(3)}`);
      lines.push(`f ${vIdx} ${vIdx + 1} ${vIdx + 2} ${vIdx + 3}`);
      lines.push(`f ${vIdx + 4} ${vIdx + 5} ${vIdx + 6} ${vIdx + 7}`);
      vIdx += 8;
    }
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain' }), 'capture-scene.obj');
    showToast('Exported 3D model "capture-scene.obj"');
  }, [objects, showToast]);

  const handleExportFixtureData = useCallback(() => {
    const rows = ['Name,Channel,Patch,Footprint,X,Y,Z,Color'];
    for (const o of objects) {
      if (o.kind !== 'moving-head' && o.kind !== 'led-par' && o.kind !== 'gdtf-fixture') continue;
      rows.push(
        `"${o.name}",${o.channel ?? ''},${o.dmxUniverse ?? 1}.${String(o.dmxAddress ?? 1).padStart(3, '0')},${o.dmxFootprint ?? 8},${o.position.join(',')},${o.color ?? '#FFFFFF'}`,
      );
    }
    downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), 'fixture-patch.csv');
    showToast('Exported fixture patch "fixture-patch.csv"');
  }, [objects, showToast]);

  const handleUpdateLayer = useCallback((id: string, patch: Partial<LayerItem>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const handleAddLayer = useCallback((name?: string) => {
    const palette = [
      '#2563EB',
      '#D97706',
      '#059669',
      '#DC2626',
      '#7C3AED',
      '#0891B2',
      '#DB2777',
      '#4F46E5',
    ];
    const index = layersRef.current.length + 1;
    const color = palette[(index - 1) % palette.length];
    const newLayer: LayerItem = {
      id: `layer-${Date.now()}-${nextIdCounter.current++}`,
      name: (name && name.trim()) || `Layer ${index}`,
      visible: true,
      locked: false,
      color,
      lineWeightPt: 0.75,
      lineStyle: 'Solid',
    };
    setLayers((prev) => [...prev, newLayer]);
  }, []);

  const handleDeleteLayer = useCallback((id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setObjects((prev) =>
      prev.map((obj) => (obj.layerId === id ? { ...obj, layerId: undefined } : obj)),
    );
    setViewports((prev) => {
      let changed = false;
      const next = { ...prev };
      (['alpha', 'beta', 'gamma'] as ViewportId[]).forEach((vpId) => {
        if (next[vpId].customIsolatedLayerId === id) {
          next[vpId] = { ...next[vpId], customIsolatedLayerId: 'all' };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const handleUpdateGroupFixtures = useCallback(
    (groupId: string, patch: Partial<SceneObject>) => {
      const lockedLayerIds = new Set(layersRef.current.filter((l) => l.locked).map((l) => l.id));
      let skippedLocked = false;
      for (const obj of objectsRef.current) {
        if (obj.groupId === groupId && obj.layerId && lockedLayerIds.has(obj.layerId)) {
          skippedLocked = true;
          break;
        }
      }
      if (skippedLocked) notifyLockedLayer();
      setObjects((prev) =>
        prev.map((o) => {
          if (o.groupId !== groupId) return o;
          if (o.layerId && lockedLayerIds.has(o.layerId)) return o;
          return { ...o, ...patch };
        }),
      );
    },
    [notifyLockedLayer],
  );

  const handleRecallSnapshot = useCallback(
    (id: string) => {
      const snap = snapshots.find((s) => s.id === id);
      if (!snap) return;
      setObjects((prev) =>
        prev.map((obj) => {
          if (obj.includeInScenes === false) return obj;
          const state = snap.fixtureStates[obj.id];
          if (!state) return obj;
          return {
            ...obj,
            intensity: state.intensity,
            color: state.color,
            pan: state.pan,
            tilt: state.tilt,
            beamAngle: state.beamAngle,
          };
        }),
      );
    },
    [snapshots],
  );

  const handleCaptureSnapshot = useCallback(
    (name: string) => {
      const fixtureStates: LightingSnapshot['fixtureStates'] = {};
      for (const obj of objects) {
        if (obj.kind === 'moving-head' || obj.kind === 'led-par' || obj.kind === 'gdtf-fixture') {
          fixtureStates[obj.id] = {
            intensity: obj.intensity ?? 0.8,
            color: obj.color ?? '#ffffff',
            pan: obj.pan ?? 0,
            tilt: obj.tilt ?? 20,
            beamAngle: obj.beamAngle ?? 20,
          };
        }
      }
      const newSnap: LightingSnapshot = {
        id: `snap-${Date.now()}`,
        name,
        description: `Captured ${Object.keys(fixtureStates).length} fixtures`,
        fixtureStates,
      };
      setSnapshots((prev) => [newSnap, ...prev]);
    },
    [objects],
  );

  const handleStoreCameraPreset = useCallback((preset: Omit<CameraPreset, 'id'>) => {
    setCameraPresets((prev) => [...prev, { ...preset, id: `cam-${Date.now()}` }]);
  }, []);

  const handleRecallCameraPreset = useCallback(
    (preset: CameraPreset, targetViewportId: ViewportId) => {
      setViewports((prev) => ({
        ...prev,
        [targetViewportId]: {
          ...prev[targetViewportId],
          projection: preset.projection,
        },
      }));
      setCameraCommand({
        nonce: Date.now(),
        targetViewportId,
        preset,
      });
    },
    [],
  );

  // Global keyboard shortcuts for Delete/Backspace/Escape and Save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) void handleSaveProjectAs();
        else void handleSaveProject();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNewProject();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openFileInputRef.current?.click();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObjectIds.length > 0) {
        e.preventDefault();
        handleDeleteObjects(selectedObjectIds);
      } else if (e.key === 'Escape') {
        setSelectedObjectIds([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedObjectIds, handleDeleteObjects, handleSaveProject, handleSaveProjectAs, handleNewProject]);

  const toggleMaximize = (pane: PaneId) => {
    setMaximizedPane((curr) => (curr === pane ? null : pane));
  };

  const togglePopOut = (pane: PaneId) => {
    setPoppedOutPanes((prev) => ({ ...prev, [pane]: !prev[pane] }));
    if (maximizedPane === pane) setMaximizedPane(null);
  };

  const popDragRef = useRef<{
    pane: PaneId | null;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({
    pane: null,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const renderPaneContent = (pane: PaneId) => {
    if (pane === 'project') {
      return (
        <ProjectPanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          metadata={metadata}
          onUpdateMetadata={(patch) => setMetadata((prev) => ({ ...prev, ...patch }))}
          objects={objects}
          selectedObjectIds={selectedObjectIds}
          onSelectObject={handleSelectObject}
          onUpdateObjects={handleUpdateObjects}
          onChangeGdtfMode={handleChangeGdtfMode}
          onDeleteObjects={handleDeleteObjects}
          onDuplicateObjects={handleDuplicateObjects}
          gdtfProfiles={gdtfProfiles}
          gdtfLibraryEntries={gdtfLibraryEntries}
          skpModels={skpModels}
          skpLibraryEntries={skpLibraryEntries}
          dmxUniverses={dmxUniverses}
          dmxSweepActive={dmxSweepActive}
          onToggleDmxSweep={() => setDmxSweepActive((v) => !v)}
          onWriteDmxChannel={handleWriteDmxChannel}
          recentCatalogIds={recentCatalogIds}
          onPlaceCatalogItem={placeCatalogItem}
          onPlaceGdtfProfile={handlePlaceGdtfProfile}
          onPlaceSkpModel={handlePlaceSkpModel}
          onImportGdtfFile={handleImportGdtfFile}
          onLoadSampleGdtf={handleLoadSampleGdtf}
          onDeleteGdtfProfile={handleDeleteGdtfProfile}
          onImportSkpFile={handleImportSkpFile}
          onLoadSampleSkp={handleLoadSampleSkp}
          viewports={viewports}
          onUpdateViewport={handleUpdateViewport}
          layers={layers}
          onUpdateLayer={handleUpdateLayer}
          onAddLayer={handleAddLayer}
          onDeleteLayer={handleDeleteLayer}
          onApplyMaterial={(matId) => handleApplyMaterialToObjects(matId)}
          fixtureGroups={INITIAL_FIXTURE_GROUPS}
          onUpdateGroupFixtures={handleUpdateGroupFixtures}
          snapshots={snapshots}
          onRecallSnapshot={handleRecallSnapshot}
          onCaptureSnapshot={handleCaptureSnapshot}
          cameraPresets={cameraPresets}
          onRecallCameraPreset={handleRecallCameraPreset}
        />
      );
    }

    return (
      <CadViewport
        settings={viewports[pane]}
        objects={objects}
        layers={layers}
        selectedObjectIds={selectedObjectIds}
        gdtfProfiles={gdtfProfiles}
        dmxUniverses={dmxUniverses}
        cameraCommand={cameraCommand}
        transformGhostItems={transformGhostItems}
        onTransformGhostChange={setTransformGhostItems}
        onSelectObject={handleSelectObject}
        onSelectMultiple={handleSelectMultiple}
        onMoveObjects={handleMoveObjects}
        onDropLibraryItem={handleDropLibraryItem}
        onDropGdtfProfile={(profileId, modeName, pos) => {
          const catalogMatch = /^catalog:(.+)$/.exec(profileId);
          if (catalogMatch) {
            const entry = gdtfLibraryEntries.find((e) => e.id === catalogMatch[1]);
            if (!entry) return;
            void loadGdtfLibraryProfile(entry)
              .then((profile) => {
                setGdtfProfiles((prev) =>
                  prev.some((p) => p.id === profile.id) ? prev : [profile, ...prev],
                );
                handlePlaceGdtfProfile(profile, modeName, pos);
              })
              .catch((err: unknown) =>
                showToast(`Failed to load GDTF: ${err instanceof Error ? err.message : String(err)}`),
              );
            return;
          }
          const profile = gdtfProfiles.find((p) => p.id === profileId);
          if (profile) handlePlaceGdtfProfile(profile, modeName, pos);
        }}
        onDropSkpModel={(skpModelId, pos) => {
          const catalogMatch = /^catalog:(.+)$/.exec(skpModelId);
          if (catalogMatch) {
            const entry = skpLibraryEntries.find((e) => e.id === catalogMatch[1]);
            if (!entry) return;
            void loadSkpLibraryModel(entry)
              .then((model) => {
                setSkpModels((prev) => (prev.some((m) => m.id === model.id) ? prev : [model, ...prev]));
                handlePlaceSkpModel(model, pos, entry);
              })
              .catch((err: unknown) =>
                showToast(`Failed to load truss: ${err instanceof Error ? err.message : String(err)}`),
              );
            return;
          }
          const m = skpModels.find((x) => x.id === skpModelId);
          if (m) handlePlaceSkpModel(m, pos);
        }}
        onDropMaterial={handleDropMaterial}
        onDropExternalFiles={(files, pos) => void handleDropExternalFiles(files, pos)}
        onUpdateSettings={handleUpdateViewport}
        onUpdateObjects={handleUpdateObjects}
        onDuplicateObjects={handleDuplicateObjects}
        onDeleteObjects={handleDeleteObjects}
        onShowDetails={() => {
          setActiveTab('Design');
          setActiveCategory('Selected Items');
        }}
        onStoreCameraPreset={handleStoreCameraPreset}
      />
    );
  };

  const PANE_ORDER: Array<{ id: PaneId; title: string }> = [
    { id: 'alpha', title: 'Alpha View' },
    { id: 'beta', title: 'Beta View' },
    { id: 'gamma', title: 'Gamma View' },
    { id: 'project', title: 'Project' },
  ];

  const windowTitle = metadata.project.trim() ? metadata.project.trim() : 'Untitled - Demo';

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#000000]">
      {/* Web app toolbar: app identity, file actions, document title, fullscreen */}
      <header className="h-[36px] shrink-0 bg-[#222222] border-b border-[#000000] flex items-center px-[10px] gap-[6px] select-none relative z-40">
        <div className="flex items-center gap-[6px] shrink-0">
          <div className="w-[19px] h-[19px] rounded-[4px] bg-[#7CE043]/15 border border-[#7CE043]/45 flex items-center justify-center">
            <FixtureGroupsIcon className="w-[13px] h-[13px]" />
          </div>
          <span className="text-[11px] font-semibold tracking-[0.02em] text-[#E5E5E5]">Capture</span>
        </div>

        <div className="h-[16px] w-px bg-[#3A3A3A] shrink-0" />

        {/* File Dropdown Menu */}
        <FileMenuBar
          platformModifier={MOD_KEY}
          recentFiles={recentFiles}
          onNewProject={handleNewProject}
          onOpenProjectFile={handleOpenProjectFile}
          onOpenRecent={() => {
            try {
              const raw = localStorage.getItem('capture_last_saved_project');
              if (raw) {
                const bundle = JSON.parse(raw) as ProjectDocument;
                if (applyDocument(bundle)) showToast('Restored recent project from local session');
              }
            } catch {
              // ignore
            }
          }}
          onSaveProject={handleSaveProject}
          onSaveProjectAs={handleSaveProjectAs}
          onImportModelFile={(f) => void handleImportSkpFile(f)}
          onImportFixtureDataFile={(f) => void handleImportFixtureDataFile(f)}
          onImportProjectContentFile={handleImportProjectContentFile}
          onExportProject={handleExportLegacyJson}
          onExportModel={handleExportModel}
          onExportFixtureData={handleExportFixtureData}
        />

        <div className="h-[16px] w-px bg-[#3A3A3A] shrink-0" />

        <div className="flex items-center gap-[2px] shrink-0">
          <ToolbarButton label={`New project (${MOD_KEY} N)`} onClick={handleNewProject}>
            <FilePlus2 size={14} strokeWidth={1.7} />
          </ToolbarButton>
          <ToolbarButton
            label={`Open project (${MOD_KEY} O)`}
            onClick={() => openFileInputRef.current?.click()}
          >
            <FolderOpen size={14} strokeWidth={1.7} />
          </ToolbarButton>
          <ToolbarButton label={`Save project (${MOD_KEY} S)`} onClick={handleSaveProject}>
            <Save size={14} strokeWidth={1.7} />
          </ToolbarButton>
        </div>

        {/* Document title, centered in the available space */}
        <div className="flex-1 min-w-0 flex justify-center px-[8px]">
          <span
            className="max-w-full text-[12px] leading-none font-medium text-[#CCCCCC] tracking-[0.01em] truncate"
            title={windowTitle}
          >
            {windowTitle}
          </span>
        </div>

        <div className="flex items-center gap-[6px] shrink-0">
          {toastMsg && (
            <div className="px-2 py-0.5 bg-[#1B3311] border border-[#4D8C2A] text-[#6BC938] text-[10px] truncate max-w-[260px]">
              {toastMsg}
            </div>
          )}
          <div className="h-[16px] w-px bg-[#3A3A3A]" />
          <ToolbarButton
            label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 size={14} strokeWidth={1.7} />
            ) : (
              <Maximize2 size={14} strokeWidth={1.7} />
            )}
          </ToolbarButton>
        </div>

        <input
          ref={openFileInputRef}
          type="file"
          accept=".json,.c2p"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleOpenProjectFile(f);
            e.target.value = '';
          }}
        />
      </header>

      {/* Main 2x2 Quad-Pane Grid Workspace separated by 1px pure black (#000000) dividers */}
      <main className="relative flex-1 min-h-0 bg-[#000000]">
        <div
          className={`w-full h-full bg-[#000000] ${
            maximizedPane
              ? 'grid grid-cols-1 grid-rows-1'
              : 'grid grid-cols-2 grid-rows-2 gap-[1px]'
          }`}
        >
          {PANE_ORDER.map(({ id, title }) => {
            if (maximizedPane && maximizedPane !== id) return null;
            if (poppedOutPanes[id]) {
              return (
                <div
                  key={id}
                  className="flex flex-col items-center justify-center bg-[#0A0A0A] text-[#666666] text-[11px] gap-2"
                >
                  <span>{title} is detached</span>
                  <button
                    type="button"
                    onClick={() => togglePopOut(id)}
                    className="px-2.5 py-1 bg-[#262626] border border-[#4A4A4A] text-[#CCCCCC] hover:text-[#FFFFFF] cursor-pointer"
                  >
                    Dock {title}
                  </button>
                </div>
              );
            }

            return (
              <PaneFrame
                key={id}
                title={title}
                isMaximized={maximizedPane === id}
                isPoppedOut={false}
                onToggleMaximize={() => toggleMaximize(id)}
                onTogglePopOut={() => togglePopOut(id)}
              >
                {renderPaneContent(id)}
              </PaneFrame>
            );
          })}
        </div>

        {/* Floating Pop-out Windows */}
        {PANE_ORDER.filter(({ id }) => poppedOutPanes[id]).map(({ id, title }) => {
          const pos = popPositions[id];
          return (
            <div
              key={`pop-${id}`}
              className="fixed z-50 w-[560px] h-[390px] border border-[#4A4A4A] shadow-[0_18px_48px_rgba(0,0,0,0.85)] flex flex-col bg-[#000000]"
              style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
              onPointerDown={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest('button')) return;
                const header = target.closest('.bg-\\[\\#857431\\]');
                if (!header) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                popDragRef.current = {
                  pane: id,
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: pos.x,
                  origY: pos.y,
                };
              }}
              onPointerMove={(e) => {
                if (popDragRef.current.pane !== id) return;
                const dx = e.clientX - popDragRef.current.startX;
                const dy = e.clientY - popDragRef.current.startY;
                setPopPositions((prev) => ({
                  ...prev,
                  [id]: {
                    x: Math.max(0, popDragRef.current.origX + dx),
                    y: Math.max(28, popDragRef.current.origY + dy),
                  },
                }));
              }}
              onPointerUp={(e) => {
                if (popDragRef.current.pane === id) {
                  popDragRef.current.pane = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                }
              }}
            >
              <PaneFrame
                title={title}
                isMaximized={false}
                isPoppedOut={true}
                onToggleMaximize={() => {
                  togglePopOut(id);
                  setMaximizedPane(id);
                }}
                onTogglePopOut={() => togglePopOut(id)}
              >
                {renderPaneContent(id)}
              </PaneFrame>
            </div>
          );
        })}
      </main>
    </div>
  );
}
