import React from 'react';

export const PopOutIcon: React.FC<{ className?: string }> = ({ className = 'w-2.5 h-2.5' }) => (
  <svg viewBox="0 0 12 12" fill="none" className={className} stroke="currentColor" strokeWidth="1.2">
    <path d="M5.5 2H2.5C2.22 2 2 2.22 2 2.5V9.5C2 9.78 2.22 10 2.5 10H9.5C9.78 10 10 9.78 10 9.5V6.5" />
    <path d="M7 2H10V5" />
    <path d="M10 2L5.5 6.5" />
  </svg>
);

export const MaximizeIcon: React.FC<{ maximized?: boolean; className?: string }> = ({
  maximized = false,
  className = 'w-2.5 h-2.5',
}) =>
  maximized ? (
    <svg viewBox="0 0 12 12" fill="none" className={className} stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="4" width="6" height="6" />
      <path d="M4 4V2H10V8H8" />
    </svg>
  ) : (
    <svg viewBox="0 0 12 12" fill="none" className={className} stroke="currentColor" strokeWidth="1.2">
      <line x1="2" y1="3" x2="10" y2="3" />
      <rect x="2" y="5" width="8" height="4.5" />
    </svg>
  );

export const OriginCloudIcon: React.FC<{ className?: string }> = ({ className = 'w-[18px] h-[12px]' }) => (
  <svg viewBox="0 0 24 16" fill="#FFFFFF" className={className}>
    <path d="M6.5 14.5C4.01 14.5 2 12.64 2 10.35C2 8.32 3.58 6.63 5.69 6.27C6.45 3.63 8.98 1.7 12 1.7C15.38 1.7 18.17 4.12 18.54 7.22C20.49 7.55 22 9.15 22 11.1C22 13.03 20.38 14.5 18.3 14.5H6.5Z" />
  </svg>
);

export const OrbitButtonIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 16 16" fill="none" className={className} stroke="#7CE043" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.6 5.4A5 5 0 0 0 3.7 4.7" />
    <polyline points="2.8 2.7 3.5 5 5.8 4.4" />
    <path d="M3.4 10.6A5 5 0 0 0 12.3 11.3" />
    <polyline points="13.2 13.3 12.5 11 10.2 11.6" />
  </svg>
);

export const DollyButtonIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 16 16" fill="none" className={className} stroke="#7CE043" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="2.8" x2="8" y2="13.2" />
    <polyline points="5.5 5.2 8 2.5 10.5 5.2" />
    <polyline points="5.5 10.8 8 13.5 10.5 10.8" />
  </svg>
);

export const MenuBarsButtonIcon: React.FC<{ className?: string }> = ({ className = 'w-3 h-3' }) => (
  <svg viewBox="0 0 14 14" fill="none" className={className} stroke="#7CE043" strokeWidth="1.6" strokeLinecap="round">
    <line x1="2.5" y1="3.8" x2="11.5" y2="3.8" />
    <line x1="2.5" y1="7" x2="11.5" y2="7" />
    <line x1="2.5" y1="10.2" x2="11.5" y2="10.2" />
  </svg>
);

/* 7 Sidebar Category Icons (22x22 monochrome white line icons) */

export const ProjectDocIcon: React.FC<{ className?: string }> = ({ className = 'w-[22px] h-[22px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3H14L18 7V20C18 20.55 17.55 21 17 21H6C5.45 21 5 20.55 5 20V4C5 3.45 5.45 3 6 3Z" />
    <polyline points="14 3 14 7 18 7" />
    <line x1="7.8" y1="9" x2="11.8" y2="9" />
    <line x1="7.8" y1="12" x2="11" y2="12" />
    <path d="M12.5 17.5L19.8 10.2L21.5 11.9L14.2 19.2L11.7 19.9L12.5 17.5Z" fill="#262626" />
  </svg>
);

export const SelectedItemsIcon: React.FC<{ className?: string }> = ({ className = 'w-[22px] h-[22px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="#FFFFFF" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
    {/* Small triangle top-left */}
    <polygon points="5.5,3.5 8,8 3,8" />
    {/* Small circle top-right */}
    <circle cx="17.5" cy="6.2" r="2.3" />
    {/* Small square bottom-left */}
    <rect x="3.5" y="15.5" width="4.4" height="4.4" />
    {/* Mouse cursor arrow center-right */}
    <path d="M11.5 9.5L12.5 19.5L15 16.5L18.2 19.5L19.6 18.1L16.4 15.1L19.5 13.2L11.5 9.5Z" fill="#FFFFFF" stroke="#1F1F1F" strokeWidth="1" />
  </svg>
);

export const ViewsEyeIcon: React.FC<{ className?: string }> = ({ className = 'w-[22px] h-[22px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="#FFFFFF" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.2 12C4.5 7.6 8 5.5 12 5.5C16 5.5 19.5 7.6 21.8 12C19.5 16.4 16 18.5 12 18.5C8 18.5 4.5 16.4 2.2 12Z" />
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="12" cy="12" r="1.1" fill="#FFFFFF" />
  </svg>
);

export const LayersStackIcon: React.FC<{ className?: string }> = ({ className = 'w-[22px] h-[22px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12,3.5 20.5,7.8 12,12.1 3.5,7.8" />
    <polyline points="3.5 12 12 16.3 20.5 12" />
    <polyline points="3.5 16.2 12 20.5 20.5 16.2" />
  </svg>
);

export const FiltersFunnelIcon: React.FC<{ className?: string }> = ({ className = 'w-[22px] h-[22px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="4.8" r="1.1" fill="#FFFFFF" stroke="none" />
    <circle cx="12" cy="4.2" r="1.1" fill="#FFFFFF" stroke="none" />
    <circle cx="16.5" cy="5.2" r="1.1" fill="#FFFFFF" stroke="none" />
    <path d="M4.5 8H19.5L13.8 14.5V19.8L10.2 18.2V14.5L4.5 8Z" />
  </svg>
);

export const FixtureGroupsIcon: React.FC<{ className?: string }> = ({ className = 'w-[22px] h-[22px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="#FFFFFF" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
    {/* Horizontal truss bar */}
    <line x1="2.5" y1="5.5" x2="21.5" y2="5.5" strokeWidth="1.8" />
    {/* Left spotlight */}
    <line x1="5.5" y1="5.5" x2="5.5" y2="8.5" />
    <path d="M3.5 8.5H7.5L8.2 13.5H2.8L3.5 8.5Z" />
    <path d="M3.5 13.5L2 18M7.5 13.5L9 18" strokeOpacity="0.65" />
    {/* Middle spotlight */}
    <line x1="12" y1="5.5" x2="12" y2="8.5" />
    <path d="M10 8.5H14L14.7 13.5H9.3L10 8.5Z" />
    <path d="M10 13.5L8.5 18M14 13.5L15.5 18" strokeOpacity="0.65" />
    {/* Right spotlight */}
    <line x1="18.5" y1="5.5" x2="18.5" y2="8.5" />
    <path d="M16.5 8.5H20.5L21.2 13.5H15.8L16.5 8.5Z" />
    <path d="M16.5 13.5L15 18M20.5 13.5L22 18" strokeOpacity="0.65" />
  </svg>
);

export const CameraPositionsIcon: React.FC<{ className?: string }> = ({ className = 'w-[22px] h-[22px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {/* Dual top film reels */}
    <circle cx="8" cy="6.8" r="2.6" />
    <circle cx="13.8" cy="6.8" r="2.6" />
    {/* Camera body */}
    <rect x="4.5" y="10" width="11.5" height="7" rx="1" />
    {/* Matte box / lens */}
    <polygon points="16,11.5 21,9.8 21,17.2 16,15.5" />
    {/* Tripod base hint */}
    <line x1="8" y1="17" x2="6.2" y2="20.5" />
    <line x1="12.5" y1="17" x2="14.3" y2="20.5" />
  </svg>
);

export const DrawingLogoPlaceholderIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <rect x="2" y="4" width="20" height="16" rx="1" stroke="#FFFFFF" strokeWidth="1.4" />
    <circle cx="8" cy="9.5" r="1.8" fill="#FFFFFF" />
    <polygon points="4,18 9.5,12 13.5,15.5 16.5,11 20,18" fill="#FFFFFF" />
  </svg>
);

/* 10 Library Asset Browser Category Icons (monochrome white) */

export const LibBuiltInIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5L12 3.5L21 10.5" />
    <path d="M5.5 9.5V20H18.5V9.5" />
    <rect x="9.8" y="13.5" width="4.4" height="6.5" />
  </svg>
);

export const LibRecentIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.2" />
    <polyline points="12 7.5 12 12.2 15.2 14" />
  </svg>
);

export const LibObjectsIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12,3.2 20,7.6 20,16.4 12,20.8 4,16.4 4,7.6" />
    <polyline points="4 7.6 12 12 20 7.6" />
    <line x1="12" y1="12" x2="12" y2="20.8" />
  </svg>
);

export const LibMaterialsIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="4.5" width="17" height="15" />
    <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
    <line x1="3.5" y1="14.5" x2="20.5" y2="14.5" />
    <line x1="12" y1="4.5" x2="12" y2="9.5" />
    <line x1="8" y1="9.5" x2="8" y2="14.5" />
    <line x1="16" y1="9.5" x2="16" y2="14.5" />
    <line x1="12" y1="14.5" x2="12" y2="19.5" />
  </svg>
);

export const LibTrussIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="6.5" width="18" height="11" />
    <line x1="3" y1="17.5" x2="9" y2="6.5" />
    <line x1="9" y1="6.5" x2="15" y2="17.5" />
    <line x1="15" y1="17.5" x2="21" y2="6.5" />
    <line x1="9" y1="6.5" x2="9" y2="17.5" strokeOpacity="0.6" />
    <line x1="15" y1="6.5" x2="15" y2="17.5" strokeOpacity="0.6" />
  </svg>
);

export const LibFixturesIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="7" y="3.5" width="10" height="3.2" rx="0.6" />
    <path d="M8.5 6.7V11.5M15.5 6.7V11.5" />
    <rect x="9.2" y="9" width="5.6" height="7" rx="1" />
    <ellipse cx="12" cy="16" rx="3.2" ry="1.2" />
    <path d="M9.5 17.5L7.5 21M14.5 17.5L16.5 21" strokeOpacity="0.7" />
  </svg>
);

export const LibFixtureSymbolsIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="7,5 17,5 15.2,13.5 8.8,13.5" />
    <circle cx="12" cy="17.2" r="2.6" />
    <line x1="5" y1="17.2" x2="9.4" y2="17.2" />
    <line x1="14.6" y1="17.2" x2="19" y2="17.2" />
  </svg>
);

export const LibSymbolsIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="4" x2="12" y2="12" />
    <line x1="5" y1="12" x2="19" y2="12" />
    <line x1="7.5" y1="15.5" x2="16.5" y2="15.5" />
    <line x1="10" y1="19" x2="14" y2="19" />
  </svg>
);

export const LibFiltersIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4.5" width="11.5" height="11.5" rx="1" />
    <rect x="8.5" y="8" width="11.5" height="11.5" rx="1" fill="#1A1A1A" />
    <line x1="11" y1="16.5" x2="17.5" y2="10.5" />
  </svg>
);

export const LibGobosIcon: React.FC<{ className?: string }> = ({ className = 'w-[20px] h-[20px]' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.2" />
    <circle cx="12" cy="12" r="2.2" />
    <line x1="12" y1="4" x2="12" y2="9.8" />
    <line x1="12" y1="14.2" x2="12" y2="20" />
    <line x1="4" y1="12" x2="9.8" y2="12" />
    <line x1="14.2" y1="12" x2="20" y2="12" />
  </svg>
);

export const FolderGlyphIcon: React.FC<{ className?: string }> = ({ className = 'w-[14px] h-[14px]' }) => (
  <svg viewBox="0 0 16 16" fill="none" className={className} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
    <path d="M1.5 3.5H6L7.5 5H14.5V12.5H1.5V3.5Z" />
  </svg>
);

export const SearchMagnifierIcon: React.FC<{ className?: string }> = ({ className = 'w-[12px] h-[12px]' }) => (
  <svg viewBox="0 0 16 16" fill="none" className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="7" cy="7" r="4.5" />
    <line x1="10.5" y1="10.5" x2="14" y2="14" />
  </svg>
);

