import { renderTournamentSetup } from "./tournament-setup.js";

// This anonymous deployment has a fixture-only identity and no mutation API.
const demoSession = Object.freeze({
  clubName: 'הג׳וקר',
  location: 'ראשון לציון',
  employees: [
    { name: 'נועה לוי', role: 'floor' },
    { name: 'שיר נוי', role: 'cashier' },
    { name: 'דנה ברק', role: 'dealer' },
  ],
});

const stations = {
  floor: {
    name: 'פלור',
    title: 'ניהול הטורניר',
    description: 'העמדה שממנה מנהלים את הטורניר, הצוות והשולחנות.',
    panels: [['טורנירים', 'הקמה, שלבים והפסקות'], ['שולחנות', 'פתיחה והעברת שחקנים'], ['צוות', 'דילרים, קופה ושיבוצים']],
  },
  cashier: {
    name: 'קופה',
    title: 'עמדת קופאי',
    description: 'רישום שחקנים והושבה בעמדת המועדון.',
    panels: [['כניסות', 'רישום כניסה ראשונה או חוזרת'], ['תשלום', 'אישור קבלת תשלום'], ['הושבה', 'בחירת כיסא והדפסת פתק']],
  },
  dealer: {
    name: 'דילר',
    title: 'עמדת דילר',
    description: 'ממשק מגע לשולחן המשויך לטאבלט.',
    panels: [['מושבים', 'מפת השולחן והדחות'], ['שעון פעולה', 'תצוגת שעון במסך מלא'], ['משמרת', 'החלפת דילר בשולחן']],
  },
};

const view = document.querySelector('#view');
const main = document.querySelector('#content');
const links = [...document.querySelectorAll('nav a')];

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function intro(kicker, title, description) {
  const header = element('header', '', 'intro');
  const heading = element('h1', title);
  heading.id = 'title';
  header.append(element('p', kicker, 'eyebrow'), heading, element('p', description, 'muted'));
  return header;
}

function card(title, detail) {
  const panel = element('article', '', 'card');
  panel.append(element('h2', title), element('p', detail, 'muted'));
  return panel;
}

function club() {
  const header = intro('סביבת מועדון', demoSession.clubName, demoSession.location + ' · מרחב לדוגמה');
  const grid = element('div', '', 'grid');
  for (const employee of demoSession.employees) {
    const station = stations[employee.role];
    const panel = card(station.name, employee.name);
    const link = element('a', 'פתיחת עמדה', 'action');
    link.href = '#' + employee.role;
    panel.append(link);
    grid.append(panel);
  }
  view.append(header, grid, element('p', 'נתוני הדוגמה פתוחים לצפייה ללא התחברות.', 'notice'));
}

function station(role) {
  const config = stations[role];
  const employee = demoSession.employees.find((item) => item.role === role);
  const grid = element('div', '', 'grid');
  for (const [title, detail] of config.panels) grid.append(card(title, detail));
  if (role === 'floor') {
    const setup = element('a', 'הקמת טורניר', 'action');
    setup.href = '#setup';
    grid.firstElementChild.append(setup);
  }
  view.append(
    intro(demoSession.clubName + ' / ' + config.name, config.title, config.description),
    element('p', employee.name + ' · עמדה לדוגמה', 'notice'),
    grid,
  );
}

function display() {
  const sample = element('article', '', 'display-card');
  const clock = element('p', '07:42', 'clock');
  clock.dir = 'ltr';
  sample.append(element('p', 'שלב 5', 'eyebrow'), clock, element('p', 'בליינדים 500 / 1,000'));
  view.append(intro('תצוגת קהל', 'Joker Friday', 'תצוגה לדוגמה · נתונים קבועים'), sample);
}

function render(focus = false) {
  const hash = window.location.hash.slice(1);
  if (hash === 'content') return;
  const route = hash === 'setup' || links.some((link) => link.hash === '#' + hash) ? hash : 'club';
  for (const link of links) {
    if (link.hash === '#' + (route === 'setup' ? 'floor' : route)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  view.className = route === 'display' ? 'audience' : '';
  view.replaceChildren();
  if (route === 'club') club();
  else if (route === 'display') display();
  else if (route === 'setup') renderTournamentSetup(view, intro);
  else station(route);
  if (focus) main.focus();
}

window.addEventListener('hashchange', () => render(true));
if (window.location.hash === '#content') history.replaceState(null, '', '#club');
render();
