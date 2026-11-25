import * as THREE from 'three';

export type CaptureMaterialCategory =
  | 'Colours'
  | 'Colours, Glossy'
  | 'Colours, Matte'
  | 'Colours, Metallic'
  | 'Construction';

export type MaterialTexturePattern =
  | 'solid-glossy'
  | 'solid-metallic'
  | 'inox'
  | 'brick-1'
  | 'brick-2'
  | 'brick-3'
  | 'brick-4'
  | 'brick-5'
  | 'brick-terracotta'
  | 'ceiling-fake'
  | 'ceiling-gypsum'
  | 'ceiling-wood'
  | 'concrete'
  | 'concrete-large'
  | 'concrete-wet'
  | 'facade-brick'
  | 'facade-concrete'
  | 'facade-metal'
  | 'road-highway'
  | 'road-single'
  | 'porcelain';

export interface CaptureMaterialDef {
  id: string;
  name: string;
  category: CaptureMaterialCategory;
  colorHex: string;
  roughness: number;
  metalness: number;
  clearcoat?: number;
  pattern?: MaterialTexturePattern;
  tileMeters?: number;
  filterTags: string[];
}

export const CAPTURE_MATERIAL_CATEGORIES: CaptureMaterialCategory[] = [
  'Colours',
  'Colours, Glossy',
  'Colours, Matte',
  'Colours, Metallic',
  'Construction',
];

const c = (id: string, name: string, colorHex: string): CaptureMaterialDef => ({
  id,
  name,
  category: 'Colours',
  colorHex,
  roughness: 0.55,
  metalness: 0.04,
  filterTags: ['Colours'],
});

const g = (id: string, name: string, colorHex: string): CaptureMaterialDef => ({
  id,
  name,
  category: 'Colours, Glossy',
  colorHex,
  roughness: 0.12,
  metalness: 0.06,
  clearcoat: 0.85,
  pattern: 'solid-glossy',
  filterTags: ['Colours, Glossy', 'Glossy'],
});

const m = (id: string, name: string, colorHex: string): CaptureMaterialDef => ({
  id,
  name,
  category: 'Colours, Matte',
  colorHex,
  roughness: 0.94,
  metalness: 0.02,
  filterTags: ['Colours, Matte', 'Matte'],
});

const met = (
  id: string,
  name: string,
  colorHex: string,
  opts?: { roughness?: number; metalness?: number; pattern?: MaterialTexturePattern },
): CaptureMaterialDef => ({
  id,
  name,
  category: 'Colours, Metallic',
  colorHex,
  roughness: opts?.roughness ?? 0.28,
  metalness: opts?.metalness ?? 0.86,
  pattern: opts?.pattern ?? 'solid-metallic',
  filterTags: ['Colours, Metallic', 'Metallic'],
});

const con = (
  id: string,
  name: string,
  colorHex: string,
  pattern: MaterialTexturePattern,
  opts: { roughness: number; metalness?: number; clearcoat?: number; tileMeters?: number; tags: string[] },
): CaptureMaterialDef => ({
  id,
  name,
  category: 'Construction',
  colorHex,
  roughness: opts.roughness,
  metalness: opts.metalness ?? 0.04,
  clearcoat: opts.clearcoat,
  pattern,
  tileMeters: opts.tileMeters ?? 2.0,
  filterTags: ['Construction', ...opts.tags],
});

export const CAPTURE_MATERIALS: CaptureMaterialDef[] = [
  // === 1. Colours ===
  c('col-black', 'Black', '#2B2B2B'),
  c('col-blue', 'Blue', '#0000FF'),
  c('col-blue-cornflower', 'Blue, Cornflower', '#6495ED'),
  c('col-blue-dark', 'Blue, Dark', '#00008B'),
  c('col-blue-light', 'Blue, Light', '#ADD8E6'),
  c('col-blue-medium', 'Blue, Medium', '#0000CD'),
  c('col-blue-midnight', 'Blue, Midnight', '#092B4A'),
  c('col-blue-slate', 'Blue, Slate', '#6A5ACD'),
  c('col-blue-slate-dark', 'Blue, Slate Dark', '#483D8B'),
  c('col-blue-slate-medium', 'Blue, Slate Medium', '#7B68EE'),
  c('col-brown', 'Brown', '#942C2C'),
  c('col-brown-saddle', 'Brown Saddle', '#8B4513'),
  c('col-coral', 'Coral', '#FF7F50'),
  c('col-cyan', 'Cyan', '#00FFFF'),
  c('col-ecru', 'Ecru', '#C2B280'),
  c('col-green', 'Green', '#00FF00'),
  c('col-green-dark', 'Green, Dark', '#005A00'),
  c('col-green-forest', 'Green, Forest', '#228B22'),
  c('col-green-light', 'Green, Light', '#90EE90'),
  c('col-grey', 'Grey', '#848484'),
  c('col-grey-dark', 'Grey, Dark', '#707070'),

  // === 2. Colours, Glossy ===
  g('gloss-black', 'Black, Gloss', '#242424'),
  g('gloss-blue-midnight', 'Blue, Midnight Gloss', '#06275E'),
  g('gloss-grey-dim', 'Grey, Dim Gloss', '#696969'),
  g('gloss-grey', 'Grey, Gloss', '#9A9A9A'),
  g('gloss-maroon', 'Maroon, Gloss', '#800000'),

  // === 3. Colours, Matte ===
  m('matte-black', 'Black, Matte', '#2C2C2C'),
  m('matte-blue-cornflower-light', 'Blue, Cornflower Light Matte', '#93C5E8'),
  m('matte-blue-midnight', 'Blue, Midnight Matte', '#06275E'),
  m('matte-green-bush', 'Green, Bush Matte', '#265E08'),
  m('matte-green-dark', 'Green, Dark Matte', '#2E7D32'),
  m('matte-grey-dim', 'Grey, Dim Matte', '#606060'),
  m('matte-grey-light', 'Grey, Light Matte', '#D3D3D3'),
  m('matte-grey', 'Grey, Matte', '#808080'),
  m('matte-grey-slate-light', 'Grey, Slate Light Matte', '#778899'),
  m('matte-haki', 'Haki, Matte', '#3B463B'),
  m('matte-red', 'Red, Matte', '#FF0000'),
  m('matte-umber-burnt', 'Umber, Burnt Matte', '#7A3229'),
  m('matte-umber-light', 'Umber, Light Matte', '#CA9E67'),
  m('matte-white', 'White, Matte', '#F2F2F2'),

  // === 4. Colours, Metallic ===
  met('met-black', 'Black, Metallic', '#2A2A2A'),
  met('met-blue', 'Blue, Metallic', '#1032C0'),
  met('met-blue-midnight', 'Blue, Midnight Metallic', '#082654'),
  met('met-flute', 'Flute, Metallic', '#9C9C9C'),
  met('met-glaoucous', 'Glaoucous, Metallic', '#5E83A8'),
  met('met-green-dark', 'Green, Dark Metallic', '#005A00'),
  met('met-grey-dark', 'Grey, Dark Metallic', '#6E6E6E'),
  met('met-grey-light', 'Grey, Light Metallic', '#D8D8D8'),
  met('met-grey', 'Grey, Metallic', '#949494'),
  met('met-grey-slate-light', 'Grey, Slate Light Metallic', '#7C8999'),
  met('met-grey-slate', 'Grey, Slate Metallic', '#5A6473'),
  met('met-haki', 'Haki, Metallic', '#3B4739'),
  met('met-inox', 'Inox', '#A8ACB0', { roughness: 0.2, metalness: 0.92, pattern: 'inox' }),
  met('met-liver-dark', 'Liver, Dark Metallic', '#4D3D2A'),
  met('met-maroon', 'Maroon, Metallic', '#800000'),
  met('met-red-cardinal', 'Red, Cardinal Metallic', '#B82032'),
  met('met-sour', 'Sour, Metallic', '#4A2128'),
  met('met-truss-legacy', 'Truss, Legacy', '#CFCFD8', { roughness: 0.26, metalness: 0.88 }),
  met('met-white-ice', 'White, Ice Metallic', '#E6E8E2'),

  // === 5. Construction ===
  con('con-brick-1', 'Brick Wall 1', '#7A2F18', 'brick-1', {
    roughness: 0.88,
    tileMeters: 1.6,
    tags: ['Brick'],
  }),
  con('con-brick-2', 'Brick Wall 2', '#944B3A', 'brick-2', {
    roughness: 0.86,
    tileMeters: 1.6,
    tags: ['Brick'],
  }),
  con('con-brick-3', 'Brick Wall 3', '#969490', 'brick-3', {
    roughness: 0.9,
    tileMeters: 1.8,
    tags: ['Brick'],
  }),
  con('con-brick-4', 'Brick Wall 4', '#A8573B', 'brick-4', {
    roughness: 0.86,
    tileMeters: 1.6,
    tags: ['Brick'],
  }),
  con('con-brick-5', 'Brick Wall 5', '#875F46', 'brick-5', {
    roughness: 0.88,
    tileMeters: 1.6,
    tags: ['Brick'],
  }),
  con('con-bricks-terracotta-1', 'Bricks Terracotta 1', '#7A3B22', 'brick-terracotta', {
    roughness: 0.84,
    tileMeters: 1.4,
    tags: ['Brick'],
  }),
  con('con-ceiling-fake', 'Ceiling Fake', '#CECECC', 'ceiling-fake', {
    roughness: 0.78,
    tileMeters: 1.2,
    tags: ['Ceiling'],
  }),
  con('con-ceiling-gypsum', 'Ceiling Gypsum', '#E4E4E2', 'ceiling-gypsum', {
    roughness: 0.9,
    tileMeters: 2.0,
    tags: ['Ceiling'],
  }),
  con('con-ceiling-wood', 'Ceiling Wood', '#6E4124', 'ceiling-wood', {
    roughness: 0.72,
    tileMeters: 1.5,
    tags: ['Ceiling'],
  }),
  con('con-concrete', 'Concrete', '#6E7274', 'concrete', {
    roughness: 0.86,
    tileMeters: 2.5,
    tags: ['Concrete'],
  }),
  con('con-concrete-large', 'Concrete Large', '#626668', 'concrete-large', {
    roughness: 0.85,
    tileMeters: 4.0,
    tags: ['Concrete'],
  }),
  con('con-concrete-wet', 'Concrete Wet', '#4D5254', 'concrete-wet', {
    roughness: 0.22,
    clearcoat: 0.45,
    tileMeters: 2.5,
    tags: ['Concrete'],
  }),
  con('con-facade-brick', 'Facade Brick', '#8B4D38', 'facade-brick', {
    roughness: 0.75,
    tileMeters: 3.5,
    tags: ['Facade', 'Brick'],
  }),
  con('con-facade-concrete', 'Facade Concrete', '#727579', 'facade-concrete', {
    roughness: 0.7,
    metalness: 0.15,
    tileMeters: 3.5,
    tags: ['Facade', 'Concrete'],
  }),
  con('con-facade-metal', 'Facade Metal', '#232832', 'facade-metal', {
    roughness: 0.35,
    metalness: 0.72,
    tileMeters: 3.5,
    tags: ['Facade', 'Metallic'],
  }),
  con('con-road-highway', 'Road Highway', '#3A3A3A', 'road-highway', {
    roughness: 0.82,
    tileMeters: 4.0,
    tags: ['Road'],
  }),
  con('con-road-single', 'Road Single Lane', '#424242', 'road-single', {
    roughness: 0.84,
    tileMeters: 3.2,
    tags: ['Road'],
  }),
  con('con-white-porcelain', 'White porcelain', '#EAEAE6', 'porcelain', {
    roughness: 0.16,
    clearcoat: 0.7,
    tileMeters: 2.0,
    tags: ['Glossy'],
  }),
];

const MATERIAL_BY_ID = new Map<string, CaptureMaterialDef>(
  CAPTURE_MATERIALS.map((mat) => [mat.id, mat]),
);

const LEGACY_PRESET_MAP: Record<string, string> = {
  'glossy-black': 'gloss-black',
  'matte-phenolic': 'matte-black',
  'metal-alu': 'met-truss-legacy',
};

export function findCaptureMaterial(idOrPreset?: string): CaptureMaterialDef | undefined {
  if (!idOrPreset) return undefined;
  const direct = MATERIAL_BY_ID.get(idOrPreset);
  if (direct) return direct;
  const mappedId = LEGACY_PRESET_MAP[idOrPreset];
  if (mappedId) return MATERIAL_BY_ID.get(mappedId);
  // Also allow lookup by case-insensitive exact name
  const lower = idOrPreset.toLowerCase();
  return CAPTURE_MATERIALS.find((m) => m.name.toLowerCase() === lower);
}

// Deterministic pseudo-random generator for crisp repeatable procedural textures
function seededNoise(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function drawBrickPattern(
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: string[],
  mortar: string,
  rows: number,
  cols: number,
  seed: number,
) {
  const rand = seededNoise(seed);
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, size, size);
  const gap = Math.max(1.5, size / 64);
  const bh = size / rows;
  const bw = size / cols;

  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 1 ? bw * 0.5 : 0;
    for (let col = -1; col <= cols; col++) {
      const x = col * bw + offset;
      const y = r * bh;
      const baseHex = palette[Math.floor(rand() * palette.length)];
      ctx.fillStyle = baseHex;
      ctx.fillRect(x + gap, y + gap, bw - gap * 2, bh - gap * 2);

      // Subtle brick grain speckling
      ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.10)';
      ctx.fillRect(x + gap, y + gap, bw - gap * 2, Math.max(1, (bh - gap * 2) * 0.35));
    }
  }
}

function drawConcretePattern(
  ctx: CanvasRenderingContext2D,
  size: number,
  baseHex: string,
  contrast: number,
  scale: number,
  seed: number,
) {
  const rand = seededNoise(seed);
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);

  const count = Math.round(140 / scale);
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rad = (8 + rand() * 34) * (size / 256) * scale;
    const dark = rand() > 0.45;
    const alpha = (0.04 + rand() * 0.08) * contrast;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, dark ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.85})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fine mineral grain
  const specks = 450;
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(rand() * size, rand() * size, 1.5, 1.5);
  }
}

function drawMaterialToCanvas(mat: CaptureMaterialDef, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const p = mat.pattern;

  if (!p || p === 'solid-glossy' || p === 'solid-metallic') {
    ctx.fillStyle = mat.colorHex;
    ctx.fillRect(0, 0, size, size);
    if (p === 'solid-glossy') {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, 'rgba(255,255,255,0.22)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.04)');
      grad.addColorStop(0.65, 'rgba(0,0,0,0.06)');
      grad.addColorStop(1, 'rgba(255,255,255,0.12)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    } else if (p === 'solid-metallic') {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, 'rgba(255,255,255,0.14)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      grad.addColorStop(1, 'rgba(0,0,0,0.14)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    return canvas;
  }

  switch (p) {
    case 'inox': {
      ctx.fillStyle = mat.colorHex;
      ctx.fillRect(0, 0, size, size);
      const rand = seededNoise(101);
      for (let y = 0; y < size; y += 2) {
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
        ctx.fillRect(0, y, size, 1);
      }
      break;
    }
    case 'brick-1':
      drawBrickPattern(ctx, size, ['#6A2410', '#7D2E15', '#5C1E0E', '#893419'], '#2A1610', 8, 4, 11);
      break;
    case 'brick-2':
      drawBrickPattern(ctx, size, ['#9A4837', '#8B3E2F', '#A75644', '#7C3628'], '#B9B2AB', 8, 4, 22);
      break;
    case 'brick-3':
      drawBrickPattern(ctx, size, ['#A4A19C', '#8C8984', '#B5B2AC', '#76736E'], '#575551', 8, 4, 33);
      break;
    case 'brick-4':
      drawBrickPattern(ctx, size, ['#B85D3E', '#9B482E', '#C46C4C', '#843B26'], '#C9B9AA', 8, 4, 44);
      break;
    case 'brick-5':
      drawBrickPattern(ctx, size, ['#8E6447', '#6E4C36', '#A37A58', '#563D2D'], '#46382E', 8, 4, 55);
      break;
    case 'brick-terracotta':
      drawBrickPattern(ctx, size, ['#7B3B21', '#884327', '#6E321B', '#91492B'], '#4A2415', 10, 5, 66);
      break;
    case 'ceiling-fake': {
      ctx.fillStyle = '#D4D4D2';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#A8A8A6';
      ctx.lineWidth = Math.max(1, size / 64);
      const step = size / 2;
      ctx.strokeRect(0, 0, step, step);
      ctx.strokeRect(step, 0, step, step);
      ctx.strokeRect(0, step, step, step);
      ctx.strokeRect(step, step, step, step);
      // Recessed diffuser squares matching screenshot
      const box = size * 0.14;
      const drawVent = (vx: number, vy: number) => {
        ctx.fillStyle = '#B8B8B6';
        ctx.fillRect(vx - box / 2, vy - box / 2, box, box);
        ctx.strokeStyle = '#888886';
        ctx.strokeRect(vx - box / 2, vy - box / 2, box, box);
      };
      drawVent(size * 0.25, size * 0.25);
      drawVent(size * 0.72, size * 0.35);
      drawVent(size * 0.3, size * 0.75);
      break;
    }
    case 'ceiling-gypsum':
      drawConcretePattern(ctx, size, '#E5E5E3', 0.3, 1.2, 77);
      break;
    case 'ceiling-wood': {
      ctx.fillStyle = '#5D341B';
      ctx.fillRect(0, 0, size, size);
      const rand = seededNoise(88);
      const slats = 8;
      const w = size / slats;
      for (let i = 0; i < slats; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#744426' : '#653A1E';
        ctx.fillRect(i * w + 1, 0, w - 2, size);
        for (let r = 0; r < 6; r++) {
          ctx.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.2)' : 'rgba(255,200,150,0.08)';
          ctx.fillRect(i * w + 1, (r * size) / 6, w - 2, 1.5);
        }
      }
      ctx.strokeStyle = '#3A1E0E';
      ctx.lineWidth = Math.max(1, size / 48);
      for (let y = 0; y <= size; y += size / 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      break;
    }
    case 'concrete':
      drawConcretePattern(ctx, size, '#6D7173', 1.0, 1.0, 99);
      break;
    case 'concrete-large':
      drawConcretePattern(ctx, size, '#636769', 0.85, 1.6, 110);
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = Math.max(1, size / 128);
      ctx.strokeRect(1, 1, size - 2, size - 2);
      break;
    case 'concrete-wet':
      drawConcretePattern(ctx, size, '#494E50', 1.75, 1.15, 121);
      break;
    case 'facade-brick': {
      ctx.fillStyle = '#8F513D';
      ctx.fillRect(0, 0, size, size);
      const cols = 4;
      const rows = 3;
      const cw = size / cols;
      const rh = size / rows;
      const rand = seededNoise(132);
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const wx = col * cw + cw * 0.16;
          const wy = r * rh + rh * 0.18;
          const ww = cw * 0.68;
          const wh = rh * 0.64;
          ctx.fillStyle = '#D5CDC6';
          ctx.fillRect(wx - 1.5, wy - 1.5, ww + 3, wh + 3);
          ctx.fillStyle = rand() > 0.65 ? '#5E534A' : '#252B33';
          ctx.fillRect(wx, wy, ww, wh);
        }
      }
      break;
    }
    case 'facade-concrete': {
      ctx.fillStyle = '#888A8E';
      ctx.fillRect(0, 0, size, size);
      const cols = 5;
      const rows = 4;
      const cw = size / cols;
      const rh = size / rows;
      const rand = seededNoise(143);
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          ctx.fillStyle = rand() > 0.7 ? '#9EA6B0' : '#3C4249';
          ctx.fillRect(col * cw + cw * 0.14, r * rh + rh * 0.18, cw * 0.72, rh * 0.62);
        }
      }
      break;
    }
    case 'facade-metal': {
      ctx.fillStyle = '#1D222B';
      ctx.fillRect(0, 0, size, size);
      const cols = 6;
      const rows = 5;
      const cw = size / cols;
      const rh = size / rows;
      const rand = seededNoise(154);
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const lit = rand();
          ctx.fillStyle = lit > 0.74 ? '#D9C08C' : lit > 0.56 ? '#6E859E' : '#131820';
          ctx.fillRect(col * cw + 2, r * rh + 2, cw - 4, rh - 4);
        }
      }
      break;
    }
    case 'road-highway': {
      drawConcretePattern(ctx, size, '#353739', 0.9, 0.7, 165);
      // Outer solid edge stripes
      ctx.fillStyle = '#D6D6D2';
      ctx.fillRect(0, size * 0.12, size, Math.max(1.5, size * 0.03));
      ctx.fillRect(0, size * 0.85, size, Math.max(1.5, size * 0.03));
      // Center dashed lane divider
      ctx.fillStyle = '#E6B84C';
      for (let x = 0; x < size; x += size * 0.28) {
        ctx.fillRect(x, size * 0.48, size * 0.16, Math.max(1.5, size * 0.04));
      }
      break;
    }
    case 'road-single': {
      drawConcretePattern(ctx, size, '#3E4042', 0.85, 0.7, 176);
      ctx.fillStyle = '#C8C8C4';
      ctx.fillRect(0, size * 0.15, size, Math.max(1.5, size * 0.035));
      ctx.fillRect(0, size * 0.82, size, Math.max(1.5, size * 0.035));
      for (let x = 0; x < size; x += size * 0.34) {
        ctx.fillRect(x, size * 0.49, size * 0.18, Math.max(1.5, size * 0.035));
      }
      break;
    }
    case 'porcelain': {
      ctx.fillStyle = '#ECECE8';
      ctx.fillRect(0, 0, size, size);
      const grad = ctx.createRadialGradient(size * 0.3, size * 0.3, 0, size * 0.5, size * 0.5, size * 0.8);
      grad.addColorStop(0, 'rgba(255,255,255,0.4)');
      grad.addColorStop(1, 'rgba(200,200,196,0.18)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      break;
    }
  }

  return canvas;
}

const previewUrlCache = new Map<string, string>();
const textureCache = new Map<string, THREE.CanvasTexture>();

export function getMaterialPreviewUrl(mat: CaptureMaterialDef): string {
  const cached = previewUrlCache.get(mat.id);
  if (cached) return cached;
  const canvas = drawMaterialToCanvas(mat, 48);
  const url = canvas.toDataURL('image/png');
  previewUrlCache.set(mat.id, url);
  return url;
}

function getBaseTexture(mat: CaptureMaterialDef): THREE.CanvasTexture | null {
  if (!mat.pattern || mat.pattern === 'solid-glossy' || mat.pattern === 'solid-metallic') {
    return null;
  }
  const existing = textureCache.get(mat.id);
  if (existing) return existing;
  const canvas = drawMaterialToCanvas(mat, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  textureCache.set(mat.id, tex);
  return tex;
}

export function buildCaptureMeshMaterial(
  materialPreset: string | undefined,
  fallback: {
    color: number;
    roughness: number;
    metalness: number;
    map?: THREE.Texture | null;
  },
  spanX: number,
  spanZ: number,
  isSelected: boolean,
): THREE.Material {
  const matDef = findCaptureMaterial(materialPreset);
  if (!matDef) {
    return new THREE.MeshStandardMaterial({
      color: isSelected ? 0x5c2320 : fallback.color,
      map: fallback.map ?? null,
      roughness: fallback.roughness,
      metalness: fallback.metalness,
    });
  }

  const baseTex = getBaseTexture(matDef);
  let map: THREE.Texture | null = null;
  if (baseTex) {
    const tileM = matDef.tileMeters ?? 2.0;
    map = baseTex.clone();
    map.repeat.set(Math.max(1, spanX / tileM), Math.max(1, spanZ / tileM));
    map.needsUpdate = true;
  }

  const baseColor = new THREE.Color(map ? '#FFFFFF' : matDef.colorHex);
  if (isSelected) {
    baseColor.lerp(new THREE.Color(0x8b2c25), 0.55);
  }

  if (matDef.clearcoat && matDef.clearcoat > 0) {
    return new THREE.MeshPhysicalMaterial({
      color: baseColor,
      map,
      roughness: matDef.roughness,
      metalness: matDef.metalness,
      clearcoat: matDef.clearcoat,
      clearcoatRoughness: Math.max(0.05, matDef.roughness * 0.6),
    });
  }

  return new THREE.MeshStandardMaterial({
    color: baseColor,
    map,
    roughness: matDef.roughness,
    metalness: matDef.metalness,
  });
}
