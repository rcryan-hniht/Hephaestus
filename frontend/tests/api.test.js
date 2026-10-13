import { describe, expect, test } from 'bun:test';
import { createJobClient } from '../src/api.js';

const job = (id, state, generation = 1) => ({ id, state, generation, source_hash: 'a'.repeat(64), source_kind: 'svg', has_model: state === 'ready' });
const scene = id => ({ job_id: id, source_hash: 'a'.repeat(64), revision: 1 });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const file = () => new File(['<svg/>'], 'plan.svg', { type: 'image/svg+xml' });

describe('drawing jobs', () => {
  test('submits the file and retrieves a ready scene for that source', async () => {
    let complete;
    const client = createJobClient({ interval: 0, onUpdate: value => { complete = value; }, fetcher: async (url, options) => {
      if (url === '/api/jobs') {
        expect(options.body.get('file').name).toBe('plan.svg');
        return response(job('j', 'queued'), 202);
      }
      if (url === '/api/jobs/j') return response(job('j', 'ready'));
      if (url.endsWith('/scene')) return response(scene('j'));
      if (url.endsWith('/proposal')) return response({ proposal: { job_id: 'j', components: [] } });
      throw new Error('Unexpected API request');
    } });
    await client.start(file());
    expect(complete.job.state).toBe('ready');
    expect(complete.scene.job_id).toBe('j');
  });

  test('missing information pauses polling and sends explicit confirmation with generation', async () => {
    let state, values;
    const client = createJobClient({ interval: 0, onUpdate: update => { state = update.job.state; }, fetcher: async (url, options) => {
      if (url === '/api/jobs') return response(job('j', 'needs_information'), 202);
      if (url.endsWith('/proposal')) return response({ proposal: { job_id: 'j' } });
      if (url.endsWith('/answers')) { values = JSON.parse(options.body); return response(job('j', 'ready', 2), 202); }
      if (url.endsWith('/scene')) return response(scene('j'));
      throw new Error('Unexpected polling after a terminal state');
    } });
    await client.start(file());
    expect(state).toBe('needs_information');
    await client.action('answers', { values: { floor_height: 3 } });
    expect(values).toEqual({ generation: 1, values: { floor_height: 3 } });
    expect(state).toBe('ready');
  });

  test('late upload after replacement cannot publish and cancels the obsolete job', async () => {
    let resolveOld, cancelled = false;
    const delivered = [];
    const client = createJobClient({ interval: 0, onUpdate: update => delivered.push(update.job.id), fetcher: async (url, options) => {
      if (url === '/api/jobs') {
        if (options.body.get('file').name === 'old.svg') return await new Promise(resolve => { resolveOld = resolve; });
        return response(job('new', 'failed'), 202);
      }
      if (url === '/api/jobs/old/cancel') { cancelled = true; return response(job('old', 'cancelled', 2)); }
      throw new Error('Unexpected request');
    } });
    const old = client.start(new File(['<svg/>'], 'old.svg'));
    await client.start(file());
    resolveOld(response(job('old', 'queued'), 202));
    await old;
    expect(delivered).toEqual(['new']);
    expect(cancelled).toBe(true);
    expect(client.job.id).toBe('new');
  });

  test('late scene after cancellation cannot replace a model', async () => {
    let resolveScene, entered;
    const reachedScene = new Promise(resolve => { entered = resolve; });
    let modelUpdates = 0;
    const client = createJobClient({ onUpdate: update => { if (update.scene) modelUpdates++; }, fetcher: async url => {
      if (url === '/api/jobs') return response(job('j', 'ready'), 202);
      if (url.endsWith('/proposal')) return response({ proposal: { job_id: 'j' } });
      if (url.endsWith('/scene')) { entered(); return await new Promise(resolve => { resolveScene = resolve; }); }
      throw new Error('Unexpected request');
    } });
    const pending = client.start(file());
    await reachedScene;
    await client.stop();
    resolveScene(response(scene('j')));
    await pending;
    expect(modelUpdates).toBe(0);
  });

  test('rejects a scene returned for another source', async () => {
    const errors = [];
    const client = createJobClient({ onError: error => errors.push(error.message), fetcher: async url => {
      if (url === '/api/jobs') return response(job('j', 'ready'), 202);
      if (url.endsWith('/scene')) return response(scene('other'));
      if (url.endsWith('/proposal')) return response({ proposal: { job_id: 'j' } });
    } });
    await client.start(file());
    expect(errors[0]).toContain('source');
  });

  test('backend rejection exposes an actionable message without inventing progress', async () => {
    const errors = [];
    const client = createJobClient({ onError: error => errors.push(error.message), fetcher: async () => response({ detail: 'Unsupported drawing' }, 422) });
    await client.start(file());
    expect(errors).toEqual(['Unsupported drawing']);
  });
});
