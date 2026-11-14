const { version, rounds, seed, hands, charts } = require("./data/preflopCharts.json");

const presets = Object.values(charts).map(({ id, label, mode, valuation }) => ({ id, label, mode, valuation }));

function preflopCatalog() {
  return { version, presets };
}

function getPreflopChart(id) {
  if (!Object.hasOwn(charts, id)) return null;
  return { version, rounds, seed, hands, ...charts[id] };
}

module.exports = { preflopCatalog, getPreflopChart };
