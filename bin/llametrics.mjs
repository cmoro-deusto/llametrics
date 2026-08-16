#!/usr/bin/env node
/**
 * llametrics CLI — serves the built dashboard locally.
 *
 *   llametrics [options]
 *
 *   --port <n>        listen port (default: 9100)
 *   --host <addr>     bind address (default: 127.0.0.1)
 *   --base-url <url>  prefill the llama-server base URL (UI can override)
 *   --no-open         don't auto-open the browser
 *   --version         print version and exit
 *
 * The static dist/ is served from the package; the same dist/ can also be
 * deployed to any static file server.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { networkInterfaces, platform } from 'node:os';

const here = fileURLToPath(import.meta.url);
const root = resolve(dirname(here), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const distDir = resolve(root, 'dist');

const args = process.argv.slice(2);
function flagValue(name) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}
const hasFlag = (name) => args.includes(name);

if (hasFlag('--version') || hasFlag('-v')) {
  console.log(pkg.version);
  process.exit(0);
}
if (hasFlag('--help') || hasFlag('-h')) {
  console.log(
    [
      'llametrics — local server for the llametrics dashboard',
      '',
      '  llametrics [options]',
      '',
      '  --port <n>        listen port (default: 9100)',
      '  --host <addr>     bind address (default: 127.0.0.1)',
      '  --base-url <url>  prefill the llama-server base URL',
      '  --no-open         don\'t auto-open the browser',
      '  --version         print version',
    ].join('\n'),
  );
  process.exit(0);
}

const port = Number(flagValue('--port') ?? 9100);
const host = flagValue('--host') ?? '127.0.0.1';
const baseUrl = flagValue('--base-url');
const openBrowser = !hasFlag('--no-open');

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`invalid port: ${port}`);
  process.exit(1);
}

if (!existsSync(distDir) || !existsSync(join(distDir, 'index.html'))) {
  console.error(
    [
      'llametrics: no built dashboard found (dist/ is missing).',
      '',
      '  Run a build first:',
      '    npm run build',
      '',
      '  Then retry:  llametrics',
    ].join('\n'),
  );
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = normalize(join(distDir, urlPath === '/' ? 'index.html' : urlPath));
  // path traversal guard
  if (!file.startsWith(distDir)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    // SPA fallback
    file = join(distDir, 'index.html');
  }
  const body = readFileSync(file);
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
  res.writeHead(200, headers);
  if (file.endsWith('.html') && baseUrl) {
    // prefill script: injected before the app bundle reads it
    const pre = `<script>window.__LLAMETRICS_PREFILL__=${JSON.stringify(baseUrl)};</script>\n`;
    res.end(body.toString('utf8').replace('<head>', `<head>\n    ${pre}`));
    return;
  }
  res.end(body);
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

server.listen(port, host, () => {
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const url = `http://${shown}:${port}/`;
  console.log(`llametrics ${pkg.version} serving dist/ → ${url}`);
  if (host === '0.0.0.0' || host === '::') {
    for (const ip of lanAddresses()) {
      console.log(`  on this network → http://${ip}:${port}/`);
    }
  }
  if (baseUrl) console.log(`  prefilling llama-server base URL: ${baseUrl}`);
  console.log('  ctrl+c to stop');
  if (openBrowser) {
    const [cmd, ...cmdArgs] =
      platform() === 'darwin'
        ? ['open', url]
        : platform() === 'win32'
          ? ['cmd', '/c', 'start', '', url]
          : ['xdg-open', url];
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref();
  }
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
