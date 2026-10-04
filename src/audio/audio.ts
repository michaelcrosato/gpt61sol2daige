import { SAMPLE_RATE, type SoundName, synthesize } from "./synth.ts";

export class AudioEngine {
  enabled = false;
  context?: AudioContext;
  gain?: GainNode;
  music?: AudioBufferSourceNode;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  private readonly lastPlayed = new Map<SoundName, number>();
  private voices = 0;
  async toggle(): Promise<boolean> {
    this.enabled = !this.enabled;
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = 0.5;
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -18;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.gain.connect(limiter);
      limiter.connect(this.context.destination);
    }
    await this.context.resume();
    this.gain!.gain.setTargetAtTime(this.enabled ? 0.5 : 0, this.context.currentTime, 0.1);
    if (this.enabled && !this.music) {
      this.music = this.play("ambient");
      if (this.music) this.music.loop = true;
    }
    return this.enabled;
  }
  play(name: SoundName): AudioBufferSourceNode | undefined {
    if (!this.enabled || !this.context || !this.gain) return;
    const now = this.context.currentTime;
    if (
      this.voices >= 24 ||
      now - (this.lastPlayed.get(name) ?? -Infinity) < (name === "hit" ? 0.055 : 0.08)
    )
      return;
    this.lastPlayed.set(name, now);
    let buffer = this.buffers.get(name);
    if (!buffer) {
      const samples = synthesize(name);
      buffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(new Float32Array(samples), 0);
      this.buffers.set(name, buffer);
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    this.voices++;
    source.onended = () => {
      this.voices--;
    };
    source.start();
    return source;
  }
}
