import { useCallback, useEffect, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { StatusModal } from './components/StatusModal';
import { TitleOverlay } from './components/TitleOverlay';
import { loadSavedMatchConfig, saveMatchConfig } from './game/cosmetics';
import { StickFightEngine } from './game/engine';
import { VirtualPsPadState } from './game/gamepad';
import { GamePhase, HudSnapshot, MatchConfig, MatchSummary } from './game/types';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<StickFightEngine | null>(null);

  const [config, setConfig] = useState<MatchConfig>(() => loadSavedMatchConfig());
  const configRef = useRef(config);
  configRef.current = config;

  const [phase, setPhase] = useState<GamePhase>('title');
  const [hud, setHud] = useState<HudSnapshot>({
    phase: 'title',
    arenaName: 'Steel Foundry',
    arenaSubtitle: '',
    roundNumber: 1,
    roundsToWin: 3,
    roundBannerText: null,
    roundBannerSubtext: null,
    fighters: [],
    muted: false,
    mode: '1p_duel',
    connectedPads: 0,
    showVirtualPsPad: config.showVirtualPsPad,
    weatherKind: 'snowstorm',
    weatherLabel: 'Snowstorm',
    windDir: 1,
  });
  const [summary, setSummary] = useState<MatchSummary | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new StickFightEngine(canvas, {
      onHudUpdate: (snapshot) => setHud(snapshot),
      onPhaseChange: (nextPhase) => setPhase(nextPhase),
      onMatchEnd: (matchSummary) => setSummary(matchSummary),
    });

    engineRef.current = engine;
    engine.updateConfig(configRef.current);
    engine.start();

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.startNewMatch(configRef.current);
    } else {
      document.body.dataset.state = 'title';
    }

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const handleChangeConfig = useCallback((next: MatchConfig) => {
    setConfig(next);
    saveMatchConfig(next);
    engineRef.current?.updateConfig(next);
  }, []);

  const handleStart = useCallback(() => {
    setSummary(null);
    engineRef.current?.startNewMatch(configRef.current);
    canvasRef.current?.focus();
  }, []);

  const handleRestart = useCallback(() => {
    setSummary(null);
    engineRef.current?.restartMatch();
    canvasRef.current?.focus();
  }, []);

  const handleTogglePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleToggleMute = useCallback(() => {
    engineRef.current?.toggleMute();
  }, []);

  const handleToggleVirtualPsPad = useCallback(() => {
    const next = engineRef.current?.toggleVirtualPsPad();
    if (typeof next === 'boolean') {
      setConfig((prev) => ({ ...prev, showVirtualPsPad: next }));
    }
  }, []);

  const handleVirtualPsInput = useCallback((partial: Partial<VirtualPsPadState>) => {
    engineRef.current?.setVirtualPsInput(partial);
  }, []);

  const handleBackToTitle = useCallback(() => {
    setSummary(null);
    engineRef.current?.returnToTitle();
  }, []);

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#0e1118]">
      {/* Isolated Canvas Mount — never re-renders on HUD state updates */}
      <div className="fixed inset-0">
        <canvas
          ref={canvasRef}
          data-testid="game-canvas"
          tabIndex={0}
          className="block w-full h-full outline-none"
        />
      </div>

      {phase === 'title' && (
        <TitleOverlay
          config={config}
          onChangeConfig={handleChangeConfig}
          onStart={handleStart}
          muted={hud.muted}
          onToggleMute={handleToggleMute}
          connectedPads={hud.connectedPads}
        />
      )}

      {(phase === 'playing' || phase === 'paused') && (
        <HudOverlay
          hud={hud}
          onToggleMute={handleToggleMute}
          onTogglePause={handleTogglePause}
          onRestart={handleRestart}
          onToggleVirtualPsPad={handleToggleVirtualPsPad}
          onVirtualPsInput={handleVirtualPsInput}
        />
      )}

      {(phase === 'paused' || phase === 'gameover') && (
        <StatusModal
          phase={phase}
          summary={summary}
          onResume={handleTogglePause}
          onRestart={handleRestart}
          onBackToTitle={handleBackToTitle}
        />
      )}
    </main>
  );
}
