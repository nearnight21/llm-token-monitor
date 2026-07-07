# LLM Token Monitor

轻量级桌面悬浮窗，实时监控 LLM API token 用量/余额。

![compact](https://img.shields.io/badge/window-170×48-blue) ![tauri](https://img.shields.io/badge/tauri-v2-6c5ce7) ![rust](https://img.shields.io/badge/rust-1.70+-orange) ![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)

## 功能

- **桌面悬浮窗**：小巧的环形进度条，置顶显示，不占用任务栏
- **鼠标悬停展开**：显示各周期的用量详情（每小时/每周/每月）
- **两种数据源**：
  - **OpenCode Go** — 通过 opencli 自动抓取 opencode.ai 工作区用量
  - **自定义 JSON API** — 支持任意 REST API，JSON Path 提取数据
- **系统托盘**：右键菜单控制显隐/设置/退出
- **配置持久化**：本地配置文件，更换设备无需重新配置

## 预览

```
缩略态 (170×48)          展开态 (420×auto)
┌──────────────────┐    ┌─────────────────────────┐
│ ⬤  ⭕75%  ⚙   │    │ OpenCode Go         75% │
└──────────────────┘    │ 5h    ████████░░  75%   │
                        │ Week  ███████░░░  70%   │
                        │ Month ██████░░░░  60%   │
                        │ [⚙ 设置]  [▲ 折叠]     │
                        └─────────────────────────┘
```

## 快速开始

### 环境要求

- Windows 10/11 x64
- [Google Chrome](https://www.google.com/chrome/)
- [Node.js](https://nodejs.org/)（用于安装 opencli）
- WebView2 Runtime（Win10 1809+ 已内置）

### 安装

```bash
# 1. 安装 opencli + Chrome 扩展
npm install -g opencli
# 在 Chrome 中安装 opencli 扩展并登录 opencode.ai

# 2. 克隆项目
git clone https://github.com/nearnight21/llm-token-monitor.git
cd llm-token-monitor

# 3. 安装依赖 & 构建
npm install
npx tauri build

# 4. 运行
# 打开 src-tauri/target/release/llm-token-monitor.exe
```

### 首次配置

1. 启动程序，鼠标移到悬浮窗上展开面板
2. 点击 ⚙ → 进入设置
3. **OpenCode Go**：默认已添加，直接启用即可
4. **自定义 API**：点击「+ 添加」，填写 API URL 和 JSON Path

## 自定义 API 配置

| 字段 | 说明 | 示例 |
|---|---|---|
| API URL | 数据接口地址 | `https://api.example.com/usage` |
| JSON Path - used | 已用量字段路径 | `$.data.total_usage` |
| JSON Path - total | 总量字段路径 | `$.data.hard_limit` |
| 轮询间隔 | 刷新频率（秒） | `60` |

提供 **used+total** 或 **total+remaining** 或 **percentage** 任意一组即可，其余自动计算。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri v2 |
| 后端 | Rust |
| 前端 | 原生 HTML/CSS/JS（零框架） |
| 打包 | tauri-build → .exe / .msi / NSIS |

## 项目结构

```
├── src/                    # 前端 (WebView)
│   ├── index.html          # 三态 UI
│   ├── styles.css          # 暗色毛玻璃样式
│   └── app.js              # 渲染 / 轮询 / 事件
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs         # 入口
│   │   ├── lib.rs          # Tauri Builder
│   │   └── core.rs         # 数据抓取 / 配置管理
│   ├── tauri.conf.json     # 窗口 / 打包配置
│   └── Cargo.toml          # Rust 依赖
└── package.json            # npm 脚本
```

## License

MIT
