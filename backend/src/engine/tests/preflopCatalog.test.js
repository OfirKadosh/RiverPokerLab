const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");
const { createApiClient } = require("@river-poker-lab/core");
const { preflopCatalog, getPreflopChart } = require("../../preflopCatalog");
const { createPreviewApp } = require("../../dev/preview");

test("Each short-stack preset has a cash and tournament chart with compatible contexts", () => {
  const { presets, version } = preflopCatalog();
  assert.equal(presets.length, 6);
  for (const preset of presets) {
    const chart = getPreflopChart(preset.id);
    assert.equal(chart.version, version);
    assert.equal(new Set(chart.hands).size, 169);
    assert.equal(chart.trainingDeals, 24000);
    assert.equal(chart.evaluationDeals, 6000);
    assert.equal(chart.config.players.length, chart.deviations.length);
    for (const context of chart.contexts) {
      assert.equal(context.frequencies.length, 169);
      assert.equal(context.visits.length, 169);
      assert(context.frequencies.every((p) => p === null || (Number.isFinite(p) && p >= 0 && p <= 1)));
    }
    if (preset.mode === "tournament") {
      const cash = getPreflopChart(preset.id.replace("tournament-", "cash-"));
      assert.deepEqual(chart.config.players, cash.config.players);
      assert.equal(chart.valuation, "icm-prize-ev");
      assert.equal(cash.valuation, "chip-ev");
      assert(chart.config.payouts.length > 1);
      assert.equal(cash.config.payouts, undefined);
    }
  }
  assert.notDeepEqual(getPreflopChart("cash-3max-uneven").contexts, getPreflopChart("tournament-3max-uneven").contexts);
  assert.equal(getPreflopChart("constructor"), null);
});

test("The portable client loads charts through preview without dispatching a solver job", async (t) => {
  const server = createPreviewApp({ NODE_ENV: "development" }).listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, "listening");
  const client = createApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}/api` });
  const { capabilities } = await client.capabilities();
  const catalog = await client.listPreflopCharts();
  assert.equal(capabilities.preflopCharts.version, catalog.version);
  assert.equal(catalog.presets.length, 6);
  assert.equal(catalog.presets[0].contexts, undefined);
  const { chart } = await client.getPreflopChart("tournament-3max-uneven");
  assert.deepEqual(chart.config.payouts, [50, 50, 0]);
  assert.deepEqual((await client.listSolverJobs()).jobs, []);
  await assert.rejects(client.getPreflopChart("missing-chart"), { status: 404 });
  assert.throws(() => client.getPreflopChart("../capabilities"), { code: "INVALID_CONTRACT" });
});
