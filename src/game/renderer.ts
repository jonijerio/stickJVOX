import { getLaserPhase, getPendulumPosition } from './rules';
import {
  ArenaDefinition,
  BeamEffect,
  Fighter,
  Particle,
  Projectile,
  SlashArcEffect,
  SurfaceDecal,
  WeaponId,
  WeaponPickup,
} from './types';
import { WEAPONS } from './weapons';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  trauma: number;
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
  camera: CameraState,
  elapsedTime: number
): void {
  ctx.save();

  // 1. Atmospheric Arena Sky Backdrop (pre-rendered offscreen canvas)
  const bg = getOrBuildBackground(viewW, viewH, arena);
  ctx.drawImage(bg, 0, 0, viewW, viewH);

  // 2. Camera Transform (with decaying trauma*trauma shake)
  const shakePower = camera.trauma * camera.trauma;
  const shakeX = (Math.random() * 2 - 1) * 14 * shakePower;
  const shakeY = (Math.random() * 2 - 1) * 12 * shakePower;

  const baseScale = Math.min(viewW / arena.width, viewH / arena.height);
  const scale = baseScale * camera.zoom;

  ctx.translate(viewW * 0.5 + shakeX, viewH * 0.5 + shakeY);
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

  // 5. Laser Grid Hazards (Idle emitters -> Telegraph line -> Active beam)
  for (const laser of arena.lasers) {
    drawLaserHazard(ctx, laser, elapsedTime);
  }

  // 6. Pendulum Wrecking Ball Hazards
  for (const pend of arena.pendulums) {
    drawPendulumHazard(ctx, pend, elapsedTime);
  }

  // 7. Weapon Pickups (with parachutes & soft halo)
  for (const pk of pickups) {
    drawWeaponPickup(ctx, pk, elapsedTime);
  }

  // 8. Fighters (Articulated stickmen + squash/stretch + cosmetic patterns + weapons + shield arcs)
  for (const f of fighters) {
    drawStickFighter(ctx, f, elapsedTime);
  }

  // 9. Slash Arcs & Rail Laser Beams
  for (const s of slashes) {
    drawSlashArc(ctx, s);
  }
  for (const b of beams) {
    drawBeam(ctx, b);
  }

  // 10. Projectiles & Thrown Weapons
  for (const p of projectiles) {
    if (!p.active) continue;
    drawProjectile(ctx, p);
  }

  // 11. Pooled Particle Ring Buffer
  drawParticles(ctx, particles);

  ctx.restore();
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
  const spec = WEAPONS[pk.weaponId];
  const bob = pk.grounded ? Math.sin(elapsedTime * 4 + pk.bobPhase) * 4 : 0;
  const cx = pk.x;
  const cy = pk.y + bob;

  ctx.save();
  // Parachute if descending
  if (pk.parachuteOpen && !pk.grounded) {
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy - 22);
    ctx.lineTo(cx, cy - 4);
    ctx.moveTo(cx + 16, cy - 22);
    ctx.lineTo(cx, cy - 4);
    ctx.stroke();

    ctx.fillStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.arc(cx, cy - 22, 18, Math.PI, 0);
    ctx.fill();
  }

  // Soft aura
  ctx.fillStyle = `${spec.color}28`;
  ctx.beginPath();
  ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  ctx.fill();

  drawWeaponGraphic(ctx, pk.weaponId, cx, cy, 1, 0, spec.color);
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
  const hipY = -22;
  const shoulderY = -40;
  const headY = -49;

  const speedNorm = Math.min(1, Math.abs(f.vx) / 300);
  const stride = f.grounded ? Math.sin(f.walkCycle) * 12 * speedNorm : 7;
  const liftA = f.grounded ? Math.max(0, -Math.cos(f.walkCycle)) * 6 * speedNorm : 5;
  const liftB = f.grounded ? Math.max(0, Math.cos(f.walkCycle)) * 6 * speedNorm : 2;
  const lean = f.alive ? (f.vx / 420) * 5 : 0;

  const drawBodyPass = (strokeColor: string, headFill: string, width: number) => {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = width;

    // Back leg
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(-stride * 0.6, -11 - liftB * 0.5);
    ctx.lineTo(-stride, -liftB);
    ctx.stroke();

    // Front leg
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(stride * 0.6, -11 - liftA * 0.5);
    ctx.lineTo(stride, -liftA);
    ctx.stroke();

    // Torso
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(lean, shoulderY);
    ctx.stroke();

    // Head
    ctx.fillStyle = headFill;
    ctx.beginPath();
    ctx.arc(lean * 1.1, headY, width > 7 ? 11.5 : 9.8, 0, Math.PI * 2);
    ctx.fill();
  };

  // Dark silhouette outline pass + colored fighter pass
  drawBodyPass('#090C12', '#090C12', 9.5);
  drawBodyPass(color, color, 6);

  // Player Headband / Scarf tail + Cosmetic Pattern accents
  if (f.hitFlashTimer <= 0) {
    const pattern = f.palette.pattern;

    // Pattern overlays on body/head
    if (pattern === 'stripes') {
      ctx.strokeStyle = f.palette.headband;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(lean * 0.2 - 3.5, hipY - 5);
      ctx.lineTo(lean * 0.2 + 3.5, hipY - 5);
      ctx.moveTo(lean * 0.65 - 3.5, hipY - 12);
      ctx.lineTo(lean * 0.65 + 3.5, hipY - 12);
      // Leg bands
      ctx.moveTo(-stride * 0.65 - 2.5, -10 - liftB * 0.5);
      ctx.lineTo(-stride * 0.65 + 2.5, -10 - liftB * 0.5);
      ctx.moveTo(stride * 0.65 - 2.5, -10 - liftA * 0.5);
      ctx.lineTo(stride * 0.65 + 2.5, -10 - liftA * 0.5);
      ctx.stroke();
    } else if (pattern === 'core') {
      // Glowing inner core diamond & bright eye center
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(lean * 0.5, (hipY + shoulderY) * 0.5, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = f.palette.headband;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(lean * 0.5, (hipY + shoulderY) * 0.5, 5.2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#090C12';
      ctx.beginPath();
      ctx.arc(lean * 1.1 + f.facing * 4, headY - 1, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (pattern === 'viper') {
      // Tactical dark visor + glowing slit + shoulder chevron
      ctx.fillStyle = '#090C12';
      ctx.fillRect(lean * 1.1 + (f.facing > 0 ? -1 : -8), headY - 4, 9, 4.5);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(lean * 1.1 + (f.facing > 0 ? 1 : -6), headY - 2.8, 5.5, 2);

      ctx.strokeStyle = f.palette.dark;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(lean * 0.5 - 3.5, shoulderY + 6);
      ctx.lineTo(lean * 0.5, shoulderY + 10);
      ctx.lineTo(lean * 0.5 + 3.5, shoulderY + 6);
      ctx.stroke();
    } else if (pattern === 'crown') {
      // Royal gold crown crest above head + collar accent
      const hx = lean * 1.1;
      const cy = headY - 10;
      ctx.fillStyle = '#FACC15';
      ctx.strokeStyle = '#090C12';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hx - 6.5, cy);
      ctx.lineTo(hx - 7.5, cy - 8);
      ctx.lineTo(hx - 3, cy - 4);
      ctx.lineTo(hx, cy - 10);
      ctx.lineTo(hx + 3, cy - 4);
      ctx.lineTo(hx + 7.5, cy - 8);
      ctx.lineTo(hx + 6.5, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(lean - 4, shoulderY + 2);
      ctx.lineTo(lean + 4, shoulderY + 2);
      ctx.stroke();
    }

    // Signature headband + flowing scarf tail (skip visor overlap for viper)
    if (pattern !== 'viper') {
      ctx.strokeStyle = f.palette.headband;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(lean * 1.1 - 8, headY - 3);
      ctx.lineTo(lean * 1.1 + 8, headY - 3);
      ctx.stroke();

      const tailWave = Math.sin(elapsedTime * 11 + f.id) * 4;
      ctx.beginPath();
      ctx.moveTo(lean * 1.1 - f.facing * 8, headY - 3);
      ctx.lineTo(lean * 1.1 - f.facing * (18 + speedNorm * 6), headY - 1 + tailWave);
      ctx.stroke();
    }
  }

  // Arms + Weapon
  ctx.strokeStyle = color;
  ctx.lineWidth = 5.5;

  const shoulderX = lean;
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

  // Subtle player indicator tag above head (P1 / P2 / Bot)
  if (f.alive) {
    ctx.fillStyle = f.palette.primary;
    ctx.font = '700 11px "Barlow Condensed", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.palette.label, lean, headY - 17);
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
    default:
      break;
  }
  ctx.restore();
}

function drawProjectile(ctx: CanvasRenderingContext2D, p: Projectile): void {
  ctx.save();
  if (p.isThrownWeapon && p.thrownWeaponId) {
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spinAngle ?? 0);
    drawWeaponGraphic(ctx, p.thrownWeaponId, 0, 0, 1, 0, p.color);
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

  // Crisp bullet tracer
  ctx.strokeStyle = p.color;
  ctx.lineWidth = p.radius * 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p.prevX, p.prevY);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSlashArc(ctx: CanvasRenderingContext2D, s: SlashArcEffect): void {
  const t = s.life / s.maxLife;
  ctx.save();
  ctx.globalAlpha = t;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 8 * t;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.radius, s.angle - 0.85, s.angle + 0.85);
  ctx.stroke();
  ctx.restore();
}

function drawBeam(ctx: CanvasRenderingContext2D, b: BeamEffect): void {
  const t = b.life / b.maxLife;
  ctx.save();
  ctx.globalAlpha = t;
  ctx.strokeStyle = b.color;
  ctx.lineWidth = b.width * t;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(b.x1, b.y1);
  ctx.lineTo(b.x2, b.y2);
  ctx.stroke();

  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(2, b.width * 0.35 * t);
  ctx.beginPath();
  ctx.moveTo(b.x1, b.y1);
  ctx.lineTo(b.x2, b.y2);
  ctx.stroke();
  ctx.restore();
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
      const stretch = Math.min(2.4, 1 + speed / 260);
      ctx.rotate(ang);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, pt.size * 0.65 * stretch, pt.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    ctx.rotate(pt.rot);

    if (pt.shape === 'ring') {
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 3 * t;
      ctx.beginPath();
      ctx.arc(0, 0, pt.size * (1.8 - t * 0.8), 0, Math.PI * 2);
      ctx.stroke();
    } else if (pt.shape === 'spark') {
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.size * 1.4, -pt.size * 0.35, pt.size * 2.8, pt.size * 0.7);
    } else if (pt.shape === 'casing') {
      ctx.fillStyle = pt.color;
      ctx.fillRect(-3, -1.5, 6, 3);
    } else if (pt.shape === 'shard') {
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.size * 0.5, -pt.size * 0.5, pt.size, pt.size);
    } else {
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(0, 0, pt.size * (0.4 + 0.6 * t), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
