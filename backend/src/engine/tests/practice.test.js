const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");
const express = require("express");
const { executeTask } = require("../../compute/tasks");
const { makeRiverSpot, riverDecision } = require("../../practice/river");
const { practiceRoutes } = require("../../practice/routes");
const { memoryPracticeProgress } = require("../../practice/progress");

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
  app.use("/practice", practiceRoutes((req, res, kind, input) => executeTask(kind, input), memoryPracticeProgress()));
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
  assert.equal(first.body.progress.answered, 1);
  assert.deepEqual((await post(path, { action: "fold" })).body, first.body);
  const base = `http://127.0.0.1:${server.address().port}/practice/progress`;
  const reload = await fetch(base, { headers: { "X-Test-User": "alice" } });
  assert.deepEqual((await reload.json()).progress, first.body.progress);
  const other = await fetch(base, { headers: { "X-Test-User": "bob" } });
  assert.equal((await other.json()).progress.answered, 0);
});

test("Progress counts each exercise once across concurrent replies and follows the account's local day", async () => {
  let now = new Date("2026-11-09T21:59:00Z");
  const store = memoryPracticeProgress(() => now);
  const entry = (id, correct = true, timeZone = "Asia/Jerusalem") => ({
    id, correct, action: correct ? "call" : "fold", expiresAt: +now + 1_800_000, timeZone,
  });

  const [first, duplicate] = await Promise.all([
    store.record("alice", entry("shared")),
    store.record("alice", entry("shared", false)),
  ]);
  assert.equal(first.selected, duplicate.selected);
  assert.equal((await store.get("alice")).answered, 1);
  assert.equal((await store.get("alice")).correctStreak, 1);

  await Promise.all([
    store.record("alice", entry("parallel-a")),
    store.record("alice", entry("parallel-b")),
  ]);
  assert.equal((await store.get("alice")).answered, 3);
  assert.equal((await store.get("alice")).dayStreak, 1);

  now = new Date("2026-11-09T22:01:00Z");
  const secondDay = await store.record("alice", entry("second-day", false, "America/New_York"));
  assert.equal(secondDay.progress.zone, "Asia/Jerusalem");
  assert.equal(secondDay.progress.dayStreak, 2);
  assert.equal(secondDay.progress.correctStreak, 0);
  assert.equal(secondDay.progress.bestCorrectStreak, 3);

  now = new Date("2026-11-10T22:01:00Z");
  for (let i = 0; i < 6; i += 1) await store.record("alice", entry(`third-day-${i}`));
  const third = await store.get("alice");
  assert.equal(third.answered, 10);
  assert.equal(third.dayStreak, 3);
  assert.equal(third.milestones.length, 3);
  assert.equal((await store.get("bob")).answered, 0);

  now = new Date("2026-11-12T22:01:00Z");
  assert.equal((await store.get("alice")).dayStreak, 0);
  assert.equal((await store.get("alice")).bestDayStreak, 3);
  assert.equal((await store.record("alice", entry("restart"))).progress.dayStreak, 1);
  await assert.rejects(() => store.record("alice", { ...entry("expired"), expiresAt: +now }), { status: 404 });
});
