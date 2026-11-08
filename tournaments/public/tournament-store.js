const key = 'river-tournaments-setup-v1';

export function readTournament() {
  const value = JSON.parse(localStorage.getItem(key));
  return value?.version === 1 ? value : null;
}

let pending = 0;
let loadingTimer;

export async function updateTournament(change) {
  if (!navigator.locks) throw new Error('נדרש דפדפן שתומך בנעילת אחסון מקומי.');
  const indicator = document.querySelector('#work-progress');
  if (pending++ === 0) loadingTimer = setTimeout(() => { indicator.hidden = false; }, 120);
  try {
    return await navigator.locks.request(key, () => {
      const next = change(readTournament());
      localStorage.setItem(key, JSON.stringify(next));
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
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
