#!/usr/bin/env node
/**
 * ============================================================================
 * 拾页 · 一键部署脚本
 * ----------------------------------------------------------------------------
 * 它做的事情：
 *   1. 把域名写入 CNAME / sitemap.xml / robots.txt
 *   2. 初始化本地 git 仓库并提交
 *   3. 通过 GitHub API 创建远程仓库（若已存在则跳过）
 *   4. 推送代码到 main 分支
 *   5. 开启 GitHub Pages 并绑定自定义域名
 *   6. 抹掉本地 git 配置里残留的 Token
 *
 * 用法：
 *   node tools/deploy.mjs --user=你的GitHub用户名 --repo=仓库名 \
 *        --domain=你的域名.us.kg --token=你的Token
 *
 * 参数也可以不带等号（--user 张三），或者用环境变量：
 *   GITHUB_USER / GITHUB_REPO / GITHUB_DOMAIN / GITHUB_TOKEN
 *
 * 额外开关：
 *   --force        远程仓库已有内容且冲突时，强制覆盖推送
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

/* 域名未确定时，先用 GitHub Pages 临时地址，域名定下来后再跑一次本脚本即可切换 */
const TEMP_BASE = `${cfg.user}.github.io/${cfg.repo}`;
const HOST = cfg.domain || TEMP_BASE;

if (cfg.dryRun) {
  log.warn('dry-run 模式：只做参数与文件检查，不改写任何文件、不执行 git 操作');
  console.log(`  ${C.dim}即将写入的站点地址：https://${HOST}${C.reset}`);
  ['CNAME', 'sitemap.xml', 'robots.txt'].forEach(function (f) {
    const abs = join(ROOT, f);
    if (f === 'CNAME' && !cfg.domain) {
      log.info('CNAME：域名未定，' + (existsSync(abs) ? '将被移除' : '已不存在'));
      return;
    }
    if (!existsSync(abs)) { log.err(`${f}：文件不存在`); return; }
    const txt = readFileSync(abs, 'utf8');
    const hits = txt.split(PLACEHOLDER).length - 1;
    log.info(`${f}：${hits > 0 ? '将替换 ' + hits + ' 处占位符' : '无需替换'}`);
  });
  log.ok('参数校验通过，可以正式执行');
  process.exit(0);
}

log.step('1/6', '写入站点配置');
console.log(`  ${C.dim}用户名　　：${cfg.user}${C.reset}`);
console.log(`  ${C.dim}仓库名　　：${cfg.repo}${C.reset}`);
console.log(`  ${C.dim}自定义域名：${cfg.domain || '（未确定，先用临时地址）'}${C.reset}`);
console.log(`  ${C.dim}站点地址　：https://${HOST}${C.reset}`);

function replaceInFile(relPath, from, to) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) { log.warn(`${relPath} 不存在，跳过`); return; }
  const before = readFileSync(abs, 'utf8');
  const after = before.split(from).join(to);
  if (before !== after) {
    writeFileSync(abs, after, 'utf8');
    log.ok(`${relPath} 已更新`);
  } else {
    log.info(`${relPath} 无需改动`);
  }
}

const cnamePath = join(ROOT, 'CNAME');
if (cfg.domain) {
  writeFileSync(cnamePath, cfg.domain + '\n', 'utf8');
  log.ok('CNAME 已写入 ' + cfg.domain);
} else if (existsSync(cnamePath)) {
  rmSync(cnamePath);
  log.warn('域名未确定，已移除 CNAME 文件（避免 GitHub Pages 绑定错误域名）');
}

replaceInFile('sitemap.xml', PLACEHOLDER, HOST);
replaceInFile('robots.txt', PLACEHOLDER, HOST);

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

function tryPush(extra = []) {
  try {
    execFileSync('git', ['push', '-u', 'origin', 'main', ...extra], { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch (e) {
    const msg = `${e.stdout || ''}${e.stderr || ''}`;
    if (/non-fast-forward|fetch first|rejected/i.test(msg)) {
      log.warn('远程仓库已有内容，与本地历史冲突');
      if (cfg.force) {
        log.warn('检测到 --force，将强制覆盖远程 main 分支');
        execFileSync('git', ['push', '-u', 'origin', 'main', '--force'], { cwd: ROOT, stdio: 'inherit' });
        return true;
      }
      return false;
    }
    throw new Error(msg);
  }
}

let pushed = false;
try { pushed = tryPush(); }
catch (e) {
  log.err('推送失败：' + e.message);
}

if (!pushed) {
  execFileSync('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: ROOT, stdio: 'pipe' });
  fail('代码未能推送成功',
    cfg.force
      ? '请检查 Token 是否具备 repo 写入权限。'
      : `远程 ${cfg.user}/${cfg.repo} 可能已存在内容。若确认要覆盖，请加参数 --force 重新执行。`);
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
    log.info('域名尚未确定，本次不绑定自定义域名');
    log.info('定下前缀后，重新执行本脚本并加上 --domain=你的前缀.us.kg 即可切换');
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
console.log(`  仓库地址　：https://github.com/${cfg.user}/${cfg.repo}`);
console.log(`  站点地址　：https://${TEMP_BASE}/`);
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
  console.log('  1. 先访问上面的临时地址，确认网站显示正常（约需 1～2 分钟生效）');
  console.log('  2. 想好域名前缀后，重新执行本脚本并补上 --domain=你的前缀.us.kg');
  console.log('     脚本会自动写回 CNAME 并完成绑定，其余步骤见《部署手册.md》');
}
console.log('\n  详细步骤见项目里的《部署手册.md》');
console.log('─'.repeat(64) + '\n');
