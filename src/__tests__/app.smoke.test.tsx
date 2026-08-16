// @vitest-environment jsdom
/**
 * Render smoke test: the full App against a mocked llama-server (live
 * fixtures). Catches React wiring errors (hook order, engine lifecycle)
 * that unit tests of the pure libraries cannot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// import.meta.url is not a file: URL under the jsdom environment
const fixtureDir = join(process.cwd(), 'src', 'lib', '__fixtures__');
const METRICS = readFileSync(join(fixtureDir, 'metrics-live.txt'), 'utf8');
const MODELS = readFileSync(join(fixtureDir, 'models-live.json'), 'utf8');
const SLOTS = readFileSync(join(fixtureDir, 'slots-live.json'), 'utf8');

// --- fetch mock: the live llama-server endpoints ---------------------------

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const u = String(input);
  const json = (body: string, type = 'application/json') =>
    new Response(body, { status: 200, headers: { 'Content-Type': type } });
  if (u.endsWith('/metrics')) return json(METRICS, 'text/plain; version=0.0.4');
  if (u.endsWith('/models')) return json(MODELS);
  if (u.endsWith('/slots')) return json(SLOTS);
  if (u.endsWith('/health')) return json('{"status":"ok"}');
  return new Response('not found', { status: 404 });
});
vi.stubGlobal('fetch', fetchMock);

import App from '../App';
import { settingsStore } from '../lib/settings';

beforeEach(() => {
  fetchMock.mockClear();
  settingsStore.reset();
});

afterEach(() => {
  cleanup();
});

describe('App smoke', () => {
  it('shows onboarding when no base URL is configured', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /llametrics/i })).toBeDefined();
    expect(screen.getByLabelText('llama-server base URL')).toBeDefined();
    // engine must not poll while unconfigured
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('connects and renders live widgets', async () => {
    render(<App />);
    const input = screen.getByLabelText('llama-server base URL');
    fireEvent.change(input, { target: { value: 'http://10.0.0.57:9080' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    // polling starts and all four endpoints are hit
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4), {
      timeout: 3000,
    });

    // connection goes live
    await waitFor(() => expect(screen.getAllByText('live').length).toBeGreaterThan(0), {
      timeout: 3000,
    });

    // model card from the /models fixture (also shown in the top bar)
    await waitFor(() => expect(screen.getAllByText('Qwen3.8 27B Q4').length).toBeGreaterThanOrEqual(1), {
      timeout: 3000,
    });

    // slots strip from /slots
    expect(screen.getByText('slot 0')).toBeDefined();

    // KPI + chart + counters widgets are present
    expect(screen.getByText('Generation throughput')).toBeDefined();
    expect(screen.getByText('Counters (since server start)')).toBeDefined();
  }, 15000);

  it('adds a saved endpoint from the settings modal', async () => {
    settingsStore.set({ baseUrl: 'http://10.0.0.57:9080' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.change(screen.getByPlaceholderText('name'), {
      target: { value: 'test-ep' },
    });
    fireEvent.change(screen.getByPlaceholderText('http://host:port'), {
      target: { value: 'http://10.0.0.99:8080' },
    });
    // regression: Add silently no-op'd when crypto.randomUUID was
    // unavailable (non-secure http contexts)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByDisplayValue('test-ep')).toBeDefined(), {
      timeout: 3000,
    });
    // the new endpoint shows up in the top-bar switcher
    expect(screen.getByRole('option', { name: 'test-ep' })).toBeDefined();
  }, 15000);

  it('keeps stale status with last error when the server fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    render(<App />);
    fireEvent.change(screen.getByLabelText('llama-server base URL'), {
      target: { value: 'http://10.0.0.57:9080' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(
      () => expect(screen.getAllByText(/unreachable|stale/i).length).toBeGreaterThan(0),
      { timeout: 3000 },
    );
    vi.stubGlobal('fetch', fetchMock);
  }, 15000);
});
