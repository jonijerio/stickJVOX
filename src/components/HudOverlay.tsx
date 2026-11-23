import React from 'react';
import { VirtualPsPadState } from '../game/gamepad';
import { HudSnapshot, WeaponId } from '../game/types';
import { VirtualPsPad } from './VirtualPsPad';

interface HudOverlayProps {
  hud: HudSnapshot;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onToggleVirtualPsPad: () => void;
  onVirtualPsInput: (partial: Partial<VirtualPsPadState>) => void;
}

function WeaponIconSvg({ weapon, color }: { weapon: WeaponId; color: string }) {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none">
      {weapon === 'fists' && (
        <path
          d="M7 13V8a1.5 1.5 0 0 1 3 0v3m0-3a1.5 1.5 0 0 1 3 0v3m0-2a1.5 1.5 0 0 1 3 0v4.5a4.5 4.5 0 0 1-4.5 4.5H10a4 4 0 0 1-4-4v-2.5A1.5 1.5 0 0 1 7 13z"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {weapon === 'pistol' && (
        <path
          d="M4 9h14v3H9l-1 6H5l1-6H4V9z"
          fill={color}
          stroke="#0B0E14"
          strokeWidth="1.2"
        />
      )}
      {weapon === 'shotgun' && (
        <path
          d="M2 11h19v2.5H9l-3 3.5H3l2-3.5H2V11z"
          fill={color}
          stroke="#0B0E14"
          strokeWidth="1.2"
        />
      )}
      {weapon === 'smg' && (
        <path
          d="M4 9h15v3h-4v5h-3v-5H8l-1 4H4l1-4H4V9z"
          fill={color}
          stroke="#0B0E14"
          strokeWidth="1.2"
        />
      )}
      {weapon === 'katana' && (
        <path
          d="M4 19l4-4m-1-2l3 3M9 14L20 3l-2 6-7 7"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {weapon === 'rocket' && (
        <path
          d="M3 10h15l3 2-3 2H3v-4z"
          fill={color}
          stroke="#0B0E14"
          strokeWidth="1.2"
        />
      )}
      {weapon === 'laser' && (
        <path
          d="M3 10h16v4H3v-4zm16 2h3"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export const HudOverlay: React.FC<HudOverlayProps> = ({
  hud,
  onToggleMute,
  onTogglePause,
  onRestart,
  onToggleVirtualPsPad,
  onVirtualPsInput,
}) => {
  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-4">
      {/* Top Perimeter Strip: Fighter Clusters + Arena/Round + Utility Buttons */}
      <div className="flex items-start justify-between gap-4">
        {/* Fighter Status Clusters */}
        <div className="flex flex-wrap items-start gap-2.5">
          {hud.fighters.map((f) => {
            const hpPct = Math.max(0, Math.min(100, (f.hp / f.maxHp) * 100));
            const ghostPct = Math.max(hpPct, Math.min(100, (f.ghostHp / f.maxHp) * 100));
            return (
              <div
                key={f.id}
                className={`min-w-[155px] sm:min-w-[178px] rounded-lg px-3 py-2 bg-[#111520]/90 border transition-opacity ${
                  f.alive ? 'border-slate-700/80 opacity-100' : 'border-slate-800/60 opacity-55'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: f.color }}
                    />
                    <span className="text-xs font-bold tracking-wide text-slate-100 truncate">
                      {f.name}
                    </span>
                    {f.pattern !== 'solid' && (
                      <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">
                        {f.pattern}
                      </span>
                    )}
                  </div>
                  <span
                    className="font-display text-lg font-extrabold leading-none tabular-nums"
                    style={{ color: f.alive ? '#F8FAFC' : '#94A3B8' }}
                  >
                    {f.alive ? f.hp : 'KO'}
                  </span>
                </div>

                {/* HP Bar with Delayed Damage Ghost */}
                <div className="relative mt-1.5 h-2 w-full rounded-sm bg-slate-900 overflow-hidden border border-slate-800">
                  <div
                    className="absolute inset-y-0 left-0 bg-white/50 transition-[width] duration-75"
                    style={{ width: `${ghostPct}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 transition-[width] duration-75"
                    style={{ width: `${hpPct}%`, backgroundColor: f.color }}
                  />
                </div>

                {/* Weapon & Round Win Pips */}
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                    <WeaponIconSvg weapon={f.weapon} color={f.color} />
                    <span>{f.weaponName}</span>
                    {f.ammo >= 0 && (
                      <span className="text-slate-400 tabular-nums">({f.ammo})</span>
                    )}
                  </div>

                  {/* Round Win Pips */}
                  <div className="flex items-center gap-1" aria-label={`Wins: ${f.wins} of ${hud.roundsToWin}`}>
                    {Array.from({ length: hud.roundsToWin }).map((_, idx) => {
                      const filled = idx < f.wins;
                      return (
                        <span
                          key={idx}
                          className="w-2 h-2 rounded-xs border"
                          style={{
                            borderColor: filled ? f.color : '#475569',
                            backgroundColor: filled ? f.color : 'transparent',
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Top-Right Arena Readout + Utility Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden md:flex flex-col items-end mr-2 text-right">
            <span className="font-display text-lg font-bold tracking-wider uppercase text-slate-100 leading-tight [text-shadow:0_2px_4px_rgba(0,0,0,0.85)]">
              {hud.arenaName}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-400 tabular-nums">
              Round {hud.roundNumber} · First to {hud.roundsToWin}
              {hud.connectedPads > 0 ? ` · PS Pad (${hud.connectedPads})` : ''}
            </span>
          </div>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleVirtualPsPad();
            }}
            aria-label={hud.showVirtualPsPad ? 'Hide on-screen PS controller' : 'Show on-screen PS controller'}
            aria-pressed={hud.showVirtualPsPad}
            title="On-Screen PS Pad"
            className={`pointer-events-auto h-10 px-2.5 flex items-center gap-1.5 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
              hud.showVirtualPsPad
                ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                : 'bg-[#111520]/90 border-slate-700/80 text-slate-200 hover:border-amber-400 hover:text-amber-300'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="10" rx="4" />
              <line x1="7" y1="10" x2="7" y2="14" />
              <line x1="5" y1="12" x2="9" y2="12" />
              <circle cx="15.5" cy="10.5" r="0.8" fill="currentColor" />
              <circle cx="17.5" cy="12.5" r="0.8" fill="currentColor" />
            </svg>
            <span className="hidden sm:inline">PS</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={hud.muted ? 'Unmute audio (M)' : 'Mute audio (M)'}
            title="Mute (M)"
            className="pointer-events-auto w-10 h-10 flex items-center justify-center rounded-lg bg-[#111520]/90 border border-slate-700/80 text-slate-200 hover:border-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fillOpacity="0.2" />
              {hud.muted ? (
                <>
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </>
              ) : (
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              )}
            </svg>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onRestart();
            }}
            aria-label="Restart match (R)"
            title="Restart (R)"
            className="pointer-events-auto w-10 h-10 flex items-center justify-center rounded-lg bg-[#111520]/90 border border-slate-700/80 text-slate-200 hover:border-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>

          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onTogglePause();
            }}
            aria-label="Pause game (Esc)"
            title="Pause (Esc)"
            className="pointer-events-auto w-10 h-10 flex items-center justify-center rounded-lg bg-[#111520]/90 border border-slate-700/80 text-slate-200 hover:border-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Transient Round / KO Banner (Upper-center, non-blocking) */}
      {hud.roundBannerText && (
        <div className="flex flex-col items-center justify-center mb-12 animate-modal-pop">
          <div className="px-6 py-2 rounded-lg bg-[#0B0E15]/92 border border-amber-500/70 text-center">
            <div className="font-display text-4xl sm:text-5xl font-extrabold tracking-wider uppercase text-white">
              {hud.roundBannerText}
            </div>
            {hud.roundBannerSubtext && (
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-400 mt-0.5">
                {hud.roundBannerSubtext}
              </div>
            )}
          </div>
        </div>
      )}

      <div />

      {hud.phase === 'playing' && hud.showVirtualPsPad && (
        <VirtualPsPad onVirtualInput={onVirtualPsInput} />
      )}
    </div>
  );
};
