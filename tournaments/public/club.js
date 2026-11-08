import { readTournament } from './tournament-store.js';
import { pools } from './results-state.js';

export async function readClub(path = '', options) {
  const response = await fetch('/api/club' + path, options);
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('יש להפעיל את שרת המועדון המקומי.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'הפעולה נכשלה.');
  return data;
}

const roles = { floor: 'פלור', cashier: 'קופאי', dealer: 'דילר' };

const request = (path, method, data) => readClub(path, {
  method, ...(data && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
});
const clockFormat = new Intl.DateTimeFormat('he-IL', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem',
});
const duration = (ms) => {
  const minutes = Math.floor(ms / 60000);
  return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0');
};

export function renderClubAdmin(view, intro) {
  view.append(intro('בעלים / מועדון', 'ניהול מועדון ועובדים', 'ניהול צוות, נוכחות ונתוני טורניר מקומי.'));
  const content = document.createElement('div');
  view.append(content);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  content.append(status);
  status.textContent = 'בודק כניסת בעלים…';
  readClub('/owner').then((session) => {
    if (!content.isConnected) return;
    if (session.authenticated) {
      content.replaceChildren();
      showClubAdmin(content, () => renderLogin(true));
    } else renderLogin(session.configured);
  }).catch((error) => { status.textContent = error.message; });

  function renderLogin(configured) {
    content.innerHTML = `
      <form class="card setup setup-fields">
        <label>סיסמת בעלים <input name="password" type="password" autocomplete="current-password" required></label>
        <button>כניסת בעלים</button>
      </form><p class="notice" role="status"></p>`;
    const form = content.querySelector('form');
    const button = form.querySelector('button');
    const message = content.querySelector('[role=status]');
    button.disabled = !configured;
    if (!configured) message.textContent = 'יש להגדיר סיסמת בעלים בהפעלת השרת.';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      button.disabled = true;
      try {
        await request('/owner', 'POST', { password: form.elements.password.value });
        content.replaceChildren();
        showClubAdmin(content, () => renderLogin(true));
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
      }
    });
  }
}

function showClubAdmin(view, logout) {
  const panel = document.createElement('section');
  panel.className = 'setup';
  panel.innerHTML = `
    <form class="card setup-fields" id="club-details">
      <label>שם המועדון <input name="name" required maxlength="100"></label>
      <label>מיקום <input name="location" required maxlength="100"></label>
      <button disabled>שמירת מועדון</button>
    </form>
    <form class="card setup-fields" id="employee-add">
      <label>שם העובד <input name="name" required maxlength="100"></label>
      <label>תפקיד <select name="role"><option value="floor">פלור</option><option value="cashier">קופאי</option><option value="dealer">דילר</option></select></label>
      <button disabled>הוספת עובד</button>
    </form>
    <article class="card"><h2>עובדי המועדון</h2><ul id="owner-roster"></ul></article>
    <section class="card setup"><h2>דוח משמרות חודשי</h2>
      <form id="attendance-report" class="setup-fields">
        <label>חודש <input name="month" type="month" required></label>
        <button>הצגת דוח</button>
      </form><div id="report-output"></div>
    </section>
    <section class="card"><h2>נתוני הטורניר המקומי</h2><p id="owner-tournament"></p><a href="#results">פרסים ותוצאות</a>
      <button type="button" id="archive-tournament" hidden>שמירת סיכום טורניר להיסטוריה</button></section>
    <section class="card"><h2>היסטוריית טורנירים</h2><ul id="owner-archive"></ul></section>
    <button type="button" id="owner-logout">יציאת בעלים</button>
    <p class="notice" role="status">טוען את נתוני המועדון…</p>`;
  view.append(panel);
  const details = panel.querySelector('#club-details');
  const employee = panel.querySelector('#employee-add');
  const message = panel.querySelector('[role=status]');
  const buttons = [details.querySelector('button'), employee.querySelector('button')];
  const list = panel.querySelector('#owner-roster');

  function showEmployees(items) {
    list.replaceChildren(...items.map((item) => {
      const row = document.createElement('li');
      row.textContent = item.name + ' · ' + roles[item.role] + ' ';
      const remove = document.createElement('button');
      remove.textContent = 'הסרה';
      remove.setAttribute('aria-label', 'הסרת ' + item.name);
      remove.addEventListener('click', async () => {
        if (!window.confirm('להסיר את ' + item.name + ' מרשימת העובדים הפעילים?')) return;
        remove.disabled = true;
        try {
          if (readTournament()?.shifts?.[item.id]) throw new Error('יש לסיים תחילה את משמרת הדילר בטורניר המקומי.');
          await request('/employees/' + item.id, 'DELETE');
          showEmployees((await readClub()).employees);
          message.textContent = 'העובד הוסר מהרשימה הפעילה. המשמרות נשמרו.';
        } catch (error) { message.textContent = error.message; }
        finally { remove.disabled = false; }
      });
      row.append(remove);
      return row;
    }));
  }

  async function save(form, path, method, success, done) {
    buttons.forEach((button) => { button.disabled = true; });
    message.textContent = 'שומר…';
    try {
      await readClub(path, { method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      done?.();
      showEmployees((await readClub()).employees);
      message.textContent = success;
    } catch (error) {
      message.textContent = error.message;
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  details.addEventListener('submit', (event) => {
    event.preventDefault();
    save(details, '', 'PATCH', 'פרטי המועדון נשמרו.');
  });
  employee.addEventListener('submit', (event) => {
    event.preventDefault();
    save(employee, '/employees', 'POST', 'העובד נוסף לרשימה.', () => employee.reset());
  });
  panel.querySelector('#owner-logout').addEventListener('click', async () => {
    try { await request('/owner', 'DELETE'); logout(); }
    catch (error) { message.textContent = error.message; }
  });
  const report = panel.querySelector('#attendance-report');
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  report.elements.month.value = month.find((part) => part.type === 'year').value + '-' + month.find((part) => part.type === 'month').value;
  report.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = report.querySelector('button');
    submit.disabled = true;
    try {
      const { employees, shifts } = await readClub('/report?month=' + encodeURIComponent(report.elements.month.value));
      const output = panel.querySelector('#report-output');
      output.replaceChildren(...employees.map((item) => {
        const rows = shifts.filter((shift) => shift.employeeId === item.id);
        const group = document.createElement('details');
        const heading = document.createElement('summary');
        heading.textContent = item.name + ' · ' + roles[item.role] + (item.archivedAt ? ' · הוסר' : '') +
          ' · ' + rows.length + ' משמרות · ' + duration(rows.reduce((sum, shift) => sum + shift.durationMs, 0)) + ' שעות';
        group.append(heading);
        for (const shift of rows) {
          const line = document.createElement('p');
          line.textContent = clockFormat.format(shift.startedAt) + ' עד ' +
            (shift.endedAt == null ? 'כעת (פתוחה)' : clockFormat.format(shift.endedAt)) + ' · ' + duration(shift.durationMs) + ' בחודש הנבחר';
          group.append(line);
        }
        return group;
      }));
      message.textContent = '';
    } catch (error) { message.textContent = error.message; }
    finally { submit.disabled = false; }
  });
  const currency = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });
  async function showArchive() {
    const { tournaments } = await readClub('/tournaments');
    const list = panel.querySelector('#owner-archive');
    list.replaceChildren();
    if (!tournaments.length) list.textContent = 'טרם נשמרו סיכומי טורנירים.';
    for (const item of tournaments) {
      const row = document.createElement('li');
      row.textContent = item.title + ' · ' + clockFormat.format(item.finishedAt) + ' · ' +
        item.entries + ' כניסות · ' + currency.format(item.prizePool / 100);
      list.append(row);
    }
  }
  showArchive().catch((error) => { panel.querySelector('#owner-archive').textContent = error.message; });
  try {
    const tournament = readTournament();
    const total = pools(tournament);
    panel.querySelector('#owner-tournament').textContent = tournament ?
      tournament.title + ' · ' + (tournament.entries?.length ?? 0) + ' כניסות · קופת פרסים ' + currency.format(total.prizes / 100) :
      'אין טורניר שמור בדפדפן הזה.';
    const archive = panel.querySelector('#archive-tournament');
    if (tournament?.results?.finishedAt) {
      archive.hidden = false;
      archive.addEventListener('click', async () => {
        archive.disabled = true;
        try {
          const current = readTournament();
          if (current?.results?.finishedAt !== tournament.results.finishedAt || current.id !== tournament.id) {
            throw new Error('הטורניר השתנה. פתחו מחדש את מסך הבעלים.');
          }
          await request('/tournaments', 'POST', {
            id: current.id ?? 'legacy-' + current.results.finishedAt,
            title: current.title, finishedAt: current.results.finishedAt,
            entries: current.entries?.length ?? 0, prizePool: pools(current).prizes,
          });
          await showArchive();
          message.textContent = 'סיכום הטורניר נשמר בהיסטוריה.';
        } catch (error) { message.textContent = error.message; }
        finally { archive.disabled = false; }
      });
    }
  } catch { panel.querySelector('#owner-tournament').textContent = 'לא ניתן לקרוא את הטורניר המקומי.'; }
  readClub().then((club) => {
    details.elements.name.value = club.name;
    details.elements.location.value = club.location;
    showEmployees(club.employees);
    buttons.forEach((button) => { button.disabled = false; });
    message.textContent = '';
  }).catch((error) => { message.textContent = error.message; });
}


export function renderAttendance(view, intro) {
  view.append(intro('מועדון / נוכחות', 'שעון נוכחות', 'פתיחה וסיום משמרות לפלור, לקופה ולדילרים.'));
  const panel = document.createElement('section');
  panel.className = 'card setup';
  panel.innerHTML = `
    <form class="setup-fields">
      <label>עובד <select name="employeeId" required></select></label>
      <button name="action" value="start" disabled>תחילת משמרת</button>
      <button name="action" value="end" disabled>סיום משמרת</button>
    </form><p class="notice" role="status">טוען עובדים…</p>`;
  view.append(panel);
  const form = panel.querySelector('form');
  const select = form.elements.employeeId;
  const message = panel.querySelector('[role=status]');
  const buttons = [...form.querySelectorAll('button')];
  let active = [];
  let busy = false;
  function refreshButtons() {
    const open = active.find((shift) => shift.employeeId === select.value);
    buttons[0].disabled = busy || !select.value || Boolean(open);
    buttons[1].disabled = busy || !open;
    if (open) message.textContent = 'משמרת פתוחה מ־' + clockFormat.format(open.startedAt);
    else message.textContent = select.value ? 'אין משמרת פתוחה.' : 'בחרו עובד.';
  }
  select.addEventListener('change', refreshButtons);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    refreshButtons();
    let errorMessage;
    try {
      ({ active } = await request('/attendance', 'POST', { employeeId: select.value, action: event.submitter.value }));
    } catch (error) {
      errorMessage = error.message;
      try { ({ active } = await readClub('/attendance')); } catch {}
    } finally {
      busy = false;
      refreshButtons();
      if (errorMessage) message.textContent = errorMessage;
    }
  });
  Promise.all([readClub(), readClub('/attendance')]).then(([club, state]) => {
    active = state.active;
    select.add(new Option('בחירת עובד', ''));
    for (const employee of club.employees) select.add(new Option(employee.name + ' · ' + roles[employee.role], employee.id));
    refreshButtons();
  }).catch((error) => { message.textContent = error.message; });
}
