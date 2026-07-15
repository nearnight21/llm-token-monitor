use serde::{Deserialize, Serialize};
use std::process::Command;
use std::os::windows::process::CommandExt;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use once_cell::sync::Lazy;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageData {
    pub provider_id: String,
    pub provider_name: String,
    pub provider_type: String,
    pub unit: String,
    pub color: String,
    pub hourly: Option<PeriodData>,
    pub weekly: Option<PeriodData>,
    pub monthly: Option<PeriodData>,
    pub percentage: Option<f64>,
    pub used: Option<f64>,
    pub total: Option<f64>,
    pub remaining: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
pub struct PeriodData {
    pub used: f64,
    pub total: f64,
    pub remaining: f64,
    pub percentage: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub enabled: bool,
    pub color: String,
    pub unit: String,
    pub api_url: Option<String>,
    pub json_paths: Option<JsonPaths>,
    pub polling_interval_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JsonPaths {
    pub used: Option<String>,
    pub total: Option<String>,
    pub remaining: Option<String>,
    pub percentage: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppConfig {
    pub providers: Vec<Provider>,
    pub window: Option<WindowState>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct WindowState { pub x: i32, pub y: i32 }

static CONFIG: Lazy<Mutex<AppConfig>> = Lazy::new(|| Mutex::new(AppConfig::default()));

const HOURLY_LIMIT: f64 = 12.0;
const WEEKLY_LIMIT: f64 = 30.0;
const MONTHLY_LIMIT: f64 = 60.0;
const WORKSPACE_URL: &str = "https://opencode.ai/workspace/wrk_01KX7RRJX7V0A58NS9SESWNC48/go";

fn config_path() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_else(|_| r"C:\Users\Default\AppData\Roaming".into());
    let dir = PathBuf::from(appdata).join("llm-token-monitor");
    fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

fn default_providers() -> Vec<Provider> {
    vec![Provider {
        id: "opencode-go".into(), name: "OpenCode Go".into(),
        provider_type: "opencode".into(), enabled: true,
        color: "#6c5ce7".into(), unit: "usd".into(),
        api_url: None, json_paths: None, polling_interval_ms: 60000,
    }]
}

// ---- OpenCode Go (opencli) ----

fn run_opencli(args: &[&str]) -> Result<String, String> {
    // 直接查找 opencli.cmd 的完整路径，不依赖 PATH
    let opencli_path = [
        r"C:\nvm4w\nodejs\opencli.cmd",
        r"C:\Program Files\nvm4w\nodejs\opencli.cmd",
    ]
    .iter()
    .find(|p| std::path::Path::new(p).exists())
    .copied()
    .unwrap_or("opencli.cmd");

    let out = Command::new(opencli_path).args(args).creation_flags(CREATE_NO_WINDOW).output()
        .map_err(|e| format!("opencli: {}", e))?;
    if !out.status.success() {
        return Err(format!("opencli failed: {} | {}",
            String::from_utf8_lossy(&out.stderr).trim(),
            String::from_utf8_lossy(&out.stdout).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines().filter(|l| !l.contains("Extension update available"))
        .collect::<Vec<_>>().join("\n"))
}

fn parse_pct(text: &str, label: &str) -> Option<f64> {
    let lines: Vec<&str> = text.lines().collect();
    for (i, l) in lines.iter().enumerate() {
        if l.contains(label) && i + 1 < lines.len() {
            if let Some(s) = lines[i+1].trim().strip_suffix('%') {
                if let Ok(v) = s.trim().parse() { return Some(v); }
            }
        }
    }
    None
}

fn pd(pct: f64, limit: f64) -> PeriodData {
    let u = pct / 100.0 * limit;
    PeriodData { used: u, total: limit, remaining: limit - u, percentage: pct }
}

fn fetch_opencode_data() -> Result<(PeriodData, PeriodData, PeriodData), String> {
    // 先关闭旧 session 确保每次都刷新页面拿到最新数据
    let _ = run_opencli(&["browser", "sess_opencode", "--window", "background", "close"]);
    std::thread::sleep(std::time::Duration::from_millis(500));

    // 先尝试直接 eval，检查是否打开的不是空白页
    let text = run_opencli(&["browser", "sess_opencode", "--window", "background", "eval", "document.body.innerText"])
        .and_then(|t| {
            if t.contains("Rolling Usage") || t.contains("滚动用量") { Ok(t) }
            else { Err("page is blank or stale".into()) }
        })
        .or_else(|_| {
            // session 无效 → 重新打开 workspace 页面
            run_opencli(&["browser", "sess_opencode", "--window", "background", "open", WORKSPACE_URL])?;
            std::thread::sleep(std::time::Duration::from_secs(5));
            run_opencli(&["browser", "sess_opencode", "--window", "background", "eval", "document.body.innerText"])
        })?;
    let preview: String = text.chars().take(300).collect();
    Ok((
        pd(parse_pct(&text, "Rolling Usage").or_else(|| parse_pct(&text, "滚动用量")).ok_or_else(|| format!("hourly parse fail. Page: {}", preview))?, HOURLY_LIMIT),
        pd(parse_pct(&text, "Weekly Usage").or_else(|| parse_pct(&text, "每周用量")).ok_or_else(|| "weekly parse fail".to_string())?, WEEKLY_LIMIT),
        pd(parse_pct(&text, "Monthly Usage").or_else(|| parse_pct(&text, "每月用量")).ok_or_else(|| "monthly parse fail".to_string())?, MONTHLY_LIMIT),
    ))
}

// ---- JSON API ----

fn extract_jp(json: &serde_json::Value, path: &str) -> Option<f64> {
    let mut cur = json;
    for part in path.trim_start_matches('$').trim_start_matches('.').split('.').filter(|s| !s.is_empty()) {
        cur = if let Some(s) = part.strip_prefix('[').and_then(|p| p.strip_suffix(']')) {
            cur.get(s.parse::<usize>().ok()?)?
        } else { cur.get(part)? };
    }
    cur.as_f64().or_else(|| cur.as_i64().map(|i| i as f64))
        .or_else(|| cur.as_str().and_then(|s| s.parse().ok()))
}

fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
    let out = Command::new("curl").creation_flags(CREATE_NO_WINDOW)
        .args(&["-s", "--connect-timeout", "10", "--max-time", "30", url]).output()
        .map_err(|e| format!("curl: {}", e))?;
    if !out.status.success() { return Err(format!("curl exit: {}", out.status)); }
    serde_json::from_str(&String::from_utf8_lossy(&out.stdout)).map_err(|e| format!("json: {}", e))
}

fn fetch_custom_data(p: &Provider) -> Result<UsageData, String> {
    let json = fetch_json(p.api_url.as_ref().ok_or("API URL required")?)?;
    let paths = p.json_paths.as_ref().ok_or("JSON paths required")?;
    let u = paths.used.as_ref().and_then(|x| extract_jp(&json, x));
    let t = paths.total.as_ref().and_then(|x| extract_jp(&json, x));
    let r = paths.remaining.as_ref().and_then(|x| extract_jp(&json, x));
    let pct = paths.percentage.as_ref().and_then(|x| extract_jp(&json, x));
    let (fp, fu, ft, fr) = match (u, t, r, pct) {
        (Some(u), Some(t), _, _) if t > 0.0 => (u/t*100.0, Some(u), Some(t), Some(t-u)),
        (_, Some(t), Some(r), _) if t > 0.0 => (r/t*100.0, Some(t-r), Some(t), Some(r)),
        (_, _, _, Some(p)) => (p, None, None, None),
        _ => return Err("need used+total, total+remaining, or percentage".into()),
    };
    Ok(UsageData {
        provider_id: p.id.clone(), provider_name: p.name.clone(),
        provider_type: p.provider_type.clone(), unit: p.unit.clone(), color: p.color.clone(),
        hourly: None, weekly: None, monthly: None,
        percentage: Some(fp), used: fu, total: ft, remaining: fr, error: None,
    })
}

// ---- Commands ----

#[tauri::command]
pub async fn fetch_opencode_go() -> Result<UsageData, String> {
    let (h, w, m) = fetch_opencode_data()?;
    Ok(UsageData {
        provider_id: "opencode-go".into(), provider_name: "OpenCode Go".into(),
        provider_type: "opencode".into(), unit: "usd".into(), color: "#6c5ce7".into(),
        hourly: Some(h.clone()), weekly: Some(w.clone()), monthly: Some(m.clone()),
        percentage: Some(h.percentage), used: Some(h.used),
        total: Some(h.total), remaining: Some(h.remaining), error: None,
    })
}

#[tauri::command]
pub async fn fetch_custom_api(provider: Provider) -> Result<UsageData, String> { fetch_custom_data(&provider) }

#[tauri::command]
pub fn save_config(providers: Vec<Provider>, window: Option<WindowState>) -> Result<(), String> {
    let cfg = AppConfig { providers, window };
    fs::write(config_path(), serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if let Ok(mut c) = CONFIG.lock() { *c = cfg; }
    Ok(())
}

#[tauri::command]
pub fn load_config() -> Result<AppConfig, String> {
    let path = config_path();
    if !path.exists() {
        let d = AppConfig { providers: default_providers(), window: None };
        fs::write(&path, serde_json::to_string_pretty(&d).map_err(|e| e.to_string())?).ok();
        return Ok(d);
    }
    let cfg: AppConfig = serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
        .unwrap_or_else(|_| AppConfig { providers: default_providers(), window: None });
    if let Ok(mut c) = CONFIG.lock() { *c = cfg.clone(); }
    Ok(cfg)
}

#[tauri::command]
pub async fn drag_window(w: tauri::Window, dx: f64, dy: f64) -> Result<(), String> {
    let p = w.outer_position().map_err(|e| e.to_string())?;
    w.set_position(tauri::PhysicalPosition::new(p.x + dx as i32, p.y + dy as i32)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_window(w: tauri::Window, width: f64, height: f64) -> Result<(), String> {
    w.set_size(tauri::PhysicalSize::new(width as u32, height as u32)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_focusable(w: tauri::Window, focusable: bool) -> Result<(), String> {
    w.set_focusable(focusable).map_err(|e| e.to_string())
}
