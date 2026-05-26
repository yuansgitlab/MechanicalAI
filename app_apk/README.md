# MechanicalAI Android App

你的全能工科AI导师的Android应用版本

## 📱 项目介绍

基于 **Kotlin + Jetpack Compose + Material Design 3** 构建的Android应用，提供智能对话、知识诊断、闯关测试和学习计划功能。

---

## 🚀 快速开始

### 1. 环境要求

- Android Studio Hedgehog (2023.1.1) 或更高版本
- JDK 17
- Android SDK API 34
- Gradle 8.2

### 2. 配置API地址 (安全方式)

**不要在代码中硬编码API地址！** 按照以下步骤配置：

1. 复制 `local.properties.template` 为 `local.properties`
   ```bash
   cp local.properties.template local.properties
   ```

2. 在 `local.properties` 中配置你的API地址：
   ```properties
   # API 基地址配置
   api.base.url=https://your-api-server.com/
   ```

3. `local.properties` 已自动添加到 `.gitignore`，不会提交到代码仓库

### 3. 构建运行

```bash
# Debug 版本
./gradlew assembleDebug

# Release 版本
./gradlew assembleRelease
```

或者直接在 Android Studio 中点击运行按钮。

---

## 🔐 安全配置详解

### API Key 安全最佳实践

#### ✅ 当前方案 (推荐)
```
┌─────────────────────────────────────────────────┐
│  local.properties (本地文件，不提交Git)          │
│  ├─ api.base.url=https://your-api.com/         │
│  └─ (其他敏感配置)                              │
└─────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────┐
│  build.gradle.kts                               │
│  ├─ 读取 local.properties                       │
│  └─ 生成 BuildConfig.API_BASE_URL              │
└─────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────┐
│  RetrofitClient.kt                              │
│  └─ 使用 BuildConfig.API_BASE_URL              │
└─────────────────────────────────────────────────┘
```

#### 为什么这样安全？
1. **不在代码库中暴露** - `local.properties` 被 `.gitignore` 忽略
2. **构建时注入** - 敏感信息只在本地构建时出现
3. **Release加固** - Release版本启用代码混淆和资源压缩

#### 其他安全建议
- 使用 **Android Keystore** 存储真正的密钥
- 考虑使用 **Firebase App Check** 或类似服务
- 实施 **SSL Pinning** 防止中间人攻击

---

## 🎨 样式设计规范 (Material Design 3)

### 设计原则
我们严格遵循 **Material Design 3 (Material You)** 规范：

### 1. 颜色系统
```kotlin
private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF9333EA),     // 主色：紫色
    secondary = Color(0xFFEC4899),   // 辅助色：粉色
    tertiary = Color(0xFF3B82F6),    // 第三色：蓝色
    background = Color(0xFF0A0A0A), // 背景：深黑
    surface = Color(0xFF1A1A1A),    // 表面：深灰
)
```

### 2. 组件规范
| 组件 | 使用场景 |
|------|---------|
| `TopAppBar` | 顶部导航栏 |
| `TabRow` | 标签页导航 |
| `Card` | 消息、诊断、测试卡片 |
| `Surface` | 内容容器 |
| `Scaffold` | 页面骨架 |

### 3. 间距规范
```kotlin
4.dp   // 微小间距
8.dp   // 小间距
12.dp  // 中等间距
16.dp  // 标准间距
24.dp  // 大间距
32.dp  // 超大间距
```

### 4. 圆角规范
```kotlin
4.dp   // 小控件
8.dp   // 标准组件
12.dp  // 卡片
16.dp  // 对话框
24.dp  // 大组件
```

---

## 📦 打包APK完整流程

### 方式一：Debug版本 (开发测试用)

```bash
# 1. 清理构建
./gradlew clean

# 2. 构建Debug APK
./gradlew assembleDebug

# 3. APK位置
# app/build/outputs/apk/debug/app-debug.apk
```

### 方式二：Release版本 (发布用)

#### 步骤1：生成签名密钥
```bash
keytool -genkey -v -keystore mechanicalai.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias mechanicalai
```

#### 步骤2：配置签名
在 `local.properties` 中添加：
```properties
storeFile=../keystore/mechanicalai.jks
storePassword=你的密钥库密码
keyAlias=mechanicalai
keyPassword=你的密钥密码
```

#### 步骤3：修改 build.gradle.kts
添加签名配置：
```kotlin
signingConfigs {
    create("release") {
        storeFile = file(localProperties.getProperty("storeFile"))
        storePassword = localProperties.getProperty("storePassword")
        keyAlias = localProperties.getProperty("keyAlias")
        keyPassword = localProperties.getProperty("keyPassword")
    }
}
buildTypes {
    release {
        signingConfig = signingConfigs.getByName("release")
    }
}
```

#### 步骤4：构建Release APK
```bash
./gradlew clean assembleRelease
```

#### 步骤5：APK位置
```
app/build/outputs/apk/release/app-release.apk
```

### 方式三：Android App Bundle (Google Play推荐)

```bash
./gradlew bundleRelease
```
输出位置：`app/build/outputs/bundle/release/app-release.aab`

---

## 📁 项目结构

```
MechanicalAI_APPS/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── java/com/mechanicalai/app/
│   │       │   ├── MainActivity.kt
│   │       │   ├── data/
│   │       │   │   ├── api/          # API接口
│   │       │   │   ├── local/        # 本地数据库
│   │       │   │   ├── model/        # 数据模型
│   │       │   │   └── repository/   # 数据仓库
│   │       │   └── ui/               # UI层
│   │       └── res/                  # 资源文件
│   └── build.gradle.kts
├── gradle/
├── build.gradle.kts
├── settings.gradle.kts
├── local.properties.template         # 配置模板
└── README.md
```

---

## 🛠️ 核心功能

### 1. 智能对话
- 流式聊天体验
- 历史会话管理
- 本地持久化存储

### 2. 知识诊断
- AI生成的知识分析
- Markdown格式展示

### 3. 闯关测试
- 难度分级题目
- 即时答案反馈
- 详细解析

### 4. 学习计划
- 个性化学习路径
- 分阶段学习目标

---

## 🔧 技术栈

| 技术 | 版本 |
|------|------|
| Kotlin | 1.9.20 |
| Jetpack Compose | BOM 2024.02.00 |
| Material Design 3 | 1.2.0 |
| Room Database | 2.6.1 |
| Retrofit | 2.9.0 |
| OkHttp | 4.12.0 |
| Kotlinx Serialization | 1.6.0 |

---

## 📄 许可证

此项目为 MechanicalAI 的Android客户端版本。
