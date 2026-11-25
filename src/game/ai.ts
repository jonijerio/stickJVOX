import { getBotTuning, getLaserPhase } from './rules';
import {
  AiDifficulty,
  ArenaDefinition,
  Fighter,
  FighterInputState,
  Projectile,
  WeaponPickup,
} from './types';
import { WEAPONS } from './weapons';

/**
 * Generates responsive, archetype-distinct AI input for a bot fighter.
 * Supports 3 distinct policies:
 * - 'brawler': aggressive close-range rushdown, wall-jumps, blocks melee swings
 * - 'sharpshooter': prioritizes weapon pickups, maintains mid/long range, kites back
 * - 'trickster': high-ground flanker, leaps across gaps, throws empty/low-ammo guns
 */
export function computeBotInput(
  bot: Fighter,
  fighters: Fighter[],
  arena: ArenaDefinition,
  pickups: WeaponPickup[],
  projectiles: Projectile[],
  difficulty: AiDifficulty,
  roundNumber: number,
  elapsedTime: number,
  dt: number
): FighterInputState {
  const tuning = getBotTuning(difficulty, roundNumber);
  const input: FighterInputState = {
    left: false,
    right: false,
    up: false,
    down: false,
    jumpJustPressed: false,
    jumpHeld: false,
    attackJustPressed: false,
    attackHeld: false,
    blockHeld: false,
    blockJustPressed: false,
    throwJustPressed: false,
  };

  if (!bot.alive || bot.stunTimer > 0) return input;

  // Find nearest alive enemy
  let target: Fighter | null = null;
  let bestDist = Infinity;
  for (const other of fighters) {
    if (other.id === bot.id || !other.alive) continue;
    const d = Math.hypot(other.x - bot.x, other.y - bot.y);
    if (d < bestDist) {
      bestDist = d;
      target = other;
    }
  }

  if (!target) return input;

  const botCx = bot.x + bot.w * 0.5;
  const botCy = bot.y + bot.h * 0.5;
  const targetCx = target.x + target.w * 0.5;
  const targetCy = target.y + target.h * 0.5;

  // Threat check: incoming projectile or close melee windup -> reactive block
  bot.aiBlockTimer = Math.max(0, bot.aiBlockTimer - dt);
  let incomingThreat = false;
  for (const p of projectiles) {
    if (!p.active || p.ownerId === bot.id) continue;
    const dx = botCx - p.x;
    const dy = botCy - p.y;
    const dist = Math.hypot(dx, dy);
    const dot = dx * p.vx + dy * p.vy;
    if (dist < 170 && dot > 0) {
      incomingThreat = true;
      break;
    }
  }
  if (!incomingThreat && bestDist < 85 && (target.attackPending || target.attackActiveTimer > 0)) {
    incomingThreat = true;
  }
  if (incomingThreat && bot.aiBlockTimer <= 0 && Math.random() < tuning.blockChance * 0.35) {
    bot.aiBlockTimer = 0.24;
  }
  if (bot.aiBlockTimer > 0) {
    input.blockHeld = true;
    input.blockJustPressed = bot.aiBlockTimer > 0.21;
  }

  // Periodic decision refresh
  bot.aiThinkTimer -= dt;
  bot.aiJumpTimer = Math.max(0, bot.aiJumpTimer - dt);

  // Check if there is a platform underneath or ahead to avoid walking off edges needlessly
  const hasGroundAt = (probeX: number, probeY: number): boolean => {
    for (const plat of arena.platforms) {
      if (
        probeX >= plat.x - 8 &&
        probeX <= plat.x + plat.w + 8 &&
        plat.y >= probeY - 10 &&
        plat.y <= probeY + 185
      ) {
        return true;
      }
    }
    return false;
  };

  // Find desirable weapon pickup if unarmed or using fists
  let desiredPickup: WeaponPickup | null = null;
  if (bot.weapon === 'fists' && pickups.length > 0) {
    let bestPickScore = Infinity;
    for (const pk of pickups) {
      if (pk.kind !== 'weapon') continue;
      if (!pk.grounded && pk.y < 140) continue;
      if (!hasGroundAt(pk.x, pk.y)) continue;
      const d = Math.hypot(pk.x - botCx, pk.y - botCy);
      if (d < bestPickScore) {
        bestPickScore = d;
        desiredPickup = pk;
      }
    }
  }

  // Aim direction toward target
  const dxToTarget = targetCx - botCx;
  const dyToTarget = targetCy - botCy;
  const desiredFace: 1 | -1 = dxToTarget >= 0 ? 1 : -1;

  // Determine desired X position based on archetype
  if (desiredPickup && (bot.aiArchetype !== 'brawler' || Math.hypot(desiredPickup.x - botCx, desiredPickup.y - botCy) < 280)) {
    bot.aiDesiredX = desiredPickup.x;
  } else if (bot.aiArchetype === 'brawler') {
    bot.aiDesiredX = targetCx - desiredFace * 34;
  } else if (bot.aiArchetype === 'sharpshooter') {
    if (bot.weapon === 'fists') {
      bot.aiDesiredX = targetCx - desiredFace * 42;
    } else {
      const idealRange = bot.weapon === 'shotgun' ? 170 : 340;
      if (Math.abs(dxToTarget) < idealRange - 45) {
        bot.aiDesiredX = botCx - desiredFace * 160;
      } else if (Math.abs(dxToTarget) > idealRange + 75) {
        bot.aiDesiredX = targetCx - desiredFace * idealRange;
      } else {
        bot.aiDesiredX = botCx;
      }
    }
  } else {
    // Trickster: prefers flanking & verticality
    const flankOffset = Math.sin(elapsedTime * 1.4 + bot.id) * 140;
    bot.aiDesiredX = targetCx + flankOffset;
  }

  // Clamp desired X safely inside arena
  bot.aiDesiredX = Math.max(150, Math.min(arena.width - 150, bot.aiDesiredX));

  const moveDelta = bot.aiDesiredX - botCx;
  if (Math.abs(moveDelta) > 16) {
    if (moveDelta < 0) input.left = true;
    else input.right = true;
  }

  // Edge safety & gap jumping: if moving into an abyss without ground ahead, jump!
  const stepDir = input.right ? 1 : input.left ? -1 : 0;
  const probeAheadX = botCx + stepDir * 44;
  const groundAhead = hasGroundAt(probeAheadX, bot.y + bot.h);
  const nearPit = !groundAhead && bot.grounded;

  // Laser hazard avoidance
  let laserWarningNearby = false;
  for (const l of arena.lasers) {
    if (getLaserPhase(l, elapsedTime) !== 'idle') {
      if (Math.abs(botCy - l.y1) < 55 && l.y1 === l.y2) {
        laserWarningNearby = true;
      }
    }
  }

  // Jump decision
  const targetAbove = targetCy < botCy - 65;
  const pickupAbove = desiredPickup && desiredPickup.y < botCy - 55;
  const stuckOnWall = bot.wallSlideDir !== 0;

  if (
    bot.aiJumpTimer <= 0 &&
    (nearPit ||
      laserWarningNearby ||
      stuckOnWall ||
      ((targetAbove || pickupAbove) && bot.grounded && Math.random() < 0.25) ||
      (bot.aiArchetype === 'trickster' && bot.grounded && Math.random() < 0.08))
  ) {
    input.jumpJustPressed = true;
    input.jumpHeld = true;
    bot.aiJumpTimer = nearPit ? 0.35 : 0.55;
  } else if (bot.vy < -120) {
    input.jumpHeld = true;
  }

  // Throw empty / low-ammo gun as trickster or when desperate
  if (
    bot.weapon !== 'fists' &&
    bot.weapon !== 'katana' &&
    bot.ammo <= 1 &&
    bestDist < 260 &&
    bot.aiArchetype === 'trickster' &&
    Math.random() < 0.15
  ) {
    input.throwJustPressed = true;
  }

  // Attack decision
  const spec = WEAPONS[bot.weapon];
  const effectiveRange = spec.isMelee ? spec.range + 22 : Math.min(spec.range, 620);

  if (bot.aiThinkTimer <= 0) {
    bot.aiThinkTimer = tuning.reactionInterval;
    const verticalOk = spec.isMelee ? Math.abs(dyToTarget) < 62 : Math.abs(dyToTarget) < 220;
    bot.aiAttackDecision = bestDist <= effectiveRange && verticalOk && !input.blockHeld;
  }

  if (bot.aiAttackDecision && bot.attackCooldown <= 0) {
    // Face target before attacking
    bot.facing = desiredFace;
    bot.aimAngle = Math.atan2(dyToTarget, dxToTarget) + (Math.random() * 2 - 1) * tuning.accuracySpread;
    input.attackJustPressed = true;
    input.attackHeld = bot.weapon === 'smg';
    if (bot.weapon !== 'smg') {
      bot.aiAttackDecision = false;
    }
  } else if (bot.weapon === 'smg' && bot.aiAttackDecision) {
    bot.facing = desiredFace;
    bot.aimAngle = Math.atan2(dyToTarget, dxToTarget);
    input.attackHeld = true;
  }

  return input;
}
