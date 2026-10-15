/* ==========================================================================
   全站脚本
   纯原生 JavaScript，无框架、无构建步骤。
   内容全部来自 content/ 目录下的 JSON 文件（由可视化后台维护）。
   站点名称、地址等一律不写死在本文件里，一律读 content/site.json，
   这样改站名、换托管平台都不用动代码。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- 配置 ---------------- */
  var DATA = {
    site: 'content/site.json',
    posts: 'content/posts.json',
    about: 'content/about.json'
  };

  var state = {
    site: null,
    posts: [],
    about: null
  };

  /* ---------------- 基础工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function param(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || '';
    } catch (e) {
      var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value) ? null : value;
    var s = String(value).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function fmtDate(value) {
    var d = parseDate(value);
    if (!d) return '';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function fmtDateShort(value) {
    var d = parseDate(value);
    if (!d) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function timeAgo(value) {
    var d = parseDate(value);
    if (!d) return '';
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days < 0) return fmtDateShort(value);
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 30) return days + ' 天前';
    if (days < 365) return Math.floor(days / 30) + ' 个月前';
    return Math.floor(days / 365) + ' 年前';
  }

  /* 去除 Markdown 标记，用于摘要与搜索 */
  function stripMd(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s{0,3}[-*+]\s+/gm, '')
      .replace(/^\s{0,3}\d+\.\s+/gm, '')
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
      .replace(/\|/g, ' ')
      .replace(/^-{3,}$/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function readingTime(markdown) {
    var plain = stripMd(markdown);
    var cjk = (plain.match(/[\u4e00-\u9fa5]/g) || []).length;
    var words = plain.replace(/[\u4e00-\u9fa5]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    var minutes = Math.ceil(cjk / 380 + words / 220);
    return Math.max(1, minutes);
  }

  function effectiveSummary(post) {
    if (post.summary && String(post.summary).trim()) return String(post.summary).trim();
    var plain = stripMd(post.body);
    return plain.length > 96 ? plain.slice(0, 96) + '…' : plain;
  }

  function mdToHtml(markdown) {
    if (!window.marked) return '<p>' + esc(markdown || '') + '</p>';
    try {
      return window.marked.parse(String(markdown || ''));
    } catch (e) {
      console.error('[站点] Markdown 渲染失败', e);
      return '<p>' + esc(markdown || '') + '</p>';
    }
  }

  function loadJSON(path) {
    return fetch(path, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(path + ' 读取失败（HTTP ' + res.status + '）');
      return res.json();
    });
  }

  function toast(message) {
    var el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);' +
      'background:var(--text);color:var(--bg);padding:10px 20px;border-radius:999px;' +
      'font-size:14px;z-index:999;box-shadow:var(--shadow-lg);opacity:0;transition:opacity .25s';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 300);
    }, 1800);
  }

  /* ---------------- 主题与皮肤 ----------------
     两层互相独立，可以任意组合：
       明暗模式 data-theme 由访客自己切换，只记在访客的浏览器里；
       主题皮肤 data-skin 由站长在后台选定，全站统一。
     皮肤名单必须与 style.css 第 20 节、.pages.yml 的下拉选项保持一致。 */
  var SKINS = ['ink', 'corporate', 'magazine', 'minimal', 'warm', 'terminal'];
  var DEFAULT_SKIN = 'ink';
  var SKIN_KEY = 'gucheng-skin';
  var THEME_KEY = 'gucheng-theme';
  /* 站点曾用名时期的旧键。读一次迁到新键后即删除，
     这样老访客自己选过的深浅模式不会被重置。 */
  var THEME_KEY_LEGACY = 'shiye-theme';

  /* 改名过的文章：旧访问标识 → 新访问标识。
     改动已发布文章的标识会让旧链接失效，所以旧的登记在这里，
     访问时自动跳转到新地址。（见 renderPost） */
  var LEGACY_SLUGS = {
    'welcome-to-shiye': 'welcome-to-gucheng'
  };

  function normalizeSkin(name) {
    var n = String(name == null ? '' : name).trim().toLowerCase();
    return SKINS.indexOf(n) >= 0 ? n : DEFAULT_SKIN;
  }

  /* 浏览器地址栏的配色跟随当前皮肤的实际背景色，而不是写死的值 */
  function syncThemeColor() {
    var meta = $('meta[name="theme-color"]');
    if (!meta) return;
    var bg = '';
    try { bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); } catch (e) { bg = ''; }
    if (bg) meta.setAttribute('content', bg);
  }

  function applySkin(name, options) {
    var skin = normalizeSkin(name);
    document.documentElement.setAttribute('data-skin', skin);
    syncThemeColor();
    /* 预览页切换时不写入本地缓存，否则会影响正常页面刷新时的预置 */
    if (!options || options.remember !== false) {
      try { localStorage.setItem(SKIN_KEY, skin); } catch (e) { /* 忽略 */ }
    }
    return skin;
  }

  function initSkin() {
    var saved = null;
    try { saved = localStorage.getItem(SKIN_KEY); } catch (e) { /* 忽略 */ }
    applySkin(saved || DEFAULT_SKIN, { remember: false });
  }

  function initTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
      /* 旧键迁移：页面头部的内联脚本通常已经处理过，这里兜一次底 */
      if (!saved) {
        var old = localStorage.getItem(THEME_KEY_LEGACY);
        if (old) {
          localStorage.setItem(THEME_KEY, old);
          localStorage.removeItem(THEME_KEY_LEGACY);
          saved = old;
        }
      }
    } catch (e) { /* 忽略 */ }
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = saved || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    syncThemeColor();
    $$('.theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-label', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
      btn.setAttribute('title', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
    });
  }

  function bindThemeToggle() {
    $$('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略 */ }
      });
    });
  }

  /* ---------------- 图标 ---------------- */
  var ICON = {
    search: '<svg class="s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    moon: '<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>',
    sun: '<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'
  };

  /* ---------------- 数据 ---------------- */
  function normalizePosts(raw) {
    var list = (raw && raw.posts) || [];
    if (!Array.isArray(list)) list = [];
    return list.map(function (p) {
      p = p || {};
      return {
        title: String(p.title || '未命名'),
        slug: String(p.slug || '').trim(),
        date: p.date || '',
        category: p.category ? String(p.category).trim() : '',
        tags: Array.isArray(p.tags) ? p.tags.filter(Boolean).map(String) : [],
        summary: p.summary || '',
        cover: p.cover || '',
        draft: p.draft === true || p.draft === 'true',
        body: String(p.body || '')
      };
    }).filter(function (p) { return p.slug; })
      .sort(function (a, b) {
        var da = parseDate(a.date), db = parseDate(b.date);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      });
  }

  function publishedPosts() {
    return state.posts.filter(function (p) { return !p.draft; });
  }

  function postUrl(slug) { return 'post.html?p=' + encodeURIComponent(slug); }

  function collectTags(posts) {
    var map = {};
    posts.forEach(function (p) {
      p.tags.forEach(function (t) { map[t] = (map[t] || 0) + 1; });
    });
    return Object.keys(map).map(function (t) { return { name: t, count: map[t] }; })
      .sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'); });
  }

  function collectCategories(posts) {
    var map = {};
    posts.forEach(function (p) {
      if (!p.category) return;
      map[p.category] = (map[p.category] || 0) + 1;
    });
    return Object.keys(map).map(function (c) { return { name: c, count: map[c] }; });
  }

  /* ---------------- 页面骨架 ---------------- */
  function renderHeader(site) {
    var host = $('#site-header');
    if (!host) return;
    var page = document.body.dataset.page || '';
    var navItems = (site.nav && site.nav.length ? site.nav : [
      { label: '首页', href: 'index.html' },
      { label: '归档', href: 'archive.html' },
      { label: '标签', href: 'tags.html' },
      { label: '关于', href: 'about.html' }
    ]);

    var navHtml = navItems.map(function (item) {
      var href = item.href || '#';
      var isCurrent = (page === 'home' && href === 'index.html') ||
        href.replace('.html', '') === page;
      return '<a href="' + esc(href) + '"' + (isCurrent ? ' aria-current="page"' : '') + '>' +
        esc(item.label || '') + '</a>';
    }).join('');

    host.innerHTML =
      '<div class="container">' +
        '<a class="brand" href="index.html" aria-label="返回首页">' +
          '<span class="brand-mark">拾</span>' +
          '<span class="brand-text">' +
            '<span class="brand-name">' + esc(site.title || '本站') + '</span>' +
            (site.subtitle ? '<span class="brand-sub">' + esc(site.subtitle) + '</span>' : '') +
          '</span>' +
        '</a>' +
        '<nav class="nav" id="site-nav" aria-label="主导航">' + navHtml + '</nav>' +
        '<div class="header-actions">' +
          '<a class="icon-btn" href="search.html" aria-label="搜索" title="搜索">' + ICON.search + '</a>' +
          '<button class="icon-btn theme-toggle" type="button">' + ICON.moon + ICON.sun + '</button>' +
          '<button class="icon-btn menu-toggle" type="button" aria-label="打开菜单" aria-expanded="false" aria-controls="site-nav">' + ICON.menu + '</button>' +
        '</div>' +
      '</div>';

    var toggle = $('.menu-toggle', host);
    var nav = $('#site-nav', host);
    if (toggle && nav) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('is-open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      nav.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') nav.classList.remove('is-open');
      });
    }
  }

  function renderFooter(site) {
    var host = $('#site-footer');
    if (!host) return;
    var links = (site.links || []).filter(function (l) { return l && l.url; });
    var year = new Date().getFullYear();

    host.innerHTML =
      '<div class="container">' +
        '<div class="footer-inner">' +
          '<div class="footer-about">' +
            '<strong>' + esc(site.title || '本站') + (site.subtitle ? ' · ' + esc(site.subtitle) : '') + '</strong>' +
            esc(site.authorBio || site.description || '') +
          '</div>' +
          '<div class="footer-meta">' +
            /* 站内链接不新开窗口；只有站外地址才加 target / rel */
            (links.length ? '<div class="footer-links">' + links.map(function (l) {
              var ext = /^https?:/i.test(l.url || '');
              return '<a href="' + esc(l.url) + '"' +
                (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
                esc(l.label || l.url) + '</a>';
            }).join('') + '</div>' : '') +
            (site.author ? '<div>作者：' + esc(site.author) + '</div>' : '') +
            '<div>' + esc(site.footerText || '') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="footer-bottom">' +
          '<span>© ' + year + ' ' + esc(site.title || '') + ' · 保留所有权利</span>' +
          /* 托管说明不在代码里写死任何平台名：后台可改 site.hostingNote，
             留空则用下面这句平台中立的兜底文案 */
          '<span>' + (site.icp ? esc(site.icp) + ' · ' : '') +
            esc(site.hostingNote || '纯静态站点 · 无服务器、无数据库') + '</span>' +
        '</div>' +
      '</div>';
  }

  function renderBackToTop() {
    if ($('.to-top')) return;
    var btn = document.createElement('button');
    btn.className = 'to-top';
    btn.type = 'button';
    btn.setAttribute('aria-label', '回到顶部');
    btn.innerHTML = ICON.up;
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(btn);

    var onScroll = function () {
      btn.classList.toggle('is-visible', window.scrollY > 520);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function applyAccent(site) {
    var color = (site.accent || '').trim();
    /* 留空或填 auto 时，沿用当前主题皮肤自带的配色。
       填了具体色值才覆盖主色，深色与浅色底由该色推导。 */
    if (!color || color.toLowerCase() === 'auto') return;
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return;
    document.documentElement.style.setProperty('--accent', color);
    if (color.length === 7) {
      var r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
      var dark = '#' + [r, g, b].map(function (c) {
        return pad(Math.max(0, Math.round(c * 0.78)));
      }).join('');
      document.documentElement.style.setProperty('--accent-strong', dark);
      document.documentElement.style.setProperty('--accent-soft', 'rgba(' + r + ',' + g + ',' + b + ',0.10)');
    }
  }

  function renderMeta(site, payload) {
    var title = payload && payload.title;
    document.title = title ? title + ' · ' + (site.title || '') : (site.title || '') +
      (site.subtitle ? ' · ' + site.subtitle : '');
    var desc = (payload && payload.description) || site.description || '';
    var setMeta = function (attr, key, value) {
      if (!value) return;
      var el = document.querySelector('meta[' + attr + '="' + key + '"]');
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', value);
    };
    setMeta('name', 'description', desc);
    setMeta('name', 'keywords', site.keywords || '');
    setMeta('name', 'author', site.author || '');
    setMeta('property', 'og:title', document.title);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:type', (payload && payload.ogType) || 'website');
  }

  /* ---------------- 规范链接（canonical / og:url） ----------------
     站点地址一律不在 HTML 里写死，而是运行时按当前真实访问地址推导：
     换域名、换托管平台、换子路径都能自动对准，不需要改任何页面。
     因此 HTML 里也不放静态兜底值——一来会被这里覆盖，二来一旦平台换了，
     写死的旧地址反而会变成错误的规范链接。
     唯一例外是 sitemap.xml 与 robots.txt：站点地图协议要求绝对地址，
     无法运行时推导，换平台时需手工更新（文件头部已注明）。 */
  function canonicalUrl() {
    var path = location.pathname.replace(/index\.html$/, '');
    var query = '';
    /* 只有文章页的 ?p= 属于内容本身；其余页面的查询参数只是筛选状态，
       不能让它变成独立的规范地址 */
    if (/post\.html$/.test(path)) {
      var m = /[?&]p=([^&]+)/.exec(location.search);
      if (m) query = '?p=' + m[1];
    }
    return location.origin + path + query;
  }

  function setCanonical() {
    var href = canonicalUrl();

    var link = document.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', href);

    var og = document.querySelector('meta[property="og:url"]');
    if (!og) {
      og = document.createElement('meta');
      og.setAttribute('property', 'og:url');
      document.head.appendChild(og);
    }
    og.setAttribute('content', href);
  }

  /* ---------------- 组件 ---------------- */
  function postCardHtml(post, options) {
    options = options || {};
    var summary = effectiveSummary(post);
    var tags = post.tags.slice(0, 4).map(function (t) {
      return '<a class="tag-mini" href="tags.html?t=' + encodeURIComponent(t) + '"># ' + esc(t) + '</a>';
    }).join('');

    return '<article class="post-card">' +
      '<div class="post-meta">' +
        (post.category ? '<span class="cat-chip">' + esc(post.category) + '</span>' : '') +
        '<time datetime="' + esc(fmtDateShort(post.date)) + '">' + esc(fmtDate(post.date)) + '</time>' +
        '<span class="dot"></span>' +
        '<span>' + readingTime(post.body) + ' 分钟阅读</span>' +
        (post.draft ? '<span class="draft-badge">草稿</span>' : '') +
      '</div>' +
      '<h3 class="post-title"><a class="post-link" href="' + postUrl(post.slug) + '">' + esc(post.title) + '</a></h3>' +
      (summary ? '<p class="post-summary">' + (options.highlight ? highlightText(summary, options.highlight) : esc(summary)) + '</p>' : '') +
      (tags ? '<div class="post-tags">' + tags + '</div>' : '') +
    '</article>';
  }

  function highlightText(text, keyword) {
    var safe = esc(text);
    if (!keyword) return safe;
    var kw = String(keyword).trim();
    if (!kw) return safe;
    var re = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  function skeletonHtml(n) {
    var out = '';
    for (var i = 0; i < (n || 3); i++) {
      out += '<div class="skeleton"><div class="bar w70"></div><div class="bar w90"></div><div class="bar w40"></div></div>';
    }
    return out;
  }

  function emptyHtml(title, text, actionHref, actionLabel) {
    return '<div class="empty-state"><span class="big">空</span>' +
      '<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
      (actionHref ? '<a class="btn btn--ghost" href="' + esc(actionHref) + '">' + esc(actionLabel || '返回首页') + '</a>' : '') +
      '</div>';
  }

  function sidebarHtml(site, posts) {
    var tags = collectTags(posts);
    var recent = posts.slice(0, 5);
    var avatarInner = site.avatar
      ? '<img src="' + esc(site.avatar) + '" alt="' + esc(site.author || '头像') + '" loading="lazy">'
      : esc((site.title || '拾').slice(0, 1));

    var links = (site.links || []).filter(function (l) { return l && l.url; });
    var tagHtml = tags.slice(0, 18).map(function (t) {
      return '<a href="tags.html?t=' + encodeURIComponent(t.name) + '">' + esc(t.name) +
        '<span class="count">' + t.count + '</span></a>';
    }).join('');

    return '<div class="widget widget--profile profile-card">' +
        '<div class="profile-avatar">' + avatarInner + '</div>' +
        '<h3 class="profile-name">' + esc(site.author || site.title || '') + '</h3>' +
        '<p class="profile-bio">' + esc(site.authorBio || site.description || '') + '</p>' +
        (links.length ? '<div class="profile-links">' + links.map(function (l) {
          return '<a class="btn btn--ghost" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label || '链接') + '</a>';
        }).join('') + '</div>' : '') +
      '</div>' +
      (tagHtml ? '<div class="widget"><h3 class="widget-title">标签</h3><div class="tag-cloud">' + tagHtml + '</div></div>' : '') +
      (recent.length ? '<div class="widget widget--recent"><h3 class="widget-title">最近更新</h3><ul class="recent-list">' +
        recent.map(function (p) {
          return '<li><a href="' + postUrl(p.slug) + '">' + esc(p.title) +
            '<time datetime="' + esc(fmtDateShort(p.date)) + '">' + esc(timeAgo(p.date)) + ' · ' + readingTime(p.body) + ' 分钟</time></a></li>';
        }).join('') + '</ul></div>' : '');
  }

  /* ---------------- 文章目录 ---------------- */
  function buildToc(container) {
    var heads = $$('h2, h3', container).filter(function (h) {
      return !h.closest('.toc');
    });
    if (heads.length < 2) return '';

    var used = {};
    heads.forEach(function (h, i) {
      var base = String(h.textContent || '').trim().toLowerCase()
        .replace(/[^\u4e00-\u9fa5a-z0-9\s-]/g, '').replace(/\s+/g, '-');
      var id = base || ('section-' + (i + 1));
      if (used[id]) { used[id] += 1; id = id + '-' + used[id]; } else { used[id] = 1; }
      h.id = id;
    });

    var items = heads.map(function (h) {
      var lv = h.tagName === 'H3' ? ' class="lv3"' : '';
      return '<li' + lv + '><a href="#' + esc(h.id) + '">' + esc(h.textContent.trim()) + '</a></li>';
    }).join('');

    return '<nav class="toc" aria-label="文章目录"><h2 class="toc-title">目录</h2><ol>' + items + '</ol></nav>';
  }

  /* ---------------- 分页 ---------------- */
  function renderPagination(host, total, perPage, current) {
    if (!host) return;
    var pages = Math.max(1, Math.ceil(total / perPage));
    if (pages <= 1) { host.innerHTML = ''; return; }

    var parts = [];
    var btn = function (label, page, opts) {
      opts = opts || {};
      if (opts.disabled) return '<button type="button" disabled>' + label + '</button>';
      if (opts.current) return '<span class="is-current" aria-current="page">' + label + '</span>';
      return '<a href="?page=' + page + '" data-page="' + page + '">' + label + '</a>';
    };

    parts.push(btn('上一页', current - 1, { disabled: current <= 1 }));

    var list = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - current) <= 1) list.push(i);
    }
    var prev = 0;
    list.forEach(function (i) {
      if (prev && i - prev > 1) parts.push('<span class="ellipsis">…</span>');
      parts.push(btn(String(i), i, { current: i === current }));
      prev = i;
    });

    parts.push(btn('下一页', current + 1, { disabled: current >= pages }));

    host.innerHTML = parts.join('');

    $$('a[data-page]', host).forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var page = Number(a.dataset.page);
        var url = new URL(window.location.href);
        url.searchParams.set('page', page);
        window.location.href = url.toString();
      });
    });
  }

  /* ---------------- 首页 ---------------- */
  function renderHome(site) {
    var posts = publishedPosts();
    var perPage = Math.max(1, Number(site.perPage) || 6);
    var totalPages = Math.max(1, Math.ceil(posts.length / perPage));
    var current = Math.min(totalPages, Math.max(1, Number(param('page')) || 1));
    var slice = posts.slice((current - 1) * perPage, current * perPage);

    var hero = $('#home-hero');
    if (hero) {
      var tags = collectTags(posts);
      var cats = collectCategories(posts);
      hero.innerHTML =
        '<span class="hero-eyebrow">' + esc(site.subtitle || '个人知识库') + '</span>' +
        '<h1>' + esc(site.heroTitle || site.description || '') + '</h1>' +
        '<p>' + esc(site.heroText || site.description || '') + '</p>' +
        '<div class="hero-stats">' +
          '<div class="hero-stat"><b>' + posts.length + '</b><span>篇文章</span></div>' +
          '<div class="hero-stat"><b>' + cats.length + '</b><span>个分类</span></div>' +
          '<div class="hero-stat"><b>' + tags.length + '</b><span>个标签</span></div>' +
        '</div>';
    }

    var list = $('#post-list');
    var pager = $('#pagination');
    if (!list) return;

    if (!posts.length) {
      list.innerHTML = emptyHtml('还没有文章', '登录 Pages CMS 后台，在「文章管理」里添加第一篇。');
      return;
    }

    list.innerHTML = slice.map(function (p) { return postCardHtml(p); }).join('');
    renderPagination(pager, posts.length, perPage, current);

    var side = $('#sidebar-host');
    if (side) side.innerHTML = sidebarHtml(site, posts);
  }

  /* ---------------- 文章页 ---------------- */
  function renderPost(site) {
    var slug = param('p');
    var host = $('#article-host');
    if (!host) return;

    var post = null;
    for (var i = 0; i < state.posts.length; i++) {
      if (state.posts[i].slug === slug) { post = state.posts[i]; break; }
    }

    if (!post && LEGACY_SLUGS[slug]) {
      /* 文章改过访问标识：旧链接自动跳到新地址，避免出现死链 */
      location.replace(postUrl(LEGACY_SLUGS[slug]));
      return;
    }

    if (!post || post.draft) {
      host.innerHTML = '<div class="error-state"><span class="big">404</span>' +
        '<h3>' + (post && post.draft ? '这篇文章还是草稿' : '文章不存在') + '</h3>' +
        '<p>' + (post && post.draft ? '作者尚未发布，稍后再来看看吧。' : '链接可能已经失效，或者文章的访问标识被修改过。') + '</p>' +
        '<a class="btn" href="index.html">返回首页</a></div>';
      document.title = '文章不存在 · ' + (site.title || '');
      return;
    }

    var bodyHtml = mdToHtml(post.body);
    var prose = document.createElement('div');
    prose.className = 'prose';
    prose.innerHTML = bodyHtml;
    var toc = buildToc(prose);

    var all = publishedPosts();
    var idx = all.findIndex(function (p) { return p.slug === post.slug; });
    var newer = idx > 0 ? all[idx - 1] : null;
    var older = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;

    var related = all.filter(function (p) {
      if (p.slug === post.slug) return false;
      var shared = p.tags.filter(function (t) { return post.tags.indexOf(t) >= 0; }).length;
      var sameCat = p.category && p.category === post.category ? 1 : 0;
      p.__score = shared * 2 + sameCat;
      return p.__score > 0;
    }).sort(function (a, b) { return b.__score - a.__score; }).slice(0, 3);

    var navHtml = '<nav class="post-nav" aria-label="上一篇和下一篇">' +
      (older
        ? '<a href="' + postUrl(older.slug) + '"><span class="dir">← 更早一篇</span><span class="ttl">' + esc(older.title) + '</span></a>'
        : '<a class="disabled" href="#"><span class="dir">← 更早一篇</span><span class="ttl">已经是第一篇</span></a>') +
      (newer
        ? '<a class="next" href="' + postUrl(newer.slug) + '"><span class="dir">更新一篇 →</span><span class="ttl">' + esc(newer.title) + '</span></a>'
        : '<a class="next disabled" href="#"><span class="dir">更新一篇 →</span><span class="ttl">已经是最新一篇</span></a>') +
      '</nav>';

    var relatedHtml = related.length
      ? '<section class="related"><div class="section-head section-head--plain"><h2>相关阅读</h2></div>' +
        '<div class="post-list">' + related.map(function (p) { return postCardHtml(p); }).join('') + '</div></section>'
      : '';

    host.innerHTML =
      '<div class="crumbs">' +
        '<a href="index.html">首页</a><span class="sep">/</span>' +
        (post.category ? '<a href="tags.html">' + esc(post.category) + '</a><span class="sep">/</span>' : '') +
        '<span>正文</span>' +
      '</div>' +
      '<header class="article-header">' +
        (post.category ? '<span class="cat-chip">' + esc(post.category) + '</span>' : '') +
        '<h1>' + esc(post.title) + '</h1>' +
        '<div class="article-meta">' +
          '<time datetime="' + esc(fmtDateShort(post.date)) + '">' + esc(fmtDate(post.date)) + '</time>' +
          '<span class="dot"></span><span>' + readingTime(post.body) + ' 分钟阅读</span>' +
          '<span class="dot"></span><span>' + stripMd(post.body).length + ' 字</span>' +
        '</div>' +
        (post.tags.length ? '<div class="article-tags">' + post.tags.map(function (t) {
          return '<a class="tag-mini" href="tags.html?t=' + encodeURIComponent(t) + '"># ' + esc(t) + '</a>';
        }).join('') + '</div>' : '') +
      '</header>' +
      toc +
      prose.outerHTML +
      navHtml +
      relatedHtml;

    renderMeta(site, { title: post.title, description: effectiveSummary(post), ogType: 'article' });
  }

  /* ---------------- 归档页 ---------------- */
  function renderArchive(site) {
    var host = $('#archive-host');
    if (!host) return;
    var posts = publishedPosts();
    if (!posts.length) {
      host.innerHTML = emptyHtml('还没有文章', '发布第一篇文章后，这里会按年份自动归档。');
      return;
    }

    var groups = {};
    posts.forEach(function (p) {
      var d = parseDate(p.date);
      var y = d ? d.getFullYear() : '未标日期';
      (groups[y] = groups[y] || []).push(p);
    });

    var years = Object.keys(groups).sort(function (a, b) {
      if (a === '未标日期') return 1;
      if (b === '未标日期') return -1;
      return Number(b) - Number(a);
    });

    host.innerHTML = years.map(function (y) {
      var items = groups[y].map(function (p) {
        return '<li><a href="' + postUrl(p.slug) + '">' +
          '<time datetime="' + esc(fmtDateShort(p.date)) + '">' + esc(fmtDateShort(p.date)) + '</time>' +
          '<span class="t">' + esc(p.title) + '</span>' +
          (p.category ? '<span class="c">' + esc(p.category) + '</span>' : '') +
        '</a></li>';
      }).join('');
      return '<section class="year-group">' +
        '<h2 class="year-label">' + esc(y) +
          (y === '未标日期' ? '' : ' 年') +
          '<span class="n">共 ' + groups[y].length + ' 篇</span>' +
        '</h2><ul class="archive-list">' + items + '</ul></section>';
    }).join('');
  }

  /* ---------------- 标签页 ---------------- */
  function renderTags(site) {
    var allHost = $('#tag-cloud-host');
    var listHost = $('#tag-posts-host');
    var posts = publishedPosts();
    var tags = collectTags(posts);
    var active = param('t');

    if (allHost) {
      allHost.innerHTML = tags.length
        ? tags.map(function (t) {
          var isActive = active === t.name ? ' class="is-active"' : '';
          return '<a href="tags.html?t=' + encodeURIComponent(t.name) + '"' + isActive + '>' +
            esc(t.name) + '<span class="count">' + t.count + '</span></a>';
        }).join('')
        : '<p style="color:var(--muted);margin:0">还没有标签。</p>';
    }

    if (!listHost) return;

    if (!posts.length) {
      listHost.innerHTML = emptyHtml('还没有文章', '发布文章并打上标签后，这里会按标签分类展示。');
      return;
    }

    var groups = active
      ? [active]
      : tags.map(function (t) { return t.name; });

    var html = '';
    groups.forEach(function (name) {
      var items = posts.filter(function (p) { return p.tags.indexOf(name) >= 0; });
      if (!items.length) return;
      html += '<section class="tag-block">' +
        '<div class="tag-block-head">' +
          '<h3 id="tag-' + esc(name) + '"># ' + esc(name) + '</h3>' +
          '<span class="num">' + items.length + ' 篇</span>' +
          (active ? '<a class="more" href="tags.html" style="margin-left:auto;font-size:13.5px">查看全部标签</a>' : '') +
        '</div>' +
        '<div class="post-list">' + items.map(function (p) { return postCardHtml(p); }).join('') + '</div>' +
      '</section>';
    });

    listHost.innerHTML = html || emptyHtml('没有匹配的文章', '换个标签试试。', 'tags.html', '查看全部标签');
    if (active) renderMeta(site, { title: '标签：' + active });
  }

  /* ---------------- 搜索页 ---------------- */
  function renderSearch(site) {
    var input = $('#search-input');
    var resultHost = $('#search-results');
    if (!resultHost) return;

    var posts = publishedPosts();
    var keyword = param('q');

    if (input) {
      input.value = keyword;
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') runSearch(input.value.trim());
      });
      setTimeout(function () { input.focus(); }, 120);
    }

    if (!keyword) {
      resultHost.innerHTML = '<div class="empty-state"><span class="big">寻</span>' +
        '<h3>输入关键词开始搜索</h3>' +
        '<p>支持搜索标题、摘要、正文和标签，共 ' + posts.length + ' 篇文章可供检索。</p>' +
        '<div class="tag-cloud" style="justify-content:center;margin-top:8px">' +
        collectTags(posts).slice(0, 10).map(function (t) {
          return '<a href="search.html?q=' + encodeURIComponent(t.name) + '">' + esc(t.name) + '</a>';
        }).join('') + '</div></div>';
      return;
    }

    var kw = keyword.toLowerCase();
    var hits = posts.map(function (p) {
      var title = p.title.toLowerCase();
      var summary = effectiveSummary(p).toLowerCase();
      var body = stripMd(p.body).toLowerCase();
      var tags = p.tags.join(' ').toLowerCase();
      var score = 0;
      if (title.indexOf(kw) >= 0) score += 12;
      if (tags.indexOf(kw) >= 0) score += 6;
      if (summary.indexOf(kw) >= 0) score += 4;
      if (body.indexOf(kw) >= 0) score += 2;
      if ((p.category || '').toLowerCase().indexOf(kw) >= 0) score += 3;
      return { post: p, score: score };
    }).filter(function (h) { return h.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });

    if (!hits.length) {
      resultHost.innerHTML = '<div class="empty-state"><span class="big">无</span>' +
        '<h3>没有找到「' + esc(keyword) + '」</h3>' +
        '<p>试试更短的关键词，或者直接浏览全部标签。</p>' +
        '<a class="btn btn--ghost" href="tags.html">按标签浏览</a></div>';
      return;
    }

    resultHost.innerHTML =
      '<p class="search-result-head">找到 <b>' + hits.length + '</b> 篇与「' + esc(keyword) + '」相关的文章</p>' +
      '<div class="post-list">' + hits.map(function (h) {
        return postCardHtml(h.post, { highlight: keyword });
      }).join('') + '</div>';
  }

  function runSearch(value) {
    var url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('q', value);
    if (!value) url.searchParams.delete('q');
    window.location.href = url.toString();
  }

  /* ---------------- 关于页 ---------------- */
  function renderAbout(site) {
    var host = $('#about-host');
    if (!host) return;
    var about = state.about || {};

    var prose = document.createElement('div');
    prose.className = 'prose';
    prose.innerHTML = mdToHtml(about.body || '');
    var toc = buildToc(prose);

    host.innerHTML =
      '<div class="crumbs"><a href="index.html">首页</a><span class="sep">/</span><span>关于</span></div>' +
      '<header class="article-header">' +
        '<h1>' + esc(about.title || '关于本站') + '</h1>' +
        '<div class="article-meta">' +
          (about.updated ? '<time datetime="' + esc(fmtDateShort(about.updated)) + '">最后更新于 ' + esc(fmtDate(about.updated)) + '</time>' : '') +
          '<span class="dot"></span><span>共 ' + publishedPosts().length + ' 篇文章</span>' +
        '</div>' +
      '</header>' +
      (about.avatar ? '<img src="' + esc(about.avatar) + '" alt="配图" style="border-radius:var(--radius);margin-bottom:28px" loading="lazy">' : '') +
      toc + prose.outerHTML;

    renderMeta(site, { title: about.title || '关于本站' });
  }

  /* ---------------- 主题预览页 ---------------- */
  var SKIN_INFO = [
    { key: 'ink', label: '铅墨', desc: '默认 · 中文长文阅读' },
    { key: 'corporate', label: '磐石', desc: '企业级 CMS / 官网' },
    { key: 'magazine', label: '刊页', desc: '杂志 / 媒体' },
    { key: 'minimal', label: '白纸', desc: '极简个人博客' },
    { key: 'warm', label: '暖宣', desc: '纸感随笔' },
    { key: 'terminal', label: '终端', desc: '技术极客' }
  ];

  /* 排版样例：用来直观比较各主题的标题字体、行距与栏宽，不是站点内容 */
  var PROSE_SAMPLE =
    '<h2>正文排版样例</h2>' +
    '<p>主题决定的不只是颜色。标题字体、行距、栏宽、卡片间距这些看不见的细节，' +
    '才是决定一篇文章读起来累不累的关键。下面这段文字就是用来看清这一点的。</p>' +
    '<p>好的阅读版式会让人忘记版式的存在：视线顺着文字流下去，不必刻意去找下一行。' +
    '行距过密会挤，过疏会散；栏宽过宽时眼睛回行容易串行，过窄则频繁换行同样打断节奏。</p>' +
    '<blockquote><p>排版的目标不是好看，而是让内容更容易被读完。</p></blockquote>' +
    '<h3>列表与代码的呈现</h3>' +
    '<ul>' +
      '<li>列表项的间距与符号颜色随主题变化；</li>' +
      '<li>引用块在不同主题下可能是实线，也可能是虚线；</li>' +
      '<li>代码块的字号与配色同样各自不同。</li>' +
    '</ul>' +
    '<pre><code>node tools/deploy.mjs --user=你的用户名 --repo=blog</code></pre>' +
    '<p>看完这一页，记住你偏好的那个名字，去后台「站点设置 → 站点主题」里选上即可。</p>';

  function renderThemes(site) {
    var picker = $('#themes-picker');
    var proseHost = $('#themes-prose');
    var current = normalizeSkin(site.theme);

    if (proseHost && !proseHost.firstChild) {
      var prose = document.createElement('div');
      prose.className = 'prose';
      prose.innerHTML = PROSE_SAMPLE;
      proseHost.appendChild(prose);
    }

    if (!picker) return;

    picker.innerHTML = SKIN_INFO.map(function (s) {
      return '<button type="button" data-skin-name="' + s.key + '"' +
        (s.key === current ? ' class="is-active"' : '') + '>' +
        '<b>' + esc(s.label) + '</b><span>' + esc(s.desc) + '</span></button>';
    }).join('') +
      '<p class="theme-hint">后台当前设定：<b>' + esc(current) + '</b>。' +
      '点上面的按钮可以即时预览，但不会保存；要正式启用，请在后台「站点设置 → 站点主题」里选择，' +
      '或把 <code>content/site.json</code> 的 <code>theme</code> 改成对应值。</p>';

    $$('[data-skin-name]', picker).forEach(function (btn) {
      btn.addEventListener('click', function () {
        applySkin(btn.getAttribute('data-skin-name'), { remember: false });
        $$('[data-skin-name]', picker).forEach(function (b) {
          if (b === btn) b.classList.add('is-active');
          else b.classList.remove('is-active');
        });
      });
    });
  }

  /* ---------------- 错误提示 ---------------- */
  function showLoadError(err) {
    console.error('[站点] 内容加载失败：', err);
    var isFile = window.location.protocol === 'file:';
    var msg = isFile
      ? '当前是用「直接双击打开文件」的方式访问的，浏览器会拦截内容读取。请用本地服务器预览，例如在项目目录执行：python -m http.server 8080，然后访问 http://localhost:8080'
      : '内容文件读取失败，请检查 content/ 目录下的 JSON 文件是否存在且格式正确。';
    ['#post-list', '#article-host', '#archive-host', '#tag-posts-host', '#search-results', '#about-host']
      .forEach(function (sel) {
        var el = $(sel);
        if (el && !el.innerHTML.trim()) {
          el.innerHTML = '<div class="error-state"><span class="big">!</span><h3>内容加载失败</h3><p>' +
            esc(msg) + '</p></div>';
        }
      });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    initTheme();
    initSkin();
    bindThemeToggle();
    renderBackToTop();
    setCanonical();

    var page = document.body.dataset.page || 'home';

    var tasks = [loadJSON(DATA.site), loadJSON(DATA.posts)];
    if (page === 'about') tasks.push(loadJSON(DATA.about));

    Promise.all(tasks).then(function (res) {
      state.site = res[0] || {};
      state.posts = normalizePosts(res[1]);
      state.about = res[2] || null;

      /* 后台选定的皮肤在这里生效；accent 留空时不再覆盖主题配色 */
      applySkin(state.site.theme);
      applyAccent(state.site);
      renderHeader(state.site);
      renderFooter(state.site);
      bindThemeToggle();

      var baseMeta = {
        home: { title: '', description: state.site.description },
        post: { title: '' },
        archive: { title: '归档' },
        tags: { title: '标签' },
        search: { title: '搜索' },
        about: { title: '关于本站' },
        themes: { title: '主题预览' },
        error: { title: '页面不存在' }
      }[page] || {};
      renderMeta(state.site, baseMeta);

      if (page === 'home') renderHome(state.site);
      else if (page === 'themes') { renderHome(state.site); renderThemes(state.site); }
      else if (page === 'post') renderPost(state.site);
      else if (page === 'archive') renderArchive(state.site);
      else if (page === 'tags') renderTags(state.site);
      else if (page === 'search') renderSearch(state.site);
      else if (page === 'about') renderAbout(state.site);
      else if (page === 'error') { /* 404 页面为静态内容 */ }
    }).catch(showLoadError);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
