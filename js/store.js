// Everything is stored only in this browser (localStorage). Nothing is sent to a server we run.

const KEY = 'ecc.v1';

const DEFAULTS = {
  settings: {
    apiKey: '',
    profile: { name: '', bio: '' },
    earphones: false, // true = the learner may interrupt the AI (full duplex)
    patience: 'normal', // 'normal' 1.0 s, 'long' 1.6 s of silence before the AI answers
    slow: false,
    camera: true,
  },
  sessions: [],
};

export function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY));
  } catch {
    raw = null;
  }
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    settings: { ...DEFAULTS.settings, ...(s.settings || {}), profile: { ...DEFAULTS.settings.profile, ...((s.settings && s.settings.profile) || {}) } },
    sessions: Array.isArray(s.sessions) ? s.sessions : [],
  };
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

// Setup links carry the key and profile in the URL fragment, which never reaches a web server.
export function encodeSetup(settings) {
  const payload = JSON.stringify({ k: settings.apiKey, n: settings.profile.name, b: settings.profile.bio });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeSetup(token) {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    if (!obj || typeof obj.k !== 'string' || obj.k.length < 20) return null;
    return { apiKey: obj.k, profile: { name: obj.n || '', bio: obj.b || '' } };
  } catch {
    return null;
  }
}
