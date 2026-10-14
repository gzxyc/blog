# 拾页 · 个人知识库

一个**零成本**的纯静态个人网站：**GitHub Pages** 托管 + **Pages CMS** 可视化后台 + **Cloudflare** 提供 DNS 与 SSL + **DigitalPlat FreeDomain** 免费 `.us.kg` 域名。

年支出 **0 元**，无需服务器、无需数据库、无需本地构建环境。

---

## 这套方案的特点

| 特性 | 说明 |
| --- | --- |
| **零构建** | 全部是纯 HTML / CSS / 原生 JavaScript，没有打包步骤。改完直接生效，不存在"构建失败" |
| **可视化后台** | 通过 [Pages CMS](https://pagescms.org) 在浏览器里写文章改配置，手机上也能发文 |
| **响应式** | 手机、平板、桌面自适应；支持浅色 / 深色主题自动跟随系统并记忆选择 |
| **站内搜索** | 纯前端全文检索，覆盖标题、摘要、正文、标签 |
| **无外链依赖** | Markdown 渲染库已本地化到 `assets/vendor/`，不依赖任何 CDN |

---

## 目录结构

```
├── index.html           首页（站点简介 + 文章列表 + 分页 + 侧栏）
├── post.html            文章详情（目录、上下篇、相关阅读）
├── archive.html         归档（按年份分组）
├── tags.html            标签索引（可按标签筛选）
├── search.html          站内搜索
├── about.html           关于页面
├── 404.html             404 页面
│
├── content/             ★ 全部内容都在这里，由后台维护
│   ├── site.json        站点设置（名称、导航、页脚、每页篇数…）
│   ├── posts.json       文章数据（标题、日期、分类、标签、正文…）
│   └── about.json       关于页面内容
│
├── assets/
│   ├── css/style.css    全站样式（含明暗主题、响应式、打印样式）
│   ├── js/app.js        全站脚本
│   ├── vendor/          本地化的第三方库
│   └── images/          图片素材（后台可上传）
│
├── tools/
│   ├── deploy.mjs       一键部署（建仓 + 推送 + 开启 Pages + 绑定域名）
│   └── serve.mjs        本地预览服务器
│
├── .pages.yml           ★ Pages CMS 后台配置
├── CNAME                自定义域名（部署时自动写入）
├── .nojekyll            告诉 GitHub Pages 不要用 Jekyll 处理
├── robots.txt           搜索引擎抓取规则
└── sitemap.xml          站点地图
```

---

## 本地预览

因为站点用 `fetch()` 读取 `content/` 下的 JSON，**不能直接双击打开 index.html**（`file://` 协议会被浏览器拦截），需要用一个 HTTP 服务器：

```bash
node tools/serve.mjs
# 然后打开 http://localhost:8080
```

想换端口：`node tools/serve.mjs 3000`

---

## 一键部署

```bash
node tools/deploy.mjs \
  --user=你的GitHub用户名 \
  --repo=仓库名 \
  --domain=你的域名.us.kg \
  --token=你的PersonalAccessToken
```

脚本会自动完成：写入域名配置 → 初始化 git → 创建远程仓库 → 推送代码 → 开启 Pages → 绑定自定义域名 → 清除本地残留的 Token。

常用开关：

| 开关 | 作用 |
| --- | --- |
| `--force` | 远程仓库已有内容且冲突时强制覆盖 |
| `--skip-pages` | 只推代码，不调用接口配置 Pages |
| `--dry-run` | 只做参数检查，不提交不推送 |

> **Token 说明**：需要一个 **Classic** Personal Access Token，勾选 `repo` 权限（若要脚本自动开启 Pages，`repo` 权限即可）。
> 生成地址：<https://github.com/settings/tokens>。用完建议立即删除。

---

## 日常使用

### 写文章

1. 打开 <https://app.pagescms.org>，用 GitHub 登录并授权仓库
2. 选择仓库和 `main` 分支
3. 进入「文章管理」→ 添加，填好字段后保存
4. 约 30 秒后网站自动更新

字段说明见站内文章《图文教程：用后台发布第一篇文章》。

### 改站点名称、导航、页脚

后台「站点设置」里改，保存即生效。

### 直接改文件

当然也可以直接编辑 `content/*.json` 后提交，效果完全一样。

---

## 关于免费域名的两点提醒

1. `.us.kg` 域名由志愿者团队运营，**没有可用性保障**，请勿用于生产级业务。
2. 免费域名**需要定期手动续期**，建议在日历里设一个年度提醒。

---

## 许可

站点代码可自由取用。文章内容版权归作者所有。
