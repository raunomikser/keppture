import { SceneObject } from '../types/visualizer';
import { GdtfProfile } from './types';

/**
 * Capabilities resolved from the fixture's real GDTF description (or from the
 * built-in fixture kind). Used to hide controls the fixture does not have and
 * to choose between a colour wheel and RGB mixing controls.
 */
export interface FixtureCapabilities {
  isMovingHead: boolean;
  hasPan: boolean;
  hasTilt: boolean;
  hasColorWheel: boolean;
  hasRgbMixing: boolean;
  hasDimmer: boolean;
  hasZoom: boolean;
  hasGobo: boolean;
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

// Real movement channels only — settings like "PanMode", "Pan/Tilt speed"
// and "TiltReset" must not be mistaken for a moving yoke.
const PAN_CHANNELS = new Set(['pan', 'panrotate', 'paninfinity', 'pan8bit', 'pancontrol']);
const TILT_CHANNELS = new Set(['tilt', 'tiltrotate', 'tiltinfinity', 'tilt8bit', 'tiltcontrol']);
const NON_COLOR_RGB_MODES = new Set([
  'colormixmode',
  'colormixmspeed',
  'colormixmtime',
  'colormixreset',
  'colormixcycle',
  'colorrgbquality',
]);
const BASIC_RGB = new Set(['red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'hue', 'saturation']);

const isRgbChannel = (attribute: string): boolean => {
  const key = norm(attribute);
  if (NON_COLOR_RGB_MODES.has(key)) return false;
  if (BASIC_RGB.has(key)) return true;
  if (/^(coloradd|colorsub|colorrgb)/.test(key)) {
    // "ColorAdd_G 2" normalises to coloraddg2 — still a green emitter channel.
    return /[rgbcmy]/.test(key.replace(/^(coloradd|colorsub|colorrgb)/, ''));
  }
  return false;
};

function fromGdtf(profile: GdtfProfile): FixtureCapabilities {
  const attributes = new Set<string>();
  const wheelRefs = new Set<string>(Object.keys(profile.wheels));
  for (const mode of profile.dmxModes) {
    for (const channel of mode.dmxChannels) {
      for (const logical of channel.logicalChannels) {
        attributes.add(norm(logical.attribute));
        for (const fn of logical.channelFunctions) {
          attributes.add(norm(fn.attribute));
          if (fn.wheel) wheelRefs.add(fn.wheel);
        }
      }
    }
  }

  const hasPan = [...attributes].some((a) => PAN_CHANNELS.has(a));
  const hasTilt = [...attributes].some((a) => TILT_CHANNELS.has(a));
  const hasColorWheel = [...wheelRefs].some((wheel) => /colou?r|rgb|macro/i.test(wheel));
  const hasRgbMixing = [...attributes].some(isRgbChannel);
  const hasGobo = [...wheelRefs].some((wheel) => /gobo/i.test(wheel)) ||
    [...attributes].some((a) => /^gobo/.test(a));
  const hasDimmer = attributes.has('dimmer') || attributes.has('intensity') ||
    [...attributes].some((a) => a.startsWith('dimmer'));
  const hasZoom = [...attributes].some((a) => a === 'zoom' || a.startsWith('zoom'));

  return {
    isMovingHead: hasPan || hasTilt,
    hasPan,
    hasTilt,
    hasColorWheel,
    hasRgbMixing,
    hasDimmer,
    hasZoom,
    hasGobo,
  };
}

function fromBuiltIn(obj: SceneObject): FixtureCapabilities {
  const moving = obj.kind === 'moving-head';
  const effect = obj.kind === 'co2-jet' || obj.kind === 'flame-jet';
  return {
    isMovingHead: moving,
    hasPan: moving,
    hasTilt: moving,
    hasColorWheel: false, // built-in catalog fixtures use generic RGB colour controls
    hasRgbMixing: true,
    hasDimmer: true,
    hasZoom: !effect,
    hasGobo: !effect,
  };
}

const cache = new Map<string, FixtureCapabilities>();

export function getFixtureCapabilities(
  obj: SceneObject,
  profiles: GdtfProfile[],
): FixtureCapabilities {
  if (obj.kind !== 'gdtf-fixture' || !obj.gdtfProfileId) return fromBuiltIn(obj);
  const key = obj.gdtfProfileId;
  const cached = cache.get(key);
  if (cached) return cached;
  const profile = profiles.find((p) => p.id === key);
  if (!profile) return fromBuiltIn(obj);
  const caps = fromGdtf(profile);
  cache.set(key, caps);
  return caps;
}

export interface ColorWheelSlot {
  name: string;
  hex: string;
}

/** Coloured slots of the fixture's real colour wheel, in wheel order. */
export function getColorWheelSlots(profile: GdtfProfile): ColorWheelSlot[] {
  const seen = new Set<string>();
  const slots: ColorWheelSlot[] = [];
  for (const wheel of Object.values(profile.wheels)) {
    if (!/colou?r|rgb|macro/i.test(wheel.name)) continue;
    for (const slot of wheel.slots) {
      if (!slot.color) continue;
      const hex = slot.color.toUpperCase();
      if (seen.has(hex)) continue;
      seen.add(hex);
      slots.push({ name: `${wheel.name} · ${slot.name}`, hex });
    }
  }
  return slots;
}
