import React, { useRef, useState } from 'react';
import { DmxUniversesMap, readDmxRawValue, writeDmxRawValue } from '../gdtf/dmxEngine';
import { GdtfProfile } from '../gdtf/types';
import { getSkpModel, SkpParsedModel } from '../skp/skpParser';
import { parseSmokePatch } from '../three/smokeSimulation';
import {
  CameraPreset,
  DesignCategory,
  FixtureGroup,
  GdtfLibraryEntry,
  LayerItem,
  LayerLineStyle,
  LibraryCatalogItem,
  LightingSnapshot,
  ObjectKind,
  ProjectMetadata,
  ProjectTab,
  SceneObject,
  SkpLibraryEntry,
  ViewportId,
  ViewportSettings,
} from '../types/visualizer';
import {
  CameraPositionsIcon,
  DrawingLogoPlaceholderIcon,
  FiltersFunnelIcon,
  FixtureGroupsIcon,
  LayersStackIcon,
  ProjectDocIcon,
  SelectedItemsIcon,
  ViewsEyeIcon,
} from './Icons';
import { LibraryBrowser } from './LibraryBrowser';
import { SelectedItemsInspector } from './SelectedItemsInspector';
import { ViewsInspectorTable } from './ViewsInspectorTable';

interface ProjectPanelProps {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  activeCategory: DesignCategory;
  onCategoryChange: (cat: DesignCategory) => void;
  metadata: ProjectMetadata;
  onUpdateMetadata: (patch: Partial<ProjectMetadata>) => void;
  objects: SceneObject[];
  selectedObjectIds: string[];
  onSelectObject: (id: string | null, mode?: 'replace' | 'toggle') => void;
  onUpdateObjects: (ids: string[], patch: Partial<SceneObject>) => void;
  onChangeGdtfMode: (objectId: string, modeName: string) => void;
  onDeleteObjects: (ids: string[]) => void;
  onDuplicateObjects: (ids: string[]) => void;
  gdtfProfiles: GdtfProfile[];
  gdtfLibraryEntries: GdtfLibraryEntry[];
  skpModels: SkpParsedModel[];
  skpLibraryEntries: SkpLibraryEntry[];
  dmxUniverses: DmxUniversesMap;
  dmxSweepActive: boolean;
  onToggleDmxSweep: () => void;
  onWriteDmxChannel: (universe: number, baseAddr: number, offsets: number[], raw: number) => void;
  recentCatalogIds: string[];
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
  viewports: Record<ViewportId, ViewportSettings>;
  onUpdateViewport: (id: ViewportId, patch: Partial<ViewportSettings>) => void;
  layers: LayerItem[];
  onUpdateLayer: (id: string, patch: Partial<LayerItem>) => void;
  onAddLayer: (name?: string) => void;
  onDeleteLayer: (id: string) => void;
  onApplyMaterial: (materialId: string) => void;
  fixtureGroups: FixtureGroup[];
  onUpdateGroupFixtures: (groupId: string, patch: Partial<SceneObject>) => void;
  snapshots: LightingSnapshot[];
  onRecallSnapshot: (id: string) => void;
  onCaptureSnapshot: (name: string) => void;
  cameraPresets: CameraPreset[];
  onRecallCameraPreset: (preset: CameraPreset, targetViewportId: ViewportId) => void;
}

const TOP_TABS: ProjectTab[] = ['Design', 'Fixtures', 'Universes', 'Media', 'Snapshots', 'Library'];

const DESIGN_CATEGORIES: Array<{
  key: DesignCategory;
  icon: React.FC<{ className?: string }>;
}> = [
  { key: 'Project', icon: ProjectDocIcon },
  { key: 'Selected Items', icon: SelectedItemsIcon },
  { key: 'Views', icon: ViewsEyeIcon },
  { key: 'Layers', icon: LayersStackIcon },
  { key: 'Filters', icon: FiltersFunnelIcon },
  { key: 'Fixture Groups', icon: FixtureGroupsIcon },
  { key: 'Camera Positions', icon: CameraPositionsIcon },
];

const PROJECT_TEXT_FIELDS: Array<{ key: keyof ProjectMetadata; label: string }> = [
  { key: 'project', label: 'Project' },
  { key: 'projectLocation', label: 'Project Location' },
  { key: 'projectDate', label: 'Project Date' },
  { key: 'lightingDesigner', label: 'Lighting Designer' },
  { key: 'setDesigner', label: 'Set Designer' },
  { key: 'director', label: 'Director' },
  { key: 'technicalDirector', label: 'Technical Director' },
  { key: 'masterElectrician', label: 'Master Electrician' },
  { key: 'client', label: 'Client' },
];

export const ProjectPanel: React.FC<ProjectPanelProps> = ({
  activeTab,
  onTabChange,
  activeCategory,
  onCategoryChange,
  metadata,
  onUpdateMetadata,
  objects,
  selectedObjectIds,
  onSelectObject,
  onUpdateObjects,
  onChangeGdtfMode,
  onDeleteObjects,
  onDuplicateObjects,
  gdtfProfiles,
  gdtfLibraryEntries,
  skpModels,
  skpLibraryEntries,
  dmxUniverses,
  dmxSweepActive,
  onToggleDmxSweep,
  onWriteDmxChannel,
  recentCatalogIds,
  onPlaceCatalogItem,
  onPlaceGdtfProfile,
  onPlaceSkpModel,
  onImportGdtfFile,
  onLoadSampleGdtf,
  onDeleteGdtfProfile,
  onImportSkpFile,
  onLoadSampleSkp,
  viewports,
  onUpdateViewport,
  layers,
  onUpdateLayer,
  onAddLayer,
  onDeleteLayer,
  onApplyMaterial,
  fixtureGroups,
  onUpdateGroupFixtures,
  snapshots,
  onRecallSnapshot,
  onCaptureSnapshot,
  cameraPresets,
  onRecallCameraPreset,
}) => {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [selectedUniverse, setSelectedUniverse] = useState<number>(1);
  const [newSnapName, setNewSnapName] = useState('');
  const [filterKind, setFilterKind] = useState<ObjectKind | 'all'>('all');
  const [cameraTargetVp, setCameraTargetVp] = useState<ViewportId>('alpha');

  const selectedSet = new Set(selectedObjectIds);
  const selectedObjects = objects.filter((o) => selectedSet.has(o.id));
  const primaryObj = selectedObjects[0] ?? null;
  const selectedFixtures = selectedObjects.filter(
    (o) => o.kind === 'moving-head' || o.kind === 'led-par' || o.kind === 'gdtf-fixture',
  );
  const anyFixtureSelected = selectedFixtures.length > 0;

  const primaryGdtfProfile =
    primaryObj?.kind === 'gdtf-fixture' && primaryObj.gdtfProfileId
      ? gdtfProfiles.find((p) => p.id === primaryObj.gdtfProfileId) ?? null
      : null;

  const primaryGdtfMode = primaryGdtfProfile
    ? primaryGdtfProfile.dmxModes.find((m) => m.name === primaryObj?.gdtfModeName) ??
      primaryGdtfProfile.dmxModes[0] ??
      null
    : null;

  const primarySkpModel =
    primaryObj?.kind === 'skp-model' && primaryObj.skpModelId
      ? getSkpModel(primaryObj.skpModelId) ?? null
      : null;

  const handleLogoFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdateMetadata({ drawingLogo: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const fixtures = objects.filter(
    (o) => o.kind === 'moving-head' || o.kind === 'led-par' || o.kind === 'gdtf-fixture',
  );
  const universeBuffer = dmxUniverses[selectedUniverse] ?? new Uint8Array(512);

  return (
    <div className="flex flex-col w-full h-full bg-[#262626] text-[#FFFFFF] text-[11px] select-none border-t border-[#141414]">
      {/* Top Centered Navigation Bar (6 tabs) */}
      <div className="h-[26px] shrink-0 bg-[#262626] border-b border-[#141414] flex items-center justify-center px-2">
        <div className="flex items-center border border-[#141414] rounded-[2px] overflow-hidden">
          {TOP_TABS.map((tab, idx) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                className={`h-[19px] px-[10px] text-[11px] leading-none text-[#FFFFFF] whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  idx > 0 ? 'border-l border-[#141414]' : ''
                } ${
                  isActive
                    ? 'bg-[#545454] shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]'
                    : 'bg-[#383838] hover:bg-[#444444]'
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {activeTab === 'Design' && (
          <>
            {/* Left Category Sidebar (145px wide, #1F1F1F) */}
            <div className="w-[145px] shrink-0 bg-[#1F1F1F] border-r border-[#141414] p-[4px] flex flex-col gap-[2px] overflow-y-auto capture-scroll">
              {DESIGN_CATEGORIES.map(({ key, icon: Icon }) => {
                const isActive = activeCategory === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onCategoryChange(key)}
                    className={`w-full h-[28px] px-[6px] flex items-center gap-[8px] text-left text-[11px] text-[#FFFFFF] whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-[#383838] border border-[#888888]'
                        : 'bg-transparent border border-transparent hover:bg-[#2B2B2B]'
                    }`}
                  >
                    <Icon className="w-[22px] h-[22px] shrink-0" />
                    <span className="truncate">{key}</span>
                  </button>
                );
              })}
            </div>

            {/* Right Properties Inspector (#262626) */}
            <div className="flex-1 min-w-0 bg-[#262626] overflow-y-auto capture-scroll px-[12px] py-[8px]">
              {/* Inspector Header */}
              <div className="mb-[8px] pb-[4px] border-b border-[#1A1A1A] flex items-center justify-between">
                <div>
                  <div className="text-[10px] leading-tight text-[#999999]">Properties</div>
                  <div className="text-[12px] leading-tight font-bold text-[#FFFFFF]">
                    {activeCategory}
                    {activeCategory === 'Selected Items' && selectedObjects.length > 1
                      ? ` (${selectedObjects.length} items)`
                      : ''}
                  </div>
                </div>
                {activeCategory === 'Selected Items' && selectedObjects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onSelectObject(null, 'replace')}
                    className="px-2 py-0.5 bg-[#383838] border border-[#141414] hover:bg-[#4A4A4A] text-[10px] text-[#CCCCCC] cursor-pointer"
                  >
                    Clear Selection
                  </button>
                )}
              </div>

              {/* Category: Project */}
              {activeCategory === 'Project' && (
                <div className="flex flex-col gap-[3px]">
                  {PROJECT_TEXT_FIELDS.map(({ key, label }) => (
                    <div key={key} className="grid grid-cols-[120px_1fr] items-center gap-[8px] min-h-[20px]">
                      <label className="text-[11px] text-[#FFFFFF] truncate">{label}</label>
                      <input
                        type="text"
                        value={(metadata[key] as string) ?? ''}
                        onChange={(e) => onUpdateMetadata({ [key]: e.target.value })}
                        className="h-[19px] px-[6px] bg-[#1E1E1E] border border-[#141414] text-[11px] text-[#FFFFFF] focus:outline-none focus:border-[#857431]"
                      />
                    </div>
                  ))}

                  {/* Drawing Logo */}
                  <div className="grid grid-cols-[120px_1fr] items-center gap-[8px] py-[2px]">
                    <label className="text-[11px] text-[#FFFFFF] truncate">Drawing Logo</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const f = e.dataTransfer.files[0];
                          if (f) handleLogoFile(f);
                        }}
                        title="Click or drop image for Drawing Logo"
                        className="w-[38px] h-[38px] bg-[#4A4A4A] border border-[#888888] flex items-center justify-center overflow-hidden hover:border-[#FFFFFF] transition-colors cursor-pointer"
                      >
                        {metadata.drawingLogo ? (
                          <img
                            src={metadata.drawingLogo}
                            alt="Drawing Logo"
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <DrawingLogoPlaceholderIcon className="w-[24px] h-[24px]" />
                        )}
                      </button>
                      {metadata.drawingLogo && (
                        <button
                          type="button"
                          onClick={() => onUpdateMetadata({ drawingLogo: null })}
                          className="text-[10px] text-[#999999] hover:text-[#FFFFFF] cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleLogoFile(f);
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[120px_1fr] items-center gap-[8px] min-h-[20px]">
                    <label className="text-[11px] text-[#FFFFFF] truncate">Drawing Author</label>
                    <input
                      type="text"
                      value={metadata.drawingAuthor}
                      onChange={(e) => onUpdateMetadata({ drawingAuthor: e.target.value })}
                      className="h-[19px] px-[6px] bg-[#1E1E1E] border border-[#141414] text-[11px] text-[#FFFFFF] focus:outline-none focus:border-[#857431]"
                    />
                  </div>
                  <div className="grid grid-cols-[120px_1fr] items-center gap-[8px] min-h-[20px]">
                    <label className="text-[11px] text-[#FFFFFF] truncate">Drawing Version</label>
                    <input
                      type="text"
                      value={metadata.drawingVersion}
                      onChange={(e) => onUpdateMetadata({ drawingVersion: e.target.value })}
                      className="h-[19px] px-[6px] bg-[#1E1E1E] border border-[#141414] text-[11px] text-[#FFFFFF] focus:outline-none focus:border-[#857431]"
                    />
                  </div>
                </div>
              )}

              {/* Category: Selected Items */}
              {activeCategory === 'Selected Items' && (
                <SelectedItemsInspector
                  objects={objects}
                  selectedObjectIds={selectedObjectIds}
                  layers={layers}
                  fixtureGroups={fixtureGroups}
                  gdtfProfiles={gdtfProfiles}
                  onSelectObject={onSelectObject}
                  onUpdateObjects={onUpdateObjects}
                  onDuplicateObjects={onDuplicateObjects}
                  onDeleteObjects={onDeleteObjects}
                />
              )}

              {/* Category: Views */}
              {activeCategory === 'Views' && (
                <ViewsInspectorTable
                  viewports={viewports}
                  layers={layers}
                  onUpdateViewport={onUpdateViewport}
                />
              )}

              {/* Category: Layers */}
              {activeCategory === 'Layers' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-2 py-1.5 bg-[#1F1F1F] border border-[#141414]">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-[#FFFFFF]">
                        Project Layers ({layers.length})
                      </span>
                      <span className="text-[10px] text-[#8E8E93]">
                        Plot styling, visibility &amp; lock control
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAddLayer()}
                      className="h-[20px] px-2 bg-[#3B6E1C] hover:bg-[#498524] border border-[#141414] text-[10px] font-medium text-[#FFFFFF] cursor-pointer"
                    >
                      + Add Layer
                    </button>
                  </div>

                  {layers.length === 0 ? (
                    <div className="p-3 bg-[#1E1E1E] border border-[#141414] text-[10px] text-[#999999] flex flex-col items-start gap-2">
                      <div>
                        No custom layers yet. Layer assignment is optional; objects without a layer render in default Plot ink (`#1F2937`). Create layers to color-code, style line weights, isolate, or lock groups of items.
                      </div>
                      <button
                        type="button"
                        onClick={() => onAddLayer()}
                        className="px-2.5 py-1 bg-[#383838] hover:bg-[#4A4A4A] border border-[#141414] text-[#FFFFFF] text-[10px] cursor-pointer"
                      >
                        + Create First Layer
                      </button>
                    </div>
                  ) : (
                    <div className="border border-[#141414] bg-[#1E1E1E] overflow-x-auto capture-scroll">
                      <table className="w-full min-w-[440px] border-collapse text-[10px]">
                        <thead>
                          <tr className="bg-[#2B2B2B] border-b border-[#141414] text-left text-[#999999]">
                            <th className="px-1.5 py-1 font-normal w-[28px]">Color</th>
                            <th className="px-1.5 py-1 font-normal">Layer Name</th>
                            <th className="px-1.5 py-1 font-normal w-[68px]">Weight</th>
                            <th className="px-1.5 py-1 font-normal w-[76px]">Line Style</th>
                            <th className="px-1.5 py-1 font-normal text-center w-[46px]">Vis</th>
                            <th className="px-1.5 py-1 font-normal text-center w-[58px]">Lock</th>
                            <th className="px-1.5 py-1 font-normal text-right w-[28px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {layers.map((layer) => {
                            const memberCount = objects.filter((o) => o.layerId === layer.id).length;
                            return (
                              <tr key={layer.id} className="border-b border-[#161616] hover:bg-[#242424]">
                                <td className="px-1.5 py-1">
                                  <input
                                    type="color"
                                    value={layer.color}
                                    title="Layer Screen / Plot Color"
                                    onChange={(e) =>
                                      onUpdateLayer(layer.id, { color: e.target.value })
                                    }
                                    className="w-[20px] h-[17px] bg-transparent border border-[#141414] p-0 cursor-pointer block"
                                  />
                                </td>
                                <td className="px-1.5 py-1">
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="text"
                                      value={layer.name}
                                      onChange={(e) =>
                                        onUpdateLayer(layer.id, { name: e.target.value })
                                      }
                                      className="flex-1 min-w-[70px] h-[19px] px-1.5 bg-[#262626] border border-[#141414] text-[11px] text-[#FFFFFF] focus:outline-none focus:border-[#857431]"
                                    />
                                    <span
                                      className="text-[9px] text-[#8E8E93] tabular-nums shrink-0"
                                      title={`${memberCount} object(s) on this layer`}
                                    >
                                      ({memberCount})
                                    </span>
                                  </div>
                                </td>
                                <td className="px-1.5 py-1">
                                  <select
                                    value={layer.lineWeightPt ?? 0.75}
                                    onChange={(e) =>
                                      onUpdateLayer(layer.id, {
                                        lineWeightPt: Number(e.target.value) || 0.75,
                                      })
                                    }
                                    className="w-full h-[19px] px-1 bg-[#262626] border border-[#141414] text-[10px] text-[#FFFFFF] tabular-nums"
                                  >
                                    {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((w) => (
                                      <option key={w} value={w}>
                                        {w.toFixed(2).replace(/\.00$/, '.0')}pt
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-1.5 py-1">
                                  <select
                                    value={layer.lineStyle ?? 'Solid'}
                                    onChange={(e) =>
                                      onUpdateLayer(layer.id, {
                                        lineStyle: e.target.value as LayerLineStyle,
                                      })
                                    }
                                    className="w-full h-[19px] px-1 bg-[#262626] border border-[#141414] text-[10px] text-[#FFFFFF]"
                                  >
                                    <option value="Solid">Solid</option>
                                    <option value="Dashed">Dashed</option>
                                    <option value="Dotted">Dotted</option>
                                  </select>
                                </td>
                                <td className="px-1.5 py-1 text-center">
                                  <input
                                    type="checkbox"
                                    checked={layer.visible}
                                    title={layer.visible ? 'Layer Visible' : 'Layer Hidden'}
                                    onChange={(e) =>
                                      onUpdateLayer(layer.id, { visible: e.target.checked })
                                    }
                                    className="cursor-pointer accent-[#6BC938]"
                                  />
                                </td>
                                <td className="px-1.5 py-1 text-center">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onUpdateLayer(layer.id, { locked: !layer.locked })
                                    }
                                    className={`w-full h-[18px] px-1 border border-[#141414] text-[9px] cursor-pointer ${
                                      layer.locked
                                        ? 'bg-[#6A2824] text-[#FBBF24]'
                                        : 'bg-[#262626] text-[#CCCCCC] hover:bg-[#333333]'
                                    }`}
                                  >
                                    {layer.locked ? 'Locked' : 'Normal'}
                                  </button>
                                </td>
                                <td className="px-1.5 py-1 text-right">
                                  <button
                                    type="button"
                                    title="Delete layer (objects become unassigned)"
                                    onClick={() => onDeleteLayer(layer.id)}
                                    className="w-[18px] h-[18px] bg-[#2B1B1B] hover:bg-[#5E2320] border border-[#141414] text-[#FF8A80] text-[11px] leading-none cursor-pointer"
                                  >
                                    -
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Category: Filters */}
              {activeCategory === 'Filters' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {(
                      [
                        { id: 'all', label: 'All' },
                        { id: 'moving-head', label: 'Moving Heads' },
                        { id: 'led-par', label: 'LED Pars' },
                        { id: 'gdtf-fixture', label: 'GDTF' },
                        { id: 'truss', label: 'Trusses' },
                        { id: 'stage-deck', label: 'Staging' },
                        { id: 'smoke-volume', label: 'Smoke / Haze' },
                        { id: 'skp-model', label: '3D Models' },
                      ] as Array<{ id: ObjectKind | 'all'; label: string }>
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilterKind(f.id)}
                        className={`px-2 py-0.5 text-[10px] border border-[#141414] cursor-pointer ${
                          filterKind === f.id ? 'bg-[#857431] text-[#FFFFFF]' : 'bg-[#383838] text-[#CCCCCC]'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    {objects
                      .filter((o) => filterKind === 'all' || o.kind === filterKind)
                      .map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={(e) =>
                            onSelectObject(o.id, e.metaKey || e.ctrlKey ? 'toggle' : 'replace')
                          }
                          className={`flex items-center justify-between px-2 py-1 text-left border border-[#141414] cursor-pointer ${
                            selectedSet.has(o.id)
                              ? 'bg-[#4B1E1B] text-[#FFFFFF]'
                              : 'bg-[#1E1E1E] text-[#CCCCCC] hover:bg-[#2E2E2E]'
                          }`}
                        >
                          <span className="truncate">{o.name}</span>
                          <span className="text-[10px] text-[#8E8E93] tabular-nums">
                            {o.position.map((v) => v.toFixed(1)).join(', ')}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Category: Fixture Groups */}
              {activeCategory === 'Fixture Groups' && (
                <div className="flex flex-col gap-2">
                  {fixtureGroups.map((grp) => {
                    const members = objects.filter((o) => o.groupId === grp.id);
                    const avgIntensity =
                      members.length > 0
                        ? members.reduce((acc, m) => acc + (m.intensity ?? 0), 0) / members.length
                        : 0;
                    const groupColor = members[0]?.color ?? grp.color;
                    return (
                      <div key={grp.id} className="p-2 bg-[#1E1E1E] border border-[#141414] flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-[#FFFFFF]">
                            {grp.name} ({members.length})
                          </span>
                          <input
                            type="color"
                            value={groupColor}
                            onChange={(e) => onUpdateGroupFixtures(grp.id, { color: e.target.value })}
                            className="w-[20px] h-[16px] bg-transparent border border-[#141414] cursor-pointer"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[#999999]">Dimmer</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.02}
                            value={avgIntensity}
                            onChange={(e) =>
                              onUpdateGroupFixtures(grp.id, { intensity: Number(e.target.value) })
                            }
                            className="flex-1 accent-[#857431]"
                          />
                          <span className="w-[30px] text-right text-[10px] tabular-nums">
                            {Math.round(avgIntensity * 100)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Category: Camera Positions */}
              {activeCategory === 'Camera Positions' && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[10px] text-[#CCCCCC]">
                    <span>Apply preset to viewport:</span>
                    <select
                      value={cameraTargetVp}
                      onChange={(e) => setCameraTargetVp(e.target.value as ViewportId)}
                      className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[#FFFFFF]"
                    >
                      <option value="alpha">Alpha View</option>
                      <option value="beta">Beta View</option>
                      <option value="gamma">Gamma View</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    {cameraPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onRecallCameraPreset(preset, cameraTargetVp)}
                        className="flex items-center justify-between px-2 py-1.5 bg-[#1E1E1E] border border-[#141414] hover:bg-[#333333] text-left cursor-pointer"
                      >
                        <span className="text-[#FFFFFF]">{preset.name}</span>
                        <span className="text-[10px] text-[#6BC938]">{preset.projection}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Tab: Fixtures — Capture-style fixture schedule columns */}
        {activeTab === 'Fixtures' && (
          <div className="flex-1 overflow-auto capture-scroll p-2">
            <table className="min-w-[1240px] w-full border-collapse text-[11px] tabular-nums">
              <thead>
                <tr className="text-left text-[#999999] border-b border-[#141414] bg-[#262626] sticky top-0 z-10">
                  {[
                    'Location',
                    'Unit',
                    'Channel',
                    'Groups',
                    'Name',
                    'Circuit',
                    'Patch',
                    'Mode',
                    'Optics',
                    'Filter',
                    'Weight',
                    'Purpose',
                    'Filters',
                    'Gobos',
                    'Focus',
                  ].map((label) => (
                    <th key={label} className="py-1 px-1.5 font-normal whitespace-nowrap">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fixtures.map((fx, idx) => {
                  const selected = selectedSet.has(fx.id);
                  const profile =
                    fx.kind === 'gdtf-fixture' && fx.gdtfProfileId
                      ? gdtfProfiles.find((p) => p.id === fx.gdtfProfileId) ?? null
                      : null;
                  const groupName = fx.groupId
                    ? fixtureGroups.find((g) => g.id === fx.groupId)?.name ?? '—'
                    : '—';
                  const cellClass = 'py-1 px-1.5 text-[#CCCCCC] whitespace-nowrap';
                  const inputClass =
                    'w-full min-w-[54px] bg-transparent border border-transparent hover:border-[#444] focus:border-[#857431] focus:bg-[#1A1A1A] outline-none text-[#FFFFFF] px-0.5';
                  return (
                    <tr
                      key={fx.id}
                      onClick={(e) =>
                        onSelectObject(fx.id, e.metaKey || e.ctrlKey ? 'toggle' : 'replace')
                      }
                      className={`border-b border-[#1C1C1C] cursor-pointer ${
                        selected ? 'bg-[#4B1E1B]' : 'hover:bg-[#2E2E2E]'
                      }`}
                    >
                      <td className={cellClass}>
                        <input
                          value={fx.location ?? ''}
                          placeholder="—"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onUpdateObjects([fx.id], { location: e.target.value })}
                          className={inputClass}
                        />
                      </td>
                      <td className={cellClass}>
                        <input
                          value={fx.unit ?? String(idx + 1)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onUpdateObjects([fx.id], { unit: e.target.value })}
                          className={`${inputClass} w-[36px] min-w-[36px]`}
                        />
                      </td>
                      <td className={cellClass}>{fx.channel ?? '—'}</td>
                      <td className={cellClass}>{groupName}</td>
                      <td className={`${cellClass} text-[#FFFFFF]`}>
                        <div className="flex items-center gap-1">
                          {fx.kind === 'gdtf-fixture' && (
                            <span className="px-1 bg-[#1B3311] border border-[#4D8C2A] text-[9px] text-[#6BC938] shrink-0">
                              GDTF
                            </span>
                          )}
                          <input
                            value={fx.name}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => onUpdateObjects([fx.id], { name: e.target.value })}
                            className={`${inputClass} min-w-[120px]`}
                          />
                        </div>
                      </td>
                      <td className={cellClass}>
                        <input
                          value={fx.circuit ?? ''}
                          placeholder="—"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onUpdateObjects([fx.id], { circuit: e.target.value })}
                          className={inputClass}
                        />
                      </td>
                      <td className={cellClass}>
                        {fx.dmxUniverse ?? 1}.{String(fx.dmxAddress ?? 1).padStart(3, '0')}
                      </td>
                      <td className={cellClass}>
                        {profile ? (
                          <select
                            value={
                              profile.dmxModes.find((m) => m.name === fx.gdtfModeName)?.name ??
                              profile.dmxModes[0]?.name ??
                              ''
                            }
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => onChangeGdtfMode(fx.id, e.target.value)}
                            className="max-w-[118px] bg-[#1E1E1E] border border-[#3A3A3A] text-[10px] text-[#FFFFFF] outline-none cursor-pointer"
                          >
                            {profile.dmxModes.map((m) => (
                              <option key={m.name} value={m.name}>
                                {m.name} ({m.footprint})
                              </option>
                            ))}
                          </select>
                        ) : (
                          (fx.subType ?? '—')
                        )}
                      </td>
                      <td className={cellClass}>
                        {fx.opticsSummary ??
                          (fx.beamAngle !== undefined ? `${fx.beamAngle}°` : '—')}
                      </td>
                      <td className={cellClass}>
                        <input
                          value={fx.filter ?? ''}
                          placeholder={fx.colourByFilter ? 'Colour' : '—'}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onUpdateObjects([fx.id], { filter: e.target.value })}
                          className={inputClass}
                        />
                      </td>
                      <td className={cellClass}>
                        <input
                          type="number"
                          value={fx.weightKg ?? ''}
                          placeholder="—"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            onUpdateObjects([fx.id], {
                              weightKg: e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                          className={`${inputClass} w-[52px] min-w-[52px]`}
                        />
                      </td>
                      <td className={cellClass}>
                        <input
                          value={fx.purpose ?? ''}
                          placeholder="—"
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => onUpdateObjects([fx.id], { purpose: e.target.value })}
                          className={inputClass}
                        />
                      </td>
                      <td className={cellClass}>{fx.colourByFilter ? 'Yes' : '—'}</td>
                      <td className={cellClass}>{fx.gobo ?? fx.staticGobo ?? '—'}</td>
                      <td className={cellClass}>
                        {fx.focusLabel ?? (fx.simulateFocus ? 'Simulated' : '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab: Universes (Live 512-byte DMX Matrix & GDTF Channel Faders) */}
        {activeTab === 'Universes' && (
          <div className="flex-1 overflow-auto capture-scroll p-2.5 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4].map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setSelectedUniverse(u)}
                    className={`px-2 py-0.5 text-[11px] border border-[#141414] cursor-pointer ${
                      selectedUniverse === u ? 'bg-[#545454] text-[#FFFFFF]' : 'bg-[#383838] text-[#CCCCCC]'
                    }`}
                  >
                    Univ {String.fromCharCode(64 + u)} ({u})
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleDmxSweep}
                  className={`px-2 py-0.5 text-[10px] border cursor-pointer ${
                    dmxSweepActive
                      ? 'bg-[#3B6E1C] border-[#569A2D] text-[#FFFFFF]'
                      : 'bg-[#383838] border-[#141414] text-[#CCCCCC] hover:bg-[#4A4A4A]'
                  }`}
                >
                  {dmxSweepActive ? '■ Stop Live DMX Sweep' : '▶ Run Live DMX Sweep'}
                </button>
                <span className="text-[10px] text-[#999999] tabular-nums">512 DMX Ch</span>
              </div>
            </div>

            <div className="grid grid-cols-16 gap-[2px]">
              {Array.from({ length: 160 }, (_, idx) => {
                const ch = idx + 1;
                const val = universeBuffer[ch - 1] ?? 0;
                const patchedFx = fixtures.find(
                  (f) =>
                    (f.dmxUniverse ?? 1) === selectedUniverse &&
                    ch >= (f.dmxAddress ?? 1) &&
                    ch < (f.dmxAddress ?? 1) + (f.dmxFootprint ?? 8),
                );
                const patchedSmoke = !patchedFx
                  ? objects.find((o) => {
                      if (o.kind !== 'smoke-volume') return false;
                      const p = parseSmokePatch(o.smokePatch);
                      return p.isPatched && p.universe === selectedUniverse && ch >= p.address && ch <= p.address + 1;
                    })
                  : undefined;
                const patched = patchedFx ?? patchedSmoke;
                const isSelected = patched && selectedSet.has(patched.id);
                return (
                  <button
                    key={ch}
                    type="button"
                    title={
                      patched
                        ? `DMX ${ch} (${val}/255): ${patched.name}`
                        : `DMX ${ch} (${val}/255): Unpatched`
                    }
                    onClick={(e) =>
                      patched &&
                      onSelectObject(patched.id, e.metaKey || e.ctrlKey ? 'toggle' : 'replace')
                    }
                    className={`h-[18px] text-[9px] tabular-nums flex items-center justify-center border ${
                      isSelected
                        ? 'border-[#FF9500] text-[#FFFFFF]'
                        : patched
                          ? 'border-[#141414] text-[#FFFFFF]'
                          : 'border-[#1A1A1A] bg-[#1E1E1E] text-[#666666]'
                    } ${patched ? 'cursor-pointer' : 'cursor-default'}`}
                    style={
                      patched
                        ? {
                            backgroundColor: isSelected
                              ? '#7D231E'
                              : patchedSmoke
                                ? '#234659'
                                : '#3A4A2D',
                          }
                        : undefined
                    }
                  >
                    {val > 0 ? val : ch}
                  </button>
                );
              })}
            </div>

            {/* Live DMX Faders for Patched Smoke Volume */}
            {primaryObj?.kind === 'smoke-volume' && parseSmokePatch(primaryObj.smokePatch).isPatched && (
              <div className="mt-1 p-2 bg-[#1F1F1F] border border-[#141414] flex flex-col gap-1.5">
                {(() => {
                  const p = parseSmokePatch(primaryObj.smokePatch);
                  const uBuf = dmxUniverses[p.universe] ?? new Uint8Array(512);
                  const rawDensity = uBuf[p.address - 1] ?? 0;
                  const rawSpeed = uBuf[p.address] ?? 0;
                  return (
                    <>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[#9EC5D6] font-semibold">
                          Live DMX Smoke Binding — {primaryObj.name}
                        </span>
                        <span className="text-[#8E8E93] tabular-nums">
                          Patch {p.universe}.{String(p.address).padStart(3, '0')}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-[10px]">
                        <label className="flex items-center gap-2">
                          <span className="w-[78px] text-[#CCCCCC]">1. Density</span>
                          <input
                            type="range"
                            min={0}
                            max={255}
                            value={rawDensity}
                            onChange={(e) =>
                              onWriteDmxChannel(p.universe, p.address, [1], Number(e.target.value))
                            }
                            className="flex-1 accent-[#6FA8DC]"
                          />
                          <span className="w-[38px] text-right text-[#8E8E93] tabular-nums">
                            {((rawDensity / 255) * 15).toFixed(1)}%
                          </span>
                        </label>
                        <label className="flex items-center gap-2">
                          <span className="w-[78px] text-[#CCCCCC]">2. Speed</span>
                          <input
                            type="range"
                            min={0}
                            max={255}
                            value={rawSpeed}
                            onChange={(e) =>
                              onWriteDmxChannel(p.universe, p.address, [2], Number(e.target.value))
                            }
                            className="flex-1 accent-[#6FA8DC]"
                          />
                          <span className="w-[38px] text-right text-[#8E8E93] tabular-nums">
                            {Math.round((rawSpeed / 255) * 150)}%
                          </span>
                        </label>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* Live GDTF DMX Channel Faders for Selected GDTF Fixture */}
            {primaryGdtfMode && primaryObj && (
              <div className="mt-1 p-2 bg-[#1F1F1F] border border-[#141414] flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-[#6BC938] font-semibold">
                    Live DMX Binding — {primaryObj.name} ({primaryGdtfMode.name})
                  </span>
                  <span className="text-[#8E8E93] tabular-nums">
                    Patch {primaryObj.dmxUniverse ?? 1}.{String(primaryObj.dmxAddress ?? 1).padStart(3, '0')}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {primaryGdtfMode.dmxChannels.map((ch, idx) => {
                    const attr = ch.logicalChannels[0]?.attribute || `Ch ${ch.offset.join(',')}`;
                    const maxRaw = Math.pow(256, ch.offset.length) - 1;
                    const uBuf = dmxUniverses[primaryObj.dmxUniverse ?? 1] ?? new Uint8Array(512);
                    const raw = readDmxRawValue(uBuf, primaryObj.dmxAddress ?? 1, ch.offset);
                    return (
                      <label key={`${attr}-${idx}`} className="flex items-center gap-2 text-[10px]">
                        <span className="w-[82px] text-[#CCCCCC] truncate" title={attr}>
                          {ch.offset[0]}. {attr}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={maxRaw}
                          step={ch.offset.length > 1 ? 64 : 1}
                          value={raw}
                          onChange={(e) =>
                            onWriteDmxChannel(
                              primaryObj.dmxUniverse ?? 1,
                              primaryObj.dmxAddress ?? 1,
                              ch.offset,
                              Number(e.target.value),
                            )
                          }
                          className="flex-1 accent-[#6BC938]"
                        />
                        <span className="w-[38px] text-right text-[#8E8E93] tabular-nums">
                          {Math.round((raw / maxRaw) * 100)}%
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab: Media */}
        {activeTab === 'Media' && (
          <div className="flex-1 overflow-auto capture-scroll p-3 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-[#1A1A1A] pb-2">
              <div>
                <div className="text-[12px] font-semibold">Project Drawing Logo & Gobos</div>
                <div className="text-[10px] text-[#999999]">
                  Assign custom plot branding or optical gobo wheel presets
                </div>
              </div>
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="px-2.5 py-1 bg-[#383838] border border-[#141414] hover:bg-[#4A4A4A] cursor-pointer"
              >
                Upload Logo
              </button>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {['Open', 'Radial Breakup', 'Starburst', 'Linear Bars', 'Ring Dots'].map((gobo) => (
                <button
                  key={gobo}
                  type="button"
                  onClick={() =>
                    anyFixtureSelected &&
                    onUpdateObjects(
                      selectedFixtures.map((f) => f.id),
                      { gobo },
                    )
                  }
                  className={`p-2 bg-[#1E1E1E] border text-center cursor-pointer ${
                    primaryObj?.gobo === gobo ? 'border-[#857431]' : 'border-[#141414] hover:border-[#555]'
                  }`}
                >
                  <div className="w-8 h-8 mx-auto mb-1 rounded-full border border-[#666] bg-[#111] flex items-center justify-center text-[10px] text-[#CCCCCC]">
                    ◎
                  </div>
                  <div className="text-[10px] truncate">{gobo}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Snapshots */}
        {activeTab === 'Snapshots' && (
          <div className="flex-1 overflow-auto capture-scroll p-2.5 flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="New snapshot name..."
                value={newSnapName}
                onChange={(e) => setNewSnapName(e.target.value)}
                className="flex-1 h-[22px] px-2 bg-[#1E1E1E] border border-[#141414] text-[11px] focus:outline-none focus:border-[#857431]"
              />
              <button
                type="button"
                onClick={() => {
                  onCaptureSnapshot(newSnapName.trim() || `Look ${snapshots.length + 1}`);
                  setNewSnapName('');
                }}
                className="h-[22px] px-2.5 bg-[#857431] hover:bg-[#998639] text-[#FFFFFF] text-[11px] cursor-pointer"
              >
                Store Snapshot
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {snapshots.map((snap) => (
                <div
                  key={snap.id}
                  className="flex items-center justify-between px-2.5 py-1.5 bg-[#1E1E1E] border border-[#141414]"
                >
                  <div>
                    <div className="text-[#FFFFFF] font-medium">{snap.name}</div>
                    <div className="text-[10px] text-[#8E8E93]">{snap.description}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRecallSnapshot(snap.id)}
                    className="px-2.5 py-1 bg-[#383838] border border-[#141414] hover:bg-[#545454] text-[11px] cursor-pointer"
                  >
                    Recall
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Library (3-Tier Capture Asset Browser UI) */}
        {activeTab === 'Library' && (
          <LibraryBrowser
            gdtfProfiles={gdtfProfiles}
            gdtfLibraryEntries={gdtfLibraryEntries}
            skpModels={skpModels}
            skpLibraryEntries={skpLibraryEntries}
            recentCatalogIds={recentCatalogIds}
            hasSelectedFixtures={anyFixtureSelected}
            hasSelectedMaterialTargets={selectedObjects.some((o) => o.kind !== 'smoke-volume')}
            onPlaceCatalogItem={onPlaceCatalogItem}
            onPlaceGdtfProfile={onPlaceGdtfProfile}
            onPlaceSkpModel={onPlaceSkpModel}
            onImportGdtfFile={onImportGdtfFile}
            onLoadSampleGdtf={onLoadSampleGdtf}
            onDeleteGdtfProfile={onDeleteGdtfProfile}
            onImportSkpFile={onImportSkpFile}
            onLoadSampleSkp={onLoadSampleSkp}
            onApplyMaterial={onApplyMaterial}
            onApplyFilterColor={(hex) =>
              onUpdateObjects(
                selectedFixtures.map((f) => f.id),
                { color: hex },
              )
            }
            onApplyGoboPreset={(goboName, goboMediaFile) =>
              onUpdateObjects(
                selectedFixtures.map((f) => f.id),
                { gobo: goboName, goboMediaFile },
              )
            }
          />
        )}
      </div>
    </div>
  );
};
