// Builds the instructions sent to the Live model and the feedback model.

export function buildSystemPrompt(scenario, profile = {}, opts = {}) {
  const p = scenario.persona;
  const name = (profile && typeof profile.name === 'string' && profile.name.trim()) || '';
  const bio = (profile && typeof profile.bio === 'string' && profile.bio.trim()) || '';
  const weak = Array.isArray(opts.weakPoints) ? opts.weakPoints.filter(w => typeof w === 'string' && w.trim()) : [];
  const learner = name ? `${name}. ${bio}`.trim() : `the learner. ${bio}`.trim();
  const lines = [
    `This is a live English speaking practice role-play over a ${scenario.mode === 'phone' ? 'phone call' : 'video call'}.`,
    `YOUR ROLE: You are ${p.name}, ${p.role} at ${p.company}. ${p.style || ''}`.trim(),
    `SCENE: ${scenario.sceneEn}`,
    `THE LEARNER: ${learner} He is a native Korean speaker with basic conversational English.${name ? ' Address him by his first name or as you naturally would.' : ''}`,
    `HIS GOAL TODAY: ${scenario.goalEn}`,
    'HOW TO TALK:',
    opts.slow
      ? '- Speak clearly and a little slowly, with simple everyday words, as you would with a non-native colleague.'
      : '- Speak natural American English at a normal business pace.',
    '- Keep each turn short: one or two sentences, then let him talk. Ask one question at a time.',
    '- Stay in character and use realistic details such as names, numbers and dates.',
    '- If he pauses, wait patiently. Do not finish his sentences for him.',
    '- If he speaks Korean to ask how to say something, step out of the role for a moment: give one natural English sentence he can use, ask him to say it, then continue the scene.',
    '- Do not correct his English during the scene and do not give feedback unless he asks for it.',
    '- Text in square brackets is a coach note from the practice app, not part of the conversation. Follow it without mentioning it.',
    scenario.extraEn ? `- ${scenario.extraEn}` : null,
    weak.length ? `- Give him chances to practice these weak points: ${weak.join('; ')}.` : null,
    `OPENING: When the call connects, start with a line like: "${scenario.openingEn}"`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildCustomScenario(descKo, mode = 'video') {
  const desc = String(descKo || '').trim();
  return {
    id: `custom-${Date.now()}`,
    day: 0,
    mode: mode === 'phone' ? 'phone' : 'video',
    signEn: 'CUSTOM CALL',
    captionsDefault: true,
    minutes: 8,
    titleKo: '직접 만든 상황',
    situationKo: desc,
    goalKo: '실제 상황처럼 자연스럽게 대화하기',
    sceneEn: `The learner described a real upcoming situation in Korean: "${desc}". Understand it, choose the most likely counterpart, and play that person realistically. Prepare the questions this person would really ask.`,
    goalEn: 'Handle this real situation smoothly and confidently.',
    openingEn: mode === 'phone' ? 'Hello, thanks for calling. How can I help you today?' : 'Hi, thanks for joining the call today. Shall we get started?',
    keyPhrases: ['Thank you for your time today.', 'Could you tell me a bit more about that?', 'Let me summarize what we discussed.'],
    persona: { name: 'Jordan Miller', role: 'the other person in this situation', company: 'a US company', voice: 'Achird', style: 'Professional, friendly and realistic.', initials: 'JM', tint: '#3B4A5C' },
  };
}

export function buildFeedbackPrompt(scenario, transcript) {
  const lines = (transcript || [])
    .filter(t => t && typeof t.text === 'string' && t.text.trim())
    .map(t => `${t.who === 'me' ? 'ME' : 'AI'}: ${t.text.trim()}`);
  return [
    'You are an English speaking coach for a Korean professional with basic conversational English.',
    'Analyze the role-play transcript below. ME lines come from automatic speech recognition and may contain recognition errors, so ignore obvious recognition mistakes and focus on real speaking problems.',
    'Write every Korean field in friendly, plain Korean (polite form, short sentences). Keep English examples natural, short and useful in business.',
    'Scores are integers from 0 to 10: fluency (speaking without long stops), clarity (meaning gets across), listening (understood the other person and answered the actual question), task (achieved the goal).',
    'summary_ko: two sentences, first what went well, then the single most important fix.',
    'corrections: up to three of his most important mistakes. you_said is a short exact quote of his line, better is a natural version, why_ko is one short Korean sentence.',
    'phrases: five phrases for this situation that he should memorize, each with a Korean meaning.',
    'next_focus_ko: one concrete thing to practice next time.',
    'If he barely spoke, say so kindly and give low scores for fluency and task.',
    '',
    `Scenario: ${scenario.sceneEn}`,
    `Goal: ${scenario.goalEn}`,
    '',
    'Transcript:',
    ...lines,
  ].join('\n');
}

// Latest corrections first, as short English practice targets for the next role-play.
export function weakPointsFrom(sessions, max = 3) {
  const out = [];
  const list = Array.isArray(sessions) ? sessions : [];
  for (let i = list.length - 1; i >= 0 && out.length < max; i--) {
    const cs = list[i] && list[i].feedback && Array.isArray(list[i].feedback.corrections) ? list[i].feedback.corrections : [];
    for (const c of cs) {
      if (out.length >= max) break;
      const better = c && typeof c.better === 'string' ? c.better.trim() : '';
      const said = c && typeof c.you_said === 'string' ? c.you_said.trim() : '';
      if (!better) continue;
      out.push(said ? `say "${better}" instead of "${said}"` : `say "${better}"`);
    }
  }
  return out;
}
