'use strict';

const statusEl = document.getElementById('status');
const healthEl = document.getElementById('health');
const streamEl = document.getElementById('stream');
const sendBtn = document.getElementById('send');
const msgEl = document.getElementById('message');

const STATUS_MAP = {
  starting: ['启动中…', 'pill--pending'],
  running: ['运行中', 'pill--ok'],
  stopped: ['已停止', 'pill--fail'],
  failed: ['失败', 'pill--fail'],
};

let info = null;

function renderStatus(current) {
  const [text, cls] = STATUS_MAP[current.status] || ['未知', 'pill--pending'];
  statusEl.textContent = text;
  statusEl.className = `pill ${cls}`;
  if (current.port) {
    healthEl.textContent = `127.0.0.1:${current.port}${current.health ? ` · ${current.health.status}` : ''}`;
  }
}

async function probeHealth() {
  const res = await fetch(`http://127.0.0.1:${info.port}/api/v1/health`, {
    headers: { Authorization: `Bearer ${info.token}` },
  });
  const body = await res.json();
  healthEl.textContent = `127.0.0.1:${info.port} · ${body.status} · v${body.appVersion}`;
}

async function send() {
  sendBtn.disabled = true;
  streamEl.textContent = '';
  info = await window.fireeyeaud.getSidecarInfo();
  renderStatus(info);

  const res = await fetch(`http://127.0.0.1:${info.port}/api/v1/sessions/s_stub/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${info.token}`,
    },
    body: JSON.stringify({ message: msgEl.value, locale: 'zh-CN' }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const evt = JSON.parse(line.slice(5).trim());
        if (evt.type === 'token') streamEl.textContent += evt.data.delta;
        else streamEl.textContent += `\n· ${evt.type} ${JSON.stringify(evt.data)}`;
      }
      idx = buffer.indexOf('\n\n');
    }
  }
  sendBtn.disabled = false;
}

async function init() {
  if (!window.fireeyeaud) {
    statusEl.textContent = 'preload 未加载';
    statusEl.className = 'pill pill--fail';
    return;
  }
  window.fireeyeaud.onSidecarStatus(renderStatus);
  info = await window.fireeyeaud.getSidecarInfo();
  renderStatus(info);
  if (info.status === 'running') await probeHealth();
}

sendBtn.addEventListener('click', () => {
  send().catch((err) => {
    streamEl.textContent += `\n[error] ${err}`;
    sendBtn.disabled = false;
  });
});

init().catch((err) => {
  statusEl.textContent = `初始化失败：${err}`;
  statusEl.className = 'pill pill--fail';
});
