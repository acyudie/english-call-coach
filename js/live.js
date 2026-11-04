// Minimal Gemini Live API client over a raw WebSocket (browser).
// Events: status, audio, inputText, outputText, turnComplete, interrupted, error

const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const LIVE_MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview'];

export class LiveSession extends EventTarget {
  constructor({ apiKey, model = LIVE_MODELS[0], systemPrompt, voice = 'Kore', silenceMs = 1000 }) {
    super();
    Object.assign(this, { apiKey, model, systemPrompt, voice, silenceMs });
    this.ws = null;
    this.handle = null;
    this.ready = false;
    this.closedByUser = false;
    this.reconnects = 0;
    this.decoder = new TextDecoder();
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setupMessage() {
    return {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
        },
        systemInstruction: { parts: [{ text: this.systemPrompt }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: { slidingWindow: {} },
        sessionResumption: this.handle ? { handle: this.handle } : {},
        realtimeInputConfig: { automaticActivityDetection: { silenceDurationMs: this.silenceMs, prefixPaddingMs: 300 } },
      },
    };
  }

  // Resolves once the server accepted the setup.
  connect() {
    return new Promise((resolve, reject) => {
      this.ready = false;
      this.emit('status', this.handle ? 'reconnecting' : 'connecting');
      const ws = new WebSocket(`${WS_BASE}?key=${encodeURIComponent(this.apiKey)}`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let settled = false;
      ws.onopen = () => ws.send(JSON.stringify(this.setupMessage()));
      ws.onmessage = ev => {
        let msg;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : this.decoder.decode(ev.data));
        } catch {
          return;
        }
        if (msg.setupComplete) {
          this.ready = true;
          if (!settled) { settled = true; resolve(); }
          this.emit('status', 'live');
          return;
        }
        this.handleMessage(msg);
      };
      ws.onerror = () => { /* details arrive in onclose */ };
      ws.onclose = ev => {
        const wasReady = this.ready;
        this.ready = false;
        if (!settled) {
          settled = true;
          reject(Object.assign(new Error(ev.reason || `connection closed (${ev.code})`), { code: ev.code }));
          return;
        }
        if (this.closedByUser) { this.emit('status', 'closed'); return; }
        // Server rotates connections (~10 min). Resume the same conversation if we can.
        if (wasReady && this.handle && this.reconnects < 5) {
          this.reconnects++;
          this.connect().catch(err => this.emit('error', err));
          return;
        }
        this.emit('error', Object.assign(new Error(ev.reason || `connection closed (${ev.code})`), { code: ev.code }));
        this.emit('status', 'closed');
      };
    });
  }

  handleMessage(msg) {
    if (msg.sessionResumptionUpdate) {
      const u = msg.sessionResumptionUpdate;
      if (u.resumable && u.newHandle) this.handle = u.newHandle;
    }
    if (msg.goAway) {
      // Reconnect early with the latest handle so the learner does not notice.
      if (this.handle && this.ws) {
        const old = this.ws;
        this.ws = null;
        this.ready = false;
        old.onclose = null;
        try { old.close(); } catch { /* ignore */ }
        this.reconnects++;
        this.connect().catch(err => this.emit('error', err));
      }
      return;
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) this.emit('interrupted');
    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data) this.emit('audio', part.inlineData.data);
    }
    if (sc.inputTranscription?.text) this.emit('inputText', sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.emit('outputText', sc.outputTranscription.text);
    if (sc.turnComplete) this.emit('turnComplete');
  }

  send(obj) {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  sendAudio(b64) {
    return this.send({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } } });
  }

  // Coach notes and the opening cue. turnComplete=true asks the model to answer now.
  sendNote(text, turnComplete = true) {
    return this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete } });
  }

  close() {
    this.closedByUser = true;
    if (this.ws) {
      try { this.ws.close(1000, 'done'); } catch { /* ignore */ }
    }
  }
}

// Turn raw close reasons into plain Korean the learner can act on.
export function explainLiveError(err) {
  const r = String((err && err.message) || '');
  if (/api key|API_KEY|permission|unauthori[sz]ed|PERMISSION_DENIED/i.test(r)) return 'API 키가 맞지 않아요. 설정에서 키를 다시 넣어 주세요.';
  if (/quota|RESOURCE_EXHAUSTED|rate/i.test(r)) return '오늘 무료 사용량을 다 썼거나 잠시 요청이 많아요. 몇 분 뒤 다시 걸어 주세요.';
  if (/not found|not supported|model/i.test(r)) return '음성 모델에 연결하지 못했어요. 다른 모델로 다시 시도해요.';
  if (/1006|network|offline/i.test(r) || (err && err.code === 1006)) return '인터넷 연결이 끊겼어요. 와이파이나 데이터를 확인하고 다시 걸어 주세요.';
  return `연결이 끊겼어요 (${r || '원인 미상'}). 다시 걸어 주세요.`;
}
