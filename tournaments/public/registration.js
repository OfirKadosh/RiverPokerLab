import { registrationOpen } from './live-state.js';
import { readTournament, updateTournament, watchTournament } from './tournament-store.js';
import { addTable, closeTable, movePlayer, register, seats } from './seating.js';

const money = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
const location = (item) => 'שולחן ' + item.table + ' · כיסא ' + item.seat;

function options(select, items, placeholder) {
  const previous = select.value;
  select.replaceChildren(new Option(placeholder, ''), ...items.map(([id, label]) => new Option(label, id)));
  if (items.some(([id]) => String(id) === previous)) select.value = previous;
}

function availableTables(tournament) {
  return (tournament?.tables ?? []).filter((table) => table.status === 'open');
}

function seatPicker(form, getTournament, except) {
  const table = form.elements.table;
  const seat = form.elements.seat;
  function refreshSeats() {
    const tournament = getTournament();
    const selected = availableTables(tournament).find((item) => item.id === Number(table.value));
    options(seat, selected ? seats(tournament, selected, except?.()).map((id) => [id, id]) : [], 'בחירת כיסא');
  }
  table.addEventListener('change', () => {
    seat.value = '';
    refreshSeats();
  });
  return () => {
    const tournament = getTournament();
    options(table, availableTables(tournament).map((item) => [item.id, 'שולחן ' + item.id]), 'בחירת שולחן');
    refreshSeats();
  };
}

export function renderRegistration(view, intro, floor) {
  view.append(intro(floor ? 'פלור / הושבה' : 'קופה / רישום', floor ? 'ניהול שולחנות' : 'רישום והושבת שחקנים',
    'סביבת עבודה מקומית. השינויים משותפים ללשוניות באותו דפדפן.'));
  const section = document.createElement('section');
  section.className = 'setup registration';
  section.innerHTML = floor ? `
    <form class="card setup-fields" id="tables-form">
      <label>קיבולת שולחן <input name="capacity" type="number" min="2" max="12" value="9" required></label>
      <label>מצב שולחן <select name="status"><option value="open">פתוח</option><option value="ready">מוכן לפתיחה</option></select></label>
      <button class="action">הוספת שולחן</button>
    </form>
    <form class="card setup-fields" id="threshold-form">
      <label>סף פתיחה מוקדמת <input name="threshold" type="number" min="1" max="12" required></label>
      <button>שמירת סף</button>
    </form>
    <ul class="card" id="tables"></ul>
    <form class="card setup-fields" id="move-form">
      <label>שחקן להעברה <select name="player" required></select></label>
      <label>שולחן יעד <select name="table" required></select></label>
      <label>כיסא יעד <select name="seat" required></select></label>
      <button class="action">העברת שחקן</button>
    </form>` : `
    <form class="card setup-fields" id="entry-form">
      <label>סוג כניסה <select name="kind"><option value="first">ראשונה</option><option value="reentry">חוזרת</option></select></label>
      <label id="entry-name">שם השחקן <input name="playerName" required maxlength="100"></label>
      <label id="entry-player" hidden>שחקן לכניסה חוזרת <select name="player" disabled></select></label>
      <label>שיטת הקצאה <select name="mode"><option value="auto">אוטומטית</option><option value="manual">ידנית</option></select></label>
      <label data-manual hidden>שולחן <select name="table" disabled></select></label>
      <label data-manual hidden>כיסא <select name="seat" disabled></select></label>
      <label class="payment"><input name="paid" type="checkbox" required><span id="payment-label">אישור קבלת תשלום</span></label>
      <button class="action">אישור תשלום והושבה</button>
    </form>
    <label class="card">פתק כניסה קיים <select id="receipt-select"></select></label>
    <article class="card seat-receipt" hidden>
      <h2>פתק הושבה</h2><p id="receipt-tournament"></p><p id="receipt-player"></p><strong id="receipt-seat"></strong>
      <button type="button" id="print-receipt">הדפסת פתק</button>
    </article>`;
  const message = document.createElement('p');
  message.className = 'notice';
  message.setAttribute('role', 'status');
  view.append(message, section);
  const find = (selector) => section.querySelector(selector);
  let tournament;
  let pending = false;
  const getTournament = () => tournament;
  const form = find(floor ? '#move-form' : '#entry-form');
  const refreshSeats = seatPicker(form, getTournament, floor ? () => form.elements.player.value : undefined);

  function closeTableDialog(tableId) {
    const dialog = document.createElement('dialog');
    dialog.className = 'setup close-table-dialog';
    dialog.setAttribute('aria-label', 'סגירת שולחן ' + tableId);
    const editor = document.createElement('form');
    editor.className = 'setup';
    const heading = document.createElement('h2');
    heading.textContent = 'סגירת שולחן ' + tableId;
    const feedback = document.createElement('p');
    feedback.setAttribute('role', 'status');
    const fields = document.createElement('div');
    fields.className = 'setup-fields';
    const submit = document.createElement('button');
    submit.textContent = 'אישור העברות וסגירה';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'ביטול סגירה';
    cancel.addEventListener('click', () => dialog.close());
    const controls = document.createElement('div');
    controls.className = 'setup-actions';
    controls.append(submit, cancel);
    editor.append(heading, feedback, fields, controls);
    dialog.append(editor);
    section.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('cancel', (event) => { if (cancel.disabled) event.preventDefault(); });
    function reserveChoices() {
      const selectors = [...fields.querySelectorAll('select')];
      for (const select of selectors) {
        for (const option of select.options) option.disabled = Boolean(option.value &&
          selectors.some((other) => other !== select && other.value === option.value));
      }
    }
    fields.addEventListener('change', reserveChoices);

    function fill() {
      const players = (tournament.players ?? []).filter((player) => player.table === tableId);
      const available = availableTables(tournament).filter((table) => table.id !== tableId)
        .flatMap((table) => seats(tournament, table).map((seat) =>
          [table.id + ':' + seat, location({ table: table.id, seat })]));
      const previous = new Map([...fields.querySelectorAll('select')].map((select) => [select.name, select.value]));
      fields.replaceChildren();
      for (const player of players) {
        const label = document.createElement('label');
        label.textContent = player.name + ' · כיסא ' + player.seat;
        const select = document.createElement('select');
        select.name = player.id;
        select.required = true;
        options(select, available, 'בחירת מושב פנוי');
        select.value = available.some(([id]) => id === previous.get(player.id)) ? previous.get(player.id) : '';
        label.append(select);
        fields.append(label);
      }
      reserveChoices();
      submit.disabled = available.length < players.length;
      feedback.textContent = submit.disabled ? 'אין מספיק מושבים פנויים. בטלו את הסגירה ופתחו שולחן נוסף.' :
        players.length ? 'יש להושיב את כל השחקנים לפני הסגירה.' : 'השולחן ריק ואפשר לסגור אותו.';
    }

    editor.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      cancel.disabled = true;
      const assignments = [...new FormData(editor)].map(([id, target]) => {
        const [table, seat] = target.split(':').map(Number);
        return { id, table, seat };
      });
      try {
        await updateTournament((current) => closeTable(current, tableId, assignments));
        dialog.close();
        refresh();
        message.textContent = 'השחקנים הועברו והשולחן נסגר.';
      } catch (error) {
        refresh();
        fill();
        feedback.textContent = error.message;
      } finally { cancel.disabled = false; }
    });
    fill();
    dialog.showModal();
  }

  function receipt() {
    const select = find('#receipt-select');
    const entry = (tournament?.entries ?? []).find((item) => item.id === select.value);
    find('.seat-receipt').hidden = !entry;
    if (!entry) return;
    const player = (tournament.players ?? []).find((item) => item.id === entry.playerId);
    const seat = player?.table ? player : entry;
    find('#receipt-tournament').textContent = tournament.title;
    find('#receipt-player').textContent = entry.name;
    find('#receipt-seat').textContent = player?.table ? location(seat) : 'מושב בעת הרישום: ' + location(seat);
  }

  function updateRegistrationState() {
    if (floor) return;
    const open = registrationOpen(tournament);
    form.querySelector('button').disabled = pending || !open;
    if (tournament?.live && !open) message.textContent = 'ההרשמה נסגרה.';
  }

  function refresh() {
    try {
      tournament = readTournament();
    } catch {
      message.textContent = 'לא ניתן לקרוא את הטורניר מהאחסון המקומי.';
      return;
    }
    const players = tournament?.players ?? [];
    if (floor) {
      const list = find('#tables');
      list.replaceChildren();
      for (const table of tournament?.tables ?? []) {
        const item = document.createElement('li');
        item.textContent = 'שולחן ' + table.id + ' · ' + (table.capacity - seats(tournament, table).length) +
          ' מתוך ' + table.capacity + ' · ' + (table.status === 'ready' ? 'מוכן לפתיחה' : table.status === 'closed' ? 'סגור' : 'פתוח');
        if (table.status === 'ready') {
          const open = document.createElement('button');
          open.type = 'button';
          open.textContent = 'פתיחת שולחן ' + table.id;
          open.addEventListener('click', () => perform((current) => ({
            ...current, tables: current.tables.map((row) => row.id === table.id ? { ...row, status: 'open' } : row),
          }), 'השולחן פתוח להושבה.'));
          item.append(' ', open);
        }
        if (table.status === 'open' && tournament.status !== 'finished') {
          const close = document.createElement('button');
          close.type = 'button';
          close.textContent = 'סגירת שולחן ' + table.id;
          close.addEventListener('click', () => closeTableDialog(table.id));
          item.append(' ', close);
        }
        list.append(item);
      }
      if (!list.children.length) list.textContent = 'עדיין אין שולחנות.';
      options(form.elements.player, players.filter((p) => p.table !== null).map((p) => [p.id, p.name + ' · ' + location(p)]), 'בחירת שחקן');
      find('#tables-form button').disabled = !tournament;
      find('#threshold-form button').disabled = !tournament;
      form.querySelector('button').disabled = !form.elements.player.options[1];
    } else {
      const reentry = form.elements.kind.value === 'reentry';
      find('#entry-name').hidden = reentry;
      find('#entry-player').hidden = !reentry;
      form.elements.playerName.disabled = reentry;
      form.elements.player.disabled = !reentry;
      form.elements.player.required = reentry;
      options(form.elements.player, players.filter((p) => p.table === null).map((p) => [p.id, p.name]), 'בחירת שחקן');
      for (const label of form.querySelectorAll('[data-manual]')) {
        label.hidden = form.elements.mode.value !== 'manual';
        const input = label.querySelector('select');
        input.disabled = label.hidden;
        input.required = !label.hidden;
      }
      updateRegistrationState();
      const fee = tournament ? Math.round(Number(tournament.fee) * 100) : '';
      if (form.elements.paid.dataset.fee !== String(fee)) form.elements.paid.checked = false;
      form.elements.paid.dataset.fee = fee;
      find('#payment-label').textContent = 'התקבל תשלום' + (tournament ? ' · ' + money.format(Number(tournament.fee)) : '');
      options(find('#receipt-select'), (tournament?.entries ?? []).map((entry, index) => [
        entry.id, (index + 1) + ' · ' + entry.name + ' · ' + location(entry),
      ]), 'בחירת פתק');
      receipt();
    }
    refreshSeats();
  }

  async function perform(change, success, done) {
    try {
      await updateTournament(change);
      refresh();
      done?.();
      message.textContent = success;
    } catch (error) {
      refresh();
      message.textContent = error.message;
    }
  }

  if (floor) {
    const threshold = find('#threshold-form');
    try { threshold.elements.threshold.value = readTournament()?.openThreshold ?? 7; }
    catch { threshold.elements.threshold.value = 7; }
    find('#tables-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const inputs = event.currentTarget.elements;
      const capacity = Number(inputs.capacity.value);
      const status = inputs.status.value;
      perform((current) => addTable(current, capacity, status), 'השולחן נוסף.');
    });
    threshold.addEventListener('submit', (event) => {
      event.preventDefault();
      const openThreshold = Number(threshold.elements.threshold.value);
      perform((current) => ({ ...current, openThreshold }), 'סף הפתיחה נשמר.');
    });
    form.elements.player.addEventListener('change', refreshSeats);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const { player, table, seat } = form.elements;
      const id = player.value;
      const destination = Number(table.value);
      const chair = Number(seat.value);
      perform((current) => movePlayer(current, id, destination, chair), 'השחקן הועבר.');
    });
  } else {
    for (const control of [form.elements.kind, form.elements.mode]) control.addEventListener('change', refresh);
    find('#receipt-select').addEventListener('change', receipt);
    find('#print-receipt').addEventListener('click', () => window.print());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (pending) return;
      pending = true;
      const { kind, player, playerName, mode, table, seat, paid } = form.elements;
      const request = {
        id: crypto.randomUUID(), playerId: kind.value === 'reentry' ? player.value : null,
        name: playerName.value, paid: paid.checked, fee: Number(paid.dataset.fee), table: mode.value === 'manual' ? Number(table.value) : null,
        seat: Number(seat.value),
      };
      const submit = form.querySelector('button');
      submit.disabled = true;
      try {
        await perform((current) => register(current, request), 'התשלום וההושבה נשמרו.', () => {
          form.reset();
          refresh();
          find('#receipt-select').value = request.id;
          receipt();
        });
      } finally {
        pending = false;
        submit.disabled = !registrationOpen(tournament);
      }
    });
  }
  refresh();
  if (!tournament) message.textContent = 'יש להקים ולשמור טורניר בעמדת הפלור.';
  else if (!floor && tournament.status !== 'registration') message.textContent = 'יש לפתוח את הטורניר לרישום בעמדת הפלור.';
  const stop = watchTournament(refresh);
  const tick = floor ? null : setInterval(updateRegistrationState, 250);
  return () => { stop(); clearInterval(tick); };
}
