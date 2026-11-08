import { editShare, resizeShares } from './prize-editor-state.js';
import { registrationOpen } from './live-state.js';
import { pools, prizePlan, prizeRows, prizeShares, restoreElimination, saveResults, setPrizeAmounts, setPrizeShares } from './results-state.js';
import { readTournament, reconcileFinish, removeTournament, tournamentId, updateTournament, watchTournament } from './tournament-store.js';

const currency = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
const money = (cents) => currency.format(cents / 100);
const labels = { amounts: 'חלוקה לפי סכומים', shares: 'חלוקת פרסים', finish: 'סגירת תוצאות', correction: 'תיקון דירוג', restore: 'החזרת שחקן' };

function element(tag, text = '') {
  const item = document.createElement(tag);
  item.textContent = text;
  return item;
}

export function showPrizes(container, tournament, showNames = false) {
  const closed = tournament?.live && !registrationOpen(tournament);
  container.hidden = !closed || !tournament.players?.length;
  const rows = container.hidden ? [] : prizeRows(tournament);
  const key = JSON.stringify(rows);
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  container.replaceChildren();
  if (container.hidden) return;
  container.append(element('h2', 'חלוקת פרסים'));
  const list = element('ol');
  if (!showNames) list.className = rows.length > 12 ? 'prize-tiles prize-tiles-dense' : 'prize-tiles';
  for (const row of rows) {
    if (showNames) {
      list.append(element('li', (row.name ? row.name + ' · ' : '') + money(row.amount)));
    } else {
      const tile = element('li');
      tile.append(element('span', 'מקום ' + row.place), element('strong', money(row.amount)));
      if (row.name) tile.append(element('span', row.name));
      list.append(tile);
    }
  }
  container.append(list);
}

function describe(value) {
  if (!value) return '—';
  if (!Array.isArray(value)) return value.table == null ? value.name + ' · מחוץ למשחק' :
    value.name + ' · שולחן ' + value.table + ' כיסא ' + value.seat;
  return value.map((item) => typeof item === 'number' ? item / 100 + '%' :
    'מקום ' + item.place + ': ' + (item.name ? item.name + ' · ' : '') + money(item.amount)).join(' / ');
}

export function renderResults(view, intro, onSaved) {
  view.append(intro('פלור / תוצאות', 'פרסים ותוצאות', 'סכומי הקופות מחושבים מהכניסות שנרשמו בקופה.'));
  const panel = element('section');
  panel.className = 'setup results-panel';
  panel.innerHTML = `
    <div class="grid">
      <article class="card"><h2>סה״כ נגבה</h2><p data-pool="collected"></p></article>
      <article class="card"><h2>קופת פרסים</h2><p data-pool="prizes"></p></article>
      <article class="card"><h2>קופת באונטי</h2><p data-pool="bounty"></p></article>
      <article class="card"><h2>רייק</h2><p data-pool="rake"></p></article>
    </div>
    <p class="muted">צ׳יפ הבאונטי מנוהל פיזית בשולחן.</p>
    <p class="notice" id="results-context"></p>
    <article class="card" id="prize-list"></article>
    <div id="result-editor"></div>
    <p class="notice" role="status"></p>
    <details class="card"><summary>יומן שינויים</summary><ol id="result-log"></ol></details>`;
  view.append(panel);
  const find = (selector) => panel.querySelector(selector);
  const message = find('[role=status]');
  const editor = find('#result-editor');
  let tournament;
  let editorKey = null;
  let busy = false;

  function form(title, fields, submit, run) {
    const wrapper = element('form');
    wrapper.className = 'card setup';
    const heading = element('h2', title);
    const grid = element('div');
    grid.className = 'setup-fields';
    for (const [label, input] of fields) {
      input.setAttribute('aria-label', label);
      const field = element('label', label);
      field.append(input);
      grid.append(field);
    }
    wrapper.append(heading, grid, element('button', submit));
    wrapper.addEventListener('submit', (event) => {
      event.preventDefault();
      run();
    });
    return wrapper;
  }

  function input(placeholder, value = '') {
    const control = element('input');
    control.placeholder = placeholder;
    control.value = value;
    control.required = true;
    control.maxLength = 240;
    return control;
  }

  async function perform(change, success) {
    if (busy) return;
    busy = true;
    try {
      await updateTournament(change);
      editorKey = null;
      message.textContent = success;
      onSaved?.();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      busy = false;
      refresh();
    }
  }

  function rebuild(closed) {
    editor.replaceChildren();
    if (!tournament) return;
    const players = tournament.players ?? [];
    const shares = prizeShares(tournament);
    const eliminated = players.filter((player) => player.table === null && player.elimination);
    if (!tournament.results && eliminated.length) {
      const select = element('select');
      select.add(new Option('בחירת שחקן', ''));
      select.required = true;
      for (const player of eliminated) select.add(new Option(player.name + ' · שולחן ' + player.elimination.table + ' כיסא ' +
        player.elimination.seat, player.id));
      const reason = input('סיבת החזרת השחקן');
      editor.append(form('תיקון הדחה', [['שחקן', select], ['סיבה', reason]], 'החזרה למושב', () => {
        const id = select.value;
        const text = reason.value;
        const expected = JSON.stringify(eliminated.find((player) => player.id === id)?.elimination);
        perform((stored) => restoreElimination(stored, id, text, expected), 'השחקן הוחזר והמושב עודכן.');
      }));
    }
    if (tournament.results || (!players.length && !tournament.entries?.length)) {
      const archive = Boolean(tournament.results);
      const card = element('section');
      card.className = 'card setup';
      const button = element('button', archive ? 'העברה לארכיון והסרה מהפלור' : 'סגירת טורניר ריק');
      button.type = 'button';
      card.append(element('p', archive ? 'אחרי הצגת הפרסים, אפשר להעביר את הטורניר לארכיון הבעלים.' :
        'אין משתתפים או כניסות. אפשר לסגור את הטורניר בלי לשמור אותו.'), button);
      button.addEventListener('click', async () => {
        if (!window.confirm(archive ? 'להעביר את הטורניר לארכיון ולהסיר אותו מהתצוגה?' : 'לסגור את הטורניר בלי לשמור נתונים?')) return;
        button.disabled = true;
        const id = tournamentId();
        try {
          await removeTournament(id, async (stored) => {
            if (!archive) {
              if (stored.players?.length || stored.entries?.length || stored.results) {
                throw new Error('מצב הטורניר השתנה. בדקו את המשתתפים וההרשמה.');
              }
              return;
            }
            if (stored.status !== 'finished' || !stored.results) throw new Error('יש לסיים את הטורניר תחילה.');
            const snapshot = { ...stored, tables: (stored.tables ?? []).map(({ code, tablet, ...table }) => table) };
            const response = await fetch('/api/club/floor-archive', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(snapshot), signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) throw new Error('הארכיון לא נשמר. ודאו ששרת Tournaments פועל ונסו שוב.');
          });
          if (view.isConnected) location.hash = 'floor?t=new';
        } catch (error) {
          message.textContent = error.message;
          button.disabled = false;
        }
      });
      editor.append(card);
    }
    if (tournament.results?.standings?.length) {
      const ranking = element('details');
      ranking.className = 'card';
      ranking.append(element('summary', 'דירוג מלא'));
      const list = element('ol');
      for (const row of tournament.results.standings) list.append(element('li', row.name));
      ranking.append(list);
      editor.append(ranking);
    }
    if (!closed || !players.length) return;
    const expectedPlan = prizePlan(tournament);
    if (!tournament.results) {
      let draft = shares;
      const box = element('form');
      box.className = 'card setup';
      const fields = element('div');
      fields.className = 'setup-fields';
      const controls = element('div');
      controls.className = 'setup-actions';
      const add = element('button', 'הוספת מקום מזכה');
      const remove = element('button', 'הסרת מקום אחרון');
      add.type = remove.type = 'button';
      const feedback = element('p');
      feedback.setAttribute('role', 'status');
      const reason = input('סיבה לשינוי (אופציונלי)');
      reason.required = false;
      reason.setAttribute('aria-label', 'סיבה לשינוי החלוקה');
      const save = element('button', 'שמירת חלוקה');
      controls.append(add, remove, save);
      box.append(element('h2', 'מקומות מזכים ואחוזים'), fields, controls, reason, feedback);
      function draw() {
        fields.replaceChildren();
        draft.forEach((share, index) => {
          const label = element('label', 'מקום ' + (index + 1) + ' · אחוז');
          const amount = element('input');
          Object.assign(amount, { type: 'number', min: '1', max: '100', step: '0.01', value: String(share / 100), required: true });
          label.append(amount);
          amount.addEventListener('change', () => {
            try {
              const value = Number(amount.value);
              if (!amount.validity.valid) throw new Error('יש להזין אחוז בין 1 ל־100, עד שתי ספרות אחרי הנקודה.');
              draft = editShare(draft, index, Math.round(value * 100));
              feedback.textContent = 'סך החלוקה: 100%';
              if (draft.length === fields.children.length) {
                [...fields.querySelectorAll('input')].forEach((field, i) => { field.value = String(draft[i] / 100); });
              } else draw();
            } catch (error) {
              amount.value = String(draft[index] / 100);
              feedback.textContent = error.message;
            }
          });
          fields.append(label);
        });
        add.disabled = draft.length >= Math.min(100, players.length);
        remove.disabled = draft.length === 1;
      }
      add.addEventListener('click', () => { draft = resizeShares(draft, draft.length + 1); draw(); });
      remove.addEventListener('click', () => { draft = resizeShares(draft, draft.length - 1); draw(); });
      box.addEventListener('submit', (event) => {
        event.preventDefault();
        const updated = draft;
        const text = reason.value.trim() || 'עדכון מקומות מזכים';
        if (tournament.prizeAmounts && !window.confirm('שמירת אחוזים תחליף את חלוקת הסכומים של הדיל. להמשיך?')) return;
        perform((stored) => {
          if (prizePlan(stored) !== expectedPlan) throw new Error('חלוקת הפרסים השתנתה. פתחו מחדש את העורך.');
          return setPrizeShares(stored, updated, text);
        }, 'חלוקת הפרסים עודכנה.');
      });
      draw();
      editor.append(box);
      const rows = prizeRows(tournament);
      const deal = element('form');
      deal.className = 'card setup';
      const dealFields = element('div');
      dealFields.className = 'setup-fields';
      const help = element('p', 'פרסים שכבר שויכו למודחים נעולים. חלקו את היתרה בין המקומות שעדיין פתוחים.');
      const balance = element('output');
      const submit = element('button', 'שמירת סכומי הדיל');
      const inputs = rows.map((row) => {
        const label = element('label', 'מקום ' + row.place + (row.name ? ' · ' + row.name : '') + ' · סכום בשקלים');
        const control = element('input');
        Object.assign(control, { type: 'number', min: '0', step: '0.01', required: true, disabled: Boolean(row.name),
          value: (row.amount / 100).toFixed(2) });
        label.append(control);
        dealFields.append(label);
        return control;
      });
      const amounts = () => inputs.map((control) => Math.round(Number(control.value) * 100));
      const total = pools(tournament).prizes;
      function checkBalance() {
        const remaining = total - amounts().reduce((sum, amount) => sum + amount, 0);
        balance.textContent = remaining < 0 ? 'חריגה מהקופה: ' + money(-remaining) : 'יתרה לחלוקה: ' + money(remaining);
        submit.disabled = remaining !== 0 || inputs.some((control) => !control.validity.valid);
      }
      deal.append(element('h2', 'עריכת פרסים לפי סכום · דיל'), help, dealFields, balance, submit);
      deal.addEventListener('input', checkBalance);
      deal.addEventListener('submit', (event) => {
        event.preventDefault();
        const updated = amounts();
        perform((stored) => setPrizeAmounts(stored, updated, 'חלוקה לפי סכומי דיל', expectedPlan), 'סכומי הדיל נשמרו.');
      });
      checkBalance();
      editor.append(deal);
    }
    const expectedResults = JSON.stringify(tournament.results ?? null);
    const ranks = shares.map((_, index) => {
      const select = element('select');
      select.add(new Option('בחירת שחקן', ''));
      select.required = true;
      for (const [position, player] of players.entries()) select.add(new Option(player.name + ' · משתתף ' + (position + 1), player.id));
      select.value = tournament.results?.rows[index]?.playerId ?? '';
      return ['מקום ' + (index + 1), select];
    });
    const correction = Boolean(tournament.results);
    const reason = correction ? input('סיבת תיקון התוצאות') : null;
    editor.append(form('דירוג המקומות המזכים', reason ? [...ranks, ['סיבה', reason]] : ranks,
      correction ? 'שמירת תיקון' : 'סיום הטורניר', () => {
        const ids = ranks.map(([, select]) => select.value);
        const text = reason?.value ?? '';
        if (!correction && !window.confirm('לסיים את הטורניר ולשמור את הדירוג?')) return;
        perform((stored) => saveResults(stored, ids, text, shares, expectedResults, Date.now(), expectedPlan), 'התוצאות נשמרו.');
      }));
  }

  function tick() {
    reconcileFinish(tournament, refresh, (error) => { message.textContent = error.message; });
    const closed = Boolean(tournament?.live && !registrationOpen(tournament));
    find('#results-context').textContent = tournament?.results ? 'הטורניר הסתיים.' : closed ?
      'ההרשמה נסגרה. אפשר לקבוע דירוג ופרסים.' : 'חלוקת הפרסים תוצג לאחר סגירת ההרשמה.';
    showPrizes(find('#prize-list'), tournament, true);
    const key = JSON.stringify([closed, tournament?.players, tournament?.prizeShares, tournament?.prizeAmounts, tournament?.results]);
    if (editorKey !== key) {
      editorKey = key;
      rebuild(closed);
    }
  }

  function refresh() {
    try {
      tournament = readTournament();
    } catch {
      tournament = null;
      message.textContent = 'לא ניתן לקרוא את האחסון המקומי.';
    }
    for (const [key, value] of Object.entries(pools(tournament))) find('[data-pool=' + key + ']').textContent = money(value);
    const log = find('#result-log');
    log.replaceChildren();
    for (const event of [...(tournament?.resultLog ?? [])].reverse()) {
      const row = element('li', new Date(event.at).toLocaleString('he-IL') + ' · ' + labels[event.type]);
      row.append(element('p', 'לפני: ' + describe(event.before)), element('p', 'אחרי: ' + describe(event.after)));
      if (event.reason) row.append(element('p', 'סיבה: ' + event.reason));
      log.append(row);
    }
    tick();
  }

  refresh();
  const stop = watchTournament(refresh);
  const interval = setInterval(tick, 250);
  return () => { stop(); clearInterval(interval); };
}
