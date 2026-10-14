#!/usr/bin/env node
/**
 * 本地预览服务器（零依赖，只用 Node 内置模块）
 *
 * 用法：
 *   node tools/serve.mjs          默认 http://localhost:8080
 *   node tools/serve.mjs 3000     指定端口
 *
 * 为什么需要它：本站通过 fetch() 读取 content/ 下的 JSON 文件。
 * 直接双击打开 index.html（file:// 协议）会被浏览器安全策略拦截，
 * 必须通过一个 HTTP 服务器访问。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const target = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('403 Forbidden');
      return;
    }

    let info;
    try {
      info = await stat(target);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(await readFile(join(ROOT, '404.html')).catch(() => '404 Not Found'));
      console.log(`  404  ${pathname}`);
      return;
    }

    const file = info.isDirectory() ? join(target, 'index.html') : target;
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
    console.log(`  200  ${pathname}`);
  } catch (err) {
    res.writeHead(500).end('500 ' + err.message);
    console.error('  500  ' + err.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  拾页 · 本地预览已启动');
  console.log(`  访问：http://localhost:${PORT}`);
  console.log('  按 Ctrl + C 停止\n');
});
