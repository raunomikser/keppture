import React, { useEffect, useRef, useState } from 'react';

export interface RecentFileEntry {
  id: string;
  name: string;
  savedAt: string;
}

interface FileMenuBarProps {
  platformModifier?: string;
  recentFiles: RecentFileEntry[];
  onNewProject: () => void;
  onOpenProjectFile: (file: File) => void;
  onOpenRecent: (id: string) => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onImportModelFile: (file: File) => void;
  onImportFixtureDataFile: (file: File) => void;
  onImportProjectContentFile: (file: File) => void;
  onExportProject: () => void;
  onExportModel: () => void;
  onExportFixtureData: () => void;
}

export const FileMenuBar: React.FC<FileMenuBarProps> = ({
  platformModifier = '⌘',
  recentFiles,
  onNewProject,
  onOpenProjectFile,
  onOpenRecent,
  onSaveProject,
  onSaveProjectAs,
  onImportModelFile,
  onImportFixtureDataFile,
  onImportProjectContentFile,
  onExportProject,
  onExportModel,
  onExportFixtureData,
}) => {
  const [open, setOpen] = useState(false);
  const [recentSubOpen, setRecentSubOpen] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const menuRootRef = useRef<HTMLDivElement>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const importModelRef = useRef<HTMLInputElement>(null);
  const importFixtureRef = useRef<HTMLInputElement>(null);
  const importContentRef = useRef<HTMLInputElement>(null);

  const closeMenu = () => {
    setOpen(false);
    setRecentSubOpen(false);
    setHoveredKey(null);
  };

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (menuRootRef.current && !menuRootRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const renderItem = (
    key: string,
    label: string,
    shortcut: string | null,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      onMouseEnter={() => setHoveredKey(key)}
      onMouseLeave={() => setHoveredKey(null)}
      onClick={() => {
        onClick();
        closeMenu();
      }}
      className="w-full px-[12px] py-[3px] flex items-center justify-between text-left text-[12px] leading-[17px] text-[#FFFFFF] cursor-pointer"
      style={{ backgroundColor: hoveredKey === key ? '#6B6032' : 'transparent' }}
    >
      <span>{label}</span>
      {shortcut && <span className="text-[11px] text-[#8E8E93] tabular-nums ml-4">{shortcut}</span>}
    </button>
  );

  return (
    <div ref={menuRootRef} className="relative flex items-center ml-[12px]">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setRecentSubOpen(false);
        }}
        className={`px-[8px] py-[2px] rounded-[3px] text-[11px] leading-none cursor-pointer transition-colors ${
          open
            ? 'bg-[#6B6032] text-[#FFFFFF]'
            : 'text-[#CCCCCC] hover:bg-[#333333] hover:text-[#FFFFFF]'
        }`}
      >
        File
      </button>

      {open && (
        <div
          className="absolute left-0 top-[24px] w-[248px] py-[5px] rounded-[7px] border border-[#4A4A4A] shadow-[0_14px_38px_rgba(0,0,0,0.82)] z-50 select-none"
          style={{
            backgroundColor: 'rgba(38, 38, 38, 0.96)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {renderItem('new', 'New', `${platformModifier} N`, onNewProject)}
          {renderItem('open', 'Open...', `${platformModifier} O`, () => openInputRef.current?.click())}

          {/* Open Recent > Submenu */}
          <div
            className="relative"
            onMouseEnter={() => {
              setHoveredKey('open-recent');
              setRecentSubOpen(true);
            }}
            onMouseLeave={() => {
              setHoveredKey(null);
              setRecentSubOpen(false);
            }}
          >
            <button
              type="button"
              className="w-full px-[12px] py-[3px] flex items-center justify-between text-left text-[12px] leading-[17px] text-[#FFFFFF] cursor-pointer"
              style={{ backgroundColor: hoveredKey === 'open-recent' ? '#6B6032' : 'transparent' }}
            >
              <span>Open Recent</span>
              <span className="text-[12px] text-[#8E8E93]">›</span>
            </button>

            {recentSubOpen && (
              <div
                className="absolute left-[244px] top-[-4px] w-[210px] py-[4px] rounded-[7px] border border-[#4A4A4A] shadow-2xl"
                style={{ backgroundColor: 'rgba(38, 38, 38, 0.97)' }}
              >
                {recentFiles.length === 0 ? (
                  <div className="px-[10px] py-[3px] text-[11px] text-[#8E8E93]">
                    No recent files
                  </div>
                ) : (
                  recentFiles.map((rf) => (
                    <button
                      key={rf.id}
                      type="button"
                      onClick={() => {
                        onOpenRecent(rf.id);
                        closeMenu();
                      }}
                      className="w-full px-[10px] py-[3px] flex items-center justify-between text-left text-[11px] text-[#FFFFFF] hover:bg-[#6B6032] cursor-pointer"
                    >
                      <span className="truncate">{rf.name}</span>
                      <span className="text-[9px] text-[#8E8E93] ml-2 shrink-0">{rf.savedAt}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {renderItem('save', 'Save', `${platformModifier} S`, onSaveProject)}
          {renderItem('save-as', 'Save As...', `⇧ ${platformModifier} S`, onSaveProjectAs)}

          <div className="my-[4px] border-t border-[#484848]" />

          {renderItem('import-model', 'Import Model...', null, () => importModelRef.current?.click())}
          {renderItem('import-fixture', 'Import Fixture Data...', null, () =>
            importFixtureRef.current?.click(),
          )}
          {renderItem('import-content', 'Import Project Content...', null, () =>
            importContentRef.current?.click(),
          )}

          <div className="my-[4px] border-t border-[#484848]" />

          {renderItem('export-project', 'Export Legacy JSON...', null, onExportProject)}
          {renderItem('export-model', 'Export Model...', null, onExportModel)}
          {renderItem('export-fixture', 'Export Fixture Data...', null, onExportFixtureData)}
        </div>
      )}

      {/* Hidden native file inputs for File menu actions */}
      <input
        ref={openInputRef}
        type="file"
        accept=".kptr,.json,.c2p"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onOpenProjectFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={importModelRef}
        type="file"
        accept=".skp,.glb,.gltf,.obj"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportModelFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={importFixtureRef}
        type="file"
        accept=".gdtf,.csv,.mvr,.zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportFixtureDataFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={importContentRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportProjectContentFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
};
