import {
  ArenaItemKind,
  Fighter,
  FighterPalette,
  LaserHazard,
  MatchConfig,
  PendulumHazard,
  Platform,
  Vec2,
  VictoryPoseType,
  WeaponId,
  WeaponPickup,
} from './types';
import { pickRandomWeapon } from './weapons';

export const FIGHTER_PALETTES: FighterPalette[] = [
  {
    id: 0,
    label: 'P1',
    primary: '#F59E0B',
    dark: '#B45309',
    glow: 'rgba(245, 158, 11, 0.35)',
    headband: '#FDE68A',
    pattern: 'solid',
  },
  {
    id: 1,
    label: 'P2',
    primary: '#EF4444',
    dark: '#991B1B',
    glow: 'rgba(239, 68, 68, 0.35)',
    headband: '#FECACA',
    pattern: 'stripes',
  },
  {
    id: 2,
    label: 'P3',
    primary: '#06B6D4',
    dark: '#0E7490',
    glow: 'rgba(6, 182, 212, 0.35)',
    headband: '#A5F3FC',
    pattern: 'core',
  },
  {
    id: 3,
    label: 'P4',
    primary: '#10B981',
    dark: '#065F46',
    glow: 'rgba(16, 185, 129, 0.35)',
    headband: '#A7F3D0',
    pattern: 'viper',
  },
];

export interface HitResult {
  appliedDamage: number;
  parried: boolean;
  blocked: boolean;
  killed: boolean;
  knockbackX: number;
  knockbackY: number;
}

/**
 * Computes pure combat hit resolution: parry reflection, shield block mitigation,
 * directional knockback, and KO detection.
 */
export function resolveHit(
  target: Pick<Fighter, 'hp' | 'alive' | 'blocking' | 'parryWindowTimer' | 'invulnTimer' | 'facing'>,
  rawDamage: number,
  kbX: number,
  kbY: number,
  attackDir: 1 | -1
): HitResult {
  if (!target.alive || target.invulnTimer > 0) {
    return {
      appliedDamage: 0,
      parried: false,
      blocked: false,
      killed: false,
      knockbackX: 0,
      knockbackY: 0,
    };
  }

  // Perfect parry if blocking within parry window
  if (target.blocking && target.parryWindowTimer > 0) {
    return {
      appliedDamage: 0,
      parried: true,
      blocked: false,
      killed: false,
      knockbackX: attackDir * kbX * 0.15,
      knockbackY: -60,
    };
  }

  // Standard block reduces damage by 70% and knockback by 55%
  if (target.blocking) {
    const mitigated = Math.max(1, Math.round(rawDamage * 0.3));
    const nextHp = Math.max(0, target.hp - mitigated);
    return {
      appliedDamage: mitigated,
      parried: false,
      blocked: true,
      killed: nextHp <= 0,
      knockbackX: attackDir * kbX * 0.45,
      knockbackY: kbY * 0.45,
    };
  }

  const dmg = Math.max(1, Math.round(rawDamage));
  const nextHp = Math.max(0, target.hp - dmg);
  return {
    appliedDamage: dmg,
    parried: false,
    blocked: false,
    killed: nextHp <= 0,
    knockbackX: attackDir * kbX,
    knockbackY: kbY,
  };
}

export type LaserPhase = 'idle' | 'telegraph' | 'active';

/**
 * Evaluates a timed laser hazard's current phase based on simulation time.
 */
export function getLaserPhase(laser: LaserHazard, elapsedTime: number): LaserPhase {
  const t = ((elapsedTime + laser.phaseOffset) % laser.cycleDuration + laser.cycleDuration) % laser.cycleDuration;
  const idleEnd = Math.max(0, laser.cycleDuration - laser.telegraphTime - laser.activeTime);
  if (t < idleEnd) return 'idle';
  if (t < idleEnd + laser.telegraphTime) return 'telegraph';
  return 'active';
}

/**
 * Computes current world position of a swinging pendulum wrecking ball.
 */
export function getPendulumPosition(pendulum: PendulumHazard, elapsedTime: number): Vec2 {
  const angle = Math.sin(elapsedTime * pendulum.speed + pendulum.phaseOffset) * pendulum.maxAngle;
  return {
    x: pendulum.anchorX + Math.sin(angle) * pendulum.length,
    y: pendulum.anchorY + Math.cos(angle) * pendulum.length,
  };
}

/**
 * Distance from point (px, py) to line segment (x1, y1)-(x2, y2).
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Checks if a fighter's AABB intersects an active platform.
 */
export function intersectsPlatform(
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  p: Platform
): boolean {
  return fx < p.x + p.w && fx + fw > p.x && fy < p.y + p.h && fy + fh > p.y;
}

export interface RoundOutcome {
  roundOver: boolean;
  winnerId: number | null;
  isDraw: boolean;
}

/**
 * Determines whether a round has ended (0 or 1 fighter remaining alive).
 */
export function evaluateRoundOutcome(fighters: ReadonlyArray<Pick<Fighter, 'id' | 'alive'>>): RoundOutcome {
  const alive = fighters.filter((f) => f.alive);
  if (alive.length === 1) {
    return { roundOver: true, winnerId: alive[0].id, isDraw: false };
  }
  if (alive.length === 0) {
    return { roundOver: true, winnerId: null, isDraw: true };
  }
  return { roundOver: false, winnerId: null, isDraw: false };
}

/**
 * Determines whether the overall match is complete based on roundsToWin.
 */
export function evaluateMatchWinner(
  fighters: ReadonlyArray<Pick<Fighter, 'id' | 'wins'>>,
  roundsToWin: number
): number | null {
  for (const f of fighters) {
    if (f.wins >= roundsToWin) return f.id;
  }
  return null;
}

/**
 * Returns number of fighters and human flags for a given play mode.
 */
export function getModeRoster(config: MatchConfig): Array<{ id: number; name: string; isBot: boolean }> {
  switch (config.mode) {
    case '1p_duel':
      return [
        { id: 0, name: 'Player 1', isBot: false },
        { id: 1, name: 'Bot 2', isBot: true },
      ];
    case '1p_ffa':
      return [
        { id: 0, name: 'Player 1', isBot: false },
        { id: 1, name: 'Bot 2', isBot: true },
        { id: 2, name: 'Bot 3', isBot: true },
        { id: 3, name: 'Bot 4', isBot: true },
      ];
    case '2p_versus':
      return [
        { id: 0, name: 'Player 1', isBot: false },
        { id: 1, name: 'Player 2', isBot: false },
      ];
    case '2p_ffa':
      return [
        { id: 0, name: 'Player 1', isBot: false },
        { id: 1, name: 'Player 2', isBot: false },
        { id: 2, name: 'Bot 3', isBot: true },
        { id: 3, name: 'Bot 4', isBot: true },
      ];
  }
}

/**
 * Difficulty scaling parameters for AI bots across difficulty tiers & round progression.
 */
export function getBotTuning(difficulty: MatchConfig['difficulty'], roundNumber: number) {
  const baseReaction =
    difficulty === 'casual' ? 0.34 : difficulty === 'standard' ? 0.2 : 0.11;
  const roundFactor = Math.max(0.72, 1 - (roundNumber - 1) * 0.04);
  const accuracySpread =
    difficulty === 'casual' ? 0.28 : difficulty === 'standard' ? 0.14 : 0.05;
  const blockChance =
    difficulty === 'casual' ? 0.15 : difficulty === 'standard' ? 0.35 : 0.6;
  const speedScale =
    difficulty === 'casual' ? 0.84 : difficulty === 'standard' ? 0.96 : 1.06;

  return {
    reactionInterval: baseReaction * roundFactor,
    accuracySpread,
    blockChance,
    speedScale,
  };
}

export const VICTORY_POSES: readonly VictoryPoseType[] = ['wave', 'jump', 'flex'];

export function pickRandomVictoryPose(rng: () => number = Math.random): VictoryPoseType {
  const idx = Math.min(
    VICTORY_POSES.length - 1,
    Math.max(0, Math.floor(rng() * VICTORY_POSES.length))
  );
  return VICTORY_POSES[idx];
}

export interface VictoryRig {
  hipY: number;
  shoulderX: number;
  shoulderY: number;
  headX: number;
  headY: number;
  leftKnee: Vec2;
  leftFoot: Vec2;
  rightKnee: Vec2;
  rightFoot: Vec2;
  leftElbow: Vec2;
  leftHand: Vec2;
  rightElbow: Vec2;
  rightHand: Vec2;
}

/**
 * Pure articulated skeletal pose solver for post-match stickman victory celebrations.
 * Returns local feet-origin joint coordinates (hip, knees, feet, shoulders, elbows, hands, head)
 * for 'wave', 'jump', and 'flex' animations.
 */
export function computeVictoryRig(
  pose: VictoryPoseType,
  t: number,
  facing: 1 | -1,
  grounded: boolean
): VictoryRig {
  if (pose === 'wave') {
    const bob = Math.abs(Math.sin(t * 5.2)) * 2.5;
    const waveOsc = Math.sin(t * 10.5);
    const hipY = -22 + bob;
    const shoulderX = facing * 1.5;
    const shoulderY = -40 + bob;
    const headX = facing * 2 + Math.sin(t * 5.2) * 1.2;
    const headY = -49 + bob;

    // One arm on hip, other arm raised high waving energetically
    const waveDir = facing;
    return {
      hipY,
      shoulderX,
      shoulderY,
      headX,
      headY,
      leftKnee: { x: -5, y: -11 + bob * 0.5 },
      leftFoot: { x: -7, y: 0 },
      rightKnee: { x: 5, y: -11 + bob * 0.5 },
      rightFoot: { x: 7, y: 0 },
      leftElbow: { x: shoulderX - waveDir * 10, y: shoulderY + 7 },
      leftHand: { x: -waveDir * 4, y: hipY - 1 },
      rightElbow: { x: shoulderX + waveDir * 10, y: shoulderY - 9 },
      rightHand: {
        x: shoulderX + waveDir * (13 + waveOsc * 7),
        y: shoulderY - 22 + Math.abs(waveOsc) * 3,
      },
    };
  }

  if (pose === 'jump') {
    const airFactor = grounded ? 0 : 1;
    const pump = Math.sin(t * 12);
    const hipY = grounded ? -20 : -23;
    const shoulderX = 0;
    const shoulderY = hipY - 18;
    const headX = Math.sin(t * 6) * 1.5;
    const headY = shoulderY - 9;

    const legSpread = 6 + airFactor * 5;
    const footLift = airFactor * (6 + Math.max(0, pump) * 3);

    return {
      hipY,
      shoulderX,
      shoulderY,
      headX,
      headY,
      leftKnee: { x: -legSpread, y: -11 - footLift * 0.6 },
      leftFoot: { x: -legSpread - airFactor * 3, y: -footLift },
      rightKnee: { x: legSpread, y: -11 - footLift * 0.6 },
      rightFoot: { x: legSpread + airFactor * 3, y: -footLift },
      leftElbow: { x: -11, y: shoulderY - 10 - airFactor * 4 },
      leftHand: { x: -16 - pump * 2, y: shoulderY - 21 - airFactor * 5 },
      rightElbow: { x: 11, y: shoulderY - 10 - airFactor * 4 },
      rightHand: { x: 16 + pump * 2, y: shoulderY - 21 - airFactor * 5 },
    };
  }

  // 'flex': Double-bicep champion power stance
  const pulse = Math.sin(t * 7.5);
  const crouch = 2 + Math.max(0, -pulse) * 1.5;
  const hipY = -22 + crouch;
  const shoulderX = -facing * 1.5; // slight proud chest-out lean back
  const shoulderY = -40 + crouch * 0.9;
  const headX = shoulderX;
  const headY = -49 + crouch * 0.8;
  const curlIn = Math.max(0, pulse) * 3;

  return {
    hipY,
    shoulderX,
    shoulderY,
    headX,
    headY,
    leftKnee: { x: -11, y: -11 + crouch * 0.4 },
    leftFoot: { x: -13, y: 0 },
    rightKnee: { x: 11, y: -11 + crouch * 0.4 },
    rightFoot: { x: 13, y: 0 },
    leftElbow: { x: shoulderX - 18, y: shoulderY - 3 },
    leftHand: { x: shoulderX - 15 + curlIn, y: shoulderY - 15 },
    rightElbow: { x: shoulderX + 18, y: shoulderY - 3 },
    rightHand: { x: shoulderX + 15 - curlIn, y: shoulderY - 15 },
  };
}

/**
 * Pure articulated ragdoll limb solver for KO'd stickmen so arms and legs
 * whip and flail wildly during high-speed tumbles rather than freezing rigidly.
 */
export function computeRagdollFlailRig(
  ragdollAngle: number,
  speed: number,
  t: number
): VictoryRig {
  const flailAmp = Math.min(1.4, 0.55 + speed / 520);
  const wA = Math.sin(t * 19 + ragdollAngle * 1.4) * flailAmp;
  const wB = Math.cos(t * 23 - ragdollAngle * 1.2) * flailAmp;
  const kickA = Math.sin(t * 16 + 1.1) * flailAmp;
  const kickB = Math.cos(t * 18 - 0.8) * flailAmp;

  const hipY = -20;
  const shoulderX = wA * 4;
  const shoulderY = -39;
  const headX = wA * 6.5;
  const headY = -48;

  return {
    hipY,
    shoulderX,
    shoulderY,
    headX,
    headY,
    leftKnee: { x: -7 - kickA * 7, y: -10 + kickB * 4 },
    leftFoot: { x: -13 - kickA * 12, y: 2 + kickB * 8 },
    rightKnee: { x: 7 + kickB * 7, y: -10 - kickA * 4 },
    rightFoot: { x: 13 + kickB * 12, y: 2 - kickA * 8 },
    leftElbow: { x: shoulderX - 12 - wA * 6, y: shoulderY - 6 + wB * 8 },
    leftHand: { x: shoulderX - 22 - wB * 8, y: shoulderY - 15 + wA * 11 },
    rightElbow: { x: shoulderX + 12 + wB * 6, y: shoulderY - 6 - wA * 8 },
    rightHand: { x: shoulderX + 22 + wA * 8, y: shoulderY - 15 - wB * 11 },
  };
}

/**
 * Pure starburst radius curve for jagged comic hit/explosion flashes.
 */
export function computeImpactStarMetrics(
  progress: number,
  baseRadius: number
): { outerRadius: number; innerRadius: number } {
  const clamped = Math.max(0, Math.min(1, progress));
  const pop = 0.55 + (1 - clamped) * 0.85;
  return {
    outerRadius: baseRadius * pop,
    innerRadius: baseRadius * pop * 0.36,
  };
}

export interface VictoryShakeSample {
  intensity: number;
  minTrauma: number;
  impulseTrauma: number;
  kickX: number;
  kickY: number;
}

/**
 * Pure movement-reactive screen-shake calculator for the post-match victory sequence.
 * Scales continuous trauma floor, peak impulse spikes, and directional camera kicks
 * directly from the winner's velocity, jump/land impacts, and celebration animation energy.
 */
export function computeVictoryShakeResponse(
  pose: VictoryPoseType,
  prevTimer: number,
  currTimer: number,
  vx: number,
  vy: number,
  grounded: boolean,
  justLanded: boolean,
  justJumped: boolean,
  landingVy: number,
  facing: 1 | -1
): VictoryShakeSample {
  const speed = Math.hypot(vx, vy);

  if (pose === 'jump') {
    const airIntensity = grounded ? 0.16 : Math.min(0.85, 0.25 + speed / 640);
    if (justLanded) {
      const landStrength = Math.max(0.35, Math.min(1, landingVy / 520));
      return {
        intensity: Math.max(airIntensity, landStrength),
        minTrauma: 0.26 * landStrength,
        impulseTrauma: 0.34 + 0.28 * landStrength,
        kickX: facing * (3.5 * landStrength),
        kickY: 11 * landStrength,
      };
    }
    if (justJumped) {
      return {
        intensity: 0.74,
        minTrauma: 0.24,
        impulseTrauma: 0.3,
        kickX: -facing * 2.5,
        kickY: -8,
      };
    }
    return {
      intensity: airIntensity,
      minTrauma: airIntensity * 0.34,
      impulseTrauma: 0,
      kickX: 0,
      kickY: 0,
    };
  }

  if (pose === 'flex') {
    const prevPulse = Math.sin(prevTimer * 7.5);
    const currPulse = Math.sin(currTimer * 7.5);
    const flexVelocity = Math.abs(Math.cos(currTimer * 7.5));
    const intensity = Math.min(1, 0.28 + flexVelocity * 0.56 + Math.min(0.25, speed / 420));

    const hitPeak = prevPulse < 0.85 && currPulse >= 0.85;
    const hitStomp = prevPulse > -0.85 && currPulse <= -0.85;
    if (hitPeak || hitStomp) {
      return {
        intensity: Math.max(intensity, 0.86),
        minTrauma: 0.32,
        impulseTrauma: hitStomp ? 0.4 : 0.32,
        kickX: facing * (hitPeak ? 4.5 : -3.5),
        kickY: hitStomp ? 8.5 : -5.5,
      };
    }

    return {
      intensity,
      minTrauma: intensity * 0.36,
      impulseTrauma: 0,
      kickX: facing * Math.cos(currTimer * 7.5) * 1.6,
      kickY: 0,
    };
  }

  // 'wave': rapid arm whip + bouncy foot-taps
  const prevStep = Math.floor((prevTimer * 5.2) / Math.PI);
  const currStep = Math.floor((currTimer * 5.2) / Math.PI);
  const waveSpeed = Math.abs(Math.cos(currTimer * 10.5));
  const intensity = Math.min(1, 0.24 + waveSpeed * 0.5 + Math.min(0.25, speed / 420));

  if (currStep !== prevStep) {
    return {
      intensity: Math.max(intensity, 0.72),
      minTrauma: 0.28,
      impulseTrauma: 0.28,
      kickX: facing * 5,
      kickY: 6,
    };
  }

  return {
    intensity,
    minTrauma: intensity * 0.32,
    impulseTrauma: 0,
    kickX: Math.cos(currTimer * 10.5) * 2.4,
    kickY: 0,
  };
}

export interface LimbEmitterPoint {
  x: number;
  y: number;
  outAngle: number;
}

/**
 * Pure articulated limb-tip emitter solver for victory confetti cannons.
 * Maps the winner's hands and feet from the victory rig into world space
 * with outward radial launch angles from the torso.
 */
export function computeVictoryLimbEmitters(
  cx: number,
  bottomY: number,
  pose: VictoryPoseType,
  t: number,
  facing: 1 | -1,
  grounded: boolean,
  squashX = 1,
  squashY = 1
): LimbEmitterPoint[] {
  const rig = computeVictoryRig(pose, t, facing, grounded);
  const torsoCenterY = (rig.shoulderY + rig.hipY) * 0.5 * squashY;
  const joints = [rig.leftHand, rig.rightHand, rig.leftFoot, rig.rightFoot];

  return joints.map((joint) => {
    const localX = joint.x * squashX;
    const localY = joint.y * squashY;
    return {
      x: cx + localX,
      y: bottomY + localY,
      outAngle: Math.atan2(localY - torsoCenterY, localX || facing),
    };
  });
}

export interface VictoryBloomMetrics {
  bloomRadius: number;
  coreRadius: number;
  bloomAlpha: number;
  rayRotation: number;
  rayLength: number;
  rayCount: number;
  anamorphicWidth: number;
  anamorphicAlpha: number;
  starFlareScale: number;
  burstFactor: number;
}

/**
 * Pure cinematic bloom and lens-flare curve originating from the match winner.
 * Combines an initial victory clinch burst with rhythmic energy pulses scaled by
 * the winner's movement intensity and toned gently once the gameover card appears.
 */
export function computeVictoryBloomMetrics(
  t: number,
  intensity: number,
  isGameover = false
): VictoryBloomMetrics {
  const safeT = Math.max(0, t);
  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  const burstFactor = Math.max(0, 1 - safeT / 0.55);
  const pulse = 0.72 + 0.28 * Math.sin(safeT * 7.8);
  const energy = Math.min(1, 0.35 + clampedIntensity * 0.45 + burstFactor * 0.55);
  const phaseDamp = isGameover ? 0.68 : 1;

  return {
    bloomRadius: (170 + 75 * pulse + 95 * burstFactor + 45 * clampedIntensity) * (isGameover ? 0.88 : 1),
    coreRadius: (40 + 18 * pulse + 34 * burstFactor) * (isGameover ? 0.88 : 1),
    bloomAlpha: Math.min(0.92, (0.44 + 0.24 * energy + 0.22 * burstFactor) * phaseDamp),
    rayRotation: safeT * 0.62,
    rayLength: (175 + 75 * pulse + 105 * burstFactor + 40 * clampedIntensity) * (isGameover ? 0.86 : 1),
    rayCount: 8,
    anamorphicWidth: (240 + 90 * pulse + 165 * burstFactor + 60 * clampedIntensity) * (isGameover ? 0.8 : 1),
    anamorphicAlpha: Math.min(0.88, (0.34 + 0.28 * energy + 0.25 * burstFactor) * phaseDamp),
    starFlareScale: (0.72 + 0.35 * pulse + 0.55 * burstFactor + 0.25 * clampedIntensity) * (isGameover ? 0.82 : 1),
    burstFactor,
  };
}

export interface KillCamState {
  progress: number;
  timeScale: number;
  targetZoom: number;
  vignetteAlpha: number;
}

/**
 * Computes normalized 2-second slow-motion kill-cam curves:
 * - Slows simulation time steeply right on the final KO impact (~0.18x) and eases toward handoff.
 * - Zooms the camera smoothly in toward the winning fighter (~1.56x).
 * - Fades a subtle cinematic letterbox/vignette in and out over the 2s window.
 */
export function computeKillCamState(elapsed: number, duration = 2.0): KillCamState {
  const safeDuration = Math.max(0.1, duration);
  const progress = Math.max(0, Math.min(1, elapsed / safeDuration));

  // Slow-mo time dilation: deep 0.18x freeze-action feel through 72% of clip, easing up to 0.52x before victory dance
  let timeScale: number;
  if (progress <= 0.72) {
    const t = progress / 0.72;
    timeScale = 0.18 + 0.06 * t;
  } else {
    const t = (progress - 0.72) / 0.28;
    const smooth = t * t * (3 - 2 * t);
    timeScale = 0.24 + (0.52 - 0.24) * smooth;
  }

  // Smooth cubic ease-out zoom from mid-shot (1.22x) into hero close-up (1.56x)
  const zoomT = Math.min(1, progress / 0.58);
  const zoomEase = 1 - Math.pow(1 - zoomT, 3);
  const targetZoom = 1.22 + (1.56 - 1.22) * zoomEase;

  // Cinematic vignette envelope
  let vignetteAlpha = 0.54;
  if (progress < 0.12) {
    vignetteAlpha = (progress / 0.12) * 0.54;
  } else if (progress > 0.86) {
    vignetteAlpha = (1 - (progress - 0.86) / 0.14) * 0.54;
  }

  return {
    progress,
    timeScale,
    targetZoom,
    vignetteAlpha: Math.max(0, Math.min(0.65, vignetteAlpha)),
  };
}

export type CameraShakeEventKind = 'explosion' | 'destruction' | 'collision';

export interface CameraShakeImpulse {
  traumaAdd: number;
  traumaFloor: number;
  kickX: number;
  kickY: number;
  angleKick: number;
}

/**
 * Pure screen-wide camera shake solver for explosions, structural destruction, and heavy collisions.
 */
export function computeCameraShakeImpulse(
  kind: CameraShakeEventKind,
  magnitude = 1,
  dirX = 0,
  dirY = 0
): CameraShakeImpulse {
  const mag = Math.max(0.2, Math.min(2.2, magnitude));
  const len = Math.hypot(dirX, dirY);
  const nx = len > 0.001 ? dirX / len : 0;
  const ny = len > 0.001 ? dirY / len : 0;
  const sideSign = nx !== 0 ? Math.sign(nx) : 1;

  if (kind === 'explosion') {
    return {
      traumaAdd: Math.min(1, 0.58 * mag),
      traumaFloor: Math.min(0.95, 0.44 * mag),
      kickX: nx * 16 * mag,
      kickY: (ny !== 0 ? ny * 14 : -12) * mag,
      angleKick: sideSign * 0.018 * Math.min(1.5, mag),
    };
  }

  if (kind === 'destruction') {
    return {
      traumaAdd: Math.min(1, 0.48 * mag),
      traumaFloor: Math.min(0.9, 0.36 * mag),
      kickX: nx * 9 * mag,
      kickY: (ny !== 0 ? ny * 11 : 10) * mag,
      angleKick: -sideSign * 0.015 * Math.min(1.6, mag),
    };
  }

  // 'collision'
  return {
    traumaAdd: Math.min(0.85, 0.36 * mag),
    traumaFloor: Math.min(0.75, 0.22 * mag),
    kickX: nx * 11 * mag,
    kickY: ny * 8 * mag,
    angleKick: sideSign * 0.011 * Math.min(1.4, mag),
  };
}

export interface ArenaDropChoice {
  kind: ArenaItemKind;
  weaponId: WeaponId;
}

/**
 * Picks a random physics-enabled drop item: guns, katana sword, or volatile explosive crate.
 */
export function pickRandomArenaDrop(
  rng: () => number = Math.random,
  allowExplosiveCrate = true
): ArenaDropChoice {
  if (allowExplosiveCrate && rng() < 0.24) {
    return { kind: 'explosive_crate', weaponId: 'rocket' };
  }
  return { kind: 'weapon', weaponId: pickRandomWeapon(rng) };
}

export interface ArenaItemPhysicsStep {
  bounced: boolean;
  hitBouncePad: boolean;
  highSpeedImpact: boolean;
}

/**
 * Pure rigid-body style physics step for dropped arena weapons & explosive crates:
 * gravity, parachute descent, platform bounce & slide, wall rebound, bounce pads, and angular spin.
 */
export function stepArenaItemPhysics(
  item: WeaponPickup,
  platforms: ReadonlyArray<Platform>,
  arenaWidth: number,
  dt: number,
  gravity = 1260
): ArenaItemPhysicsStep {
  let bounced = false;
  let hitBouncePad = false;
  let highSpeedImpact = false;

  if (item.fuseTimer > 0) {
    item.fuseTimer = Math.max(0, item.fuseTimer - dt);
  }

  // Check whether a grounded item still has an intact surface underneath (so collapsing bridges drop it)
  if (item.grounded) {
    let stillSupported = false;
    const bottomY = item.y + item.radius;
    for (const plat of platforms) {
      if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
      if (
        item.x + item.radius * 0.6 >= plat.x &&
        item.x - item.radius * 0.6 <= plat.x + plat.w &&
        Math.abs(bottomY - plat.y) <= 6
      ) {
        stillSupported = true;
        item.onIce = plat.kind === 'ice';
        break;
      }
    }
    if (!stillSupported || Math.abs(item.vy) > 5) {
      item.grounded = false;
    }
  }

  if (!item.grounded) {
    const useParachute = item.parachuteOpen && item.vy >= -40;
    const accel = useParachute ? 420 : gravity;
    const maxVy = useParachute ? 128 : 780;
    item.vy = Math.min(maxVy, item.vy + accel * dt);
    item.vx *= Math.pow(useParachute ? 0.45 : 0.88, dt);

    const prevBottom = item.y + item.radius;
    item.x += item.vx * dt;
    item.y += item.vy * dt;
    item.angle += item.angVel * dt;

    // Arena wall rebound
    const wallMargin = 32 + item.radius;
    if (item.x < wallMargin) {
      item.x = wallMargin;
      item.vx = Math.abs(item.vx) * 0.65;
      item.angVel = item.vx * 0.03;
      bounced = true;
    } else if (item.x > arenaWidth - wallMargin) {
      item.x = arenaWidth - wallMargin;
      item.vx = -Math.abs(item.vx) * 0.65;
      item.angVel = item.vx * 0.03;
      bounced = true;
    }

    // Platform collisions (bounce, settle, or launch on jump pads)
    for (const plat of platforms) {
      if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
      const inX = item.x + item.radius * 0.75 >= plat.x && item.x - item.radius * 0.75 <= plat.x + plat.w;
      if (!inX) continue;

      const crossedTop = item.vy >= 0 && prevBottom <= plat.y + 18 && item.y + item.radius >= plat.y;
      const inY = item.y + item.radius >= plat.y && item.y - item.radius <= plat.y + plat.h;
      if (!crossedTop && !inY) continue;

      if (crossedTop) {
        if (plat.kind === 'bounce') {
          item.y = plat.y - item.radius;
          item.vy = (plat.bounceForce ?? -920) * 0.72;
          item.vx += (item.vx >= 0 ? 1 : -1) * 45;
          item.angVel = (item.vx >= 0 ? 1 : -1) * 9;
          item.parachuteOpen = false;
          item.grounded = false;
          hitBouncePad = true;
          break;
        }

        const impactSpeed = item.vy;
        item.y = plat.y - item.radius;
        item.parachuteOpen = false;
        item.onIce = plat.kind === 'ice';

        if (impactSpeed > 460) {
          highSpeedImpact = true;
        }

        if (impactSpeed > 185) {
          item.vy = -impactSpeed * 0.36;
          item.vx *= 0.84;
          item.angVel = item.vx * 0.03;
          item.grounded = false;
          bounced = true;
        } else {
          item.vy = 0;
          item.grounded = true;
        }
        break;
      } else if (plat.kind !== 'oneway' && item.vy < 0 && item.y > plat.y + plat.h - 14) {
        item.y = plat.y + plat.h + item.radius;
        item.vy = Math.abs(item.vy) * 0.35;
        bounced = true;
        break;
      }
    }
  } else {
    // Grounded slide friction (ice keeps momentum; steel damps fast)
    const friction = item.onIce ? 0.52 : 0.015;
    item.vx *= Math.pow(friction, dt);
    if (Math.abs(item.vx) < 4) item.vx = 0;
    item.x += item.vx * dt;

    // Keep sliding items inside arena walls
    const wallMargin = 32 + item.radius;
    if (item.x < wallMargin) {
      item.x = wallMargin;
      item.vx = Math.abs(item.vx) * 0.6;
    } else if (item.x > arenaWidth - wallMargin) {
      item.x = arenaWidth - wallMargin;
      item.vx = -Math.abs(item.vx) * 0.6;
    }

    // Settle tilt angle back toward flat
    item.angle *= Math.pow(0.06, dt);
    item.angVel *= Math.pow(0.04, dt);
  }

  return { bounced, hitBouncePad, highSpeedImpact };
}


