import { GdtfChannelFunction, GdtfDmxChannel, GdtfProfile, ResolvedGdtfState } from './types';

export type DmxUniversesMap = Record<number, Uint8Array>;

export function createInitialDmxUniverses(): DmxUniversesMap {
  return {
    1: new Uint8Array(512),
    2: new Uint8Array(512),
    3: new Uint8Array(512),
    4: new Uint8Array(512),
  };
}

/**
 * Read multi-byte (8-bit, 16-bit, 24-bit) DMX value from a 512-channel universe buffer.
 * GDTF offsets are 1-based relative to the fixture's base DMX address.
 */
export function readDmxRawValue(
  buffer: Uint8Array,
  baseAddress1Based: number,
  offsets: number[],
): number {
  let raw = 0;
  for (const off of offsets) {
    const idx = baseAddress1Based - 1 + (off - 1);
    const byteVal = idx >= 0 && idx < 512 ? buffer[idx] : 0;
    raw = (raw << 8) | byteVal;
  }
  return raw;
}

/**
 * Write an 8-bit, 16-bit, or 24-bit raw integer into a 512-channel universe buffer.
 */
export function writeDmxRawValue(
  buffer: Uint8Array,
  baseAddress1Based: number,
  offsets: number[],
  rawValue: number,
): void {
  const byteCount = offsets.length;
  const maxVal = Math.pow(256, byteCount) - 1;
  const clamped = Math.max(0, Math.min(maxVal, Math.round(rawValue)));
  for (let i = 0; i < byteCount; i++) {
    const shift = (byteCount - 1 - i) * 8;
    const byteVal = (clamped >> shift) & 0xff;
    const idx = baseAddress1Based - 1 + (offsets[i] - 1);
    if (idx >= 0 && idx < 512) {
      buffer[idx] = byteVal;
    }
  }
}

function findActiveChannelFunction(
  channel: GdtfDmxChannel,
  raw: number,
): GdtfChannelFunction | undefined {
  for (const lc of channel.logicalChannels) {
    for (const cf of lc.channelFunctions) {
      if (raw >= cf.dmxFrom && raw <= cf.dmxTo) {
        return cf;
      }
    }
  }
  return channel.logicalChannels[0]?.channelFunctions[0];
}

function interpolateChannelFunction(cf: GdtfChannelFunction, raw: number): number {
  const span = cf.dmxTo - cf.dmxFrom;
  if (span <= 0) return cf.physicalFrom;
  const t = Math.max(0, Math.min(1, (raw - cf.dmxFrom) / span));
  return cf.physicalFrom + t * (cf.physicalTo - cf.physicalFrom);
}

/**
 * Write all default channel values from the active DMX mode into the universe buffer.
 */
export function writeGdtfDefaultsToBuffer(
  profile: GdtfProfile,
  modeName: string,
  buffer: Uint8Array,
  baseAddress1Based: number,
): void {
  const mode = profile.dmxModes.find((m) => m.name === modeName) ?? profile.dmxModes[0];
  if (!mode) return;
  for (const ch of mode.dmxChannels) {
    writeDmxRawValue(buffer, baseAddress1Based, ch.offset, ch.defaultRaw);
  }
}

/**
 * Resolve incoming 512-channel DMX bytes into real-world physical attributes
 * (Pan degrees, Tilt degrees, Dimmer %, RGB/CMY Color, Gobo Wheel Slot, Beam Zoom, Shutter).
 */
export function resolveGdtfDmxState(
  profile: GdtfProfile,
  modeName: string | undefined,
  buffer: Uint8Array,
  baseAddress1Based: number,
  fallback?: Partial<ResolvedGdtfState>,
): ResolvedGdtfState {
  const mode =
    (modeName ? profile.dmxModes.find((m) => m.name === modeName) : undefined) ??
    profile.dmxModes[0];

  let dimmer = fallback?.dimmer ?? 0.85;
  let panDeg = fallback?.panDeg ?? 0;
  let tiltDeg = fallback?.tiltDeg ?? 25;
  let beamAngleDeg = fallback?.beamAngleDeg ?? 20;
  let focus = 0.5;
  let shutterOpen = true;
  let strobeHz = 0;
  let goboSlotName = 'Open';
  let goboMediaFile: string | undefined;

  let hasRgb = false;
  let r = 1;
  let g = 1;
  let b = 1;
  let hasCmy = false;
  let c = 0;
  let m = 0;
  let y = 0;
  let wheelColorHex: string | undefined;

  if (!mode) {
    return {
      dimmer,
      panDeg,
      tiltDeg,
      colorHex: fallback?.colorHex ?? '#ffffff',
      beamAngleDeg,
      focus,
      shutterOpen,
      strobeHz,
      goboSlotName,
      zoomDeg: beamAngleDeg,
    };
  }

  for (const ch of mode.dmxChannels) {
    const raw = readDmxRawValue(buffer, baseAddress1Based, ch.offset);
    const cf = findActiveChannelFunction(ch, raw);
    if (!cf) continue;

    const attr = cf.attribute;
    const phys = interpolateChannelFunction(cf, raw);

    if (attr === 'Dimmer') {
      const maxP = Math.max(Math.abs(cf.physicalTo), Math.abs(cf.physicalFrom));
      dimmer = maxP > 1.5 ? Math.max(0, Math.min(1, phys / 100)) : Math.max(0, Math.min(1, phys));
    } else if (attr === 'Pan') {
      panDeg = phys;
    } else if (attr === 'Tilt') {
      tiltDeg = phys;
    } else if (attr === 'Zoom') {
      beamAngleDeg = Math.max(4, Math.min(70, phys));
    } else if (attr === 'Focus1' || attr === 'Focus') {
      focus = phys > 1.5 ? phys / 100 : phys;
    } else if (attr === 'ColorAdd_R' || attr === 'ColorRGB_Red') {
      hasRgb = true;
      r = Math.abs(cf.physicalTo) > 1.5 ? phys / 100 : phys;
    } else if (attr === 'ColorAdd_G' || attr === 'ColorRGB_Green') {
      hasRgb = true;
      g = Math.abs(cf.physicalTo) > 1.5 ? phys / 100 : phys;
    } else if (attr === 'ColorAdd_B' || attr === 'ColorRGB_Blue') {
      hasRgb = true;
      b = Math.abs(cf.physicalTo) > 1.5 ? phys / 100 : phys;
    } else if (attr === 'ColorSub_C') {
      hasCmy = true;
      c = Math.abs(cf.physicalTo) > 1.5 ? phys / 100 : phys;
    } else if (attr === 'ColorSub_M') {
      hasCmy = true;
      m = Math.abs(cf.physicalTo) > 1.5 ? phys / 100 : phys;
    } else if (attr === 'ColorSub_Y') {
      hasCmy = true;
      y = Math.abs(cf.physicalTo) > 1.5 ? phys / 100 : phys;
    } else if (attr.startsWith('Gobo') && cf.wheel) {
      const wheel = profile.wheels[cf.wheel];
      if (wheel && wheel.slots.length > 0) {
        let slotIdx = Math.round(phys);
        if (cf.channelSets.length > 0) {
          let activeSet = cf.channelSets[0];
          for (const cs of cf.channelSets) {
            if (raw >= cs.dmxFrom) activeSet = cs;
          }
          if (activeSet.wheelSlotIndex !== undefined) {
            slotIdx = activeSet.wheelSlotIndex - 1;
          }
        }
        const slot = wheel.slots[Math.max(0, Math.min(wheel.slots.length - 1, slotIdx))];
        if (slot) {
          goboSlotName = slot.name;
          goboMediaFile = slot.mediaFileName;
        }
      }
    } else if ((attr === 'Color1' || attr === 'ColorMacro1') && cf.wheel) {
      const wheel = profile.wheels[cf.wheel];
      if (wheel && wheel.slots.length > 0) {
        const slotIdx = Math.max(0, Math.min(wheel.slots.length - 1, Math.round(phys)));
        wheelColorHex = wheel.slots[slotIdx]?.color;
      }
    } else if (attr === 'Shutter1' || attr === 'Shutter') {
      const lowerName = cf.name.toLowerCase();
      if (lowerName.includes('close')) {
        shutterOpen = false;
        strobeHz = 0;
      } else if (lowerName.includes('strobe') || lowerName.includes('pulse')) {
        shutterOpen = true;
        strobeHz = Math.max(1, phys);
      } else {
        shutterOpen = true;
        strobeHz = 0;
      }
    }
  }

  let colorHex = fallback?.colorHex ?? '#ffffff';
  if (hasRgb) {
    const toHex = (v: number) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0');
    colorHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  } else if (hasCmy) {
    const toHex = (v: number) =>
      Math.round(Math.max(0, Math.min(1, 1 - v)) * 255)
        .toString(16)
        .padStart(2, '0');
    colorHex = `#${toHex(c)}${toHex(m)}${toHex(y)}`;
  } else if (wheelColorHex) {
    colorHex = wheelColorHex;
  }

  return {
    dimmer: shutterOpen ? dimmer : 0,
    panDeg,
    tiltDeg,
    colorHex,
    beamAngleDeg,
    focus,
    shutterOpen,
    strobeHz,
    goboSlotName,
    goboMediaFile,
    zoomDeg: beamAngleDeg,
  };
}
