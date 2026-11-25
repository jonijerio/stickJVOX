import {
  computeImpactStarMetrics,
  computeRagdollFlailRig,
  computeVictoryBloomMetrics,
  computeVictoryRig,
  getLaserPhase,
  getPendulumPosition,
} from './rules';
import {
  AfterimageGhost,
  ArenaDefinition,
  BeamEffect,
  BlackHoleVortex,
  Fighter,
  FloatingCallout,
  ImpactFlashEffect,
  Particle,
  Projectile,
  ScreenFlashState,
  SlashArcEffect,
  StuckSpear,
  SurfaceDecal,
  WeaponId,
  WeaponPickup,
  WeatherState,
} from './types';
import { WEAPONS } from './weapons';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  trauma: number;
  kickX: number;
  kickY: number;
  shakeAngle: number;
}

let cachedBgKey = '';
let cachedBgCanvas: HTMLCanvasElement | null = null;

function getOrBuildBackground(
  viewW: number,
  viewH: number,
  arena: ArenaDefinition
): HTMLCanvasElement {
  const key = `${arena.id}:${viewW}:${viewH}`;
  if (cachedBgKey === key && cachedBgCanvas) {
    return cachedBgCanvas;
  }

  const off = cachedBgCanvas ?? document.createElement('canvas');
  off.width = Math.max(1, Math.round(viewW));
  off.height = Math.max(1, Math.round(viewH));
  const bctx = off.getContext('2d');
  if (bctx) {
    const g = bctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, arena.skyTop);
    g.addColorStop(1, arena.skyBottom);
    bctx.fillStyle = g;
    bctx.fillRect(0, 0, viewW, viewH);

    // Subtle architectural trusses
    bctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    bctx.lineWidth = 2;
    const spacing = 180;
    bctx.beginPath();
    for (let x = 60; x < viewW; x += spacing) {
      bctx.moveTo(x, 0);
      bctx.lineTo(x, viewH);
      bctx.moveTo(x + 28, 0);
      bctx.lineTo(x + 28, viewH);
    }
    bctx.stroke();

    // Horizon ambient spotlight glow
    const glow = bctx.createRadialGradient(
      viewW * 0.5,
      viewH * 0.45,
      40,
      viewW * 0.5,
      viewH * 0.45,
      viewW * 0.55
    );
    glow.addColorStop(0, `${arena.accentColor}16`);
    glow.addColorStop(1, 'transparent');
    bctx.fillStyle = glow;
    bctx.fillRect(0, 0, viewW, viewH);
  }

  cachedBgCanvas = off;
  cachedBgKey = key;
  return off;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  arena: ArenaDefinition,
  fighters: Fighter[],
  projectiles: Projectile[],
  pickups: WeaponPickup[],
  beams: BeamEffect[],
  slashes: SlashArcEffect[],
  particles: Particle[],
  decals: SurfaceDecal[],
  impactFlashes: ImpactFlashEffect[],
  callouts: FloatingCallout[],
  afterimages: AfterimageGhost[],
  screenFlash: ScreenFlashState,
  camera: CameraState,
  elapsedTime: number,
  victoryBloomIntensity = 0,
  isGameover = false,
  killCamVignette = 0,
  weather: WeatherState | null = null,
  blackHoles: BlackHoleVortex[] = [],
  stuckSpears: StuckSpear[] = []
): void {
  ctx.save();

  // 1. Atmospheric Arena Sky Backdrop (pre-rendered offscreen canvas)
  const bg = getOrBuildBackground(viewW, viewH, arena);
  ctx.drawImage(bg, 0, 0, viewW, viewH);

  // 1b. Dynamic Weather Sky Haze & Background Gusts
  if (weather && weather.kind !== 'clear' && weather.intensity > 0.01) {
    drawWeatherBackdrop(ctx, viewW, viewH, weather, elapsedTime);
  }

  // 2. Camera Transform (with multi-frequency trauma^2 vibration, rotational roll & directional kick)
  const shakePower = camera.trauma * camera.trauma;
  const vibX =
    (Math.sin(elapsedTime * 58) * 0.45 + (Math.random() * 2 - 1) * 0.55) * 24 * shakePower;
  const vibY =
    (Math.cos(elapsedTime * 73) * 0.45 + (Math.random() * 2 - 1) * 0.55) * 20 * shakePower;
  const shakeX = vibX + camera.kickX;
  const shakeY = vibY + camera.kickY;
  const shakeRot = camera.shakeAngle + (Math.random() * 2 - 1) * 0.015 * shakePower;

  const baseScale = Math.min(viewW / arena.width, viewH / arena.height);
  const scale = baseScale * camera.zoom;

  ctx.translate(viewW * 0.5 + shakeX, viewH * 0.5 + shakeY);
  if (Math.abs(shakeRot) > 0.0002) {
    ctx.rotate(shakeRot);
  }
  ctx.scale(scale, scale);
  ctx.translate(-camera.x, -camera.y);

  // 3. Lava floor glow & bubbling magma if arena has lavaY
  if (arena.lavaY !== null) {
    drawLavaHazard(ctx, arena, elapsedTime);
  }

  // 4. Platforms & destructible crates + persistent splatter decals
  for (const plat of arena.platforms) {
    if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
    drawPlatform(ctx, plat, elapsedTime);
  }
  drawSurfaceDecals(ctx, arena.platforms, decals);

  // 4b. Wall/Platform-Stuck Spears & Blades
  for (const sp of stuckSpears) {
    drawStuckSpear(ctx, sp, elapsedTime);
  }

  // 5. Laser Grid Hazards (Idle emitters -> Telegraph line -> Active beam)
  for (const laser of arena.lasers) {
    drawLaserHazard(ctx, laser, elapsedTime);
  }

  // 6. Pendulum Wrecking Ball Hazards
  for (const pend of arena.pendulums) {
    drawPendulumHazard(ctx, pend, elapsedTime);
  }

  // 6b. Active Black Hole Gravity Vortices
  for (const bh of blackHoles) {
    drawBlackHoleVortex(ctx, bh, elapsedTime);
  }

  // 7. Weapon Pickups (with parachutes & soft halo)
  for (const pk of pickups) {
    drawWeaponPickup(ctx, pk, elapsedTime);
  }

  // 8. Speed / Dash Afterimages + Victory Radial Bloom + Fighters
  const celebratingWinner = fighters.find((f) => f.alive && f.victoryPose !== null);
  const victoryBloom = celebratingWinner
    ? computeVictoryBloomMetrics(celebratingWinner.victoryTimer, victoryBloomIntensity, isGameover)
    : null;
  if (celebratingWinner && victoryBloom) {
    drawVictoryRadialBloom(ctx, celebratingWinner, victoryBloom);
  }
  drawAfterimages(ctx, afterimages);
  for (const f of fighters) {
    drawStickFighter(ctx, f, elapsedTime);
  }

  // 9. Slash Arcs & Rail Laser Beams
  for (const s of slashes) {
    drawSlashArc(ctx, s);
  }
  for (const b of beams) {
    drawBeam(ctx, b, elapsedTime);
  }

  // 10. Projectiles & Thrown Weapons
  for (const p of projectiles) {
    if (!p.active) continue;
    drawProjectile(ctx, p, elapsedTime);
  }

  // 11. Pooled Particle Ring Buffer + Comic Starbursts + Victory Light Flare + Floating Callouts
  drawParticles(ctx, particles);
  drawImpactFlashes(ctx, impactFlashes);
  if (celebratingWinner && victoryBloom) {
    drawVictoryLightFlare(ctx, celebratingWinner, victoryBloom);
  }
  drawCallouts(ctx, callouts);

  // 11b. World-Space Dynamic Weather Foreground (localized snowstorm flakes, roof-aware acid rain, gale wind streaks)
  if (weather && weather.kind !== 'clear' && weather.intensity > 0.01) {
    drawWeatherWorldLayer(ctx, arena, weather, elapsedTime);
  }

  ctx.restore();

  // 12. Slow-Motion Kill-Cam Radial Vignette & Cinematic Letterbox Bars
  if (killCamVignette > 0.005) {
    ctx.save();
    const vg = ctx.createRadialGradient(
      viewW * 0.5,
      viewH * 0.5,
      Math.min(viewW, viewH) * 0.24,
      viewW * 0.5,
      viewH * 0.5,
      Math.max(viewW, viewH) * 0.68
    );
    vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vg.addColorStop(1, `rgba(4, 7, 15, ${Math.min(0.75, killCamVignette * 1.15)})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, viewW, viewH);

    const barH = Math.round(viewH * 0.052 * Math.min(1, killCamVignette * 1.85));
    if (barH > 0) {
      ctx.fillStyle = 'rgba(4, 7, 15, 0.9)';
      ctx.fillRect(0, 0, viewW, barH);
      ctx.fillRect(0, viewH - barH, viewW, barH);
    }
    ctx.restore();
  }

  // 13. Brief Impact / Explosion Screen Flash Overlay
  if (screenFlash.alpha > 0.005) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.32, screenFlash.alpha);
    ctx.fillStyle = screenFlash.color;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.restore();
  }
}

function drawSurfaceDecals(
  ctx: CanvasRenderingContext2D,
  platforms: ArenaDefinition['platforms'],
  decals: SurfaceDecal[]
): void {
  let hasActive = false;
  for (let i = 0; i < decals.length; i++) {
    if (decals[i].active) {
      hasActive = true;
      break;
    }
  }
  if (!hasActive) return;

  const platMap = new Map<string, ArenaDefinition['platforms'][number]>();
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (p.kind === 'destructible' && (p.hp ?? 1) <= 0) continue;
    platMap.set(p.id, p);
  }

  ctx.save();
  for (let i = 0; i < decals.length; i++) {
    const d = decals[i];
    if (!d.active) continue;
    const plat = platMap.get(d.platformId);
    if (!plat) continue;

    ctx.globalAlpha = d.alpha;
    ctx.fillStyle = d.color;
    ctx.beginPath();

    if (d.edge === 'top') {
      const cx = Math.max(plat.x + 3, Math.min(plat.x + plat.w - 3, plat.x + d.offsetX));
      ctx.ellipse(cx, plat.y + 1.5, d.rx, d.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // Small lip drip over top edge
      ctx.beginPath();
      ctx.ellipse(cx + d.rx * 0.25, plat.y + d.ry * 1.1, Math.max(1.8, d.rx * 0.22), d.ry * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.edge === 'left') {
      const cy = Math.max(plat.y + 3, Math.min(plat.y + plat.h - 3, plat.y + d.offsetY));
      ctx.ellipse(plat.x + 1.5, cy, d.rx, d.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const cy = Math.max(plat.y + 3, Math.min(plat.y + plat.h - 3, plat.y + d.offsetY));
      ctx.ellipse(plat.x + plat.w - 1.5, cy, d.rx, d.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawLavaHazard(
  ctx: CanvasRenderingContext2D,
  arena: ArenaDefinition,
  elapsedTime: number
): void {
  if (arena.lavaY === null) return;
  const y = arena.lavaY;
  const grad = ctx.createLinearGradient(0, y - 70, 0, y + 180);
  grad.addColorStop(0, 'rgba(239, 68, 68, 0)');
  grad.addColorStop(0.32, 'rgba(239, 68, 68, 0.25)');
  grad.addColorStop(0.38, '#EA580C');
  grad.addColorStop(0.6, '#DC2626');
  grad.addColorStop(1, '#7F1D1D');
  ctx.fillStyle = grad;
  ctx.fillRect(-300, y - 70, arena.width + 600, 320);

  // Rippling magma crust line
  ctx.beginPath();
  ctx.moveTo(-300, y);
  for (let x = -300; x <= arena.width + 300; x += 28) {
    const wave = Math.sin(x * 0.025 + elapsedTime * 3.4) * 4;
    ctx.lineTo(x, y + wave);
  }
  ctx.strokeStyle = '#FDBA74';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawPlatform(
  ctx: CanvasRenderingContext2D,
  plat: ArenaDefinition['platforms'][number],
  elapsedTime: number
): void {
  ctx.save();
  if (plat.kind === 'destructible') {
    const ratio = Math.max(0, (plat.hp ?? 1) / (plat.maxHp ?? 1));
    ctx.fillStyle = '#78350F';
    ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 2;
    ctx.strokeRect(plat.x + 1, plat.y + 1, plat.w - 2, plat.h - 2);

    // Cross brace planks
    ctx.beginPath();
    ctx.moveTo(plat.x + 4, plat.y + 4);
    ctx.lineTo(plat.x + plat.w - 4, plat.y + plat.h - 4);
    ctx.moveTo(plat.x + plat.w - 4, plat.y + 4);
    ctx.lineTo(plat.x + 4, plat.y + plat.h - 4);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.32)';
    ctx.stroke();

    // Damage cracks when injured
    if (ratio < 0.75) {
      ctx.strokeStyle = '#1C1917';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(plat.x + plat.w * 0.3, plat.y);
      ctx.lineTo(plat.x + plat.w * 0.45, plat.y + plat.h * 0.55);
      ctx.lineTo(plat.x + plat.w * 0.65, plat.y + plat.h);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (plat.kind === 'bounce') {
    const pulse = Math.sin(elapsedTime * 6) * 1.5;
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(plat.x, plat.y + 6, plat.w, plat.h - 6);
    ctx.fillStyle = '#10B981';
    ctx.fillRect(plat.x + 2, plat.y + pulse, plat.w - 4, 8);
    ctx.fillStyle = '#A7F3D0';
    ctx.fillRect(plat.x + 10, plat.y + pulse + 1, plat.w - 20, 3);
    ctx.restore();
    return;
  }

  if (plat.kind === 'ice') {
    ctx.fillStyle = '#1E3A5F';
    ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
    ctx.fillStyle = '#7DD3FC';
    ctx.fillRect(plat.x, plat.y, plat.w, 6);
    ctx.fillStyle = 'rgba(224, 242, 254, 0.55)';
    ctx.fillRect(plat.x + 12, plat.y + 2, plat.w * 0.35, 2);
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);
    ctx.restore();
    return;
  }

  if (plat.kind === 'oneway') {
    ctx.fillStyle = '#334155';
    ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
    ctx.fillStyle = '#94A3B8';
    ctx.fillRect(plat.x, plat.y, plat.w, 4);
    ctx.restore();
    return;
  }

  // Solid steel platform
  ctx.fillStyle = '#1E2534';
  ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
  ctx.fillStyle = '#475569';
  ctx.fillRect(plat.x, plat.y, plat.w, 5);
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2;
  ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);

  // Subtle rivets
  ctx.fillStyle = '#64748B';
  for (let rx = plat.x + 14; rx < plat.x + plat.w - 10; rx += 34) {
    ctx.fillRect(rx, plat.y + 10, 3, 3);
  }
  ctx.restore();
}

function drawLaserHazard(
  ctx: CanvasRenderingContext2D,
  laser: ArenaDefinition['lasers'][number],
  elapsedTime: number
): void {
  const phase = getLaserPhase(laser, elapsedTime);
  ctx.save();

  // Emitters
  ctx.fillStyle = '#475569';
  ctx.beginPath();
  ctx.arc(laser.x1, laser.y1, 7, 0, Math.PI * 2);
  ctx.arc(laser.x2, laser.y2, 7, 0, Math.PI * 2);
  ctx.fill();

  if (phase === 'telegraph') {
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(laser.x1, laser.y1);
    ctx.lineTo(laser.x2, laser.y2);
    ctx.stroke();
  } else if (phase === 'active') {
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.35)';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(laser.x1, laser.y1);
    ctx.lineTo(laser.x2, laser.y2);
    ctx.stroke();

    ctx.strokeStyle = '#FDA4AF';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(laser.x1, laser.y1);
    ctx.lineTo(laser.x2, laser.y2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPendulumHazard(
  ctx: CanvasRenderingContext2D,
  pend: ArenaDefinition['pendulums'][number],
  elapsedTime: number
): void {
  const pos = getPendulumPosition(pend, elapsedTime);
  ctx.save();
  // Chain
  ctx.strokeStyle = '#64748B';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(pend.anchorX, pend.anchorY);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();

  // Anchor
  ctx.fillStyle = '#94A3B8';
  ctx.beginPath();
  ctx.arc(pend.anchorX, pend.anchorY, 8, 0, Math.PI * 2);
  ctx.fill();

  // Spiked wrecking ball
  ctx.fillStyle = '#1E293B';
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, pend.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#EF4444';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#EF4444';
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWeaponPickup(
  ctx: CanvasRenderingContext2D,
  pk: WeaponPickup,
  elapsedTime: number
): void {
  const isCrate = pk.kind === 'explosive_crate';
  const spec = WEAPONS[pk.weaponId];
  const bob = pk.grounded ? Math.sin(elapsedTime * 4 + pk.bobPhase) * 3.5 : 0;
  const cx = pk.x;
  const cy = pk.y + bob;
  const expiryBlink = pk.life < 3 ? 0.45 + 0.55 * Math.abs(Math.sin(elapsedTime * 12)) : 1;

  ctx.save();
  ctx.globalAlpha = expiryBlink;

  // Parachute if descending under canopy
  if (pk.parachuteOpen && !pk.grounded) {
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy - 24);
    ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx + 16, cy - 24);
    ctx.lineTo(cx, cy - 5);
    ctx.stroke();

    ctx.fillStyle = isCrate ? '#FCA5A5' : '#E2E8F0';
    ctx.beginPath();
    ctx.arc(cx, cy - 24, 18, Math.PI, 0);
    ctx.fill();
  }

  if (isCrate) {
    const fuseHot = pk.fuseTimer > 0 || pk.hp < pk.maxHp;
    const pulse = fuseHot ? 0.55 + 0.45 * Math.sin(elapsedTime * 26) : 0.22;

    // Volatile warning halo
    ctx.fillStyle = `rgba(239, 68, 68, ${pulse * 0.45})`;
    ctx.beginPath();
    ctx.arc(cx, cy, fuseHot ? 26 : 21, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(pk.angle);

    const s = 14;
    ctx.fillStyle = fuseHot && Math.sin(elapsedTime * 28) > 0 ? '#EF4444' : '#7F1D1D';
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(-s, -s, s * 2, s * 2);

    // Hazard diagonal struts
    ctx.strokeStyle = '#F97316';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-s + 3, -s + 3);
    ctx.lineTo(s - 3, s - 3);
    ctx.moveTo(s - 3, -s + 3);
    ctx.lineTo(-s + 3, s - 3);
    ctx.stroke();

    // Central TNT badge
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-10, -5.5, 20, 11);
    ctx.fillStyle = '#FDE047';
    ctx.font = '800 8px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TNT', 0, 0.5);

    ctx.restore();
    ctx.restore();
    return;
  }

  // Soft aura around weapon drop
  ctx.fillStyle = `${spec.color}28`;
  ctx.beginPath();
  ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  ctx.fill();

  drawWeaponGraphic(ctx, pk.weaponId, cx, cy, 1, pk.angle, spec.color);
  ctx.restore();
}

function drawStickFighter(
  ctx: CanvasRenderingContext2D,
  f: Fighter,
  elapsedTime: number
): void {
  if (!f.alive && f.koTimer <= 0) return;

  const cx = f.x + f.w * 0.5;
  const bottomY = f.y + f.h;
  const color = f.hitFlashTimer > 0 ? '#FFFFFF' : f.palette.primary;

  ctx.save();
  if (!f.alive) {
    ctx.globalAlpha = Math.max(0.25, f.koTimer / 0.9);
  }

  // Ground shadow when near platform
  if (f.alive && f.grounded) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, bottomY, 14 * f.squashX, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pivot from feet (alive) or center (ragdoll KO)
  if (!f.alive) {
    ctx.translate(cx, f.y + f.h * 0.5);
    ctx.rotate(f.ragdollAngle);
    ctx.translate(0, -f.h * 0.5);
  } else {
    ctx.translate(cx, bottomY);
    ctx.scale(f.squashX, f.squashY);
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Body geometry in local feet-origin coords (y goes negative up to -54)
  const rig = !f.alive
    ? computeRagdollFlailRig(f.ragdollAngle, Math.hypot(f.vx, f.vy), elapsedTime)
    : f.victoryPose
      ? computeVictoryRig(f.victoryPose, f.victoryTimer, f.facing, f.grounded)
      : null;

  const speedNorm = Math.min(1, Math.abs(f.vx) / 300);
  const stride = f.grounded ? Math.sin(f.walkCycle) * 12 * speedNorm : 7;
  const liftA = f.grounded ? Math.max(0, -Math.cos(f.walkCycle)) * 6 * speedNorm : 5;
  const liftB = f.grounded ? Math.max(0, Math.cos(f.walkCycle)) * 6 * speedNorm : 2;
  const lean = f.alive ? (f.vx / 420) * 5 : 0;

  const hipY = rig ? rig.hipY : -22;
  const shoulderX = rig ? rig.shoulderX : lean;
  const shoulderY = rig ? rig.shoulderY : -40;
  const headX = rig ? rig.headX : lean * 1.1;
  const headY = rig ? rig.headY : -49;

  const leftKnee = rig ? rig.leftKnee : { x: -stride * 0.6, y: -11 - liftB * 0.5 };
  const leftFoot = rig ? rig.leftFoot : { x: -stride, y: -liftB };
  const rightKnee = rig ? rig.rightKnee : { x: stride * 0.6, y: -11 - liftA * 0.5 };
  const rightFoot = rig ? rig.rightFoot : { x: stride, y: -liftA };

  const drawBodyPass = (strokeColor: string, headFill: string, width: number) => {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = width;

    // Back leg
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(leftKnee.x, leftKnee.y);
    ctx.lineTo(leftFoot.x, leftFoot.y);
    ctx.stroke();

    // Front leg
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(rightKnee.x, rightKnee.y);
    ctx.lineTo(rightFoot.x, rightFoot.y);
    ctx.stroke();

    // Torso
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(shoulderX, shoulderY);
    ctx.stroke();

    // Head
    ctx.fillStyle = headFill;
    ctx.beginPath();
    ctx.arc(headX, headY, width > 7 ? 11.5 : 9.8, 0, Math.PI * 2);
    ctx.fill();
  };

  // Dark silhouette outline pass + colored fighter pass
  drawBodyPass('#090C12', '#090C12', 9.5);
  drawBodyPass(color, color, 6);

  // Player Headband / Scarf tail + Cosmetic Pattern accents
  if (f.hitFlashTimer <= 0) {
    const pattern = f.palette.pattern;
    const midTorsoX = shoulderX * 0.5;
    const midTorsoY = (hipY + shoulderY) * 0.5;

    // Pattern overlays on body/head
    if (pattern === 'stripes') {
      ctx.strokeStyle = f.palette.headband;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(shoulderX * 0.25 - 3.5, hipY - 5);
      ctx.lineTo(shoulderX * 0.25 + 3.5, hipY - 5);
      ctx.moveTo(shoulderX * 0.68 - 3.5, hipY - 12);
      ctx.lineTo(shoulderX * 0.68 + 3.5, hipY - 12);
      // Leg bands
      ctx.moveTo(leftKnee.x - 2.5, leftKnee.y);
      ctx.lineTo(leftKnee.x + 2.5, leftKnee.y);
      ctx.moveTo(rightKnee.x - 2.5, rightKnee.y);
      ctx.lineTo(rightKnee.x + 2.5, rightKnee.y);
      ctx.stroke();
    } else if (pattern === 'core') {
      // Glowing inner core diamond & bright eye center
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(midTorsoX, midTorsoY, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = f.palette.headband;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(midTorsoX, midTorsoY, 5.2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#090C12';
      ctx.beginPath();
      ctx.arc(headX + f.facing * 4, headY - 1, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (pattern === 'viper') {
      // Tactical dark visor + glowing slit + shoulder chevron
      ctx.fillStyle = '#090C12';
      ctx.fillRect(headX + (f.facing > 0 ? -1 : -8), headY - 4, 9, 4.5);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(headX + (f.facing > 0 ? 1 : -6), headY - 2.8, 5.5, 2);

      ctx.strokeStyle = f.palette.dark;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(midTorsoX - 3.5, shoulderY + 6);
      ctx.lineTo(midTorsoX, shoulderY + 10);
      ctx.lineTo(midTorsoX + 3.5, shoulderY + 6);
      ctx.stroke();
    } else if (pattern === 'crown') {
      // Royal gold crown crest above head + collar accent
      const cy = headY - 10;
      ctx.fillStyle = '#FACC15';
      ctx.strokeStyle = '#090C12';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(headX - 6.5, cy);
      ctx.lineTo(headX - 7.5, cy - 8);
      ctx.lineTo(headX - 3, cy - 4);
      ctx.lineTo(headX, cy - 10);
      ctx.lineTo(headX + 3, cy - 4);
      ctx.lineTo(headX + 7.5, cy - 8);
      ctx.lineTo(headX + 6.5, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(shoulderX - 4, shoulderY + 2);
      ctx.lineTo(shoulderX + 4, shoulderY + 2);
      ctx.stroke();
    }

    // Signature headband + flowing scarf tail (skip visor overlap for viper)
    if (pattern !== 'viper') {
      ctx.strokeStyle = f.palette.headband;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(headX - 8, headY - 3);
      ctx.lineTo(headX + 8, headY - 3);
      ctx.stroke();

      const tailWave = Math.sin(elapsedTime * 11 + f.id) * 4;
      ctx.beginPath();
      ctx.moveTo(headX - f.facing * 8, headY - 3);
      ctx.lineTo(headX - f.facing * (18 + speedNorm * 6), headY - 1 + tailWave);
      ctx.stroke();
    }
  }

  // Arms + Weapon / Victory Pose / Flailing Ragdoll
  if (rig) {
    const drawArticulatedArms = (strokeColor: string, width: number) => {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = width;

      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(rig.leftElbow.x, rig.leftElbow.y);
      ctx.lineTo(rig.leftHand.x, rig.leftHand.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(rig.rightElbow.x, rig.rightElbow.y);
      ctx.lineTo(rig.rightHand.x, rig.rightHand.y);
      ctx.stroke();
    };

    drawArticulatedArms('#090C12', 8.5);
    drawArticulatedArms(color, 5.5);

    if (f.alive) {
      // Small celebration fist caps
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(rig.leftHand.x, rig.leftHand.y, 3.2, 0, Math.PI * 2);
      ctx.arc(rig.rightHand.x, rig.rightHand.y, 3.2, 0, Math.PI * 2);
      ctx.fill();

      // Subtle celebration flex aura arcs around flexing biceps
      if (f.victoryPose === 'flex') {
        const pulse = 0.55 + Math.sin(f.victoryTimer * 12) * 0.35;
        ctx.strokeStyle = f.palette.headband;
        ctx.globalAlpha *= pulse;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rig.leftElbow.x - 4, rig.leftElbow.y - 3, 7, Math.PI * 0.7, Math.PI * 1.45);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rig.rightElbow.x + 4, rig.rightElbow.y - 3, 7, -Math.PI * 0.45, Math.PI * 0.3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 5.5;

    if (f.blocking) {
      // Guard stance
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(shoulderX + f.facing * 12, shoulderY + 3);
      ctx.lineTo(shoulderX + f.facing * 10, shoulderY - 9);
      ctx.stroke();

      // Shield arc
      ctx.strokeStyle = f.parryWindowTimer > 0 ? '#FDE047' : '#38BDF8';
      ctx.lineWidth = f.parryWindowTimer > 0 ? 4 : 3;
      ctx.beginPath();
      ctx.arc(
        shoulderX + f.facing * 6,
        shoulderY + 4,
        26,
        f.facing > 0 ? -0.9 : Math.PI - 0.9,
        f.facing > 0 ? 0.9 : Math.PI + 0.9
      );
      ctx.stroke();
    } else if (f.weapon === 'fists') {
      const punching = f.attackActiveTimer > 0 || f.attackPending;
      const punchReach = f.attackActiveTimer > 0 ? 25 : f.attackPending ? -6 : 11;
      const punchY = f.comboStep === 2 ? -6 : 4;

      // Back arm
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(shoulderX - f.facing * 9, shoulderY + 9);
      ctx.stroke();

      // Punching arm
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(shoulderX + f.facing * punchReach, shoulderY + (punching ? punchY : 7));
      ctx.stroke();
    } else {
      const aim = f.aimAngle;
      const handX = shoulderX + Math.cos(aim) * 16;
      const handY = shoulderY + Math.sin(aim) * 16;

      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(handX, handY);
      ctx.stroke();

      const spec = WEAPONS[f.weapon];
      drawWeaponGraphic(ctx, f.weapon, handX, handY, f.facing, aim, spec.color);
    }
  }

  // Subtle player indicator tag above head (P1 / P2 / Bot)
  if (f.alive) {
    ctx.fillStyle = f.palette.primary;
    ctx.font = '700 11px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.palette.label, headX, headY - (f.palette.pattern === 'crown' ? 23 : 17));
  }

  ctx.restore();
}

function drawWeaponGraphic(
  ctx: CanvasRenderingContext2D,
  weapon: WeaponId,
  x: number,
  y: number,
  facing: 1 | -1,
  angle: number,
  accent: string
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (Math.cos(angle) < 0 || (angle === 0 && facing < 0)) {
    ctx.scale(1, -1);
  }

  switch (weapon) {
    case 'pistol':
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(-2, -4, 14, 5);
      ctx.fillStyle = '#475569';
      ctx.fillRect(-2, 0, 5, 7);
      break;
    case 'shotgun':
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(-6, -4, 24, 5);
      ctx.fillStyle = '#9A3412';
      ctx.fillRect(-10, -2, 8, 6);
      break;
    case 'smg':
      ctx.fillStyle = '#64748B';
      ctx.fillRect(-4, -5, 19, 6);
      ctx.fillStyle = accent;
      ctx.fillRect(3, 1, 4, 8);
      break;
    case 'katana':
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(2, -2, 28, 3);
      ctx.fillStyle = accent;
      ctx.fillRect(-4, -5, 6, 9);
      break;
    case 'rocket':
      ctx.fillStyle = '#475569';
      ctx.fillRect(-10, -6, 28, 10);
      ctx.fillStyle = '#F43F5E';
      ctx.fillRect(14, -5, 6, 8);
      break;
    case 'laser':
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(-8, -5, 28, 9);
      ctx.fillStyle = '#22D3EE';
      ctx.fillRect(4, -2, 16, 3);
      break;
    case 'minigun':
      ctx.fillStyle = '#334155';
      ctx.fillRect(-11, -7, 15, 12);
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(4, -5, 19, 2.2);
      ctx.fillRect(4, -1.2, 21, 2.4);
      ctx.fillRect(4, 2.8, 19, 2.2);
      ctx.fillStyle = accent;
      ctx.fillRect(-3, 5, 8, 5);
      break;
    case 'lightsaber':
      ctx.fillStyle = '#475569';
      ctx.fillRect(-5, -3, 9, 6);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(4, -2.6, 29, 5.2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(5, -1, 27, 2);
      break;
    case 'spear':
      ctx.fillStyle = '#92400E';
      ctx.fillRect(-16, -2, 30, 4);
      ctx.fillStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.moveTo(14, -5.5);
      ctx.lineTo(26, 0);
      ctx.lineTo(14, 5.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(-18, -3.5, 4, 7);
      break;
    case 'snake_gun':
      ctx.fillStyle = '#166534';
      ctx.fillRect(-4, -5, 18, 7);
      ctx.fillStyle = '#4ADE80';
      ctx.fillRect(10, -4, 7, 5);
      ctx.fillStyle = '#14532D';
      ctx.fillRect(-3, 1, 5, 7);
      ctx.fillStyle = '#FACC15';
      ctx.fillRect(12, -3, 2, 2);
      break;
    case 'blackhole_gun':
      ctx.fillStyle = '#312E81';
      ctx.fillRect(-8, -6, 24, 10);
      ctx.fillStyle = '#A855F7';
      ctx.beginPath();
      ctx.arc(14, -1, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#090C12';
      ctx.beginPath();
      ctx.arc(14, -1, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile, elapsedTime: number): void {
  ctx.save();
  if (p.isThrownWeapon && p.thrownWeaponId) {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spinAngle ?? 0);
    drawWeaponGraphic(ctx, p.thrownWeaponId, 0, 0, 1, 0, p.color);
    ctx.restore();
    return;
  }

  if (p.isSnake) {
    const dir = p.vx >= 0 ? 1 : -1;
    const phase = (p.snakePhase ?? 0) + elapsedTime * 16;
    ctx.translate(p.x, p.y);
    ctx.scale(dir, 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Slithering green serpent body
    ctx.strokeStyle = '#14532D';
    ctx.lineWidth = 8.5;
    ctx.beginPath();
    ctx.moveTo(-22, Math.sin(phase - 2.4) * 5);
    ctx.quadraticCurveTo(-11, Math.sin(phase - 1.2) * 6, 0, Math.sin(phase) * 3);
    ctx.lineTo(8, 0);
    ctx.stroke();

    ctx.strokeStyle = '#4ADE80';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-22, Math.sin(phase - 2.4) * 5);
    ctx.quadraticCurveTo(-11, Math.sin(phase - 1.2) * 6, 0, Math.sin(phase) * 3);
    ctx.lineTo(8, 0);
    ctx.stroke();

    // Viper head, yellow eye & forked red tongue
    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    ctx.ellipse(9, 0, 6.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FACC15';
    ctx.beginPath();
    ctx.arc(10.5, -1.6, 1.5, 0, Math.PI * 2);
    ctx.fill();

    if (Math.sin(elapsedTime * 22 + p.id) > -0.2) {
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(15, 0.5);
      ctx.lineTo(20, 0.5);
      ctx.lineTo(22.5, -1.5);
      ctx.moveTo(20, 0.5);
      ctx.lineTo(22.5, 2.5);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (p.isBlackHole) {
    ctx.translate(p.x, p.y);
    ctx.rotate(elapsedTime * 8);
    const gr = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
    gr.addColorStop(0, '#05050A');
    gr.addColorStop(0.45, '#9333EA');
    gr.addColorStop(1, 'rgba(168, 85, 247, 0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#090C12';
    ctx.beginPath();
    ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#E9D5FF';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (p.isSpear) {
    const ang = Math.atan2(p.vy, p.vx);
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.fillStyle = '#92400E';
    ctx.fillRect(-20, -2, 34, 4);
    ctx.fillStyle = '#F8FAFC';
    ctx.beginPath();
    ctx.moveTo(14, -5.5);
    ctx.lineTo(28, 0);
    ctx.lineTo(14, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(-22, -3.5, 5, 7);
    ctx.restore();
    return;
  }

  if (p.isRocket) {
    const ang = Math.atan2(p.vy, p.vx);
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(-9, -4, 15, 8);
    ctx.fillStyle = '#F43F5E';
    ctx.beginPath();
    ctx.moveTo(6, -4);
    ctx.lineTo(13, 0);
    ctx.lineTo(6, 4);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Outer glowing bullet streak + hot white core
  ctx.strokeStyle = p.color;
  ctx.lineWidth = p.radius * 2.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.prevX, p.prevY);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(1.8, p.radius * 0.85);
  ctx.beginPath();
  ctx.moveTo((p.prevX + p.x) * 0.5, (p.prevY + p.y) * 0.5);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSlashArc(ctx: CanvasRenderingContext2D, s: SlashArcEffect): void {
  const t = s.life / s.maxLife;
  ctx.save();
  ctx.globalAlpha = t;
  ctx.lineCap = 'round';

  // Wide glowing crescent
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 14 * t;
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.radius, s.angle - 1.05, s.angle + 1.05);
  ctx.stroke();

  // Razor white inner slash line
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(2, 5 * t);
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.radius + 2, s.angle - 0.9, s.angle + 0.9);
  ctx.stroke();
  ctx.restore();
}

function drawBeam(ctx: CanvasRenderingContext2D, b: BeamEffect, elapsedTime: number): void {
  const t = b.life / b.maxLife;
  ctx.save();
  ctx.globalAlpha = t;
  ctx.lineCap = 'round';

  // Outer energy bloom
  ctx.strokeStyle = b.color;
  ctx.lineWidth = b.width * 1.65 * t;
  ctx.beginPath();
  ctx.moveTo(b.x1, b.y1);
  ctx.lineTo(b.x2, b.y2);
  ctx.stroke();

  // Crackling lightning helix around beam
  const dx = b.x2 - b.x1;
  const dy = b.y2 - b.y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  ctx.strokeStyle = '#E0F2FE';
  ctx.lineWidth = Math.max(1.5, 2.5 * t);
  ctx.beginPath();
  ctx.moveTo(b.x1, b.y1);
  const segs = 12;
  for (let i = 1; i < segs; i++) {
    const frac = i / segs;
    const jitter = Math.sin(elapsedTime * 55 + i * 2.4) * 11 * t;
    ctx.lineTo(b.x1 + dx * frac + nx * jitter, b.y1 + dy * frac + ny * jitter);
  }
  ctx.lineTo(b.x2, b.y2);
  ctx.stroke();

  // White hot core
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(2.5, b.width * 0.45 * t);
  ctx.beginPath();
  ctx.moveTo(b.x1, b.y1);
  ctx.lineTo(b.x2, b.y2);
  ctx.stroke();
  ctx.restore();
}

function drawAfterimages(ctx: CanvasRenderingContext2D, afterimages: AfterimageGhost[]): void {
  for (let i = 0; i < afterimages.length; i++) {
    const g = afterimages[i];
    if (!g.active) continue;
    const t = Math.max(0, g.life / g.maxLife);
    ctx.save();
    ctx.globalAlpha = 0.34 * t;
    ctx.translate(g.x, g.y);
    ctx.scale(g.squashX, g.squashY);
    ctx.strokeStyle = g.color;
    ctx.fillStyle = g.color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    // Crisp simplified silhouette streak
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(-7, 0);
    ctx.moveTo(0, -22);
    ctx.lineTo(7, 0);
    ctx.moveTo(0, -22);
    ctx.lineTo(g.facing * 3, -40);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(g.facing * 3, -49, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawImpactFlashes(ctx: CanvasRenderingContext2D, flashes: ImpactFlashEffect[]): void {
  for (let i = 0; i < flashes.length; i++) {
    const fl = flashes[i];
    if (!fl.active) continue;
    const t = Math.max(0, fl.life / fl.maxLife);
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 1.4);
    ctx.translate(fl.x, fl.y);
    ctx.rotate(fl.rot);

    if (fl.kind === 'muzzle') {
      // Directional multi-prong gun barrel flash cone
      const len = fl.radius * (0.7 + 0.5 * t);
      ctx.fillStyle = fl.color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, -len * 0.32);
      ctx.lineTo(len * 0.72, 0);
      ctx.lineTo(len * 1.15, 0);
      ctx.lineTo(len * 0.72, 0);
      ctx.lineTo(len, len * 0.32);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len * 0.65, -len * 0.14);
      ctx.lineTo(len * 0.8, 0);
      ctx.lineTo(len * 0.65, len * 0.14);
      ctx.closePath();
      ctx.fill();
    } else {
      const { outerRadius, innerRadius } = computeImpactStarMetrics(1 - t, fl.radius);
      const pts = Math.max(5, fl.spikes);

      // Colored outer comic starburst
      ctx.fillStyle = fl.color;
      ctx.beginPath();
      for (let s = 0; s < pts * 2; s++) {
        const r = s % 2 === 0 ? outerRadius : innerRadius;
        const a = (s / (pts * 2)) * Math.PI * 2;
        if (s === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();

      // Hot white inner starburst core
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      for (let s = 0; s < pts * 2; s++) {
        const r = (s % 2 === 0 ? outerRadius : innerRadius) * 0.52;
        const a = (s / (pts * 2)) * Math.PI * 2;
        if (s === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

function drawCallouts(ctx: CanvasRenderingContext2D, callouts: FloatingCallout[]): void {
  for (let i = 0; i < callouts.length; i++) {
    const c = callouts[i];
    if (!c.active) continue;
    const t = Math.max(0, c.life / c.maxLife);
    const popScale = t > 0.75 ? 1.25 - (t - 0.75) : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2.8);
    ctx.translate(c.x, c.y);
    ctx.scale(c.scale * popScale, c.scale * popScale);
    ctx.font = '800 22px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#090C12';
    ctx.lineWidth = 5;
    ctx.strokeText(c.text, 0, 0);
    ctx.fillStyle = c.color;
    ctx.fillText(c.text, 0, 0);
    ctx.restore();
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (let i = 0; i < particles.length; i++) {
    const pt = particles[i];
    if (!pt.active) continue;
    const t = Math.max(0, pt.life / pt.maxLife);
    ctx.save();
    ctx.globalAlpha = pt.alpha * t;
    ctx.translate(pt.x, pt.y);

    if (pt.shape === 'droplet') {
      const ang = Math.atan2(pt.vy, pt.vx);
      const speed = Math.hypot(pt.vx, pt.vy);
      const stretch = Math.min(2.6, 1 + speed / 240);
      ctx.rotate(ang);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, pt.size * 0.7 * stretch, pt.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    ctx.rotate(pt.rot);

    if (pt.shape === 'confetti') {
      const flipScale = Math.max(0.25, Math.abs(Math.cos(pt.rot * 2.2)));
      ctx.scale(1, flipScale);
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.size * 0.65, -pt.size * 0.35, pt.size * 1.3, pt.size * 0.7);
    } else if (pt.shape === 'ribbon') {
      const len = pt.size;
      const wave = Math.sin(pt.life * 8.5 + pt.rot) * 9.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 6.2;
      ctx.beginPath();
      ctx.moveTo(-len * 0.58, 0);
      ctx.quadraticCurveTo(-len * 0.25, -wave, 0, 0);
      ctx.quadraticCurveTo(len * 0.25, wave, len * 0.58, 0);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.moveTo(-len * 0.5, 0);
      ctx.quadraticCurveTo(-len * 0.22, -wave * 0.9, 0, 0);
      ctx.quadraticCurveTo(len * 0.22, wave * 0.9, len * 0.5, 0);
      ctx.stroke();
    } else if (pt.shape === 'streamer') {
      const len = pt.size;
      const wave = Math.sin(pt.life * 14 + pt.rot) * 4.5;
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-len * 0.55, 0);
      ctx.quadraticCurveTo(-len * 0.15, -wave, 0, 0);
      ctx.quadraticCurveTo(len * 0.15, wave, len * 0.55, 0);
      ctx.stroke();
    } else if (pt.shape === 'star') {
      const rOuter = pt.size * (0.55 + 0.55 * t);
      const rInner = rOuter * 0.32;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      for (let s = 0; s < 8; s++) {
        const r = s % 2 === 0 ? rOuter : rInner;
        const a = (s / 8) * Math.PI * 2;
        if (s === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    } else if (pt.shape === 'ring') {
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 4.2 * t;
      ctx.beginPath();
      ctx.arc(0, 0, pt.size * (1.85 - t * 0.85), 0, Math.PI * 2);
      ctx.stroke();
    } else if (pt.shape === 'spark') {
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.size * 1.6, -pt.size * 0.35, pt.size * 3.2, pt.size * 0.7);
    } else if (pt.shape === 'casing') {
      ctx.fillStyle = pt.color;
      ctx.fillRect(-3.5, -1.5, 7, 3);
    } else if (pt.shape === 'shard') {
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.size * 0.55, -pt.size * 0.55, pt.size * 1.1, pt.size * 1.1);
    } else if (pt.category === 'smoke' || pt.category === 'fireball') {
      // Blossoming smoke/fireball puff expands as it fades
      const scaleUp = pt.category === 'smoke' ? 1.55 - 0.55 * t : 1.3 - 0.3 * t;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(0, 0, pt.size * scaleUp, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(0, 0, pt.size * (0.4 + 0.6 * t), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(253, 224, 71, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(253, 224, 71, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function drawVictoryRadialBloom(
  ctx: CanvasRenderingContext2D,
  winner: Fighter,
  bloom: ReturnType<typeof computeVictoryBloomMetrics>
): void {
  const cx = winner.x + winner.w * 0.5;
  const cy = winner.y + winner.h * 0.44;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Wide atmospheric radial bloom gradient anchored on the winner
  const outerGrad = ctx.createRadialGradient(cx, cy, 6, cx, cy, bloom.bloomRadius);
  outerGrad.addColorStop(0, `rgba(255, 255, 255, ${Math.min(0.9, bloom.bloomAlpha * 0.95)})`);
  outerGrad.addColorStop(0.18, hexWithAlpha(winner.palette.headband, bloom.bloomAlpha * 0.72));
  outerGrad.addColorStop(0.45, hexWithAlpha(winner.palette.primary, bloom.bloomAlpha * 0.42));
  outerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = outerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, bloom.bloomRadius, 0, Math.PI * 2);
  ctx.fill();

  // Rotating volumetric light rays / god-rays radiating from winner's core (2 shared gradients)
  const wideGrad = ctx.createLinearGradient(0, 0, bloom.rayLength, 0);
  wideGrad.addColorStop(0, `rgba(255, 251, 235, ${bloom.bloomAlpha * 0.34})`);
  wideGrad.addColorStop(0.35, hexWithAlpha(winner.palette.primary, bloom.bloomAlpha * 0.25));
  wideGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  const narrowGrad = ctx.createLinearGradient(0, 0, bloom.rayLength * 0.74, 0);
  narrowGrad.addColorStop(0, `rgba(255, 251, 235, ${bloom.bloomAlpha * 0.24})`);
  narrowGrad.addColorStop(0.35, hexWithAlpha(winner.palette.primary, bloom.bloomAlpha * 0.18));
  narrowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  for (let i = 0; i < bloom.rayCount; i++) {
    const angle = bloom.rayRotation + (i / bloom.rayCount) * Math.PI * 2;
    const isWide = i % 2 === 0;
    const len = bloom.rayLength * (isWide ? 1.0 : 0.74);
    const halfSpread = isWide ? 0.16 : 0.085;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = isWide ? wideGrad : narrowGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(-halfSpread) * len, Math.sin(-halfSpread) * len);
    ctx.lineTo(Math.cos(halfSpread) * len, Math.sin(halfSpread) * len);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Tight incandescent inner corona behind stickman outline
  const coreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, bloom.coreRadius);
  coreGrad.addColorStop(0, `rgba(255, 255, 255, ${Math.min(0.95, bloom.bloomAlpha)})`);
  coreGrad.addColorStop(0.55, hexWithAlpha(winner.palette.headband, bloom.bloomAlpha * 0.5));
  coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, bloom.coreRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawVictoryLightFlare(
  ctx: CanvasRenderingContext2D,
  winner: Fighter,
  bloom: ReturnType<typeof computeVictoryBloomMetrics>
): void {
  const cx = winner.x + winner.w * 0.5;
  const cy = winner.y + winner.h * 0.4;
  const halfW = bloom.anamorphicWidth * 0.5;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 1. Anamorphic horizontal lens flare streak
  const streakGrad = ctx.createLinearGradient(cx - halfW, cy, cx + halfW, cy);
  streakGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  streakGrad.addColorStop(0.28, hexWithAlpha(winner.palette.primary, bloom.anamorphicAlpha * 0.45));
  streakGrad.addColorStop(0.47, hexWithAlpha(winner.palette.headband, bloom.anamorphicAlpha * 0.85));
  streakGrad.addColorStop(0.5, `rgba(255, 255, 255, ${bloom.anamorphicAlpha})`);
  streakGrad.addColorStop(0.53, hexWithAlpha(winner.palette.headband, bloom.anamorphicAlpha * 0.85));
  streakGrad.addColorStop(0.72, hexWithAlpha(winner.palette.primary, bloom.anamorphicAlpha * 0.45));
  streakGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = streakGrad;
  ctx.beginPath();
  ctx.moveTo(cx - halfW, cy);
  ctx.quadraticCurveTo(cx, cy - 8.5 * bloom.starFlareScale, cx + halfW, cy);
  ctx.quadraticCurveTo(cx, cy + 8.5 * bloom.starFlareScale, cx - halfW, cy);
  ctx.closePath();
  ctx.fill();

  // Sharp inner white-hot anamorphic filament (kept translucent so winner outline stays readable)
  ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.64, bloom.anamorphicAlpha * 0.68)})`;
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 0.62, cy);
  ctx.quadraticCurveTo(cx, cy - 2.0 * bloom.starFlareScale, cx + halfW * 0.62, cy);
  ctx.quadraticCurveTo(cx, cy + 2.0 * bloom.starFlareScale, cx - halfW * 0.62, cy);
  ctx.closePath();
  ctx.fill();

  // 2. Crisp 4-point star glint centered on the winner's chest
  const spikeMajor = 46 * bloom.starFlareScale;
  const spikeMinor = 2.8 * bloom.starFlareScale;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(bloom.rayRotation * 1.4) * 0.14);
  ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.72, bloom.anamorphicAlpha * 0.76)})`;
  ctx.beginPath();
  ctx.moveTo(0, -spikeMajor * 0.78);
  ctx.lineTo(spikeMinor, -spikeMinor);
  ctx.lineTo(spikeMajor, 0);
  ctx.lineTo(spikeMinor, spikeMinor);
  ctx.lineTo(0, spikeMajor * 0.78);
  ctx.lineTo(-spikeMinor, spikeMinor);
  ctx.lineTo(-spikeMajor, 0);
  ctx.lineTo(-spikeMinor, -spikeMinor);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 3. Subtle optical lens flare bokeh ghosts along horizontal axis
  const ghostOffsets = [-0.52, -0.28, 0.3, 0.56];
  for (let i = 0; i < ghostOffsets.length; i++) {
    const gx = cx + halfW * ghostOffsets[i];
    const gr = (i % 2 === 0 ? 11 : 17) * bloom.starFlareScale;
    const ga = bloom.anamorphicAlpha * (i % 2 === 0 ? 0.24 : 0.16);
    ctx.fillStyle = i % 2 === 0 ? hexWithAlpha(winner.palette.headband, ga) : hexWithAlpha(winner.palette.primary, ga);
    ctx.beginPath();
    ctx.arc(gx, cy, gr, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawStuckSpear(
  ctx: CanvasRenderingContext2D,
  sp: StuckSpear,
  elapsedTime: number
): void {
  const blink = sp.life < 2 ? 0.4 + 0.6 * Math.abs(Math.sin(elapsedTime * 10)) : 1;
  ctx.save();
  ctx.globalAlpha = blink;
  ctx.translate(sp.x, sp.y);
  ctx.rotate(sp.angle);

  if (sp.weaponId === 'lightsaber') {
    ctx.fillStyle = '#475569';
    ctx.fillRect(-34, -3, 10, 6);
    ctx.fillStyle = sp.color;
    ctx.fillRect(-24, -2.5, 28, 5);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(-23, -1, 26, 2);
  } else {
    ctx.fillStyle = '#92400E';
    ctx.fillRect(-38, -2, 34, 4);
    ctx.fillStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.moveTo(-4, -5);
    ctx.lineTo(8, 0);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(-40, -3.5, 5, 7);
  }
  ctx.restore();
}

function drawBlackHoleVortex(
  ctx: CanvasRenderingContext2D,
  bh: BlackHoleVortex,
  elapsedTime: number
): void {
  const t = Math.max(0, Math.min(1, bh.life / bh.maxLife));
  const openScale = Math.min(1, (bh.maxLife - bh.life) / 0.25);
  const coreR = bh.radius * (0.85 + 0.15 * Math.sin(elapsedTime * 12)) * openScale;

  ctx.save();
  ctx.translate(bh.x, bh.y);

  // Outer gravitational pull distortion aura
  const aura = ctx.createRadialGradient(0, 0, coreR * 0.5, 0, 0, bh.pullRadius);
  aura.addColorStop(0, 'rgba(147, 51, 234, 0.36)');
  aura.addColorStop(0.42, 'rgba(88, 28, 135, 0.14)');
  aura.addColorStop(1, 'rgba(88, 28, 135, 0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, 0, bh.pullRadius, 0, Math.PI * 2);
  ctx.fill();

  // Rotating spiral accretion arcs
  ctx.rotate(bh.spin);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i / 4) * Math.PI * 2);
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(192, 132, 252, 0.72)' : 'rgba(56, 189, 248, 0.52)';
    ctx.lineWidth = 3 * openScale;
    ctx.beginPath();
    ctx.arc(0, 0, coreR * 2.2, 0.15, 1.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, coreR * 3.4, 0.4, 1.35);
    ctx.stroke();
    ctx.restore();
  }

  // Event horizon pitch-black core + bright violet corona rim
  ctx.fillStyle = '#030308';
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(4, coreR), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = t < 0.2 ? '#FDE047' : '#C084FC';
  ctx.lineWidth = 3.2;
  ctx.stroke();

  ctx.restore();
}

function drawWeatherBackdrop(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  weather: WeatherState,
  elapsedTime: number
): void {
  const alpha = Math.min(1, weather.intensity);
  ctx.save();

  if (weather.kind === 'snowstorm') {
    ctx.fillStyle = `rgba(186, 230, 253, ${0.09 * alpha})`;
    ctx.fillRect(0, 0, viewW, viewH);
  } else if (weather.kind === 'acid_rain') {
    ctx.fillStyle = `rgba(34, 197, 94, ${0.09 * alpha})`;
    ctx.fillRect(0, 0, viewW, viewH);
  } else if (weather.kind === 'gale_wind') {
    ctx.fillStyle = `rgba(148, 163, 184, ${0.08 * alpha})`;
    ctx.fillRect(0, 0, viewW, viewH);
    // Sweeping sky gust ribbons across background
    ctx.strokeStyle = `rgba(226, 232, 240, ${0.18 * alpha})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const span = viewW + 260;
      const speed = (420 + (i % 3) * 140) * weather.windDir;
      const rawX = (i * 190 + elapsedTime * speed) % span;
      const x = rawX < -130 ? rawX + span : rawX;
      const y = ((i * 97) % (viewH * 0.8)) + 50 + Math.sin(elapsedTime * 3 + i) * 14;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + weather.windDir * 55, y - 10, x + weather.windDir * 120, y + 4);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawWeatherWorldLayer(
  ctx: CanvasRenderingContext2D,
  arena: ArenaDefinition,
  weather: WeatherState,
  elapsedTime: number
): void {
  const alpha = Math.min(1, weather.intensity);
  ctx.save();

  if (weather.kind === 'snowstorm') {
    const left = weather.zoneCenterX - weather.zoneHalfWidth;
    const right = weather.zoneCenterX + weather.zoneHalfWidth;
    const band = ctx.createLinearGradient(left, 0, right, 0);
    band.addColorStop(0, 'rgba(186, 230, 253, 0)');
    band.addColorStop(0.2, `rgba(186, 230, 253, ${0.11 * alpha})`);
    band.addColorStop(0.5, `rgba(224, 242, 254, ${0.16 * alpha})`);
    band.addColorStop(0.8, `rgba(186, 230, 253, ${0.11 * alpha})`);
    band.addColorStop(1, 'rgba(186, 230, 253, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(left, 0, weather.zoneHalfWidth * 2, arena.height);

    // Swirling slanted snowflakes inside localized blizzard zone
    ctx.fillStyle = `rgba(240, 249, 255, ${0.85 * alpha})`;
    const count = 52;
    for (let i = 0; i < count; i++) {
      const frac = ((i * 73) % 100) / 100;
      const fx =
        weather.zoneCenterX -
        weather.zoneHalfWidth +
        ((frac * weather.zoneHalfWidth * 2 + elapsedTime * weather.windDir * (140 + (i % 4) * 35)) %
          (weather.zoneHalfWidth * 2) +
          weather.zoneHalfWidth * 2) %
          (weather.zoneHalfWidth * 2);
      const fy = ((i * 59 + elapsedTime * (190 + (i % 5) * 40)) % (arena.height - 20));
      const r = 1.8 + (i % 3) * 1.1;
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (weather.kind === 'acid_rain') {
    const left = weather.zoneCenterX - weather.zoneHalfWidth;
    const right = weather.zoneCenterX + weather.zoneHalfWidth;
    const band = ctx.createLinearGradient(left, 0, right, 0);
    band.addColorStop(0, 'rgba(34, 197, 94, 0)');
    band.addColorStop(0.2, `rgba(34, 197, 94, ${0.1 * alpha})`);
    band.addColorStop(0.5, `rgba(74, 222, 128, ${0.14 * alpha})`);
    band.addColorStop(0.8, `rgba(34, 197, 94, ${0.1 * alpha})`);
    band.addColorStop(1, 'rgba(34, 197, 94, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(left, 0, weather.zoneHalfWidth * 2, arena.height);

    ctx.strokeStyle = `rgba(74, 222, 128, ${0.72 * alpha})`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const drops = 46;
    for (let i = 0; i < drops; i++) {
      const fx =
        weather.zoneCenterX -
        weather.zoneHalfWidth +
        (((i * 97 + elapsedTime * weather.windDir * 70) % (weather.zoneHalfWidth * 2) +
          weather.zoneHalfWidth * 2) %
          (weather.zoneHalfWidth * 2));
      let maxY = arena.height - 10;
      for (const p of arena.platforms) {
        if (p.kind === 'destructible' && (p.hp ?? 1) <= 0) continue;
        if (fx >= p.x && fx <= p.x + p.w && p.y < maxY) {
          maxY = p.y;
        }
      }
      const fy = (i * 83 + elapsedTime * 580) % Math.max(120, maxY);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + weather.windDir * 5, fy + 16);
      ctx.stroke();

      // Acid splash bubble on roof/platform top
      if (maxY < arena.height - 20 && i % 3 === 0) {
        const pop = Math.abs(Math.sin(elapsedTime * 11 + i));
        ctx.fillStyle = `rgba(134, 239, 172, ${0.45 * alpha * pop})`;
        ctx.beginPath();
        ctx.arc(fx, maxY - pop * 4, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (weather.kind === 'gale_wind') {
    ctx.strokeStyle = `rgba(226, 232, 240, ${0.32 * alpha})`;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      const speed = (620 + (i % 4) * 140) * weather.windDir;
      const sx =
        ((i * 150 + elapsedTime * speed) % arena.width + arena.width) % arena.width;
      const sy = 55 + ((i * 89) % (arena.height - 140));
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + weather.windDir * 44, sy + Math.sin(elapsedTime * 6 + i) * 3);
      ctx.stroke();
    }
  }

  ctx.restore();
}

