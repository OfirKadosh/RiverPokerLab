const legacyKey = 'river-tournaments-setup-v1';
const key = 'river-tournaments-list-v2';

function readAll() {
  const saved = localStorage.getItem(key);
  if (saved !== null) return JSON.parse(saved);
  const legacy = JSON.parse(localStorage.getItem(legacyKey));
  return legacy?.version === 1 ? [{ ...legacy, id: legacy.id ?? 'legacy' }] : [];
}

export function tournamentOptions() {
  return readAll().map(({ id, title, status }) => ({ id, title, status }));
}

export function tournamentId() {
  const selected = sessionStorage.getItem(key);
  return selected ?? readAll().at(-1)?.id ?? 'new';
}

export function selectTournament(id) {
  if (id === 'new' || readAll().some((item) => item.id === id)) sessionStorage.setItem(key, id);
}

export function tournamentLink(route) {
  return '#' + route + '?t=' + encodeURIComponent(tournamentId());
}

export function readTournament() {
  const id = tournamentId();
  return readAll().find((item) => item.id === id) ?? null;
}

let pending = 0;
let loadingTimer;

export async function updateTournament(change) {
  if (!navigator.locks) throw new Error('נדרש דפדפן שתומך בנעילת אחסון מקומי.');
  const id = tournamentId();
  const indicator = document.querySelector('#work-progress');
  if (pending++ === 0) loadingTimer = setTimeout(() => { indicator.hidden = false; }, 120);
  try {
    return await navigator.locks.request(key, () => {
      const all = readAll();
      const index = all.findIndex((item) => item.id === id);
      const current = all[index] ?? null;
      const next = change(current);
      next.id = current?.id ?? next.id ?? crypto.randomUUID();
      if (index < 0) all.push(next);
      else all[index] = next;
      localStorage.setItem(key, JSON.stringify(all));
      if (!current && tournamentId() === id) selectTournament(next.id);
      return next;
    });
  } finally {
    if (--pending === 0) {
      clearTimeout(loadingTimer);
      indicator.hidden = true;
    }
  }
}

export function watchTournament(listener) {
  const onStorage = (event) => {
    if ([key, legacyKey, null].includes(event.key)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
