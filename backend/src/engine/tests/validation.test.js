const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { ValidationError, normalizeCard, validateSimulationInput, validateCalculateInput } = require('../validation');
const { runMonteCarloSimulation } = require('../engine');
const app = require('./support/app');
const Spot = require('../../models/Spot');

const validInput = () => ({
  players: [['Ah', 'Ac'], ['Kh', 'Kc']],
  board: ['2s', '3d', '7h', '8c', '9s'],
  potSize: 100,
  callAmount: 50,
  iterations: 1
});

test('Normalizes case, surrounding whitespace, and ten notation', () => {
  assert.equal(normalizeCard(' aH '), 'Ah');
  assert.equal(normalizeCard('10D'), 'Td');
  const input = { ...validInput(), players: [[' ah ', 'aC'], ['kH', 'kc']] };
  const original = structuredClone(input);
  assert.deepEqual(validateCalculateInput(input).players, validInput().players);
  assert.deepEqual(input, original);
});

for (const value of ['', ' ', '1h', '11s', 'Ax', 'Ahh', 'A h', 'joker', 12, null, {}, ['Ah']]) {
  test(`Rejects invalid card ${JSON.stringify(value)}`, () => {
    assert.throws(() => normalizeCard(value), ValidationError);
  });
}

const invalidInputs = [
  ['missing body', undefined],
  ['null body', null],
  ['array body', []],
  ['missing players', { ...validInput(), players: undefined }],
  ['one player', { ...validInput(), players: [['Ah', 'Ac']] }],
  ['ten players', { ...validInput(), players: Array(10).fill(['Ah', 'Ac']) }],
  ['non-array hand', { ...validInput(), players: ['Ah,Ac', ['Kh', 'Kc']] }],
  ['empty hand', { ...validInput(), players: [[], ['Kh', 'Kc']] }],
  ['three Holdem cards', { ...validInput(), players: [['Ah', 'Ac', 'Ad'], ['Kh', 'Kc']] }],
  ['two Omaha cards', { ...validInput(), gameType: 'omaha' }],
  ['five Omaha cards', { ...validInput(), gameType: 'omaha', players: [['Ah','Ac','Ad','As','2h'],['Kh','Kc','Kd','Ks']] }],
  ['invalid card in hand', { ...validInput(), players: [['??', 'Ac'], ['Kh', 'Kc']] }],
  ['null card', { ...validInput(), players: [[null, 'Ac'], ['Kh', 'Kc']] }],
  ['non-array board', { ...validInput(), board: '2s' }],
  ['null board', { ...validInput(), board: null }],
  ['one board card', { ...validInput(), board: ['2s'] }],
  ['two board cards', { ...validInput(), board: ['2s', '3d'] }],
  ['six board cards', { ...validInput(), board: ['2s','3d','7h','8c','9s','Ts'] }],
  ['invalid board card', { ...validInput(), board: ['2s','3d','no'] }],
  ['duplicate within hand', { ...validInput(), players: [['Ah', 'aH'], ['Kh', 'Kc']] }],
  ['duplicate across players', { ...validInput(), players: [['Ah', 'Ac'], [' ah ', 'Kc']] }],
  ['duplicate on board', { ...validInput(), board: ['2s', '3d', '2S'] }],
  ['hand and board collision', { ...validInput(), board: ['aH', '3d', '7h'] }],
  ['ten aliases collision', { ...validInput(), players: [['10h', 'TH'], ['Kh', 'Kc']] }],
  ['unknown game', { ...validInput(), gameType: 'stud' }],
  ['unknown mode', { ...validInput(), gameMode: 'other' }],
  ['zero iterations', { ...validInput(), iterations: 0 }],
  ['negative iterations', { ...validInput(), iterations: -1 }],
  ['fractional iterations', { ...validInput(), iterations: 1.5 }],
  ['string iterations', { ...validInput(), iterations: '10' }],
  ['excessive iterations', { ...validInput(), iterations: 100001 }],
  ['infinite iterations', { ...validInput(), iterations: Infinity }],
  ['missing pot', { ...validInput(), potSize: undefined }],
  ['negative pot', { ...validInput(), potSize: -1 }],
  ['string pot', { ...validInput(), potSize: '100' }],
  ['NaN pot', { ...validInput(), potSize: NaN }],
  ['infinite pot', { ...validInput(), potSize: Infinity }],
  ['missing call', { ...validInput(), callAmount: undefined }],
  ['negative call', { ...validInput(), callAmount: -1 }],
  ['infinite call', { ...validInput(), callAmount: Infinity }],
  ['overflow total', { ...validInput(), potSize: Number.MAX_VALUE, callAmount: Number.MAX_VALUE }],
  ['non-boolean save flag', { ...validInput(), saveSpot: 'false' }]
];
for (const [name, input] of invalidInputs) {
  test(`Validation rejects ${name}`, () => {
    assert.throws(() => validateCalculateInput(input), ValidationError);
  });
}

test('Accepts every supported board length and default options', () => {
  for (const length of [0, 3, 4, 5]) {
    const result = validateCalculateInput({ ...validInput(), board: validInput().board.slice(0, length) });
    assert.equal(result.board.length, length);
  }
  const result = validateCalculateInput({ players: validInput().players, potSize: 0, callAmount: 0 });
  assert.equal(result.gameType, 'holdem');
  assert.equal(result.gameMode, 'cash');
  assert.equal(result.iterations, 5000);
  assert.equal(result.saveSpot, false);
  assert.deepEqual(result.board, []);
});

test('Accepts nine distinct Omaha hands and a five-card board', () => {
  const deck = [...'23456789TJQKA'].flatMap(rank => [...'schd'].map(suit => rank + suit));
  const players = Array.from({ length: 9 }, (_, index) => deck.slice(index * 4, index * 4 + 4));
  assert.equal(validateSimulationInput(players, deck.slice(36, 41), 'omaha', 1).players.length, 9);
});

test('Direct engine calls reject invalid cards, counts, duplicates, and iterations', () => {
  assert.throws(() => runMonteCarloSimulation([['xx', 'Ac'], ['Kh', 'Kc']]), ValidationError);
  assert.throws(() => runMonteCarloSimulation([['Ah'], ['Kh', 'Kc']]), ValidationError);
  assert.throws(() => runMonteCarloSimulation([['Ah', 'Ac'], ['ah', 'Kc']]), ValidationError);
  assert.throws(() => runMonteCarloSimulation(validInput().players, [], 'holdem', 0), ValidationError);
});

test('Holdem engine accepts normalized cards and preserves winner calculation', () => {
  assert.deepEqual(runMonteCarloSimulation([[' ah ', 'AC'], ['kh', 'KC']], ['2S','3D','7H','8C','9S'], 'holdem', 1), [
    { playerIndex: 0, equity: 100 }, { playerIndex: 1, equity: 0 }
  ]);
});

test('Omaha still requires using two hole cards when evaluating a royal board', () => {
  const results = runMonteCarloSimulation([['2h','3d','4c','5h'], ['9s','8s','6d','7c']], ['As','Ks','Qs','Js','Ts'], 'omaha', 1);
  assert.deepEqual(results, [{ playerIndex: 0, equity: 0 }, { playerIndex: 1, equity: 100 }]);
});

test('Holdem split pots remain supported', () => {
  assert.deepEqual(runMonteCarloSimulation(validInput().players, ['As','Ks','Qs','Js','Ts'], 'holdem', 1), [
    { playerIndex: 0, equity: 50 }, { playerIndex: 1, equity: 50 }
  ]);
});

let server;
let baseUrl;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
async function post(input) {
  return fetch(`${baseUrl}/api/calculate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
  });
}

test('API returns structured HTTP 400 for invalid requests', async () => {
  for (const [name, input] of invalidInputs) {
    const response = await post(input);
    assert.equal(response.status, 400, name);
    const body = await response.json();
    assert.equal(body.success, false, name);
    assert.equal(typeof body.error, 'string', name);
  }
});

test('API returns JSON for malformed JSON input', async () => {
  const response = await fetch(`${baseUrl}/api/calculate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken'
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).success, false);
});

test('API keeps existing equity and EV response fields', async () => {
  const response = await post(validInput());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.results, [{ playerIndex: 0, equity: 100 }, { playerIndex: 1, equity: 0 }]);
  assert.deepEqual(body.evResults, [{ playerIndex: 0, ev: 100, decision: 'Call' }, { playerIndex: 1, ev: -50, decision: 'Fold' }]);
  assert.equal(body.savedSpotId, null);
});

test('API passes normalized cards to persistence without connecting to MongoDB', async (context) => {
  let saved;
  context.mock.method(Spot.prototype, 'save', async function () {
    saved = this.toObject();
    return this;
  });
  const response = await post({ ...validInput(), players: [[' ah ', 'aC'], ['kh', 'KC']], saveSpot: true });
  assert.equal(response.status, 200);
  assert.deepEqual(saved.players, validInput().players);
  assert.deepEqual(saved.board, validInput().board);
  assert.ok((await response.json()).savedSpotId);
});
