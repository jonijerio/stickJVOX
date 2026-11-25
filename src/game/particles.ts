import { Particle, ParticleCategory, Platform, SurfaceDecal } from './types';

export interface ParticleSpawnOptions {
  category: ParticleCategory;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  maxLife: number;
  gravity?: number;
  drag?: number;
  bounce?: number;
  shape?: Particle['shape'];
  alpha?: number;
  paintDecalOnHit?: boolean;
}

/**
 * Zero-GC ring-buffered particle & surface-decal system for Stick Fight.
 * Handles stylised blood/ink droplets (which convert into persistent platform
 * splatter decals on contact), surface dust puffs, bouncing debris chunks,
 * shell casings, impact sparks, and shockwave rings.
 */
export class ParticleSystem {
  public readonly particles: Particle[];
  public readonly decals: SurfaceDecal[];
  private particleCursor = 0;
  private decalCursor = 0;

  constructor(particleCapacity = 560, decalCapacity = 180) {
    this.particles = Array.from({ length: particleCapacity }, () => ({
      active: false,
      category: 'spark',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 4,
      color: '#FFFFFF',
      alpha: 1,
      life: 0,
      maxLife: 0.4,
      gravity: 0,
      drag: 0,
      bounce: 0,
      shape: 'circle',
      rot: 0,
      rotVel: 0,
      paintDecalOnHit: false,
    }));

    this.decals = Array.from({ length: decalCapacity }, () => ({
      active: false,
      platformId: '',
      offsetX: 0,
      offsetY: 0,
      rx: 6,
      ry: 3,
      color: '#DC2626',
      alpha: 0.85,
      edge: 'top',
    }));
  }

  public clearAll(): void {
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].active = false;
    }
    for (let i = 0; i < this.decals.length; i++) {
      this.decals[i].active = false;
    }
  }

  public spawn(opts: ParticleSpawnOptions): void {
    const pt = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % this.particles.length;
    pt.active = true;
    pt.category = opts.category;
    pt.x = opts.x;
    pt.y = opts.y;
    pt.vx = opts.vx;
    pt.vy = opts.vy;
    pt.size = opts.size;
    pt.color = opts.color;
    pt.alpha = opts.alpha ?? 1;
    pt.life = opts.maxLife;
    pt.maxLife = opts.maxLife;
    pt.gravity = opts.gravity ?? 0;
    pt.drag = opts.drag ?? 0;
    pt.bounce = opts.bounce ?? 0;
    pt.shape = opts.shape ?? 'circle';
    pt.rot = Math.random() * Math.PI * 2;
    pt.rotVel = (Math.random() * 2 - 1) * 10;
    pt.paintDecalOnHit = opts.paintDecalOnHit ?? false;
  }

  public addDecal(
    platform: Platform,
    worldX: number,
    worldY: number,
    color: string,
    edge: SurfaceDecal['edge'],
    size = 7
  ): void {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    d.active = true;
    d.platformId = platform.id;
    d.edge = edge;
    d.color = color;
    d.alpha = 0.82;

    if (edge === 'top') {
      d.offsetX = Math.max(4, Math.min(platform.w - 4, worldX - platform.x));
      d.offsetY = 0;
      d.rx = Math.min(9.5, size * (0.75 + Math.random() * 0.65));
      d.ry = Math.max(2, Math.min(3.4, size * 0.34));
    } else if (edge === 'left') {
      d.offsetX = 0;
      d.offsetY = Math.max(4, Math.min(platform.h - 4, worldY - platform.y));
      d.rx = Math.max(2, Math.min(3.4, size * 0.36));
      d.ry = Math.min(9.5, size * (0.75 + Math.random() * 0.6));
    } else {
      d.offsetX = platform.w;
      d.offsetY = Math.max(4, Math.min(platform.h - 4, worldY - platform.y));
      d.rx = Math.max(2, Math.min(3.4, size * 0.36));
      d.ry = Math.min(9.5, size * (0.75 + Math.random() * 0.6));
    }
  }

  /**
   * Emits directional blood / ink splatter droplets on damage.
   * Droplets adhere to any platform or crate they strike as persistent decals.
   */
  public emitBloodSplatter(
    x: number,
    y: number,
    dirX: number,
    color: string,
    intensity = 1,
    rng: () => number = Math.random
  ): void {
    const count = Math.round(16 * intensity);
    const baseAngle = dirX >= 0 ? -0.38 : Math.PI + 0.38;
    for (let i = 0; i < count; i++) {
      const spread = (rng() * 2 - 1) * 1.25;
      const ang = baseAngle + spread;
      const spd = (200 + rng() * 420) * (0.75 + intensity * 0.38);
      this.spawn({
        category: 'blood',
        x: x + (rng() * 10 - 5),
        y: y + (rng() * 14 - 7),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 85,
        size: 3.4 + rng() * 4.6,
        color,
        maxLife: 0.6 + rng() * 0.5,
        gravity: 1180,
        drag: 0.35,
        shape: 'droplet',
        alpha: 0.96,
        paintDecalOnHit: i % 2 === 0,
      });
    }
    // Fine arterial mist burst
    const mistCount = Math.round(6 * intensity);
    for (let i = 0; i < mistCount; i++) {
      const ang = baseAngle + (rng() * 2 - 1) * 1.4;
      const spd = 110 + rng() * 180;
      this.spawn({
        category: 'blood',
        x: x + (rng() * 8 - 4),
        y: y + (rng() * 10 - 5),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 40,
        size: 5 + rng() * 5,
        color,
        maxLife: 0.24 + rng() * 0.16,
        gravity: 220,
        drag: 3.5,
        shape: 'circle',
        alpha: 0.55,
      });
    }
  }

  /**
   * Emits soft expanding dust puffs on footfalls, landings, jumps, or wall slides.
   */
  public emitDust(
    x: number,
    y: number,
    count = 6,
    spreadSpeed = 120,
    tint = '#CBD5E1',
    rng: () => number = Math.random
  ): void {
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI * (0.1 + rng() * 0.8);
      const spd = spreadSpeed * (0.35 + rng() * 0.75);
      this.spawn({
        category: 'dust',
        x: x + (rng() * 14 - 7),
        y: y - rng() * 4,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.55 - 18,
        size: 4 + rng() * 4.5,
        color: tint,
        maxLife: 0.28 + rng() * 0.24,
        gravity: -35,
        drag: 3.2,
        shape: 'circle',
        alpha: 0.65,
      });
    }
  }

  /**
   * Emits spinning solid debris chunks when crates break, bullets hit walls, or explosions hit surfaces.
   */
  public emitDebris(
    x: number,
    y: number,
    color: string,
    count = 12,
    speed = 280,
    rng: () => number = Math.random
  ): void {
    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      const spd = speed * (0.4 + rng() * 0.8);
      this.spawn({
        category: 'debris',
        x: x + (rng() * 10 - 5),
        y: y + (rng() * 10 - 5),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 90,
        size: 4 + rng() * 5,
        color,
        maxLife: 0.55 + rng() * 0.45,
        gravity: 1180,
        drag: 0.5,
        bounce: 0.42,
        shape: 'shard',
        alpha: 1,
      });
    }
  }

  public emitSparks(
    x: number,
    y: number,
    color: string,
    count = 8,
    speed = 240,
    rng: () => number = Math.random
  ): void {
    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      const spd = speed * (0.35 + rng() * 0.75);
      this.spawn({
        category: 'spark',
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 3 + rng() * 3,
        color,
        maxLife: 0.2 + rng() * 0.22,
        gravity: 340,
        shape: 'spark',
        alpha: 1,
      });
    }
  }

  public emitRing(x: number, y: number, radius: number, color: string, maxLife = 0.28): void {
    this.spawn({
      category: 'ring',
      x,
      y,
      vx: 0,
      vy: 0,
      size: radius,
      color,
      maxLife,
      gravity: 0,
      shape: 'ring',
      alpha: 0.9,
    });
  }

  public emitCasing(x: number, y: number, dirX: number): void {
    this.spawn({
      category: 'casing',
      x,
      y,
      vx: -dirX * 85 + (Math.random() * 40 - 20),
      vy: -155 - Math.random() * 60,
      size: 4,
      color: '#FBBF24',
      maxLife: 0.65,
      gravity: 960,
      bounce: 0.35,
      shape: 'casing',
      alpha: 1,
    });
  }

  /**
   * Emits a directional barrel muzzle flash cone + hot sparks + quick gunsmoke.
   */
  public emitMuzzleFlash(
    x: number,
    y: number,
    angle: number,
    color: string,
    power = 1,
    rng: () => number = Math.random
  ): void {
    const sparkCount = Math.round(7 * power);
    for (let i = 0; i < sparkCount; i++) {
      const spread = (rng() * 2 - 1) * 0.42;
      const spd = (200 + rng() * 260) * power;
      this.spawn({
        category: 'spark',
        x,
        y,
        vx: Math.cos(angle + spread) * spd,
        vy: Math.sin(angle + spread) * spd,
        size: 3.2 + rng() * 3,
        color: i % 2 === 0 ? '#FFFFFF' : color,
        maxLife: 0.14 + rng() * 0.12,
        gravity: 220,
        shape: 'spark',
        alpha: 1,
      });
    }
    this.emitSmokePuff(x, y, Math.max(2, Math.round(3 * power)), 95 * power, '#94A3B8', rng);
  }

  /**
   * Emits soft buoyant smoke puffs for explosions, rockets, and heavy gunfire.
   */
  public emitSmokePuff(
    x: number,
    y: number,
    count = 6,
    spreadSpeed = 120,
    tint = '#475569',
    rng: () => number = Math.random
  ): void {
    for (let i = 0; i < count; i++) {
      const ang = rng() * Math.PI * 2;
      const spd = spreadSpeed * (0.25 + rng() * 0.85);
      this.spawn({
        category: 'smoke',
        x: x + (rng() * 14 - 7),
        y: y + (rng() * 14 - 7),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 45,
        size: 9 + rng() * 11,
        color: tint,
        maxLife: 0.48 + rng() * 0.38,
        gravity: -75,
        drag: 2.2,
        shape: 'circle',
        alpha: 0.55,
      });
    }
  }

  /**
   * Multi-stage Stick-Fight-style explosion: incandescent fireball core,
   * triple shockwave rings, billowing smoke plume, burning star embers, and bouncing shrapnel.
   */
  public emitExplosion(
    x: number,
    y: number,
    radius = 115,
    accentColor = '#FB923C',
    rng: () => number = Math.random
  ): void {
    // Triple expanding shockwave rings
    this.emitRing(x, y, radius * 0.48, '#FFFFFF', 0.22);
    this.emitRing(x, y, radius * 0.82, '#FDE047', 0.34);
    this.emitRing(x, y, radius * 1.15, accentColor, 0.44);

    // Incandescent fireball plume
    const fireColors = ['#FFFFFF', '#FEF08A', '#FB923C', '#EF4444'];
    for (let i = 0; i < 14; i++) {
      const ang = rng() * Math.PI * 2;
      const spd = 40 + rng() * 210;
      const color = fireColors[Math.floor(rng() * fireColors.length) % fireColors.length];
      this.spawn({
        category: 'fireball',
        x: x + (rng() * 24 - 12),
        y: y + (rng() * 24 - 12),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 40,
        size: 13 + rng() * 16,
        color,
        maxLife: 0.22 + rng() * 0.2,
        gravity: -85,
        drag: 3.1,
        shape: 'circle',
        alpha: 0.92,
      });
    }

    // Billowing dark smoke cloud
    this.emitSmokePuff(x, y, 12, 180, '#334155', rng);

    // Hot flying star sparks & bouncing shrapnel chunks
    for (let i = 0; i < 24; i++) {
      const ang = rng() * Math.PI * 2;
      const spd = 190 + rng() * 440;
      this.spawn({
        category: 'spark',
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 60,
        size: 4 + rng() * 4,
        color: i % 3 === 0 ? '#FFFFFF' : '#FDE047',
        maxLife: 0.26 + rng() * 0.28,
        gravity: 540,
        shape: i % 3 === 0 ? 'star' : 'spark',
        alpha: 1,
      });
    }

    this.emitDebris(x, y, '#64748B', 18, 420, rng);
  }

  /**
   * Emits tumbling multi-colored celebration confetti over a victorious stickman.
   */
  public emitConfettiBurst(
    x: number,
    y: number,
    accentColor: string,
    count = 36,
    rng: () => number = Math.random
  ): void {
    const colors = [
      '#FACC15',
      '#F59E0B',
      '#38BDF8',
      '#10B981',
      '#F43F5E',
      '#A855F7',
      accentColor,
    ];
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI * 0.5 + (rng() * 2 - 1) * 1.25;
      const spd = 250 + rng() * 420;
      const color = colors[Math.floor(rng() * colors.length) % colors.length];
      this.spawn({
        category: 'confetti',
        x: x + (rng() * 32 - 16),
        y: y + (rng() * 16 - 8),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 70,
        size: 5.5 + rng() * 4.5,
        color,
        maxLife: 2.1 + rng() * 1.1,
        gravity: 310,
        drag: 1.6,
        shape: 'confetti',
        alpha: 0.96,
      });
    }
  }

  /**
   * Emits long waving party streamers arcing out over the match champion.
   */
  public emitCelebrationStreamers(
    x: number,
    y: number,
    accentColor: string,
    count = 14,
    rng: () => number = Math.random
  ): void {
    const colors = ['#FACC15', '#38BDF8', '#F43F5E', '#10B981', accentColor];
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI * 0.5 + (rng() * 2 - 1) * 1.05;
      const spd = 310 + rng() * 380;
      const color = colors[Math.floor(rng() * colors.length) % colors.length];
      this.spawn({
        category: 'streamer',
        x: x + (rng() * 22 - 11),
        y: y + (rng() * 12 - 6),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 90,
        size: 15 + rng() * 11,
        color,
        maxLife: 2.1 + rng() * 0.9,
        gravity: 250,
        drag: 1.2,
        shape: 'streamer',
        alpha: 0.95,
      });
    }
  }

  /**
   * High-velocity 'explosive' confetti cannons firing radially out of the winner's limbs.
   */
  public emitLimbExplosiveConfetti(
    emitters: ReadonlyArray<{ x: number; y: number; outAngle: number }>,
    accentColor: string,
    burstPerLimb = 8,
    rng: () => number = Math.random
  ): void {
    const colors = [
      '#FFFFFF',
      '#FACC15',
      '#F59E0B',
      '#38BDF8',
      '#10B981',
      '#F43F5E',
      '#A855F7',
      accentColor,
    ];
    for (let e = 0; e < emitters.length; e++) {
      const limb = emitters[e];
      for (let i = 0; i < burstPerLimb; i++) {
        const ang = limb.outAngle + (rng() * 2 - 1) * 0.58;
        const spd = 460 + rng() * 440;
        const color = colors[Math.floor(rng() * colors.length) % colors.length];
        this.spawn({
          category: 'confetti',
          x: limb.x + (rng() * 6 - 3),
          y: limb.y + (rng() * 6 - 3),
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 90,
          size: 6 + rng() * 4.5,
          color,
          maxLife: 1.65 + rng() * 0.95,
          gravity: 260,
          drag: 2.35,
          shape: 'confetti',
          alpha: 0.98,
        });
      }
      // Crisp muzzle-like celebration sparks right at the limb tip
      for (let s = 0; s < 2; s++) {
        const ang = limb.outAngle + (rng() * 2 - 1) * 0.45;
        const spd = 340 + rng() * 260;
        this.spawn({
          category: 'spark',
          x: limb.x,
          y: limb.y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          size: 3.5 + rng() * 2.5,
          color: s === 0 ? '#FFFFFF' : '#FDE047',
          maxLife: 0.18 + rng() * 0.12,
          gravity: 160,
          shape: 'spark',
          alpha: 1,
        });
      }
    }
  }

  /**
   * Secondary emitter spawning slow-falling, oversized curling ribbon streamers across the celebration canopy.
   */
  public emitOversizedRibbons(
    x: number,
    y: number,
    accentColor: string,
    count = 10,
    rng: () => number = Math.random
  ): void {
    const colors = ['#FACC15', '#38BDF8', '#F43F5E', '#10B981', '#A855F7', accentColor];
    for (let i = 0; i < count; i++) {
      const color = colors[Math.floor(rng() * colors.length) % colors.length];
      this.spawn({
        category: 'ribbon',
        x: x + (rng() * 260 - 130),
        y: y - 45 - rng() * 85,
        vx: (rng() * 2 - 1) * 155,
        vy: -110 - rng() * 135,
        size: 38 + rng() * 26,
        color,
        maxLife: 3.6 + rng() * 1.4,
        gravity: 92,
        drag: 1.85,
        shape: 'ribbon',
        alpha: 0.95,
      });
    }
  }

  /**
   * Emits bright celebratory aerial firework stars + ring over the champion.
   */
  public emitFireworkBurst(
    x: number,
    y: number,
    accentColor: string,
    scale = 1,
    rng: () => number = Math.random
  ): void {
    const colors = ['#FFFFFF', '#FDE047', '#38BDF8', '#F43F5E', '#A855F7', accentColor];
    const burstColor = colors[Math.floor(rng() * colors.length) % colors.length];
    this.emitRing(x, y, 42 * scale, burstColor, 0.35);
    const count = Math.max(10, Math.round(20 * scale));
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (rng() * 0.2 - 0.1);
      const spd = (150 + rng() * 210) * scale;
      this.spawn({
        category: 'firework',
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 5 + rng() * 3.5,
        color: i % 3 === 0 ? '#FFFFFF' : burstColor,
        maxLife: 0.45 + rng() * 0.35,
        gravity: 190,
        drag: 2.2,
        shape: 'star',
        alpha: 1,
      });
    }
  }

  public emitVictoryCelebration(
    x: number,
    y: number,
    accentColor: string,
    scale = 1,
    rng: () => number = Math.random
  ): void {
    this.emitConfettiBurst(x, y, accentColor, Math.max(10, Math.round(42 * scale)), rng);
    this.emitCelebrationStreamers(x, y, accentColor, Math.max(4, Math.round(14 * scale)), rng);
    this.emitFireworkBurst(
      x + (rng() * 140 - 70),
      y - 75 - rng() * 55,
      accentColor,
      scale * 0.9,
      rng
    );
  }

  public update(dt: number, platforms: ReadonlyArray<Platform>): void {
    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;

      pt.life -= dt;
      if (pt.life <= 0) {
        pt.active = false;
        continue;
      }

      if (pt.drag > 0) {
        const damp = Math.max(0, 1 - pt.drag * dt);
        pt.vx *= damp;
      }
      pt.vy += pt.gravity * dt;

      if (pt.category === 'ribbon') {
        pt.vx += Math.sin(pt.life * 4.2 + pt.rot) * 145 * dt;
        if (pt.vy > 68) pt.vy = 68;
      } else if (pt.category === 'confetti' || pt.category === 'streamer') {
        pt.vx += Math.sin(pt.life * 9 + pt.rot) * 115 * dt;
        if (pt.vy > 145) pt.vy = 145;
      }

      const prevX = pt.x;
      const prevY = pt.y;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.rot += pt.rotVel * dt;

      // Surface interaction for blood droplets (paint decal) and debris/casings (bounce)
      if (pt.paintDecalOnHit || pt.bounce > 0) {
        for (let j = 0; j < platforms.length; j++) {
          const plat = platforms[j];
          if (plat.kind === 'destructible' && (plat.hp ?? 1) <= 0) continue;
          if (plat.kind === 'oneway' && pt.vy < 0) continue;

          if (
            pt.x >= plat.x &&
            pt.x <= plat.x + plat.w &&
            pt.y >= plat.y &&
            pt.y <= plat.y + plat.h
          ) {
            let edge: SurfaceDecal['edge'] = 'top';
            if (prevY <= plat.y + 4) {
              edge = 'top';
              pt.y = plat.y;
            } else if (prevX <= plat.x + 4 && plat.kind !== 'oneway') {
              edge = 'left';
              pt.x = plat.x;
            } else if (prevX >= plat.x + plat.w - 4 && plat.kind !== 'oneway') {
              edge = 'right';
              pt.x = plat.x + plat.w;
            } else if (plat.kind === 'oneway') {
              continue;
            }

            if (pt.paintDecalOnHit) {
              this.addDecal(plat, pt.x, pt.y, pt.color, edge, pt.size);
              pt.active = false;
            } else if (pt.bounce > 0) {
              if (edge === 'top') {
                pt.vy = -Math.abs(pt.vy) * pt.bounce;
                pt.vx *= 0.72;
              } else {
                pt.vx = -pt.vx * pt.bounce;
              }
            }
            break;
          }
        }
      }
    }
  }
}
