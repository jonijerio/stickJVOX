import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MATCH_CONFIG, resolveFighterPalette } from './cosmetics';
import { mapGamepadToFighterInput } from './gamepad';
import { ParticleSystem } from './particles';
import {
  evaluateMatchWinner,
  evaluateRoundOutcome,
  getBotTuning,
  getLaserPhase,
  getModeRoster,
  getPendulumPosition,
  pointToSegmentDistance,
  resolveHit,
} from './rules';
import { Platform } from './types';

test('resolveHit handles standard, blocked, and parried attacks cleanly', () => {
  const unblocked = resolveHit(
    { hp: 100, alive: true, blocking: false, parryWindowTimer: 0, invulnTimer: 0, facing: 1 },
    30,
    400,
    -200,
    1
  );
  assert.equal(unblocked.appliedDamage, 30);
  assert.equal(unblocked.parried, false);
  assert.equal(unblocked.blocked, false);
  assert.equal(unblocked.killed, false);
  assert.equal(unblocked.knockbackX, 400);

  const parried = resolveHit(
    { hp: 100, alive: true, blocking: true, parryWindowTimer: 0.12, invulnTimer: 0, facing: -1 },
    30,
    400,
    -200,
    1
  );
  assert.equal(parried.appliedDamage, 0);
  assert.equal(parried.parried, true);
  assert.equal(parried.killed, false);

  const blocked = resolveHit(
    { hp: 100, alive: true, blocking: true, parryWindowTimer: 0, invulnTimer: 0, facing: -1 },
    30,
    400,
    -200,
    1
  );
  assert.equal(blocked.appliedDamage, 9);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.parried, false);

  const lethal = resolveHit(
    { hp: 20, alive: true, blocking: false, parryWindowTimer: 0, invulnTimer: 0, facing: 1 },
    25,
    300,
    -150,
    -1
  );
  assert.equal(lethal.killed, true);
  assert.equal(lethal.knockbackX, -300);
});

test('getLaserPhase cycles cleanly through idle, telegraph, and active windows', () => {
  const laser = {
    id: 'l1',
    x1: 0,
    y1: 100,
    x2: 500,
    y2: 100,
    cycleDuration: 4.0,
    telegraphTime: 0.75,
    activeTime: 0.75,
    phaseOffset: 0,
  };
  assert.equal(getLaserPhase(laser, 1.0), 'idle');
  assert.equal(getLaserPhase(laser, 2.8), 'telegraph');
  assert.equal(getLaserPhase(laser, 3.6), 'active');
  assert.equal(getLaserPhase(laser, 4.5), 'idle');
});

test('pendulum position and point-to-segment distance math are accurate', () => {
  const pos = getPendulumPosition(
    { id: 'p', anchorX: 500, anchorY: 100, length: 200, radius: 30, maxAngle: 1.0, speed: 2, phaseOffset: 0 },
    0
  );
  assert.equal(Math.round(pos.x), 500);
  assert.equal(Math.round(pos.y), 300);

  const dist = pointToSegmentDistance(50, 20, 0, 0, 100, 0);
  assert.equal(dist, 20);
});

test('round and match win evaluation triggers at correct thresholds', () => {
  assert.deepEqual(
    evaluateRoundOutcome([
      { id: 0, alive: true },
      { id: 1, alive: false },
    ]),
    { roundOver: true, winnerId: 0, isDraw: false }
  );

  assert.deepEqual(
    evaluateRoundOutcome([
      { id: 0, alive: false },
      { id: 1, alive: false },
    ]),
    { roundOver: true, winnerId: null, isDraw: true }
  );

  assert.equal(
    evaluateMatchWinner(
      [
        { id: 0, wins: 2 },
        { id: 1, wins: 3 },
      ],
      3
    ),
    1
  );
  assert.equal(
    evaluateMatchWinner(
      [
        { id: 0, wins: 2 },
        { id: 1, wins: 2 },
      ],
      3
    ),
    null
  );
});

test('mode roster and bot difficulty tuning return expected configurations', () => {
  assert.equal(getModeRoster({ ...DEFAULT_MATCH_CONFIG, mode: '1p_duel' }).length, 2);
  assert.equal(getModeRoster({ ...DEFAULT_MATCH_CONFIG, mode: '1p_ffa' }).length, 4);
  assert.equal(
    getModeRoster({ ...DEFAULT_MATCH_CONFIG, mode: '2p_versus' }).every((r) => !r.isBot),
    true
  );

  const casual = getBotTuning('casual', 1);
  const intense = getBotTuning('intense', 4);
  assert.ok(intense.reactionInterval < casual.reactionInterval);
  assert.ok(intense.speedScale > casual.speedScale);
});

test('ParticleSystem spawns blood/dust/debris, paints persistent decals on platform hit, and clears cleanly', () => {
  const ps = new ParticleSystem(32, 16);
  const floor: Platform = { id: 'floor', x: 0, y: 200, w: 400, h: 30, kind: 'solid' };

  ps.emitBloodSplatter(150, 195, 1, '#DC2626', 1, () => 0.5);
  ps.emitDust(100, 198, 4, 80, '#CBD5E1', () => 0.5);
  ps.emitDebris(220, 180, '#D97706', 4, 150, () => 0.5);

  const activeBefore = ps.particles.filter((p) => p.active).length;
  assert.ok(activeBefore >= 12);

  // Advance simulation so falling blood droplets strike the floor platform
  for (let step = 0; step < 30; step++) {
    ps.update(0.02, [floor]);
  }

  const activeDecals = ps.decals.filter((d) => d.active);
  assert.ok(activeDecals.length > 0, 'Expected blood droplets hitting floor to paint persistent decals');
  assert.equal(activeDecals[0].platformId, 'floor');
  assert.equal(activeDecals[0].color, '#DC2626');

  ps.clearAll();
  assert.equal(ps.particles.some((p) => p.active), false);
  assert.equal(ps.decals.some((d) => d.active), false);
});

test('mapGamepadToFighterInput maps PlayStation Cross/Square/Circle/Triangle, sticks, and Options cleanly', () => {
  const emptyButtons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));

  // Frame 1: Press Cross (0), Square (2), Options (9), push L-stick right and R-stick down-right
  const btns1 = emptyButtons.map((b, i) => ({
    pressed: i === 0 || i === 2 || i === 9,
    value: i === 0 || i === 2 || i === 9 ? 1 : 0,
  }));
  const frame1 = mapGamepadToFighterInput({ buttons: btns1, axes: [0.85, 0, 0.7, 0.7] }, []);
  assert.equal(frame1.input.right, true);
  assert.equal(frame1.input.left, false);
  assert.equal(frame1.input.jumpJustPressed, true);
  assert.equal(frame1.input.jumpHeld, true);
  assert.equal(frame1.input.attackJustPressed, true);
  assert.equal(frame1.input.blockJustPressed, false);
  assert.equal(frame1.input.throwJustPressed, false);
  assert.equal(frame1.optionsJustPressed, true);
  assert.ok(Math.abs((frame1.input.aimAngleOverride ?? 0) - Math.PI / 4) < 0.01);

  // Frame 2: Hold Cross, switch to Circle (1) & Triangle (3)
  const btns2 = emptyButtons.map((_, i) => ({
    pressed: i === 0 || i === 1 || i === 3,
    value: i === 0 || i === 1 || i === 3 ? 1 : 0,
  }));
  const frame2 = mapGamepadToFighterInput({ buttons: btns2, axes: [0, 0, 0, 0] }, frame1.nextButtons);
  assert.equal(frame2.input.jumpJustPressed, false);
  assert.equal(frame2.input.jumpHeld, true);
  assert.equal(frame2.input.blockJustPressed, true);
  assert.equal(frame2.input.blockHeld, true);
  assert.equal(frame2.input.throwJustPressed, true);
  assert.equal(frame2.optionsJustPressed, false);
  assert.equal(frame2.input.aimAngleOverride, null);
});

test('resolveFighterPalette applies custom swatch colors and patterns for any fighter slot', () => {
  const p1 = resolveFighterPalette(0, { colorId: 'violet', pattern: 'crown' });
  assert.equal(p1.label, 'P1');
  assert.equal(p1.primary, '#A855F7');
  assert.equal(p1.pattern, 'crown');

  const bot = resolveFighterPalette(2, { colorId: 'cobalt', pattern: 'viper' });
  assert.equal(bot.label, 'P3');
  assert.equal(bot.primary, '#3B82F6');
  assert.equal(bot.pattern, 'viper');
});
