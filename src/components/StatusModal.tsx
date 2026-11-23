import React from 'react';
import { GamePhase, MatchSummary } from '../game/types';

interface StatusModalProps {
  phase: GamePhase;
  summary: MatchSummary | null;
  onResume: () => void;
  onRestart: () => void;
  onBackToTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  phase,
  summary,
  onResume,
  onRestart,
  onBackToTitle,
}) => {
  if (phase === 'paused') {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/65 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Game Paused"
          className="w-full max-w-sm rounded-xl bg-[#121622] border border-slate-700 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.8)] animate-modal-pop"
        >
          <h2 className="font-display text-4xl font-extrabold tracking-wide uppercase text-white text-center">
            Paused
          </h2>
          <p className="mt-1 text-xs text-slate-400 text-center">
            Press Esc or P to resume the brawl
          </p>

          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={onResume}
              className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display text-xl font-bold tracking-wider uppercase transition-colors cursor-pointer"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm transition-colors cursor-pointer"
            >
              Restart Match
            </button>
            <button
              type="button"
              onClick={onBackToTitle}
              className="w-full py-2.5 px-4 rounded-lg bg-transparent border border-slate-700 hover:border-slate-500 text-slate-300 font-semibold text-sm transition-colors cursor-pointer"
            >
              Back to Title
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'gameover' && summary) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Match Result"
          className="w-full max-w-md rounded-xl bg-[#121622] border border-slate-700 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.85)] animate-modal-pop"
        >
          <div className="text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              {summary.isHumanWin ? 'Arena Champion' : 'Match Complete'}
            </span>
            <h2
              className="mt-1 font-display text-5xl font-extrabold tracking-wide uppercase"
              style={{ color: summary.winnerColor }}
            >
              {summary.winnerName} Wins
            </h2>
          </div>

          {/* Summary Telemetry Tiles */}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <div className="rounded-lg bg-[#0B0E15] border border-slate-800 px-3 py-2.5 text-center">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                Rounds Played
              </div>
              <div className="font-display text-2xl font-extrabold text-white tabular-nums mt-0.5">
                {summary.roundsPlayed}
              </div>
            </div>
            <div className="rounded-lg bg-[#0B0E15] border border-slate-800 px-3 py-2.5 text-center">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                Match Time
              </div>
              <div className="font-display text-2xl font-extrabold text-white tabular-nums mt-0.5">
                {summary.durationSeconds}s
              </div>
            </div>
          </div>

          {/* Fighter Breakdown */}
          <div className="mt-4 rounded-lg bg-[#0B0E15] border border-slate-800 divide-y divide-slate-800/80">
            {summary.playerStats.map((ps) => (
              <div key={ps.id} className="flex items-center justify-between px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: ps.color }}
                  />
                  <span className="font-semibold text-slate-100">{ps.name}</span>
                  {ps.pattern !== 'solid' && (
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                      {ps.pattern}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 tabular-nums text-slate-300">
                  <span>{ps.wins} W</span>
                  <span>{ps.kills} KO</span>
                  <span>{ps.damageDealt} DMG</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              data-start="true"
              onClick={onRestart}
              className="flex-1 py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display text-xl font-bold tracking-wider uppercase transition-colors cursor-pointer"
            >
              Play Again
            </button>
            <button
              type="button"
              onClick={onBackToTitle}
              className="py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm transition-colors cursor-pointer"
            >
              Title Screen
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
