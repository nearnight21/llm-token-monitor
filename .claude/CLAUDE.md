# LLM Token Monitor - Claude Code 工作流

Tauri v2 桌面悬浮窗，实时监控 LLM API token 用量。

## 技术栈
- 桌面框架: Tauri v2 (Rust + WebView2)
- 后端: Rust (x86_64-pc-windows-gnu)
- 前端: 原生 HTML/CSS/JS（零框架）
- 构建: `npx tauri build` → Windows .exe

## 构建环境
- Rust 工具链: `stable-x86_64-pc-windows-gnu`
- MinGW GNU 工具链在 `F:/xiazai/x86_64-14.2.0-release-posix-seh-msvcrt-rt_v12-rev2/mingw64/`
- 已复制到 `~/bin`, `~/lib`, `~/libexec`, `~/share`, `~/x86_64-w64-mingw32`
- `.cargo/config.toml` 指定 linker = `C:\Users\CJF\bin\gcc.exe`

## Workflow Rules
执行任何任务之前按顺序检查：

1. 先看是否有 skill 描述包含 "MUST use" → 调用对应 skill
2. 新建功能/重写/设计 → 先跑 `brainstorming`，设计方案确认后再写代码
3. 遇到 bug/测试失败 → 先跑 `systematic-debugging`，不要猜测修复
4. 完成功能/修复 → 先跑 `verification-before-completion` 验证
5. 代码改动前如果涉及设计决策 → 先和用户对齐

## 关键设计决策（已知，不要重复讨论）
- 缩略窗: 环形 SVG 进度条，170×48
- OpenCode 抓取: opencli `--window background` 静默执行
- 所有 Command 调用: 必须加 `creation_flags(CREATE_NO_WINDOW)`
- 配置存储: `%APPDATA%\llm-token-monitor\config.json`
- 窗口: 无边框透明，shadow=false，alwaysOnTop，skipTaskbar
