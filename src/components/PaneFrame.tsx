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
    <div className={`flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden bg-[#000000] ${className}`}>
      {/* Exact 20px muted olive-gold / ochre header bar (#857431) */}
      <div className="h-[20px] shrink-0 bg-[#857431] flex items-center justify-between px-[6px] select-none border-b border-[#000000]">
        <span className="text-[11px] leading-none font-normal text-[#FFFFFF] tracking-[0.01em] truncate">
          {title}
        </span>

        {/* Right-aligned two tiny dark-bordered square buttons (14x14px, #1A1A1A fill) */}
        <div className="flex items-center gap-[3px] shrink-0">
          <button
            type="button"
            title={isPoppedOut ? 'Dock back into workspace' : 'Pop out window'}
            onClick={onTogglePopOut}
            className={`w-[14px] h-[14px] flex items-center justify-center bg-[#1A1A1A] border border-[#0D0D0D] text-[#D8D8D8] hover:text-[#FFFFFF] hover:bg-[#2A2A2A] transition-colors cursor-pointer ${
              isPoppedOut ? 'ring-1 ring-[#FFFFFF]/40' : ''
            }`}
          >
            <PopOutIcon className="w-[10px] h-[10px]" />
          </button>
          <button
            type="button"
            title={isMaximized ? 'Restore 2×2 grid view' : 'Maximize pane'}
            onClick={onToggleMaximize}
            className="w-[14px] h-[14px] flex items-center justify-center bg-[#1A1A1A] border border-[#0D0D0D] text-[#D8D8D8] hover:text-[#FFFFFF] hover:bg-[#2A2A2A] transition-colors cursor-pointer"
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
