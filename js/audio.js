// Microphone capture (16 kHz PCM chunks) and gapless playback of 24 kHz model audio.
import { downsampleTo16k, floatTo16BitPCM, int16ToBase64, base64ToInt16, pcm16ToFloat32, rms } from './pcm.js?v=202611042320';

const CHUNK_SAMPLES = 1600; // 100 ms at 16 kHz

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.micStream = null;
    this.node = null;
    this.onChunk = null; // (base64) => void
    this.micLevel = 0;
    this.sources = [];
    this.nextTime = 0;
    this.pending = new Float32Array(0);
    this.muted = false;
  }

  // Must be called from a tap/click handler (iOS needs a user gesture).
  async init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.outAnalyser = this.ctx.createAnalyser();
    this.outAnalyser.fftSize = 512;
    this.outGain = this.ctx.createGain();
    if (this.silent) this.outGain.gain.value = 0; // test mode: keep the speaker quiet
    this.outAnalyser.connect(this.outGain);
    this.outGain.connect(this.ctx.destination);
    this.levelBuf = new Float32Array(this.outAnalyser.fftSize);
    await this.ctx.audioWorklet.addModule(new URL('./worklet-recorder.js?v=202611042320', import.meta.url));
  }

  async startMic(fake = false) {
    if (fake) {
      // Test mode without a microphone: a silent source keeps the pipeline running.
      const silent = this.ctx.createConstantSource();
      silent.offset.value = 0;
      silent.start();
      this.node = new AudioWorkletNode(this.ctx, 'ecc-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const sink0 = this.ctx.createGain();
      sink0.gain.value = 0;
      silent.connect(this.node);
      this.node.connect(sink0);
      sink0.connect(this.ctx.destination);
      this.node.port.onmessage = e => this._onFrames(e.data);
      return;
    }
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const src = this.ctx.createMediaStreamSource(this.micStream);
    this.node = new AudioWorkletNode(this.ctx, 'ecc-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const sink = this.ctx.createGain();
    sink.gain.value = 0; // keeps the worklet running without echoing the mic
    src.connect(this.node);
    this.node.connect(sink);
    sink.connect(this.ctx.destination);
    this.node.port.onmessage = e => this._onFrames(e.data);
  }

  // Feed pre-recorded 16 kHz PCM (test mode) through the same path as the mic.
  injectPcm16k(int16) {
    const f = pcm16ToFloat32(int16);
    for (let i = 0; i < f.length; i += CHUNK_SAMPLES) {
      const part = floatTo16BitPCM(f.subarray(i, i + CHUNK_SAMPLES));
      if (this.onChunk) this.onChunk(int16ToBase64(part), true);
    }
  }

  _onFrames(f32) {
    this.micLevel = this.muted ? 0 : rms(f32);
    const down = downsampleTo16k(f32, this.ctx.sampleRate);
    const merged = new Float32Array(this.pending.length + down.length);
    merged.set(this.pending);
    merged.set(down, this.pending.length);
    let off = 0;
    while (merged.length - off >= CHUNK_SAMPLES) {
      const block = merged.subarray(off, off + CHUNK_SAMPLES);
      off += CHUNK_SAMPLES;
      if (!this.muted && this.onChunk) this.onChunk(int16ToBase64(floatTo16BitPCM(block)), false);
    }
    this.pending = merged.slice(off);
  }

  play(base64Pcm24k) {
    if (!this.ctx) return;
    const f32 = pcm16ToFloat32(base64ToInt16(base64Pcm24k));
    if (!f32.length) return;
    const buf = this.ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outAnalyser);
    const now = this.ctx.currentTime;
    if (this.nextTime < now + 0.02) this.nextTime = now + 0.05;
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter(s => s !== src);
    };
  }

  // True while model audio is queued or playing (plus a short tail for room echo).
  isPlaying(tailSec = 0.35) {
    return !!this.ctx && this.nextTime + tailSec > this.ctx.currentTime && this.sources.length > 0;
  }

  stopPlayback() {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.sources = [];
    this.nextTime = 0;
  }

  outputLevel() {
    if (!this.outAnalyser) return 0;
    this.outAnalyser.getFloatTimeDomainData(this.levelBuf);
    return rms(this.levelBuf);
  }

  async close() {
    this.stopPlayback();
    if (this.micStream) this.micStream.getTracks().forEach(t => t.stop());
    this.micStream = null;
    if (this.node) this.node.port.onmessage = null;
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close();
    this.ctx = null;
  }
}
