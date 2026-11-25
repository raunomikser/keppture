import React, { useState } from 'react';
import {
  AspectMaskingOption,
  AspectRatioOption,
  CustomFaceStyle,
  CustomModelSpace,
  LayerItem,
  RenderMode,
  ViewportId,
  ViewportSettings,
} from '../types/visualizer';

interface ViewsInspectorTableProps {
  viewports: Record<ViewportId, ViewportSettings>;
  layers: LayerItem[];
  onUpdateViewport: (id: ViewportId, patch: Partial<ViewportSettings>) => void;
}

const VIEWPORT_IDS: ViewportId[] = ['alpha', 'beta', 'gamma'];

type SectionKey = 'view' | 'camera' | 'environment' | 'lens' | 'image';

export const ViewsInspectorTable: React.FC<ViewsInspectorTableProps> = ({
  viewports,
  layers,
  onUpdateViewport,
}) => {
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    view: false,
    camera: false,
    environment: false,
    lens: false,
    image: false,
  });

  const toggleSection = (key: SectionKey) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderSectionHeader = (key: SectionKey, title: string) => (
    <tr className="bg-[#313131] border-y border-[#2A3A54]">
      <td colSpan={4} className="p-0">
        <button
          type="button"
          onClick={() => toggleSection(key)}
          className="w-full px-2 py-[3px] flex items-center gap-1.5 text-left text-[11px] font-semibold text-[#EDF2F8] hover:bg-[#3B4D69] cursor-pointer"
        >
          <span className="text-[9px] text-[#B2BECE] w-3">
            {collapsed[key] ? '▸' : '▾'}
          </span>
          <span>{title}</span>
        </button>
      </td>
    </tr>
  );

  const cellCls = 'px-1.5 py-[2px] border-l border-[#1A2740] bg-[#1B2940] align-middle';
  const selectCls =
    'w-full h-[18px] px-1 bg-[#25344E] border border-[#1A2740] text-[10px] text-[#F5F8FC] focus:outline-none focus:border-[#857431] cursor-pointer';
  const numInputCls =
    'w-full h-[18px] px-1 bg-[#25344E] border border-[#1A2740] text-[10px] text-[#F5F8FC] tabular-nums text-right focus:outline-none focus:border-[#857431]';

  return (
    <div className="w-full overflow-x-auto capture-scroll border border-[#2A3A54] bg-[#172236]">
      <table className="w-full min-w-[430px] border-collapse text-[10px] leading-tight">
        <thead className="sticky top-0 z-10 bg-[#2D2D2D] border-b border-[#2A3A54]">
          <tr>
            <th className="w-[146px] min-w-[136px] px-2 py-[4px] text-left font-medium text-[#D7E0EE]">
              Property
            </th>
            {VIEWPORT_IDS.map((vpId) => (
              <th
                key={vpId}
                className="px-1.5 py-[4px] text-left font-semibold text-[#F5F8FC] border-l border-[#2A3A54] whitespace-nowrap"
              >
                {viewports[vpId].title}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {/* 1. View Settings */}
          {renderSectionHeader('view', 'View Settings')}
          {!collapsed.view && (
            <>
              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Render Mode</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <select
                        value={vp.renderMode}
                        onChange={(e) =>
                          onUpdateViewport(vpId, { renderMode: e.target.value as RenderMode })
                        }
                        className={selectCls}
                      >
                        <option value="wireframe">Wireframe</option>
                        <option value="plot">Plot</option>
                        <option value="live">Live</option>
                        <option value="custom">Custom</option>
                      </select>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Custom Projection</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  const val = vp.projection === 'Perspective' ? 'Perspective' : 'Orthographic';
                  return (
                    <td key={vpId} className={cellCls}>
                      <select
                        value={val}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (next === 'Perspective') {
                            onUpdateViewport(vpId, {
                              lastOrthoProjection:
                                vp.projection !== 'Perspective'
                                  ? vp.projection
                                  : vp.lastOrthoProjection ?? 'Top',
                              projection: 'Perspective',
                            });
                          } else {
                            onUpdateViewport(vpId, {
                              projection:
                                vp.lastOrthoProjection ??
                                (vpId === 'alpha' ? 'Top' : vpId === 'beta' ? 'Front' : 'Right'),
                            });
                          }
                        }}
                        className={selectCls}
                      >
                        <option value="Perspective">Perspective</option>
                        <option value="Orthographic">Orthographic</option>
                      </select>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Custom Face Style</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  const faceStyle: CustomFaceStyle = vp.customFaceStyle ?? 'Solid';
                  return (
                    <td key={vpId} className={cellCls}>
                      <select
                        value={faceStyle}
                        onChange={(e) => {
                          const style = e.target.value as CustomFaceStyle;
                          onUpdateViewport(vpId, {
                            customFaceStyle: style,
                            renderMode: 'custom',
                          });
                        }}
                        className={selectCls}
                      >
                        <option value="Solid">Solid</option>
                        <option value="Wireframe">Wireframe</option>
                        <option value="Plot">Plot</option>
                      </select>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Wireframe Overlay</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  const overlayEnabled = vp.customWireframeOverlay ?? true;
                  return (
                    <td key={vpId} className={cellCls}>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateViewport(vpId, {
                            customWireframeOverlay: !overlayEnabled,
                            renderMode: 'custom',
                          })
                        }
                        className={`w-full h-[18px] px-1.5 border border-[#1A2740] text-left text-[10px] cursor-pointer ${
                          overlayEnabled
                            ? 'bg-[#3B6E1C] text-[#F5F8FC]'
                            : 'bg-[#25344E] text-[#CBD5E1]'
                        }`}
                      >
                        {overlayEnabled ? 'Yes' : 'No'}
                      </button>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Isolate Layer</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <select
                        value={vp.customIsolatedLayerId ?? 'all'}
                        onChange={(e) =>
                          onUpdateViewport(vpId, {
                            customIsolatedLayerId: e.target.value,
                            renderMode: 'custom',
                          })
                        }
                        className={selectCls}
                      >
                        <option value="all">All Layers</option>
                        {layers.map((layer) => (
                          <option key={layer.id} value={layer.id}>
                            {layer.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Custom Model Space</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <select
                        value={vp.customModelSpace}
                        onChange={(e) =>
                          onUpdateViewport(vpId, {
                            customModelSpace: e.target.value as CustomModelSpace,
                          })
                        }
                        className={selectCls}
                      >
                        <option value="World">World</option>
                        <option value="Screen">Screen</option>
                      </select>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Grid Width</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0.25}
                          max={10}
                          step={0.25}
                          value={vp.gridWidth}
                          onChange={(e) =>
                            onUpdateViewport(vpId, {
                              gridWidth: Math.max(0.25, Math.min(10, Number(e.target.value) || 1)),
                            })
                          }
                          className={numInputCls}
                        />
                        <span className="text-[#A8B5CB] text-[10px]">m</span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Grid Height</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0.25}
                          max={10}
                          step={0.25}
                          value={vp.gridHeight}
                          onChange={(e) =>
                            onUpdateViewport(vpId, {
                              gridHeight: Math.max(0.25, Math.min(10, Number(e.target.value) || 1)),
                            })
                          }
                          className={numInputCls}
                        />
                        <span className="text-[#A8B5CB] text-[10px]">m</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </>
          )}

          {/* 2. Camera Settings */}
          {renderSectionHeader('camera', 'Camera Settings')}
          {!collapsed.camera && (
            <>
              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Field of View (Vertical)</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={15}
                          max={100}
                          step={0.5}
                          value={vp.fov}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { fov: Number(e.target.value) })
                          }
                          className="w-12 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[28px] text-right">
                          {vp.fov}°
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Aspect Ratio</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <select
                        value={vp.aspectRatio}
                        onChange={(e) =>
                          onUpdateViewport(vpId, {
                            aspectRatio: e.target.value as AspectRatioOption,
                          })
                        }
                        className={selectCls}
                      >
                        <option value="View Controlled">View Controlled</option>
                        <option value="16:9">16:9</option>
                        <option value="4:3">4:3</option>
                        <option value="1:1">1:1</option>
                        <option value="21:9">21:9</option>
                      </select>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Aspect Ratio Masking</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <select
                        value={vp.aspectMasking}
                        onChange={(e) =>
                          onUpdateViewport(vpId, {
                            aspectMasking: e.target.value as AspectMaskingOption,
                          })
                        }
                        className={selectCls}
                      >
                        <option value="Transparent">Transparent</option>
                        <option value="Opaque">Opaque</option>
                        <option value="Black">Black</option>
                      </select>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">White Balance</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={2000}
                          max={10000}
                          step={100}
                          value={vp.whiteBalance}
                          onChange={(e) =>
                            onUpdateViewport(vpId, {
                              whiteBalance: Math.max(2000, Math.min(10000, Number(e.target.value) || 6500)),
                            })
                          }
                          className={numInputCls}
                        />
                        <span className="text-[#A8B5CB] text-[10px]">K</span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Automatic Exposure</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <button
                        type="button"
                        onClick={() => onUpdateViewport(vpId, { autoExposure: !vp.autoExposure })}
                        className={`w-full h-[18px] px-1.5 border border-[#1A2740] text-left text-[10px] cursor-pointer ${
                          vp.autoExposure
                            ? 'bg-[#3B6E1C] text-[#F5F8FC]'
                            : 'bg-[#25344E] text-[#CBD5E1]'
                        }`}
                      >
                        {vp.autoExposure ? 'Yes' : 'No'}
                      </button>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Exposure Adjustment</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  const ev = vp.exposureAdjustment;
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={-3}
                          max={3}
                          step={0.5}
                          value={ev}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { exposureAdjustment: Number(e.target.value) })
                          }
                          className="w-11 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[30px] text-right">
                          {ev > 0 ? `+${ev}EV` : `${ev}EV`}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </>
          )}

          {/* 3. Environment Settings */}
          {renderSectionHeader('environment', 'Environment Settings')}
          {!collapsed.environment && (
            <>
              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Laser Flicker Effect</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <button
                        type="button"
                        onClick={() => onUpdateViewport(vpId, { laserFlicker: !vp.laserFlicker })}
                        className={`w-full h-[18px] px-1.5 border border-[#1A2740] text-left text-[10px] cursor-pointer ${
                          vp.laserFlicker
                            ? 'bg-[#3B6E1C] text-[#F5F8FC]'
                            : 'bg-[#25344E] text-[#CBD5E1]'
                        }`}
                      >
                        {vp.laserFlicker ? 'Yes' : 'No'}
                      </button>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Ambient Lighting</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={vp.ambientLighting}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { ambientLighting: Number(e.target.value) })
                          }
                          className="w-12 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[28px] text-right">
                          {vp.ambientLighting}%
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Ambient Lighting Color</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={vp.ambientLightingColor}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { ambientLightingColor: e.target.value })
                          }
                          className="w-[20px] h-[16px] bg-transparent border border-[#2A3A54] p-0 cursor-pointer"
                        />
                        <span className="text-[9px] text-[#B2BECE] uppercase tabular-nums truncate">
                          {vp.ambientLightingColor}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Fill Lighting</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={vp.fillLighting}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { fillLighting: Number(e.target.value) })
                          }
                          className="w-12 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[28px] text-right">
                          {vp.fillLighting}%
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </>
          )}

          {/* 4. Lens Effects (Post-Processing) */}
          {renderSectionHeader('lens', 'Lens Effects')}
          {!collapsed.lens && (
            <>
              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Bloom</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={20}
                          max={100}
                          step={1}
                          value={vp.bloom}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { bloom: Number(e.target.value) })
                          }
                          className="w-12 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[28px] text-right">
                          {vp.bloom}%
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Flare</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={vp.flare}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { flare: Number(e.target.value) })
                          }
                          className="w-12 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[28px] text-right">
                          {vp.flare}%
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Flare Streaks</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        step={1}
                        value={vp.flareStreaks}
                        onChange={(e) =>
                          onUpdateViewport(vpId, {
                            flareStreaks: Math.max(1, Math.min(8, Math.round(Number(e.target.value) || 3))),
                          })
                        }
                        className={numInputCls}
                      />
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Flare Angle</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={180}
                          step={5}
                          value={vp.flareAngle}
                          onChange={(e) =>
                            onUpdateViewport(vpId, {
                              flareAngle: Math.max(0, Math.min(180, Number(e.target.value) || 0)),
                            })
                          }
                          className={numInputCls}
                        />
                        <span className="text-[#A8B5CB] text-[10px]">°</span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Flare Size</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={20}
                          max={200}
                          step={5}
                          value={vp.flareSize}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { flareSize: Number(e.target.value) })
                          }
                          className="w-11 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[30px] text-right">
                          {vp.flareSize}%
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </>
          )}

          {/* 5. Image Adjustments */}
          {renderSectionHeader('image', 'Image Adjustments')}
          {!collapsed.image && (
            <>
              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Hue Clamp</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={vp.hueClamp}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { hueClamp: Number(e.target.value) })
                          }
                          className="w-12 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[28px] text-right">
                          {vp.hueClamp}%
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Saturation</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={0}
                          max={200}
                          step={5}
                          value={vp.saturation}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { saturation: Number(e.target.value) })
                          }
                          className="w-11 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[30px] text-right">
                          {vp.saturation}%
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>

              <tr className="border-b border-[#1C2A43]">
                <td className="px-2 py-[3px] text-[#D7E0EE] bg-[#263650]">Contrast</td>
                {VIEWPORT_IDS.map((vpId) => {
                  const vp = viewports[vpId];
                  return (
                    <td key={vpId} className={cellCls}>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={25}
                          max={200}
                          step={5}
                          value={vp.contrast}
                          onChange={(e) =>
                            onUpdateViewport(vpId, { contrast: Number(e.target.value) })
                          }
                          className="w-11 accent-[#A08F52]"
                        />
                        <span className="tabular-nums text-[#F5F8FC] text-[10px] min-w-[30px] text-right">
                          {vp.contrast}%
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
};
