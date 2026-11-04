// Progress rules for the 14-day course.

export const MIN_DONE_SEC = 240; // a practice of 4+ minutes counts for the day

export function isDayDone(sessions, day) {
  return (sessions || []).some(s => s && s.day === day && (s.durationSec || 0) >= MIN_DONE_SEC);
}

export function nextDay(sessions, total = 14) {
  for (let d = 1; d <= total; d++) if (!isDayDone(sessions, d)) return d;
  return 0;
}

function dayNum(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function streakDays(sessions, todayYmd) {
  const days = new Set(
    (sessions || [])
      .filter(s => s && (s.durationSec || 0) >= MIN_DONE_SEC && s.date)
      .map(s => dayNum(s.date)),
  );
  if (!days.size) return 0;
  const today = dayNum(todayYmd);
  let cur = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  if (cur === null) return 0;
  let count = 0;
  while (days.has(cur)) {
    count++;
    cur--;
  }
  return count;
}

export function localYmd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
