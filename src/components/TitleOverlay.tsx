import React, { useEffect, useState } from 'react';
import { ARENAS } from '../game/arenas';
import { COLOR_SWATCHES, PATTERN_OPTIONS } from '../game/cosmetics';
import { getModeRoster } from '../game/rules';
import { AiDifficulty, CosmeticPattern, MatchConfig, PlayMode } from '../game/types';

interface TitleOverlayProps {
  config: MatchConfig;
  onChangeConfig: (next: MatchConfig) => void;
  onStart: () => void;
  muted: boolean;
  onToggleMute: () => void;
  connectedPads: number;
}

const MODE_OPTIONS: Array<{ id: PlayMode; label: string }> = [
  { id: '1p_duel', label: '1P Duel' },
  { id: '1p_ffa', label: '1P 4-Way' },
  { id: '2p_versus', label: '2P Local' },
  { id: '2p_ffa', label: '2P + Bots' },
];

const DIFFICULTY_OPTIONS: Array<{ id: AiDifficulty; label: string }> = [
  { id: 'casual', label: 'Casual' },
  { id: 'standard', label: 'Standard' },
  { id: 'intense', label: 'Intense' },
];

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  config,
  onChangeConfig,
  onStart,
  muted,
  onToggleMute,
  connectedPads,
}) => {
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(0);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'BUTTON' && e.code === 'Space') return;
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onStart]);

  const roster = getModeRoster(config);
  const safeSlot = selectedSlot < roster.length ? selectedSlot : 0;
  const activeStyle = config.fighterStyles[safeSlot] ?? config.fighterStyles[0];
  const hasBots = config.mode !== '2p_versus';
  const isTwoPlayer = config.mode === '2p_versus' || config.mode === '2p_ffa';

  const updateFighterStyle = (slotId: number, patch: { colorId?: string; pattern?: CosmeticPattern }) => {
    const nextStyles = config.fighterStyles.map((style, idx) =>
      idx === slotId ? { ...style, ...patch } : style
    );
    onChangeConfig({ ...config, fighterStyles: nextStyles });
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none px-6 py-4">
      {/* Top Row: Pad Status + Upper-Sky Title Lockup & Launch Bar + Sound Toggle */}
      <div className="flex items-start justify-between gap-4">
        <div className="w-36 shrink-0 hidden sm:flex items-center">
          {connectedPads > 0 && (
            <div className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#121622]/90 border border-emerald-500/60 text-xs font-semibold text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>PS Pad ({connectedPads})</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center text-center max-w-2xl mx-auto">
          <svg
            viewBox="0 0 540 100"
            className="w-[280px] sm:w-[370px] h-auto"
            role="img"
            aria-label="Stick Fight: Arena Brawl"
          >
            <g stroke="#F59E0B" strokeWidth="3.5" strokeLinecap="round" opacity="0.9">
              <line x1="244" y1="8" x2="296" y2="34" />
              <line x1="296" y1="8" x2="244" y2="34" />
            </g>
            <circle cx="270" cy="14" r="5.5" fill="#F8FAFC" />
            <path
              d="M270 19.5 L270 32 M260 24 L280 24"
              stroke="#F8FAFC"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <text
              x="270"
              y="74"
              textAnchor="middle"
              fill="#F8FAFC"
              stroke="#0B0E14"
              strokeWidth="8"
              paintOrder="stroke fill"
              style={{
                fontFamily: '"Barlow Condensed", sans-serif',
                fontWeight: 800,
                fontSize: '62px',
                letterSpacing: '0.04em',
              }}
            >
              STICK FIGHT
            </text>
            <rect x="155" y="81" width="230" height="2.5" rx="1.25" fill="#F59E0B" />
            <text
              x="270"
              y="97"
              textAnchor="middle"
              fill="#CBD5E1"
              stroke="#0B0E14"
              strokeWidth="4"
              paintOrder="stroke fill"
              style={{
                fontFamily: '"Plus Jakarta Sans", sans-serif',
                fontWeight: 700,
                fontSize: '12px',
                letterSpacing: '0.28em',
              }}
            >
              ARENA BRAWL
            </text>
          </svg>

          {/* Compact Launch Controls Bar */}
          <div className="pointer-events-auto mt-1.5 w-full max-w-xl rounded-xl bg-[#121622]/94 border border-slate-700/90 p-3">
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <div className="grid grid-cols-4 gap-1 bg-[#0B0E15] p-1 rounded-lg border border-slate-800 flex-1">
                {MODE_OPTIONS.map((opt) => {
                  const active = config.mode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onChangeConfig({ ...config, mode: opt.id })}
                      className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        active
                          ? 'bg-amber-500 text-slate-950'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                data-start="true"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onStart();
                }}
                className="w-full sm:w-auto py-2 px-5 rounded-lg bg-amber-500 hover:bg-amber-400 active:translate-y-[1px] text-slate-950 font-display text-xl font-extrabold tracking-wider uppercase transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                Start Brawl
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs px-0.5">
              {hasBots ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">AI</span>
                  <div className="flex items-center gap-1 bg-[#0B0E15] p-0.5 rounded-md border border-slate-800">
                    {DIFFICULTY_OPTIONS.map((diff) => {
                      const active = config.difficulty === diff.id;
                      return (
                        <button
                          key={diff.id}
                          type="button"
                          onClick={() => onChangeConfig({ ...config, difficulty: diff.id })}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                            active
                              ? 'bg-slate-700 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {diff.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <span className="text-slate-400 font-medium">Shared 1v1</span>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-slate-400 font-medium">
                  <span>Arena</span>
                  <select
                    aria-label="Starting Arena"
                    value={config.startingArenaId}
                    onChange={(e) => onChangeConfig({ ...config, startingArenaId: e.target.value })}
                    className="bg-[#0B0E15] border border-slate-700 text-slate-200 rounded-md px-2 py-1 text-[11px] font-semibold cursor-pointer focus:outline-none focus:border-amber-400"
                  >
                    <option value="auto">Cycle All ({ARENAS.length})</option>
                    <option value="random">Random ({ARENAS.length})</option>
                    {ARENAS.map((arena, idx) => (
                      <option key={arena.id} value={arena.id}>
                        {idx + 1}. {arena.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-center gap-1">
                  <span className="text-slate-400 font-medium">First to</span>
                  <div className="flex items-center gap-1 bg-[#0B0E15] p-0.5 rounded-md border border-slate-800">
                    {[3, 5].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => onChangeConfig({ ...config, roundsToWin: r })}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums transition-colors cursor-pointer ${
                          config.roundsToWin === r
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onChangeConfig({ ...config, showVirtualPsPad: !config.showVirtualPsPad })}
                  aria-pressed={config.showVirtualPsPad}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
                    config.showVirtualPsPad
                      ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                      : 'bg-[#0B0E15] border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  PS Pad: {config.showVirtualPsPad ? 'On' : 'Off'}
                </button>

                <button
                  type="button"
                  onClick={() => setCustomizeOpen((prev) => !prev)}
                  aria-expanded={customizeOpen}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
                    customizeOpen
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                      : 'bg-[#0B0E15] border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  Customize
                </button>
              </div>
            </div>

            {/* Expandable Fighter Cosmetics & Splatter Drawer */}
            {customizeOpen && (
              <div className="mt-2.5 pt-2.5 border-t border-slate-800 text-left space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 bg-[#0B0E15] p-1 rounded-lg border border-slate-800">
                    {roster.map((slot) => {
                      const st = config.fighterStyles[slot.id] ?? config.fighterStyles[0];
                      const sw = COLOR_SWATCHES.find((c) => c.id === st.colorId) ?? COLOR_SWATCHES[0];
                      const active = safeSlot === slot.id;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={() => setSelectedSlot(slot.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                            active
                              ? 'bg-slate-700 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            style={{ backgroundColor: sw.primary }}
                          />
                          <span>{slot.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-400 font-medium">Splatter</span>
                    <div className="flex items-center gap-1 bg-[#0B0E15] p-0.5 rounded-md border border-slate-800">
                      <button
                        type="button"
                        onClick={() => onChangeConfig({ ...config, bloodStyle: 'crimson' })}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                          config.bloodStyle === 'crimson'
                            ? 'bg-rose-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Crimson
                      </button>
                      <button
                        type="button"
                        onClick={() => onChangeConfig({ ...config, bloodStyle: 'fighter_ink' })}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer ${
                          config.bloodStyle === 'fighter_ink'
                            ? 'bg-amber-500 text-slate-950 font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Fighter Ink
                      </button>
                    </div>
                  </div>
                </div>

                {/* Color Swatches + Pattern Options for selected fighter */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 font-medium mr-1">Color</span>
                    {COLOR_SWATCHES.map((sw) => {
                      const active = activeStyle.colorId === sw.id;
                      return (
                        <button
                          key={sw.id}
                          type="button"
                          title={sw.name}
                          aria-label={`Color ${sw.name}`}
                          onClick={() => updateFighterStyle(safeSlot, { colorId: sw.id })}
                          className={`w-6 h-6 rounded-md border-2 transition-transform cursor-pointer ${
                            active ? 'border-white scale-110' : 'border-slate-800 hover:scale-105'
                          }`}
                          style={{ backgroundColor: sw.primary }}
                        />
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1 bg-[#0B0E15] p-0.5 rounded-md border border-slate-800">
                    {PATTERN_OPTIONS.map((pat) => {
                      const active = activeStyle.pattern === pat.id;
                      return (
                        <button
                          key={pat.id}
                          type="button"
                          onClick={() => updateFighterStyle(safeSlot, { pattern: pat.id })}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                            active
                              ? 'bg-amber-500 text-slate-950 font-bold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {pat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="w-36 shrink-0 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="pointer-events-auto w-10 h-10 flex items-center justify-center rounded-lg bg-[#141925]/90 border border-slate-700/80 text-slate-200 hover:border-amber-400 hover:text-amber-300 transition-colors cursor-pointer shrink-0"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fillOpacity="0.2" />
              {muted ? (
                <>
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </>
              ) : (
                <>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Single flat control hint line in bottom safe margin */}
      <div className="flex justify-center">
        <p className="text-xs sm:text-sm font-medium text-slate-300/90 tracking-wide text-center [text-shadow:0_2px_4px_rgba(0,0,0,0.9)]">
          {isTwoPlayer
            ? 'P1: WASD Move · F Attack · G Block · E Throw   |   P2: Arrows Move · K Attack · L Block · U Throw   |   PS Stick: ✕ Jump · □ Attack · ○ Block · △ Throw'
            : 'WASD / Arrows Move · Space Jump · F Attack · G Block · E Throw   |   PS Stick: ✕ Jump · □ Attack · ○ Block · △ Throw'}
        </p>
      </div>
    </div>
  );
};
