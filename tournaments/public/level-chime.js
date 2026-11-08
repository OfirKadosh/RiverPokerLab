// Play only a naturally elapsed level on the current clock anchor.
export function crossedLevel(previous, current, anchor) {
  const segment = previous?.view.segment;
  return Boolean(previous?.anchor === anchor && anchor !== null &&
    previous.view.state === 'level' && segment?.type === 'level' &&
    previous.view.elapsed < segment.end && current.elapsed >= segment.end &&
    current.elapsed - segment.end <= 2000 && current.state !== 'finished');
}

export function connectLevelChime(button) {
  let context;
  let enabled = false;
  let disposed = false;
  button.addEventListener('click', async () => {
    if (enabled) {
      enabled = false;
      button.setAttribute('aria-pressed', 'false');
      return;
    }
    button.disabled = true;
    try {
      const Audio = window.AudioContext ?? window.webkitAudioContext;
      if (!Audio) throw new Error('Audio unavailable');
      context ??= new Audio();
      await context.resume();
      if (disposed) return;
      enabled = context.state === 'running';
      button.setAttribute('aria-pressed', String(enabled));
    } catch {
      if (!disposed) button.textContent = 'צליל אינו זמין בדפדפן';
    } finally {
      if (!disposed) button.disabled = false;
    }
  });
  return {
    play() {
      if (!enabled || context?.state !== 'running') return;
      const start = context.currentTime;
      for (const [index, frequency] of [660, 880].entries()) {
        const note = context.createOscillator();
        const volume = context.createGain();
        const time = start + index * .12;
        note.frequency.value = frequency;
        volume.gain.setValueAtTime(.001, time);
        volume.gain.exponentialRampToValueAtTime(.12, time + .015);
        volume.gain.exponentialRampToValueAtTime(.001, time + .19);
        note.connect(volume);
        volume.connect(context.destination);
        note.start(time);
        note.stop(time + .2);
        note.onended = () => { note.disconnect(); volume.disconnect(); };
      }
    },
    dispose() {
      disposed = true;
      enabled = false;
      if (context && context.state !== 'closed') context.close().catch(() => {});
    },
  };
}
