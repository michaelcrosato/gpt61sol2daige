import { SAMPLE_RATE, type SoundName, synthesize } from "./synth.ts";

export class AudioEngine {
  enabled = false;
  context?: AudioContext;
  gain?: GainNode;
  music?: AudioBufferSourceNode;
  private readonly buffers = new Map<SoundName, AudioBuffer>();
  async toggle(): Promise<boolean> {
    this.enabled = !this.enabled;
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = 0.5;
      this.gain.connect(this.context.destination);
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
    source.start();
    return source;
  }
}
