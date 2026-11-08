import { controlLive, liveView, moveBreak, schedule } from './live-state.js';
import { readTournament, updateTournament, watchTournament } from './tournament-store.js';

function countdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return [Math.floor(seconds / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
}

const numbers = new Intl.NumberFormat('he-IL');
const blinds = (level) => level ? numbers.format(level.small) + ' / ' + numbers.format(level.big) +
  ' · אנטה ' + numbers.format(level.ante) : '—';

export function renderLive(view, intro, floor) {
  const heading = intro(floor ? 'פלור / ניהול חי' : 'תצוגת קהל',
    floor ? 'ניהול טורניר חי' : 'מסך הטורניר', 'השעון והנתונים מתעדכנים בין לשוניות באותו דפדפן.');
  const panel = document.createElement('section');
  panel.className = 'live-panel setup';
  panel.innerHTML = `
    <article class="display-card live-scoreboard">
      <p class="eyebrow" data-live="phase"></p>
      <p class="clock" dir="ltr" data-live="clock"></p>
      <p data-live="blinds"></p>
      <p class="muted" data-live="next"></p>
    </article>
    <div class="grid live-facts">
      <article class="card"><h2>הרשמה מאוחרת</h2><p data-live="registration"></p></article>
      <article class="card"><h2>הפסקה</h2><p data-live="break"></p></article>
      <article class="card"><h2>שחקנים וכניסות</h2><p data-live="entries"></p><p data-live="stack"></p></article>
    </div>`;
  if (floor) panel.insertAdjacentHTML('beforeend', `
    <div class="setup-actions live-actions">
      <button type="button" class="action" data-action="start">התחלת טורניר</button>
      <button type="button" data-action="pause">השהיה</button>
      <button type="button" data-action="resume">המשך</button>
      <button type="button" data-action="next">מעבר לשלב הבא</button>
      <a href="#display" target="_blank" rel="noopener" class="action">פתיחת תצוגת קהל</a>
    </div>
    <form class="card setup-fields" id="adjust-live">
      <label>יתרת זמן בשניות <input name="seconds" type="number" min="1" required></label>
      <button>עדכון שעון</button>
    </form>
    <form class="card setup-fields" id="move-break">
      <label>הפסקה לעריכה <select name="breakIndex" required></select></label>
      <label>אחרי שלב <input name="after" type="number" min="1" required></label>
      <label>משך הפסקה בדקות <input name="minutes" type="number" min="1" max="180" required></label>
      <button>שמירת הפסקה</button>
    </form>
    <p class="notice" role="status"></p>`);
  view.append(heading, panel);
  const find = (selector) => panel.querySelector(selector);
  const message = find('[role=status]');
  const breakForm = find('#move-break');
  const adjust = find('#adjust-live');
  let tournament;
  let current;
  let busy = false;
  let breakOptions = '';

  function tick() {
    current = liveView(tournament);
    const { state, segment, elapsed, nextBreak, nextLevel, registrationEnd, registrationOpen } = current;
    const set = (key, value) => {
      const field = find('[data-live=' + key + ']');
      if (field.textContent !== value) field.textContent = value;
    };
    const phase = segment?.type === 'break' ? 'הפסקה אחרי שלב ' + segment.number : 'שלב ' + segment?.number;
    set('phase', !tournament ? 'ממתין לטורניר' : state === 'complete' ? 'מבנה הבליינדים הסתיים' :
      state === 'ready' ? 'ממתין להתחלה' : state === 'paused' ? phase + ' · מושהה' : phase);
    set('clock', segment ? countdown(segment.end - elapsed) : '00:00');
    set('blinds', segment?.type === 'break' ? 'בהפסקה' : blinds(segment?.level));
    set('next', nextLevel ? 'בליינדים בשלב הבא: ' + blinds(nextLevel.level) : '');
    set('registration', registrationOpen ? (state === 'ready' ? 'פתוחה · הטורניר טרם התחיל' :
      'נסגרת בעוד ' + countdown(registrationEnd - elapsed)) : 'סגורה');
    set('break', nextBreak ? nextBreak === segment ? 'חזרה בעוד ' + countdown(segment.end - elapsed) :
      'אחרי שלב ' + nextBreak.number + ' · בעוד ' + countdown(nextBreak.start - elapsed) : 'אין הפסקה מתוכננת');
    const players = tournament?.players ?? [];
    const entries = tournament?.entries ?? [];
    const active = players.filter((player) => player.table != null).length;
    set('entries', active + ' פעילים מתוך ' + players.length + ' שחקנים · ' + entries.length + ' כניסות · ' +
      entries.filter((entry) => entry.kind === 'reentry').length + ' חוזרות');
    set('stack', active && Number(tournament.stack) ? 'ערימה ממוצעת: ' +
      numbers.format(Math.round(entries.length * Number(tournament.stack) / active)) : '');
    if (!floor) return;
    for (const button of panel.querySelectorAll('[data-action]')) {
      const allowed = {
        start: state === 'ready' && tournament?.status === 'registration' && segment,
        pause: state === 'level' || state === 'break',
        resume: state === 'paused',
        next: state !== 'ready' && segment,
      };
      button.disabled = busy || !allowed[button.dataset.action];
    }
    adjust.querySelector('button').disabled = busy || state === 'ready' || !segment;
    adjust.elements.seconds.max = segment ? Math.floor((segment.end - segment.start) / 1000) : 1;
    const upcoming = schedule(tournament).filter((item) => item.type === 'break' && item.start > elapsed);
    const options = JSON.stringify(upcoming.map((item) => [item.breakIndex, item.number]));
    if (options !== breakOptions) {
      const choice = breakForm.elements.breakIndex;
      const previous = choice.value;
      choice.replaceChildren(new Option('בחירת הפסקה', ''), ...upcoming.map((item) =>
        new Option('אחרי שלב ' + item.number, item.breakIndex)));
      choice.value = [...choice.options].some((item) => item.value === previous) ? previous : '';
      breakOptions = options;
    }
    breakForm.elements.after.max = tournament?.levels?.length ?? 1;
    breakForm.querySelector('button').disabled = busy || !upcoming.length;
  }

  function refresh() {
    try {
      tournament = readTournament();
    } catch {
      tournament = null;
      if (message) message.textContent = 'לא ניתן לקרוא את האחסון המקומי.';
    }
    if (!floor) heading.querySelector('h1').textContent = tournament?.title || 'מסך הטורניר';
    tick();
  }

  async function perform(change, success) {
    if (busy) return;
    busy = true;
    tick();
    try {
      await updateTournament(change);
      message.textContent = success;
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
      refresh();
    }
  }

  if (floor) {
    for (const button of panel.querySelectorAll('[data-action]')) {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        const start = current.segment?.start;
        if (action === 'next' && !window.confirm('לסיים את השלב או ההפסקה הנוכחיים עכשיו?')) return;
        perform((stored) => controlLive(stored, action, Date.now(), start), 'מצב הטורניר עודכן.');
      });
    }
    adjust.addEventListener('submit', (event) => {
      event.preventDefault();
      const seconds = Number(adjust.elements.seconds.value);
      const start = current.segment?.start;
      perform((stored) => controlLive(stored, 'adjust', Date.now(), start, seconds), 'השעון עודכן.');
    });
    breakForm.elements.breakIndex.addEventListener('change', () => {
      const index = breakForm.elements.breakIndex.value;
      const item = index === '' ? null : tournament.breaks[Number(index)];
      breakForm.elements.after.value = item?.after ?? '';
      breakForm.elements.minutes.value = item?.minutes ?? '';
    });
    breakForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const { breakIndex, after, minutes } = breakForm.elements;
      const index = Number(breakIndex.value);
      const original = tournament.breaks[index];
      const destination = Number(after.value);
      const duration = Number(minutes.value);
      perform((stored) => {
        const existing = stored?.breaks?.[index];
        if (!existing || existing.after !== original.after || existing.minutes !== original.minutes) {
          throw new Error('ההפסקה השתנתה. בחרו אותה מחדש.');
        }
        return moveBreak(stored, index, destination, duration);
      }, 'ההפסקה עודכנה.');
    });
  }
  refresh();
  const stop = watchTournament(refresh);
  const interval = setInterval(tick, 250);
  return () => { stop(); clearInterval(interval); };
}
