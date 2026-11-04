// Merges streaming transcription deltas into alternating speaker lines.
// Learner recognition often arrives a moment after the AI has started answering;
// that late text belongs to the learner line just before the AI line.

export class TranscriptBuilder {
  constructor() {
    this.lines = [];
    this.aiOpen = false;
  }

  addAi(text) {
    const last = this.lines[this.lines.length - 1];
    if (this.aiOpen && last && last.who === 'ai') last.text += text;
    else {
      this.lines.push({ who: 'ai', text });
      this.aiOpen = true;
    }
  }

  addMe(text) {
    const n = this.lines.length;
    const last = this.lines[n - 1];
    if (this.aiOpen && last && last.who === 'ai') {
      const prev = this.lines[n - 2];
      if (prev && prev.who === 'me') prev.text += text;
      else this.lines.splice(n - 1, 0, { who: 'me', text });
      return;
    }
    if (last && last.who === 'me') last.text += text;
    else this.lines.push({ who: 'me', text });
  }

  closeAi() {
    this.aiOpen = false;
  }

  toArray() {
    return this.lines.map(l => ({ who: l.who, text: l.text.replace(/\s+/g, ' ').trim() })).filter(l => l.text);
  }

  wordCount(who) {
    return this.toArray()
      .filter(l => l.who === who)
      .reduce((a, l) => a + l.text.split(/\s+/).filter(Boolean).length, 0);
  }
}
