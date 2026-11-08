const key = 'river-tournaments-setup-v1';

export function readTournament() {
  const value = JSON.parse(localStorage.getItem(key));
  return value?.version === 1 ? value : null;
}

export function updateTournament(change) {
  if (!navigator.locks) throw new Error('נדרש דפדפן שתומך בנעילת אחסון מקומי.');
  return navigator.locks.request(key, () => {
    const next = change(readTournament());
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  });
}

export function watchTournament(listener) {
  const onStorage = (event) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
