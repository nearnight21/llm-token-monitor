// LLM Token Monitor — 前端
const tauri = window.__TAURI__ || {};
const invoke = tauri.core?.invoke || tauri.invoke;
const listen = tauri.event?.listen;

const $ = id => document.getElementById(id);
const compactBar = $('compact-bar');
const expandedPanel = $('expanded-panel');
const settingsPanel = $('settings-panel');
const app = $('app');
const compactRingFill = document.querySelector('.ring-fill');
const compactPct = $('compact-pct');
const providerDots = $('provider-dots');
const providerCards = $('provider-cards');
const providerList = $('provider-list');
const providerEditor = $('provider-editor');

let state = 'COMPACT';
let providers = [];
let providerData = {};
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let expandTimer = null;
let collapseTimer = null;
let editingProvider = null;
let pollingTimers = {};
let suppressCollapse = false;

// ===== 拖拽 =====
app.addEventListener('mousedown', e => {
  if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
  isDragging = true;
  dragStart = { x: e.screenX, y: e.screenY };
});
app.addEventListener('mousemove', async e => {
  if (!isDragging) return;
  const dx = e.screenX - dragStart.x, dy = e.screenY - dragStart.y;
  dragStart = { x: e.screenX, y: e.screenY };
  await invoke('drag_window', { dx, dy });
});
app.addEventListener('mouseup', () => { isDragging = false; });

// ===== 状态切换 =====
app.addEventListener('mouseenter', () => {
  clearTimeout(collapseTimer);
  if (state === 'COMPACT') {
    clearTimeout(expandTimer);
    expandTimer = setTimeout(() => switchState('EXPANDED'), 100);
  }
});
app.addEventListener('mouseleave', () => { clearTimeout(expandTimer); scheduleCollapse(); });
window.addEventListener('blur', () => { if (state !== 'SETTINGS') switchState('COMPACT'); });

function scheduleCollapse() {
  if (state === 'EXPANDED' && !suppressCollapse) {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => switchState('COMPACT'), 2000);
  }
}

async function switchState(newState) {
  if (state === newState) return;
  state = newState;

  if (newState === 'COMPACT') {
    expandedPanel.classList.add('hidden'); settingsPanel.classList.add('hidden');
    await invoke('resize_window', { width: 170, height: 48 });
    compactBar.classList.remove('hidden');
    compactBar.classList.add('idle');
    renderCompactBar();
    await invoke('set_focusable', { focusable: false });
    suppressCollapse = false;
  } else if (newState === 'EXPANDED') {
    compactBar.classList.add('hidden'); expandedPanel.classList.remove('hidden');
    settingsPanel.classList.add('hidden'); compactBar.classList.remove('idle');
    renderCards();
    // 根据内容自适应高度
    await new Promise(r => setTimeout(r, 50));
    const h = Math.min(expandedPanel.scrollHeight + 10, 600);
    await invoke('resize_window', { width: 420, height: Math.max(h, 180) });
    await invoke('set_focusable', { focusable: true });
  } else if (newState === 'SETTINGS') {
    compactBar.classList.add('hidden'); expandedPanel.classList.add('hidden');
    settingsPanel.classList.remove('hidden'); compactBar.classList.remove('idle');
    await invoke('resize_window', { width: 500, height: 560 });
    await invoke('set_focusable', { focusable: true });
    suppressCollapse = true;
    renderProviderList();
  }
}

// ===== 工具函数 =====
function esc(s) { return s == null ? '' : String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

// ===== 缩略条渲染（环形进度） =====
function renderCompactBar() {
  providerDots.innerHTML = '';
  const enabled = providers.filter(p => p.enabled);
  if (!enabled.length) {
    compactRingFill.style.strokeDashoffset = '100.53';
    compactPct.textContent = '--';
    return;
  }
  for (const p of enabled) {
    const dot = document.createElement('span');
    dot.className = 'dot'; dot.style.background = p.color || '#6c5ce7'; dot.title = p.name;
    providerDots.appendChild(dot);
  }
  const first = enabled[0];
  const data = providerData[first.id];
  let pct = data?.hourly?.percentage ?? data?.percentage ?? 0;
  pct = Math.max(0, Math.min(pct, 100));
  const color = pct >= 90 ? '#f44336' : pct >= 70 ? '#ff9800' : (first.color || '#6c5ce7');

  const circumference = 2 * Math.PI * 16; // ~100.53
  const offset = circumference - (pct / 100) * circumference;
  compactRingFill.style.strokeDasharray = String(circumference);
  compactRingFill.style.strokeDashoffset = String(offset);
  compactRingFill.style.stroke = color;
  compactRingFill.classList.toggle('warn', pct >= 70 && pct < 90);
  compactRingFill.classList.toggle('danger', pct >= 90);
  compactPct.textContent = Math.round(pct) + '%';
}

// ===== 展开面板渲染 =====
function renderCards() {
  providerCards.innerHTML = '';
  const enabled = providers.filter(p => p.enabled);
  if (!enabled.length) {
    providerCards.innerHTML = '<div style="padding:20px;text-align:center;color:#888;">还没有启用的 Provider<br>点击齿轮设置</div>';
    return;
  }
  for (const p of enabled) {
    const data = providerData[p.id];
    const card = document.createElement('div');
    card.className = 'provider-card';
    card.style.setProperty('--c', p.color || '#6c5ce7');

    if (data?.error && !data.hourly && data.percentage == null) {
      card.innerHTML = `<div class="card-header"><span class="card-name">${esc(p.name)}</span></div><div class="card-error">⚠ ${esc(data.error)}</div>`;
    } else if (data?.hourly) {
      const h = data.hourly, w = data.weekly, m = data.monthly;
      const pctColor = h.percentage >= 90 ? '#f44336' : h.percentage >= 70 ? '#ff9800' : p.color;
      card.innerHTML = `<div class="card-header"><span class="card-name">${esc(p.name)}</span><span class="card-pct" style="color:${pctColor}">${h.percentage.toFixed(0)}%</span></div>
        ${progressRow('5h', h, p.color)}${progressRow('Week', w, p.color)}${progressRow('Month', m, p.color)}
        <div class="card-updated">${new Date().toLocaleTimeString()}</div>`;
    } else if (data) {
      const pct = data.percentage ?? 0;
      const c = pct >= 90 ? '#f44336' : pct >= 70 ? '#ff9800' : p.color;
      card.innerHTML = `<div class="card-header"><span class="card-name">${esc(p.name)}</span><span class="card-pct" style="color:${c}">${pct.toFixed(0)}%</span></div>
        ${progressRow('用量', data, p.color)}<div class="card-updated">${new Date().toLocaleTimeString()}</div>`;
    } else {
      card.innerHTML = `<div class="card-header"><span class="card-name">${esc(p.name)}</span></div><div style="color:#666;font-size:11px;">加载中...</div>`;
    }
    providerCards.appendChild(card);
  }
}

function progressRow(label, p, color) {
  const pct = p.percentage ?? 0;
  const cls = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : '';
  const w = Math.min(pct, 100);
  return `<div class="progress-row"><span class="progress-label">${label}</span><div class="progress-bar"><div class="progress-fill ${cls}" style="width:${w}%;background:${cls ? '' : color}"></div></div><span class="progress-value">${pct.toFixed(0)}%</span></div>`;
}

// ===== 设置面板 =====
function renderProviderList() {
  providerList.innerHTML = '';
  if (!providers.length) {
    providerList.innerHTML = '<div style="color:#888;font-size:11px;text-align:center;padding:20px;">还没有 Provider<br>点击「+ 添加」</div>';
    return;
  }
  providers.forEach((p, i) => {
    const row = document.createElement('div'); row.className = 'provider-row';
    const url = p.provider_type === 'opencode' ? 'opencode://' : (p.api_url || '');
    row.innerHTML = `<span class="p-dot" style="background:${p.color}"></span>
      <div class="p-info"><div class="p-name">${esc(p.name)}</div><div class="p-url">${esc(url)}</div></div>
      <span class="p-type">${p.provider_type === 'opencode' ? 'OC' : 'API'}</span>
      <button class="edit" data-i="${i}">✎</button><button class="delete" data-i="${i}">×</button>`;
    row.querySelector('.edit').onclick = () => openEditor(i);
    row.querySelector('.delete').onclick = () => deleteProvider(i);
    providerList.appendChild(row);
  });
}

function openEditor(index) {
  editingProvider = index;
  const p = index >= 0 ? providers[index] : { name:'', color:'#6c5ce7', provider_type:'json', enabled:true, unit:'usd', api_url:'', json_paths:{used:'',total:'',remaining:'',percentage:''}, polling_interval_ms:60000 };
  providerEditor.classList.remove('hidden');
  $('ed-name').value = p.name || '';
  $('ed-color').value = p.color || '#6c5ce7';
  $('ed-type').value = p.provider_type || 'json';
  $('ed-url').value = p.api_url || '';
  $('ed-unit').value = p.unit || 'usd';
  $('ed-interval').value = (p.polling_interval_ms || 60000) / 1000;
  const jp = p.json_paths || {};
  $('ed-jp-used').value = jp.used || '';
  $('ed-jp-total').value = jp.total || '';
  $('ed-jp-remaining').value = jp.remaining || '';
  $('ed-jp-pct').value = jp.percentage || '';
  const isOC = p.provider_type === 'opencode';
  $('opencode-fields').classList.toggle('hidden', !isOC);
  $('json-fields').classList.toggle('hidden', isOC);
  $('ed-url-label').textContent = isOC ? 'Workspace URL' : 'API URL';
  $('ed-url').placeholder = isOC ? 'https://opencode.ai/workspace/wrk_xxx/go' : 'https://api.example.com/usage';
}

function closeEditor() { providerEditor.classList.add('hidden'); editingProvider = null; }

function saveEditor() {
  const name = $('ed-name').value.trim() || 'Unnamed';
  const color = $('ed-color').value;
  const type = $('ed-type').value;
  const url = $('ed-url').value.trim();
  const unit = $('ed-unit').value;
  const interval = parseInt($('ed-interval').value, 10) || 60;
  const jp = { used: $('ed-jp-used').value.trim(), total: $('ed-jp-total').value.trim(), remaining: $('ed-jp-remaining').value.trim(), percentage: $('ed-jp-pct').value.trim() };
  if (type === 'json' && !url) { alert('请填写 API URL'); return; }
  if (type === 'json' && !jp.used && !jp.total && !jp.remaining && !jp.percentage) { alert('请至少填写一个 JSON Path'); return; }

  const provider = {
    id: editingProvider >= 0 ? providers[editingProvider].id : `p-${Date.now()}`,
    name, color, provider_type: type, enabled: true, unit,
    polling_interval_ms: interval * 1000,
    api_url: url || null,
    json_paths: type === 'opencode' ? null : jp,
  };
  if (editingProvider >= 0) providers[editingProvider] = provider;
  else providers.push(provider);
  closeEditor();
  renderProviderList();
  saveAndRestart();
}

function deleteProvider(i) {
  if (!confirm(`删除 "${providers[i].name}"?`)) return;
  providers.splice(i, 1); renderProviderList(); saveAndRestart();
}

async function saveAndRestart() {
  try { await invoke('save_config', { providers, window: null }); pollAll(); } catch (e) { alert('保存失败: ' + e); }
}

// ===== 数据轮询 =====
async function pollProvider(p) {
  try {
    providerData[p.id] = p.provider_type === 'opencode'
      ? await invoke('fetch_opencode_go', { provider: p })
      : await invoke('fetch_custom_api', { provider: p });
  } catch (err) {
    providerData[p.id] = { error: String(err), provider_id: p.id, provider_name: p.name, provider_type: p.provider_type, color: p.color, unit: p.unit };
  }
}

async function pollAll() {
  for (const p of providers.filter(p => p.enabled)) await pollProvider(p);
  renderCompactBar();
  if (state === 'EXPANDED') renderCards();
}

function setupPolling() {
  for (const id in pollingTimers) clearInterval(pollingTimers[id]);
  pollingTimers = {};
  for (const p of providers.filter(p => p.enabled)) {
    pollProvider(p);
    pollingTimers[p.id] = setInterval(() => pollProvider(p), p.polling_interval_ms || 60000);
  }
}

// ===== 事件绑定 =====
$('btn-collapse').onclick = e => { e.stopPropagation(); switchState('COMPACT'); };
$('btn-settings').onclick = e => { e.stopPropagation(); switchState('SETTINGS'); };
$('btn-settings-compact').onclick = e => { e.stopPropagation(); switchState('SETTINGS'); };
$('btn-settings-close').onclick = async e => { e.stopPropagation(); await saveAndRestart(); switchState('COMPACT'); };
$('btn-add-provider').onclick = e => { e.stopPropagation(); openEditor(-1); };
$('ed-cancel').onclick = e => { e.stopPropagation(); closeEditor(); };
$('ed-save').onclick = e => { e.stopPropagation(); saveEditor(); };
$('ed-type').onchange = e => {
  const isOC = e.target.value === 'opencode';
  $('opencode-fields').classList.toggle('hidden', !isOC);
  $('json-fields').classList.toggle('hidden', isOC);
  $('ed-url-label').textContent = isOC ? 'Workspace URL' : 'API URL';
  $('ed-url').placeholder = isOC ? 'https://opencode.ai/workspace/wrk_xxx/go' : 'https://api.example.com/usage';
};

settingsPanel.addEventListener('mouseenter', () => clearTimeout(collapseTimer));
expandedPanel.addEventListener('mouseenter', () => clearTimeout(collapseTimer));
providerEditor.addEventListener('mouseenter', () => clearTimeout(collapseTimer));

listen?.('open-settings', () => switchState('SETTINGS'));

// ===== 启动 =====
(async function init() {
  try { providers = (await invoke('load_config')).providers || []; } catch (e) { providers = []; }
  compactBar.classList.add('idle');
  setupPolling();
  renderCompactBar();
})();
