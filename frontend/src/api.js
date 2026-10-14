export const API_BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
const terminal = new Set(['needs_information', 'ready', 'failed', 'cancelled']);
const states = new Set(['queued', 'extracting', 'awaiting_ai_result', 'validating', 'building', ...terminal]);

export async function apiRequest(path, { json, body, method = 'GET', signal, fetcher = fetch } = {}) {
  let response;
  try {
    response = await fetcher(`${API_BASE}${path}`, {
      method, body: json === undefined ? body : JSON.stringify(json), signal,
      headers: json === undefined ? {} : { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Cannot reach the drawing API. Start the backend and check your connection.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The drawing API returned an unreadable response. Check the backend URL.'); }
  if (!response.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : data.detail?.map(issue => issue.msg).join(' ');
    const error = new Error(detail || `Drawing API request failed (${response.status}).`);
    error.status = response.status; throw error;
  }
  return data;
}

function pause(ms, signal) {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

export function createJobClient({ onUpdate = () => {}, onError = () => {}, interval = 500, fetcher = fetch } = {}) {
  let epoch = 0, controller = new AbortController(), current = null, changing = false;
  const request = (path, options = {}) => apiRequest(path, { ...options, fetcher });
  const path = job => `/api/jobs/${encodeURIComponent(job.id)}`;
  const valid = token => token === epoch;
  const invalidate = () => { epoch++; controller.abort(); controller = new AbortController(); return epoch; };
  const cancelObsolete = async job => {
    if (job && !['ready', 'failed', 'cancelled'].includes(job.state)) {
      try { await request(`${path(job)}/cancel`, { method: 'POST', json: { generation: job.generation } }); }
      catch { /* Obsolete job cleanup cannot alter the active drawing. */ }
    }
  };
  async function watch(job, token) {
    const signal = controller.signal;
    while (valid(token)) {
      if (!job?.id || !Number.isInteger(job.generation) || !states.has(job.state)) throw new Error('Invalid drawing job returned by the API.');
      current = job;
      let proposal, scene;
      if (['needs_information', 'ready'].includes(job.state) || (job.state === 'failed' && job.has_model)) {
        const result = await request(`${path(job)}/proposal`, { signal });
        proposal = result.proposal;
        if (proposal?.job_id !== job.id || proposal.source_hash !== job.source_hash || result.generation !== job.generation) throw new Error('Drawing proposal does not match the current source or generation. Refresh the job.');
      }
      if (job.state === 'ready') {
        scene = await request(`${path(job)}/scene`, { signal });
        if (scene.job_id !== job.id || scene.source_hash !== job.source_hash) throw new Error('Model does not match the current drawing source.');
      }
      if (!valid(token)) return;
      await onUpdate({ job, proposal, scene });
      if (!valid(token) || terminal.has(job.state)) return;
      await pause(interval, signal);
      if (valid(token)) job = await request(path(job), { signal });
    }
  }
  async function guarded(task, token) {
    try { await task(); }
    catch (error) {
      if (valid(token) && error.name !== 'AbortError') onError(error);
    }
  }
  const client = {
    get job() { return current; },
    get changing() { return changing; },
    request,
    async attach(job) {
      const old = current, token = invalidate(); current = null; changing = false;
      void cancelObsolete(old);
      await guarded(() => watch(job, token), token);
    },
    async start(file) {
      const old = current, token = invalidate(); current = null; changing = false;
      void cancelObsolete(old);
      const body = new FormData(); body.append('file', file);
      await guarded(async () => {
        // Keep the submission response so a cancelled/superseded upload can cancel its job ID.
        const job = await request('/api/jobs', { method: 'POST', body });
        if (!valid(token)) { await cancelObsolete(job); return; }
        await watch(job, token);
      }, token);
    },
    async action(action, payload = {}) {
      if (!current) throw new Error('No drawing job is available. Upload a drawing first.');
      if (changing) throw new Error('A correction is already being saved.');
      const job = current, token = invalidate(); changing = true;
      await guarded(async () => {
        const next = await request(`${path(job)}/${action}`, { method: 'POST', json: { generation: job.generation, ...payload } });
        if (!valid(token)) { await cancelObsolete(next); return; }
        await watch(next, token);
      }, token);
      if (valid(token)) changing = false;
    },
    async refresh() {
      if (!current) return;
      const job = current, token = invalidate();
      await guarded(async () => watch(await request(path(job), { signal: controller.signal }), token), token);
    },
    async stop() {
      const old = current; invalidate(); current = null; changing = false;
      await cancelObsolete(old);
    },
  };
  return client;
}
