// Minimal CDP probe: load page, wait, dump DOM + console errors.
const [url, waitMs = '8000'] = process.argv.slice(2);

const targets = await (
  await fetch('http://127.0.0.1:9222/json')
).json();
const page = targets.find((t) => t.type === 'page' && t.url.startsWith(url.split('/92')[0]));
if (!page) {
  console.error('no page target found');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === myId) {
        ws.removeEventListener('message', onMsg);
        resolve(m.result ?? m.error);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

const consoleMsgs = [];
const exceptions = [];
const onEvent = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleMsgs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(JSON.stringify(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
  }
};

await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', onEvent);
await send('Runtime.enable');

// wait for real-time polling ticks
await new Promise((r) => setTimeout(r, Number(waitMs)));

const dom = await send('Runtime.evaluate', {
  expression: 'document.documentElement.outerHTML',
  returnByValue: true,
});
process.stdout.write(dom.result?.value ?? '');

console.error('\n=== CONSOLE (' + consoleMsgs.length + ') ===');
for (const c of consoleMsgs.slice(0, 20)) console.error('  ' + c.slice(0, 300));
console.error('=== EXCEPTIONS (' + exceptions.length + ') ===');
for (const e of exceptions.slice(0, 10)) console.error('  ' + e.slice(0, 400));
ws.close();
process.exit(0);
