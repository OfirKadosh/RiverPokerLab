"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiverJobClient = exports.activeJob = void 0;
const activeJob = (job) => !!job && ['starting', 'queued', 'running', 'cancelling'].includes(job.status);
exports.activeJob = activeJob;
const message = (e) => e instanceof Error ? e.message : 'Cannot reach the calculation service.';
const status = (e) => e?.status;
// Owned by the host session scope rather than a routed view. No DOM or React dependency.
class RiverJobClient {
    constructor(request, changed, pollMs = 750, options = {}) {
        this.current = null;
        this.polling = null;
        this.closed = false;
        this.generation = 0;
        this.wantCancel = false;
        this.failures = 0;
        this.createRequestId = options.createRequestId || (() => { if (!globalThis.crypto?.randomUUID)
            throw Error("Provide a secure createRequestId adapter for this platform."); return globalThis.crypto.randomUUID(); });
        this.request = request;
        this.changed = changed;
        this.pollMs = pollMs;
    }
    publish(changes) { if (this.closed || !this.current)
        return; this.current = { ...this.current, ...changes }; this.changed(this.current); }
    schedule(fn, delay = this.pollMs) { clearTimeout(this.timer); if (!this.closed)
        this.timer = setTimeout(fn, delay); }
    async start(key, input, maxIterations) {
        if (this.closed || (0, exports.activeJob)(this.current))
            return;
        clearTimeout(this.timer);
        this.polling?.abort();
        const generation = ++this.generation;
        this.wantCancel = false;
        this.failures = 0;
        this.current = { key, id: null, requestId: this.createRequestId(), status: 'starting', progress: { phase: 'starting', completedIterations: 0, maxIterations }, error: null, connectionError: null };
        this.changed(this.current);
        const requestId = this.current.requestId;
        try {
            let data;
            const send = () => this.request('/river-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, requestId }) });
            try {
                data = await send();
            }
            catch (e) {
                const code = status(e);
                if (code !== undefined && code >= 400 && code < 500)
                    throw e;
                data = await send();
            }
            if (!data.job)
                throw Error('The calculation service returned no job.');
            // Do not abandon a task created while Cancel, logout or unmount was requested.
            if (this.closed || generation !== this.generation) {
                void this.request(`/river-jobs/${data.job.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => { });
                return;
            }
            this.current = { ...this.current, id: data.job.id };
            if (this.wantCancel) {
                await this.cancel();
                return;
            }
            this.accept(data.job);
            if ((0, exports.activeJob)(this.current))
                this.schedule(() => void this.poll(), 0);
        }
        catch (e) {
            if (this.closed || generation !== this.generation)
                return;
            // Recover a POST whose response was lost without creating another calculation.
            if (status(e) === undefined || (status(e) ?? 0) >= 500) {
                try {
                    const list = await this.request('/river-jobs');
                    const job = list.jobs?.find(j => j.requestId === requestId);
                    if (job && !this.closed && generation === this.generation) {
                        this.current = { ...this.current, id: job.id };
                        if (this.wantCancel)
                            await this.cancel();
                        else
                            this.accept(job);
                        return;
                    }
                }
                catch { }
            }
            this.publish({ status: 'unavailable', error: message(e) });
        }
    }
    accept(job) {
        this.failures = 0;
        this.publish({ id: job.id, status: job.status, progress: job.progress, error: job.error?.message || null, connectionError: null, solution: job.solution });
        if (['queued', 'running'].includes(job.status) || job.status === 'completed' && !job.solution)
            this.schedule(() => void this.poll());
    }
    async poll() {
        if (this.closed || !this.current?.id)
            return;
        const generation = this.generation;
        const controller = new AbortController();
        this.polling = controller;
        try {
            const data = await this.request(`/river-jobs/${this.current.id}`, { signal: controller.signal });
            if (this.closed || controller.signal.aborted || generation !== this.generation || this.wantCancel)
                return;
            if (!data.job)
                throw Error('The calculation service returned no job.');
            this.accept(data.job);
        }
        catch (e) {
            if (this.closed || controller.signal.aborted || generation !== this.generation)
                return;
            if (status(e) === 404 || status(e) === 401 || status(e) === 403) {
                this.publish({ status: 'unavailable', error: message(e), connectionError: null });
                return;
            }
            this.failures++;
            this.publish({ connectionError: 'Connection interrupted. Reconnecting to your calculation…' });
            this.schedule(() => void this.poll(), Math.min(10000, this.pollMs * 2 ** Math.min(this.failures, 4)));
        }
    }
    async cancel() {
        if (this.closed || !(0, exports.activeJob)(this.current))
            return;
        this.wantCancel = true;
        clearTimeout(this.timer);
        this.polling?.abort();
        this.publish({ status: 'cancelling', connectionError: null });
        if (!this.current?.id)
            return;
        const generation = this.generation;
        try {
            const data = await this.request(`/river-jobs/${this.current.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (this.closed || generation !== this.generation)
                return;
            if (!data.job)
                throw Error('Cancellation was not confirmed.');
            this.wantCancel = false;
            this.accept(data.job);
        }
        catch (e) {
            if (this.closed || generation !== this.generation)
                return;
            if (status(e) === 404 || status(e) === 401 || status(e) === 403) {
                this.publish({ status: 'unavailable', error: message(e) });
                return;
            }
            this.publish({ connectionError: 'Cancellation is not confirmed. Retrying…' });
            this.schedule(() => void this.cancel(), 2000);
        }
    }
    invalidate(key) { if (!this.current || this.current.key === key)
        return; if ((0, exports.activeJob)(this.current)) {
        if (!this.wantCancel)
            void this.cancel();
    }
    else {
        this.current = null;
        this.changed(null);
    } }
    dispose() {
        this.closed = true;
        this.wantCancel = true;
        clearTimeout(this.timer);
        this.polling?.abort();
        if (this.current?.id && (0, exports.activeJob)(this.current))
            void this.request(`/river-jobs/${this.current.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => { });
    }
}
exports.RiverJobClient = RiverJobClient;
