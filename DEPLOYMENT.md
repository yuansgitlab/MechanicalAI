# Netlify 部署指南

## 项目结构说明

这个项目分为两部分：
- **前端**：`frontend/` 目录（纯 HTML/JS/CSS，无需构建）
- **后端**：`backend/` 目录（Python FastAPI）

## 部署方案

### 方案一：前端部署到 Netlify，后端保持现有 API（推荐）

这是最简单的方案，前端通过代理连接到现有的 Hugging Face Space 后端。

#### 步骤 1：准备代码仓库

确保你的代码推送到 GitHub/GitLab 仓库：

```bash
git init
git add .
git commit -m "Initial commit for Netlify deployment"
git remote add origin <你的仓库地址>
git push -u origin main
```

#### 步骤 2：在 Netlify 上部署

1. 访问 [Netlify](https://app.netlify.com) 并登录
2. 点击 "Add new site" → "Import an existing project"
3. 选择你的 Git 提供商（GitHub/GitLab）
4. 授权 Netlify 访问你的仓库
5. 选择你的项目仓库

#### 步骤 3：配置部署设置

在部署设置页面：

- **Base directory**: 留空（或填写 `.`）
- **Publish directory**: `frontend`
- **Build command**: 留空

#### 步骤 4：环境变量（可选）

如果需要自定义 API 端点：

在 Netlify 站点设置 → "Environment variables" 中添加：

```
VITE_API_URL=https://your-backend-url.com
```

#### 步骤 5：部署

点击 "Deploy site" 等待部署完成！

---

### 方案二：完整部署（前端 + 后端）

如果你想部署完整的应用：

#### 后端部署选项

1. **Hugging Face Spaces**（最简单，已有）
   - 当前已经在 https://yuangitlab-mechanical-ai-api.hf.space
   
2. **Vercel**（支持 Python Functions）
3. **Railway**
4. **Render**
5. **Fly.io**

#### 前端部署到 Netlify

使用方案一的步骤，然后修改 `netlify.toml` 中的 API 重定向：

```toml
[[redirects]]
  from = "/api/*"
  to = "https://your-new-backend-url.com/api/:splat"
  status = 200
```

---

## Netlify 配置说明

### netlify.toml

```toml
[build]
  publish = "frontend"  # 发布目录
  command = ""          # 不需要构建命令

[[redirects]]
  from = "/api/*"
  to = "https://yuangitlab-mechanical-ai-api.hf.space/api/:splat"
  status = 200          # API 代理

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200          # SPA 路由支持
```

### 主要功能

✅ 静态文件托管（前端）
✅ API 代理（连接到后端）
✅ SPA 路由支持
✅ 自动 HTTPS
✅ 全球 CDN

---

## 本地预览部署

在部署前，可以在本地预览：

```bash
# 安装 Netlify CLI
npm install -g netlify-cli

# 登录
netlify login

# 本地预览
netlify dev
```

---

## 自定义域名

部署后可以在 Netlify 设置中：
1. 使用 Netlify 提供的免费域名（`your-site.netlify.app`）
2. 或配置自定义域名

---

## 故障排除

### API 请求失败

检查：
1. 后端 API 是否正常运行
2. `netlify.toml` 中的 API 重定向地址是否正确
3. 浏览器控制台的网络请求详情

### 页面刷新 404

确保 `netlify.toml` 中有 SPA 路由重定向配置。

---

## 需要帮助？

访问 [Netlify 文档](https://docs.netlify.com) 或提交 Issue。
