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
  evaluateMatchWinner,
  evaluateRoundOutcome,
  getLaserPhase,
  getModeRoster,
  getPendulumPosition,
  intersectsPlatform,
  pointToSegmentDistance,
  resolveHit,
} from './rules';
import { sound } from './sound';
import {
  ArenaDefinition,
  BeamEffect,
  Fighter,
  FighterInputState,
  GamePhase,
  HudSnapshot,
  MatchConfig,
  MatchSummary,
  Projectile,
  SlashArcEffect,
  WeaponPickup,
} from './types';
import { pickRandomWeapon, WEAPONS } from './weapons';

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
  private particleSystem = new ParticleSystem(260, 140);
  private gamepadHub = new PsGamepadHub();
  private projectiles: Projectile[] = [];
  private projectileCursor = 0;

  private camera: CameraState = { x: 640, y: 360, zoom: 1, trauma: 0 };

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

      if (this.phase === 'paused' || this.phase === 'gameover') {
        this.render();
        this.rafId = null;
        return;
      }

      this.update(dt);
      this.render();
      const frameElapsed = performance.now() - frameStart;
      if (isAutomation || frameElapsed > 12) {
        setTimeout(() => {
          if (this.loopRunning && this.phase !== 'paused' && this.phase !== 'gameover') {
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
    this.arenaIndex = 0;
    this.matchStartTime = 0;
    this.elapsedTime = 0;
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
    this.setPhase('title');
    this.initAttractMode();
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

    if ((prev === 'paused' || prev === 'gameover') && (next === 'playing' || next === 'title')) {
      this.lastTs = performance.now();
      if (this.rafId === null) {
        this.scheduleNextFrame();
      }
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
    this.timeScale = 1;
    this.hitstopTimer = 0;
    this.dropSpawnTimer = 1.6;
    this.camera = { x: this.arena.width * 0.5, y: this.arena.height * 0.5, zoom: 1, trauma: 0 };

    for (const p of this.projectiles) p.active = false;
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
    });

    // Spawn 1 initial center weapon drop to invite immediate scrambles
    this.spawnWeaponDrop(this.arena.weaponDrops[0].x, 95);

    if (showBanner) {
      this.roundBannerText = `ROUND ${this.roundNumber}`;
      this.roundBannerSubtext = this.arena.name;
      this.roundBannerTimer = 1.6;
    }
    this.emitHud();
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
    if (this.phase === 'paused' || this.phase === 'gameover') {
      this.keysJustPressed.clear();
      this.keysJustReleased.clear();
      return;
    }

    // Visual-only timers always advance in real dt
    this.camera.trauma = Math.max(0, this.camera.trauma - dt * 2.1);
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
    if (this.phase === 'playing') {
      this.matchStartTime += dt;
    }

    // Weapon parachute drop timer
    this.dropSpawnTimer -= simDt;
    if (this.dropSpawnTimer <= 0 && this.pickups.length < 3) {
      const spot = this.arena.weaponDrops[Math.floor(Math.random() * this.arena.weaponDrops.length)];
      this.spawnWeaponDrop(spot.x + (Math.random() * 60 - 30), -20);
      this.dropSpawnTimer = 5.5 + Math.random() * 2.5;
    }

    // Update fighters (with keyboard + PS Gamepad / Virtual PS Pad merging)
    let padPaused = false;
    for (const f of this.fighters) {
      if (!f.alive) {
        f.koTimer = Math.max(0, f.koTimer - simDt);
        f.vy += GRAVITY * simDt;
        f.x += f.vx * simDt;
        f.y += f.vy * simDt;
        f.ragdollAngle += f.ragdollSpin * simDt;
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
        if (padPoll.optionsJustPressed && this.phase === 'playing') {
          padPaused = true;
          break;
        }
        input = mergeFighterInputs(kbd, padPoll.input);
      }

      this.updateFighter(f, input, simDt);
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
    this.updateCamera(dt);

    // Evaluate round end
    if (!this.roundOverPending) {
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
              this.roundBannerText = `${winFighter.name.toUpperCase()} WINS`;
              this.roundBannerSubtext = 'Round Clear';
              this.roundBannerTimer = 1.5;
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
      this.roundOverTimer -= dt;
      if (this.roundOverTimer <= 0) {
        if (this.phase === 'title') {
          this.arenaIndex = (this.arenaIndex + 1) % ARENAS.length;
          this.setupRound(false);
        } else {
          const matchWinnerId = evaluateMatchWinner(this.fighters, this.config.roundsToWin);
          if (matchWinnerId !== null) {
            const winner = this.fighters.find((f) => f.id === matchWinnerId)!;
            sound.playVictory();
            this.setPhase('gameover');
            this.callbacks.onMatchEnd({
              winnerId: winner.id,
              winnerName: winner.name,
              winnerColor: winner.palette.primary,
              isHumanWin: !winner.isBot,
              roundsPlayed: this.roundNumber,
              roundsToWin: this.config.roundsToWin,
              durationSeconds: Math.round(this.matchStartTime),
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
          } else {
            this.roundNumber += 1;
            this.arenaIndex = (this.arenaIndex + 1) % ARENAS.length;
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
        f.vx += f.facing * 260;
        if (this.phase === 'playing') sound.playShoot('katana');
      } else {
        if (this.phase === 'playing') sound.playPunch(f.comboStep === 2);
      }

      this.slashes.push({
        x: cx + f.facing * 14,
        y: cy,
        facing: f.facing,
        angle: f.facing > 0 ? 0 : Math.PI,
        radius: spec.range * 0.72,
        color: spec.color,
        life: 0.14,
        maxLife: 0.14,
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
            this.particleSystem.emitSparks(p.x, p.y, '#E879F9', 8, 220);
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
            f.facing
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
    } else if (spec.isBeam) {
      // Rail Laser instant raycast
      if (this.phase === 'playing') sound.playShoot('laser');
      const dirX = Math.cos(f.aimAngle);
      const dirY = Math.sin(f.aimAngle);
      const x1 = cx + dirX * 18;
      const y1 = cy + dirY * 18;
      const x2 = x1 + dirX * spec.range;
      const y2 = y1 + dirY * spec.range;

      this.beams.push({ x1, y1, x2, y2, color: spec.color, life: 0.22, maxLife: 0.22, width: 14 });
      this.camera.trauma = Math.min(1, this.camera.trauma + 0.35);
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
            dirX >= 0 ? 1 : -1
          );
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
      this.camera.trauma = Math.min(1, this.camera.trauma + (f.weapon === 'shotgun' ? 0.32 : 0.12));

      // Muzzle flash + shell casing
      this.particleSystem.emitSparks(cx + dirX * 22, cy + dirY * 22, spec.color, 4, 180);
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
    attackDir: 1 | -1
  ): void {
    const res = resolveHit(target, rawDamage, kbX, kbY, attackDir);

    if (res.parried) {
      this.hitstopTimer = 0.065;
      this.camera.trauma = Math.min(1, this.camera.trauma + 0.3);
      target.squashX = 1.2;
      target.squashY = 0.85;
      this.particleSystem.emitSparks(
        target.x + target.w * 0.5,
        target.y + target.h * 0.4,
        '#FDE047',
        14,
        290
      );
      this.particleSystem.emitRing(
        target.x + target.w * 0.5,
        target.y + target.h * 0.4,
        26,
        '#FDE047',
        0.25
      );
      if (attacker) {
        attacker.stunTimer = 0.32;
        attacker.vx = -attackDir * 240;
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
    target.hitFlashTimer = 0.065;
    target.squashX = 0.78;
    target.squashY = 1.24;

    if (attacker) attacker.damageDealt += res.appliedDamage;

    const heavy = res.appliedDamage >= 22 || res.killed;
    if (heavy) {
      this.hitstopTimer = res.killed ? 0.075 : 0.04;
      this.camera.trauma = Math.min(1, this.camera.trauma + (res.killed ? 0.55 : 0.28));
    }

    const hitX = target.x + target.w * 0.5;
    const hitY = target.y + target.h * 0.45;
    if (res.blocked) {
      this.particleSystem.emitSparks(hitX, hitY, '#38BDF8', 8, 210);
      if (!target.isBot && this.phase === 'playing') {
        this.gamepadHub.triggerRumble(target.id, 0.25, 65);
      }
    } else {
      this.particleSystem.emitBloodSplatter(
        hitX,
        hitY,
        attackDir,
        this.getBloodColor(target),
        heavy ? 1.5 : 0.95
      );
      this.particleSystem.emitSparks(
        hitX,
        hitY,
        target.palette.primary,
        heavy ? 10 : 5,
        heavy ? 300 : 180
      );
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
    target.koTimer = 0.95;
    target.koReason = reason;
    target.deaths += 1;
    target.ragdollSpin = (target.vx >= 0 ? 1 : -1) * 9.5;
    target.vy = Math.min(target.vy, -340);

    if (attacker && attacker.id !== target.id) {
      attacker.kills += 1;
    }

    this.hitstopTimer = 0.07;
    this.camera.trauma = Math.min(1, this.camera.trauma + 0.55);
    const cx = target.x + target.w * 0.5;
    const cy = target.y + target.h * 0.5;
    this.particleSystem.emitBloodSplatter(
      cx,
      cy,
      target.vx >= 0 ? 1 : -1,
      this.getBloodColor(target),
      1.8
    );
    this.particleSystem.emitDebris(cx, cy, target.palette.primary, 16, 360);
    this.particleSystem.emitRing(cx, cy, 36, target.palette.primary, 0.32);
    if (!target.isBot && this.phase === 'playing') {
      this.gamepadHub.triggerRumble(target.id, 0.95, 220);
    }
    if (this.phase === 'playing') sound.playKO();
  }

  private spawnWeaponDrop(x: number, y: number): void {
    this.pickups.push({
      id: this.nextEntityId++,
      weaponId: pickRandomWeapon(),
      x: Math.max(120, Math.min(this.arena.width - 120, x)),
      y,
      vy: 60,
      grounded: false,
      bobPhase: Math.random() * Math.PI * 2,
      parachuteOpen: true,
      life: 16,
    });
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= dt;
      if (pk.life <= 0 || pk.y > this.arena.abyssY) {
        this.pickups.splice(i, 1);
        continue;
      }

      if (!pk.grounded) {
        pk.vy = Math.min(pk.parachuteOpen ? 105 : 540, pk.vy + 450 * dt);
        pk.y += pk.vy * dt;

        for (const plat of this.arena.platforms) {
          if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
          if (pk.x >= plat.x && pk.x <= plat.x + plat.w && pk.y + 12 >= plat.y && pk.y - 12 <= plat.y + plat.h) {
            pk.y = plat.y - 12;
            pk.vy = 0;
            pk.grounded = true;
            pk.parachuteOpen = false;
            break;
          }
        }
      }

      // Fighter pickup check
      for (const f of this.fighters) {
        if (!f.alive) continue;
        const fcX = f.x + f.w * 0.5;
        const fcY = f.y + f.h * 0.5;
        if (Math.hypot(fcX - pk.x, fcY - pk.y) < 34) {
          if (f.weapon === 'fists' || !f.isBot) {
            // Human picks up if fists OR presses nothing? Let's auto-pickup only if fists or better/different
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

      if (p.isRocket && Math.random() < 0.7) {
        this.particleSystem.spawn({
          category: 'dust',
          x: p.x,
          y: p.y,
          vx: -p.vx * 0.1,
          vy: -p.vy * 0.1,
          size: 4,
          color: '#FB923C',
          maxLife: 0.25,
          gravity: 0,
          shape: 'circle',
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
            this.particleSystem.emitDebris(p.x, p.y, '#D97706', 5, 190);
            if ((plat.hp ?? 0) <= 0) {
              this.particleSystem.emitDebris(
                plat.x + plat.w * 0.5,
                plat.y + plat.h * 0.5,
                '#D97706',
                18,
                300
              );
              this.particleSystem.emitDust(
                plat.x + plat.w * 0.5,
                plat.y + plat.h * 0.5,
                8,
                160,
                '#CBD5E1'
              );
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
          this.particleSystem.emitSparks(p.x, p.y, p.color, 5, 160);
          if (!hitDestructible) {
            this.particleSystem.emitDebris(p.x, p.y, '#64748B', 4, 150);
          }
        }
        p.active = false;
        continue;
      }

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
    const r = p.explosionRadius || 110;
    this.camera.trauma = Math.min(1, this.camera.trauma + 0.65);
    this.hitstopTimer = 0.05;
    this.particleSystem.emitSparks(p.x, p.y, '#FB923C', 22, 420);
    this.particleSystem.emitDebris(p.x, p.y, '#64748B', 14, 340);
    this.particleSystem.emitDust(p.x, p.y, 10, 220, '#94A3B8');
    this.particleSystem.emitRing(p.x, p.y, r * 0.55, '#FDE047', 0.28);
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
          dir
        );
      }
    }

    this.damageDestructiblesInBox(p.x - r, p.y - r, r * 2, r * 2, p.damage);
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
          this.particleSystem.emitDebris(
            plat.x + plat.w * 0.5,
            plat.y + plat.h * 0.5,
            '#D97706',
            18,
            300
          );
          this.particleSystem.emitDust(
            plat.x + plat.w * 0.5,
            plat.y + plat.h * 0.5,
            8,
            160,
            '#CBD5E1'
          );
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
      if (!f.alive) continue;
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
            this.applyHitToFighter(null, f, 28, 360, -260, fcX >= 640 ? 1 : -1);
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
          this.applyHitToFighter(null, f, 26, 560, -320, dir);
        }
      }
    }
    void dt;
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
  }

  private updateCamera(dt: number): void {
    const alive = this.fighters.filter((f) => f.alive);
    let targetX = this.arena.width * 0.5;
    let targetY = this.arena.height * 0.5;
    let targetZoom = 1.02;

    if (alive.length > 0 && this.phase === 'playing') {
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

    const lerp = Math.min(1, dt * 4.5);
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
      this.camera,
      this.elapsedTime
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
