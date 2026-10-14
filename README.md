# 拾页 · 个人知识库

一个**零成本**的纯静态个人网站：**GitHub Pages** 托管 + **Pages CMS** 可视化后台。

年支出 **0 元**，无需服务器、无需数据库、无需本地构建环境，也**不需要买域名**——用 GitHub 自带的 `*.github.io` 地址就能完整上线。

> 以后若想换成自己的域名，可再接入 **Cloudflare** 与 **DigitalPlat FreeDomain** 的免费 `.us.kg` 域名，步骤见《部署手册.md》第三、四部分。目前**暂不绑定**，不影响网站任何功能。

---

## 当前部署状态

| 项 | 值 |
| --- | --- |
| GitHub 仓库 | <https://github.com/gzxyc/blog> |
| 线上地址 | <https://gzxyc.github.io/blog/> |
| 托管方式 | GitHub Pages · Deploy from a branch（main / root） |
| 后台地址 | <https://app.pagescms.org> |
| 自定义域名 | **暂不绑定** —— 现用 GitHub Pages 默认地址，功能完全可用 |

以后想绑自己的域名时，补上 `--domain` 重跑一次部署脚本即可，全站地址（sitemap、robots、各页面的 canonical 与 og:url）会自动一起切换，不用手改任何文件：

```bash
node tools/deploy.mjs --user=gzxyc --repo=blog --domain=你的域名 --token=你的Token
```

---

## 这套方案的特点

| 特性 | 说明 |
| --- | --- |
| **零构建** | 全部是纯 HTML / CSS / 原生 JavaScript，没有打包步骤。改完直接生效，不存在"构建失败" |
| **可视化后台** | 通过 [Pages CMS](https://pagescms.org) 在浏览器里写文章改配置，手机上也能发文 |
| **响应式** | 手机、平板、桌面自适应；支持浅色 / 深色主题自动跟随系统并记忆选择 |
| **站内搜索** | 纯前端全文检索，覆盖标题、摘要、正文、标签 |
| **规范链接** | canonical 与 og:url 由脚本在运行时按真实地址推导，换域名、换路径都不用改页面 |
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
├── .nojekyll            告诉 GitHub Pages 不要用 Jekyll 处理
├── .gitattributes       统一换行符为 LF（避免 Windows 下整文件 diff）
├── .gitignore           忽略本地工作区数据
├── robots.txt           搜索引擎抓取规则
├── sitemap.xml          站点地图
└── CNAME                自定义域名（仅在绑定了域名后存在，由 deploy.mjs 写入）
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
  --token=你的PersonalAccessToken
```

脚本会自动完成：写入站点地址 → 初始化 git → 创建远程仓库 → 推送代码 → 开启 Pages → 清除本地残留的 Token。

**`--domain` 是可选的，不填也能完整上线。** 不填时站点使用 GitHub Pages 默认地址 `https://用户名.github.io/仓库名/`，脚本会移除 `CNAME`（避免 GitHub 绑定到错误域名）。以后想绑自己的域名，再带上 `--domain=你的域名` 重跑一次即可——脚本会把 `sitemap.xml`、`robots.txt` 以及各页面里的 canonical / og:url 一并改到新地址，其余文件不需要手动改。

常用开关：

| 开关 | 作用 |
| --- | --- |
| `--force` | 远程有本地没有的提交时强制覆盖。⚠️ 会丢弃远程上的提交——若它来自 Pages CMS 后台，就等于丢掉后台的编辑。默认会自动合并，通常用不到 |
| `--skip-pages` | 只推代码，不调用接口配置 Pages |
| `--dry-run` | 只做参数检查，不提交不推送 |

> **关于「远程有本地没有的提交」**：你在 Pages CMS 后台每保存一次，后台就会往仓库提交一次。所以从本地推送前，远程往往已经比你新。脚本**会自动拉取并合并**这些改动再推送，不会覆盖后台内容。只有当合并真的发生冲突时才会停下，并提示你手动解决。

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

## 关于自定义域名（目前不需要）

本站**目前不绑定自定义域名**，用 GitHub Pages 默认地址即可。以下两点提醒仅在以后你决定绑域名时才适用：

1. `.us.kg` 域名由志愿者团队运营，**没有可用性保障**，请勿用于生产级业务。
2. 免费域名**需要定期手动续期**，建议在日历里设一个年度提醒。

具体申请与解析步骤见《部署手册.md》第三、四部分。

---

## 许可

站点代码可自由取用。文章内容版权归作者所有。
