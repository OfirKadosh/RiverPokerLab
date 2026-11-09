const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");
const express = require("express");
const { executeTask } = require("../../compute/tasks");
const { makeRiverSpot, riverDecision } = require("../../practice/river");
const { practiceRoutes } = require("../../practice/routes");

test("Every starter template grades legal river actions using the correct EV unit", () => {
  const expected = { cash: [["fold"], ["call"], ["fold", "call"], ["fold"]], tournament: [["fold"], ["fold"], ["call"], ["fold"]] };
  for (const mode of Object.keys(expected)) {
    for (const [index, accepted] of expected[mode].entries()) {
      for (let suit = 0; suit < 4; suit += 1) {
        let first = true;
        const { kind, input } = makeRiverSpot(mode, () => {
          if (!first) return suit;
          first = false;
          return index;
        });
        const graded = riverDecision(mode, executeTask(kind, input));
        assert.deepEqual(graded.accepted, accepted);
        if (mode === "tournament" && index === 1) {
          const [fold, call] = graded.actions;
          assert.ok(call.chipEv > fold.chipEv && call.prizeEv < fold.prizeEv);
        }
      }
    }
  }
});

test("Practice withholds feedback, scopes spots to the account, and grades only the first answer", async (t) => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: req.get("X-Test-User") }; next(); });
  app.use("/practice", practiceRoutes((req, res, kind, input) => executeTask(kind, input)));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function post(path, body, user = "alice") {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/practice${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Test-User": user },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }
  const generated = await post("/spots", { mode: "tournament" });
  assert.equal(generated.status, 201);
  const { spot } = generated.body;
  assert.deepEqual(spot.actions, ["fold", "call"]);
  for (const hidden of ["accepted", "correct", "result", "chipEv", "prizeEv", "decision"]) {
    assert.equal(JSON.stringify(generated.body).includes(`"${hidden}"`), false);
  }
  const path = `/spots/${spot.id}/answer`;
  assert.equal((await post(path, { action: "call" }, "bob")).status, 404);
  const first = await post(path, { action: "call" });
  assert.equal(first.status, 200);
  assert.equal(first.body.result.selected, "call");
  assert.deepEqual((await post(path, { action: "fold" })).body, first.body);
});
