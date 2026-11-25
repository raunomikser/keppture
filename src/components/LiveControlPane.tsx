import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Crosshair,
  Home as HomeIcon,
  Lightbulb,
  ListFilter,
  Power,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { getColorWheelSlots, getFixtureCapabilities } from '../gdtf/capabilities';
import { GdtfProfile } from '../gdtf/types';
import { SceneObject, ViewportId, ViewportSettings } from '../types/visualizer';

export const FIXTURE_KINDS = new Set<SceneObject['kind']>([
  'moving-head',
  'led-par',
  'gdtf-fixture',
  'co2-jet',
  'flame-jet',
]);

const COLOR_SWATCHES = [
  { name: 'White', hex: '#F5F8FC' },
  { name: 'Warm', hex: '#FFD8A8' },
  { name: 'Red', hex: '#FF3B30' },
  { name: 'Amber', hex: '#FF9F0A' },
  { name: 'Green', hex: '#30D158' },
  { name: 'Cyan', hex: '#40C8E0' },
  { name: 'Blue', hex: '#0A84FF' },
  { name: 'Magenta', hex: '#BF5AF2' },
];

const GOBO_SLOTS = [
  { name: 'Open', glyph: '○' },
  { name: 'Dot', glyph: '●' },
  { name: 'Ring', glyph: '◎' },
  { name: 'Cross', glyph: '✚' },
  { name: 'Slash', glyph: '╱' },
  { name: 'Star', glyph: '✦' },
];

interface LiveControlPaneProps {
  settings: ViewportSettings;
  objects: SceneObject[];
  selectedObjectIds: string[];
  gdtfProfiles: GdtfProfile[];
  focusMode: boolean;
  onToggleFocusMode: () => void;
  onToggleOpen: () => void;
  onUpdateSettings: (id: ViewportId, patch: Partial<ViewportSettings>) => void;
  onUpdateObjects: (ids: string[], patch: Partial<SceneObject>) => void;
  onMoveObjects: (moves: Array<{ id: string; position: [number, number, number] }>) => void;
  onSelectMultiple: (ids: string[], additive: boolean) => void;
  onClearSelection: () => void;
  onDuplicateObjects: (ids: string[]) => void;
  onDeleteObjects: (ids: string[]) => void;
  onShowDetails: () => void;
}

interface FixtureGroup {
  key: string;
  label: string;
  ids: string[];
  objects: SceneObject[];
  primary: SceneObject;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const pct = (v: number) => `${Math.round(v * 100)}%`;

interface HueState {
  hue: number; // 0..360
  contrast: number; // 0 = white, 1 = full colour
}

/** HSV-style hue + white mix recovered from the stored fixture colour. */
function readHueState(hex: string): HueState {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0.0001) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { hue, contrast: max > 0 ? delta / max : 0 };
}

function hueToRgb(hue: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360;
  const c = 1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b];
}

/** Blend from white (contrast 0) to the saturated hue (contrast 1). */
function hueStateToHex(state: HueState): string {
  const [r, g, b] = hueToRgb(state.hue);
  const mix = (channel: number) =>
    Math.round((1 - state.contrast + state.contrast * channel) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`.toUpperCase();
}

function defaultsFor(obj: SceneObject): Partial<SceneObject> {
  if (obj.kind === 'flame-jet') {
    return { intensity: 1, beamAngle: 7, color: '#FF8A3D', shutter: true };
  }
  if (obj.kind === 'co2-jet') {
    return { intensity: 1, beamAngle: 9, color: '#BFEFFF', shutter: true };
  }
  return { intensity: 0.85, beamAngle: 20, color: '#F5F8FC', shutter: true };
}

/** Solves the simple yoke/pan -> head/tilt hierarchy used by the built-in fixture models. */
export function aimAt(obj: SceneObject, target: [number, number, number]): { pan: number; tilt: number } {
  const dx = target[0] - obj.position[0];
  const dy = target[1] - obj.position[1];
  const dz = target[2] - obj.position[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const pan = Math.atan2(-dx, -dz) * (180 / Math.PI);
  const tilt = Math.acos(clamp(-dy / len, -1, 1)) * (180 / Math.PI);
  const panLimit = clamp(obj.panRange ?? 540, 90, 720) / 2;
  const tiltLimit = clamp(obj.tiltRange ?? 265, 30, 360) / 2;
  return {
    pan: Number(clamp(pan, -panLimit, panLimit).toFixed(1)),
    tilt: Number(clamp(tilt, -tiltLimit, tiltLimit).toFixed(1)),
  };
}

function MiniButton({
  children,
  title,
  onClick,
  active = false,
  danger = false,
  disabled = false,
}: {
  children: React.ReactNode;
  title?: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`h-[18px] px-1 text-[9px] border flex items-center justify-center gap-1 cursor-pointer disabled:opacity-35 disabled:cursor-default ${
        active
          ? danger
            ? 'border-[#D92D20] bg-[#4A1E1B] text-[#FF8A80]'
            : 'border-[#6BC938] bg-[#1B3311] text-[#8FE05A]'
          : danger
            ? 'border-[#5A2A26] text-[#FF9B91] hover:bg-[#3A1D1A]'
            : 'border-[#3B4D6A] text-[#CBD5E1] hover:bg-[#354663] hover:text-[#F5F8FC]'
      }`}
    >
      {children}
    </button>
  );
}

function ControlRow({
  label,
  children,
  inline = false,
}: {
  label: string;
  children: React.ReactNode;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="flex items-center gap-1 min-h-[18px]">
        <div
          className="w-[48px] shrink-0 text-[9px] uppercase tracking-[0.04em] leading-tight text-[#A8B5CB] truncate"
          title={label}
        >
          {label}
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[1px]">
      <div className="text-[9px] uppercase tracking-[0.08em] text-[#A8B5CB]">{label}</div>
      {children}
    </div>
  );
}

export function LiveControlPane({
  settings,
  objects,
  selectedObjectIds,
  gdtfProfiles,
  focusMode,
  onToggleFocusMode,
  onToggleOpen,
  onUpdateSettings,
  onUpdateObjects,
  onMoveObjects,
  onSelectMultiple,
  onClearSelection,
  onDuplicateObjects,
  onDeleteObjects,
  onShowDetails,
}: LiveControlPaneProps) {
  const [byType, setByType] = useState(true);
  const [opacity, setOpacity] = useState(88);
  const [fixedWidth, setFixedWidth] = useState(140);
  const [fine, setFine] = useState(false);
  const [hueOverrides, setHueOverrides] = useState<Record<string, HueState>>({});
  const modifiersRef = useRef({ ctrl: false, meta: false, alt: false });
  const rootRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  const syncModifiers = (e: React.MouseEvent | React.KeyboardEvent) => {
    modifiersRef.current = {
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      alt: e.altKey,
    };
    setFine((prev) => (prev === e.shiftKey ? prev : e.shiftKey));
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!resizingRef.current || !rootRef.current) return;
      const left = rootRef.current.getBoundingClientRect().left;
      setFixedWidth(Math.max(120, Math.min(240, e.clientX - left)));
    };
    const onUp = () => {
      resizingRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selectedObjectIds), [selectedObjectIds]);
  const fixtures = useMemo(
    () => objects.filter((o) => selectedSet.has(o.id) && FIXTURE_KINDS.has(o.kind)),
    [objects, selectedSet],
  );
  const allIds = useMemo(() => fixtures.map((o) => o.id), [fixtures]);

  const profileName = (obj: SceneObject) => {
    if (obj.gdtfProfileId) {
      const profile = gdtfProfiles.find((p) => p.id === obj.gdtfProfileId);
      if (profile?.metadata?.name) return profile.metadata.name;
    }
    return obj.name;
  };

  const groups = useMemo<FixtureGroup[]>(() => {
    if (fixtures.length === 0) return [];
    if (!byType) {
      return fixtures.map((obj) => ({
        key: obj.id,
        label: profileName(obj),
        ids: [obj.id],
        objects: [obj],
        primary: obj,
      }));
    }
    const buckets = new Map<string, SceneObject[]>();
    for (const obj of fixtures) {
      const key = obj.gdtfProfileId
        ? `gdtf:${obj.gdtfProfileId}:${obj.gdtfModeName ?? ''}`
        : obj.kind;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(obj);
      else buckets.set(key, [obj]);
    }
    return [...buckets.entries()].map(([key, objs]) => ({
      key,
      label:
        objs.length === 1
          ? profileName(objs[0])
          : `${profileName(objs[0])} ×${objs.length}`,
      ids: objs.map((o) => o.id),
      objects: objs,
      primary: objs[0],
    }));
  }, [fixtures, byType, gdtfProfiles]);

  const update = (ids: string[], patch: Partial<SceneObject>) => onUpdateObjects(ids, patch);

  const capsFor = (obj: SceneObject) => getFixtureCapabilities(obj, gdtfProfiles);
  const hueStateFor = (group: FixtureGroup): HueState =>
    hueOverrides[group.key] ?? readHueState(group.primary.color ?? '#F5F8FC');
  const applyHueState = (group: FixtureGroup, next: HueState) => {
    setHueOverrides((prev) => ({ ...prev, [group.key]: next }));
    update(group.ids, { color: hueStateToHex(next) });
  };
  // A white fixture has no visible hue yet — picking one should also dial in
  // full colour instead of leaving the contrast slider at zero.
  const pickHue = (group: FixtureGroup, hue: number) => {
    const state = hueStateFor(group);
    applyHueState(group, { hue, contrast: state.contrast > 0.02 ? state.contrast : 1 });
  };
  const anyMoving = fixtures.some((obj) => capsFor(obj).isMovingHead);

  const lightOn = (ids: string[], primary: SceneObject) => {
    update(ids, {
      shutter: true,
      intensity: primary.intensity && primary.intensity > 0.01 ? primary.intensity : 0.85,
    });
  };

  const home = (ids: string[], includePanTilt: boolean) => {
    setHueOverrides({});
    const base: Partial<SceneObject> = { ...defaultsFor(fixtures.find((o) => ids.includes(o.id)) ?? objects[0]) };
    delete base.pan;
    delete base.tilt;
    if (includePanTilt) {
      base.pan = 0;
      base.tilt = 25;
    }
    update(ids, base);
  };

  const applyFanned = (
    objs: SceneObject[],
    key: 'pan' | 'tilt' | 'beamAngle',
    value: number,
    min: number,
    max: number,
  ) => {
    const { ctrl, meta, alt } = modifiersRef.current;
    const fan = ctrl || meta;
    if (!fan || objs.length === 1) {
      update(objs.map((o) => o.id), { [key]: value });
      return;
    }
    const step = (alt ? 0.05 : 0.18) * (max - min);
    for (let i = 0; i < objs.length; i++) {
      const fanned = clamp(value + (i - (objs.length - 1) / 2) * step, min, max);
      update([objs[i].id], { [key]: Number(fanned.toFixed(1)) });
    }
  };

  const moveGroup = (objs: SceneObject[], axis: 0 | 1 | 2, sign: 1 | -1) => {
    onMoveObjects(
      objs.map((obj) => {
        const next: [number, number, number] = [...obj.position];
        next[axis] = Number((next[axis] + sign * 0.25).toFixed(2));
        return { id: obj.id, position: next };
      }),
    );
  };

  const aimSelectedAt = (target: [number, number, number]) => {
    for (const obj of fixtures) {
      if (!capsFor(obj).isMovingHead) continue;
      const solved = aimAt(obj, target);
      update([obj.id], solved);
    }
  };

  return (
    <div
      ref={rootRef}
      className="absolute bottom-[34px] left-[8px] right-auto z-30 h-[190px] max-w-full rounded-[6px] border border-[#4E5F79] shadow-[0_12px_36px_rgba(0,0,0,0.8)] text-[#F5F8FC] flex flex-row overflow-hidden"
      style={{ backgroundColor: `rgba(28, 28, 30, ${opacity / 100})` }}
      onPointerDownCapture={syncModifiers}
      onPointerMoveCapture={syncModifiers}
      onKeyDownCapture={syncModifiers}
      onKeyUpCapture={syncModifiers}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Fixed left pane — mirrors the manual's always-present control column. */}
      <div
        className="shrink-0 min-h-0 border-r border-[#3B4D69] p-1.5 flex flex-col gap-1 overflow-y-auto"
        style={{ width: fixedWidth }}
      >
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[#E2E8F0]">
            Control Pane
          </div>
          <MiniButton title="Close control pane" onClick={onToggleOpen}>
            <Power className="w-[11px] h-[11px]" />
          </MiniButton>
        </div>

        <ControlRow inline label="Light">
          <div className="grid grid-cols-2 gap-1">
            <MiniButton onClick={() => lightOn(allIds, fixtures[0])} disabled={allIds.length === 0}>
              <Lightbulb className="w-[10px] h-[10px]" /> On
            </MiniButton>
            <MiniButton
              danger
              onClick={() => update(allIds, { shutter: false })}
              disabled={allIds.length === 0}
            >
              <Lightbulb className="w-[10px] h-[10px]" /> Off
            </MiniButton>
          </div>
        </ControlRow>

        <ControlRow inline label="Home">
          <div className="grid grid-cols-2 gap-1">
            <MiniButton title="Home all except Pan/Tilt" onClick={() => home(allIds, false)} disabled={allIds.length === 0}>
              <HomeIcon className="w-[10px] h-[10px]" /> Home
            </MiniButton>
            <MiniButton
              title={anyMoving ? 'Home all parameters including Pan/Tilt' : 'Home all parameters'}
              onClick={() => home(allIds, anyMoving)}
              disabled={allIds.length === 0}
            >
              <RotateCcw className="w-[10px] h-[10px]" /> All
            </MiniButton>
          </div>
        </ControlRow>

        <ControlRow inline label={`Ambient · ${settings.ambientLighting}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.ambientLighting}
            onChange={(e) =>
              onUpdateSettings(settings.id, { ambientLighting: Number(e.target.value) })
            }
            className="w-full accent-[#A08F52]"
          />
        </ControlRow>

        <ControlRow inline label={`Pane · ${100 - opacity}%`}>
          <input
            type="range"
            min={45}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-full accent-[#83D84C]"
          />
        </ControlRow>

        <div className="grid grid-cols-2 gap-1">
          <MiniButton active={byType} onClick={() => setByType((v) => !v)}>
            <ListFilter className="w-[10px] h-[10px]" /> By Type
          </MiniButton>
          <MiniButton
            active={focusMode}
            disabled={!anyMoving}
            title={anyMoving ? 'Aim at point' : 'No moving fixtures selected'}
            onClick={onToggleFocusMode}
          >
            <Crosshair className="w-[10px] h-[10px]" /> Focus
          </MiniButton>
        </div>

        <div className="mt-auto grid grid-cols-3 gap-1 pt-1 border-t border-[#3B4D69]">
          <MiniButton title="Duplicate selected" onClick={() => onDuplicateObjects(allIds)} disabled={allIds.length === 0}>
            <Copy className="w-[10px] h-[10px]" />
          </MiniButton>
          <MiniButton title="Delete selected" danger onClick={() => onDeleteObjects(allIds)} disabled={allIds.length === 0}>
            <Trash2 className="w-[10px] h-[10px]" />
          </MiniButton>
          <MiniButton title="Show details in Project panel" onClick={onShowDetails} disabled={allIds.length === 0}>
            <ListFilter className="w-[10px] h-[10px]" />
          </MiniButton>
        </div>
        <MiniButton onClick={onClearSelection} disabled={selectedObjectIds.length === 0}>
          <X className="w-[10px] h-[10px]" /> Clear Selection
        </MiniButton>
      </div>

      {/* Resizing bar from the reference manual. */}
      <div
        title="Drag to resize control pane"
        onPointerDown={(e) => {
          e.stopPropagation();
          resizingRef.current = true;
        }}
        className="w-[4px] h-full shrink-0 cursor-col-resize bg-[#3B4D69] hover:bg-[#83D84C]"
      />

      {/* One column per selected fixture type (or per fixture when By Type is off). */}
      <div className="min-w-0 min-h-0 h-full overflow-x-auto overflow-y-hidden flex">
        {focusMode && (
          <div className="w-[160px] h-full shrink-0 p-1.5 border-r border-[#3B4D69] bg-[#1C2819] overflow-y-auto">
            <div className="text-[10px] font-semibold text-[#9CE06A] mb-1">Focus Mode</div>
            <p className="text-[10px] leading-[14px] text-[#C8D8BC]">
              Click any object in the viewport to aim all selected fixtures at that point. Click a
              fixture to add it to the selection.
            </p>
            <div className="mt-2 flex gap-1">
              <MiniButton onClick={() => aimSelectedAt([0, 0, 0])} disabled={allIds.length === 0}>
                Aim at origin
              </MiniButton>
              <MiniButton active onClick={onToggleFocusMode}>
                Exit
              </MiniButton>
            </div>
          </div>
        )}

        {groups.map((group) => {
          const p = group.primary;
          const caps = capsFor(p);
          const hueState = hueStateFor(group);
          const colorWheelProfile = p.gdtfProfileId
            ? gdtfProfiles.find((profile) => profile.id === p.gdtfProfileId)
            : undefined;
          const wheelSlots = colorWheelProfile ? getColorWheelSlots(colorWheelProfile) : [];
          const swatches = wheelSlots.length > 0 ? wheelSlots : COLOR_SWATCHES;
          const panLimit = clamp(p.panRange ?? 540, 90, 720) / 2;
          const tiltLimit = clamp(p.tiltRange ?? 265, 30, 360) / 2;
          const patch = p.dmxUniverse && p.dmxAddress ? `${p.dmxUniverse}.${String(p.dmxAddress).padStart(3, '0')}` : 'Unpatched';
          return (
            <div
              key={group.key}
              className="w-[148px] h-full shrink-0 border-r border-[#3B4D69] p-1 flex flex-col gap-[1px] overflow-y-auto"
            >
              <div className="flex items-start justify-between gap-1 mb-[2px]">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold leading-[13px] truncate" title={group.label}>
                    {group.label}
                  </div>
                  <div className="text-[8px] text-[#A8B5CB] tabular-nums leading-[10px]">{patch}</div>
                </div>
                <MiniButton title="Select only this group" onClick={() => onSelectMultiple(group.ids, false)}>
                  Solo
                </MiniButton>
              </div>

              <ControlRow inline label="Light">
                <div className="grid grid-cols-2 gap-1 w-full">
                  <MiniButton active={p.shutter !== false} onClick={() => lightOn(group.ids, p)}>
                    On
                  </MiniButton>
                  <MiniButton active={p.shutter === false} danger onClick={() => update(group.ids, { shutter: false })}>
                    Off
                  </MiniButton>
                </div>
              </ControlRow>

              {caps.hasColorWheel ? (
                <ControlRow inline label="Wheel">
                  <div className="flex flex-wrap gap-[2px]">
                    {swatches.map((slot) => (
                      <button
                        key={slot.hex}
                        type="button"
                        title={slot.name}
                        onClick={() => update(group.ids, { color: slot.hex })}
                        className={`w-[14px] h-[13px] border cursor-pointer ${
                          (p.color ?? '').toUpperCase() === slot.hex.toUpperCase()
                            ? 'border-[#F5F8FC] scale-110'
                            : 'border-[#1A2740] hover:border-[#8695AD]'
                        }`}
                        style={{ backgroundColor: slot.hex }}
                      />
                    ))}
                  </div>
                </ControlRow>
              ) : caps.hasRgbMixing ? (
                <>
                  <ControlRow inline label="Hue">
                    <div
                      title="RGB hue — click or drag"
                      className="relative h-[13px] w-full shrink-0 cursor-crosshair border border-[#2A3A54]"
                      style={{
                        background:
                          'linear-gradient(to right, #FF0000 0%, #FFFF00 17%, #00FF00 33%, #00FFFF 50%, #0000FF 67%, #FF00FF 83%, #FF0000 100%)',
                      }}
                      onPointerDown={(e) => {
                        try {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        } catch {
                          // Synthetic pointer events have no active pointer to capture.
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        const hue = clamp(((e.clientX - rect.left) / rect.width) * 360, 0, 359);
                        pickHue(group, hue);
                      }}
                      onPointerMove={(e) => {
                        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const hue = clamp(((e.clientX - rect.left) / rect.width) * 360, 0, 359);
                        pickHue(group, hue);
                      }}
                    >
                      <div
                        className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-white shadow-[0_0_3px_#08111F]"
                        style={{ left: `${(hueState.hue / 360) * 100}%` }}
                      />
                    </div>
                  </ControlRow>
                  <ControlRow inline label={`Contrast ${pct(hueState.contrast)}`}>
                    <div className="flex items-center gap-1 w-full">
                      <span className="text-[8px] text-[#B6C2D3]">White</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={hueState.contrast}
                        onChange={(e) =>
                          applyHueState(group, { ...hueState, contrast: Number(e.target.value) })
                        }
                        className="flex-1 min-w-0"
                        style={{ accentColor: p.color ?? '#F5F8FC' }}
                      />
                      <span className="text-[8px] text-[#B6C2D3]">Color</span>
                    </div>
                  </ControlRow>
                </>
              ) : null}

              <ControlRow inline label={`Dim ${pct(p.intensity ?? 0)}`}>
                <div className="flex items-center gap-1 w-full">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={p.intensity ?? 0}
                    onChange={(e) => update(group.ids, { intensity: Number(e.target.value) })}
                    className="flex-1 min-w-0 accent-[#A08F52]"
                  />
                  <span className="text-[8px] text-[#8695AD] w-[28px] text-right">
                    {p.intensity && p.intensity <= 0.01
                      ? 'Black'
                      : caps.hasColorWheel || caps.hasRgbMixing
                        ? 'Color'
                        : 'White'}
                  </span>
                  {caps.hasColorWheel && (
                    <input
                      type="color"
                      value={p.color ?? '#F5F8FC'}
                      onChange={(e) => update(group.ids, { color: e.target.value })}
                      className="w-[18px] h-[17px] p-0 bg-[#172236] border border-[#2A3A54] cursor-pointer"
                      title="Fixture color"
                    />
                  )}
                </div>
              </ControlRow>

              {caps.hasPan && (
                <ControlRow inline label={`Pan ${(p.pan ?? 0).toFixed(1)}°`}>
                  <input
                    type="range"
                    min={-panLimit}
                    max={panLimit}
                    step={fine ? 0.05 : 0.5}
                    value={clamp(p.pan ?? 0, -panLimit, panLimit)}
                    onChange={(e) => applyFanned(group.objects, 'pan', Number(e.target.value), -panLimit, panLimit)}
                    className="flex-1 min-w-0 accent-[#83D84C]"
                  />
                  <input
                    type="number"
                    step={fine ? 0.05 : 0.5}
                    value={p.pan ?? 0}
                    onChange={(e) => update(group.ids, { pan: Number(e.target.value) || 0 })}
                    className="w-[40px] h-[17px] px-1 bg-[#172236] border border-[#2A3A54] text-[10px] tabular-nums"
                    title="Pan degrees (Ctrl/⌘ + drag to fan)"
                  />
                </ControlRow>
              )}

              {caps.hasTilt && (
                <ControlRow inline label={`Tilt ${(p.tilt ?? 0).toFixed(1)}°`}>
                  <input
                    type="range"
                    min={-tiltLimit}
                    max={tiltLimit}
                    step={fine ? 0.05 : 0.5}
                    value={clamp(p.tilt ?? 0, -tiltLimit, tiltLimit)}
                    onChange={(e) => applyFanned(group.objects, 'tilt', Number(e.target.value), -tiltLimit, tiltLimit)}
                    className="flex-1 min-w-0 accent-[#83D84C]"
                  />
                  <input
                    type="number"
                    step={fine ? 0.05 : 0.5}
                    value={p.tilt ?? 0}
                    onChange={(e) => update(group.ids, { tilt: Number(e.target.value) || 0 })}
                    className="w-[40px] h-[17px] px-1 bg-[#172236] border border-[#2A3A54] text-[10px] tabular-nums"
                    title="Tilt degrees (Ctrl/⌘ + drag to fan)"
                  />
                </ControlRow>
              )}

              {caps.hasZoom && (
                <ControlRow inline label={`Zoom ${(p.beamAngle ?? 20).toFixed(1)}°`}>
                  <input
                    type="range"
                    min={3}
                    max={60}
                    step={fine ? 0.05 : 0.5}
                    value={p.beamAngle ?? 20}
                    onChange={(e) => applyFanned(group.objects, 'beamAngle', Number(e.target.value), 3, 60)}
                    className="flex-1 min-w-0 accent-[#5AC8FA]"
                  />
                  <input
                    type="number"
                    min={3}
                    max={60}
                    step={fine ? 0.05 : 0.5}
                    value={p.beamAngle ?? 20}
                    onChange={(e) => update(group.ids, { beamAngle: clamp(Number(e.target.value) || 20, 3, 60) })}
                    className="w-[40px] h-[17px] px-1 bg-[#172236] border border-[#2A3A54] text-[10px] tabular-nums"
                    title="Beam angle in degrees"
                  />
                </ControlRow>
              )}

              {caps.hasGobo && (
                <ControlRow inline label="Gobo">
                  <div className="flex flex-wrap gap-[2px]">
                    {GOBO_SLOTS.map((slot) => (
                      <button
                        key={slot.name}
                        type="button"
                        title={slot.name}
                        onClick={() => update(group.ids, { gobo: slot.name, staticGobo: slot.name })}
                        className={`h-[17px] px-1 text-[11px] border cursor-pointer ${
                          (p.gobo ?? 'Open') === slot.name
                            ? 'border-[#857431] text-[#6BC938] bg-[#1B3311]'
                            : 'border-[#2F3F5B] text-[#CBD5E1] hover:border-[#8695AD]'
                        }`}
                      >
                        {slot.glyph}
                      </button>
                    ))}
                  </div>
                </ControlRow>
              )}

              <ControlRow inline label="Move">
                <div className="grid grid-cols-3 gap-1 w-full">
                  <MiniButton onClick={() => moveGroup(group.objects, 2, 1)}>Z+</MiniButton>
                  <MiniButton onClick={() => moveGroup(group.objects, 1, 1)}>Y+</MiniButton>
                  <MiniButton onClick={() => moveGroup(group.objects, 0, 1)}>X+</MiniButton>
                  <MiniButton onClick={() => moveGroup(group.objects, 2, -1)}>Z−</MiniButton>
                  <MiniButton onClick={() => moveGroup(group.objects, 1, -1)}>Y−</MiniButton>
                  <MiniButton onClick={() => moveGroup(group.objects, 0, -1)}>X−</MiniButton>
                </div>
              </ControlRow>
            </div>
          );
        })}
      </div>
    </div>
  );
}
