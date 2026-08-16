// Mock llama-server for headless render tests: serves the 4 endpoints with
// live fixtures, simulating an active generation task (n_decoded grows per
// /slots request, like a real task running at ~50 tok/s).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = join(root, 'src', 'lib', '__fixtures__');
const metrics = readFileSync(join(fx, 'metrics-live.txt'), 'utf8');
const models = JSON.parse(readFileSync(join(fx, 'models-live.json'), 'utf8'));
const slots = JSON.parse(readFileSync(join(fx, 'slots-live.json'), 'utf8'));

let t0 = Date.now();
let promptTok = 40000;
let promptSec = 36.0;
const server = createServer((req, res) => {
  const send = (body, type) => {
    res.writeHead(200, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  };
  const p = req.url.split('?')[0];
  if (p === '/metrics') {
    // simulate a prefill every ~4s: 400 tokens at 1000 tok/s
    promptTok += 400;
    promptSec += 0.4;
    // line-based: a naive .replace() would hit the # HELP line first and
    // leave the real value line untouched
    const body = metrics
      .split('\n')
      .map((line) =>
        line.startsWith('llamacpp:prompt_tokens_total')
          ? `llamacpp:prompt_tokens_total ${promptTok}`
          : line.startsWith('llamacpp:prompt_seconds_total')
            ? `llamacpp:prompt_seconds_total ${promptSec.toFixed(3)}`
            : line,
      )
      .join('\n');
    return send(body, 'text/plain; version=0.0.4');
  }
  if (p === '/models') return send(JSON.stringify(models), 'application/json');
  if (p === '/health') return send('{"status":"ok"}', 'application/json');
  if (p === '/slots') {
    // simulate a running task: slot 0 processing, ~50 tok/s since start
    const gen = Math.floor(((Date.now() - t0) / 1000) * 50);
    const out = slots.map((s) => ({
      ...s,
      is_processing: true,
      n_prompt_tokens_processed: 314,
      next_token: [
        {
          has_next_token: true,
          has_new_line: false,
          n_remain: -1,
          n_decoded: 314 + gen,
        },
      ],
    }));
    return send(JSON.stringify(out), 'application/json');
  }
  res.writeHead(404).end();
});
server.listen(9211, '127.0.0.1', () => console.log('mock llama-server on 9211'));
