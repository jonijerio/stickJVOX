import { computeBotInput } from './ai';
import { ARENAS, cloneArena } from './arenas';
import {
  DEFAULT_FIGHTER_STYLES,
  DEFAULT_MATCH_CONFIG,
  resolveFighterPalette,
  saveMatchConfig,
} from './cosmetics';
import { mergeFighterInputs, PsGamepadHub, VirtualPsPadState } from './gamepad';
import { ParticleSystem } from './particles';
import { CameraState, renderFrame } from './renderer';
import {
  CameraShakeEventKind,
  computeCameraShakeImpulse,
  computeKillCamState,
  computeVictoryLimbEmitters,
  computeVictoryShakeResponse,
  evaluateMatchWinner,
  evaluateRoundOutcome,
  getLaserPhase,
  getModeRoster,
  getPendulumPosition,
  intersectsPlatform,
  pickRandomArenaDrop,
  pickRandomVictoryPose,
  pointToSegmentDistance,
  resolveHit,
  stepArenaItemPhysics,
} from './rules';
import { sound } from './sound';
import {
  AfterimageGhost,
  ArenaDefinition,
  ArenaItemKind,
  BeamEffect,
  Fighter,
  FighterInputState,
  FloatingCallout,
  GamePhase,
  HudSnapshot,
  ImpactFlashEffect,
  MatchConfig,
  MatchSummary,
  Projectile,
  ScreenFlashState,
  SlashArcEffect,
  WeaponPickup,
} from './types';
import { WEAPONS } from './weapons';

const GRAVITY = 1780;
const MOVE_ACCEL_GROUND = 2900;
const MOVE_ACCEL_AIR = 1750;
const MAX_RUN_SPEED = 370;
const JUMP_SPEED = -660;
const WALL_SLIDE_MAX_VY = 155;
const WALL_JUMP_VX = 420;
const WALL_JUMP_VY = -630;
const PROJECTILE_POOL_SIZE = 90;

export interface EngineCallbacks {
  onHudUpdate: (hud: HudSnapshot) => void;
  onPhaseChange: (phase: GamePhase) => void;
  onMatchEnd: (summary: MatchSummary) => void;
}

export class StickFightEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: EngineCallbacks;

  private rafId: number | null = null;
  private lastTs = 0;
  private viewW = 1280;
  private viewH = 720;
  private dpr = 1;

  private phase: GamePhase = 'title';
  private config: MatchConfig = {
    ...DEFAULT_MATCH_CONFIG,
    fighterStyles: DEFAULT_FIGHTER_STYLES.map((s) => ({ ...s })),
  };

  private arena: ArenaDefinition = cloneArena(ARENAS[0]);
  private arenaIndex = 0;
  private roundNumber = 1;
  private roundOverTimer = 0;
  private roundOverPending = false;
  private victorySequenceActive = false;
  private victoryWinnerId: number | null = null;
  private victorySequenceTimer = 0;
  private confettiShowerTimer = 0;
  private ribbonShowerTimer = 0;
  private victoryBloomIntensity = 0;
  private killCamActive = false;
  private killCamWinnerId: number | null = null;
  private killCamElapsed = 0;
  private killCamDuration = 2.0;
  private killCamVignette = 0;
  private roundBannerText: string | null = null;
  private roundBannerSubtext: string | null = null;
  private roundBannerTimer = 0;

  private elapsedTime = 0;
  private matchStartTime = 0;
  private hitstopTimer = 0;
  private timeScale = 1;
  private dropSpawnTimer = 2.5;
  private nextEntityId = 1;
  private hudSyncTimer = 0;
  private lastHudSignature = '';

  private fighters: Fighter[] = [];
  private pickups: WeaponPickup[] = [];
  private beams: BeamEffect[] = [];
  private slashes: SlashArcEffect[] = [];
  private particleSystem = new ParticleSystem(720, 180);
  private gamepadHub = new PsGamepadHub();
  private projectiles: Projectile[] = [];
  private projectileCursor = 0;

  private impactFlashes: ImpactFlashEffect[] = [];
  private impactFlashCursor = 0;
  private callouts: FloatingCallout[] = [];
  private calloutCursor = 0;
  private afterimages: AfterimageGhost[] = [];
  private afterimageCursor = 0;
  private afterimageSpawnCooldown = 0;
  private screenFlash: ScreenFlashState = { alpha: 0, color: '#FFFFFF' };

  private camera: CameraState = {
    x: 640,
    y: 360,
    zoom: 1,
    trauma: 0,
    kickX: 0,
    kickY: 0,
    shakeAngle: 0,
  };

  private keysHeld = new Set<string>();
  private keysJustPressed = new Set<string>();
  private keysJustReleased = new Set<string>();

  private resizeObserver: ResizeObserver | null = null;
  private pausedPadInterval: number | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas2D not supported');
    this.ctx = context;
    this.callbacks = callbacks;

    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      this.projectiles.push({
        active: false,
        id: 0,
        ownerId: -1,
        weaponId: 'pistol',
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
        vx: 0,
        vy: 0,
        radius: 4,
        damage: 10,
        knockbackX: 100,
        knockbackY: -50,
        life: 0,
        color: '#FBBF24',
        isRocket: false,
        explosionRadius: 0,
      });
    }

    for (let i = 0; i < 28; i++) {
      this.impactFlashes.push({
        active: false,
        x: 0,
        y: 0,
        radius: 24,
        color: '#FFFFFF',
        life: 0,
        maxLife: 0.14,
        spikes: 8,
        rot: 0,
        kind: 'starburst',
      });
    }

    for (let i = 0; i < 14; i++) {
      this.callouts.push({
        active: false,
        x: 0,
        y: 0,
        vy: -75,
        text: '',
        color: '#FDE047',
        life: 0,
        maxLife: 0.65,
        scale: 1,
      });
    }

    for (let i = 0; i < 24; i++) {
      this.afterimages.push({
        active: false,
        x: 0,
        y: 0,
        facing: 1,
        color: '#FFFFFF',
        life: 0,
        maxLife: 0.18,
        squashX: 1,
        squashY: 1,
      });
    }

    this.setupResize();
    this.setupInputListeners();
    this.initAttractMode();
  }

  private loopRunning = false;

  public start(): void {
    if (this.loopRunning) return;
    this.loopRunning = true;
    this.lastTs = performance.now();
    this.scheduleNextFrame();
  }

  private scheduleNextFrame(): void {
    if (!this.loopRunning) return;
    const isAutomation = typeof navigator !== 'undefined' && navigator.webdriver === true;
    const tick = (now: number) => {
      if (!this.loopRunning) return;
      const frameStart = performance.now();
      const rawDt = (now - this.lastTs) / 1000;
      this.lastTs = now;
      const dt = Math.min(Math.max(rawDt, 0), 0.05);

      if (this.phase === 'paused') {
        this.render();
        this.rafId = null;
        return;
      }

      this.update(dt);
      this.render();
      const frameElapsed = performance.now() - frameStart;
      if (isAutomation || frameElapsed > 12) {
        setTimeout(() => {
          if (this.loopRunning && this.phase !== 'paused') {
            this.rafId = requestAnimationFrame(tick);
          }
        }, isAutomation ? 120 : 16);
      } else {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public destroy(): void {
    this.loopRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.pausedPadInterval !== null) {
      window.clearInterval(this.pausedPadInterval);
      this.pausedPadInterval = null;
    }
    this.resizeObserver?.disconnect();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('pointerdown', this.handlePointerUnlock);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('gamepadconnected', this.handleGamepadChange);
    window.removeEventListener('gamepaddisconnected', this.handleGamepadChange);
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }

  public getPhase(): GamePhase {
    return this.phase;
  }

  public updateConfig(config: MatchConfig): void {
    this.config = {
      ...config,
      fighterStyles: config.fighterStyles.map((s) => ({ ...s })),
    };
    if (this.phase === 'title') {
      for (const f of this.fighters) {
        f.palette = resolveFighterPalette(f.id, this.config.fighterStyles[f.id]);
      }
    }
    if (!this.config.showVirtualPsPad) {
      this.gamepadHub.clearVirtualState();
    }
    this.emitHud(true);
  }

  public setVirtualPsInput(next: Partial<VirtualPsPadState>): void {
    this.gamepadHub.setVirtualState(next);
  }

  public toggleVirtualPsPad(): boolean {
    const next = !this.config.showVirtualPsPad;
    this.config = { ...this.config, showVirtualPsPad: next };
    if (!next) {
      this.gamepadHub.clearVirtualState();
    }
    saveMatchConfig(this.config);
    this.emitHud(true);
    return next;
  }

  public startNewMatch(config: MatchConfig): void {
    this.config = {
      ...config,
      fighterStyles: config.fighterStyles.map((s) => ({ ...s })),
    };
    this.roundNumber = 1;
    this.arenaIndex = this.resolveStartingArenaIndex(this.config.startingArenaId);
    this.matchStartTime = 0;
    this.elapsedTime = 0;
    this.clearVictoryState();
    this.setPhase('playing');

    const roster = getModeRoster(this.config);
    const archetypes: Array<'brawler' | 'sharpshooter' | 'trickster'> = [
      'brawler',
      'sharpshooter',
      'trickster',
    ];
    this.fighters = roster.map((r, idx) =>
      this.createFighter(r.id, r.name, r.isBot, archetypes[idx % archetypes.length])
    );

    this.setupRound(true);
  }

  public restartMatch(): void {
    this.startNewMatch(this.config);
  }

  public returnToTitle(): void {
    this.clearVictoryState();
    this.setPhase('title');
    this.initAttractMode();
  }

  private clearVictoryState(): void {
    this.victorySequenceActive = false;
    this.victoryWinnerId = null;
    this.victorySequenceTimer = 0;
    this.confettiShowerTimer = 0;
    this.ribbonShowerTimer = 0;
    this.victoryBloomIntensity = 0;
    this.killCamActive = false;
    this.killCamWinnerId = null;
    this.killCamElapsed = 0;
    this.killCamVignette = 0;
    if (typeof document !== 'undefined') {
      delete document.body.dataset.celebrating;
      delete document.body.dataset.victoryPose;
      delete document.body.dataset.victoryShake;
      delete document.body.dataset.victoryBloom;
      delete document.body.dataset.killCam;
      delete document.body.dataset.timeScale;
      delete document.body.dataset.cameraTrauma;
    }
  }

  public triggerCameraShake(
    kind: CameraShakeEventKind,
    magnitude = 1,
    dirX = 0,
    dirY = 0
  ): void {
    const impulse = computeCameraShakeImpulse(kind, magnitude, dirX, dirY);
    this.camera.trauma = Math.min(
      1,
      Math.max(this.camera.trauma + impulse.traumaAdd, impulse.traumaFloor)
    );
    this.camera.kickX += impulse.kickX;
    this.camera.kickY += impulse.kickY;
    this.camera.shakeAngle = Math.max(
      -0.045,
      Math.min(0.045, this.camera.shakeAngle + impulse.angleKick)
    );

    if (typeof document !== 'undefined') {
      document.body.dataset.cameraTrauma = this.camera.trauma.toFixed(2);
    }

    if (this.phase === 'playing' && (kind === 'explosion' || (kind === 'destruction' && magnitude >= 0.9))) {
      const rumbleStrength = Math.min(1, 0.45 * magnitude);
      const rumbleMs = Math.round(Math.min(260, 110 * magnitude));
      for (const f of this.fighters) {
        if (!f.isBot && f.alive) {
          this.gamepadHub.triggerRumble(f.id, rumbleStrength, rumbleMs);
        }
      }
    }
  }

  public togglePause(): void {
    if (this.phase === 'playing') {
      this.clearInputs();
      this.setPhase('paused');
    } else if (this.phase === 'paused') {
      this.clearInputs();
      this.setPhase('playing');
    }
  }

  public toggleMute(): boolean {
    const muted = sound.toggleMute();
    this.emitHud();
    return muted;
  }

  private setPhase(next: GamePhase): void {
    const prev = this.phase;
    this.phase = next;
    document.body.dataset.state = next;
    this.callbacks.onPhaseChange(next);
    this.emitHud(true);

    if (this.pausedPadInterval !== null) {
      window.clearInterval(this.pausedPadInterval);
      this.pausedPadInterval = null;
    }

    if (next === 'paused' && this.gamepadHub.getConnectedCount() > 0) {
      this.pausedPadInterval = window.setInterval(() => {
        const poll = this.gamepadHub.pollSlot(0, false);
        if (poll.optionsJustPressed) {
          this.togglePause();
        }
      }, 100);
    }

    if (next !== 'paused' && this.rafId === null && (prev === 'paused' || prev === 'gameover')) {
      this.lastTs = performance.now();
      this.scheduleNextFrame();
    }
  }

  private initAttractMode(): void {
    this.arenaIndex = 0;
    this.roundNumber = 1;
    this.fighters = [
      this.createFighter(0, 'Gold', true, 'brawler'),
      this.createFighter(1, 'Crimson', true, 'sharpshooter'),
      this.createFighter(2, 'Cyan', true, 'trickster'),
    ];
    this.setupRound(false);
    // Arm attract-mode fighters for immediate showcase spectacle
    if (this.fighters[1]) {
      this.fighters[1].weapon = 'pistol';
      this.fighters[1].ammo = WEAPONS.pistol.ammo;
    }
    if (this.fighters[2]) {
      this.fighters[2].weapon = 'katana';
      this.fighters[2].ammo = WEAPONS.katana.ammo;
    }
    this.roundBannerText = null;
    this.roundBannerSubtext = null;
  }

  private createFighter(
    id: number,
    name: string,
    isBot: boolean,
    aiArchetype: 'brawler' | 'sharpshooter' | 'trickster'
  ): Fighter {
    return {
      id,
      name,
      isBot,
      aiArchetype,
      palette: resolveFighterPalette(id, this.config.fighterStyles[id]),
      x: 200,
      y: 300,
      vx: 0,
      vy: 0,
      w: 24,
      h: 54,
      facing: id % 2 === 0 ? 1 : -1,
      aimAngle: id % 2 === 0 ? 0 : Math.PI,
      hp: 100,
      maxHp: 100,
      ghostHp: 100,
      alive: true,
      koTimer: 0,
      koReason: '',
      grounded: false,
      onIce: false,
      wallSlideDir: 0,
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      dropThroughTimer: 0,
      weapon: 'fists',
      ammo: Infinity,
      attackCooldown: 0,
      attackWindupTimer: 0,
      attackPending: false,
      attackActiveTimer: 0,
      comboStep: 0,
      comboResetTimer: 0,
      blocking: false,
      parryWindowTimer: 0,
      hitFlashTimer: 0,
      invulnTimer: 0,
      stunTimer: 0,
      squashX: 1,
      squashY: 1,
      walkCycle: 0,
      scarfWave: 0,
      kills: 0,
      damageDealt: 0,
      deaths: 0,
      wins: 0,
      ragdollSpin: 0,
      ragdollAngle: 0,
      victoryPose: null,
      victoryTimer: 0,
      aiThinkTimer: 0,
      aiTargetId: null,
      aiJumpTimer: 0,
      aiDesiredX: 640,
      aiAttackDecision: false,
      aiBlockTimer: 0,
    };
  }

  private setupRound(showBanner: boolean): void {
    this.arena = cloneArena(ARENAS[this.arenaIndex % ARENAS.length]);
    this.pickups = [];
    this.beams = [];
    this.slashes = [];
    this.roundOverPending = false;
    this.roundOverTimer = 0;
    this.clearVictoryState();
    this.timeScale = 1;
    this.hitstopTimer = 0;
    this.dropSpawnTimer = 1.6;
    this.camera = {
      x: this.arena.width * 0.5,
      y: this.arena.height * 0.5,
      zoom: 1,
      trauma: 0,
      kickX: 0,
      kickY: 0,
      shakeAngle: 0,
    };
    this.screenFlash.alpha = 0;
    this.afterimageSpawnCooldown = 0;

    for (const p of this.projectiles) p.active = false;
    for (const f of this.impactFlashes) f.active = false;
    for (const c of this.callouts) c.active = false;
    for (const g of this.afterimages) g.active = false;
    this.particleSystem.clearAll();

    this.fighters.forEach((f, idx) => {
      const sp = this.arena.spawns[idx % this.arena.spawns.length];
      f.x = sp.x - f.w * 0.5;
      f.y = sp.y - f.h;
      f.vx = 0;
      f.vy = 0;
      f.facing = sp.x < this.arena.width * 0.5 ? 1 : -1;
      f.aimAngle = f.facing > 0 ? 0 : Math.PI;
      f.hp = f.maxHp;
      f.ghostHp = f.maxHp;
      f.alive = true;
      f.koTimer = 0;
      f.koReason = '';
      f.grounded = false;
      f.weapon = 'fists';
      f.ammo = Infinity;
      f.attackCooldown = 0;
      f.attackPending = false;
      f.attackActiveTimer = 0;
      f.blocking = false;
      f.parryWindowTimer = 0;
      f.hitFlashTimer = 0;
      f.invulnTimer = 0.6;
      f.stunTimer = 0;
      f.squashX = 1;
      f.squashY = 1;
      f.ragdollAngle = 0;
      f.victoryPose = null;
      f.victoryTimer = 0;
    });

    // Spawn 2 initial aerial drops: guaranteed weapon + bonus random gun/sword/explosive crate
    const primarySpot = this.arena.weaponDrops[0];
    const secondarySpot = this.arena.weaponDrops[1 % this.arena.weaponDrops.length];
    this.spawnWeaponDrop(primarySpot.x, 95, 'weapon');
    this.spawnWeaponDrop(secondarySpot.x + (Math.random() * 48 - 24), 60);

    if (typeof document !== 'undefined') {
      document.body.dataset.arena = this.arena.id;
      document.body.dataset.pickups = String(this.pickups.length);
    }

    if (showBanner) {
      this.roundBannerText = `ROUND ${this.roundNumber}`;
      this.roundBannerSubtext = this.arena.name;
      this.roundBannerTimer = 1.6;
    }
    this.emitHud();
  }

  private resolveStartingArenaIndex(startingArenaId: string): number {
    if (startingArenaId === 'random') {
      return Math.floor(Math.random() * ARENAS.length);
    }
    if (startingArenaId && startingArenaId !== 'auto') {
      const idx = ARENAS.findIndex((a) => a.id === startingArenaId);
      if (idx >= 0) return idx;
    }
    return 0;
  }

  private pickNextArenaIndex(): number {
    if (this.config.startingArenaId === 'random' && ARENAS.length > 1) {
      let next = Math.floor(Math.random() * ARENAS.length);
      if (next === this.arenaIndex) {
        next = (next + 1) % ARENAS.length;
      }
      return next;
    }
    return (this.arenaIndex + 1) % ARENAS.length;
  }

  private setupResize(): void {
    const isAutomation = typeof navigator !== 'undefined' && navigator.webdriver === true;
    const updateSize = () => {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = isAutomation ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      this.viewW = Math.max(320, rect.width || window.innerWidth);
      this.viewH = Math.max(240, rect.height || window.innerHeight);
      this.canvas.width = Math.round(this.viewW * this.dpr);
      this.canvas.height = Math.round(this.viewH * this.dpr);
    };
    updateSize();
    this.resizeObserver = new ResizeObserver(updateSize);
    this.resizeObserver.observe(this.canvas);
  }

  private setupInputListeners(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('pointerdown', this.handlePointerUnlock);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('gamepadconnected', this.handleGamepadChange);
    window.addEventListener('gamepaddisconnected', this.handleGamepadChange);
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  private handleGamepadChange = (): void => {
    this.emitHud(true);
  };

  private handlePointerUnlock = (): void => {
    sound.unlock();
  };

  private clearInputs(): void {
    this.keysHeld.clear();
    this.keysJustPressed.clear();
    this.keysJustReleased.clear();
    this.gamepadHub.clearVirtualState();
  }

  private handleBlur = (): void => {
    this.clearInputs();
  };

  private handleVisibility = (): void => {
    if (document.hidden) this.clearInputs();
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    sound.unlock();
    const code = e.code;

    if (code === 'Escape' || code === 'KeyP') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        e.preventDefault();
        this.togglePause();
        return;
      }
    }

    if (code === 'KeyM' && !e.repeat) {
      this.toggleMute();
      return;
    }

    if (code === 'KeyR' && !e.repeat && (this.phase === 'playing' || this.phase === 'paused')) {
      this.restartMatch();
      return;
    }

    if (this.phase === 'playing') {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
        e.preventDefault();
      }
      if (!this.keysHeld.has(code)) {
        this.keysJustPressed.add(code);
      }
      this.keysHeld.add(code);
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    const code = e.code;
    this.keysHeld.delete(code);
    this.keysJustReleased.add(code);
  };

  private readHumanInput(fighterId: number): FighterInputState {
    const isSinglePlayer = this.config.mode === '1p_duel' || this.config.mode === '1p_ffa';

    if (fighterId === 0) {
      const left = this.keysHeld.has('KeyA') || (isSinglePlayer && this.keysHeld.has('ArrowLeft'));
      const right = this.keysHeld.has('KeyD') || (isSinglePlayer && this.keysHeld.has('ArrowRight'));
      const up = this.keysHeld.has('KeyW') || (isSinglePlayer && this.keysHeld.has('ArrowUp'));
      const down = this.keysHeld.has('KeyS') || (isSinglePlayer && this.keysHeld.has('ArrowDown'));
      const jumpJustPressed =
        this.keysJustPressed.has('KeyW') ||
        this.keysJustPressed.has('Space') ||
        (isSinglePlayer && this.keysJustPressed.has('ArrowUp'));
      const jumpHeld =
        this.keysHeld.has('KeyW') ||
        this.keysHeld.has('Space') ||
        (isSinglePlayer && this.keysHeld.has('ArrowUp'));
      const attackJustPressed =
        this.keysJustPressed.has('KeyF') ||
        (isSinglePlayer && this.keysJustPressed.has('KeyJ'));
      const attackHeld =
        this.keysHeld.has('KeyF') ||
        (isSinglePlayer && this.keysHeld.has('KeyJ'));
      const blockHeld =
        this.keysHeld.has('KeyG') ||
        (isSinglePlayer && this.keysHeld.has('KeyK'));
      const blockJustPressed =
        this.keysJustPressed.has('KeyG') ||
        (isSinglePlayer && this.keysJustPressed.has('KeyK'));
      const throwJustPressed =
        this.keysJustPressed.has('KeyE') ||
        (isSinglePlayer && this.keysJustPressed.has('KeyL'));

      return {
        left,
        right,
        up,
        down,
        jumpJustPressed,
        jumpHeld,
        attackJustPressed,
        attackHeld,
        blockHeld,
        blockJustPressed,
        throwJustPressed,
      };
    }

    // Player 2 controls in Local 2P modes
    return {
      left: this.keysHeld.has('ArrowLeft'),
      right: this.keysHeld.has('ArrowRight'),
      up: this.keysHeld.has('ArrowUp'),
      down: this.keysHeld.has('ArrowDown'),
      jumpJustPressed: this.keysJustPressed.has('ArrowUp'),
      jumpHeld: this.keysHeld.has('ArrowUp'),
      attackJustPressed: this.keysJustPressed.has('KeyK') || this.keysJustPressed.has('Slash'),
      attackHeld: this.keysHeld.has('KeyK') || this.keysJustPressed.has('Slash'),
      blockHeld: this.keysHeld.has('KeyL') || this.keysHeld.has('Period'),
      blockJustPressed: this.keysJustPressed.has('KeyL') || this.keysJustPressed.has('Period'),
      throwJustPressed: this.keysJustPressed.has('KeyU') || this.keysJustPressed.has('Quote'),
    };
  }

  private update(dt: number): void {
    if (this.phase === 'paused') {
      this.keysJustPressed.clear();
      this.keysJustReleased.clear();
      return;
    }

    if (this.phase === 'gameover') {
      this.camera.trauma = Math.max(0, this.camera.trauma - dt * 2.1);
      this.screenFlash.alpha = Math.max(0, this.screenFlash.alpha - dt * 3.8);
      const kickDamp = Math.pow(0.001, dt);
      this.camera.kickX *= kickDamp;
      this.camera.kickY *= kickDamp;
      this.camera.shakeAngle *= kickDamp;
      if (typeof document !== 'undefined') {
        document.body.dataset.cameraTrauma = this.camera.trauma.toFixed(2);
      }
      this.elapsedTime += dt;
      this.updateVictorySequence(dt, 0.7);
      this.updateEffects(dt);
      this.particleSystem.update(dt, this.arena.platforms);
      this.updateCamera(dt);
      this.keysJustPressed.clear();
      this.keysJustReleased.clear();
      return;
    }

    // Visual-only timers always advance in real dt
    this.camera.trauma = Math.max(0, this.camera.trauma - dt * 2.1);
    this.screenFlash.alpha = Math.max(0, this.screenFlash.alpha - dt * 3.8);
    const kickDamp = Math.pow(0.001, dt);
    this.camera.kickX *= kickDamp;
    this.camera.kickY *= kickDamp;
    this.camera.shakeAngle *= kickDamp;
    if (typeof document !== 'undefined') {
      document.body.dataset.cameraTrauma = this.camera.trauma.toFixed(2);
    }
    if (this.afterimageSpawnCooldown > 0) {
      this.afterimageSpawnCooldown = Math.max(0, this.afterimageSpawnCooldown - dt);
    }

    if (this.roundBannerTimer > 0) {
      this.roundBannerTimer = Math.max(0, this.roundBannerTimer - dt);
      if (this.roundBannerTimer === 0) {
        this.roundBannerText = null;
        this.roundBannerSubtext = null;
      }
    }

    // Hitstop freeze frame (0.03s - 0.08s on heavy hits/parries/KOs)
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      this.particleSystem.update(dt * 0.25, this.arena.platforms);
      this.keysJustPressed.clear();
      this.keysJustReleased.clear();
      return;
    }

    const simDt = dt * this.timeScale;
    this.elapsedTime += simDt;
    if (this.phase === 'playing' && !this.victorySequenceActive) {
      this.matchStartTime += dt;
    }

    // Physics-enabled aerial item spawner (guns, swords, and explosive crates)
    if (!this.victorySequenceActive) {
      this.dropSpawnTimer -= simDt;
      if (this.dropSpawnTimer <= 0 && this.pickups.length < 4) {
        const spot =
          this.arena.weaponDrops[Math.floor(Math.random() * this.arena.weaponDrops.length)];
        this.spawnWeaponDrop(spot.x + (Math.random() * 84 - 42), -16);
        this.dropSpawnTimer = 3.8 + Math.random() * 2.2;
      }
    }

    // Update fighters (with keyboard + PS Gamepad / Virtual PS Pad merging)
    let padPaused = false;
    for (const f of this.fighters) {
      if (!f.alive) {
        f.koTimer = Math.max(0, f.koTimer - simDt);
        f.vy += GRAVITY * simDt;
        const prevBottom = f.y + f.h;
        f.x += f.vx * simDt;
        f.y += f.vy * simDt;
        f.ragdollAngle += f.ragdollSpin * simDt;

        // Bounce tumbling KO ragdoll off solid platforms & arena walls
        if (f.x < 24) {
          f.x = 24;
          f.vx = Math.abs(f.vx) * 0.45;
          f.ragdollSpin = -f.ragdollSpin * 0.7;
        } else if (f.x + f.w > this.arena.width - 24) {
          f.x = this.arena.width - 24 - f.w;
          f.vx = -Math.abs(f.vx) * 0.45;
          f.ragdollSpin = -f.ragdollSpin * 0.7;
        }
        for (const plat of this.arena.platforms) {
          if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
          if (!intersectsPlatform(f.x, f.y, f.w, f.h, plat)) continue;
          if (plat.kind === 'oneway' && (f.vy < 0 || prevBottom > plat.y + 14)) continue;
          if (f.vy >= 0 && prevBottom <= plat.y + 22) {
            f.y = plat.y - f.h;
            if (Math.abs(f.vy) > 160) {
              f.vy = -Math.abs(f.vy) * 0.45;
              f.vx *= 0.78;
              f.ragdollSpin *= 0.75;
              this.particleSystem.emitDust(f.x + f.w * 0.5, plat.y, 4, 120, '#CBD5E1');
            } else {
              f.vy = 0;
              f.vx *= 0.88;
              f.ragdollSpin *= 0.85;
            }
          }
        }

        // Blood & speed trails on airborne ragdolls
        const ragSpeed = Math.hypot(f.vx, f.vy);
        if (f.koTimer > 0 && ragSpeed > 220 && Math.random() < 0.55) {
          this.particleSystem.spawn({
            category: 'blood',
            x: f.x + f.w * 0.5,
            y: f.y + f.h * 0.45,
            vx: -f.vx * 0.12 + (Math.random() * 40 - 20),
            vy: -f.vy * 0.12 - 20,
            size: 3 + Math.random() * 2.5,
            color: this.getBloodColor(f),
            maxLife: 0.45,
            gravity: 960,
            drag: 0.4,
            shape: 'droplet',
            alpha: 0.9,
            paintDecalOnHit: true,
          });
        }
        if (f.koTimer > 0 && ragSpeed > 420 && this.afterimageSpawnCooldown <= 0) {
          this.spawnAfterimage(f);
        }
        continue;
      }

      if (this.victorySequenceActive && f.id === this.victoryWinnerId && f.victoryPose) {
        this.updateVictoryFighter(f, simDt);
        continue;
      }

      let input: FighterInputState;
      if (f.isBot) {
        input = computeBotInput(
          f,
          this.fighters,
          this.arena,
          this.pickups,
          this.projectiles,
          this.config.difficulty,
          this.roundNumber,
          this.elapsedTime,
          simDt
        );
      } else {
        const kbd = this.readHumanInput(f.id);
        const padPoll = this.gamepadHub.pollSlot(
          f.id,
          f.id === 0 && this.config.showVirtualPsPad
        );
        if (padPoll.optionsJustPressed && this.phase === 'playing' && !this.victorySequenceActive) {
          padPaused = true;
          break;
        }
        input = mergeFighterInputs(kbd, padPoll.input);
      }

      this.updateFighter(f, input, simDt);
      if (Math.hypot(f.vx, f.vy) > 480 && this.afterimageSpawnCooldown <= 0) {
        this.spawnAfterimage(f);
      }
    }

    if (padPaused) {
      this.togglePause();
      this.keysJustPressed.clear();
      this.keysJustReleased.clear();
      return;
    }

    this.updatePickups(simDt);
    this.updateProjectiles(simDt);
    this.updateHazards(simDt);
    this.updateEffects(simDt);
    this.particleSystem.update(simDt, this.arena.platforms);
    if (this.victorySequenceActive) {
      this.updateVictorySequence(dt, 0.44);
    }
    this.updateCamera(dt);

    // Evaluate round & match victory transitions
    if (this.victorySequenceActive) {
      this.victorySequenceTimer -= dt;
      if (this.victorySequenceTimer <= 0) {
        const winner = this.fighters.find((f) => f.id === this.victoryWinnerId) ?? this.fighters[0];
        this.victorySequenceActive = false;
        this.setPhase('gameover');
        this.callbacks.onMatchEnd({
          winnerId: winner.id,
          winnerName: winner.name,
          winnerColor: winner.palette.primary,
          isHumanWin: !winner.isBot,
          roundsPlayed: this.roundNumber,
          roundsToWin: this.config.roundsToWin,
          durationSeconds: Math.round(this.matchStartTime),
          victoryPose: winner.victoryPose ?? undefined,
          playerStats: this.fighters.map((f) => ({
            id: f.id,
            name: f.name,
            color: f.palette.primary,
            pattern: f.palette.pattern,
            isBot: f.isBot,
            wins: f.wins,
            kills: f.kills,
            damageDealt: Math.round(f.damageDealt),
          })),
        });
      }
    } else if (!this.roundOverPending) {
      const outcome = evaluateRoundOutcome(this.fighters);
      if (outcome.roundOver) {
        this.roundOverPending = true;
        this.roundOverTimer = 1.25;
        this.timeScale = 0.35; // Crisp slow-mo KO beat!

        if (this.phase === 'playing') {
          if (outcome.winnerId !== null) {
            const winFighter = this.fighters.find((f) => f.id === outcome.winnerId);
            if (winFighter) {
              winFighter.wins += 1;
              const matchClinched = winFighter.wins >= this.config.roundsToWin;
              if (matchClinched) {
                this.killCamActive = true;
                this.killCamWinnerId = winFighter.id;
                this.killCamElapsed = 0;
                this.killCamDuration = 2.0;
                this.roundOverTimer = this.killCamDuration;
                winFighter.invulnTimer = Math.max(winFighter.invulnTimer, this.killCamDuration + 0.5);
                const kc = computeKillCamState(0, this.killCamDuration);
                this.timeScale = kc.timeScale;
                this.killCamVignette = kc.vignetteAlpha;
                if (typeof document !== 'undefined') {
                  document.body.dataset.killCam = '1';
                  document.body.dataset.timeScale = kc.timeScale.toFixed(2);
                }
              }
              this.roundBannerText = `${winFighter.name.toUpperCase()} WINS`;
              this.roundBannerSubtext = matchClinched ? 'Final KO · Slow-Mo Kill-Cam' : 'Round Clear';
              this.roundBannerTimer = matchClinched ? 2.0 : 1.5;
            }
          } else {
            this.roundBannerText = 'DOUBLE KO';
            this.roundBannerSubtext = 'Draw Round';
            this.roundBannerTimer = 1.5;
          }
          this.emitHud();
        }
      }
    } else {
      if (this.killCamActive) {
        this.killCamElapsed = Math.min(this.killCamDuration, this.killCamElapsed + dt);
        const kc = computeKillCamState(this.killCamElapsed, this.killCamDuration);
        this.timeScale = kc.timeScale;
        this.killCamVignette = kc.vignetteAlpha;
        if (typeof document !== 'undefined') {
          document.body.dataset.timeScale = kc.timeScale.toFixed(2);
        }
      }
      this.roundOverTimer -= dt;
      if (this.roundOverTimer <= 0) {
        if (this.phase === 'title') {
          this.arenaIndex = (this.arenaIndex + 1) % ARENAS.length;
          this.setupRound(false);
        } else {
          const matchWinnerId = evaluateMatchWinner(this.fighters, this.config.roundsToWin);
          if (matchWinnerId !== null) {
            const winner = this.fighters.find((f) => f.id === matchWinnerId)!;
            this.startVictorySequence(winner);
          } else {
            this.roundNumber += 1;
            this.arenaIndex = this.pickNextArenaIndex();
            this.setupRound(true);
          }
        }
      }
    }

    if (this.phase === 'playing') {
      this.hudSyncTimer += dt;
      if (this.hudSyncTimer >= 0.08) {
        this.hudSyncTimer = 0;
        this.emitHud();
      }
    }

    this.keysJustPressed.clear();
    this.keysJustReleased.clear();
  }

  private startVictorySequence(winner: Fighter): void {
    const pose = pickRandomVictoryPose();
    this.roundOverPending = false;
    this.killCamActive = false;
    this.killCamWinnerId = null;
    this.killCamElapsed = 0;
    this.killCamVignette = 0;
    this.victorySequenceActive = true;
    this.victoryWinnerId = winner.id;
    this.victorySequenceTimer = 2.1;
    this.confettiShowerTimer = 0.42;
    this.ribbonShowerTimer = 0.55;
    this.victoryBloomIntensity = 1;
    this.timeScale = 1;
    if (typeof document !== 'undefined') {
      delete document.body.dataset.killCam;
      delete document.body.dataset.timeScale;
    }

    winner.alive = true;
    winner.hp = Math.max(10, winner.hp);
    winner.invulnTimer = 999;
    winner.stunTimer = 0;
    winner.hitFlashTimer = 0;
    winner.blocking = false;
    winner.attackPending = false;
    winner.attackActiveTimer = 0;
    winner.weapon = 'fists';
    winner.ammo = Infinity;
    winner.vx *= 0.25;
    winner.victoryPose = pose;
    winner.victoryTimer = 0;

    // Ensure winner stays clearly visible on stage if KO happened near a ledge
    if (winner.y > this.arena.height * 0.72) {
      const safeSpawn = this.arena.spawns[0];
      winner.x = safeSpawn.x - winner.w * 0.5;
      winner.y = safeSpawn.y - winner.h - 12;
      winner.vx = 0;
      winner.vy = 0;
    }

    if (typeof document !== 'undefined') {
      document.body.dataset.celebrating = '1';
      document.body.dataset.victoryPose = pose;
      document.body.dataset.victoryShake = '1.00';
      document.body.dataset.victoryBloom = '1.00';
    }

    const winCenterX = winner.x + winner.w * 0.5;
    const winCenterY = winner.y + winner.h * 0.5;
    const limbEmitters = computeVictoryLimbEmitters(
      winCenterX,
      winner.y + winner.h,
      pose,
      0,
      winner.facing,
      winner.grounded,
      winner.squashX,
      winner.squashY
    );
    this.particleSystem.emitLimbExplosiveConfetti(limbEmitters, winner.palette.primary, 11);
    this.particleSystem.emitOversizedRibbons(winCenterX, winner.y, winner.palette.primary, 12);
    this.particleSystem.emitVictoryCelebration(
      winCenterX,
      winner.y + 6,
      winner.palette.primary,
      1.35
    );
    this.particleSystem.emitRing(winCenterX, winCenterY, 56, winner.palette.primary, 0.36);
    this.spawnImpactFlash(winCenterX, winCenterY, 44, '#FDE047', 10, 'starburst');
    this.spawnCallout(winCenterX, winner.y - 46, 'CHAMPION!', '#FDE047', 1.3);
    this.screenFlash = { alpha: 0.2, color: '#FEF08A' };
    this.camera.trauma = Math.min(1, this.camera.trauma + 0.65);
    this.camera.kickY -= 12;
    sound.playVictory();
    sound.playFirework();
    if (!winner.isBot) {
      this.gamepadHub.triggerRumble(winner.id, 0.7, 220);
    }

    this.roundBannerText = `${winner.name.toUpperCase()} WINS`;
    this.roundBannerSubtext =
      pose === 'wave' ? 'Victory Wave' : pose === 'jump' ? 'Victory Leap' : 'Champion Flex';
    this.roundBannerTimer = 2.2;
    this.emitHud(true);
  }

  private updateVictorySequence(dt: number, showerInterval: number): void {
    if (this.victoryWinnerId === null) return;
    const winner = this.fighters.find((f) => f.id === this.victoryWinnerId);
    if (!winner) return;

    if (this.phase === 'gameover') {
      this.updateVictoryFighter(winner, dt);
    }

    this.confettiShowerTimer -= dt;
    if (this.confettiShowerTimer <= 0) {
      this.confettiShowerTimer = showerInterval;
      const winCenterX = winner.x + winner.w * 0.5;
      const limbEmitters = computeVictoryLimbEmitters(
        winCenterX,
        winner.y + winner.h,
        winner.victoryPose ?? 'wave',
        winner.victoryTimer,
        winner.facing,
        winner.grounded,
        winner.squashX,
        winner.squashY
      );
      this.particleSystem.emitLimbExplosiveConfetti(
        limbEmitters,
        winner.palette.primary,
        this.phase === 'gameover' ? 5 : 8
      );
      this.particleSystem.emitVictoryCelebration(
        winCenterX,
        winner.y + 4,
        winner.palette.primary,
        this.phase === 'gameover' ? 0.75 : 1.0
      );
      this.camera.trauma = Math.min(
        1,
        this.camera.trauma + (this.phase === 'gameover' ? 0.16 : 0.28)
      );
      if (!sound.isMuted()) {
        sound.playFirework();
      }
    }

    this.ribbonShowerTimer -= dt;
    if (this.ribbonShowerTimer <= 0) {
      this.ribbonShowerTimer = this.phase === 'gameover' ? 0.85 : 0.6;
      this.particleSystem.emitOversizedRibbons(
        winner.x + winner.w * 0.5,
        winner.y,
        winner.palette.primary,
        this.phase === 'gameover' ? 6 : 9
      );
    }
  }

  private updateVictoryFighter(f: Fighter, dt: number): void {
    const prevTimer = f.victoryTimer;
    f.victoryTimer += dt;
    f.hitFlashTimer = 0;
    f.squashX += (1 - f.squashX) * Math.min(1, dt * 14);
    f.squashY += (1 - f.squashY) * Math.min(1, dt * 14);
    f.vx *= Math.pow(0.05, dt);

    let justJumped = false;
    if (f.victoryPose === 'jump' && f.grounded) {
      f.vy = -510;
      f.vx += Math.sin(f.victoryTimer * 2.4) * 145;
      f.grounded = false;
      f.squashX = 0.78;
      f.squashY = 1.26;
      justJumped = true;
      this.particleSystem.emitDust(f.x + f.w * 0.5, f.y + f.h, 8, 150, '#E2E8F0');
    }

    f.vy += GRAVITY * dt;
    f.x = Math.max(80, Math.min(this.arena.width - 80 - f.w, f.x + f.vx * dt));

    const prevGrounded = f.grounded;
    const prevBottom = f.y + f.h;
    const preLandVy = f.vy;
    f.y += f.vy * dt;
    f.grounded = false;

    let justLanded = false;
    let landingVy = 0;

    for (const plat of this.arena.platforms) {
      if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
      if (!intersectsPlatform(f.x, f.y, f.w, f.h, plat)) continue;

      if (plat.kind === 'oneway') {
        if (f.vy >= 0 && prevBottom <= plat.y + 12) {
          if (!prevGrounded && preLandVy > 180) {
            justLanded = true;
            landingVy = preLandVy;
            f.squashX = 1.24;
            f.squashY = 0.78;
          }
          f.y = plat.y - f.h;
          f.vy = 0;
          f.grounded = true;
        }
        continue;
      }

      if (f.vy >= 0 && prevBottom <= plat.y + 18) {
        if (!prevGrounded && preLandVy > 180) {
          justLanded = true;
          landingVy = preLandVy;
          f.squashX = 1.26;
          f.squashY = 0.76;
        }
        f.y = plat.y - f.h;
        f.vy = 0;
        f.grounded = true;
        f.onIce = plat.kind === 'ice';
      } else if (f.vy < 0 && plat.kind !== 'bounce') {
        f.y = plat.y + plat.h;
        f.vy = 0;
      }
    }

    // Safety net if celebration started mid-air without ground below
    if (f.y > this.arena.height - 90) {
      const sp = this.arena.spawns[0];
      f.x = sp.x - f.w * 0.5;
      f.y = sp.y - f.h;
      f.vy = 0;
      f.grounded = true;
    }

    // Apply movement-reactive victory screen-shake & celebratory stomp bursts
    const pose = f.victoryPose ?? 'wave';
    const shake = computeVictoryShakeResponse(
      pose,
      prevTimer,
      f.victoryTimer,
      f.vx,
      f.vy,
      f.grounded,
      justLanded,
      justJumped,
      landingVy,
      f.facing
    );

    const phaseScale = this.phase === 'gameover' ? 0.55 : 1;
    this.camera.trauma = Math.min(
      1,
      Math.max(this.camera.trauma, shake.minTrauma * phaseScale) +
        shake.impulseTrauma * phaseScale
    );
    this.camera.kickX += shake.kickX * phaseScale;
    this.camera.kickY += shake.kickY * phaseScale;

    if (justLanded && landingVy > 220) {
      const fx = f.x + f.w * 0.5;
      const fy = f.y + f.h;
      this.particleSystem.emitDust(fx, fy, 10, 190, '#E2E8F0');
      this.particleSystem.emitRing(fx, fy - 4, 34, f.palette.primary, 0.26);
      if (this.phase === 'playing') sound.playLand();
    } else if (shake.impulseTrauma > 0.25 && f.grounded) {
      this.particleSystem.emitDust(f.x + f.w * 0.5, f.y + f.h, 4, 110, '#CBD5E1');
      this.particleSystem.emitSparks(
        f.x + f.w * 0.5,
        f.y + f.h * 0.35,
        f.palette.primary,
        4,
        160
      );
    }

    this.victoryBloomIntensity = Math.max(
      shake.intensity,
      this.victoryBloomIntensity * Math.pow(0.12, dt)
    );

    if (typeof document !== 'undefined') {
      document.body.dataset.victoryShake = shake.intensity.toFixed(2);
      document.body.dataset.victoryBloom = this.victoryBloomIntensity.toFixed(2);
    }
  }

  private updateFighter(f: Fighter, input: FighterInputState, dt: number): void {
    // Timers
    f.hitFlashTimer = Math.max(0, f.hitFlashTimer - dt);
    f.invulnTimer = Math.max(0, f.invulnTimer - dt);
    f.stunTimer = Math.max(0, f.stunTimer - dt);
    f.attackCooldown = Math.max(0, f.attackCooldown - dt);
    f.attackActiveTimer = Math.max(0, f.attackActiveTimer - dt);
    f.comboResetTimer = Math.max(0, f.comboResetTimer - dt);
    f.dropThroughTimer = Math.max(0, f.dropThroughTimer - dt);
    f.parryWindowTimer = Math.max(0, f.parryWindowTimer - dt);

    // Delayed ghost HP bar drain
    if (f.ghostHp > f.hp) {
      f.ghostHp = Math.max(f.hp, f.ghostHp - dt * 42);
    } else {
      f.ghostHp = f.hp;
    }

    // Damped squash-and-stretch recovery
    f.squashX += (1 - f.squashX) * Math.min(1, dt * 15);
    f.squashY += (1 - f.squashY) * Math.min(1, dt * 15);

    // Block & Parry window
    if (input.blockHeld && f.stunTimer <= 0 && !f.attackPending) {
      if (!f.blocking && input.blockJustPressed) {
        f.parryWindowTimer = 0.16;
      }
      f.blocking = true;
    } else {
      f.blocking = false;
    }

    // Movement & 360° Right-Stick Aim Override
    const moveDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (
      !f.isBot &&
      input.aimAngleOverride !== null &&
      input.aimAngleOverride !== undefined
    ) {
      f.aimAngle = input.aimAngleOverride;
      if (!f.blocking && f.stunTimer <= 0) {
        f.facing = Math.cos(f.aimAngle) >= 0 ? 1 : -1;
      }
    } else if (moveDir !== 0 && !f.blocking && f.stunTimer <= 0) {
      f.facing = moveDir as 1 | -1;
      if (!f.isBot) {
        f.aimAngle = f.facing > 0 ? 0 : Math.PI;
        if (input.up) f.aimAngle = f.facing > 0 ? -0.65 : Math.PI + 0.65;
        if (input.down) f.aimAngle = f.facing > 0 ? 0.5 : Math.PI - 0.5;
      }
    } else if (!f.isBot) {
      f.aimAngle = f.facing > 0 ? 0 : Math.PI;
      if (input.up) f.aimAngle = -Math.PI * 0.5;
    }

    const accel = f.grounded ? (f.onIce ? 950 : MOVE_ACCEL_GROUND) : MOVE_ACCEL_AIR;
    const maxSpd = f.blocking ? MAX_RUN_SPEED * 0.45 : MAX_RUN_SPEED;

    if (f.stunTimer <= 0) {
      if (moveDir !== 0) {
        f.vx += moveDir * accel * dt;
        if (Math.abs(f.vx) > maxSpd && Math.sign(f.vx) === moveDir) {
          // Allow excess knockback speed to decay smoothly
          f.vx -= Math.sign(f.vx) * 1400 * dt;
        }
      } else {
        const friction = f.grounded ? (f.onIce ? 260 : 2400) : 380;
        if (Math.abs(f.vx) <= friction * dt) f.vx = 0;
        else f.vx -= Math.sign(f.vx) * friction * dt;
      }
    }

    // Drop through one-way platform
    if (input.down && f.grounded) {
      f.dropThroughTimer = 0.18;
      f.grounded = false;
    }

    // Coyote time & jump buffering
    if (f.grounded) f.coyoteTimer = 0.1;
    else f.coyoteTimer = Math.max(0, f.coyoteTimer - dt);

    if (input.jumpJustPressed) f.jumpBufferTimer = 0.12;
    else f.jumpBufferTimer = Math.max(0, f.jumpBufferTimer - dt);

    if (f.jumpBufferTimer > 0 && f.stunTimer <= 0) {
      if (f.coyoteTimer > 0) {
        f.vy = JUMP_SPEED;
        f.grounded = false;
        f.coyoteTimer = 0;
        f.jumpBufferTimer = 0;
        f.squashX = 0.82;
        f.squashY = 1.22;
        this.particleSystem.emitDust(
          f.x + f.w * 0.5,
          f.y + f.h,
          6,
          125,
          f.onIce ? '#BAE6FD' : '#CBD5E1'
        );
        if (this.phase === 'playing') sound.playJump();
      } else if (f.wallSlideDir !== 0) {
        f.vx = -f.wallSlideDir * WALL_JUMP_VX;
        f.vy = WALL_JUMP_VY;
        f.facing = (-f.wallSlideDir) as 1 | -1;
        f.wallSlideDir = 0;
        f.jumpBufferTimer = 0;
        f.squashX = 0.82;
        f.squashY = 1.2;
        this.particleSystem.emitDust(f.x + f.w * 0.5, f.y + f.h * 0.5, 6, 130, '#CBD5E1');
        if (this.phase === 'playing') sound.playJump();
      }
    }

    // Variable jump cut
    if (!input.jumpHeld && f.vy < -180) {
      f.vy *= Math.pow(0.45, dt * 18);
    }

    // Gravity & Wall Slide
    f.vy += GRAVITY * dt;
    if (f.wallSlideDir !== 0 && f.vy > WALL_SLIDE_MAX_VY) {
      f.vy = WALL_SLIDE_MAX_VY;
      if (Math.random() < 0.35) {
        this.particleSystem.emitDust(
          f.wallSlideDir > 0 ? f.x + f.w : f.x,
          f.y + f.h * 0.65,
          1,
          55,
          '#94A3B8'
        );
      }
    }

    // Integrate X + solid horizontal collisions
    const prevGrounded = f.grounded;
    f.x += f.vx * dt;
    f.wallSlideDir = 0;

    for (const plat of this.arena.platforms) {
      if (plat.kind === 'oneway') continue;
      if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
      if (intersectsPlatform(f.x, f.y, f.w, f.h, plat)) {
        if (f.vx > 0) {
          f.x = plat.x - f.w;
          f.vx = 0;
          if (!f.grounded && input.right) f.wallSlideDir = 1;
        } else if (f.vx < 0) {
          f.x = plat.x + plat.w;
          f.vx = 0;
          if (!f.grounded && input.left) f.wallSlideDir = -1;
        }
      }
    }

    // Soft arena wall bounds
    if (f.x < 24) {
      f.x = 24;
      f.vx = Math.max(0, f.vx);
    } else if (f.x + f.w > this.arena.width - 24) {
      f.x = this.arena.width - 24 - f.w;
      f.vx = Math.min(0, f.vx);
    }

    // Integrate Y + vertical platform collisions
    const prevBottom = f.y + f.h;
    f.y += f.vy * dt;
    f.grounded = false;
    f.onIce = false;

    for (const plat of this.arena.platforms) {
      if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
      if (!intersectsPlatform(f.x, f.y, f.w, f.h, plat)) continue;

      if (plat.kind === 'oneway') {
        if (f.vy >= 0 && prevBottom <= plat.y + 10 && f.dropThroughTimer <= 0) {
          f.y = plat.y - f.h;
          f.vy = 0;
          f.grounded = true;
        }
        continue;
      }

      if (f.vy >= 0 && prevBottom <= plat.y + 18) {
        if (plat.kind === 'bounce') {
          f.y = plat.y - f.h;
          f.vy = plat.bounceForce ?? -920;
          f.grounded = false;
          f.squashX = 0.78;
          f.squashY = 1.28;
          this.particleSystem.emitSparks(f.x + f.w * 0.5, plat.y, '#10B981', 10, 180);
          this.particleSystem.emitDust(f.x + f.w * 0.5, plat.y, 5, 130, '#A7F3D0');
          if (this.phase === 'playing') sound.playJump();
        } else {
          if (!prevGrounded && f.vy > 220) {
            f.squashX = 1.24;
            f.squashY = 0.78;
            this.particleSystem.emitDust(
              f.x + f.w * 0.5,
              plat.y,
              Math.min(10, Math.round(f.vy / 85)),
              145,
              plat.kind === 'ice' ? '#BAE6FD' : '#CBD5E1'
            );
            if (this.phase === 'playing') sound.playLand();
          }
          f.y = plat.y - f.h;
          f.vy = 0;
          f.grounded = true;
          f.onIce = plat.kind === 'ice';
        }
      } else if (f.vy < 0 && plat.kind !== 'bounce') {
        f.y = plat.y + plat.h;
        f.vy = 0;
      }
    }

    // Distance-synced gait walk cycle + footstep dust puffs
    if (f.grounded && Math.abs(f.vx) > 20) {
      f.walkCycle += Math.abs(f.vx) * dt * 0.045;
      if (Math.abs(f.vx) > 220 && Math.random() < 0.25) {
        this.particleSystem.emitDust(
          f.x + f.w * 0.5,
          f.y + f.h,
          1,
          60,
          f.onIce ? '#E0F2FE' : '#94A3B8'
        );
      }
    }

    // Throw current weapon (`E` / `L` / `U`)
    if (input.throwJustPressed && f.weapon !== 'fists' && f.stunTimer <= 0) {
      this.throwWeapon(f);
    }

    // Attack windup -> active execution
    if (f.attackPending) {
      f.attackWindupTimer -= dt;
      if (f.attackWindupTimer <= 0) {
        f.attackPending = false;
        this.executeAttack(f);
      }
    } else if (!f.blocking && f.stunTimer <= 0 && f.attackCooldown <= 0) {
      const wantsAttack = f.weapon === 'smg' ? input.attackHeld : input.attackJustPressed;
      if (wantsAttack) {
        const spec = WEAPONS[f.weapon];
        if (spec.windup > 0) {
          f.attackPending = true;
          f.attackWindupTimer = spec.windup;
        } else {
          this.executeAttack(f);
        }
      }
    }
  }

  private executeAttack(f: Fighter): void {
    const spec = WEAPONS[f.weapon];
    f.attackCooldown = spec.cooldown;
    f.attackActiveTimer = 0.14;

    if (f.comboResetTimer <= 0) f.comboStep = 0;
    else f.comboStep = (f.comboStep + 1) % 3;
    f.comboResetTimer = 0.6;

    const cx = f.x + f.w * 0.5;
    const cy = f.y + f.h * 0.34;

    if (spec.isMelee) {
      if (f.weapon === 'katana') {
        this.spawnAfterimage(f);
        f.vx += f.facing * 290;
        this.spawnAfterimage(f);
        if (this.phase === 'playing') sound.playShoot('katana');
      } else {
        if (this.phase === 'playing') sound.playPunch(f.comboStep === 2);
      }

      this.slashes.push({
        x: cx + f.facing * 14,
        y: cy,
        facing: f.facing,
        angle: f.facing > 0 ? 0 : Math.PI,
        radius: f.weapon === 'katana' ? spec.range * 0.88 : spec.range * 0.72,
        color: spec.color,
        life: f.weapon === 'katana' ? 0.18 : 0.14,
        maxLife: f.weapon === 'katana' ? 0.18 : 0.14,
      });

      // Katana deflects incoming projectiles!
      if (f.weapon === 'katana') {
        for (const p of this.projectiles) {
          if (!p.active || p.ownerId === f.id || p.isRocket) continue;
          const dist = Math.hypot(p.x - (cx + f.facing * 24), p.y - cy);
          if (dist < 64) {
            p.ownerId = f.id;
            p.vx = -p.vx * 1.15;
            p.vy = -p.vy;
            p.color = '#E879F9';
            this.particleSystem.emitSparks(p.x, p.y, '#E879F9', 12, 260);
            this.spawnImpactFlash(p.x, p.y, 28, '#E879F9', 9, 'starburst');
            this.spawnCallout(p.x, p.y - 18, 'DEFLECT!', '#F0ABFC', 1.05);
            this.camera.kickX += f.facing * 6;
            if (this.phase === 'playing') sound.playParry();
          }
        }
      }

      // Check melee hits against enemy fighters & destructible crates
      const reachX = cx + f.facing * (spec.range * 0.55);
      for (const other of this.fighters) {
        if (other.id === f.id || !other.alive) continue;
        const ox = other.x + other.w * 0.5;
        const oy = other.y + other.h * 0.5;
        if (Math.abs(ox - reachX) < spec.range * 0.7 && Math.abs(oy - cy) < 52) {
          const bonus = f.comboStep === 2 ? 1.25 : 1;
          this.applyHitToFighter(
            f,
            other,
            spec.damage * bonus,
            spec.knockbackX * bonus,
            spec.knockbackY,
            f.facing,
            f.comboStep === 2
          );
        }
      }

      this.damageDestructiblesInBox(
        reachX - spec.range * 0.5,
        cy - 30,
        spec.range,
        60,
        spec.damage
      );

      // Knock / detonate dropped physics items inside melee swing arc
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        if (Math.abs(pk.x - reachX) < spec.range * 0.72 && Math.abs(pk.y - cy) < 52) {
          pk.vx += f.facing * (pk.kind === 'explosive_crate' ? 420 : 280);
          pk.vy = Math.min(pk.vy, -240);
          pk.angVel = f.facing * 12;
          pk.grounded = false;
          pk.parachuteOpen = false;
          if (pk.kind === 'explosive_crate') {
            pk.hp -= spec.damage;
            if (pk.hp <= 0) {
              this.detonateExplosiveCrate(pk, f.id);
            } else {
              pk.fuseTimer = pk.fuseTimer > 0 ? Math.min(pk.fuseTimer, 0.45) : 0.45;
              this.particleSystem.emitSparks(pk.x, pk.y, '#FACC15', 8, 220);
            }
          }
        }
      }
    } else if (spec.isBeam) {
      // Rail Laser instant raycast
      if (this.phase === 'playing') sound.playShoot('laser');
      const dirX = Math.cos(f.aimAngle);
      const dirY = Math.sin(f.aimAngle);
      const x1 = cx + dirX * 18;
      const y1 = cy + dirY * 18;
      const x2 = x1 + dirX * spec.range;
      const y2 = y1 + dirY * spec.range;

      this.beams.push({ x1, y1, x2, y2, color: spec.color, life: 0.28, maxLife: 0.28, width: 18 });
      this.triggerCameraShake('collision', 0.85, -dirX, -dirY);
      this.screenFlash = { alpha: 0.18, color: '#38BDF8' };
      this.spawnImpactFlash(x1, y1, 26, '#38BDF8', 8, 'muzzle', f.aimAngle);
      this.spawnImpactFlash(x2, y2, 34, '#BAE6FD', 10, 'starburst');
      this.particleSystem.emitRing(x1 + dirX * 28, y1 + dirY * 28, 22, '#38BDF8', 0.22);
      this.particleSystem.emitRing(x1 + dirX * 160, y1 + dirY * 160, 28, '#BAE6FD', 0.24);
      f.vx -= dirX * spec.recoil;

      for (const other of this.fighters) {
        if (other.id === f.id || !other.alive) continue;
        const dist = pointToSegmentDistance(
          other.x + other.w * 0.5,
          other.y + other.h * 0.5,
          x1,
          y1,
          x2,
          y2
        );
        if (dist < 28) {
          this.applyHitToFighter(
            f,
            other,
            spec.damage,
            spec.knockbackX,
            spec.knockbackY,
            dirX >= 0 ? 1 : -1,
            true
          );
        }
      }

      // Rail laser instantly detonates explosive crates along the beam
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        if (pk.kind !== 'explosive_crate') continue;
        const dist = pointToSegmentDistance(pk.x, pk.y, x1, y1, x2, y2);
        if (dist < pk.radius + 14) {
          this.detonateExplosiveCrate(pk, f.id);
        }
      }
    } else {
      // Projectile firearm (Pistol, Shotgun, SMG, Rocket)
      if (this.phase === 'playing') {
        sound.playShoot(f.weapon as 'pistol' | 'shotgun' | 'smg' | 'rocket');
      }
      const dirX = Math.cos(f.aimAngle);
      const dirY = Math.sin(f.aimAngle);
      f.vx -= dirX * spec.recoil;

      const power = f.weapon === 'rocket' ? 1.55 : f.weapon === 'shotgun' ? 1.45 : f.weapon === 'smg' ? 0.85 : 1;
      if (f.weapon === 'shotgun' || f.weapon === 'rocket') {
        this.triggerCameraShake('collision', 0.58, -dirX, -dirY);
      } else {
        this.camera.trauma = Math.min(1, this.camera.trauma + 0.14);
        this.camera.kickX -= dirX * (5.5 * power);
        this.camera.kickY -= dirY * (4 * power);
      }

      // Directional muzzle flash cone, sparks, smoke puff, and ejected brass casing
      const muzzleX = cx + dirX * 22;
      const muzzleY = cy + dirY * 22;
      this.particleSystem.emitMuzzleFlash(muzzleX, muzzleY, f.aimAngle, spec.color, power);
      this.spawnImpactFlash(muzzleX, muzzleY, 18 * power, spec.color, 7, 'muzzle', f.aimAngle);
      this.particleSystem.emitCasing(cx + dirX * 8, cy, dirX);

      for (let i = 0; i < spec.pellets; i++) {
        const ang = f.aimAngle + (Math.random() * 2 - 1) * spec.spread;
        this.spawnProjectile({
          ownerId: f.id,
          weaponId: f.weapon,
          x: cx + Math.cos(ang) * 20,
          y: cy + Math.sin(ang) * 20,
          vx: Math.cos(ang) * spec.projectileSpeed,
          vy: Math.sin(ang) * spec.projectileSpeed,
          radius: f.weapon === 'rocket' ? 7 : 4,
          damage: spec.damage,
          knockbackX: spec.knockbackX,
          knockbackY: spec.knockbackY,
          life: spec.range / spec.projectileSpeed,
          color: spec.color,
          isRocket: f.weapon === 'rocket',
          explosionRadius: spec.explosionRadius ?? 0,
        });
      }
    }

    if (f.weapon !== 'fists') {
      f.ammo -= 1;
      if (f.ammo <= 0) {
        f.weapon = 'fists';
        f.ammo = Infinity;
      }
    }
  }

  private throwWeapon(f: Fighter): void {
    const weaponId = f.weapon;
    const spec = WEAPONS[weaponId];
    f.weapon = 'fists';
    f.ammo = Infinity;
    const cx = f.x + f.w * 0.5;
    const cy = f.y + f.h * 0.34;
    this.spawnProjectile({
      ownerId: f.id,
      weaponId,
      x: cx + f.facing * 18,
      y: cy,
      vx: f.facing * 680,
      vy: -140,
      radius: 11,
      damage: 18,
      knockbackX: 430,
      knockbackY: -240,
      life: 1.4,
      color: spec.color,
      isRocket: false,
      explosionRadius: 0,
      isThrownWeapon: true,
      thrownWeaponId: weaponId,
      spinAngle: 0,
    });
    if (this.phase === 'playing') sound.playPunch(false);
  }

  private getBloodColor(target: Fighter): string {
    return this.config.bloodStyle === 'fighter_ink' ? target.palette.primary : '#DC2626';
  }

  private applyHitToFighter(
    attacker: Fighter | null,
    target: Fighter,
    rawDamage: number,
    kbX: number,
    kbY: number,
    attackDir: 1 | -1,
    isCrit = false
  ): void {
    const res = resolveHit(target, rawDamage, kbX, kbY, attackDir);
    const hitX = target.x + target.w * 0.5;
    const hitY = target.y + target.h * 0.45;

    if (res.parried) {
      this.hitstopTimer = 0.075;
      this.triggerCameraShake('collision', 0.7, attackDir, 0);
      this.screenFlash = { alpha: 0.14, color: '#FEF08A' };
      target.squashX = 1.24;
      target.squashY = 0.82;
      this.particleSystem.emitSparks(hitX, hitY, '#FDE047', 16, 320);
      this.particleSystem.emitRing(hitX, hitY, 32, '#FDE047', 0.28);
      this.spawnImpactFlash(hitX, hitY, 36, '#FDE047', 10, 'starburst');
      this.spawnCallout(hitX, hitY - 22, 'PARRY!', '#FDE047', 1.15);
      if (attacker) {
        attacker.stunTimer = 0.34;
        attacker.vx = -attackDir * 260;
      }
      if (!target.isBot && this.phase === 'playing') {
        this.gamepadHub.triggerRumble(target.id, 0.45, 90);
      }
      if (this.phase === 'playing') sound.playParry();
      return;
    }

    if (res.appliedDamage <= 0) return;

    target.hp = Math.max(0, target.hp - res.appliedDamage);
    target.vx = res.knockbackX;
    target.vy = res.knockbackY;
    target.grounded = false;
    target.hitFlashTimer = 0.075;
    target.squashX = 0.74;
    target.squashY = 1.28;

    if (attacker) attacker.damageDealt += res.appliedDamage;

    const heavy = res.appliedDamage >= 22 || res.killed || isCrit;
    if (heavy) {
      this.hitstopTimer = res.killed ? 0.08 : 0.045;
      if (!res.killed) {
        this.triggerCameraShake('collision', isCrit ? 0.82 : 0.58, attackDir, -0.35);
      }
    } else {
      this.camera.kickX += attackDir * 4.5;
    }

    if (res.blocked) {
      this.particleSystem.emitSparks(hitX, hitY, '#38BDF8', 10, 230);
      this.spawnImpactFlash(hitX, hitY, 20, '#38BDF8', 7, 'starburst');
      if (!target.isBot && this.phase === 'playing') {
        this.gamepadHub.triggerRumble(target.id, 0.25, 65);
      }
    } else {
      this.particleSystem.emitBloodSplatter(
        hitX,
        hitY,
        attackDir,
        this.getBloodColor(target),
        heavy ? 1.65 : 1.05
      );
      this.particleSystem.emitSparks(
        hitX,
        hitY,
        target.palette.primary,
        heavy ? 12 : 6,
        heavy ? 320 : 200
      );
      this.spawnImpactFlash(
        hitX,
        hitY,
        heavy ? 34 : 21,
        heavy ? '#FDE047' : '#FFFFFF',
        heavy ? 9 : 7,
        'starburst'
      );
      if (heavy && !res.killed) {
        this.spawnCallout(hitX, hitY - 22, isCrit ? 'CRIT!' : 'SMASH!', '#FDE047', 1.1);
      }
      if (!target.isBot && this.phase === 'playing') {
        this.gamepadHub.triggerRumble(target.id, heavy ? 0.75 : 0.4, heavy ? 140 : 80);
      }
    }

    if (res.killed) {
      this.killFighter(target, attacker, 'KO');
    } else if (this.phase === 'playing' && !res.blocked) {
      sound.playPunch(heavy);
    }
  }

  private killFighter(target: Fighter, attacker: Fighter | null, reason: string): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    target.koTimer = 1.05;
    target.koReason = reason;
    target.deaths += 1;
    target.ragdollSpin = (target.vx >= 0 ? 1 : -1) * 11.5;
    target.vy = Math.min(target.vy, -360);

    if (attacker && attacker.id !== target.id) {
      attacker.kills += 1;
    }

    const dir = target.vx >= 0 ? 1 : -1;
    this.hitstopTimer = 0.08;
    if (reason === 'Magma') {
      this.triggerCameraShake('explosion', 1.3, dir, -1);
    } else {
      this.triggerCameraShake('collision', 1.25, dir, -0.6);
    }
    this.screenFlash = { alpha: 0.24, color: target.palette.primary };

    const cx = target.x + target.w * 0.5;
    const cy = target.y + target.h * 0.5;
    this.particleSystem.emitBloodSplatter(cx, cy, dir, this.getBloodColor(target), 2.1);
    this.particleSystem.emitDebris(cx, cy, target.palette.primary, 20, 400);
    this.particleSystem.emitRing(cx, cy, 46, target.palette.primary, 0.36);
    this.spawnImpactFlash(cx, cy, 56, '#FFFFFF', 12, 'starburst');
    this.spawnCallout(
      cx,
      cy - 28,
      reason === 'Magma' ? 'INCINERATED!' : 'KO!',
      '#FDE047',
      1.35
    );

    if (reason === 'Magma') {
      this.particleSystem.emitExplosion(cx, this.arena.lavaY ?? cy, 120, '#FB923C');
      if (this.phase === 'playing') sound.playExplosion();
    }

    if (!target.isBot && this.phase === 'playing') {
      this.gamepadHub.triggerRumble(target.id, 0.95, 220);
    }
    if (this.phase === 'playing') sound.playKO();
  }

  public spawnWeaponDrop(x: number, y: number, forceKind?: ArenaItemKind): void {
    const choice =
      forceKind === 'explosive_crate'
        ? { kind: 'explosive_crate' as const, weaponId: 'rocket' as const }
        : pickRandomArenaDrop(Math.random, forceKind !== 'weapon');
    const isCrate = choice.kind === 'explosive_crate';
    const driftVx = (Math.random() - 0.5) * 95;
    this.pickups.push({
      id: this.nextEntityId++,
      kind: choice.kind,
      weaponId: choice.weaponId,
      x: Math.max(96, Math.min(this.arena.width - 96, x)),
      y,
      vx: driftVx,
      vy: 48,
      angle: (Math.random() - 0.5) * 0.28,
      angVel: driftVx * 0.015,
      radius: isCrate ? 15 : 13,
      hp: isCrate ? 24 : 999,
      maxHp: isCrate ? 24 : 999,
      fuseTimer: 0,
      grounded: false,
      onIce: false,
      bobPhase: Math.random() * Math.PI * 2,
      parachuteOpen: true,
      life: isCrate ? 20 : 17,
    });
  }

  private detonateExplosiveCrate(pk: WeaponPickup, ownerId = -1): void {
    const idx = this.pickups.indexOf(pk);
    if (idx === -1) return;
    this.pickups.splice(idx, 1);

    const blastRadius = 132;
    const baseDamage = 48;
    this.triggerCameraShake('explosion', 1.32, pk.vx >= 0 ? 1 : -1, -0.8);
    this.hitstopTimer = Math.max(this.hitstopTimer, 0.065);
    this.screenFlash = { alpha: 0.3, color: '#FDBA74' };

    this.particleSystem.emitExplosion(pk.x, pk.y, blastRadius, '#FB923C');
    this.particleSystem.emitDebris(pk.x, pk.y, '#EF4444', 18, 390);
    this.spawnImpactFlash(pk.x, pk.y, blastRadius * 0.74, '#FDE047', 12, 'explosion');
    this.spawnCallout(pk.x, pk.y - 26, 'KABOOM!', '#FACC15', 1.3);
    if (this.phase === 'playing') sound.playExplosion();

    const attacker = ownerId >= 0 ? this.fighters.find((a) => a.id === ownerId) ?? null : null;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const fx = f.x + f.w * 0.5;
      const fy = f.y + f.h * 0.5;
      const d = Math.hypot(fx - pk.x, fy - pk.y);
      if (d <= blastRadius) {
        const falloff = Math.max(0.35, 1 - d / blastRadius);
        const dir: 1 | -1 = fx >= pk.x ? 1 : -1;
        this.applyHitToFighter(
          attacker,
          f,
          baseDamage * falloff,
          680 * falloff,
          -410 * falloff,
          dir,
          true
        );
      }
    }

    this.damageDestructiblesInBox(
      pk.x - blastRadius,
      pk.y - blastRadius,
      blastRadius * 2,
      blastRadius * 2,
      baseDamage
    );

    this.impulseDroppedItems(pk.x, pk.y, blastRadius * 1.25, 520, ownerId);
  }

  private impulseDroppedItems(
    bx: number,
    by: number,
    radius: number,
    strength: number,
    ownerId = -1
  ): void {
    const chainCrates: WeaponPickup[] = [];
    for (const item of this.pickups) {
      const dx = item.x - bx;
      const dy = item.y - by;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      const falloff = Math.max(0.25, 1 - dist / radius);
      const nx = dist > 1 ? dx / dist : Math.random() > 0.5 ? 1 : -1;
      const ny = dist > 1 ? dy / dist : -0.8;
      item.vx += nx * strength * falloff;
      item.vy = Math.min(item.vy, -240) + ny * strength * 0.55 * falloff;
      item.angVel += nx * 15 * falloff;
      item.grounded = false;
      item.parachuteOpen = false;
      if (item.kind === 'explosive_crate') {
        if (dist < radius * 0.58) {
          chainCrates.push(item);
        } else {
          item.fuseTimer = item.fuseTimer > 0 ? Math.min(item.fuseTimer, 0.35) : 0.35;
        }
      }
    }
    for (const c of chainCrates) {
      this.detonateExplosiveCrate(c, ownerId);
    }
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (!pk) continue;
      pk.life -= dt;
      if (pk.life <= 0 || pk.y > this.arena.abyssY) {
        this.pickups.splice(i, 1);
        continue;
      }

      if (this.arena.lavaY !== null && pk.y + pk.radius >= this.arena.lavaY) {
        if (pk.kind === 'explosive_crate') {
          this.detonateExplosiveCrate(pk);
        } else {
          this.particleSystem.emitSparks(pk.x, this.arena.lavaY, '#FB923C', 10, 240);
          this.pickups.splice(i, 1);
        }
        continue;
      }

      const hadFuse = pk.fuseTimer > 0;
      const step = stepArenaItemPhysics(pk, this.arena.platforms, this.arena.width, dt);

      if (step.hitBouncePad) {
        this.particleSystem.emitSparks(pk.x, pk.y + pk.radius, '#10B981', 8, 175);
        if (this.phase === 'playing') sound.playJump();
      } else if (step.bounced) {
        this.particleSystem.emitDust(pk.x, pk.y + pk.radius, 4, 110, '#CBD5E1');
      }

      if (pk.kind === 'explosive_crate') {
        if ((hadFuse && pk.fuseTimer <= 0) || (hadFuse && step.highSpeedImpact)) {
          this.detonateExplosiveCrate(pk);
          continue;
        }
      }

      // Fighter interaction: push/nudge explosive crates, or equip weapons
      for (const f of this.fighters) {
        if (!f.alive) continue;
        const fcX = f.x + f.w * 0.5;
        const fcY = f.y + f.h * 0.5;
        const dist = Math.hypot(fcX - pk.x, fcY - pk.y);
        if (pk.kind === 'explosive_crate') {
          if (dist < 28 && Math.abs(f.vx) > 40) {
            const pushDir = fcX <= pk.x ? 1 : -1;
            pk.vx = pushDir * Math.max(Math.abs(pk.vx), Math.abs(f.vx) * 0.72);
            pk.angVel = pushDir * 6;
            pk.grounded = false;
          }
          continue;
        }

        if (dist < 34) {
          if (f.weapon === 'fists' || !f.isBot) {
            if (f.weapon === 'fists' || f.weapon !== pk.weaponId) {
              f.weapon = pk.weaponId;
              f.ammo = WEAPONS[pk.weaponId].ammo;
              this.particleSystem.emitSparks(pk.x, pk.y, WEAPONS[pk.weaponId].color, 10, 170);
              if (this.phase === 'playing') sound.playPickup();
              this.pickups.splice(i, 1);
              break;
            }
          }
        }
      }
    }

    if (typeof document !== 'undefined') {
      document.body.dataset.pickups = String(this.pickups.length);
    }
  }

  private spawnProjectile(opts: Omit<Projectile, 'active' | 'id' | 'prevX' | 'prevY'>): void {
    const p = this.projectiles[this.projectileCursor];
    this.projectileCursor = (this.projectileCursor + 1) % PROJECTILE_POOL_SIZE;
    p.active = true;
    p.id = this.nextEntityId++;
    p.ownerId = opts.ownerId;
    p.weaponId = opts.weaponId;
    p.x = opts.x;
    p.y = opts.y;
    p.prevX = opts.x;
    p.prevY = opts.y;
    p.vx = opts.vx;
    p.vy = opts.vy;
    p.radius = opts.radius;
    p.damage = opts.damage;
    p.knockbackX = opts.knockbackX;
    p.knockbackY = opts.knockbackY;
    p.life = opts.life;
    p.color = opts.color;
    p.isRocket = opts.isRocket;
    p.explosionRadius = opts.explosionRadius;
    p.isThrownWeapon = opts.isThrownWeapon;
    p.thrownWeaponId = opts.thrownWeaponId;
    p.spinAngle = opts.spinAngle ?? 0;
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.isRocket) this.detonateRocket(p);
        p.active = false;
        continue;
      }

      p.prevX = p.x;
      p.prevY = p.y;
      if (p.isThrownWeapon) {
        p.vy += GRAVITY * 0.55 * dt;
        p.spinAngle = (p.spinAngle ?? 0) + dt * 16;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.isRocket && Math.random() < 0.85) {
        this.particleSystem.spawn({
          category: 'fireball',
          x: p.x - p.vx * dt * 0.4,
          y: p.y - p.vy * dt * 0.4,
          vx: -p.vx * 0.14 + (Math.random() * 40 - 20),
          vy: -p.vy * 0.14 + (Math.random() * 40 - 20),
          size: 5 + Math.random() * 3,
          color: Math.random() < 0.5 ? '#FEF08A' : '#FB923C',
          maxLife: 0.22,
          gravity: -20,
          drag: 2.5,
          shape: 'circle',
          alpha: 0.9,
        });
        this.particleSystem.spawn({
          category: 'smoke',
          x: p.x,
          y: p.y,
          vx: -p.vx * 0.08 + (Math.random() * 30 - 15),
          vy: -25 - Math.random() * 25,
          size: 7 + Math.random() * 5,
          color: '#475569',
          maxLife: 0.42,
          gravity: -55,
          drag: 2,
          shape: 'circle',
          alpha: 0.55,
        });
      }

      // Check platform hits
      let hitPlatform = false;
      let hitDestructible = false;
      for (const plat of this.arena.platforms) {
        if (plat.kind === 'oneway') continue;
        if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
        if (p.x >= plat.x && p.x <= plat.x + plat.w && p.y >= plat.y && p.y <= plat.y + plat.h) {
          if (plat.kind === 'destructible') {
            hitDestructible = true;
            plat.hp = (plat.hp ?? 35) - p.damage;
            this.particleSystem.emitDebris(p.x, p.y, '#D97706', 6, 210);
            if ((plat.hp ?? 0) <= 0) {
              this.breakCrate(plat);
            } else {
              this.triggerCameraShake('collision', 0.35, p.vx >= 0 ? 1 : -1, 0.3);
            }
          }
          hitPlatform = true;
          break;
        }
      }

      if (hitPlatform) {
        if (p.isRocket) {
          this.detonateRocket(p);
        } else {
          this.particleSystem.emitSparks(p.x, p.y, p.color, 6, 190);
          if (!hitDestructible) {
            this.particleSystem.emitDebris(p.x, p.y, '#64748B', 5, 175);
          }
        }
        p.active = false;
        continue;
      }

      // Check projectile hits against explosive crates & dropped weapons
      let hitItem = false;
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        if (pk.kind !== 'explosive_crate') continue;
        if (Math.hypot(p.x - pk.x, p.y - pk.y) <= p.radius + pk.radius + 3) {
          if (p.isRocket) {
            this.detonateRocket(p);
          } else {
            pk.vx += (p.vx >= 0 ? 1 : -1) * 240;
            pk.vy = Math.min(pk.vy, -140);
            pk.angVel += (p.vx >= 0 ? 1 : -1) * 10;
            pk.grounded = false;
            pk.parachuteOpen = false;
            pk.hp -= p.damage;
            this.particleSystem.emitSparks(p.x, p.y, '#FACC15', 8, 220);
            if (pk.hp <= 0) {
              this.detonateExplosiveCrate(pk, p.ownerId);
            } else {
              pk.fuseTimer = pk.fuseTimer > 0 ? Math.min(pk.fuseTimer, 0.35) : 0.35;
            }
          }
          p.active = false;
          hitItem = true;
          break;
        }
      }
      if (hitItem) continue;

      // Check fighter hits
      for (const f of this.fighters) {
        if (!f.alive || f.id === p.ownerId) continue;
        if (
          p.x + p.radius >= f.x &&
          p.x - p.radius <= f.x + f.w &&
          p.y + p.radius >= f.y &&
          p.y - p.radius <= f.y + f.h
        ) {
          if (p.isRocket) {
            this.detonateRocket(p);
          } else {
            const attacker = this.fighters.find((a) => a.id === p.ownerId) ?? null;
            this.applyHitToFighter(
              attacker,
              f,
              p.damage,
              p.knockbackX,
              p.knockbackY,
              p.vx >= 0 ? 1 : -1
            );
          }
          p.active = false;
          break;
        }
      }
    }
  }

  private detonateRocket(p: Projectile): void {
    const r = p.explosionRadius || 115;
    const explodeDir = p.vx >= 0 ? 1 : -1;
    this.triggerCameraShake('explosion', Math.max(1.15, r / 95), explodeDir, -0.75);
    this.hitstopTimer = 0.065;
    this.screenFlash = { alpha: 0.28, color: '#FDBA74' };

    this.particleSystem.emitExplosion(p.x, p.y, r, '#FB923C');
    this.spawnImpactFlash(p.x, p.y, r * 0.72, '#FDE047', 11, 'explosion');
    this.spawnCallout(p.x, p.y - 24, 'BOOM!', '#FACC15', 1.25);
    if (this.phase === 'playing') sound.playExplosion();

    const attacker = this.fighters.find((a) => a.id === p.ownerId) ?? null;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const fx = f.x + f.w * 0.5;
      const fy = f.y + f.h * 0.5;
      const d = Math.hypot(fx - p.x, fy - p.y);
      if (d <= r) {
        const falloff = Math.max(0.35, 1 - d / r);
        const dir: 1 | -1 = fx >= p.x ? 1 : -1;
        this.applyHitToFighter(
          attacker,
          f,
          p.damage * falloff,
          p.knockbackX * falloff,
          p.knockbackY * falloff,
          dir,
          true
        );
      }
    }

    this.damageDestructiblesInBox(p.x - r, p.y - r, r * 2, r * 2, p.damage);
    this.impulseDroppedItems(p.x, p.y, r * 1.25, 480, p.ownerId);
  }

  private breakCrate(plat: { x: number; y: number; w: number; h: number }): void {
    const cx = plat.x + plat.w * 0.5;
    const cy = plat.y + plat.h * 0.5;
    const areaFactor = (plat.w * plat.h) / (48 * 48);
    const debrisCount = Math.min(42, Math.max(20, Math.round(14 + areaFactor * 6)));
    this.particleSystem.emitDebris(cx, cy, '#D97706', debrisCount, 360);
    this.particleSystem.emitDust(cx, cy, Math.min(18, Math.round(8 + areaFactor * 2.5)), 210, '#CBD5E1');
    this.particleSystem.emitRing(cx, cy, Math.min(82, 34 + areaFactor * 12), '#F59E0B', 0.3);
    const destructionMag = Math.max(0.78, Math.min(1.5, 0.56 + areaFactor * 0.25));
    this.triggerCameraShake('destruction', destructionMag, 0, 1);
    if (this.phase === 'playing') sound.playCrateBreak();
  }

  private damageDestructiblesInBox(bx: number, by: number, bw: number, bh: number, dmg: number): void {
    for (const plat of this.arena.platforms) {
      if (plat.kind !== 'destructible' || (plat.hp ?? 1) <= 0) continue;
      if (intersectsPlatform(bx, by, bw, bh, plat)) {
        plat.hp = (plat.hp ?? 35) - dmg;
        this.particleSystem.emitDebris(
          plat.x + plat.w * 0.5,
          plat.y + plat.h * 0.5,
          '#D97706',
          6,
          200
        );
        if ((plat.hp ?? 0) <= 0) {
          this.breakCrate(plat);
        } else {
          this.triggerCameraShake('collision', 0.36, 0, 0.5);
        }
      }
    }
  }

  private updateHazards(dt: number): void {
    // Lava embers
    if (this.arena.lavaY !== null && Math.random() < 0.35) {
      this.particleSystem.spawn({
        category: 'spark',
        x: Math.random() * this.arena.width,
        y: this.arena.lavaY,
        vx: Math.random() * 40 - 20,
        vy: -60 - Math.random() * 80,
        size: 3.5,
        color: '#FB923C',
        maxLife: 0.9,
        gravity: -20,
        shape: 'circle',
      });
    }

    for (const f of this.fighters) {
      if (!f.alive || f.victoryPose) continue;
      const fcX = f.x + f.w * 0.5;
      const fcY = f.y + f.h * 0.5;

      // Abyss / Lava instant KO
      if (this.arena.lavaY !== null && f.y + f.h >= this.arena.lavaY + 8) {
        this.particleSystem.emitSparks(fcX, this.arena.lavaY, '#FB923C', 22, 360);
        this.killFighter(f, null, 'Magma');
        continue;
      }
      if (f.y > this.arena.abyssY) {
        this.killFighter(f, null, 'Ring Out');
        continue;
      }

      // Active laser hazards
      for (const laser of this.arena.lasers) {
        if (getLaserPhase(laser, this.elapsedTime) === 'active') {
          const dist = pointToSegmentDistance(fcX, fcY, laser.x1, laser.y1, laser.x2, laser.y2);
          if (dist < 22 && f.invulnTimer <= 0) {
            f.invulnTimer = 0.25;
            const lDir = fcX >= 640 ? 1 : -1;
            this.triggerCameraShake('collision', 0.78, lDir, -0.4);
            this.applyHitToFighter(null, f, 28, 360, -260, lDir);
          }
        }
      }

      // Pendulum wrecking ball
      for (const pend of this.arena.pendulums) {
        const pos = getPendulumPosition(pend, this.elapsedTime);
        const dist = Math.hypot(fcX - pos.x, fcY - pos.y);
        if (dist < pend.radius + 16 && f.invulnTimer <= 0) {
          f.invulnTimer = 0.28;
          const dir: 1 | -1 = fcX >= pos.x ? 1 : -1;
          this.triggerCameraShake('explosion', 0.95, dir, -0.5);
          this.applyHitToFighter(null, f, 26, 560, -320, dir);
        }
      }
    }
    void dt;
  }

  private spawnImpactFlash(
    x: number,
    y: number,
    radius: number,
    color: string,
    spikes: number,
    kind: ImpactFlashEffect['kind'],
    rot = Math.random() * Math.PI * 2
  ): void {
    const slot = this.impactFlashes[this.impactFlashCursor];
    this.impactFlashCursor = (this.impactFlashCursor + 1) % this.impactFlashes.length;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.radius = radius;
    slot.color = color;
    slot.maxLife = kind === 'explosion' ? 0.2 : kind === 'muzzle' ? 0.09 : 0.14;
    slot.life = slot.maxLife;
    slot.spikes = spikes;
    slot.rot = rot;
    slot.kind = kind;
  }

  private spawnCallout(
    x: number,
    y: number,
    text: string,
    color: string,
    scale = 1
  ): void {
    const slot = this.callouts[this.calloutCursor];
    this.calloutCursor = (this.calloutCursor + 1) % this.callouts.length;
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.vy = -72;
    slot.text = text;
    slot.color = color;
    slot.maxLife = 0.68;
    slot.life = slot.maxLife;
    slot.scale = scale;
  }

  private spawnAfterimage(f: Fighter): void {
    const slot = this.afterimages[this.afterimageCursor];
    this.afterimageCursor = (this.afterimageCursor + 1) % this.afterimages.length;
    slot.active = true;
    slot.x = f.x;
    slot.y = f.y;
    slot.facing = f.facing;
    slot.color = f.palette.primary;
    slot.maxLife = 0.18;
    slot.life = 0.18;
    slot.squashX = f.squashX;
    slot.squashY = f.squashY;
    this.afterimageSpawnCooldown = 0.028;
  }

  private updateEffects(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= dt;
      if (this.beams[i].life <= 0) this.beams.splice(i, 1);
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      this.slashes[i].life -= dt;
      if (this.slashes[i].life <= 0) this.slashes.splice(i, 1);
    }
    for (let i = 0; i < this.impactFlashes.length; i++) {
      const f = this.impactFlashes[i];
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) f.active = false;
    }
    for (let i = 0; i < this.callouts.length; i++) {
      const c = this.callouts[i];
      if (!c.active) continue;
      c.life -= dt;
      c.y += c.vy * dt;
      c.vy *= Math.pow(0.2, dt);
      if (c.life <= 0) c.active = false;
    }
    for (let i = 0; i < this.afterimages.length; i++) {
      const g = this.afterimages[i];
      if (!g.active) continue;
      g.life -= dt;
      if (g.life <= 0) g.active = false;
    }
  }

  private updateCamera(dt: number): void {
    const alive = this.fighters.filter((f) => f.alive);
    let targetX = this.arena.width * 0.5;
    let targetY = this.arena.height * 0.5;
    let targetZoom = 1.02;

    if (this.killCamActive && this.killCamWinnerId !== null) {
      const kcWinner = this.fighters.find((f) => f.id === this.killCamWinnerId);
      if (kcWinner) {
        const kc = computeKillCamState(this.killCamElapsed, this.killCamDuration);
        const winCenterX = kcWinner.x + kcWinner.w * 0.5;
        const winCenterY = kcWinner.y + kcWinner.h * 0.35;
        targetX = this.arena.width * 0.5 + (winCenterX - this.arena.width * 0.5) * 0.84;
        targetY = this.arena.height * 0.5 + (winCenterY - this.arena.height * 0.5) * 0.72;
        targetZoom = kc.targetZoom;
      }
    } else if ((this.victorySequenceActive || this.phase === 'gameover') && this.victoryWinnerId !== null) {
      const winner = this.fighters.find((f) => f.id === this.victoryWinnerId);
      if (winner) {
        const winCenterX = winner.x + winner.w * 0.5;
        const winCenterY = winner.y + winner.h * 0.2;
        if (this.phase === 'gameover') {
          // Frame winner & confetti cleanly beside the centered Match Result card
          const sideOffset = winCenterX >= this.arena.width * 0.5 ? -290 : 290;
          targetX = winCenterX + sideOffset;
          targetY = winCenterY - 15;
          targetZoom = 1.2;
        } else {
          targetX = this.arena.width * 0.5 + (winCenterX - this.arena.width * 0.5) * 0.58;
          targetY = this.arena.height * 0.5 + (winCenterY - this.arena.height * 0.5) * 0.48;
          targetZoom = 1.24;
        }
      }
    } else if (alive.length > 0 && this.phase === 'playing') {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const f of alive) {
        minX = Math.min(minX, f.x);
        maxX = Math.max(maxX, f.x + f.w);
        minY = Math.min(minY, f.y);
        maxY = Math.max(maxY, f.y + f.h);
      }
      targetX = (minX + maxX) * 0.5;
      targetY = (minY + maxY) * 0.5 - 20;

      // Clamp focus near arena center so background stays framed
      targetX = this.arena.width * 0.5 + (targetX - this.arena.width * 0.5) * 0.35;
      targetY = this.arena.height * 0.5 + (targetY - this.arena.height * 0.5) * 0.25;

      const spanX = maxX - minX + 360;
      const spanY = maxY - minY + 260;
      const desiredZoom = Math.min(this.arena.width / spanX, this.arena.height / spanY);
      targetZoom = Math.max(0.95, Math.min(1.18, desiredZoom));
    } else if (this.phase === 'title') {
      // Gentle live pan in attract mode, framing the arena cleanly below the upper Title Lockup
      targetX = this.arena.width * 0.5 + Math.sin(this.elapsedTime * 0.35) * 28;
      targetY = this.arena.height * 0.34;
      targetZoom = 0.96;
    }

    const lerp = Math.min(1, dt * (this.killCamActive ? 6.0 : 4.5));
    this.camera.x += (targetX - this.camera.x) * lerp;
    this.camera.y += (targetY - this.camera.y) * lerp;
    this.camera.zoom += (targetZoom - this.camera.zoom) * lerp;
  }

  private render(): void {
    this.ctx.save();
    this.ctx.scale(this.dpr, this.dpr);
    renderFrame(
      this.ctx,
      this.viewW,
      this.viewH,
      this.arena,
      this.fighters,
      this.projectiles,
      this.pickups,
      this.beams,
      this.slashes,
      this.particleSystem.particles,
      this.particleSystem.decals,
      this.impactFlashes,
      this.callouts,
      this.afterimages,
      this.screenFlash,
      this.camera,
      this.elapsedTime,
      this.victoryBloomIntensity,
      this.phase === 'gameover',
      this.killCamVignette
    );
    this.ctx.restore();
  }

  private emitHud(force = false): void {
    const connectedPads = this.gamepadHub.getConnectedCount();
    const signature = `${this.phase}|${this.arena.name}|${this.roundNumber}|${
      this.roundBannerText ?? ''
    }|${sound.isMuted()}|${connectedPads}|${this.config.showVirtualPsPad ? 1 : 0}|${this.fighters
      .map(
        (f) =>
          `${f.id}:${Math.round(f.hp)}:${Math.round(f.ghostHp)}:${f.alive ? 1 : 0}:${f.weapon}:${
            Number.isFinite(f.ammo) ? f.ammo : -1
          }:${f.wins}:${f.blocking ? 1 : 0}:${f.palette.primary}:${f.palette.pattern}`
      )
      .join(',')}`;

    if (!force && signature === this.lastHudSignature) return;
    this.lastHudSignature = signature;

    this.callbacks.onHudUpdate({
      phase: this.phase,
      arenaName: this.arena.name,
      arenaSubtitle: this.arena.subtitle,
      roundNumber: this.roundNumber,
      roundsToWin: this.config.roundsToWin,
      roundBannerText: this.roundBannerText,
      roundBannerSubtext: this.roundBannerSubtext,
      muted: sound.isMuted(),
      mode: this.config.mode,
      connectedPads,
      showVirtualPsPad: this.config.showVirtualPsPad,
      fighters: this.fighters.map((f) => {
        const spec = WEAPONS[f.weapon];
        return {
          id: f.id,
          name: f.name,
          isBot: f.isBot,
          archetypeLabel: f.isBot ? f.aiArchetype.toUpperCase() : 'HUMAN',
          color: f.palette.primary,
          pattern: f.palette.pattern,
          hp: Math.round(f.hp),
          maxHp: f.maxHp,
          ghostHp: Math.round(f.ghostHp),
          alive: f.alive,
          weapon: f.weapon,
          weaponName: spec.name,
          ammo: Number.isFinite(f.ammo) ? f.ammo : -1,
          maxAmmo: Number.isFinite(spec.ammo) ? spec.ammo : -1,
          wins: f.wins,
          blocking: f.blocking,
        };
      }),
    });
  }
}
