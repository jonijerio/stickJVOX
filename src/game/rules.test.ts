import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENAS } from './arenas';
import { DEFAULT_MATCH_CONFIG, resolveFighterPalette } from './cosmetics';
import { mapGamepadToFighterInput } from './gamepad';
import { ParticleSystem } from './particles';
import {
  computeBlackHolePull,
  computeCameraShakeImpulse,
  computeImpactStarMetrics,
  computeKillCamState,
  computeRagdollFlailRig,
  computeSnakeSteering,
  computeVictoryBloomMetrics,
  computeVictoryLimbEmitters,
  computeVictoryRig,
  computeVictoryShakeResponse,
  computeWeatherPhysicsInfluence,
  createWeatherState,
  evaluateMatchWinner,
  evaluateRoundOutcome,
  getBotTuning,
  getLaserPhase,
  getModeRoster,
  getPendulumPosition,
  intersectsPlatform,
  pickRandomArenaDrop,
  pickRandomVictoryPose,
  pointToSegmentDistance,
  resolveHit,
  stepArenaItemPhysics,
  stepWeatherState,
} from './rules';
import { Platform, WeaponPickup } from './types';
import { DROP_POOL, WEAPONS } from './weapons';

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

test('pickRandomVictoryPose selects wave, jump, or flex across rng range', () => {
  assert.equal(pickRandomVictoryPose(() => 0.05), 'wave');
  assert.equal(pickRandomVictoryPose(() => 0.5), 'jump');
  assert.equal(pickRandomVictoryPose(() => 0.95), 'flex');
});

test('computeVictoryRig outputs distinct articulated joints for wave, jump, and flex poses', () => {
  const waveA = computeVictoryRig('wave', 0.1, 1, true);
  const waveB = computeVictoryRig('wave', 0.35, 1, true);
  assert.ok(waveA.rightHand.y < waveA.shoulderY, 'Waving hand should be raised above shoulder');
  assert.notEqual(
    Math.round(waveA.rightHand.x),
    Math.round(waveB.rightHand.x),
    'Waving hand should oscillate across time'
  );

  const jumpAir = computeVictoryRig('jump', 0.4, 1, false);
  assert.ok(jumpAir.leftHand.y < jumpAir.shoulderY && jumpAir.rightHand.y < jumpAir.shoulderY);
  assert.ok(jumpAir.leftFoot.y < 0 && jumpAir.rightFoot.y < 0, 'Airborne jump tucks legs up');

  const flexA = computeVictoryRig('flex', 0.15, 1, true);
  assert.ok(flexA.leftHand.y < flexA.shoulderY && flexA.rightHand.y < flexA.shoulderY);
  assert.ok(flexA.leftFoot.x < -8 && flexA.rightFoot.x > 8, 'Flex pose uses wide power stance');
});

test('ParticleSystem.emitVictoryCelebration spawns floating confetti and streamer particles', () => {
  const ps = new ParticleSystem(120, 32);
  ps.emitVictoryCelebration(500, 320, '#F59E0B', 1, () => 0.5);

  const active = ps.particles.filter((p) => p.active);
  const confetti = active.filter((p) => p.category === 'confetti' && p.shape === 'confetti');
  const streamers = active.filter((p) => p.category === 'streamer' && p.shape === 'streamer');

  assert.ok(confetti.length >= 20, 'Should spawn colored confetti pieces');
  assert.ok(streamers.length >= 6, 'Should spawn celebratory streamers');

  // Verify flutter drag caps terminal fall speed gracefully
  for (let i = 0; i < 40; i++) {
    ps.update(0.03, []);
  }
  const surviving = ps.particles.filter((p) => p.active && p.category === 'confetti');
  assert.ok(surviving.length > 0, 'Confetti should stay alive while fluttering');
  for (const pt of surviving) {
    assert.ok(pt.vy <= 150, `Expected confetti fall speed <= 150, got ${pt.vy}`);
  }

  ps.clearAll();
  assert.equal(ps.particles.some((p) => p.active), false);
});

test('computeRagdollFlailRig whips limbs proportionally to ragdoll speed and time', () => {
  const slowA = computeRagdollFlailRig(0.4, 80, 0.1);
  const fastA = computeRagdollFlailRig(0.4, 650, 0.1);
  const fastB = computeRagdollFlailRig(1.8, 650, 0.25);

  const slowSpan = Math.hypot(slowA.leftHand.x - slowA.rightHand.x, slowA.leftHand.y - slowA.rightHand.y);
  const fastSpan = Math.hypot(fastA.leftHand.x - fastA.rightHand.x, fastA.leftHand.y - fastA.rightHand.y);
  assert.ok(fastSpan > 30);
  assert.notEqual(Math.round(fastA.leftFoot.y * 10), Math.round(fastB.leftFoot.y * 10));
  assert.ok(slowSpan > 20);
});

test('computeImpactStarMetrics expands starburst sharply at start and clamps progress', () => {
  const start = computeImpactStarMetrics(1, 40);
  const mid = computeImpactStarMetrics(0.5, 40);
  const end = computeImpactStarMetrics(0, 40);
  assert.ok(end.outerRadius > mid.outerRadius);
  assert.ok(mid.outerRadius > start.outerRadius);
  assert.ok(Math.abs(end.innerRadius - end.outerRadius * 0.36) < 0.001);
  assert.deepEqual(computeImpactStarMetrics(1.5, 40), start);
  assert.deepEqual(computeImpactStarMetrics(-0.5, 40), end);
});

test('ParticleSystem emits layered explosions, directional muzzle flashes, and aerial firework bursts', () => {
  const ps = new ParticleSystem(260, 40);
  ps.emitExplosion(400, 300, 120, '#FB923C', () => 0.5);

  const activeExp = ps.particles.filter((p) => p.active);
  assert.ok(activeExp.some((p) => p.category === 'ring'), 'Explosion should emit shockwave rings');
  assert.ok(activeExp.some((p) => p.category === 'fireball'), 'Explosion should emit fireball puffs');
  assert.ok(activeExp.some((p) => p.category === 'smoke'), 'Explosion should emit smoke plumes');
  assert.ok(activeExp.some((p) => p.category === 'debris'), 'Explosion should emit shrapnel');
  assert.ok(activeExp.some((p) => p.shape === 'star'), 'Explosion should emit star sparks');

  ps.clearAll();
  ps.emitMuzzleFlash(200, 200, 0, '#FBBF24', 1.4, () => 0.5);
  const muzzle = ps.particles.filter((p) => p.active);
  assert.ok(muzzle.some((p) => p.category === 'spark' && p.vx > 0));
  assert.ok(muzzle.some((p) => p.category === 'smoke'));

  ps.clearAll();
  ps.emitFireworkBurst(500, 180, '#F59E0B', 1, () => 0.5);
  const fw = ps.particles.filter((p) => p.active);
  assert.ok(fw.filter((p) => p.category === 'firework' && p.shape === 'star').length >= 16);
  assert.ok(fw.some((p) => p.category === 'ring'));
});

test('computeVictoryShakeResponse scales shake intensity and impulses from winner movement', () => {
  // Jump pose: launch, slow mid-air, fast airborne, heavy landing stomp
  const launch = computeVictoryShakeResponse('jump', 0, 0.02, 40, -510, false, false, true, 0, 1);
  assert.ok(launch.impulseTrauma >= 0.25);
  assert.ok(launch.kickY < 0, 'Jump launch kicks camera upward');

  const apex = computeVictoryShakeResponse('jump', 0.2, 0.22, 10, -20, false, false, false, 0, 1);
  const fastFall = computeVictoryShakeResponse('jump', 0.4, 0.42, 40, 480, false, false, false, 0, 1);
  assert.ok(fastFall.intensity > apex.intensity, 'Higher fall velocity yields stronger continuous shake');
  assert.ok(fastFall.minTrauma > apex.minTrauma);

  const stomp = computeVictoryShakeResponse('jump', 0.5, 0.52, 20, 0, true, true, false, 520, 1);
  assert.ok(stomp.impulseTrauma >= 0.55, 'Heavy landing fires strong shake spike');
  assert.ok(stomp.kickY > 8, 'Landing slams camera downward');

  // Flex pose: fires trauma spike when hitting flex peak (~sin(7.5*t) crossing 0.85)
  const flexPeak = computeVictoryShakeResponse('flex', 0.12, 0.16, 0, 0, true, false, false, 0, 1);
  assert.ok(flexPeak.impulseTrauma > 0.25);
  assert.ok(flexPeak.intensity >= 0.8);

  // Wave pose: foot-tap half-cycle crossing (t * 5.2 crossing pi) triggers rhythmic shake
  const waveTap = computeVictoryShakeResponse('wave', 0.59, 0.62, 0, 0, true, false, false, 0, -1);
  assert.ok(waveTap.impulseTrauma > 0.2);
  assert.ok(waveTap.kickX < 0);
});

test('computeVictoryLimbEmitters maps hands & feet into world coordinates with outward radial angles', () => {
  const emitters = computeVictoryLimbEmitters(600, 500, 'flex', 0.2, 1, true, 1, 1);
  assert.equal(emitters.length, 4);

  // Left hand has x < 600 and aims leftwards; right hand has x > 600 and aims rightwards
  const [leftHand, rightHand, leftFoot, rightFoot] = emitters;
  assert.ok(leftHand.x < 600 && rightHand.x > 600);
  assert.ok(Math.cos(leftHand.outAngle) < 0, 'Left hand emitter shoots outward left');
  assert.ok(Math.cos(rightHand.outAngle) > 0, 'Right hand emitter shoots outward right');
  assert.equal(Math.round(leftFoot.y), 500);
  assert.equal(Math.round(rightFoot.y), 500);
});

test('ParticleSystem emits high-velocity limb confetti and slow-falling oversized ribbon streamers', () => {
  const ps = new ParticleSystem(180, 16);
  const emitters = computeVictoryLimbEmitters(400, 320, 'wave', 0.15, 1, true);
  ps.emitLimbExplosiveConfetti(emitters, '#F59E0B', 6, () => 0.5);

  const limbConfetti = ps.particles.filter((p) => p.active && p.category === 'confetti');
  assert.equal(limbConfetti.length, 24);
  for (const pt of limbConfetti) {
    assert.ok(Math.hypot(pt.vx, pt.vy) >= 400, 'Limb confetti should launch at high explosive velocity');
  }

  ps.clearAll();
  ps.emitOversizedRibbons(400, 280, '#38BDF8', 8, () => 0.5);
  const ribbons = ps.particles.filter((p) => p.active && p.category === 'ribbon' && p.shape === 'ribbon');
  assert.equal(ribbons.length, 8);
  assert.ok(ribbons.every((r) => r.size >= 38), 'Oversized ribbons should be significantly larger than standard streamers');

  // Advance simulation so ribbons settle to their slow terminal descent velocity
  for (let i = 0; i < 60; i++) {
    ps.update(0.03, []);
  }
  const activeRibbons = ps.particles.filter((p) => p.active && p.category === 'ribbon');
  assert.ok(activeRibbons.length === 8, 'Slow-falling ribbons should stay aloft for >1.8s');
  for (const r of activeRibbons) {
    assert.ok(r.vy <= 70, `Expected slow-falling ribbon terminal speed <= 70, got ${r.vy}`);
  }
});

test('computeVictoryBloomMetrics peaks on victory burst, scales with intensity, and damps in gameover', () => {
  const peak = computeVictoryBloomMetrics(0.02, 0.9, false);
  const calm = computeVictoryBloomMetrics(1.2, 0.15, false);
  const hyped = computeVictoryBloomMetrics(1.2, 0.95, false);
  const modalState = computeVictoryBloomMetrics(1.2, 0.95, true);

  assert.ok(peak.burstFactor > 0.9, 'Initial victory frame should trigger full bloom burst');
  assert.ok(peak.bloomRadius > calm.bloomRadius);
  assert.ok(peak.anamorphicWidth > calm.anamorphicWidth);
  assert.ok(hyped.bloomAlpha > calm.bloomAlpha, 'Higher celebration intensity strengthens bloom');
  assert.ok(hyped.starFlareScale > calm.starFlareScale);
  assert.ok(hyped.rayRotation > peak.rayRotation, 'Light rays rotate steadily over time');
  assert.ok(modalState.bloomAlpha < hyped.bloomAlpha, 'Gameover phase gently dims bloom behind result modal');
  assert.ok(modalState.anamorphicAlpha < hyped.anamorphicAlpha);
  assert.equal(peak.rayCount, 8);
});

test('computeKillCamState slows time and zooms toward winner over the final 2 seconds', () => {
  const start = computeKillCamState(0, 2.0);
  const mid = computeKillCamState(1.0, 2.0);
  const late = computeKillCamState(1.85, 2.0);
  const end = computeKillCamState(2.2, 2.0);

  assert.equal(start.progress, 0);
  assert.ok(start.timeScale <= 0.2, 'Kill-cam starts with dramatic slow motion');
  assert.ok(mid.timeScale <= 0.25, 'Slow motion holds through mid kill-cam');
  assert.ok(mid.targetZoom > start.targetZoom && mid.targetZoom >= 1.5, 'Camera zooms tightly onto winner');
  assert.ok(mid.vignetteAlpha > 0.4, 'Cinematic vignette frames slow-motion shot');
  assert.ok(late.timeScale > mid.timeScale, 'Time scale eases back up near handoff');
  assert.equal(end.progress, 1);
  assert.equal(end.vignetteAlpha, 0);
});

test('computeCameraShakeImpulse scales intensity across explosions, destruction, and collisions', () => {
  const smallCrate = computeCameraShakeImpulse('destruction', 0.78, 0, 1);
  const bridgeCollapse = computeCameraShakeImpulse('destruction', 1.45, 0, 1);
  const rocketBoom = computeCameraShakeImpulse('explosion', 1.25, 1, -0.5);
  const heavyCollision = computeCameraShakeImpulse('collision', 0.65, -1, 0);

  assert.ok(bridgeCollapse.traumaAdd > smallCrate.traumaAdd, 'Large bridge collapse shakes harder than single crate');
  assert.ok(bridgeCollapse.kickY > 0, 'Destruction pulls camera downward on structural collapse');
  assert.ok(rocketBoom.traumaAdd >= 0.7, 'Explosions trigger strong screen-wide trauma');
  assert.ok(rocketBoom.kickX > 0 && rocketBoom.angleKick !== 0, 'Explosions apply directional kick and roll');
  assert.ok(heavyCollision.kickX < 0, 'Collision kick reflects negative attack direction');
});

test('ARENAS provides 20 distinct arenas with valid non-overlapping spawns and supported drop lanes', () => {
  assert.equal(ARENAS.length, 20);
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const arena of ARENAS) {
    assert.ok(!ids.has(arena.id), `Duplicate arena id: ${arena.id}`);
    assert.ok(!names.has(arena.name), `Duplicate arena name: ${arena.name}`);
    ids.add(arena.id);
    names.add(arena.name);

    assert.ok(arena.spawns.length >= 4, `${arena.name} must have >= 4 spawns`);
    assert.ok(arena.weaponDrops.length >= 3, `${arena.name} must have >= 3 drop points`);

    for (const sp of arena.spawns) {
      assert.ok(sp.x >= 80 && sp.x <= arena.width - 80, `${arena.name} spawn x out of bounds: ${sp.x}`);
      const fx = sp.x - 12;
      const fy = sp.y - 54;
      for (const plat of arena.platforms) {
        assert.ok(
          !intersectsPlatform(fx, fy, 24, 54, plat),
          `${arena.name} spawn (${sp.x},${sp.y}) overlaps platform ${plat.id}`
        );
      }
      const hasGroundBelow = arena.platforms.some(
        (p) => sp.x >= p.x && sp.x <= p.x + p.w && p.y >= sp.y && p.y <= sp.y + 95
      );
      assert.ok(hasGroundBelow, `${arena.name} spawn (${sp.x},${sp.y}) lacks supporting platform below`);
    }

    for (const drop of arena.weaponDrops) {
      const hasCatcher = arena.platforms.some(
        (p) => drop.x >= p.x && drop.x <= p.x + p.w && p.y > drop.y
      );
      assert.ok(hasCatcher, `${arena.name} weaponDrop (${drop.x},${drop.y}) has no platform underneath`);
    }
  }
});

test('pickRandomArenaDrop and stepArenaItemPhysics support guns, swords, explosive crates, bounce, ice, and collapsing floors', () => {
  const crateDrop = pickRandomArenaDrop(() => 0.1, true);
  assert.equal(crateDrop.kind, 'explosive_crate');

  const katanaIdx = DROP_POOL.indexOf('katana');
  assert.ok(katanaIdx >= 0);
  let katanaRoll = 0;
  const swordDrop = pickRandomArenaDrop(
    () => (katanaRoll++ === 0 ? 0.9 : (katanaIdx + 0.1) / DROP_POOL.length),
    true
  );
  assert.equal(swordDrop.kind, 'weapon');
  assert.equal(swordDrop.weaponId, 'katana');

  for (const id of ['minigun', 'snake_gun', 'blackhole_gun', 'lightsaber', 'spear'] as const) {
    assert.ok(DROP_POOL.includes(id), `DROP_POOL should include ${id}`);
    assert.ok(WEAPONS[id].ammo > 0);
  }
  assert.ok(WEAPONS.minigun.recoil >= 80 && WEAPONS.minigun.cooldown < 0.06);
  assert.equal(WEAPONS.lightsaber.isMelee, true);

  const gunDrop = pickRandomArenaDrop(() => 0.05, false);
  assert.equal(gunDrop.kind, 'weapon');

  const floor: Platform = { id: 'p_floor', x: 200, y: 500, w: 400, h: 24, kind: 'destructible', hp: 30, maxHp: 30 };
  const pad: Platform = { id: 'p_pad', x: 700, y: 500, w: 100, h: 18, kind: 'bounce', bounceForce: -900 };

  const crateItem: WeaponPickup = {
    id: 1,
    kind: 'explosive_crate',
    weaponId: 'rocket',
    x: 320,
    y: 440,
    vx: 60,
    vy: 280,
    angle: 0,
    angVel: 0,
    radius: 15,
    hp: 24,
    maxHp: 24,
    fuseTimer: 0.4,
    grounded: false,
    onIce: false,
    bobPhase: 0,
    parachuteOpen: false,
    life: 16,
  };

  // High-speed impact bounces off destructible floor
  const hit = stepArenaItemPhysics(crateItem, [floor, pad], 1280, 0.25);
  assert.equal(hit.bounced, true);
  assert.ok(crateItem.vy < 0, 'Crate bounces upward after high-speed landing');
  assert.ok(crateItem.fuseTimer < 0.4, 'Fuse timer ticks down during physics step');

  // Once settled, destroying the floor underneath drops the item back into gravity
  crateItem.y = 500 - crateItem.radius;
  crateItem.vy = 0;
  crateItem.grounded = true;
  floor.hp = 0;
  stepArenaItemPhysics(crateItem, [floor, pad], 1280, 0.05);
  assert.equal(crateItem.grounded, false, 'Item falls when destructible bridge breaks');

  // Landing on a bounce pad launches item skyward
  const padItem: WeaponPickup = {
    ...crateItem,
    id: 2,
    kind: 'weapon',
    weaponId: 'katana',
    x: 750,
    y: 478,
    vy: 180,
    grounded: false,
  };
  const padStep = stepArenaItemPhysics(padItem, [floor, pad], 1280, 0.05);
  assert.equal(padStep.hitBouncePad, true);
  assert.ok(padItem.vy < -500, 'Bounce pad launches weapon drop upward');
});

test('dynamic weather cycles periodically and applies wind, localized snow, and roof-aware acid rain physics', () => {
  const w = createWeatherState('snowstorm', 1, 1280);
  w.zoneCenterX = 400;
  w.zoneHalfWidth = 220;
  w.intensity = 1;

  const roofPlat: Platform = { id: 'roof', x: 300, y: 200, w: 200, h: 20, kind: 'solid' };

  // Inside snowstorm zone gets wind & chill drag; outside zone is calm
  const inSnow = computeWeatherPhysicsInfluence(w, 400, 450, true, [roofPlat]);
  const outSnow = computeWeatherPhysicsInfluence(w, 1050, 450, true, [roofPlat]);
  assert.equal(inSnow.inZone, true);
  assert.equal(inSnow.coldSlippery, true);
  assert.ok(inSnow.windAccelX > 0);
  assert.equal(outSnow.inZone, false);
  assert.equal(outSnow.windAccelX, 0);

  // Acid rain exposes players in open sky, but shields players under a roof platform
  w.kind = 'acid_rain';
  const underRoof = computeWeatherPhysicsInfluence(w, 400, 450, true, [roofPlat]);
  const openSky = computeWeatherPhysicsInfluence(w, 560, 450, true, [roofPlat]);
  assert.equal(underRoof.exposedToAcid, false);
  assert.equal(openSky.exposedToAcid, true);

  // Gale wind pushes airborne fighters harder than grounded fighters
  w.kind = 'gale_wind';
  w.windDir = -1;
  const airGale = computeWeatherPhysicsInfluence(w, 640, 300, false, []);
  const groundGale = computeWeatherPhysicsInfluence(w, 640, 500, true, []);
  assert.ok(airGale.windAccelX < groundGale.windAccelX && groundGale.windAccelX < 0);

  // Stepping past duration transitions to another weather kind
  w.timer = 0.05;
  const stepped = stepWeatherState(w, 1280, 0.1, () => 0.5);
  assert.equal(stepped.changed, true);
  assert.notEqual(w.kind, 'gale_wind');
});

test('black hole gravity pulls inward with swirl and snakes steer & lunge toward opponents', () => {
  const outer = computeBlackHolePull(640, 360, 780, 360, 260, 42, 1600);
  assert.ok(outer.ax < 0, 'Black hole pulls right-side entity leftward toward center');
  assert.ok(Math.abs(outer.ay) > 10, 'Black hole adds tangential swirl acceleration');
  assert.equal(outer.inCore, false);

  const core = computeBlackHolePull(640, 360, 655, 360, 260, 42, 1600);
  assert.equal(core.inCore, true);

  const steer = computeSnakeSteering(300, 500, 120, 40, 520, 380, 0.05);
  assert.ok(steer.vx > 120, 'Snake accelerates horizontally toward opponent on the right');
  assert.ok(steer.vy < 0, 'Snake lunges upward toward elevated opponent');
});


