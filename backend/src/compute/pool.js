const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { ValidationError } = require('../engine/errors');
class ComputeError extends Error {
  constructor(message, code = 'COMPUTE_UNAVAILABLE', status = 503) {
    super(message); this.name = 'ComputeError'; this.code = code; this.status = status;
  }
}
function aborted() {
  const error = Error('Calculation cancelled.'); error.name = 'AbortError'; return error;
}
// One CPU worker per Node process; authenticated requests share a bounded FIFO queue.
class ComputePool {
  constructor({ workerPath = path.join(__dirname, 'worker.js'), timeoutMs = 45000,
    maxQueued = 8, maxPerUser = 4 } = {}) {
    this.workerPath = workerPath; this.timeoutMs = timeoutMs;
    this.maxQueued = maxQueued; this.maxPerUser = maxPerUser;
    this.queue = []; this.active = null; this.worker = null;
    this.restarting = false; this.closed = false; this.nextId = 0;
  }
  run(kind, input, { signal, owner = 'anonymous' } = {}) {
    if (signal?.aborted) return Promise.reject(aborted());
    if (this.closed) return Promise.reject(new ComputeError('Calculation service is stopping.'));
    const outstanding = [...this.queue, ...(this.active ? [this.active] : [])];
    if (this.queue.length >= this.maxQueued || outstanding.filter(job => job.owner === owner).length >= this.maxPerUser)
      return Promise.reject(new ComputeError('Calculation queue is full. Please retry shortly.', 'COMPUTE_BUSY'));
    return new Promise((resolve, reject) => {
      const job = { id: ++this.nextId, kind, input, owner, resolve, reject, signal };
      job.cancel = () => this.cancel(job, aborted());
      job.timer = setTimeout(() => this.cancel(job, new ComputeError(
        'Calculation took too long. Try fewer samples or a smaller range.', 'COMPUTE_TIMEOUT', 504,
      )), this.timeoutMs);
      signal?.addEventListener('abort', job.cancel, { once: true });
      this.queue.push(job); this.pump();
    });
  }
  settle(job, error, result) {
    clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.cancel);
    if (error) job.reject(error); else job.resolve(result);
  }
  cancel(job, error) {
    if (this.active === job) {
      this.active = null; this.settle(job, error); this.reset();
    } else {
      const index = this.queue.indexOf(job);
      if (index !== -1) { this.queue.splice(index, 1); this.settle(job, error); }
    }
  }
  reset() {
    const previous = this.worker; this.worker = null;
    if (!previous) { this.pump(); return; }
    this.restarting = true;
    previous.terminate().catch(() => {}).finally(() => {
      this.restarting = false; this.pump();
    });
  }
  pump() {
    if (this.closed || this.restarting || this.active || !this.queue.length) return;
    if (!this.worker) {
      const worker = new Worker(this.workerPath, {
        env: { NODE_ENV: process.env.NODE_ENV || 'development' },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
      this.worker = worker;
      worker.on('message', message => {
        if (worker !== this.worker || !this.active || message.id !== this.active.id) return;
        const job = this.active; this.active = null;
        const error = message.error
          ? message.error.name === 'ValidationError'
            ? new ValidationError(message.error.message)
            : new ComputeError(message.error.message)
          : null;
        this.settle(job, error, message.result);
        worker.unref(); this.pump();
      });
      const failed = () => {
        if (worker !== this.worker) return;
        if (this.active) { const job = this.active; this.active = null;
          this.settle(job, new ComputeError('Calculation worker restarted. Please retry.')); }
        this.reset();
      };
      worker.on('error', failed); worker.on('exit', failed);
    }
    this.active = this.queue.shift(); this.worker.ref();
    try {
      this.worker.postMessage({ id: this.active.id, kind: this.active.kind, input: this.active.input });
    } catch {
      const job = this.active; this.active = null;
      this.settle(job, new ComputeError('Cannot schedule this calculation.')); this.reset();
    }
  }
  async close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) this.settle(job, new ComputeError('Calculation service is stopping.'));
    if (this.active) { this.settle(this.active, new ComputeError('Calculation service is stopping.')); this.active = null; }
    const worker = this.worker; this.worker = null;
    if (worker) await worker.terminate();
  }
}
const pool = new ComputePool();
async function computeForRequest(req, res, kind, input) {
  const controller = new AbortController();
  const cancel = () => { if (!res.writableFinished) controller.abort(); };
  req.once('aborted', cancel); res.once('close', cancel);
  try {
    if (req.aborted || res.destroyed) controller.abort();
    return await pool.run(kind, input, { signal: controller.signal, owner: req.user.id });
  } finally { req.off('aborted', cancel); res.off('close', cancel); }
}
module.exports = { ComputePool, ComputeError, computeForRequest, pool };
