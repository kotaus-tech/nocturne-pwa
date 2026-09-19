export type AmbientPreset = "off" | "rain" | "wind" | "fire" | "forest";

export interface AmbientSnapshot {
  preset: AmbientPreset;
  volume: number;
}

/**
 * Процедурный эмбиент-синтезатор на Web Audio API.
 * Не требует внешних аудиофайлов — весь звук генерируется на лету (шум + фильтры),
 * что идеально ложится на концепцию полностью автономного PWA.
 *
 * Состояние является глобальным синглтоном и транслируется во все
 * подписанные UI-виджеты (мини-плеер в сайдбаре и полная панель на
 * главном экране) через subscribe/getSnapshot — совместимо с useSyncExternalStore.
 */
export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private nodes: AudioNode[] = [];
  private gainNode: GainNode | null = null;
  private current: AmbientPreset = "off";
  private volume = 0.4;
  private crackleTimer: number | null = null;
  private listeners = new Set<() => void>();
  private snapshot: AmbientSnapshot = { preset: "off", volume: 0.4 };

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return this.ctx;
  }

  private makeNoiseBuffer(ctx: AudioContext) {
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Подписка на изменения состояния (пресет/громкость). Возвращает функцию отписки. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Возвращает кэшированный снапшот состояния.
   * Ссылка меняется только при реальном изменении — обязательное требование
   * useSyncExternalStore во избежание бесконечного цикла обновлений.
   */
  getSnapshot = (): AmbientSnapshot => this.snapshot;

  private updateSnapshot() {
    this.snapshot = { preset: this.current, volume: this.volume };
  }

  private notify() {
    this.updateSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private teardown() {
    this.nodes.forEach((n) => {
      try {
        (n as OscillatorNode | AudioBufferSourceNode).stop?.();
      } catch {
        /* already stopped */
      }
      n.disconnect();
    });
    this.nodes = [];
    if (this.crackleTimer) {
      window.clearInterval(this.crackleTimer);
      this.crackleTimer = null;
    }
    this.gainNode = null;
  }

  stop() {
    this.teardown();
    this.current = "off";
    this.notify();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.gainNode) this.gainNode.gain.value = v;
    this.notify();
  }

  play(preset: AmbientPreset, volume = this.volume) {
    this.teardown();
    this.volume = volume;

    if (preset === "off") {
      this.current = "off";
      this.notify();
      return;
    }

    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") ctx.resume();

    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    this.gainNode = gain;
    this.current = preset;

    if (preset === "rain") {
      const src = ctx.createBufferSource();
      src.buffer = this.makeNoiseBuffer(ctx);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 1200;
      const filter2 = ctx.createBiquadFilter();
      filter2.type = "lowpass";
      filter2.frequency.value = 6000;
      src.connect(filter).connect(filter2).connect(gain);
      src.start();
      this.nodes = [src, filter, filter2];
    } else if (preset === "forest") {
      const src = ctx.createBufferSource();
      src.buffer = this.makeNoiseBuffer(ctx);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
      src.connect(filter).connect(gain);
      src.start();
      this.nodes = [src, filter];
    } else if (preset === "wind") {
      const src = ctx.createBufferSource();
      src.buffer = this.makeNoiseBuffer(ctx);
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 650;
      filter.Q.value = 0.6;

      // Медленное "дыхание" ветра за счёт LFO, модулирующего частоту фильтра.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.12;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();

      src.connect(filter).connect(gain);
      src.start();
      this.nodes = [src, filter, lfo, lfoGain];
    } else if (preset === "fire") {
      const src = ctx.createBufferSource();
      src.buffer = this.makeNoiseBuffer(ctx);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 800;
      const baseGain = ctx.createGain();
      baseGain.gain.value = 0.6;
      src.connect(filter).connect(baseGain).connect(gain);
      src.start();
      this.nodes = [src, filter, baseGain];

      // Периодическое потрескивание — короткие всплески громкости
      this.crackleTimer = window.setInterval(() => {
        if (!this.ctx) return;
        const crackle = this.ctx.createBufferSource();
        crackle.buffer = this.makeNoiseBuffer(this.ctx);
        const cf = this.ctx.createBiquadFilter();
        cf.type = "bandpass";
        cf.frequency.value = 2000 + Math.random() * 2000;
        const cg = this.ctx.createGain();
        cg.gain.value = 0;
        cg.gain.setValueAtTime(0, this.ctx.currentTime);
        cg.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.01);
        cg.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.08);
        crackle.connect(cf).connect(cg).connect(gain);
        crackle.start();
        crackle.stop(this.ctx.currentTime + 0.1);
      }, 350 + Math.random() * 400);
    }

    this.notify();
  }

  getCurrent() {
    return this.current;
  }

  getVolume() {
    return this.volume;
  }
}

export const ambientEngine = new AmbientEngine();