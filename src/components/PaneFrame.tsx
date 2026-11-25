import React from 'react';
import { MaximizeIcon, PopOutIcon } from './Icons';

interface PaneFrameProps {
  title: string;
  isMaximized?: boolean;
  isPoppedOut?: boolean;
  onToggleMaximize?: () => void;
  onTogglePopOut?: () => void;
  children: React.ReactNode;
  className?: string;
}

export const PaneFrame: React.FC<PaneFrameProps> = ({
  title,
  isMaximized = false,
  isPoppedOut = false,
  onToggleMaximize,
  onTogglePopOut,
  children,
  className = '',
}) => {
  return (
    <div className={`flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden bg-[#08111F] ${className}`}>
      {/* Exact 20px muted olive-gold / ochre header bar (#857431) */}
      <div className="h-[20px] shrink-0 bg-[#A08F52] flex items-center justify-between px-[6px] select-none border-b border-[#0A1424]">
        <span className="text-[11px] leading-none font-normal text-[#F5F8FC] tracking-[0.01em] truncate">
          {title}
        </span>

        {/* Right-aligned two tiny dark-bordered square buttons (14x14px, #1B2940 fill) */}
        <div className="flex items-center gap-[3px] shrink-0">
          <button
            type="button"
            title={isPoppedOut ? 'Dock back into workspace' : 'Pop out window'}
            onClick={onTogglePopOut}
            className={`w-[14px] h-[14px] flex items-center justify-center bg-[#1B2940] border border-[#0D1727] text-[#DCE4F0] hover:text-[#F5F8FC] hover:bg-[#30415E] transition-colors cursor-pointer ${
              isPoppedOut ? 'ring-1 ring-[#F5F8FC]/40' : ''
            }`}
          >
            <PopOutIcon className="w-[10px] h-[10px]" />
          </button>
          <button
            type="button"
            title={isMaximized ? 'Restore 2×2 grid view' : 'Maximize pane'}
            onClick={onToggleMaximize}
            className="w-[14px] h-[14px] flex items-center justify-center bg-[#171B20] border border-[#0D1727] text-[#E2E8F0] hover:text-[#F5F8FC] hover:bg-[#2E3E59] transition-colors cursor-pointer"
          >
            <MaximizeIcon maximized={isMaximized} className="w-[10px] h-[10px]" />
          </button>
        </div>
      </div>

      {/* Pane body */}
      <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
};
