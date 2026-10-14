# 项目长期记忆 · 免费网站搭建

## 项目定位
「拾页」——个人知识库站点。目标：**年成本 0 元**的静态网站。
技术链路：GitHub 公开仓库 → GitHub Pages 托管 → Pages CMS 可视化后台 → DigitalPlat FreeDomain `.us.kg` 免费域名 → Cloudflare 提供 DNS 与 SSL。

## 核心约定（修改前必须遵守）

1. **纯静态、零构建是硬约束。** 不引入 Astro / Hugo / Jekyll / Hexo 等任何需要构建步骤的方案，也不加 GitHub Actions 构建流程。理由：避免构建失败这类故障，且用户能在手机后台直接发文。
2. **内容一律存 JSON，且只放 `content/` 目录。** 新增内容类型时同步在 `.pages.yml` 里声明对应字段，保持两者字段名严格一一对应（否则后台会出现读写不一致）。
3. **不依赖外部 CDN。** 第三方库（如 marked.js）必须下载到 `assets/vendor/` 本地化。
4. **路径全部为相对路径**（页面都在根目录，因此直接用 `assets/...`、`content/...`）。
5. 页面是「HTML 骨架 + JS 渲染」结构，新增页面需在 `assets/js/app.js` 的 `boot()` 分发里注册 `document.body.dataset.page` 分支。
6. 面向用户的文案全部为**简体中文**，界面风格保持克制、适合中文长文阅读。
7. 主色调通过 `content/site.json` 的 `accent` 字段控制，`app.js` 会实时写入 CSS 变量。

## 关键文件职责
| 文件 | 职责 |
| --- | --- |
| `content/site.json` | 站点名称、导航、页脚、每页篇数、主题色、作者信息 |
| `content/posts.json` | 全部文章（单文件数组，浏览器端按日期排序分页） |
| `content/about.json` | 关于页内容 |
| `.pages.yml` | Pages CMS 后台界面配置，只影响后台不影响前台 |
| `assets/js/app.js` | 全站渲染逻辑，改动风险最高 |
| `tools/deploy.mjs` | 一键部署：建仓 + 推送 + 开启 Pages + 绑定域名 |
| `tools/serve.mjs` | 本地预览服务器（`file://` 协议下 fetch 会被拦截，必须用它） |

## 设计约束
- **文章卡片不能用 `<a>` 包裹卡片内容再嵌套标签链接**。正确写法：`<article class="post-card">` 内标题用 `<a class="post-link">`，其 `::after` 绝对定位覆盖整卡；`.post-tags` 设 `position: relative; z-index: 2` 叠在上层。这是已经踩过的坑。
- 样式走 CSS 变量（见 `style.css` 第 1 节的 `:root`），明暗主题靠 `[data-theme="dark"]` 切换，主题变量在页面 `<head>` 内联脚本里提前设置以防闪白。

## 部署相关
- GitHub Pages 使用「Deploy from a branch」（main / root），**不要**改成 GitHub Actions。
- Cloudflare 里指向 GitHub Pages 的 A/CNAME 记录，代理状态必须设为「仅 DNS」（灰色云朵），否则 GitHub 域名校验与证书签发会失败。
- SSL 模式必须为 **Full（严格）**，不能用 Flexible（会导致无限重定向）。
- `.us.kg` 免费域名需**手动年度续期**，无 SLA，不可用于生产业务。
