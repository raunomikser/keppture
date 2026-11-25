import React, { useMemo, useRef, useState } from 'react';
import {
  Anchor,
  Box,
  Cable,
  Circle,
  Cloud,
  Crosshair,
  Diamond,
  Droplets,
  Eye,
  FileText,
  Flame,
  Focus,
  Image as ImageIcon,
  Layers,
  Minus,
  Move3D,
  Navigation,
  RotateCw,
  Ruler,
  Sun,
  Triangle,
  Wind,
} from 'lucide-react';
import { LIBRARY_CATALOG, LIBRARY_FILTERS_BY_CATEGORY } from '../data/initialScene';
import { GdtfProfile } from '../gdtf/types';
import { resolveVfsAsset } from '../gdtf/vfsAndCache';
import { SkpParsedModel } from '../skp/skpParser';
import {
  CAPTURE_MATERIAL_CATEGORIES,
  CAPTURE_MATERIALS,
  getMaterialPreviewUrl,
} from '../three/materialsLibrary';
import {
  BuiltInGroup,
  GdtfLibraryEntry,
  LibraryCatalogItem,
  LibraryCategory,
  SkpLibraryEntry,
} from '../types/visualizer';
import {
  FolderGlyphIcon,
  LibBuiltInIcon,
  LibFiltersIcon,
  LibFixturesIcon,
  LibFixtureSymbolsIcon,
  LibGobosIcon,
  LibMaterialsIcon,
  LibObjectsIcon,
  LibRecentIcon,
  LibSymbolsIcon,
  LibTrussIcon,
  SearchMagnifierIcon,
} from './Icons';

/** Keeps the dragged library item as a small, readable chip instead of a full row screenshot. */
function setSmallDragImage(
  e: React.DragEvent<HTMLElement>,
  label: string,
  accent = '#6BC938',
) {
  const canvas = document.createElement('canvas');
  canvas.width = 104;
  canvas.height = 26;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = 'rgba(28, 28, 30, 0.96)';
  ctx.fillRect(0, 0, 104, 26);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, 103, 25);
  ctx.fillStyle = accent;
  ctx.fillRect(4, 4, 4, 18);
  ctx.fillStyle = '#EDF2F8';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.slice(0, 15), 13, 13);
  e.dataTransfer.setDragImage(canvas, 8, 13);
}

interface LibraryBrowserProps {
  gdtfProfiles: GdtfProfile[];
  gdtfLibraryEntries: GdtfLibraryEntry[];
  skpModels: SkpParsedModel[];
  skpLibraryEntries: SkpLibraryEntry[];
  recentCatalogIds: string[];
  hasSelectedFixtures: boolean;
  hasSelectedMaterialTargets?: boolean;
  onPlaceCatalogItem: (item: LibraryCatalogItem, position?: [number, number, number]) => void;
  onPlaceGdtfProfile: (profile: GdtfProfile, modeName?: string, position?: [number, number, number]) => void;
  onPlaceSkpModel: (
    model: SkpParsedModel,
    position?: [number, number, number],
    entry?: SkpLibraryEntry,
  ) => void;
  onImportGdtfFile: (file: File) => Promise<void>;
  onLoadSampleGdtf: () => Promise<void>;
  onDeleteGdtfProfile: (profileId: string) => void;
  onImportSkpFile: (file: File) => Promise<void>;
  onLoadSampleSkp: () => void;
  onApplyMaterial?: (materialId: string) => void;
  onApplyFilterColor: (hex: string) => void;
  onApplyGoboPreset: (goboName: string, goboMediaFile?: string) => void;
}

interface BuiltInEntry {
  label: string;
  icon: React.FC<{ className?: string }>;
  /** Present when the entry places a real scene object. */
  catalogId?: string;
}

const BUILT_IN_GROUPS: Array<{
  title: BuiltInGroup;
  items: BuiltInEntry[];
}> = [
  {
    title: 'Dimensioning',
    items: [
      { label: 'Distance', icon: Ruler },
      { label: 'Angle', icon: Triangle },
      { label: 'Line', icon: Minus },
      { label: 'Ruler', icon: Ruler },
      { label: 'Image', icon: ImageIcon },
      { label: 'Cable', icon: Cable },
    ],
  },
  {
    title: 'Snapping',
    items: [
      { label: 'Point Snapper', icon: Crosshair },
      { label: 'Directional Snapper', icon: Navigation },
      { label: 'Line Snapper', icon: Minus },
      { label: 'Circular Snapper', icon: Circle },
    ],
  },
  {
    title: 'Reporting',
    items: [
      { label: 'Report Item', icon: FileText },
      { label: 'Smoke Machine', icon: Cloud },
    ],
  },
  {
    title: 'Rigging',
    items: [
      { label: 'Rigging Point, Circle', icon: Circle },
      { label: 'Rigging Point, Square', icon: Box },
      { label: 'Rigging Point, Diamond', icon: Diamond },
      { label: 'Rigging Point, Triangle', icon: Triangle },
      { label: 'Sling', icon: Anchor },
      { label: 'Structure', icon: Layers },
    ],
  },
  {
    title: 'Motion',
    items: [
      { label: 'DMX Mover', icon: Move3D },
      { label: 'DMX Rotator', icon: RotateCw },
      { label: 'Motion Construct', icon: Focus },
    ],
  },
  {
    title: 'Effects',
    items: [
      { label: 'CO2 Jet', icon: Wind, catalogId: 'fx-co2-jet' },
      { label: 'Flame Jet', icon: Flame, catalogId: 'fx-flame-jet' },
      { label: 'Water Jet', icon: Droplets },
    ],
  },
  {
    title: 'Visualisation',
    items: [
      { label: 'Smoke', icon: Cloud },
      { label: 'HDRI', icon: Sun },
      { label: 'Reflection Plane', icon: Layers },
      { label: 'Focus Plane', icon: Eye },
    ],
  },
];

const LEFT_CATEGORIES: Array<{
  id: LibraryCategory;
  label: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'Built-In', label: 'Built-In', icon: LibBuiltInIcon },
  { id: 'Recent', label: 'Recent', icon: LibRecentIcon },
  { id: 'Objects', label: 'Objects', icon: LibObjectsIcon },
  { id: 'Materials', label: 'Materials', icon: LibMaterialsIcon },
  { id: 'Truss', label: 'Truss', icon: LibTrussIcon },
  { id: 'Fixtures', label: 'Fixtures', icon: LibFixturesIcon },
  { id: 'Fixture Symbols', label: 'Fixture Symbols', icon: LibFixtureSymbolsIcon },
  { id: 'Symbols', label: 'Symbols', icon: LibSymbolsIcon },
  { id: 'Filters', label: 'Filters', icon: LibFiltersIcon },
  { id: 'Gobos', label: 'Gobos', icon: LibGobosIcon },
];

export const LibraryBrowser: React.FC<LibraryBrowserProps> = ({
  gdtfProfiles,
  gdtfLibraryEntries,
  skpModels,
  skpLibraryEntries,
  recentCatalogIds,
  hasSelectedFixtures,
  hasSelectedMaterialTargets = false,
  onPlaceCatalogItem,
  onPlaceGdtfProfile,
  onPlaceSkpModel,
  onImportGdtfFile,
  onLoadSampleGdtf,
  onDeleteGdtfProfile,
  onImportSkpFile,
  onLoadSampleSkp,
  onApplyMaterial,
  onApplyFilterColor,
  onApplyGoboPreset,
}) => {
  const [activeCategory, setActiveCategory] = useState<LibraryCategory>('Fixtures');
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedFilters, setCheckedFilters] = useState<Record<string, boolean>>({});
  const [gdtfBusy, setGdtfBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showImporters, setShowImporters] = useState(false);
  const [libraryVisibleLimit, setLibraryVisibleLimit] = useState(80);

  const gdtfInputRef = useRef<HTMLInputElement>(null);
  const skpInputRef = useRef<HTMLInputElement>(null);

  const handleSelectCategory = (cat: LibraryCategory) => {
    setActiveCategory(cat);
    setOpenFolder(null);
    setCheckedFilters({});
    setStatusError(null);
  };

  const activeFilterList = useMemo(
    () => Object.keys(checkedFilters).filter((k) => checkedFilters[k]),
    [checkedFilters],
  );

  const toggleFilter = (tag: string) => {
    setCheckedFilters((prev) => ({ ...prev, [tag]: !prev[tag] }));
  };

  const filterOptions = LIBRARY_FILTERS_BY_CATEGORY[activeCategory] ?? [];

  // Combine built-in catalog items + dynamic GDTF items (under Fixtures / Gobos)
  const categoryItems = useMemo(() => {
    if (activeCategory === 'Recent') {
      const byId = new Map(LIBRARY_CATALOG.map((item) => [item.id, item]));
      const recents = recentCatalogIds
        .map((id) => byId.get(id))
        .filter((x): x is LibraryCatalogItem => Boolean(x));
      return recents.length > 0 ? recents : LIBRARY_CATALOG.slice(0, 5);
    }
    return LIBRARY_CATALOG.filter((item) => item.libraryCategory === activeCategory);
  }, [activeCategory, recentCatalogIds]);

  // Dynamic GDTF virtual items when viewing Fixtures
  const gdtfAsItems = useMemo(() => {
    if (activeCategory !== 'Fixtures' && activeCategory !== 'Built-In') return [];
    return gdtfProfiles.map((p) => ({
      profile: p,
      folder: p.metadata.manufacturer || 'GDTF Imported',
      filterTags: ['Moving Head', 'Yoke', 'Lighting', 'GDTF Package'],
    }));
  }, [activeCategory, gdtfProfiles]);

  // Dynamic GDTF gobo wheel slots when viewing Gobos
  const gdtfGoboSlots = useMemo(() => {
    if (activeCategory !== 'Gobos') return [];
    const list: Array<{ profileId: string; profileName: string; slotName: string; mediaFile?: string }> = [];
    for (const p of gdtfProfiles) {
      for (const wheel of Object.values(p.wheels)) {
        for (const slot of wheel.slots) {
          list.push({
            profileId: p.id,
            profileName: p.metadata.name,
            slotName: slot.name,
            mediaFile: slot.mediaFileName,
          });
        }
      }
    }
    return list;
  }, [activeCategory, gdtfProfiles]);

  const query = searchQuery.trim().toLowerCase();
  const isFiltering = query.length > 0 || activeFilterList.length > 0;

  // Filtered catalog items
  const filteredItems = useMemo(() => {
    return categoryItems.filter((item) => {
      if (openFolder && !isFiltering && item.folder !== openFolder) return false;
      if (activeFilterList.length > 0) {
        const hasMatch = activeFilterList.some((tag) => item.filterTags.includes(tag));
        if (!hasMatch) return false;
      }
      if (query) {
        const hay = `${item.name} ${item.manufacturer} ${item.folder} ${item.description}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [categoryItems, openFolder, isFiltering, activeFilterList, query]);

  const filteredGdtf = useMemo(() => {
    return gdtfAsItems.filter(({ profile, folder, filterTags }) => {
      if (openFolder && !isFiltering && folder !== openFolder) return false;
      if (activeFilterList.length > 0) {
        if (!activeFilterList.some((tag) => filterTags.includes(tag))) return false;
      }
      if (query) {
        const hay = `${profile.metadata.name} ${profile.metadata.manufacturer} ${profile.metadata.description}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [gdtfAsItems, openFolder, isFiltering, activeFilterList, query]);

  // Real GDTF archives shipped with the app (index loaded from catalog.json)
  const filteredLibraryGdtf = useMemo(() => {
    if (activeCategory !== 'Fixtures' && activeCategory !== 'Built-In') return [];
    return gdtfLibraryEntries.filter((entry) => {
      if (openFolder && !isFiltering && entry.manufacturer !== openFolder) return false;
      if (query) {
        const hay = `${entry.name} ${entry.manufacturer} ${entry.description}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [activeCategory, gdtfLibraryEntries, openFolder, isFiltering, query]);

  const importedSkpModels = useMemo(
    () =>
      skpModels.filter(
        (model) => !skpLibraryEntries.some((entry) => entry.fileName === model.fileName),
      ),
    [skpModels, skpLibraryEntries],
  );

  // Real SketchUp-derived truss models from the packaged library
  const filteredSkpLibrary = useMemo(() => {
    if (activeCategory !== 'Truss') return [];
    return skpLibraryEntries.filter((entry) => {
      if (openFolder && !isFiltering && entry.manufacturer !== openFolder) return false;
      if (query) {
        const hay = `${entry.name} ${entry.manufacturer} ${entry.folder} ${entry.connectorSeries ?? ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [activeCategory, skpLibraryEntries, openFolder, isFiltering, query]);

  // Compute alphabetical folder list (with "Generic" pinned first for Fixtures & Truss)
  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of categoryItems) {
      counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1);
    }
    if (activeCategory === 'Fixtures') {
      for (const g of gdtfAsItems) {
        counts.set(g.folder, (counts.get(g.folder) ?? 0) + 1);
      }
      for (const entry of gdtfLibraryEntries) {
        counts.set(entry.manufacturer, (counts.get(entry.manufacturer) ?? 0) + 1);
      }
    }
    if (activeCategory === 'Truss') {
      for (const entry of skpLibraryEntries) {
        counts.set(entry.manufacturer, (counts.get(entry.manufacturer) ?? 0) + 1);
      }
    }
    const sorted = Array.from(counts.keys()).sort((a, b) => {
      if (a === 'Generic') return -1;
      if (b === 'Generic') return 1;
      return a.localeCompare(b);
    });
    return sorted.map((name) => ({ name, count: counts.get(name) ?? 0 }));
  }, [categoryItems, gdtfAsItems, gdtfLibraryEntries, skpLibraryEntries, activeCategory]);

  const filteredMaterials = useMemo(() => {
    if (activeCategory !== 'Materials') return [];
    return CAPTURE_MATERIALS.filter((mat) => {
      if (activeFilterList.length > 0) {
        const hasMatch = activeFilterList.some((tag) => mat.filterTags.includes(tag));
        if (!hasMatch) return false;
      }
      if (query) {
        const hay = `${mat.name} ${mat.category} ${mat.filterTags.join(' ')}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [activeCategory, activeFilterList, query]);

  const groupedMaterials = useMemo(() => {
    if (activeCategory !== 'Materials') return [];
    return CAPTURE_MATERIAL_CATEGORIES.map((cat) => ({
      category: cat,
      items: filteredMaterials.filter((m) => m.category === cat),
    })).filter((grp) => grp.items.length > 0);
  }, [activeCategory, filteredMaterials]);

  const showFolderView =
    !isFiltering &&
    openFolder === null &&
    activeCategory !== 'Built-In' &&
    activeCategory !== 'Recent' &&
    activeCategory !== 'Materials' &&
    folders.length > 1;

  const handleGdtfFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setStatusError(null);
    setGdtfBusy(true);
    try {
      for (const file of Array.from(files)) {
        await onImportGdtfFile(file);
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to parse .gdtf archive');
    } finally {
      setGdtfBusy(false);
    }
  };

  const handleSkpFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setStatusError(null);
    try {
      for (const file of Array.from(files)) {
        await onImportSkpFile(file);
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to parse 3D model file');
    }
  };

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden bg-[#23334D] text-[#F5F8FC] text-[11px]">
      {/* 1. Left Category Sidebar with labels (matches Design sidebar) */}
      <div className="w-[145px] shrink-0 bg-[#1B2940] border-r border-[#2A3A54] p-[4px] flex flex-col gap-[2px] overflow-y-auto capture-scroll">
        {LEFT_CATEGORIES.map(({ id, label, icon: Icon }) => {
          const isActive = activeCategory === id;
          return (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => handleSelectCategory(id)}
              className={`w-full h-[28px] px-[6px] flex items-center gap-[8px] text-left text-[11px] whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-[#3A4B68] text-[#F5F8FC] border border-[#94A3B8]'
                  : 'bg-transparent text-[#CBD5E1] border border-transparent hover:bg-[#2C3C58] hover:text-[#F5F8FC]'
              }`}
            >
              <Icon className="w-[22px] h-[22px] shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {/* 2. Main Content Area (Dynamic Asset & Folder List) */}
      <div className="flex-1 min-w-0 flex flex-col bg-[#23334D] overflow-hidden">
        {/* Header / Breadcrumb & Search Bar */}
        <div className="h-[28px] shrink-0 bg-[#1B2940] border-b border-[#2A3A54] px-[8px] flex items-center justify-between gap-2">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 min-w-0 text-[11px] truncate">
            <button
              type="button"
              onClick={() => setOpenFolder(null)}
              className={`hover:text-[#F5F8FC] cursor-pointer ${
                openFolder ? 'text-[#B2BECE]' : 'text-[#F5F8FC] font-semibold'
              }`}
            >
              {activeCategory}
            </button>
            {openFolder && !isFiltering && (
              <>
                <span className="text-[#7A8AA3]">›</span>
                <span className="text-[#F5F8FC] font-semibold truncate">{openFolder}</span>
              </>
            )}
            {isFiltering && (
              <>
                <span className="text-[#7A8AA3]">›</span>
                <span className="text-[#83D84C] text-[10px]">
                  Filtered (
                  {activeCategory === 'Materials'
                    ? filteredMaterials.length
                    : filteredItems.length + filteredGdtf.length}
                  )
                </span>
              </>
            )}
          </div>

          {/* Search Input ("filter") */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="relative flex items-center bg-[#2A3A54] border border-[#364860] focus-within:border-[#A08F52] h-[20px] px-1.5 w-[150px]">
              <SearchMagnifierIcon className="w-[11px] h-[11px] text-[#A8B5CB] shrink-0 mr-1" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="filter"
                className="w-full bg-transparent text-[11px] text-[#F5F8FC] placeholder-[#8695AD] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-[#A8B5CB] hover:text-[#F5F8FC] text-[10px] ml-1 cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Status / Error Banner */}
        {statusError && (
          <div className="px-2.5 py-1 bg-[#45231F] border-b border-[#FF6157]/60 text-[#FFC5C0] text-[10px] flex items-center justify-between">
            <span>{statusError}</span>
            <button type="button" onClick={() => setStatusError(null)} className="cursor-pointer ml-2">
              ×
            </button>
          </div>
        )}

        {/* Scrollable Folder & Asset Rows */}
        <div
          className="flex-1 min-h-0 overflow-y-auto capture-scroll"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files?.length) return;
            e.preventDefault();
            const first = e.dataTransfer.files[0];
            const lower = first.name.toLowerCase();
            if (lower.endsWith('.gdtf') || lower.endsWith('.zip')) {
              void handleGdtfFiles(e.dataTransfer.files);
            } else if (
              lower.endsWith('.skp') ||
              lower.endsWith('.glb') ||
              lower.endsWith('.gltf') ||
              lower.endsWith('.obj')
            ) {
              void handleSkpFiles(e.dataTransfer.files);
            }
          }}
        >
          {/* Built-In Category: tool groups + optional import engines */}
          {activeCategory === 'Built-In' && (
            <div className="p-2 flex flex-col gap-3">
              {BUILT_IN_GROUPS.map((group) => (
                <section key={group.title}>
                  <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-[#A8B5CB]">
                    {group.title}
                  </div>
                  <div className="flex flex-col">
                    {group.items.map((entry) => {
                      const Icon = entry.icon;
                      const item = entry.catalogId
                        ? LIBRARY_CATALOG.find((c) => c.id === entry.catalogId)
                        : undefined;
                      return (
                        <button
                          key={entry.label}
                          type="button"
                          draggable={Boolean(item)}
                          title={
                            item
                              ? `Drag ${entry.label} into a viewport`
                              : `${entry.label} — not implemented yet`
                          }
                          onDragStart={(e) => {
                            if (!item) return;
                            e.dataTransfer.setData('application/x-capture-library-item', item.id);
                            e.dataTransfer.setData('application/x-capture-fixture', item.kind);
                            e.dataTransfer.effectAllowed = 'copy';
                            setSmallDragImage(e, item.name, '#5AC8FA');
                          }}
                          className={`h-[24px] px-2 flex items-center gap-2 text-left ${
                            item
                              ? 'text-[#F5F8FC] hover:bg-[#354663] cursor-grab active:cursor-grabbing'
                              : 'text-[#AEBBD0] hover:bg-[#2F3F5B] cursor-default'
                          }`}
                        >
                          <Icon className="w-[14px] h-[14px] shrink-0" />
                          <span>{entry.label}</span>
                          {item && <span className="ml-auto text-[9px] text-[#83D84C]">Drag</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}

              <section className="border-t border-[#2A3A54] pt-2">
                <button
                  type="button"
                  onClick={() => setShowImporters((v) => !v)}
                  className="w-full px-2 py-1 flex items-center justify-between text-[10px] uppercase tracking-[0.08em] text-[#A8B5CB] hover:text-[#F5F8FC] cursor-pointer"
                >
                  <span>Importers (GDTF / 3D models)</span>
                  <span>{showImporters ? '−' : '+'}</span>
                </button>
                {showImporters && (
                  <div className="flex flex-col gap-2 mt-2">
              {/* GDTF Importer Strip */}
              <div className="p-2 bg-[#1B2940] border border-[#2A3A54] flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-[#F5F8FC]">GDTF Engine (DIN SPEC 15800)</div>
                    <div className="text-[10px] text-[#B2BECE]">
                      Drop .gdtf archive here or import to IndexedDB VFS cache
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={gdtfBusy}
                      onClick={() => void onLoadSampleGdtf()}
                      className="px-2 py-0.5 bg-[#487F28] border border-[#63A93B] hover:bg-[#55972E] text-[10px] text-[#F5F8FC] cursor-pointer"
                    >
                      {gdtfBusy ? 'Parsing...' : 'Load Sample .gdtf'}
                    </button>
                    <button
                      type="button"
                      disabled={gdtfBusy}
                      onClick={() => gdtfInputRef.current?.click()}
                      className="px-2 py-0.5 bg-[#364860] border border-[#2A3A54] hover:bg-[#4E5F79] text-[10px] cursor-pointer"
                    >
                      Import .gdtf...
                    </button>
                    <input
                      ref={gdtfInputRef}
                      type="file"
                      accept=".gdtf,.zip"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        void handleGdtfFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>

                {gdtfProfiles.length > 0 && (
                  <div className="flex flex-col border-t border-[#2E3E59] pt-1.5 gap-1">
                    {gdtfProfiles.map((profile) => {
                      const thumbEntry = profile.metadata.thumbnail
                        ? resolveVfsAsset(profile.id, profile.metadata.thumbnail, ['.png', '.jpg'])
                        : undefined;
                      const primaryMode = profile.dmxModes[0];
                      return (
                        <div
                          key={profile.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(
                              'application/x-capture-gdtf',
                              JSON.stringify({
                                profileId: profile.id,
                                modeName: primaryMode?.name,
                              }),
                            );
                            e.dataTransfer.effectAllowed = 'copy';
                            setSmallDragImage(e, profile.metadata.name);
                          }}
                          title={`Drag ${profile.metadata.name} into a viewport`}
                          className="flex items-center justify-between gap-2 px-2 py-1 bg-[#23334D] border border-[#2A3A54] hover:border-[#A08F52] cursor-grab active:cursor-grabbing"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {thumbEntry ? (
                              <img
                                src={thumbEntry.objectUrl}
                                alt={profile.metadata.name}
                                className="w-[22px] h-[22px] object-contain bg-[#111] border border-[#333] shrink-0"
                              />
                            ) : (
                              <div className="w-[22px] h-[22px] bg-[#1D3316] border border-[#5A9E35] flex items-center justify-center text-[9px] text-[#83D84C] shrink-0">
                                GDTF
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-[#F5F8FC] font-medium truncate">
                                {profile.metadata.manufacturer} — {profile.metadata.name}
                              </div>
                              <div className="text-[9px] text-[#A8B5CB] truncate">
                                {profile.dmxModes.length} modes · {primaryMode?.footprint ?? 0} DMX ch ·{' '}
                                {Object.keys(profile.wheels).length} wheels · {Object.keys(profile.models).length} models
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => onDeleteGdtfProfile(profile.id)}
                              title="Remove from IndexedDB cache"
                              className="px-1.5 py-0.5 bg-[#45231F] hover:bg-[#6A2824] border border-[#2A3A54] text-[10px] text-[#FFA9A1] cursor-pointer"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* SketchUp .skp & 3D Model Importer Strip */}
              <div className="p-2 bg-[#1B2940] border border-[#2A3A54] flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-[#F5F8FC]">SketchUp (.skp) & 3D Model Pipeline</div>
                    <div className="text-[10px] text-[#B2BECE]">
                      Hierarchical component tree, normals, UVs & parent-child matrices
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={onLoadSampleSkp}
                      className="px-2 py-0.5 bg-[#A08F52] hover:bg-[#B09E5A] text-[10px] text-[#F5F8FC] cursor-pointer"
                    >
                      Load Sample .skp
                    </button>
                    <button
                      type="button"
                      onClick={() => skpInputRef.current?.click()}
                      className="px-2 py-0.5 bg-[#364860] border border-[#2A3A54] hover:bg-[#4E5F79] text-[10px] cursor-pointer"
                    >
                      Import .skp/.glb...
                    </button>
                    <input
                      ref={skpInputRef}
                      type="file"
                      accept=".skp,.glb,.gltf,.obj"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        void handleSkpFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>

                {importedSkpModels.length > 0 && (
                  <div className="flex flex-col border-t border-[#2E3E59] pt-1.5 gap-1">
                    {importedSkpModels.map((model) => (
                      <div
                        key={model.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-capture-skp', model.id);
                          e.dataTransfer.effectAllowed = 'copy';
                          setSmallDragImage(e, model.fileName, '#5AC8FA');
                        }}
                        title={`Drag ${model.fileName} into a viewport`}
                        className="flex items-center justify-between gap-2 px-2 py-1 bg-[#23334D] border border-[#2A3A54] hover:border-[#A08F52] cursor-grab active:cursor-grabbing"
                      >
                        <div className="min-w-0">
                          <div className="text-[#F5F8FC] font-medium truncate">{model.fileName}</div>
                          <div className="text-[9px] text-[#A8B5CB] truncate">
                            {model.sketchUpVersion} · {model.componentCount} components · {model.vertexCount} verts ·{' '}
                            {model.faceCount} faces
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* Folder List View (when browsing Manufacturers / Sub-Categories) */}
          {showFolderView && (
            <div className="flex flex-col divide-y divide-[#2A3A54]">
              {folders.map((folder, idx) => (
                <button
                  key={folder.name}
                  type="button"
                  onClick={() => setOpenFolder(folder.name)}
                  className={`w-full h-[26px] px-2.5 flex items-center justify-between text-left hover:bg-[#354663] cursor-pointer ${
                    idx % 2 === 0 ? 'bg-[#25344E]' : 'bg-[#1D2B43]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FolderGlyphIcon className="w-[14px] h-[14px] text-[#A08F52] shrink-0" />
                    <span className="text-[#F5F8FC] truncate">{folder.name}</span>
                  </span>
                  <span className="flex items-center gap-2 text-[10px] text-[#A8B5CB] shrink-0 tabular-nums">
                    <span>{folder.count}</span>
                    <span>›</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Materials Grouped View (Colours, Glossy, Matte, Metallic, Construction) */}
          {activeCategory === 'Materials' && (
            <div className="flex flex-col">
              <div className="px-2.5 py-1 bg-[#171B20] border-b border-[#2A3A54] text-[10px] text-[#B2BECE] flex items-center justify-between">
                <span>Drag a material directly onto any object in a CAD viewport to apply.</span>
                <span className="tabular-nums text-[#8695AD]">{filteredMaterials.length} materials</span>
              </div>

              {groupedMaterials.map((group) => (
                <div key={group.category} className="flex flex-col">
                  {/* Signature Blue Section Header */}
                  <div className="sticky top-0 z-10 h-[22px] bg-[#0058D0] border-y border-[#003E96] flex items-center justify-center px-4 shadow-sm">
                    <div className="w-[62%] max-w-[420px] text-center border-b border-white/80 pb-[1px] text-[11px] font-semibold text-[#F5F8FC] leading-none">
                      {group.category}
                    </div>
                  </div>

                  {/* Material Rows */}
                  {group.items.map((mat, idx) => (
                    <div
                      key={mat.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-capture-material', mat.id);
                        e.dataTransfer.effectAllowed = 'copy';
                        setSmallDragImage(e, mat.name, '#BF5AF2');
                      }}
                      onDoubleClick={() => hasSelectedMaterialTargets && onApplyMaterial?.(mat.id)}
                      title={`Drag "${mat.name}" onto any object in a viewport`}
                      className={`group h-[26px] px-2 flex items-center justify-between gap-2 border-b border-[#1B2944] hover:bg-[#354663] cursor-grab active:cursor-grabbing ${
                        idx % 2 === 0 ? 'bg-[#213049]' : 'bg-[#1B2940]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={getMaterialPreviewUrl(mat)}
                          alt={mat.name}
                          draggable={false}
                          className="w-[18px] h-[18px] border border-[#0D1727] shrink-0 object-cover select-none"
                        />
                        <span className="text-[11px] text-[#EDF2F8] truncate">{mat.name}</span>
                      </div>

                      {hasSelectedMaterialTargets && onApplyMaterial && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onApplyMaterial(mat.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 px-2 py-0.5 bg-[#364860] hover:bg-[#596A85] border border-[#2A3A54] text-[10px] text-[#F5F8FC] shrink-0 cursor-pointer transition-opacity"
                        >
                          Apply
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}

              {groupedMaterials.length === 0 && (
                <div className="p-4 text-center text-[#A8B5CB] text-[11px]">
                  No matching materials. Adjust your search or right-hand filters.
                </div>
              )}
            </div>
          )}

          {/* Asset Rows (inside opened folder, or during live filter/search, or flat category) */}
          {!showFolderView && activeCategory !== 'Built-In' && activeCategory !== 'Materials' && (
            <div className="flex flex-col divide-y divide-[#2A3A54]">
              {openFolder && !isFiltering && (
                <button
                  type="button"
                  onClick={() => setOpenFolder(null)}
                  className="w-full h-[23px] px-2.5 bg-[#1E2C44] hover:bg-[#2C2C2C] flex items-center gap-1.5 text-left text-[10px] text-[#D7E0EE] cursor-pointer"
                >
                  <span>‹ Back to {activeCategory}</span>
                </button>
              )}

              {/* Real GDTF archives from the packaged library */}
              {filteredLibraryGdtf.length > 0 && (
                <>
                  <div className="px-2.5 py-1 bg-[#1A2A12] border-y border-[#35551F] text-[9px] text-[#8FBF66] uppercase tracking-wide">
                    GDTF Library · {filteredLibraryGdtf.length} real profiles
                  </div>
                  {filteredLibraryGdtf.slice(0, libraryVisibleLimit).map((entry, idx) => {
                    const defaultMode = entry.modes.find((m) => m.default) ?? entry.modes[0];
                    const modelName = entry.name.toLowerCase().startsWith(entry.manufacturer.toLowerCase())
                      ? entry.name.slice(entry.manufacturer.length).trim()
                      : entry.name;
                    const channelCounts = entry.modes.map((m) => m.channels).filter((n) => n > 0);
                    const modeSummary = entry.modes.length
                      ? `${entry.modes.length} mode${entry.modes.length > 1 ? 's' : ''}${channelCounts.length ? ` · ${channelCounts.join(' / ')} ch` : ''}`
                      : 'GDTF';
                    return (
                      <div
                        key={entry.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            'application/x-capture-gdtf',
                            JSON.stringify({
                              profileId: `catalog:${entry.id}`,
                              modeName: defaultMode?.name ?? entry.defaultMode ?? undefined,
                            }),
                          );
                          e.dataTransfer.effectAllowed = 'copy';
                          setSmallDragImage(e, entry.name);
                        }}
                        title={`${entry.manufacturer} ${modelName}\nDrag into a viewport to load the real .gdtf profile`}
                        className={`px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-[#354663] cursor-grab active:cursor-grabbing ${
                          idx % 2 === 0 ? 'bg-[#25344E]' : 'bg-[#1D2B43]'
                        }`}
                      >
                        <div className="min-w-0 w-full">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1 py-0 bg-[#1D3316] border border-[#5A9E35] text-[9px] text-[#83D84C] shrink-0">
                              GDTF
                            </span>
                            <span className="text-[9px] uppercase tracking-wide text-[#A8B5CB] truncate">
                              {entry.manufacturer}
                            </span>
                          </div>
                          <div
                            className="text-[11px] leading-[13px] text-[#F5F8FC] font-medium break-words"
                            title={modelName}
                          >
                            {modelName}
                          </div>
                          <div className="text-[10px] text-[#94A3B8] truncate">
                            {defaultMode?.name ?? 'Standard'} · {modeSummary}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredLibraryGdtf.length > libraryVisibleLimit && (
                    <button
                      type="button"
                      onClick={() => setLibraryVisibleLimit((n) => n + 120)}
                      className="w-full h-[24px] bg-[#2E3E59] hover:bg-[#3B4D69] text-[10px] text-[#B6C2D3] cursor-pointer"
                    >
                      Show more GDTF profiles ({filteredLibraryGdtf.length - libraryVisibleLimit} remaining)
                    </button>
                  )}
                </>
              )}

              {/* GDTF Profiles in Fixtures view */}
              {filteredGdtf.map(({ profile }, idx) => {
                const primaryMode = profile.dmxModes[0];
                return (
                  <div
                    key={profile.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        'application/x-capture-gdtf',
                        JSON.stringify({ profileId: profile.id, modeName: primaryMode?.name }),
                      );
                      e.dataTransfer.effectAllowed = 'copy';
                      setSmallDragImage(e, profile.metadata.name);
                    }}
                    title={`${profile.metadata.manufacturer} ${profile.metadata.name}\nDrag into a viewport`}
                    className={`px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-[#354663] cursor-grab active:cursor-grabbing ${
                      idx % 2 === 0 ? 'bg-[#25344E]' : 'bg-[#1D2B43]'
                    }`}
                  >
                    <div className="min-w-0 w-full">
                      <div className="flex items-center gap-1.5">
                        <span className="px-1 py-0 bg-[#1D3316] border border-[#5A9E35] text-[9px] text-[#83D84C] shrink-0">
                          GDTF
                        </span>
                        <span className="text-[9px] uppercase tracking-wide text-[#A8B5CB] truncate">
                          {profile.metadata.manufacturer}
                        </span>
                      </div>
                      <div className="text-[11px] leading-[13px] text-[#F5F8FC] font-medium break-words">
                        {profile.metadata.name}
                      </div>
                      <div className="text-[10px] text-[#94A3B8] truncate">
                        {primaryMode?.name ?? 'Standard'} · {primaryMode?.footprint ?? 0} ch
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Extracted GDTF Gobos when browsing Gobos */}
              {gdtfGoboSlots.map((slot, i) => {
                const texEntry = slot.mediaFile
                  ? resolveVfsAsset(slot.profileId, slot.mediaFile, ['.png', '.jpg', '.webp'])
                  : undefined;
                return (
                  <div
                    key={`${slot.profileId}-${slot.slotName}-${i}`}
                    className="px-2.5 py-1.5 bg-[#1E2C43] hover:bg-[#33445F] flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {texEntry ? (
                        <img
                          src={texEntry.objectUrl}
                          alt={slot.slotName}
                          className="w-[18px] h-[18px] rounded-full border border-[#5B6B85] bg-[#08111F] shrink-0"
                        />
                      ) : (
                        <span className="w-[18px] h-[18px] rounded-full border border-[#5B6B85] flex items-center justify-center text-[9px]">
                          ◎
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="text-[#F5F8FC] truncate">{slot.slotName}</div>
                        <div className="text-[9px] text-[#83D84C] truncate">
                          GDTF Wheel ({slot.profileName})
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!hasSelectedFixtures}
                      onClick={() => onApplyGoboPreset(slot.slotName, slot.mediaFile)}
                      className="px-2 py-0.5 bg-[#364860] hover:bg-[#596A85] disabled:opacity-40 border border-[#2A3A54] text-[10px] shrink-0 cursor-pointer"
                    >
                      Apply
                    </button>
                  </div>
                );
              })}

              {/* Real SketchUp truss models from the packaged library */}
              {filteredSkpLibrary.length > 0 && (
                <>
                  <div className="px-2.5 py-1 bg-[#2A1E10] border-y border-[#6E5228] text-[9px] text-[#E5B769] uppercase tracking-wide">
                    SketchUp Truss Library · {filteredSkpLibrary.length} models
                  </div>
                  {filteredSkpLibrary.slice(0, libraryVisibleLimit).map((entry, idx) => {
                    const modelName = entry.name.toLowerCase().startsWith(entry.manufacturer.toLowerCase())
                      ? entry.name.slice(entry.manufacturer.length).trim()
                      : entry.name;
                    const [length, width, height] = entry.dimensions;
                    return (
                      <div
                        key={entry.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-capture-skp', `catalog:${entry.id}`);
                          e.dataTransfer.effectAllowed = 'copy';
                          setSmallDragImage(e, modelName, '#E5B769');
                        }}
                        title={`${entry.manufacturer} ${modelName}\n${length.toFixed(2)} m · ${width.toFixed(2)} × ${height.toFixed(2)} m section\nDrag into a viewport — ends snap magnetically`}
                        className={`px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-[#354663] cursor-grab active:cursor-grabbing ${
                          idx % 2 === 0 ? 'bg-[#25344E]' : 'bg-[#1D2B43]'
                        }`}
                      >
                        <div className="min-w-0 w-full">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1 py-0 bg-[#3A2A12] border border-[#8A6A32] text-[9px] text-[#E5B769] shrink-0">
                              SKP
                            </span>
                            <span className="text-[9px] uppercase tracking-wide text-[#A8B5CB] truncate">
                              {entry.manufacturer}
                            </span>
                          </div>
                          <div
                            className="text-[11px] leading-[13px] text-[#F5F8FC] font-medium break-words"
                            title={modelName}
                          >
                            {modelName}
                          </div>
                          <div className="text-[10px] text-[#94A3B8] truncate">
                            {length.toFixed(2)} m · {width.toFixed(2)} × {height.toFixed(2)} m · magnetic ends
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {filteredSkpLibrary.length > libraryVisibleLimit && (
                    <button
                      type="button"
                      onClick={() => setLibraryVisibleLimit((n) => n + 120)}
                      className="w-full h-[24px] bg-[#2E3E59] hover:bg-[#3B4D69] text-[10px] text-[#B6C2D3] cursor-pointer"
                    >
                      Show more SketchUp trusses ({filteredSkpLibrary.length - libraryVisibleLimit} remaining)
                    </button>
                  )}
                </>
              )}

              {/* Built-in Catalog Asset Rows */}
              {filteredItems.map((item, idx) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-capture-library-item', item.id);
                    e.dataTransfer.setData('application/x-capture-fixture', item.kind);
                    e.dataTransfer.effectAllowed = 'copy';
                    setSmallDragImage(e, item.name, item.kind === 'co2-jet' ? '#5AC8FA' : '#6BC938');
                  }}
                  title={`Drag ${item.name} into a viewport`}
                  className={`px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-[#354663] cursor-grab active:cursor-grabbing ${
                    idx % 2 === 0 ? 'bg-[#25344E]' : 'bg-[#1D2B43]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {activeCategory === 'Filters' && item.defaultColor && (
                      <span
                        className="w-[14px] h-[14px] border border-[#08111F] shrink-0"
                        style={{ backgroundColor: item.defaultColor }}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#F5F8FC] font-medium truncate">{item.name}</span>
                        <span className="text-[9px] text-[#A8B5CB] shrink-0">{item.manufacturer}</span>
                      </div>
                      <div className="text-[10px] text-[#94A3B8] truncate">{item.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {activeCategory === 'Filters' && item.defaultColor && (
                      <button
                        type="button"
                        disabled={!hasSelectedFixtures}
                        onClick={() => onApplyFilterColor(item.defaultColor!)}
                        title={hasSelectedFixtures ? 'Apply gel to selected fixtures' : 'Select a fixture first'}
                        className="px-2 py-0.5 bg-[#A08F52] hover:bg-[#B09E5A] disabled:opacity-40 text-[10px] text-[#F5F8FC] cursor-pointer"
                      >
                        Tint
                      </button>
                    )}
                    {activeCategory === 'Gobos' && item.goboName && (
                      <button
                        type="button"
                        disabled={!hasSelectedFixtures}
                        onClick={() => onApplyGoboPreset(item.goboName!)}
                        title={hasSelectedFixtures ? 'Apply gobo to selected fixtures' : 'Select a fixture first'}
                        className="px-2 py-0.5 bg-[#A08F52] hover:bg-[#B09E5A] disabled:opacity-40 text-[10px] text-[#F5F8FC] cursor-pointer"
                      >
                        Apply
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {filteredItems.length === 0 && filteredGdtf.length === 0 && filteredSkpLibrary.length === 0 && gdtfGoboSlots.length === 0 && (
                <div className="p-4 text-center text-[#A8B5CB] text-[11px]">
                  No matching assets in {activeCategory}. Adjust your search or right-hand filters.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Right Filter Sidebar (~180px wide, #1D2B43) */}
      <div className="w-[180px] shrink-0 bg-[#1B2940] border-l border-[#2A3A54] flex flex-col overflow-hidden">
        <div className="h-[28px] shrink-0 px-2.5 border-b border-[#2A3A54] flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#B2BECE]">
            {activeCategory} Filters
          </span>
          {activeFilterList.length > 0 && (
            <button
              type="button"
              onClick={() => setCheckedFilters({})}
              className="text-[10px] text-[#83D84C] hover:underline cursor-pointer"
            >
              Clear ({activeFilterList.length})
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto capture-scroll px-2 py-1.5 flex flex-col gap-[3px]">
          {filterOptions.map((tag) => {
            const checked = Boolean(checkedFilters[tag]);
            return (
              <label
                key={tag}
                className="flex items-center gap-2 px-1 py-[2px] rounded-[2px] hover:bg-[#2E3E59] cursor-pointer text-[11px] text-[#D7E0EE]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleFilter(tag)}
                  className="accent-[#A08F52] cursor-pointer"
                />
                <span className={checked ? 'text-[#F5F8FC] font-medium truncate' : 'truncate'}>
                  {tag}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
};
