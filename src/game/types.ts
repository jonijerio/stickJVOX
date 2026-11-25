export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type PlayMode = '1p_duel' | '1p_ffa' | '2p_versus' | '2p_ffa';

export type AiDifficulty = 'casual' | 'standard' | 'intense';

export type AiArchetype = 'brawler' | 'sharpshooter' | 'trickster';

export type CosmeticPattern = 'solid' | 'stripes' | 'core' | 'viper' | 'crown';

export type BloodStyle = 'crimson' | 'fighter_ink';

export type VictoryPoseType = 'wave' | 'jump' | 'flex';

export type WeaponId =
  | 'fists'
  | 'pistol'
  | 'shotgun'
  | 'smg'
  | 'katana'
  | 'rocket'
  | 'laser';

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  role: string;
  damage: number;
  knockbackX: number;
  knockbackY: number;
  cooldown: number;
  windup: number;
  ammo: number;
  pellets: number;
  spread: number;
  projectileSpeed: number;
  range: number;
  recoil: number;
  color: string;
  isMelee: boolean;
  isBeam?: boolean;
  explosionRadius?: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Platform {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'solid' | 'oneway' | 'ice' | 'bounce' | 'destructible';
  hp?: number;
  maxHp?: number;
  bounceForce?: number;
}

export interface LaserHazard {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cycleDuration: number;
  telegraphTime: number;
  activeTime: number;
  phaseOffset: number;
}

export interface PendulumHazard {
  id: string;
  anchorX: number;
  anchorY: number;
  length: number;
  radius: number;
  maxAngle: number;
  speed: number;
  phaseOffset: number;
}

export interface ArenaDefinition {
  id: string;
  name: string;
  subtitle: string;
  width: number;
  height: number;
  skyTop: string;
  skyBottom: string;
  accentColor: string;
  lavaY: number | null;
  abyssY: number;
  platforms: Platform[];
  lasers: LaserHazard[];
  pendulums: PendulumHazard[];
  spawns: Vec2[];
  weaponDrops: Vec2[];
}

export interface FighterPalette {
  id: number;
  label: string;
  primary: string;
  dark: string;
  glow: string;
  headband: string;
  pattern: CosmeticPattern;
}

export interface FighterCosmetic {
  colorId: string;
  pattern: CosmeticPattern;
}

export interface FighterInputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  jumpJustPressed: boolean;
  jumpHeld: boolean;
  attackJustPressed: boolean;
  attackHeld: boolean;
  blockHeld: boolean;
  blockJustPressed: boolean;
  throwJustPressed: boolean;
  aimAngleOverride?: number | null;
}

export interface RagdollLimb {
  angle: number;
  angVel: number;
}

export interface Fighter {
  id: number;
  name: string;
  isBot: boolean;
  aiArchetype: AiArchetype;
  palette: FighterPalette;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  facing: 1 | -1;
  aimAngle: number;
  hp: number;
  maxHp: number;
  ghostHp: number;
  alive: boolean;
  koTimer: number;
  koReason: string;
  grounded: boolean;
  onIce: boolean;
  wallSlideDir: -1 | 0 | 1;
  coyoteTimer: number;
  jumpBufferTimer: number;
  dropThroughTimer: number;
  weapon: WeaponId;
  ammo: number;
  attackCooldown: number;
  attackWindupTimer: number;
  attackPending: boolean;
  attackActiveTimer: number;
  comboStep: number;
  comboResetTimer: number;
  blocking: boolean;
  parryWindowTimer: number;
  hitFlashTimer: number;
  invulnTimer: number;
  stunTimer: number;
  squashX: number;
  squashY: number;
  walkCycle: number;
  scarfWave: number;
  kills: number;
  damageDealt: number;
  deaths: number;
  wins: number;
  ragdollSpin: number;
  ragdollAngle: number;
  aiThinkTimer: number;
  aiTargetId: number | null;
  aiJumpTimer: number;
  aiDesiredX: number;
  aiAttackDecision: boolean;
  aiBlockTimer: number;
  victoryPose: VictoryPoseType | null;
  victoryTimer: number;
}

export interface Projectile {
  active: boolean;
  id: number;
  ownerId: number;
  weaponId: WeaponId;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  knockbackX: number;
  knockbackY: number;
  life: number;
  color: string;
  isRocket: boolean;
  explosionRadius: number;
  isThrownWeapon?: boolean;
  thrownWeaponId?: WeaponId;
  spinAngle?: number;
}

export type ArenaItemKind = 'weapon' | 'explosive_crate';

export interface WeaponPickup {
  id: number;
  kind: ArenaItemKind;
  weaponId: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angVel: number;
  radius: number;
  hp: number;
  maxHp: number;
  fuseTimer: number;
  grounded: boolean;
  onIce: boolean;
  bobPhase: number;
  parachuteOpen: boolean;
  life: number;
}

export interface BeamEffect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  life: number;
  maxLife: number;
  width: number;
}

export interface SlashArcEffect {
  x: number;
  y: number;
  facing: 1 | -1;
  angle: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface ImpactFlashEffect {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
  spikes: number;
  rot: number;
  kind: 'starburst' | 'muzzle' | 'explosion';
}

export interface FloatingCallout {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export interface AfterimageGhost {
  active: boolean;
  x: number;
  y: number;
  facing: 1 | -1;
  color: string;
  life: number;
  maxLife: number;
  squashX: number;
  squashY: number;
}

export interface ScreenFlashState {
  alpha: number;
  color: string;
}

export type ParticleCategory =
  | 'blood'
  | 'dust'
  | 'debris'
  | 'spark'
  | 'casing'
  | 'ring'
  | 'confetti'
  | 'streamer'
  | 'ribbon'
  | 'fireball'
  | 'smoke'
  | 'firework';

export interface Particle {
  active: boolean;
  category: ParticleCategory;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  bounce: number;
  shape:
    | 'circle'
    | 'spark'
    | 'shard'
    | 'casing'
    | 'ring'
    | 'droplet'
    | 'confetti'
    | 'streamer'
    | 'ribbon'
    | 'star';
  rot: number;
  rotVel: number;
  paintDecalOnHit: boolean;
}

export interface SurfaceDecal {
  active: boolean;
  platformId: string;
  offsetX: number;
  offsetY: number;
  rx: number;
  ry: number;
  color: string;
  alpha: number;
  edge: 'top' | 'left' | 'right';
}

export interface MatchConfig {
  mode: PlayMode;
  difficulty: AiDifficulty;
  roundsToWin: number;
  bloodStyle: BloodStyle;
  showVirtualPsPad: boolean;
  startingArenaId: string;
  fighterStyles: FighterCosmetic[];
}

export interface HudFighterSnapshot {
  id: number;
  name: string;
  isBot: boolean;
  archetypeLabel: string;
  color: string;
  pattern: CosmeticPattern;
  hp: number;
  maxHp: number;
  ghostHp: number;
  alive: boolean;
  weapon: WeaponId;
  weaponName: string;
  ammo: number;
  maxAmmo: number;
  wins: number;
  blocking: boolean;
}

export interface HudSnapshot {
  phase: GamePhase;
  arenaName: string;
  arenaSubtitle: string;
  roundNumber: number;
  roundsToWin: number;
  roundBannerText: string | null;
  roundBannerSubtext: string | null;
  fighters: HudFighterSnapshot[];
  muted: boolean;
  mode: PlayMode;
  connectedPads: number;
  showVirtualPsPad: boolean;
}

export interface MatchSummary {
  winnerId: number;
  winnerName: string;
  winnerColor: string;
  isHumanWin: boolean;
  roundsPlayed: number;
  roundsToWin: number;
  durationSeconds: number;
  victoryPose?: VictoryPoseType;
  playerStats: Array<{
    id: number;
    name: string;
    color: string;
    pattern: CosmeticPattern;
    isBot: boolean;
    wins: number;
    kills: number;
    damageDealt: number;
  }>;
}
