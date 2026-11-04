// Audio sample helpers shared by the browser app and the Node tests.
// The Live API wants 16 kHz, 16-bit, little-endian mono PCM and returns 24 kHz PCM.

export function floatTo16BitPCM(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    let s = f32[i];
    if (!(s === s)) s = 0; // NaN guard
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

// Box-filter downsampling: each output sample is the mean of the input samples it covers.
// Good enough for speech and keeps CPU use tiny on phones.
export function downsampleTo16k(input, inRate) {
  const target = 16000;
  if (inRate === target) return input;
  if (inRate < target) {
    const ratio = inRate / target;
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const x = i * ratio;
      const i0 = Math.floor(x);
      const f = x - i0;
      const a = input[i0] ?? 0;
      const b = input[i0 + 1] ?? a;
      out[i] = a + (b - a) * f;
    }
    return out;
  }
  const ratio = inRate / target;
  const outLen = Math.floor(input.length / ratio + 1e-9);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio + 1e-9);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio + 1e-9));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < input.length; j++) {
      sum += input[j];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

export function int16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

export function base64ToInt16(b64) {
  const bin = atob(b64);
  const len = bin.length - (bin.length % 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export function pcm16ToFloat32(int16) {
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
  return out;
}

// Root-mean-square level of a block, 0..1, for the speaking meters.
export function rms(f32) {
  if (!f32 || !f32.length) return 0;
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  return Math.sqrt(sum / f32.length);
}
