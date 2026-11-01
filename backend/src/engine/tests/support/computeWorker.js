const { parentPort } = require('node:worker_threads');
parentPort.on('message', ({ id, kind, input }) => {
  if (kind === 'crash') process.exit(1);
  const deadline = Date.now() + (input.ms || 0);
  while (Date.now() < deadline) Math.sqrt(Date.now());
  parentPort.postMessage({ id, result: input.value });
});
