#!/usr/bin/env node
/**
 * ============================================================================
 * 拾页 · 一键部署脚本
 * ----------------------------------------------------------------------------
 * 它做的事情：
 *   1. 写入站点地址（sitemap.xml / robots.txt / 各页面的 canonical 与 og:url）
 *   2. 初始化本地 git 仓库并提交
 *   3. 通过 GitHub API 创建远程仓库（若已存在则跳过）
 *   4. 推送代码到 main 分支
 *   5. 开启 GitHub Pages（带 --domain 时同时绑定自定义域名）
 *   6. 抹掉本地 git 配置里残留的 Token
 *
 * 用法：
 *   node tools/deploy.mjs --user=你的GitHub用户名 --repo=仓库名 --token=你的Token
 *
 *   --domain 是可选参数。不填就用 GitHub Pages 默认地址
 *   （https://用户名.github.io/仓库名/），网站照样完整上线。
 *   以后哪天想绑自定义域名了，补上 --domain=你的域名 重跑一次即可，
 *   脚本会把全站地址一起改过去，不用手工动任何文件。
 *
 * 参数也可以不带等号（--user 张三），或者用环境变量：
 *   GITHUB_USER / GITHUB_REPO / GITHUB_DOMAIN / GITHUB_TOKEN
 *
 * 额外开关：
 *   --force        远程有本地没有的提交时，强制覆盖远程分支
 *                  ⚠️ 会丢弃远程上那个提交——如果它来自 Pages CMS 后台，就等于
 *                     丢掉你在后台的编辑。默认行为是自动合并远程改动，不需要它。
 *   --skip-pages   只推代码，不调用接口开启 Pages
 *   --dry-run      只做检查，不实际提交和推送
 * ============================================================================
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER = 'YOUR-NAME.us.kg';
const API = 'https://api.github.com';

/* ----------------------------- 输出工具 ----------------------------- */
const C = {
  reset: '\u001b[0m', dim: '\u001b[2m', bold: '\u001b[1m',
  red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m'
};
const log = {
  step: (n, m) => console.log(`\n${C.cyan}${C.bold}[${n}]${C.reset} ${C.bold}${m}${C.reset}`),
  ok: (m) => console.log(`  ${C.green}✓${C.reset} ${m}`),
  info: (m) => console.log(`  ${C.dim}·${C.reset} ${m}`),
  warn: (m) => console.log(`  ${C.yellow}!${C.reset} ${m}`),
  err: (m) => console.log(`  ${C.red}✗${C.reset} ${m}`)
};

/* ----------------------------- 参数解析 ----------------------------- */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const body = a.slice(2);
    if (body.includes('=')) {
      const idx = body.indexOf('=');
      out[body.slice(0, idx)] = body.slice(idx + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      out[body] = argv[++i];
    } else {
      out[body] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cfg = {
  user: args.user || process.env.GITHUB_USER || '',
  repo: args.repo || process.env.GITHUB_REPO || '',
  domain: (args.domain || process.env.GITHUB_DOMAIN || '').toLowerCase().trim(),
  token: args.token || process.env.GITHUB_TOKEN || '',
  force: Boolean(args.force),
  skipPages: Boolean(args['skip-pages']),
  dryRun: Boolean(args['dry-run'])
};

function fail(msg, hint) {
  console.error(`\n${C.red}${C.bold}部署中止：${C.reset}${msg}`);
  if (hint) console.error(`${C.dim}${hint}${C.reset}`);
  process.exit(1);
}

/* ----------------------------- 参数校验 ----------------------------- */
console.log(`${C.bold}拾页 · 一键部署${C.reset}`);
console.log(`${C.dim}工作目录：${ROOT}${C.reset}`);

if (!cfg.user) fail('缺少 GitHub 用户名（--user）');
if (!cfg.repo) fail('缺少仓库名（--repo）');
if (!cfg.dryRun && !cfg.token) fail('缺少 Token（--token）', '需要一个具备 repo 权限的 GitHub Personal Access Token');

if (cfg.domain && (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(cfg.domain) || !cfg.domain.includes('.'))) {
  fail(`域名格式不正确：${cfg.domain}`, '应为类似 mysite.us.kg 的形式，全部小写，不要带 https:// 或结尾斜杠');
}
if (!/^[A-Za-z0-9._-]+$/.test(cfg.repo)) fail(`仓库名不合法：${cfg.repo}`);
if (!/^[A-Za-z0-9-]+$/.test(cfg.user)) fail(`GitHub 用户名不合法：${cfg.user}`);

/* 站点地址：带 --domain 时用自定义域名，否则用 GitHub Pages 默认地址。
   不填域名也能完整上线，以后想绑域名时补上参数重跑一次即可。 */
const TEMP_BASE = `${cfg.user}.github.io/${cfg.repo}`;
const HOST = cfg.domain || TEMP_BASE;
const NEW_BASE = `https://${HOST}`;

/* 站点地址散落在 sitemap、robots 和各页面的 canonical / og:url 里，
   换地址时必须一起改，否则会指向错误位置 */
const URL_FILES = [
  'sitemap.xml', 'robots.txt',
  'index.html', 'post.html', 'archive.html', 'tags.html', 'search.html', 'about.html', '404.html'
];

/* 从 sitemap 的第一条 <loc> 读出当前写入的站点地址，作为替换的基准。
   站点地址可能已被写过（不是初始占位符），所以不能只认占位符。 */
function detectCurrentBase() {
  const abs = join(ROOT, 'sitemap.xml');
  if (!existsSync(abs)) return '';
  const m = readFileSync(abs, 'utf8').match(/<loc>\s*(https?:\/\/[^<\s]+?)\s*<\/loc>/);
  return m ? m[1].replace(/\/+$/, '') : '';
}

/* 把站点地址从旧值整体替换为新值，返回被改动的文件数 */
function rewriteBase(from, to) {
  if (!from || from === to) return 0;
  let changed = 0;
  URL_FILES.forEach(function (f) {
    const abs = join(ROOT, f);
    if (!existsSync(abs)) return;
    const before = readFileSync(abs, 'utf8');
    const after = before.split(from).join(to);
    if (before !== after) { writeFileSync(abs, after, 'utf8'); changed++; }
  });
  return changed;
}

const OLD_BASE = detectCurrentBase();

if (cfg.dryRun) {
  log.warn('dry-run 模式：只做参数与文件检查，不改写任何文件、不执行 git 操作');
  console.log(`  ${C.dim}当前站点地址：${OLD_BASE || '（文件中未找到）'}${C.reset}`);
  console.log(`  ${C.dim}目标站点地址：${NEW_BASE}${C.reset}`);
  if (OLD_BASE && OLD_BASE !== NEW_BASE) {
    const hits = URL_FILES.reduce(function (n, f) {
      const abs = join(ROOT, f);
      return existsSync(abs) ? n + readFileSync(abs, 'utf8').split(OLD_BASE).length - 1 : n;
    }, 0);
    log.info(`将替换 ${hits} 处地址（分布在 ${URL_FILES.length} 个文件中）`);
  } else {
    log.info('站点地址无需变更');
  }
  const cnameAbs = join(ROOT, 'CNAME');
  log.info('CNAME：' + (cfg.domain
    ? `将写入 ${cfg.domain}`
    : (existsSync(cnameAbs) ? '将被移除' : '保持不存在')));
  log.ok('参数校验通过，可以正式执行');
  process.exit(0);
}

log.step('1/6', '写入站点地址');
console.log(`  ${C.dim}用户名　　：${cfg.user}${C.reset}`);
console.log(`  ${C.dim}仓库名　　：${cfg.repo}${C.reset}`);
console.log(`  ${C.dim}自定义域名：${cfg.domain || '（暂不使用）'}${C.reset}`);
console.log(`  ${C.dim}站点地址　：${NEW_BASE}${C.reset}`);

const cnamePath = join(ROOT, 'CNAME');
if (cfg.domain) {
  writeFileSync(cnamePath, cfg.domain + '\n', 'utf8');
  log.ok('CNAME 已写入 ' + cfg.domain);
} else if (existsSync(cnamePath)) {
  rmSync(cnamePath);
  log.warn('未使用自定义域名，已移除 CNAME 文件（避免 GitHub Pages 绑定错误域名）');
}

if (OLD_BASE && OLD_BASE !== NEW_BASE) {
  const n = rewriteBase(OLD_BASE, NEW_BASE);
  log.ok(`站点地址已由 ${OLD_BASE} 切换为 ${NEW_BASE}（改动 ${n} 个文件）`);
} else {
  log.info(`站点地址保持为 ${NEW_BASE}`);
}

/* 兼容直接从模板拿到的仓库：地址还写着占位符 */
const ph = rewriteBase(PLACEHOLDER, HOST);
if (ph) log.ok(`占位符已在 ${ph} 个文件中替换为 ${HOST}`);

/* ----------------------------- git 操作 ----------------------------- */
function git(argsArr, opts = {}) {
  return execFileSync('git', argsArr, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.quiet ? 'pipe' : 'inherit',
    ...opts
  });
}

log.step('2/6', '初始化本地仓库');

try {
  git(['--version'], { stdio: 'pipe' });
} catch {
  fail('未检测到 git，请先安装 Git 后重试', '下载地址：https://git-scm.com/downloads');
}

if (!existsSync(join(ROOT, '.git'))) {
  git(['init', '-b', 'main'], { stdio: 'pipe' });
  log.ok('已初始化 git 仓库（main 分支）');
} else {
  log.info('已存在 .git，跳过初始化');
}

const getCfg = (key) => {
  try { return execFileSync('git', ['config', key], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return ''; }
};
if (!getCfg('user.email')) {
  execFileSync('git', ['config', 'user.email', 'deploy@localhost'], { cwd: ROOT });
  log.info('已设置本地提交邮箱');
}
if (!getCfg('user.name')) {
  execFileSync('git', ['config', 'user.name', cfg.user], { cwd: ROOT });
  log.info('已设置本地提交用户名');
}

/* 让中文文件名正常显示；Windows 上 schannel 偶发 TLS 中断，改用 OpenSSL 更稳 */
execFileSync('git', ['config', 'core.quotepath', 'false'], { cwd: ROOT });
if (process.platform === 'win32') {
  try {
    execFileSync('git', ['config', 'http.sslBackend', 'openssl'], { cwd: ROOT, stdio: 'pipe' });
    log.info('Windows 平台：已切换 git 的 TLS 后端为 OpenSSL');
  } catch { /* 旧版本 git 可能不支持，忽略 */ }
}
execFileSync('git', ['config', 'http.version', 'HTTP/1.1'], { cwd: ROOT });

log.step('3/6', '提交本地改动');
execFileSync('git', ['add', '-A'], { cwd: ROOT });
let hasChanges = true;
try {
  execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT });
  hasChanges = false;
} catch { hasChanges = true; }

if (hasChanges) {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  execFileSync('git', ['commit', '-m', `部署：更新站点内容与配置（${stamp}）`], { cwd: ROOT, stdio: 'pipe' });
  log.ok('已创建提交');
} else {
  try {
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, stdio: 'pipe' });
    log.info('没有新改动需要提交');
  } catch {
    execFileSync('git', ['commit', '--allow-empty', '-m', '部署：初始化仓库'], { cwd: ROOT, stdio: 'pipe' });
    log.ok('已创建初始提交');
  }
}

/* ----------------------------- GitHub API ----------------------------- */
async function api(path, method = 'GET', body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'shiye-static-site-deployer',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { message: text }; } }
  return { ok: res.ok, status: res.status, data };
}

log.step('4/6', '确认远程仓库');

const me = await api('/user');
if (me.status === 401) fail('Token 无效或已过期', '请重新生成 Personal Access Token');
if (!me.ok) fail(`读取 GitHub 账号失败（HTTP ${me.status}）：${me.data?.message || ''}`);
log.ok(`已登录 GitHub：${me.data.login}（${me.data.name || '未填写昵称'}）`);

const created = await api('/user/repos', 'POST', {
  name: cfg.repo,
  description: '个人知识库 · 纯静态站点，内容由 Pages CMS 管理',
  homepage: `https://${HOST}`,
  private: false,
  has_issues: true,
  has_wiki: false,
  has_projects: false,
  auto_init: false
});

if (created.status === 201) {
  log.ok(`已创建公开仓库 ${cfg.user}/${cfg.repo}`);
} else if (created.status === 422) {
  log.info('仓库已存在，将直接推送到该仓库');
} else {
  log.warn(`创建仓库返回 HTTP ${created.status}：${created.data?.message || ''}`);
  log.info('若仓库确实存在，可忽略此提示');
}

/* ----------------------------- 推送 ----------------------------- */
log.step('5/6', '推送代码到 GitHub');

const repoUrl = `https://github.com/${cfg.user}/${cfg.repo}.git`;
const authUrl = `https://${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.token)}@github.com/${cfg.user}/${cfg.repo}.git`;

try {
  execFileSync('git', ['remote', 'remove', 'origin'], { cwd: ROOT, stdio: 'pipe' });
} catch { /* 本来就没有 origin，忽略 */ }
try { execFileSync('git', ['remote', 'add', 'origin', authUrl], { cwd: ROOT, stdio: 'pipe' }); }
catch { execFileSync('git', ['remote', 'add', 'origin', repoUrl], { cwd: ROOT, stdio: 'pipe' }); }

/* 网络类瞬时故障（代理超时、TLS 中断、连接被重置等）可以自动重试，
   与"远程有本地没有的提交"是两回事，不能混为一谈 */
const NETWORK_ERROR = /CONNECT tunnel failed|Empty reply from server|schannel|Connection reset|Connection timed out|Could not resolve host|Failed to connect|SSL|TLS|50[234]/i;
const CONFLICT_ERROR = /non-fast-forward|fetch first|rejected|behind its remote/i;

/* 远程比本地新，绝大多数情况是"刚在 Pages CMS 后台改过内容"——
   后台每保存一次就会往仓库提交一次。这时必须把远程改动合并下来再推，
   绝不能直接覆盖，否则会丢掉后台里的编辑。 */
function mergeRemote() {
  try {
    execFileSync('git', ['fetch', 'origin', 'main'], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    return { ok: false, message: '拉取远程失败' };
  }

  let ahead = '0';
  try {
    ahead = execFileSync('git', ['rev-list', '--count', 'HEAD..FETCH_HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch { /* 保持默认 */ }

  if (!ahead || ahead === '0') return { ok: false, message: '远程没有本地缺失的提交' };

  log.info(`远程有 ${ahead} 个本地没有的提交（可能来自 Pages CMS 后台），先合并再推送`);
  try {
    execFileSync('git', ['merge', '--no-edit', 'FETCH_HEAD'], { cwd: ROOT, stdio: 'pipe' });
    log.ok('已自动合并远程改动，后台内容不会丢失');
    return { ok: true };
  } catch (e) {
    try { execFileSync('git', ['merge', '--abort'], { cwd: ROOT, stdio: 'pipe' }); } catch { /* 忽略 */ }
    return { ok: false, message: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

function sleepSync(ms) {
  const buf = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buf), 0, 0, ms);
}

function tryPush(extra = []) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      execFileSync('git', ['push', '-u', 'origin', 'main', ...extra], { cwd: ROOT, stdio: 'pipe' });
      return { ok: true };
    } catch (e) {
      const msg = `${e.stdout || ''}${e.stderr || ''}`;

      if (CONFLICT_ERROR.test(msg)) {
        log.warn('远程仓库有本地没有的提交');
        if (cfg.force) {
          log.warn('检测到 --force：将强制覆盖远程 main 分支');
          log.warn('注意：后台（Pages CMS）里改过的内容会一并被丢弃');
          execFileSync('git', ['push', '-u', 'origin', 'main', '--force'], { cwd: ROOT, stdio: 'inherit' });
          return { ok: true };
        }
        const m = mergeRemote();
        if (m.ok) continue;
        return { ok: false, reason: 'conflict', message: m.message };
      }

      if (NETWORK_ERROR.test(msg) && attempt < 3) {
        log.warn(`网络中断（第 ${attempt} 次），3 秒后自动重试…`);
        sleepSync(3000);
        continue;
      }

      return { ok: false, reason: 'error', message: msg };
    }
  }
  return { ok: false, reason: 'error', message: '重试 3 次后仍未成功' };
}

let result;
try { result = tryPush(); }
catch (e) { result = { ok: false, reason: 'error', message: e.message }; }

if (!result.ok) {
  execFileSync('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: ROOT, stdio: 'pipe' });
  if (result.reason === 'conflict') {
    fail('代码未能推送成功：远程有本地没有的改动，自动合并也未能完成',
      '最常见的原因是你刚在 Pages CMS 后台改过内容。请在项目目录里手动执行：\n' +
      '    git fetch origin main && git merge FETCH_HEAD\n' +
      '  手动解决冲突后，再重跑本脚本。\n' +
      `  ⚠️ 不要随手加 --force：它会覆盖远程分支，后台里改过的内容会一起丢失。\n` +
      `  合并失败的详情：${(result.message || '').trim().split('\n').slice(-1)[0]}`);
  }
  fail('代码未能推送成功（网络原因）',
    '已自动重试 3 次仍未成功。请检查网络或代理设置后重新执行本脚本。\n' +
    `  错误详情：${(result.message || '').trim().split('\n').slice(-1)[0]}`);
}
log.ok(`已推送到 ${repoUrl}`);

/* ----------------------------- Pages ----------------------------- */
log.step('6/6', '开启 GitHub Pages 并绑定域名');

if (cfg.skipPages) {
  log.info('已指定 --skip-pages，跳过此步');
} else {
  const pagesBody = { source: { branch: 'main', path: '/' } };
  let r = await api(`/repos/${cfg.user}/${cfg.repo}/pages`, 'POST', pagesBody);
  if (r.status === 201) log.ok('已开启 GitHub Pages');
  else if (r.status === 409) log.info('GitHub Pages 已开启，跳过创建');
  else if (r.status === 403) log.warn('Token 缺少 Pages 写权限，请稍后在仓库设置里手动开启');
  else log.warn(`开启 Pages 返回 HTTP ${r.status}：${r.data?.message || ''}`);

  if (cfg.domain) {
    r = await api(`/repos/${cfg.user}/${cfg.repo}/pages`, 'PUT', {
      cname: cfg.domain,
      source: { branch: 'main', path: '/' }
    });
    if (r.ok) log.ok(`已绑定自定义域名 ${cfg.domain}`);
    else log.warn(`绑定域名返回 HTTP ${r.status}：${r.data?.message || ''}`);
    log.info('HTTPS 证书会在 DNS 生效后由 GitHub 自动签发，稍后可在仓库 Pages 设置里勾选「Enforce HTTPS」');
  } else {
    log.info('本次未绑定自定义域名，站点使用 GitHub Pages 默认地址');
    log.info('以后想绑域名时，补上 --domain=你的域名 重跑本脚本即可');
  }
}

/* ----------------------------- 清理 Token ----------------------------- */
try {
  execFileSync('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: ROOT, stdio: 'pipe' });
  log.ok('已从本地 git 配置中清除 Token');
} catch { /* 忽略 */ }

/* ----------------------------- 结果 ----------------------------- */
console.log('\n' + '─'.repeat(64));
console.log(`${C.green}${C.bold}部署完成${C.reset}\n`);
console.log(`  仓库地址：https://github.com/${cfg.user}/${cfg.repo}`);
console.log(`  站点地址：${NEW_BASE}/`);
if (cfg.domain) console.log(`  自定义域名：https://${cfg.domain}`);
console.log('\n' + `${C.bold}接下来：${C.reset}`);

if (cfg.domain) {
  console.log('  1. Cloudflare 里添加 DNS 解析，把域名指向 GitHub Pages');
  console.log('     · A     @    185.199.108.153 / 185.199.109.153');
  console.log('                  185.199.110.153 / 185.199.111.153');
  console.log('     · CNAME www  ' + cfg.user + '.github.io');
  console.log('     · 代理状态先设为「仅 DNS」（灰色云朵）');
  console.log('  2. 等 DNS 生效后，到仓库 Settings → Pages 勾选「Enforce HTTPS」');
} else {
  console.log('  1. 等 1～2 分钟后访问上面的站点地址，确认显示正常');
  console.log('  2. 想改内容就到后台 https://app.pagescms.org 编辑');
  console.log('  3. 以后想绑自定义域名时，补上 --domain=你的域名 重跑本脚本即可');
}
console.log('\n  详细说明见项目里的《部署手册.md》与《README.md》');
console.log('─'.repeat(64) + '\n');
