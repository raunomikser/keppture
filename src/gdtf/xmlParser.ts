import * as THREE from 'three';
import {
  GdtfActivationGroup,
  GdtfAttributeDef,
  GdtfChannelFunction,
  GdtfChannelSet,
  GdtfDmxChannel,
  GdtfDmxMode,
  GdtfFeatureGroup,
  GdtfFixtureMetadata,
  GdtfGeometryNode,
  GdtfGeometryType,
  GdtfLogicalChannel,
  GdtfModelDef,
  GdtfProfile,
  GdtfWheel,
  GdtfWheelSlot,
} from './types';

/**
 * Parse GDTF DMXValue strings like "128/1", "32768/2", "0/1", or plain numbers
 * scaled to the channel's target byte count.
 */
export function parseGdtfDmxValue(rawStr: string | null, byteCount: number): number {
  if (!rawStr) return 0;
  const trimmed = rawStr.trim();
  const slashIdx = trimmed.indexOf('/');
  const targetBytes = Math.max(1, Math.min(3, byteCount));
  const targetMax = Math.pow(256, targetBytes) - 1;

  if (slashIdx === -1) {
    const val = Number(trimmed);
    return Number.isFinite(val) ? val : 0;
  }

  const val = Number(trimmed.slice(0, slashIdx));
  const srcBytes = Math.max(1, Number(trimmed.slice(slashIdx + 1)) || 1);
  if (!Number.isFinite(val)) return 0;

  if (srcBytes === targetBytes) return val;
  const srcMax = Math.pow(256, srcBytes) - 1;
  return Math.round((val / srcMax) * targetMax);
}

/**
 * Parse GDTF 4x4 affine transformation matrix string:
 * "{m00,m01,m02,m03}{m10,m11,m12,m13}{m20,m21,m22,m23}{m30,m31,m32,m33}"
 * GDTF stores row-major 4x4 matrices; THREE.Matrix4.set() takes row-major arguments
 * and stores column-major internally in .elements.
 */
export function parseGdtfMatrix(posStr: string | null): number[] {
  const mat = new THREE.Matrix4();
  if (!posStr) return mat.elements.slice();

  const rows = posStr.match(/\{([^}]+)\}/g);
  if (rows && rows.length === 4) {
    const nums: number[] = [];
    for (const r of rows) {
      const parts = r
        .slice(1, -1)
        .split(',')
        .map((n) => Number(n.trim()));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        nums.push(...parts);
      }
    }
    if (nums.length === 16) {
      mat.set(
        nums[0], nums[1], nums[2], nums[3],
        nums[4], nums[5], nums[6], nums[7],
        nums[8], nums[9], nums[10], nums[11],
        nums[12], nums[13], nums[14], nums[15],
      );
      return mat.elements.slice();
    }
  }

  // Fallback for shorthand "{x,y,z}" translation
  const vecMatch = posStr.match(/\{([^}]+)\}/);
  if (vecMatch) {
    const parts = vecMatch[1].split(',').map((n) => Number(n.trim()));
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      mat.makeTranslation(parts[0], parts[1], parts[2]);
    }
  }

  return mat.elements.slice();
}

const GEOMETRY_TAG_TYPES = new Set<GdtfGeometryType>([
  'Geometry',
  'Axis',
  'Beam',
  'FilterBeam',
  'FilterColor',
  'FilterGobo',
  'FilterShaper',
  'Scanner',
  'Laser',
  'GeometryReference',
]);

let geoNodeSeq = 1;

function parseGeometryElement(el: Element): GdtfGeometryNode {
  const tag = el.tagName as GdtfGeometryType;
  const type: GdtfGeometryType = GEOMETRY_TAG_TYPES.has(tag) ? tag : 'Geometry';
  const name = el.getAttribute('Name') || `${type}_${geoNodeSeq}`;
  const model = el.getAttribute('Model') || undefined;
  const matrix = parseGdtfMatrix(el.getAttribute('Position'));

  const children: GdtfGeometryNode[] = [];
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    if (GEOMETRY_TAG_TYPES.has(child.tagName as GdtfGeometryType)) {
      children.push(parseGeometryElement(child));
    }
  }

  return {
    id: `gnode-${geoNodeSeq++}-${name}`,
    type,
    name,
    model,
    matrix,
    beamType: el.getAttribute('BeamType') || undefined,
    beamAngle: el.getAttribute('BeamAngle') ? Number(el.getAttribute('BeamAngle')) : undefined,
    fieldAngle: el.getAttribute('FieldAngle') ? Number(el.getAttribute('FieldAngle')) : undefined,
    beamRadius: el.getAttribute('BeamRadius') ? Number(el.getAttribute('BeamRadius')) : undefined,
    luminousFlux: el.getAttribute('LuminousFlux') ? Number(el.getAttribute('LuminousFlux')) : undefined,
    colorTemperature: el.getAttribute('ColorTemperature')
      ? Number(el.getAttribute('ColorTemperature'))
      : undefined,
    powerConsumption: el.getAttribute('PowerConsumption')
      ? Number(el.getAttribute('PowerConsumption'))
      : undefined,
    referencedGeometry: el.getAttribute('Geometry') || undefined,
    children,
  };
}

function parseCieColorToHex(cieStr: string | null): string | undefined {
  if (!cieStr) return undefined;
  const parts = cieStr.split(',').map((s) => Number(s.trim()));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [x, y, Y] = parts;
  if (y <= 0.0001) return '#ffffff';
  const scale = Math.min(1, Math.max(0.1, Y / 100));
  const X = (x * scale) / y;
  const Z = ((1 - x - y) * scale) / y;
  const rLin = 3.2406 * X - 1.5372 * scale - 0.4986 * Z;
  const gLin = -0.9689 * X + 1.8758 * scale + 0.0415 * Z;
  const bLin = 0.0557 * X - 0.2040 * scale + 1.0570 * Z;
  const toByte = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    const srgb = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  };
  const r = toByte(rLin);
  const g = toByte(gLin);
  const b = toByte(bLin);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function parseGdtfDescriptionXml(
  xmlText: string,
  sourceFileName: string,
  vfsFiles: string[],
): GdtfProfile {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    throw new Error(`Invalid description.xml: ${parseErr.textContent?.slice(0, 140) || 'XML parse error'}`);
  }

  const fixtureEl = doc.querySelector('GDTF > FixtureType') || doc.querySelector('FixtureType');
  if (!fixtureEl) {
    throw new Error('Missing <FixtureType> element in GDTF description.xml');
  }

  // A. Fixture Metadata & Protocols
  const metadata: GdtfFixtureMetadata = {
    name: fixtureEl.getAttribute('Name') || sourceFileName.replace(/\.gdtf$/i, ''),
    longName: fixtureEl.getAttribute('LongName') || fixtureEl.getAttribute('Name') || 'GDTF Fixture',
    shortName: fixtureEl.getAttribute('ShortName') || '',
    manufacturer: fixtureEl.getAttribute('Manufacturer') || 'Unknown Manufacturer',
    description: fixtureEl.getAttribute('Description') || '',
    fixtureTypeId:
      fixtureEl.getAttribute('FixtureTypeID') ||
      `gdtf-${sourceFileName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
    refFTES: fixtureEl.getAttribute('RefFTES') || fixtureEl.getAttribute('RefFT') || '',
    thumbnail: fixtureEl.getAttribute('Thumbnail') || undefined,
  };

  // B. Attribute Definitions & Feature Groups
  const activationGroups: GdtfActivationGroup[] = [];
  fixtureEl.querySelectorAll('AttributeDefinitions > ActivationGroups > ActivationGroup').forEach((el) => {
    const name = el.getAttribute('Name');
    if (name) activationGroups.push({ name });
  });

  const featureGroups: GdtfFeatureGroup[] = [];
  fixtureEl.querySelectorAll('AttributeDefinitions > FeatureGroups > FeatureGroup').forEach((fgEl) => {
    const name = fgEl.getAttribute('Name') || '';
    const pretty = fgEl.getAttribute('Pretty') || name;
    const features: Array<{ name: string }> = [];
    fgEl.querySelectorAll(':scope > Feature').forEach((fEl) => {
      const fName = fEl.getAttribute('Name');
      if (fName) features.push({ name: fName });
    });
    if (name) featureGroups.push({ name, pretty, features });
  });

  const attributes: Record<string, GdtfAttributeDef> = {};
  fixtureEl.querySelectorAll('AttributeDefinitions > Attributes > Attribute').forEach((attrEl) => {
    const name = attrEl.getAttribute('Name');
    if (!name) return;
    attributes[name] = {
      name,
      pretty: attrEl.getAttribute('Pretty') || name,
      activationGroup: attrEl.getAttribute('ActivationGroup') || undefined,
      feature: attrEl.getAttribute('Feature') || undefined,
      physicalUnit: attrEl.getAttribute('PhysicalUnit') || undefined,
      color: parseCieColorToHex(attrEl.getAttribute('Color')),
    };
  });

  // Models
  const models: Record<string, GdtfModelDef> = {};
  fixtureEl.querySelectorAll('Models > Model').forEach((mEl) => {
    const name = mEl.getAttribute('Name');
    if (!name) return;
    models[name] = {
      name,
      file: mEl.getAttribute('File') || undefined,
      primitiveType: mEl.getAttribute('PrimitiveType') || 'Undefined',
      length: Number(mEl.getAttribute('Length')) || 0.3,
      width: Number(mEl.getAttribute('Width')) || 0.3,
      height: Number(mEl.getAttribute('Height')) || 0.3,
    };
  });

  // Wheels (Gobos & Color Slots)
  const wheels: Record<string, GdtfWheel> = {};
  fixtureEl.querySelectorAll('Wheels > Wheel').forEach((wEl) => {
    const name = wEl.getAttribute('Name');
    if (!name) return;
    const slots: GdtfWheelSlot[] = [];
    wEl.querySelectorAll(':scope > Slot').forEach((sEl) => {
      slots.push({
        name: sEl.getAttribute('Name') || `Slot ${slots.length + 1}`,
        color: parseCieColorToHex(sEl.getAttribute('Color')),
        mediaFileName: sEl.getAttribute('MediaFileName') || undefined,
      });
    });
    wheels[name] = { name, slots };
  });

  // C. Geometries Hierarchy
  geoNodeSeq = 1;
  const geometries: GdtfGeometryNode[] = [];
  const geoRoot = fixtureEl.querySelector(':scope > Geometries');
  if (geoRoot) {
    for (let i = 0; i < geoRoot.children.length; i++) {
      const child = geoRoot.children[i];
      if (GEOMETRY_TAG_TYPES.has(child.tagName as GdtfGeometryType)) {
        geometries.push(parseGeometryElement(child));
      }
    }
  }

  // D. DMX Modes & Channel Footprints
  const dmxModes: GdtfDmxMode[] = [];
  fixtureEl.querySelectorAll('DMXModes > DMXMode').forEach((modeEl) => {
    const modeName = modeEl.getAttribute('Name') || `Mode ${dmxModes.length + 1}`;
    const modeGeometry = modeEl.getAttribute('Geometry') || geometries[0]?.name || 'Base';
    const dmxChannels: GdtfDmxChannel[] = [];
    let maxOffset = 0;

    modeEl.querySelectorAll(':scope > DMXChannels > DMXChannel').forEach((chEl) => {
      const dmxBreak = Number(chEl.getAttribute('DMXBreak')) || 1;
      const offsetStr = chEl.getAttribute('Offset') || '';
      const offset = offsetStr
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      for (const o of offset) {
        if (o > maxOffset) maxOffset = o;
      }
      const byteCount = Math.max(1, offset.length);
      const geometry = chEl.getAttribute('Geometry') || modeGeometry;
      const defaultAttr = chEl.getAttribute('Default');

      const logicalChannels: GdtfLogicalChannel[] = [];
      chEl.querySelectorAll(':scope > LogicalChannel').forEach((lcEl) => {
        const lcAttribute = lcEl.getAttribute('Attribute') || 'Dimmer';
        const channelFunctions: GdtfChannelFunction[] = [];
        const lcDefaultRaw = parseGdtfDmxValue(lcEl.getAttribute('Default'), byteCount);

        const cfNodes = Array.from(lcEl.querySelectorAll(':scope > ChannelFunction'));
        cfNodes.forEach((cfEl, idx) => {
          const dmxFrom = parseGdtfDmxValue(cfEl.getAttribute('DMXFrom'), byteCount);
          const nextCf = cfNodes[idx + 1];
          const maxRaw = Math.pow(256, byteCount) - 1;
          const dmxTo = nextCf
            ? Math.max(dmxFrom, parseGdtfDmxValue(nextCf.getAttribute('DMXFrom'), byteCount) - 1)
            : maxRaw;

          const cfDefaultRaw = cfEl.getAttribute('Default')
            ? parseGdtfDmxValue(cfEl.getAttribute('Default'), byteCount)
            : lcDefaultRaw;

          const channelSets: GdtfChannelSet[] = [];
          cfEl.querySelectorAll(':scope > ChannelSet').forEach((csEl) => {
            channelSets.push({
              name: csEl.getAttribute('Name') || '',
              dmxFrom: parseGdtfDmxValue(csEl.getAttribute('DMXFrom'), byteCount),
              physicalFrom: csEl.getAttribute('PhysicalFrom')
                ? Number(csEl.getAttribute('PhysicalFrom'))
                : undefined,
              physicalTo: csEl.getAttribute('PhysicalTo')
                ? Number(csEl.getAttribute('PhysicalTo'))
                : undefined,
              wheelSlotIndex: csEl.getAttribute('WheelSlotIndex')
                ? Number(csEl.getAttribute('WheelSlotIndex'))
                : undefined,
            });
          });

          channelFunctions.push({
            name: cfEl.getAttribute('Name') || cfEl.getAttribute('Attribute') || lcAttribute,
            attribute: cfEl.getAttribute('Attribute') || lcAttribute,
            originalAttribute: cfEl.getAttribute('OriginalAttribute') || undefined,
            dmxFrom,
            dmxTo,
            defaultRaw: cfDefaultRaw,
            physicalFrom: Number(cfEl.getAttribute('PhysicalFrom')) || 0,
            physicalTo:
              cfEl.getAttribute('PhysicalTo') !== null
                ? Number(cfEl.getAttribute('PhysicalTo'))
                : 1,
            realFade: cfEl.getAttribute('RealFade') ? Number(cfEl.getAttribute('RealFade')) : undefined,
            wheel: cfEl.getAttribute('Wheel') || undefined,
            modeMaster: cfEl.getAttribute('ModeMaster') || undefined,
            modeFrom: cfEl.getAttribute('ModeFrom')
              ? parseGdtfDmxValue(cfEl.getAttribute('ModeFrom'), 1)
              : undefined,
            modeTo: cfEl.getAttribute('ModeTo')
              ? parseGdtfDmxValue(cfEl.getAttribute('ModeTo'), 1)
              : undefined,
            channelSets,
          });
        });

        logicalChannels.push({
          attribute: lcAttribute,
          snap: lcEl.getAttribute('Snap') || undefined,
          master: lcEl.getAttribute('Master') || undefined,
          channelFunctions,
        });
      });

      const firstCfDefault = logicalChannels[0]?.channelFunctions[0]?.defaultRaw ?? 0;
      const defaultRaw = defaultAttr
        ? parseGdtfDmxValue(defaultAttr, byteCount)
        : firstCfDefault;

      if (offset.length > 0) {
        dmxChannels.push({
          dmxBreak,
          offset,
          defaultRaw,
          initialFunction: chEl.getAttribute('InitialFunction') || undefined,
          geometry,
          logicalChannels,
        });
      }
    });

    dmxModes.push({
      name: modeName,
      geometry: modeGeometry,
      footprint: Math.max(1, maxOffset),
      dmxChannels,
    });
  });

  return {
    id: metadata.fixtureTypeId,
    sourceFileName,
    metadata,
    activationGroups,
    featureGroups,
    attributes,
    models,
    wheels,
    geometries,
    dmxModes,
    vfsFiles,
    createdAt: Date.now(),
  };
}
