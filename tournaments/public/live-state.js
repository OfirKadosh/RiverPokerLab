const minutes = (value) => Number(value) * 60000;

export function schedule(tournament) {
  let elapsed = 0;
  let active = 0;
  const segments = [];
  for (const [index, level] of (tournament?.levels ?? []).entries()) {
    const number = index + 1;
    const length = minutes(level.minutes);
    segments.push({ type: 'level', number, level, start: elapsed, end: elapsed + length, active });
    elapsed += length;
    active += length;
    const breakIndex = (tournament.breaks ?? []).findIndex((item) => Number(item.after) === number);
    if (breakIndex !== -1) {
      const length = minutes(tournament.breaks[breakIndex].minutes);
      segments.push({ type: 'break', number, breakIndex, start: elapsed, end: elapsed + length, active });
      elapsed += length;
    }
  }
  return segments;
}

export function liveView(tournament, now = Date.now()) {
  const segments = schedule(tournament);
  const live = tournament?.live;
  const elapsed = live ? live.elapsed + (live.runningSince === null ? 0 : Math.max(0, now - live.runningSince)) : 0;
  const index = segments.findIndex((segment) => segment.end > elapsed);
  const segment = segments[index];
  const nextLevel = segment && segments.slice(index + 1).find((item) => item.type === 'level');
  const nextBreak = segment && segments.slice(index).find((item) => item.type === 'break');
  const end = segments.at(-1)?.end ?? 0;
  let registrationEnd = 0;
  if (tournament?.lateMode === 'level') {
    registrationEnd = segments.find((item) => item.type === 'level' && item.number === Number(tournament.lateValue))?.end ?? end;
  } else if (tournament?.lateMode === 'minutes') {
    const target = minutes(tournament.lateValue);
    const level = segments.find((item) => item.type === 'level' && item.active + item.end - item.start >= target);
    registrationEnd = level ? level.start + target - level.active : end;
  }
  return {
    elapsed, segment, nextLevel, nextBreak, registrationEnd,
    state: !live ? 'ready' : !segment ? 'complete' : live.runningSince === null ? 'paused' : segment.type,
    registrationOpen: tournament?.status === 'registration' && (!live || (!live.closed && elapsed < registrationEnd)),
  };
}

export function registrationOpen(tournament, now = Date.now()) {
  return tournament?.status === 'registration' && (!tournament.live || liveView(tournament, now).registrationOpen);
}

export function controlLive(tournament, action, now = Date.now(), expectedStart, seconds) {
  if (tournament?.status !== 'registration') throw new Error('יש לפתוח את הטורניר לרישום תחילה.');
  const view = liveView(tournament, now);
  const live = tournament.live;
  if (action === 'start' && !live && view.segment) {
    return { ...tournament, live: { elapsed: 0, runningSince: now } };
  }
  if (!live || !view.segment) throw new Error('אין שלב פעיל לשינוי.');
  if (action === 'pause' && live.runningSince !== null) {
    return { ...tournament, live: { ...live, elapsed: view.elapsed, runningSince: null } };
  }
  if (action === 'resume' && live.runningSince === null) {
    return { ...tournament, live: { ...live, runningSince: now } };
  }
  if ((action === 'next' || action === 'adjust') && view.segment.start !== expectedStart) {
    throw new Error('השלב השתנה. בדקו את השעון ונסו שוב.');
  }
  if (action === 'adjust') {
    const remaining = seconds * 1000;
    if (!Number.isInteger(seconds) || remaining < 1000 || remaining > view.segment.end - view.segment.start) {
      throw new Error('הזמן חייב להיות בין שנייה אחת למשך השלב או ההפסקה.');
    }
    return { ...tournament, live: { ...live, elapsed: view.segment.end - remaining,
      runningSince: live.runningSince === null ? null : now, closed: !view.registrationOpen } };
  }
  if (action === 'next') {
    return { ...tournament, live: { ...live, elapsed: view.segment.end, runningSince: live.runningSince === null ? null : now } };
  }
  throw new Error('מצב השעון כבר השתנה.');
}

export function moveBreak(tournament, index, after, duration, now = Date.now()) {
  const segments = schedule(tournament);
  const original = segments.find((item) => item.type === 'break' && item.breakIndex === index);
  const destination = segments.find((item) => item.type === 'level' && item.number === after);
  const elapsed = liveView(tournament, now).elapsed;
  if (!original || !destination || original.start <= elapsed || destination.end <= elapsed) {
    throw new Error('אפשר לערוך רק הפסקה עתידית.');
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > 180) throw new Error('משך ההפסקה חייב להיות בין 1 ל־180 דקות.');
  if (tournament.breaks.some((item, i) => i !== index && Number(item.after) === after)) {
    throw new Error('כבר נקבעה הפסקה אחרי שלב זה.');
  }
  const changed = { ...tournament, breaks: tournament.breaks.map((item, i) => i === index ? { after, minutes: duration } : item) };
  return changed;
}
