class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(m: boolean): void {
    this.muted = m;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private getCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) this.unlock();
    if (!this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private pitchJitter(base: number, pct = 0.08): number {
    return base * (1 + (Math.random() * 2 - 1) * pct);
  }

  public playJump(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const f = this.pitchJitter(210);
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 2.1, t + 0.09);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  public playLand(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(this.pitchJitter(110), t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.06);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  public playPunch(heavy = false): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Low body thud
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = heavy ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(this.pitchJitter(heavy ? 210 : 260), t);
    osc.frequency.exponentialRampToValueAtTime(heavy ? 38 : 68, t + (heavy ? 0.16 : 0.09));
    gain.gain.setValueAtTime(heavy ? 0.24 : 0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.18 : 0.1));
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + (heavy ? 0.19 : 0.11));

    // Crisp slap/crunch transient
    const dur = heavy ? 0.11 : 0.055;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.25));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = heavy ? 1400 : 2100;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(heavy ? 0.18 : 0.09, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(bp).connect(ng).connect(ctx.destination);
    noise.start(t);
  }

  public playParry(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(this.pitchJitter(freq, 0.04), t + i * 0.02);
      gain.gain.setValueAtTime(0.12, t + i * 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.02);
      osc.stop(t + 0.23);
    });
  }

  public playShoot(weapon: 'pistol' | 'shotgun' | 'smg' | 'rocket' | 'laser' | 'katana'): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;

    if (weapon === 'laser') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(980, t);
      osc.frequency.exponentialRampToValueAtTime(160, t + 0.18);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
      return;
    }

    if (weapon === 'katana') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(this.pitchJitter(620), t);
      osc.frequency.exponentialRampToValueAtTime(190, t + 0.11);
      gain.gain.setValueAtTime(0.11, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
      return;
    }

    // Noise burst + punchy transient for firearms
    const duration = weapon === 'shotgun' ? 0.18 : weapon === 'rocket' ? 0.22 : 0.08;
    const bufSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.35));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = weapon === 'shotgun' ? 950 : weapon === 'rocket' ? 600 : 1800;

    const gain = ctx.createGain();
    const vol = weapon === 'shotgun' ? 0.22 : weapon === 'smg' ? 0.1 : 0.15;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    if (weapon === 'shotgun' || weapon === 'rocket') {
      const sub = ctx.createOscillator();
      const sg = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(weapon === 'rocket' ? 140 : 170, t);
      sub.frequency.exponentialRampToValueAtTime(42, t + 0.14);
      sg.gain.setValueAtTime(0.22, t);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      sub.connect(sg).connect(ctx.destination);
      sub.start(t);
      sub.stop(t + 0.16);
    }

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t);
  }

  public playExplosion(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;

    // Deep sub-bass concussion punch
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(135, t);
    sub.frequency.exponentialRampToValueAtTime(26, t + 0.42);
    sg.gain.setValueAtTime(0.36, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.44);
    sub.connect(sg).connect(ctx.destination);
    sub.start(t);
    sub.stop(t + 0.45);

    // Roaring lowpass explosion tail
    const duration = 0.46;
    const bufSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.28));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1250, t);
    filter.frequency.exponentialRampToValueAtTime(85, t + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.34, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t);
  }

  public playCrateBreak(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const duration = 0.16;
    const bufSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.32));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 720;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t);
  }

  public playPickup(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.05);
      gain.gain.setValueAtTime(0.09, t + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.05 + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + idx * 0.05);
      osc.stop(t + idx * 0.05 + 0.13);
    });
  }

  public playKO(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(215, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.38);
    gain.gain.setValueAtTime(0.26, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.44);

    // Sub impact boom
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, t);
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.25);
    sg.gain.setValueAtTime(0.28, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.27);
    sub.connect(sg).connect(ctx.destination);
    sub.start(t);
    sub.stop(t + 0.28);
  }

  public playFirework(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const duration = 0.14;
    const bufSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.25));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.11, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(t);
  }

  public playVictory(): void {
    const ctx = this.getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + i * 0.08);
      gain.gain.setValueAtTime(0.13, t + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.32);
    });
  }
}

export const sound = new SoundEngine();
