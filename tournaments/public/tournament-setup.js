import { blindPresets as presets, nextPresetLevel, presetLevels } from './blind-structures.js';
import { readTournament, tournamentLink, updateTournament } from './tournament-store.js';
const minimumLevels = 25;
const number = (value) => value === '' ? NaN : Number(value);
const shekels = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' });

function readSetup() {
  try {
    const saved = readTournament();
    if (saved?.version === 1 && Array.isArray(saved.levels) && Array.isArray(saved.breaks)) return saved;
  } catch {
    // A browser with unavailable storage can still open the setup form.
  }
  return {
    version: 1, status: 'draft', title: '', game: 'holdem', pace: 'regular',
    paidPercent: '12', guarantee: 0, stack: '30000', reentries: '0', fee: '300', rake: '0', bounty: '0', prizes: 'regular',
    lateMode: 'level', lateValue: '6', structurePreset: 'regular', levels: presetLevels(presets.regular), breaks: [{ after: 6, minutes: 10 }],
  };
}

function make(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, options);
  node.append(...children);
  return node;
}

let fieldCount = 0;
function field(parent, label, input) {
  const id = "setup-label-" + ++fieldCount;
  input.setAttribute("aria-labelledby", id);
  parent.append(make('label', {}, [make('span', { id, textContent: label }), input]));
  return input;
}

function select(options, value) {
  const control = make('select');
  for (const [key, label] of options) control.add(new Option(label, key));
  control.value = value;
  return control;
}

function numeric(value, min, max, step = 1) {
  return make('input', { type: 'number', value, min, max, step, required: true, dir: 'ltr' });
}

function group(form, name) {
  const grid = make('div', { className: 'setup-fields' });
  form.append(make('fieldset', { className: 'card' }, [make('legend', { textContent: name }), grid]));
  return grid;
}

function button(text, handler) {
  const control = make('button', { type: 'button', textContent: text });
  control.addEventListener('click', handler);
  return control;
}

function cents(value) {
  const amount = number(value) * 100;
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function amounts(limit) {
  const choices = [[0, shekels.format(0)]];
  for (let value = 1000; value < limit; value += 1000) choices.push([value, shekels.format(value / 100)]);
  if (limit > 0) choices.push([limit, shekels.format(limit / 100)]);
  return choices;
}

export function renderTournamentSetup(view, intro) {
  const model = readSetup();
  const form = make('form', { className: 'setup', noValidate: true });
  const summary = make('p', { className: 'notice' });
  summary.setAttribute('role', 'status');
  if (model.status === 'registration') summary.textContent = 'הרישום פתוח בטורניר המקומי.';
  view.append(intro('פלור / הגדרות', 'הקמת טורניר', 'הגדרת טורניר אחד ושמירתו בדפדפן הזה.'), form, summary);

  const general = group(form, 'פרטי הטורניר');
  const title = field(general, 'כותרת', make('input', { value: model.title, required: true, maxLength: 100 }));
  const game = field(general, 'משחק', select([['holdem', 'No-Limit Hold’em']], model.game));
  const pace = field(general, 'קצב', select([['regular', 'Regular'], ['turbo', 'Turbo']], model.pace));
  const stack = field(general, 'ערימת פתיחה', select([['20000', 'Standard · 20,000'], ['30000', 'Deepstack · 30,000']], model.stack));
  const reentries = field(general, 'כניסות חוזרות לשחקן', select([
    ['0', '0 · Freezeout'], ['1', '1'], ['2', '2'], ['3', '3'], ['unlimited', 'ללא הגבלה'],
  ], model.reentries));

  const money = group(form, 'דמי כניסה ופרסים');
  const paidPercent = field(money, 'אחוז שחקנים בפרסים', select(
    ['10', '12', '15'].map((value) => [value, value + '%']), model.paidPercent ?? '12'));
  const guarantee = field(money, 'פרסים מובטחים (₪)', numeric((model.guarantee ?? 0) / 100, 0, 10000000, 0.01));
  const fee = field(money, 'דמי כניסה (₪)', numeric(model.fee, 0, 10000, 0.01));
  const prizes = field(money, 'מודל פרסים', select([['regular', 'רגיל'], ['bounty', 'באונטי קבוע']], model.prizes));
  const rake = field(money, 'רייק', make('select'));
  const bounty = field(money, 'באונטי', make('select'));
  const pool = field(money, 'פרסים לכניסה', make('output'));
  let rakeValue = Number(model.rake);
  let bountyValue = Number(model.bounty);
  function updateMoney() {
    const total = Math.min(1000000, Math.max(0, cents(fee.value)));
    const rakeOptions = amounts(total);
    if (!rakeOptions.some(([value]) => value === rakeValue)) rakeValue = 0;
    const bountyOptions = amounts(total - rakeValue);
    if (prizes.value !== 'bounty' || !bountyOptions.some(([value]) => value === bountyValue)) bountyValue = 0;
    for (const [control, choices, value] of [[rake, rakeOptions, rakeValue], [bounty, bountyOptions, bountyValue]]) {
      control.replaceChildren(...choices.map(([key, label]) => new Option(label, key)));
      control.value = value;
    }
    bounty.disabled = prizes.value !== 'bounty';
    pool.textContent = shekels.format((total - rakeValue - bountyValue) / 100);
  }
  rake.addEventListener('change', () => { rakeValue = Number(rake.value); updateMoney(); });
  bounty.addEventListener('change', () => { bountyValue = Number(bounty.value); updateMoney(); });
  prizes.addEventListener('change', updateMoney);
  fee.addEventListener('input', updateMoney);
  updateMoney();

  const registration = group(form, 'הרשמה מאוחרת');
  const lateMode = field(registration, 'סגירת הרשמה', select([
    ['level', 'בסוף שלב'], ['minutes', 'אחרי דקות משחק'], ['start', 'עם תחילת הטורניר'],
  ], model.lateMode));
  const lateValue = numeric(model.lateValue, 1, 1440);
  const lateLabel = make('span');
  const lateField = make('label', {}, [lateLabel, lateValue]);
  registration.append(lateField);

  const structure = group(form, 'מבנה בליינדים והפסקות');
  const levels = make('div', { className: 'setup-list' });
  const breaks = make('div', { className: 'setup-list' });
  const minutes = field(structure, 'משך שלב ברירת מחדל (דקות)', numeric(model.defaultMinutes ?? presets[model.structurePreset ?? pace.value].minutes, 1, 180));
  const preset = field(structure, 'מבנה בליינדים', select(
    Object.entries(presets).map(([key, value]) => [key, value.label]), model.structurePreset ?? pace.value));
  const levelControls = [];
  minutes.addEventListener('input', () => {
    if (minutes.validity.valid) for (const level of levelControls) level.minutes.value = minutes.value;
  });
  const breakControls = [];

  function syncLimits() {
    lateLabel.textContent = lateMode.value === 'level' ? 'מספר שלב' : 'דקות משחק';
    lateValue.max = lateMode.value === 'level' ? levelControls.length : 1440;
    lateValue.disabled = lateMode.value === 'start';
    lateField.hidden = lateValue.disabled;
    for (const row of breakControls) row.after.max = levelControls.length;
  }
  lateMode.addEventListener('change', syncLimits);

  function addLevel(data) {
    const heading = make('h3');
    const row = make('div', { className: 'setup-row' }, [heading]);
    const controls = { small: numeric(data.small, 1, 1000000000), big: numeric(data.big, 1, 1000000000),
      ante: numeric(data.ante, 0, 1000000000), minutes: numeric(data.minutes, 1, 180), heading };
    for (const [key, label] of [['small', 'בליינד קטן'], ['big', 'בליינד גדול'], ['ante', 'אנטה'], ['minutes', 'דקות']]) field(row, label, controls[key]);
    row.append(button('הסרת שלב', () => {
      if (levelControls.length <= minimumLevels) return;
      levelControls.splice(levelControls.indexOf(controls), 1);
      row.remove();
      renumber();
      addLevelButton.focus();
    }));
    levelControls.push(controls);
    levels.append(row);
    renumber();
  }

  function renumber() {
    levelControls.forEach((row, index) => {
      row.heading.textContent = 'שלב ' + (index + 1);
      const remove = row.heading.parentElement.querySelector('button');
      remove.disabled = levelControls.length <= minimumLevels;
      remove.setAttribute('aria-label', 'הסרת שלב ' + (index + 1));
    });
    syncLimits();
  }

  function addBreak(data) {
    const row = make('div', { className: 'setup-row break-row' });
    const controls = { after: numeric(data.after, 1, levelControls.length), minutes: numeric(data.minutes, 1, 180) };
    field(row, 'אחרי שלב', controls.after);
    field(row, 'משך הפסקה (דקות)', controls.minutes);
    row.append(button('הסרת הפסקה', () => {
      breakControls.splice(breakControls.indexOf(controls), 1);
      row.remove();
      addBreakButton.focus();
    }));
    breakControls.push(controls);
    breaks.append(row);
  }

  const addLevelButton = button('הוספת שלב', () => {
    if (!minutes.reportValidity()) return;
    const previous = levelControls.at(-1);
    addLevel(nextPresetLevel(presets[preset.value], minutes.value, Number(previous.big.value)));
    levelControls.at(-1).small.focus();
  });
  const addBreakButton = button('הוספת הפסקה', () => {
    addBreak({ after: levelControls.length, minutes: 10 });
    breakControls.at(-1).after.focus();
  });
  const applyTemplate = button('טעינת מבנה בליינדים', () => {
    if (!minutes.reportValidity()) return;
    if (!window.confirm('להחליף את שלבי הבליינדים וההפסקות במבנה הבליינדים שנבחר?')) return;
    levels.replaceChildren();
    breaks.replaceChildren();
    levelControls.length = 0;
    breakControls.length = 0;
    presetLevels(presets[preset.value], minutes.value).forEach(addLevel);
    addBreak({ after: 6, minutes: 10 });
  });
  structure.append(applyTemplate, levels, addLevelButton, breaks, addBreakButton);
  model.levels.forEach(addLevel);
  while (levelControls.length < minimumLevels) {
    const previous = levelControls.at(-1);
    addLevel(nextPresetLevel(presets[preset.value], minutes.value, Number(previous?.big.value ?? 0)));
  }
  model.breaks.forEach(addBreak);

  const draft = make('button', { type: 'submit', value: 'draft', textContent: 'שמירת טיוטה' });
  const open = make('button', { type: 'submit', value: 'registration', textContent: 'פתיחה לרישום מקומי', className: 'action' });
  form.append(make('div', { className: 'setup-actions' }, [draft, open]));
  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    const status = event.submitter?.value ?? 'draft';
    if (status === 'registration') {
      for (const input of form.querySelectorAll('input')) input.setCustomValidity('');
      if (!form.reportValidity()) return;
      if (!title.value.trim()) {
        title.setCustomValidity('יש להזין כותרת לטורניר.');
        title.reportValidity();
        return;
      }
      for (const row of levelControls) {
        if (number(row.big.value) < number(row.small.value)) {
          row.big.setCustomValidity('הבליינד הגדול חייב להיות לפחות בגובה הבליינד הקטן.');
          row.big.reportValidity();
          return;
        }
      }
      const seen = new Set();
      for (const row of breakControls) {
        if (seen.has(row.after.value)) {
          row.after.setCustomValidity('כבר הוגדרה הפסקה אחרי שלב זה.');
          row.after.reportValidity();
          return;
        }
        seen.add(row.after.value);
      }
    }
    const values = (rows, keys) => rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key].value])));
    try {
      const settings = {
        version: 1, status, title: title.value.trim(), game: game.value, pace: pace.value,
        stack: stack.value, reentries: reentries.value, fee: fee.value, prizes: prizes.value,
        paidPercent: paidPercent.value, guarantee: cents(guarantee.value), rake: rakeValue, bounty: bountyValue, lateMode: lateMode.value, lateValue: lateValue.value,
        structurePreset: preset.value, defaultMinutes: minutes.value, levels: values(levelControls, ['small', 'big', 'ante', 'minutes']),
        breaks: values(breakControls, ['after', 'minutes']),
      };
      saving = true;
      await updateTournament((current) => {
        if (current?.live) throw new Error('הטורניר כבר התחיל. שינוי הפסקות זמין בעמדת הניהול החי.');
        if (current?.status === 'registration' && status === 'draft' && current.entries?.length) {
          throw new Error('יש כבר כניסות רשומות לטורניר. לא ניתן להחזיר אותו לטיוטה.');
        }
        if (current?.entries?.length && ['fee', 'rake', 'bounty', 'stack', 'game'].some(
          (key) => Number.isNaN(Number(settings[key])) ? current[key] !== settings[key] : Number(current[key]) !== Number(settings[key]),
        )) throw new Error('לא ניתן לשנות משחק, ערימה או פיצול דמי כניסה לאחר רישום שחקנים.');
        return { ...current, id: current?.id ?? crypto.randomUUID(), ...settings };
      });
      if (!form.isConnected) return;
      const link = tournamentLink('setup');
      if (location.hash !== link) {
        window.location.hash = link;
        return;
      }
      summary.textContent = status === 'registration' ? 'הרישום פתוח. אפשר לקלוט שחקנים בעמדת הקופה.' : 'הטיוטה נשמרה בדפדפן הזה.';
    } catch (error) {
      summary.textContent = error.message;
    } finally { saving = false; }
  });
}
