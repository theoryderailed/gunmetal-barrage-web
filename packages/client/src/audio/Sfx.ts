/**
 * Lightweight retro SFX via Web Audio API (no asset files).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopCharge();
  }

  /** Soft UI blip */
  ui(): void {
    this.beep(520, 0.04, "sine", 0.025);
  }

  turnStart(mine: boolean): void {
    if (mine) {
      this.beep(440, 0.08, "square", 0.05);
      setTimeout(() => this.beep(660, 0.1, "square", 0.05), 90);
    } else {
      this.beep(280, 0.1, "triangle", 0.04);
    }
  }

  /**
   * Soft, low charge hum — filtered sine, quiet, gentle rise.
   * (Previous sawtooth ramp was harsh.)
   */
  chargeStart(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    this.stopCharge();

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(90, ctx.currentTime);
    // Gentle climb — stays low so it never shrieks
    osc.frequency.linearRampToValueAtTime(160, ctx.currentTime + 2.0);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(280, ctx.currentTime);
    filter.Q.value = 0.4;

    // Very quiet: ~1.2% peak
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.012, ctx.currentTime + 0.12);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    this.chargeOsc = osc;
    this.chargeGain = gain;
  }

  stopCharge(): void {
    const ctx = this.ctx;
    if (this.chargeOsc && ctx) {
      try {
        this.chargeGain?.gain.cancelScheduledValues(ctx.currentTime);
        this.chargeGain?.gain.setValueAtTime(
          Math.max(0.0001, this.chargeGain.gain.value),
          ctx.currentTime,
        );
        this.chargeGain?.gain.exponentialRampToValueAtTime(
          0.0001,
          ctx.currentTime + 0.06,
        );
        this.chargeOsc.stop(ctx.currentTime + 0.07);
      } catch {
        /* already stopped */
      }
    }
    this.chargeOsc = null;
    this.chargeGain = null;
  }

  fire(power: number): void {
    this.stopCharge();
    const p = Math.max(0.1, Math.min(1, power / 100));
    // Muzzle: short sharp crack + body thump
    this.noiseBurst(0.05 + p * 0.04, 0.1 + p * 0.08, 1200);
    this.beep(70 + p * 30, 0.1, "square", 0.06 + p * 0.04);
  }

  /**
   * Heavy explosion — layered boom (sub thump + mid noise + crack).
   */
  impact(big = false): void {
    const ctx = this.ensure();
    if (!ctx) return;

    const t = ctx.currentTime;
    const scale = big ? 1.35 : 1;

    // 1) Sub bass thump
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(big ? 48 : 65, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.28 * scale);
    subG.gain.setValueAtTime(0.0001, t);
    subG.gain.exponentialRampToValueAtTime(0.22 * scale, t + 0.01);
    subG.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 * scale);
    sub.connect(subG);
    subG.connect(ctx.destination);
    sub.start(t);
    sub.stop(t + 0.4 * scale);

    // 2) Mid body boom (triangle)
    const body = ctx.createOscillator();
    const bodyG = ctx.createGain();
    body.type = "triangle";
    body.frequency.setValueAtTime(big ? 90 : 120, t);
    body.frequency.exponentialRampToValueAtTime(40, t + 0.2 * scale);
    bodyG.gain.setValueAtTime(0.0001, t);
    bodyG.gain.exponentialRampToValueAtTime(0.14 * scale, t + 0.008);
    bodyG.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 * scale);
    body.connect(bodyG);
    bodyG.connect(ctx.destination);
    body.start(t);
    body.stop(t + 0.3 * scale);

    // 3) Noise blast (dirt / shrapnel) — louder + longer + brighter then darker
    this.noiseBurst(0.18 * scale, 0.2 * scale, big ? 1400 : 900);
    // 4) Secondary rumble tail
    setTimeout(() => {
      this.noiseBurst(0.14 * scale, 0.1 * scale, 400);
    }, 40);
    if (big) {
      setTimeout(() => {
        this.beep(55, 0.25, "sine", 0.1);
      }, 30);
    }
  }

  hit(): void {
    this.beep(200, 0.05, "square", 0.06);
    setTimeout(() => this.beep(140, 0.07, "square", 0.05), 40);
  }

  private beep(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
  ): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(Math.max(0.0001, vol), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  private noiseBurst(dur: number, vol: number, lowpassHz = 800): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = 1 - i / len;
      // Slightly pink-ish noise for heavier boom
      data[i] =
        (Math.random() * 2 - 1) * env * env +
        (Math.random() * 2 - 1) * 0.35 * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(lowpassHz, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(80, lowpassHz * 0.25),
      ctx.currentTime + dur,
    );
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, vol), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }
}

export const sfx = new Sfx();
