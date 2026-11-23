import { Fighter, FighterPalette, LaserHazard, MatchConfig, PendulumHazard, Platform, Vec2 } from './types';

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
