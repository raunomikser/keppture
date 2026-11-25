import React, { useState } from 'react';
import { GdtfProfile } from '../gdtf/types';
import { getSkpModel } from '../skp/skpParser';
import {
  CAPTURE_MATERIAL_CATEGORIES,
  CAPTURE_MATERIALS,
  findCaptureMaterial,
  getMaterialPreviewUrl,
} from '../three/materialsLibrary';
import { computeAutoSmokeBounds, parseSmokePatch } from '../three/smokeSimulation';
import { FixtureGroup, LayerItem, SceneObject } from '../types/visualizer';

interface SelectedItemsInspectorProps {
  objects: SceneObject[];
  selectedObjectIds: string[];
  layers: LayerItem[];
  fixtureGroups: FixtureGroup[];
  gdtfProfiles: GdtfProfile[];
  onSelectObject: (id: string | null, mode?: 'replace' | 'toggle') => void;
  onUpdateObjects: (ids: string[], patch: Partial<SceneObject>) => void;
  onDuplicateObjects: (ids: string[]) => void;
  onDeleteObjects: (ids: string[]) => void;
}

const COLOR_WHEEL_SLOTS = [
  { name: 'Open White', hex: '#FFFFFF' },
  { name: 'CTO 3200K', hex: '#FFE4B5' },
  { name: 'CTB 8000K', hex: '#BAE6FD' },
  { name: 'Deep Red', hex: '#EF4444' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Cyan', hex: '#4CC9F0' },
  { name: 'Magenta', hex: '#F72585' },
  { name: 'Congo Blue', hex: '#4338CA' },
  { name: 'UV Violet', hex: '#7209B7' },
];

const GOBO_SLOTS = [
  { name: 'Open', glyph: '○' },
  { name: 'Radial Breakup', glyph: '✳' },
  { name: 'Starburst', glyph: '✸' },
  { name: 'Linear Bars', glyph: '▥' },
  { name: 'Ring Dots', glyph: '◎' },
];

const SectionHeader: React.FC<{
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}> = ({ title, collapsed, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    className="w-full flex items-center justify-between px-1.5 py-[3px] bg-[#1F1F1F] border border-[#141414] text-[10px] font-semibold uppercase tracking-wide text-[#CCCCCC] hover:text-[#FFFFFF] cursor-pointer"
  >
    <span>{title}</span>
    <span>{collapsed ? '▸' : '▾'}</span>
  </button>
);

const PropRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[125px_1fr] items-center gap-[8px] min-h-[20px]">
    <span className="text-[11px] text-[#CCCCCC] truncate">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

const YesNoToggle: React.FC<{ value: boolean; onChange: (val: boolean) => void }> = ({
  value,
  onChange,
}) => (
  <button
    type="button"
    onClick={() => onChange(!value)}
    className={`h-[19px] px-2 border border-[#141414] text-[10px] cursor-pointer ${
      value ? 'bg-[#3B6E1C] text-[#FFFFFF]' : 'bg-[#1E1E1E] text-[#999999]'
    }`}
  >
    {value ? 'Yes' : 'No'}
  </button>
);

export const SelectedItemsInspector: React.FC<SelectedItemsInspectorProps> = ({
  objects,
  selectedObjectIds,
  layers,
  fixtureGroups,
  gdtfProfiles,
  onSelectObject,
  onUpdateObjects,
  onDuplicateObjects,
  onDeleteObjects,
}) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const selectedSet = new Set(selectedObjectIds);
  const selectedObjects = objects.filter((o) => selectedSet.has(o.id));
  const primaryObj = selectedObjects[0] ?? null;

  if (selectedObjects.length === 0 || !primaryObj) {
    return (
      <div className="py-4 text-[#999999] text-[11px]">
        No object selected. Click any fixture, truss, stage deck, or imported model in Alpha, Beta, or Gamma View. Hold{' '}
        <span className="text-[#CCCCCC]">Cmd/Ctrl + Click</span> to add or remove items from multi-selection.
      </div>
    );
  }

  const isFixture =
    primaryObj.kind === 'moving-head' ||
    primaryObj.kind === 'led-par' ||
    primaryObj.kind === 'gdtf-fixture';
  const isTruss = primaryObj.kind === 'truss';
  const isStageDeck = primaryObj.kind === 'stage-deck';
  const isSkp = primaryObj.kind === 'skp-model';
  const isSmoke = primaryObj.kind === 'smoke-volume';
  const hasLockedSelected = selectedObjects.some((o) =>
    Boolean(o.layerId && layers.find((l) => l.id === o.layerId)?.locked),
  );
  const targetIds = selectedObjectIds;
  const fixtureIds = selectedObjects
    .filter((o) => o.kind === 'moving-head' || o.kind === 'led-par' || o.kind === 'gdtf-fixture')
    .map((o) => o.id);
  const allSmokeIds = objects.filter((o) => o.kind === 'smoke-volume').map((o) => o.id);
  const selectedSmokeIds = selectedObjects.filter((o) => o.kind === 'smoke-volume').map((o) => o.id);
  const parsedSmokePatch = parseSmokePatch(primaryObj.smokePatch);

  const gdtfProfile =
    primaryObj.kind === 'gdtf-fixture' && primaryObj.gdtfProfileId
      ? gdtfProfiles.find((p) => p.id === primaryObj.gdtfProfileId) ?? null
      : null;

  const skpModel =
    isSkp && primaryObj.skpModelId ? getSkpModel(primaryObj.skpModelId) ?? null : null;

  return (
    <div className="flex flex-col gap-[6px]">
      {/* Multi-selection chip bar */}
      {selectedObjects.length > 1 && (
        <div className="flex flex-wrap gap-1 p-1.5 bg-[#1F1F1F] border border-[#141414]">
          {selectedObjects.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#383838] border border-[#FF9500]/70 text-[10px] text-[#FFFFFF]"
            >
              <span className="truncate max-w-[120px]">{item.name}</span>
              <button
                type="button"
                title="Remove from selection"
                onClick={() => onSelectObject(item.id, 'toggle')}
                className="text-[#FF8A80] hover:text-[#FFFFFF] cursor-pointer"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {hasLockedSelected && (
        <div className="px-1.5 py-1 bg-[#332611] border border-[#855A18] text-[10px] text-[#FBBF24]">
          Layer Locked — Selected object properties are read-only until unlocked.
        </div>
      )}

      {/* GENERAL SECTION */}
      <SectionHeader
        title="General"
        collapsed={Boolean(collapsed.general)}
        onToggle={() => toggleSection('general')}
      />
      {!collapsed.general && (
        <div className="flex flex-col gap-[3px] px-1">
          <PropRow label="Layer">
            <select
              value={primaryObj.layerId ?? ''}
              onChange={(e) =>
                onUpdateObjects(targetIds, { layerId: e.target.value || undefined })
              }
              className="w-full h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px] text-[#FFFFFF]"
            >
              <option value="">(None / Unassigned)</option>
              {layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.locked ? ' (Locked)' : ''}
                </option>
              ))}
            </select>
          </PropRow>

          {!isSmoke && (
            <PropRow label="Material">
              <div className="flex items-center gap-1.5">
                {(() => {
                  const activeMat = findCaptureMaterial(primaryObj.materialPreset);
                  return activeMat ? (
                    <img
                      src={getMaterialPreviewUrl(activeMat)}
                      alt={activeMat.name}
                      className="w-[17px] h-[17px] border border-[#141414] shrink-0 object-cover"
                    />
                  ) : (
                    <span className="w-[17px] h-[17px] bg-[#2D3139] border border-[#141414] shrink-0" />
                  );
                })()}
                <select
                  value={
                    findCaptureMaterial(primaryObj.materialPreset)?.id ??
                    primaryObj.materialPreset ??
                    ''
                  }
                  onChange={(e) =>
                    onUpdateObjects(targetIds, {
                      materialPreset: e.target.value || undefined,
                    })
                  }
                  className="flex-1 min-w-0 h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px] text-[#FFFFFF]"
                >
                  <option value="">(Default Surface)</option>
                  {CAPTURE_MATERIAL_CATEGORIES.map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {CAPTURE_MATERIALS.filter((m) => m.category === cat).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </PropRow>
          )}

          {isFixture && (
            <>
              <PropRow label="Motion Fixture">
                <span className="text-[11px] text-[#6BC938]">
                  {primaryObj.kind === 'moving-head' || primaryObj.kind === 'gdtf-fixture'
                    ? 'Yes (Motorized Pan/Tilt)'
                    : 'No (Static Yoke)'}
                </span>
              </PropRow>
              <PropRow label="Include in Scenes">
                <YesNoToggle
                  value={primaryObj.includeInScenes ?? true}
                  onChange={(v) => onUpdateObjects(targetIds, { includeInScenes: v })}
                />
              </PropRow>
            </>
          )}

          <PropRow label="Hidden">
            <YesNoToggle
              value={Boolean(primaryObj.hidden)}
              onChange={(v) => onUpdateObjects(targetIds, { hidden: v })}
            />
          </PropRow>

          <PropRow label="Casts Shadows">
            <YesNoToggle
              value={primaryObj.castsShadows ?? true}
              onChange={(v) => onUpdateObjects(targetIds, { castsShadows: v })}
            />
          </PropRow>
        </div>
      )}

      {/* GEOMETRY SECTION */}
      <SectionHeader
        title="Geometry"
        collapsed={Boolean(collapsed.geometry)}
        onToggle={() => toggleSection('geometry')}
      />
      {!collapsed.geometry && (
        <div className="flex flex-col gap-[3px] px-1">
          {selectedObjects.length === 1 && (
            <>
              <PropRow label="Location (X, Y, Z m)">
                <div className="grid grid-cols-3 gap-[4px] tabular-nums">
                  {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                    <label
                      key={axis}
                      className="flex items-center gap-1 bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px]"
                    >
                      <span className="text-[#8E8E93] text-[10px]">{axis}</span>
                      <input
                        type="number"
                        step={0.05}
                        value={primaryObj.position[idx]}
                        onChange={(e) => {
                          const next: [number, number, number] = [...primaryObj.position];
                          next[idx] = Number(e.target.value) || 0;
                          onUpdateObjects([primaryObj.id], { position: next });
                        }}
                        className="w-full bg-transparent text-[11px] text-[#FFFFFF] focus:outline-none tabular-nums"
                      />
                    </label>
                  ))}
                </div>
              </PropRow>

              <PropRow label="Rotation (X, Y, Z °)">
                <div className="grid grid-cols-3 gap-[4px] tabular-nums">
                  {(['Rx', 'Ry', 'Rz'] as const).map((axis, idx) => (
                    <label
                      key={axis}
                      className="flex items-center gap-1 bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px]"
                    >
                      <span className="text-[#8E8E93] text-[10px]">{axis}</span>
                      <input
                        type="number"
                        step={5}
                        value={Number(((primaryObj.rotation[idx] * 180) / Math.PI).toFixed(1))}
                        onChange={(e) => {
                          const next: [number, number, number] = [...primaryObj.rotation];
                          next[idx] = ((Number(e.target.value) || 0) * Math.PI) / 180;
                          onUpdateObjects([primaryObj.id], { rotation: next });
                        }}
                        className="w-full bg-transparent text-[11px] text-[#FFFFFF] focus:outline-none tabular-nums"
                      />
                    </label>
                  ))}
                </div>
              </PropRow>

              {isStageDeck && (
                <PropRow label="Dimensions (L × W m)">
                  <div className="grid grid-cols-2 gap-[4px] tabular-nums">
                    <label className="flex items-center gap-1 bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px]">
                      <span className="text-[#8E8E93] text-[10px]">L</span>
                      <input
                        type="number"
                        step={0.5}
                        min={0.25}
                        value={primaryObj.length ?? 2.0}
                        onChange={(e) =>
                          onUpdateObjects(targetIds, {
                            length: Math.max(0.25, Number(e.target.value) || 2.0),
                          })
                        }
                        className="w-full bg-transparent text-[11px] text-[#FFFFFF] focus:outline-none tabular-nums"
                      />
                    </label>
                    <label className="flex items-center gap-1 bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px]">
                      <span className="text-[#8E8E93] text-[10px]">W</span>
                      <input
                        type="number"
                        step={0.5}
                        min={0.25}
                        value={primaryObj.width ?? 2.0}
                        onChange={(e) =>
                          onUpdateObjects(targetIds, {
                            width: Math.max(0.25, Number(e.target.value) || 2.0),
                          })
                        }
                        className="w-full bg-transparent text-[11px] text-[#FFFFFF] focus:outline-none tabular-nums"
                      />
                    </label>
                  </div>
                </PropRow>
              )}

              {(isSkp || isStageDeck || isTruss) && (
                <PropRow label="Scale (X, Y, Z)">
                  <div className="grid grid-cols-3 gap-[4px] tabular-nums">
                    {(['Sx', 'Sy', 'Sz'] as const).map((axis, idx) => (
                      <label
                        key={axis}
                        className="flex items-center gap-1 bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px]"
                      >
                        <span className="text-[#8E8E93] text-[10px]">{axis}</span>
                        <input
                          type="number"
                          step={0.1}
                          min={0.05}
                          value={(primaryObj.scale ?? [1, 1, 1])[idx]}
                          onChange={(e) => {
                            const next: [number, number, number] = [...(primaryObj.scale ?? [1, 1, 1])];
                            next[idx] = Math.max(0.05, Number(e.target.value) || 1);
                            onUpdateObjects([primaryObj.id], { scale: next });
                          }}
                          className="w-full bg-transparent text-[11px] text-[#FFFFFF] focus:outline-none tabular-nums"
                        />
                      </label>
                    ))}
                  </div>
                </PropRow>
              )}
            </>
          )}
          {selectedObjects.length > 1 && (
            <div className="text-[10px] text-[#8E8E93]">
              Drag any selected object in a CAD viewport to translate all {selectedObjects.length} items together.
            </div>
          )}
        </div>
      )}

      {/* SKP MODEL SUMMARY */}
      {isSkp && skpModel && (
        <div className="p-1.5 bg-[#1E1E1E] border border-[#141414] text-[10px] text-[#CCCCCC]">
          <div className="font-semibold text-[#FFFFFF]">SketchUp Component Graph: {skpModel.fileName}</div>
          <div className="text-[#8E8E93]">
            {skpModel.sketchUpVersion} · {skpModel.componentCount} nodes · {skpModel.vertexCount} verts ·{' '}
            {skpModel.faceCount} faces
          </div>
        </div>
      )}

      {/* === LIGHTING FIXTURE SECTIONS === */}
      {isFixture && (
        <>
          <SectionHeader
            title="Fixture Metadata"
            collapsed={Boolean(collapsed.fxMeta)}
            onToggle={() => toggleSection('fxMeta')}
          />
          {!collapsed.fxMeta && (
            <div className="flex flex-col gap-[3px] px-1">
              <PropRow label="Make / Name">
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="text"
                    value={
                      primaryObj.make ??
                      gdtfProfile?.metadata.manufacturer ??
                      (primaryObj.kind === 'moving-head' ? 'Robe' : 'ETC')
                    }
                    onChange={(e) => onUpdateObjects(targetIds, { make: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="text"
                    value={primaryObj.name}
                    onChange={(e) => onUpdateObjects([primaryObj.id], { name: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Version / Weight (kg)">
                <div className="grid grid-cols-2 gap-1 tabular-nums">
                  <input
                    type="text"
                    value={primaryObj.version ?? '2.1.4'}
                    onChange={(e) => onUpdateObjects(targetIds, { version: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="number"
                    step={0.5}
                    value={primaryObj.weightKg ?? (primaryObj.kind === 'led-par' ? 4.2 : 22)}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { weightKg: Number(e.target.value) || 0 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Channel / Groups">
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="number"
                    value={primaryObj.channel ?? 101}
                    onChange={(e) =>
                      onUpdateObjects([primaryObj.id], { channel: Number(e.target.value) || 1 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px] tabular-nums"
                  />
                  <select
                    value={primaryObj.groupId ?? ''}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { groupId: e.target.value || undefined })
                    }
                    className="h-[19px] px-1 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  >
                    <option value="">(None)</option>
                    {fixtureGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              </PropRow>

              <PropRow label="Circuit / Purpose">
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="text"
                    placeholder="Circuit"
                    value={primaryObj.circuit ?? 'Socapex A1'}
                    onChange={(e) => onUpdateObjects(targetIds, { circuit: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="text"
                    placeholder="Purpose"
                    value={primaryObj.purpose ?? 'Stage Spot / Wash'}
                    onChange={(e) => onUpdateObjects(targetIds, { purpose: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Console / External ID">
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="text"
                    value={primaryObj.consoleId ?? `FIX-${primaryObj.channel ?? 101}`}
                    onChange={(e) => onUpdateObjects(targetIds, { consoleId: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="text"
                    value={primaryObj.externalId ?? primaryObj.id}
                    onChange={(e) => onUpdateObjects(targetIds, { externalId: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Note">
                <input
                  type="text"
                  value={primaryObj.note ?? ''}
                  placeholder="Rigging or focus note..."
                  onChange={(e) => onUpdateObjects(targetIds, { note: e.target.value })}
                  className="w-full h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                />
              </PropRow>
            </div>
          )}

          {/* CONTROL SECTION */}
          <SectionHeader
            title="Control"
            collapsed={Boolean(collapsed.control)}
            onToggle={() => toggleSection('control')}
          />
          {!collapsed.control && (
            <div className="flex flex-col gap-[3px] px-1">
              <PropRow label="Mode">
                {gdtfProfile ? (
                  <select
                    value={primaryObj.gdtfModeName ?? gdtfProfile.dmxModes[0]?.name ?? ''}
                    onChange={(e) => {
                      const m = gdtfProfile.dmxModes.find((x) => x.name === e.target.value);
                      onUpdateObjects([primaryObj.id], {
                        gdtfModeName: e.target.value,
                        dmxFootprint: m?.footprint ?? primaryObj.dmxFootprint,
                      });
                    }}
                    className="w-full h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  >
                    {gdtfProfile.dmxModes.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} ({m.footprint} chs)
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={primaryObj.dmxFootprint ?? 24}
                    onChange={(e) =>
                      onUpdateObjects(fixtureIds, { dmxFootprint: Number(e.target.value) })
                    }
                    className="w-full h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  >
                    <option value={8}>1 (8 chs Compact)</option>
                    <option value={16}>2 (16 chs Standard)</option>
                    <option value={24}>3 (24 chs 16-bit Extended)</option>
                    <option value={34}>4 (34 chs Mode 2)</option>
                  </select>
                )}
              </PropRow>

              <PropRow label="Patch (Univ . Addr)">
                <div className="flex items-center gap-1 tabular-nums">
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={primaryObj.dmxUniverse ?? 1}
                    onChange={(e) =>
                      onUpdateObjects([primaryObj.id], {
                        dmxUniverse: Math.max(1, Math.min(4, Number(e.target.value) || 1)),
                      })
                    }
                    className="w-[46px] h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <span className="text-[#8E8E93]">.</span>
                  <input
                    type="number"
                    min={1}
                    max={512}
                    value={primaryObj.dmxAddress ?? 1}
                    onChange={(e) =>
                      onUpdateObjects([primaryObj.id], {
                        dmxAddress: Math.max(1, Math.min(512, Number(e.target.value) || 1)),
                      })
                    }
                    className="w-[56px] h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <span className="text-[10px] text-[#8E8E93]">
                    ({primaryObj.dmxFootprint ?? 8} ch)
                  </span>
                </div>
              </PropRow>

              <PropRow label="Intensity / Color">
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={primaryObj.intensity ?? 0.8}
                    onChange={(e) =>
                      onUpdateObjects(fixtureIds, { intensity: Number(e.target.value) })
                    }
                    className="flex-1 accent-[#857431]"
                  />
                  <span className="w-[32px] text-right tabular-nums text-[10px]">
                    {Math.round((primaryObj.intensity ?? 0.8) * 100)}%
                  </span>
                  <input
                    type="color"
                    value={primaryObj.color ?? '#ffffff'}
                    onChange={(e) => onUpdateObjects(fixtureIds, { color: e.target.value })}
                    className="w-[22px] h-[18px] bg-[#1E1E1E] border border-[#141414] p-0 cursor-pointer"
                  />
                </div>
              </PropRow>

              <PropRow label="Pan / Tilt / Beam">
                <div className="grid grid-cols-3 gap-[4px] tabular-nums">
                  <label className="flex items-center gap-1 bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px]">
                    <span className="text-[#8E8E93] text-[10px]">P</span>
                    <input
                      type="number"
                      step={5}
                      value={primaryObj.pan ?? 0}
                      onChange={(e) =>
                        onUpdateObjects(fixtureIds, { pan: Number(e.target.value) || 0 })
                      }
                      className="w-full bg-transparent text-[11px] focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1 bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px]">
                    <span className="text-[#8E8E93] text-[10px]">T</span>
                    <input
                      type="number"
                      step={5}
                      value={primaryObj.tilt ?? 25}
                      onChange={(e) =>
                        onUpdateObjects(fixtureIds, { tilt: Number(e.target.value) || 0 })
                      }
                      className="w-full bg-transparent text-[11px] focus:outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1 bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px]">
                    <span className="text-[#8E8E93] text-[10px]">∠</span>
                    <input
                      type="number"
                      min={3}
                      max={60}
                      value={primaryObj.beamAngle ?? 20}
                      onChange={(e) =>
                        onUpdateObjects(fixtureIds, {
                          beamAngle: Math.max(3, Math.min(60, Number(e.target.value) || 20)),
                        })
                      }
                      className="w-full bg-transparent text-[11px] focus:outline-none"
                    />
                  </label>
                </div>
              </PropRow>

              <PropRow label="Invert Pan / Invert Tilt">
                <div className="flex items-center gap-2">
                  <YesNoToggle
                    value={Boolean(primaryObj.invertPan)}
                    onChange={(v) => onUpdateObjects(fixtureIds, { invertPan: v })}
                  />
                  <YesNoToggle
                    value={Boolean(primaryObj.invertTilt)}
                    onChange={(v) => onUpdateObjects(fixtureIds, { invertTilt: v })}
                  />
                  <input
                    type="text"
                    value={primaryObj.correction ?? 'Linear'}
                    onChange={(e) => onUpdateObjects(fixtureIds, { correction: e.target.value })}
                    title="Dimmer / Motor Correction"
                    className="flex-1 h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Pan / Tilt Range (°)">
                <div className="grid grid-cols-2 gap-1 tabular-nums">
                  <input
                    type="number"
                    value={primaryObj.panRange ?? 540}
                    onChange={(e) =>
                      onUpdateObjects(fixtureIds, { panRange: Number(e.target.value) || 540 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="number"
                    value={primaryObj.tiltRange ?? 265}
                    onChange={(e) =>
                      onUpdateObjects(fixtureIds, { tiltRange: Number(e.target.value) || 265 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Limit Pan Start / End">
                <div className="grid grid-cols-2 gap-1 tabular-nums">
                  <input
                    type="number"
                    value={primaryObj.limitPanStart ?? -270}
                    onChange={(e) =>
                      onUpdateObjects(fixtureIds, { limitPanStart: Number(e.target.value) || -270 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="number"
                    value={primaryObj.limitPanEnd ?? 270}
                    onChange={(e) =>
                      onUpdateObjects(fixtureIds, { limitPanEnd: Number(e.target.value) || 270 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Simulate Focus">
                <YesNoToggle
                  value={primaryObj.simulateFocus ?? true}
                  onChange={(v) => onUpdateObjects(fixtureIds, { simulateFocus: v })}
                />
              </PropRow>
            </div>
          )}

          {/* OPTICS & WHEELS SECTION */}
          <SectionHeader
            title="Lighting Fixture Optics & Wheels"
            collapsed={Boolean(collapsed.optics)}
            onToggle={() => toggleSection('optics')}
          />
          {!collapsed.optics && (
            <div className="flex flex-col gap-[4px] px-1">
              <PropRow label="Optics">
                <input
                  type="text"
                  value={
                    primaryObj.opticsSummary ??
                    `Spot Application lens, 3° - 42°, 25149lm`
                  }
                  onChange={(e) => onUpdateObjects(fixtureIds, { opticsSummary: e.target.value })}
                  className="w-full h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                />
              </PropRow>

              <PropRow label="Throws Light / Spill">
                <div className="flex items-center gap-2">
                  <YesNoToggle
                    value={primaryObj.throwsLight ?? true}
                    onChange={(v) => onUpdateObjects(fixtureIds, { throwsLight: v })}
                  />
                  <YesNoToggle
                    value={primaryObj.spillLighting ?? false}
                    onChange={(v) => onUpdateObjects(fixtureIds, { spillLighting: v })}
                  />
                </div>
              </PropRow>

              <PropRow label="Color Wheel">
                <div className="flex items-center gap-1 flex-wrap">
                  {COLOR_WHEEL_SLOTS.map((slot) => (
                    <button
                      key={slot.name}
                      type="button"
                      title={slot.name}
                      onClick={() => onUpdateObjects(fixtureIds, { color: slot.hex })}
                      className={`w-[16px] h-[16px] border cursor-pointer ${
                        (primaryObj.color || '').toUpperCase() === slot.hex
                          ? 'border-[#FFFFFF] scale-110'
                          : 'border-[#141414]'
                      }`}
                      style={{ backgroundColor: slot.hex }}
                    />
                  ))}
                </div>
              </PropRow>

              <PropRow label="Static / Rotating Gobo">
                <div className="flex items-center gap-1 flex-wrap">
                  {GOBO_SLOTS.map((slot) => (
                    <button
                      key={slot.name}
                      type="button"
                      title={slot.name}
                      onClick={() =>
                        onUpdateObjects(fixtureIds, {
                          gobo: slot.name,
                          staticGobo: slot.name,
                        })
                      }
                      className={`w-[22px] h-[20px] bg-[#141414] border text-[11px] flex items-center justify-center cursor-pointer ${
                        primaryObj.gobo === slot.name
                          ? 'border-[#857431] text-[#6BC938]'
                          : 'border-[#2E2E2E] text-[#CCCCCC] hover:border-[#777]'
                      }`}
                    >
                      {slot.glyph}
                    </button>
                  ))}
                </div>
              </PropRow>

              <PropRow label="Effect / Prism 1 / 2">
                <div className="grid grid-cols-3 gap-1">
                  <select
                    value={primaryObj.effectWheel ?? 'Open'}
                    onChange={(e) => onUpdateObjects(fixtureIds, { effectWheel: e.target.value })}
                    className="h-[19px] px-1 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  >
                    <option value="Open">Effect: Open</option>
                    <option value="Animation">Animation</option>
                    <option value="Frost">Medium Frost</option>
                  </select>
                  <select
                    value={primaryObj.prism1 ?? 'None'}
                    onChange={(e) => onUpdateObjects(fixtureIds, { prism1: e.target.value })}
                    className="h-[19px] px-1 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  >
                    <option value="None">Prism 1: Open</option>
                    <option value="3-Facet">3-Facet</option>
                    <option value="4-Linear">4-Linear</option>
                  </select>
                  <select
                    value={primaryObj.beamShaper ?? 'None'}
                    onChange={(e) => onUpdateObjects(fixtureIds, { beamShaper: e.target.value })}
                    className="h-[19px] px-1 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  >
                    <option value="None">Shaper: Open</option>
                    <option value="Framing 4-Blade">4-Blade</option>
                  </select>
                </div>
              </PropRow>
            </div>
          )}

          {/* PLOT SYMBOL SECTION */}
          <SectionHeader
            title="Plot Symbol"
            collapsed={Boolean(collapsed.plotSym)}
            onToggle={() => toggleSection('plotSym')}
          />
          {!collapsed.plotSym && (
            <div className="flex flex-col gap-[3px] px-1">
              <PropRow label="Symbol / Scale (%)">
                <div className="grid grid-cols-[1fr_64px] gap-1">
                  <input
                    type="text"
                    value={primaryObj.symbolName ?? 'Standard Moving Head'}
                    onChange={(e) => onUpdateObjects(fixtureIds, { symbolName: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  />
                  <input
                    type="number"
                    value={primaryObj.symbolScale ?? 100}
                    onChange={(e) =>
                      onUpdateObjects(fixtureIds, { symbolScale: Number(e.target.value) || 100 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[10px] tabular-nums"
                  />
                </div>
              </PropRow>

              <PropRow label="Symbol Usage">
                <select
                  value={primaryObj.symbolUsage ?? 'Top Views Only'}
                  onChange={(e) =>
                    onUpdateObjects(fixtureIds, {
                      symbolUsage: e.target.value as SceneObject['symbolUsage'],
                    })
                  }
                  className="w-full h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                >
                  <option value="Top Views Only">Top Views Only</option>
                  <option value="All Views">All Views</option>
                  <option value="Plot Only">Plot Only</option>
                </select>
              </PropRow>

              <PropRow label="Colour by Filter / Focus">
                <div className="flex items-center gap-2">
                  <YesNoToggle
                    value={primaryObj.colourByFilter ?? true}
                    onChange={(v) => onUpdateObjects(fixtureIds, { colourByFilter: v })}
                  />
                  <input
                    type="text"
                    placeholder="Focus area..."
                    value={primaryObj.focusLabel ?? 'Center Stage'}
                    onChange={(e) => onUpdateObjects(fixtureIds, { focusLabel: e.target.value })}
                    className="flex-1 h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  />
                </div>
              </PropRow>
            </div>
          )}
        </>
      )}

      {/* === TRUSS SEGMENT SECTIONS === */}
      {isTruss && (
        <>
          <SectionHeader
            title="Truss Specifications"
            collapsed={Boolean(collapsed.trussSpec)}
            onToggle={() => toggleSection('trussSpec')}
          />
          {!collapsed.trussSpec && (
            <div className="flex flex-col gap-[3px] px-1">
              <PropRow label="Make / Series">
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="text"
                    value={primaryObj.make ?? 'Prolyte'}
                    onChange={(e) => onUpdateObjects(targetIds, { make: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="text"
                    value={primaryObj.series ?? 'H30V'}
                    onChange={(e) => onUpdateObjects(targetIds, { series: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Subseries / Part">
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="text"
                    value={primaryObj.subseries ?? 'Box Truss'}
                    onChange={(e) => onUpdateObjects(targetIds, { subseries: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="text"
                    value={primaryObj.part ?? `H30V-L${((primaryObj.length ?? 4) * 100).toFixed(0)}`}
                    onChange={(e) => onUpdateObjects(targetIds, { part: e.target.value })}
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Type / Weight (kg)">
                <div className="grid grid-cols-[1fr_64px] gap-1">
                  <select
                    value={primaryObj.trussType ?? 'Rectangular Section'}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, {
                        trussType: e.target.value as SceneObject['trussType'],
                      })
                    }
                    className="h-[19px] px-1 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  >
                    <option value="Rectangular Section">Rectangular Section</option>
                    <option value="Triangular Section">Triangular Section</option>
                    <option value="Ladder Section">Ladder Section</option>
                    <option value="Flat Section">Flat Section</option>
                    <option value="Circle Section">Circle Section</option>
                    <option value="Corner">Corner</option>
                  </select>
                  <input
                    type="number"
                    step={0.5}
                    value={primaryObj.weightKg ?? Number(((primaryObj.length ?? 4) * 5.4).toFixed(1))}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { weightKg: Number(e.target.value) || 0 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[10px] tabular-nums"
                  />
                </div>
              </PropRow>

              <PropRow label="Pipe / Brace Ø (mm)">
                <div className="grid grid-cols-2 gap-1 tabular-nums">
                  <input
                    type="number"
                    value={primaryObj.pipeDiameterMm ?? 48}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { pipeDiameterMm: Number(e.target.value) || 48 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="number"
                    value={primaryObj.braceDiameterMm ?? 16}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { braceDiameterMm: Number(e.target.value) || 16 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Sec W / H / Length (m)">
                <div className="grid grid-cols-3 gap-1 tabular-nums">
                  <input
                    type="number"
                    step={0.01}
                    value={primaryObj.sectionWidth ?? 0.29}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { sectionWidth: Math.max(0.1, Number(e.target.value) || 0.29) })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="number"
                    step={0.01}
                    value={primaryObj.sectionHeight ?? 0.29}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { sectionHeight: Math.max(0.1, Number(e.target.value) || 0.29) })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="number"
                    step={0.5}
                    min={0.5}
                    value={primaryObj.length ?? 4.0}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { length: Math.max(0.5, Number(e.target.value) || 2) })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                </div>
              </PropRow>

              <PropRow label="Circle Angle / Ø / Mat">
                <div className="grid grid-cols-3 gap-1 tabular-nums">
                  <input
                    type="number"
                    value={primaryObj.circleAngle ?? 0}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { circleAngle: Number(e.target.value) || 0 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="number"
                    value={primaryObj.circleDiameter ?? 0}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { circleDiameter: Number(e.target.value) || 0 })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                  />
                  <input
                    type="text"
                    value={primaryObj.materialPreset ?? 'Aluminum'}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { materialPreset: e.target.value })
                    }
                    className="h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  />
                </div>
              </PropRow>
            </div>
          )}

          <SectionHeader
            title="Plot Annotation"
            collapsed={Boolean(collapsed.plotAnno)}
            onToggle={() => toggleSection('plotAnno')}
          />
          {!collapsed.plotAnno && (
            <div className="flex flex-col gap-[3px] px-1">
              <PropRow label="Text">
                <input
                  type="text"
                  value={primaryObj.plotText ?? primaryObj.name}
                  onChange={(e) => onUpdateObjects(targetIds, { plotText: e.target.value })}
                  className="w-full h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                />
              </PropRow>
              <PropRow label="Show Type / Dims / Trim">
                <div className="flex items-center gap-1">
                  <YesNoToggle
                    value={primaryObj.showType ?? true}
                    onChange={(v) => onUpdateObjects(targetIds, { showType: v })}
                  />
                  <YesNoToggle
                    value={primaryObj.showDimensions ?? true}
                    onChange={(v) => onUpdateObjects(targetIds, { showDimensions: v })}
                  />
                  <YesNoToggle
                    value={primaryObj.showTrimHeight ?? true}
                    onChange={(v) => onUpdateObjects(targetIds, { showTrimHeight: v })}
                  />
                </div>
              </PropRow>
              <PropRow label="Trim Precision / Unit">
                <div className="grid grid-cols-2 gap-1">
                  <select
                    value={primaryObj.trimHeightPrecision ?? 'Centimetres'}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { trimHeightPrecision: e.target.value })
                    }
                    className="h-[19px] px-1 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  >
                    <option value="Centimetres">Centimetres</option>
                    <option value="Inches">Inches</option>
                    <option value="Millimetres">Millimetres</option>
                  </select>
                  <select
                    value={primaryObj.measurementUnit ?? 'Automatic'}
                    onChange={(e) =>
                      onUpdateObjects(targetIds, { measurementUnit: e.target.value })
                    }
                    className="h-[19px] px-1 bg-[#1E1E1E] border border-[#141414] text-[10px]"
                  >
                    <option value="Automatic">Automatic</option>
                    <option value="Metric (m)">Metric (m)</option>
                    <option value="Imperial (ft)">Imperial (ft)</option>
                  </select>
                </div>
              </PropRow>
            </div>
          )}
        </>
      )}

      {/* === SMOKE / HAZE VOLUME SECTIONS === */}
      {isSmoke && (
        <>
          <div className="px-1.5 py-1 bg-[#1B262C] border border-[#2C4654] text-[10px] text-[#9EC5D6]">
            Volumetric particle simulation active exclusively in 3D <span className="font-semibold text-[#FFFFFF]">Live</span> viewports.
          </div>

          {/* 1. All Smoke Section */}
          <SectionHeader
            title="All Smoke"
            collapsed={Boolean(collapsed.allSmoke)}
            onToggle={() => toggleSection('allSmoke')}
          />
          {!collapsed.allSmoke && (
            <div className="flex flex-col gap-[3px] px-1">
              <PropRow label="Legacy Model">
                <YesNoToggle
                  value={Boolean(primaryObj.smokeLegacyModel)}
                  onChange={(v) =>
                    onUpdateObjects(allSmokeIds.length > 0 ? allSmokeIds : targetIds, {
                      smokeLegacyModel: v,
                    })
                  }
                />
              </PropRow>

              <PropRow label="Speed">
                <div className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={1}
                    value={primaryObj.smokeSpeed ?? 0}
                    onChange={(e) =>
                      onUpdateObjects(allSmokeIds.length > 0 ? allSmokeIds : targetIds, {
                        smokeSpeed: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                      })
                    }
                    className="flex-1 accent-[#857431]"
                  />
                  <label className="flex items-center bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px] w-[58px] tabular-nums">
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step={1}
                      value={primaryObj.smokeSpeed ?? 0}
                      onChange={(e) =>
                        onUpdateObjects(allSmokeIds.length > 0 ? allSmokeIds : targetIds, {
                          smokeSpeed: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                        })
                      }
                      className="w-full bg-transparent text-[11px] text-[#FFFFFF] text-right focus:outline-none tabular-nums"
                    />
                    <span className="text-[10px] text-[#8E8E93] ml-0.5">%</span>
                  </label>
                </div>
              </PropRow>
            </div>
          )}

          {/* 2. Smoke Properties Section */}
          <SectionHeader
            title="Smoke Properties"
            collapsed={Boolean(collapsed.smokeProps)}
            onToggle={() => toggleSection('smokeProps')}
          />
          {!collapsed.smokeProps && (
            <div className="flex flex-col gap-[3px] px-1">
              <PropRow label="Auto-size">
                <div className="flex items-center gap-2">
                  <YesNoToggle
                    value={Boolean(primaryObj.smokeAutoSize)}
                    onChange={(enabled) => {
                      if (enabled) {
                        const bounds = computeAutoSmokeBounds(objects);
                        onUpdateObjects(selectedSmokeIds, {
                          smokeAutoSize: true,
                          smokeWidth: bounds.width,
                          smokeHeight: bounds.height,
                          smokeDepth: bounds.depth,
                          position: bounds.position,
                        });
                      } else {
                        onUpdateObjects(selectedSmokeIds, { smokeAutoSize: false });
                      }
                    }}
                  />
                  {primaryObj.smokeAutoSize && (
                    <span className="text-[10px] text-[#6BC938]">Fitted to project bounds</span>
                  )}
                </div>
              </PropRow>

              <PropRow label="Width">
                <label className="flex items-center bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px] tabular-nums">
                  <input
                    type="number"
                    min={1}
                    max={500}
                    step={0.5}
                    disabled={Boolean(primaryObj.smokeAutoSize)}
                    value={primaryObj.smokeWidth ?? 200}
                    onChange={(e) =>
                      onUpdateObjects(selectedSmokeIds, {
                        smokeWidth: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-full bg-transparent text-[11px] text-[#FFFFFF] disabled:text-[#777777] focus:outline-none tabular-nums"
                  />
                  <span className="text-[10px] text-[#8E8E93] ml-1">m</span>
                </label>
              </PropRow>

              <PropRow label="Height">
                <label className="flex items-center bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px] tabular-nums">
                  <input
                    type="number"
                    min={1}
                    max={300}
                    step={0.5}
                    disabled={Boolean(primaryObj.smokeAutoSize)}
                    value={primaryObj.smokeHeight ?? 50}
                    onChange={(e) =>
                      onUpdateObjects(selectedSmokeIds, {
                        smokeHeight: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-full bg-transparent text-[11px] text-[#FFFFFF] disabled:text-[#777777] focus:outline-none tabular-nums"
                  />
                  <span className="text-[10px] text-[#8E8E93] ml-1">m</span>
                </label>
              </PropRow>

              <PropRow label="Depth">
                <label className="flex items-center bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px] tabular-nums">
                  <input
                    type="number"
                    min={1}
                    max={500}
                    step={0.5}
                    disabled={Boolean(primaryObj.smokeAutoSize)}
                    value={primaryObj.smokeDepth ?? 60}
                    onChange={(e) =>
                      onUpdateObjects(selectedSmokeIds, {
                        smokeDepth: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-full bg-transparent text-[11px] text-[#FFFFFF] disabled:text-[#777777] focus:outline-none tabular-nums"
                  />
                  <span className="text-[10px] text-[#8E8E93] ml-1">m</span>
                </label>
              </PropRow>

              <PropRow label="Density">
                <div className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={0}
                    max={25}
                    step={0.1}
                    value={primaryObj.smokeDensity ?? 1.3}
                    onChange={(e) =>
                      onUpdateObjects(selectedSmokeIds, {
                        smokeDensity: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      })
                    }
                    className="flex-1 accent-[#857431]"
                  />
                  <label className="flex items-center bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px] w-[58px] tabular-nums">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={primaryObj.smokeDensity ?? 1.3}
                      onChange={(e) =>
                        onUpdateObjects(selectedSmokeIds, {
                          smokeDensity: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        })
                      }
                      className="w-full bg-transparent text-[11px] text-[#FFFFFF] text-right focus:outline-none tabular-nums"
                    />
                    <span className="text-[10px] text-[#8E8E93] ml-0.5">%</span>
                  </label>
                </div>
              </PropRow>

              <PropRow label="Variation">
                <div className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={primaryObj.smokeVariation ?? 100}
                    onChange={(e) =>
                      onUpdateObjects(selectedSmokeIds, {
                        smokeVariation: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      })
                    }
                    className="flex-1 accent-[#857431]"
                  />
                  <label className="flex items-center bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px] w-[58px] tabular-nums">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={primaryObj.smokeVariation ?? 100}
                      onChange={(e) =>
                        onUpdateObjects(selectedSmokeIds, {
                          smokeVariation: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        })
                      }
                      className="w-full bg-transparent text-[11px] text-[#FFFFFF] text-right focus:outline-none tabular-nums"
                    />
                    <span className="text-[10px] text-[#8E8E93] ml-0.5">%</span>
                  </label>
                </div>
              </PropRow>

              <PropRow label="Edge Softness">
                <div className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.1}
                    value={primaryObj.smokeEdgeSoftness ?? 37.9}
                    onChange={(e) =>
                      onUpdateObjects(selectedSmokeIds, {
                        smokeEdgeSoftness: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      })
                    }
                    className="flex-1 accent-[#857431]"
                  />
                  <label className="flex items-center bg-[#1E1E1E] border border-[#141414] px-1.5 h-[19px] w-[58px] tabular-nums">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={primaryObj.smokeEdgeSoftness ?? 37.9}
                      onChange={(e) =>
                        onUpdateObjects(selectedSmokeIds, {
                          smokeEdgeSoftness: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                        })
                      }
                      className="w-full bg-transparent text-[11px] text-[#FFFFFF] text-right focus:outline-none tabular-nums"
                    />
                    <span className="text-[10px] text-[#8E8E93] ml-0.5">%</span>
                  </label>
                </div>
              </PropRow>

              <PropRow label="Patch">
                <div className="flex items-center gap-1">
                  <select
                    value={parsedSmokePatch.isPatched ? 'patched' : 'Unpatched'}
                    onChange={(e) => {
                      if (e.target.value === 'Unpatched') {
                        onUpdateObjects(selectedSmokeIds, { smokePatch: 'Unpatched' });
                      } else {
                        onUpdateObjects(selectedSmokeIds, { smokePatch: '1.150' });
                      }
                    }}
                    className="flex-1 h-[19px] px-1.5 bg-[#1E1E1E] border border-[#141414] text-[11px] text-[#FFFFFF]"
                  >
                    <option value="Unpatched">Unpatched</option>
                    <option value="patched">DMX Patched (2 ch: Density / Speed)</option>
                  </select>
                  {parsedSmokePatch.isPatched && (
                    <div className="flex items-center gap-0.5 tabular-nums">
                      <input
                        type="number"
                        min={1}
                        max={4}
                        value={parsedSmokePatch.universe}
                        onChange={(e) => {
                          const u = Math.max(1, Math.min(4, Number(e.target.value) || 1));
                          onUpdateObjects([primaryObj.id], {
                            smokePatch: `${u}.${parsedSmokePatch.address}`,
                          });
                        }}
                        className="w-[34px] h-[19px] px-1 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                      />
                      <span className="text-[#8E8E93]">.</span>
                      <input
                        type="number"
                        min={1}
                        max={511}
                        value={parsedSmokePatch.address}
                        onChange={(e) => {
                          const a = Math.max(1, Math.min(511, Number(e.target.value) || 1));
                          onUpdateObjects([primaryObj.id], {
                            smokePatch: `${parsedSmokePatch.universe}.${a}`,
                          });
                        }}
                        className="w-[46px] h-[19px] px-1 bg-[#1E1E1E] border border-[#141414] text-[11px]"
                      />
                    </div>
                  )}
                </div>
              </PropRow>
            </div>
          )}
        </>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-2 mt-1 border-t border-[#1A1A1A]">
        <button
          type="button"
          onClick={() => onDuplicateObjects(targetIds)}
          className="px-2.5 py-1 bg-[#383838] border border-[#141414] hover:bg-[#4A4A4A] text-[11px] cursor-pointer"
        >
          Duplicate {selectedObjects.length > 1 ? `(${selectedObjects.length})` : ''}
        </button>
        <button
          type="button"
          onClick={() => onDeleteObjects(targetIds)}
          className="px-2.5 py-1 bg-[#4B1E1B] border border-[#141414] hover:bg-[#6A2824] text-[#FF8A80] text-[11px] cursor-pointer"
        >
          Delete {selectedObjects.length > 1 ? `(${selectedObjects.length})` : ''}
        </button>
      </div>
    </div>
  );
};
