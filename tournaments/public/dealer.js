import { readClub } from './club.js';
import { enterScreen, updateDigits } from './motion.js';
import { liveView } from './live-state.js';
import { readTournament, updateTournament, watchTournament } from './tournament-store.js';
import { assignDealer, changeShift, clockLeft, dealers, disconnectTablet, eliminate,
  issueCode, openTables, pair, pairedTable, swapDealer, updateClock } from './dealer-state.js';

const tokenKey = 'tournaments-dealer-tablet';
const duration = (milliseconds) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return [Math.floor(seconds / 60), seconds % 60].map((value) => String(value).padStart(2, '0')).join(':');
};

function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

function action(label, run, disabled = false) {
  const control = node('button', label);
  control.type = 'button';
  control.disabled = disabled;
  control.addEventListener('click', run);
  return control;
}

function eligible(tournament, dealer, tableId) {
  return tournament.shifts?.[dealer.id] && !openTables(tournament).some((table) =>
    table.id !== tableId && table.dealer === dealer.id);
}

function dealerPicker(tournament, table, roster, run, label) {
  const form = node('form', '', 'dealer-controls');
  const select = node('select');
  select.setAttribute('aria-label', 'בחירת דילר לשולחן ' + table.id);
  select.add(new Option('בחירת דילר', ''));
  select.required = true;
  for (const dealer of roster) {
    if (!tournament.shifts?.[dealer.id]) continue;
    const assignment = openTables(tournament).find((item) => item.dealer === dealer.id);
    const suffix = assignment ? ' · שולחן ' + assignment.id : ' · פנוי';
    const option = new Option(dealer.name + suffix, dealer.id);
    option.disabled = !eligible(tournament, dealer, table.id) || dealer.id === table.dealer;
    select.add(option);
  }
  const submit = node('button', label);
  submit.disabled = ![...select.options].some((option) => option.value && !option.disabled);
  form.append(select, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    run(select.value);
  });
  return form;
}

export function renderDealer(view, intro, floor) {
  view.append(intro(floor ? 'פלור / צוות' : 'דילר / שולחן',
    floor ? 'משמרות ושיוך טאבלטים' : 'עמדת דילר',
    'סביבת עבודה מקומית. השתמשו בלשוניות של אותו דפדפן.'));
  const section = node('section', '', 'setup dealer');
  const message = node('p', '', 'notice');
  message.setAttribute('role', 'status');
  const dialog = node('dialog', '', 'shot-dialog');
  dialog.setAttribute('aria-label', 'שעון פעולה במסך מלא');
  view.append(message, section, dialog);
  let token = floor ? null : sessionStorage.getItem(tokenKey);
  let tournament;
  let roster = dealers;
  const dealerName = (id) => roster.find((dealer) => dealer.id === id)?.name ?? 'ללא דילר';
  let clockNodes = [];
  let fullscreenClock;
  let tournamentPhase;
  let shiftNodes = [];
  let busy = false;

  async function perform(change, success, done) {
    if (busy) return;
    busy = true;
    try {
      await updateTournament(change);
      done?.();
      refresh();
      message.textContent = success;
    } catch (error) {
      message.textContent = error.message;
      refresh();
    } finally {
      busy = false;
    }
  }

  function renderFloor() {
    section.append(node('h2', 'דילרים'));
    const team = node('div', '', 'grid');
    for (const dealer of roster) {
      const shift = tournament.shifts?.[dealer.id];
      const assignment = openTables(tournament).find((table) => table.dealer === dealer.id);
      const card = node('article', '', 'card');
      const time = node('p', '', 'muted');
      if (shift) shiftNodes.push({ time, shift });
      card.append(node('h3', dealer.name), node('p', assignment ? 'שולחן ' + assignment.id : shift ? 'פנוי במשמרת' : 'מחוץ למשמרת'),
        time, action(shift ? 'סיום משמרת' : 'תחילת משמרת',
          () => perform((current) => changeShift(current, dealer.id, !shift, Date.now(), roster), 'המשמרת עודכנה.')));
      team.append(card);
    }
    section.append(team, node('h2', 'שולחנות וטאבלטים'));
    const tables = node('div', '', 'grid');
    for (const table of openTables(tournament)) {
      const card = node('article', '', 'card');
      card.append(node('h3', 'שולחן ' + table.id), node('p', dealerName(table.dealer)),
        node('p', table.tablet ? 'טאבלט משויך' : 'טאבלט טרם שויך', 'muted'));
      if (table.code?.expires > Date.now()) {
        card.append(node('p', 'קוד חד־פעמי: ' + table.code.value + ' · בתוקף ל־5 דקות מההנפקה', 'pair-code'));
      }
      const controls = node('div', '', 'dealer-controls');
      controls.append(action('הנפקת קוד', () => perform((current) => issueCode(current, table.id), 'הונפק קוד לשולחן.')));
      if (table.tablet || table.code) controls.append(action('ביטול שיוך וקוד', () =>
        perform((current) => disconnectTablet(current, table.id), 'השיוך והקוד בוטלו.')));
      card.append(controls, dealerPicker(tournament, table, roster,
        (id) => perform((current) => assignDealer(current, table.id, id), 'הדילר שובץ.'), 'שיבוץ דילר'));
      tables.append(card);
    }
    if (!tables.children.length) tables.append(node('p', 'יש לפתוח שולחן בעמדת הפלור.'));
    section.append(tables);
  }

  function renderPairing() {
    const form = node('form', '', 'card dealer-controls');
    const label = node('label', 'קוד שיוך בן שש ספרות');
    const input = node('input');
    input.inputMode = 'numeric';
    input.pattern = '[0-9]{6}';
    input.maxLength = 6;
    input.required = true;
    label.append(input);
    form.append(label, node('button', 'שיוך לשולחן'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = input.value;
      const next = crypto.randomUUID();
      perform((current) => pair(current, code, next), 'הטאבלט שויך לשולחן.', () => {
        token = next;
        sessionStorage.setItem(tokenKey, next);
      });
    });
    section.append(form);
  }

  function clockControls(target, fullscreen) {
    const controls = node('div', '', 'shot-controls');
    const face = action('00:00', () => changeClock('tap'));
    face.className = 'shot-face';
    face.dir = 'ltr';
    const toggle = action('השהיה', () => changeClock(toggle.dataset.action));
    const navigation = fullscreen
      ? action('חזרה לשולחן', () => dialog.close())
      : action('מסך מלא', () => { dialog.showModal(); enterScreen(dialog); });
    if (fullscreen) fullscreenClock = { face, toggle };
    else clockNodes.push({ face, toggle });
    controls.append(face, toggle, navigation);
    target.append(controls);
  }

  function changeClock(mode) {
    const currentToken = token;
    perform((current) => updateClock(current, currentToken, mode), 'שעון הפעולה עודכן.');
  }

  function renderTable(table) {
    const panel = node('article', '', 'card');
    tournamentPhase = node('p', '', 'muted');
    panel.append(node('h2', 'שולחן ' + table.id), node('p', dealerName(table.dealer), 'muted'), tournamentPhase);
    const seats = node('div', '', 'dealer-seats');
    for (let seat = 1; seat <= table.capacity; seat++) {
      const player = (tournament.players ?? []).find((item) => item.table === table.id && item.seat === seat);
      const chair = node('div', '', 'card');
      chair.append(node('strong', 'כיסא ' + seat), node('p', player?.name ?? 'פנוי'));
      if (player) chair.append(action('הדחה', () => {
        if (!window.confirm('לאשר הדחה של ' + player.name + ' מכיסא ' + seat + '?')) return;
        const currentToken = token;
        perform((current) => eliminate(current, currentToken, player.id, seat), 'השחקן הודח והמושב התפנה.');
      }, !table.dealer || tournament.status === 'finished'));
      seats.append(chair);
    }
    panel.append(seats);
    section.append(panel, dealerPicker(tournament, table, roster,
      (id) => perform((current) => swapDealer(current, token, id, table.dealer ?? null), 'הדילר הוחלף.'), 'החלפת דילר'));
    clockControls(section, false);
    if (!dialog.children.length) clockControls(dialog, true);
  }

  function tick() {
    const now = Date.now();
    for (const { time, shift } of shiftNodes) {
      time.textContent = 'תחילה ' + new Date(shift.startedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) +
        ' · משמרת ' + duration(now - shift.startedAt) + ' · במצב זה ' + duration(now - shift.statusSince);
    }
    if (tournamentPhase) {
      const { state, segment } = liveView(tournament, now);
      const text = state === 'ready' ? 'הטורניר טרם התחיל' : state === 'finished' ? 'הטורניר הסתיים' : state === 'complete' ? 'מבנה הבליינדים הסתיים' :
        (segment.type === 'break' ? 'הפסקה אחרי שלב ' : 'שלב ') + segment.number + (state === 'paused' ? ' · מושהה' : '');
      if (tournamentPhase.textContent !== text) tournamentPhase.textContent = text;
    }
    const table = pairedTable(tournament, token);
    const remaining = tournament?.status === 'finished' ? 0 : clockLeft(table?.clock, now);
    const running = Boolean(table?.clock?.deadline && remaining);
    for (const { face, toggle } of fullscreenClock ? [...clockNodes, fullscreenClock] : clockNodes) {
      updateDigits(face, duration(Math.ceil(remaining / 1000) * 1000));
      face.classList.toggle('clock-urgent', remaining > 0 && remaining <= 5000);
      face.setAttribute('aria-label', running || !remaining ? 'איפוס והפעלת 30 שניות' : 'המשך שעון פעולה');
      face.disabled = !table?.dealer || tournament?.status === 'finished';
      toggle.textContent = running ? 'השהיה' : 'המשך';
      toggle.dataset.action = running ? 'pause' : 'tap';
      toggle.disabled = !table?.dealer || !remaining;
    }
  }

  function refresh() {
    clockNodes = [];
    tournamentPhase = null;
    shiftNodes = [];
    section.replaceChildren();
    try {
      tournament = readTournament();
    } catch {
      tournament = null;
      message.textContent = 'לא ניתן לקרוא את האחסון המקומי.';
    }
    const table = pairedTable(tournament, token);
    if (!table && dialog.open) dialog.close();
    if (floor && tournament) renderFloor();
    else if (floor) section.append(node('p', 'יש להקים ולשמור טורניר בעמדת הפלור.'));
    else if (!table) renderPairing();
    else renderTable(table);
    tick();
  }

  refresh();
  function refreshRoster() {
    readClub().then((club) => {
      if (!section.isConnected) return;
      const updated = club.employees.filter((employee) => employee.role === 'dealer');
      if (JSON.stringify(updated) !== JSON.stringify(roster)) {
        roster = updated;
        refresh();
      }
    }).catch(() => {});
  }
  refreshRoster();
  window.addEventListener('focus', refreshRoster);
  const stop = watchTournament(refresh);
  const interval = setInterval(tick, 200);
  return () => {
    stop();
    window.removeEventListener('focus', refreshRoster);
    clearInterval(interval);
    if (dialog.open) dialog.close();
  };
}
