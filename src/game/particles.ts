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

  constructor(particleCapacity = 260, decalCapacity = 140) {
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
      d.rx = size * (1.2 + Math.random() * 0.9);
      d.ry = Math.max(2.5, size * 0.42);
    } else if (edge === 'left') {
      d.offsetX = 0;
      d.offsetY = Math.max(4, Math.min(platform.h - 4, worldY - platform.y));
      d.rx = Math.max(2.5, size * 0.45);
      d.ry = size * (1.1 + Math.random() * 0.7);
    } else {
      d.offsetX = platform.w;
      d.offsetY = Math.max(4, Math.min(platform.h - 4, worldY - platform.y));
      d.rx = Math.max(2.5, size * 0.45);
      d.ry = size * (1.1 + Math.random() * 0.7);
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
    const count = Math.round(10 * intensity);
    const baseAngle = dirX >= 0 ? -0.35 : Math.PI + 0.35;
    for (let i = 0; i < count; i++) {
      const spread = (rng() * 2 - 1) * 1.15;
      const ang = baseAngle + spread;
      const spd = (170 + rng() * 340) * (0.7 + intensity * 0.35);
      this.spawn({
        category: 'blood',
        x: x + (rng() * 8 - 4),
        y: y + (rng() * 12 - 6),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 65,
        size: 3 + rng() * 3.8,
        color,
        maxLife: 0.55 + rng() * 0.45,
        gravity: 1120,
        drag: 0.4,
        shape: 'droplet',
        alpha: 0.95,
        paintDecalOnHit: true,
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
