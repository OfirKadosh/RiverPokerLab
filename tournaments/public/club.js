export async function readClub(path = '', options) {
  const response = await fetch('/api/club' + path, options);
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('יש להפעיל את שרת המועדון המקומי.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'הפעולה נכשלה.');
  return data;
}

const roles = { floor: 'פלור', cashier: 'קופאי', dealer: 'דילר' };

export function renderClubAdmin(view, intro) {
  view.append(intro('פלור / מועדון', 'ניהול מועדון ועובדים', 'פרטי המועדון ורשימת העובדים נשמרים במסד המקומי.'));
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
    <article class="card"><h2>עובדי המועדון</h2><ul></ul></article>
    <p class="notice" role="status">טוען את נתוני המועדון…</p>`;
  view.append(panel);
  const details = panel.querySelector('#club-details');
  const employee = panel.querySelector('#employee-add');
  const message = panel.querySelector('[role=status]');
  const buttons = [...panel.querySelectorAll('button')];
  const list = panel.querySelector('ul');

  function showEmployees(items) {
    list.replaceChildren(...items.map((item) => {
      const row = document.createElement('li');
      row.textContent = item.name + ' · ' + roles[item.role];
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
  readClub().then((club) => {
    details.elements.name.value = club.name;
    details.elements.location.value = club.location;
    showEmployees(club.employees);
    buttons.forEach((button) => { button.disabled = false; });
    message.textContent = '';
  }).catch((error) => { message.textContent = error.message; });
}
