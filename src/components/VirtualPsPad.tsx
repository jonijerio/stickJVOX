import React, { useState } from 'react';
import { VirtualPsPadState } from '../game/gamepad';

interface VirtualPsPadProps {
  onVirtualInput: (partial: Partial<VirtualPsPadState>) => void;
}

export const VirtualPsPad: React.FC<VirtualPsPadProps> = ({ onVirtualInput }) => {
  const [pressedMap, setPressedMap] = useState<Record<string, boolean>>({});

  const setActive = (key: string, active: boolean, patch: Partial<VirtualPsPadState>) => {
    setPressedMap((prev) => (prev[key] === active ? prev : { ...prev, [key]: active }));
    onVirtualInput(patch);
  };

  const bindDir = (key: string, patchActive: Partial<VirtualPsPadState>, patchRelease: Partial<VirtualPsPadState>) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore when synthetic pointerId is not an active OS pointer
      }
      setActive(key, true, patchActive);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setActive(key, false, patchRelease);
    },
    onPointerCancel: () => setActive(key, false, patchRelease),
    onPointerLeave: () => setActive(key, false, patchRelease),
    onLostPointerCapture: () => setActive(key, false, patchRelease),
  });

  const bindBtn = (key: keyof Pick<VirtualPsPadState, 'cross' | 'square' | 'circle' | 'triangle'>) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignore when synthetic pointerId is not an active OS pointer
      }
      setActive(key, true, { [key]: true });
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setActive(key, false, { [key]: false });
    },
    onPointerCancel: () => setActive(key, false, { [key]: false }),
    onPointerLeave: () => setActive(key, false, { [key]: false }),
    onLostPointerCapture: () => setActive(key, false, { [key]: false }),
  });

  return (
    <div
      data-testid="virtual-ps-pad"
      className="fixed inset-x-0 bottom-0 z-20 pointer-events-none flex items-end justify-between px-4 pb-4 sm:px-7 sm:pb-6 select-none"
    >
      {/* Left: DualShock / DualSense D-Pad */}
      <div className="pointer-events-auto touch-none relative w-[136px] h-[136px] rounded-full bg-[#0C101A]/85 border border-slate-700/90 p-2">
        <div className="grid grid-cols-3 grid-rows-3 w-full h-full gap-1">
          <div />
          <button
            type="button"
            tabIndex={-1}
            aria-label="PS D-Pad Up"
            {...bindDir('up', { moveY: -1 }, { moveY: 0 })}
            className={`rounded-md border flex items-center justify-center transition-colors cursor-pointer ${
              pressedMap.up
                ? 'bg-slate-600 border-amber-400 text-white'
                : 'bg-[#171E2E] border-slate-700 text-slate-300'
            }`}
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
              <path d="M8 3l5 7H3l5-7z" />
            </svg>
          </button>
          <div />

          <button
            type="button"
            tabIndex={-1}
            aria-label="PS D-Pad Left"
            {...bindDir('left', { moveX: -1 }, { moveX: 0 })}
            className={`rounded-md border flex items-center justify-center transition-colors cursor-pointer ${
              pressedMap.left
                ? 'bg-slate-600 border-amber-400 text-white'
                : 'bg-[#171E2E] border-slate-700 text-slate-300'
            }`}
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
              <path d="M3 8l7-5v10L3 8z" />
            </svg>
          </button>

          <div className="rounded-sm bg-[#0F1420] border border-slate-800 flex items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-slate-700" />
          </div>

          <button
            type="button"
            tabIndex={-1}
            aria-label="PS D-Pad Right"
            {...bindDir('right', { moveX: 1 }, { moveX: 0 })}
            className={`rounded-md border flex items-center justify-center transition-colors cursor-pointer ${
              pressedMap.right
                ? 'bg-slate-600 border-amber-400 text-white'
                : 'bg-[#171E2E] border-slate-700 text-slate-300'
            }`}
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
              <path d="M13 8l-7 5V3l7 5z" />
            </svg>
          </button>

          <div />
          <button
            type="button"
            tabIndex={-1}
            aria-label="PS D-Pad Down"
            {...bindDir('down', { moveY: 1 }, { moveY: 0 })}
            className={`rounded-md border flex items-center justify-center transition-colors cursor-pointer ${
              pressedMap.down
                ? 'bg-slate-600 border-amber-400 text-white'
                : 'bg-[#171E2E] border-slate-700 text-slate-300'
            }`}
          >
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
              <path d="M8 13l-5-7h10l-5 7z" />
            </svg>
          </button>
          <div />
        </div>
      </div>

      {/* Right: PlayStation Face Buttons (△ Throw, □ Attack, ○ Block, ✕ Jump) */}
      <div className="pointer-events-auto touch-none relative w-[162px] h-[162px] rounded-full bg-[#0C101A]/85 border border-slate-700/90 p-2">
        <div className="grid grid-cols-3 grid-rows-3 w-full h-full gap-1">
          <div />
          {/* Triangle: Throw */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Triangle Throw"
            {...bindBtn('triangle')}
            className={`rounded-full border flex flex-col items-center justify-center transition-transform cursor-pointer ${
              pressedMap.triangle
                ? 'scale-95 bg-emerald-500/35 border-emerald-400'
                : 'bg-[#141A28] border-emerald-500/60 hover:border-emerald-400'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2.2">
              <polygon points="10,3 17,16 3,16" />
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-wider text-emerald-300 leading-none mt-0.5">
              Throw
            </span>
          </button>
          <div />

          {/* Square: Attack */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Square Attack"
            {...bindBtn('square')}
            className={`rounded-full border flex flex-col items-center justify-center transition-transform cursor-pointer ${
              pressedMap.square
                ? 'scale-95 bg-pink-500/35 border-pink-400'
                : 'bg-[#141A28] border-pink-500/60 hover:border-pink-400'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4 text-pink-400" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect x="4" y="4" width="12" height="12" rx="1" />
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-wider text-pink-300 leading-none mt-0.5">
              Hit
            </span>
          </button>

          <div className="flex items-center justify-center">
            <span className="text-[9px] font-extrabold tracking-widest text-slate-500">PS</span>
          </div>

          {/* Circle: Block */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Circle Block"
            {...bindBtn('circle')}
            className={`rounded-full border flex flex-col items-center justify-center transition-transform cursor-pointer ${
              pressedMap.circle
                ? 'scale-95 bg-rose-500/35 border-rose-400'
                : 'bg-[#141A28] border-rose-500/60 hover:border-rose-400'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="10" cy="10" r="6" />
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-wider text-rose-300 leading-none mt-0.5">
              Block
            </span>
          </button>

          <div />
          {/* Cross: Jump */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Cross Jump"
            {...bindBtn('cross')}
            className={`rounded-full border flex flex-col items-center justify-center transition-transform cursor-pointer ${
              pressedMap.cross
                ? 'scale-95 bg-sky-500/35 border-sky-400'
                : 'bg-[#141A28] border-sky-500/60 hover:border-sky-400'
            }`}
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="5" y1="5" x2="15" y2="15" />
              <line x1="15" y1="5" x2="5" y2="15" />
            </svg>
            <span className="text-[8px] font-bold uppercase tracking-wider text-sky-300 leading-none mt-0.5">
              Jump
            </span>
          </button>
          <div />
        </div>
      </div>
    </div>
  );
};
