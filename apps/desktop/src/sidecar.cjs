'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');

/** 选一个 127.0.0.1 上的空闲端口。 */
function findFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** 请求一次 /health；成功返回解析体，失败返回 null。 */
function getHealth(port, token, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/api/v1/health',
        timeout: timeoutMs,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** 轮询 /health 直到就绪或超时。 */
async function waitForHealth(
  port,
  token,
  { attempts = 60, intervalMs = 500, isCancelled = () => false } = {},
) {
  for (let i = 0; i < attempts; i += 1) {
    if (isCancelled()) return null;
    const health = await getHealth(port, token);
    if (health && health.status === 'ok') return health;
    if (isCancelled()) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

function pythonExeFor(repoRoot) {
  const base = path.join(repoRoot, 'services', 'agent', '.venv');
  return process.platform === 'win32'
    ? path.join(base, 'Scripts', 'python.exe')
    : path.join(base, 'bin', 'python');
}

/** 打包态：PyInstaller 产出的 sidecar 可执行（`extraResources/agent/`）。 */
function bundledAgentExe() {
  if (!process.resourcesPath) return null;
  const name = process.platform === 'win32' ? 'fireeyeaud-agent.exe' : 'fireeyeaud-agent';
  const candidate = path.join(process.resourcesPath, 'agent', name);
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * 管理 Python sidecar 的启动、健康检查、崩溃重启与退出回收。
 * 纯 Node 模块（不依赖 electron），便于独立测试。
 */
class SidecarManager {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot;
    this.token = options.token;
    this.host = options.host || '127.0.0.1';
    this.pythonExe = options.pythonExe || pythonExeFor(options.repoRoot);
    this.agentExe = options.agentExe || null;
    this.uvBin = options.uvBin || 'uv';
    this.logger = options.logger || console;
    this.maxRestarts = options.maxRestarts ?? 3;

    this.port = null;
    this.child = null;
    this.status = 'stopped'; // stopped | starting | running | failed
    this.health = null;
    this.restarts = 0;
    this.onStatus = () => {};
    this._stopping = false;
    // 冷启动时机器可能很卡（Electron/Chromium 抢磁盘 + 杀毒扫描），默认最多等 120 秒。
    this.healthTimeoutMs = options.healthTimeoutMs ?? 120_000;
    this.healthIntervalMs = options.healthIntervalMs ?? 500;
    // 启动阶段先同步等一段时间，超过就转后台继续探测，避免一直卡在「启动中」。
    this.startWaitMs = options.startWaitMs ?? 5_000;
    this._readyProbe = null;
  }

  getInfo() {
    return { port: this.port, token: this.token, status: this.status, health: this.health };
  }

  _emit() {
    try {
      this.onStatus(this.getInfo());
    } catch {
      /* ignore listener errors */
    }
  }

  _buildCommand(port) {
    if (this.agentExe) {
      return { cmd: this.agentExe, args: [], cwd: path.dirname(this.agentExe) };
    }
    const agentDir = path.join(this.repoRoot, 'services', 'agent');
    const uvicornArgs = [
      '-m',
      'uvicorn',
      'fireeyeaud_agent.main:app',
      '--host',
      this.host,
      '--port',
      String(port),
    ];
    if (this.pythonExe && fs.existsSync(this.pythonExe)) {
      return { cmd: this.pythonExe, args: uvicornArgs, cwd: agentDir };
    }
    return {
      cmd: this.uvBin,
      args: ['run', '--project', agentDir, ...uvicornArgs],
      cwd: this.repoRoot,
    };
  }

  async start() {
    this._stopping = false;
    this.port = await findFreePort(this.host);
    const { cmd, args, cwd } = this._buildCommand(this.port);

    this.status = 'starting';
    this._emit();
    this.logger.info(`[sidecar] spawn ${cmd} ${args.join(' ')} (port ${this.port})`);

    this.child = spawn(cmd, args, {
      cwd,
      env: {
        ...process.env,
        FIREYEAUD_TOKEN: this.token || '',
        FIREYEAUD_HOST: this.host,
        FIREYEAUD_PORT: String(this.port),
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.on('data', (d) => this._pipeOutput('out', d));
    this.child.stderr.on('data', (d) => this._pipeOutput('err', d));
    this.child.on('exit', (code, signal) => this._onExit(code, signal));

    const health = await this._waitReady(this.startWaitMs);
    if (this._stopping) {
      return this.getInfo();
    }
    if (health) {
      this.status = 'running';
      this.health = health;
      this._emit();
    } else {
      // 还没起来：保持 starting，转后台继续探测（就绪后自动变 running 并通知前端）。
      this.logger.info(
        `[sidecar] 启动较慢，继续在后台探测（最多 ${Math.round(this.healthTimeoutMs / 1000)}s）`,
      );
      this._emit();
      this._probeInBackground();
    }
    return this.getInfo();
  }

  /**
   * stdout/stderr 用同一个写流：分包时多字节汉字会被拆成两半，分别写入会变成乱码。
   */
  _pipeOutput(stream, chunk) {
    this._outBuffer = this._outBuffer || { out: '', err: '' };
    // 先做 UTF-8 解码再拆分：直接 String(chunk) 会把跨包的多字节汉字拆坏。
    const pending = this._outBuffer[stream] + this._decoder(stream).write(chunk);
    const lines = pending.split(/\r?\n/);
    this._outBuffer[stream] = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) this.logger.info(`[sidecar:${stream}] ${line}`);
    }
  }

  /** 每个输出流一个增量解码器（跨 chunk 保留未完成的多字节序列）。 */
  _decoder(stream) {
    this._decoders = this._decoders || {};
    this._decoders[stream] = this._decoders[stream] || new StringDecoder('utf8');
    return this._decoders[stream];
  }

  /** 等进程就绪；`timeoutMs` 内没就绪返回 null（不判失败）。 */
  async _waitReady(timeoutMs) {
    const attempts = Math.max(1, Math.round(timeoutMs / this.healthIntervalMs));
    return waitForHealth(this.port, this.token, {
      attempts,
      intervalMs: this.healthIntervalMs,
      isCancelled: () => this._stopping,
    });
  }

  /** 后台继续探测直到就绪或超时；就绪后自动切到 running，前端无需重启后端。 */
  _probeInBackground() {
    if (this._readyProbe || this._stopping) return;
    const deadline = Date.now() + this.healthTimeoutMs;
    const currentChild = this.child;

    const tick = async () => {
      if (this._stopping || this.status === 'running' || this.child !== currentChild) {
        this._readyProbe = null;
        return;
      }
      const health = await getHealth(this.port, this.token);
      if (this._stopping || this.child !== currentChild) {
        this._readyProbe = null;
        return;
      }
      if (health && health.status === 'ok') {
        this.status = 'running';
        this.health = health;
        this._readyProbe = null;
        this.logger.info(`[sidecar] 后台探测成功，已就绪 (port ${this.port})`);
        this._emit();
        return;
      }
      if (Date.now() >= deadline) {
        this.status = 'failed';
        this._readyProbe = null;
        this.logger.error('[sidecar] 等待就绪超时');
        this._emit();
        return;
      }
      this._readyProbe = setTimeout(tick, this.healthIntervalMs);
      if (typeof this._readyProbe.unref === 'function') this._readyProbe.unref();
    };

    this._readyProbe = setTimeout(tick, this.healthIntervalMs);
    if (typeof this._readyProbe.unref === 'function') this._readyProbe.unref();
  }

  _onExit(code, signal) {
    if (this._stopping) return;
    this.logger.info(`[sidecar] exited code=${code} signal=${signal}`);
    this.health = null;
    this.child = null;
    if (this._readyProbe) {
      clearTimeout(this._readyProbe);
      this._readyProbe = null;
    }
    if (this.restarts < this.maxRestarts) {
      this.restarts += 1;
      this.logger.info(`[sidecar] restarting (${this.restarts}/${this.maxRestarts})`);
      setTimeout(() => {
        this.start().catch((err) => this.logger.error(`[sidecar] restart failed: ${err}`));
      }, 1000);
    } else {
      this.status = 'failed';
      this._emit();
    }
  }

  async stop() {
    this._stopping = true;
    this.status = 'stopped';
    if (this._readyProbe) {
      clearTimeout(this._readyProbe);
      this._readyProbe = null;
    }
    const child = this.child;
    this.child = null;
    if (child && child.pid) {
      await new Promise((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        child.once('exit', done);
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          done();
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
          done();
        }, 5000);
      });
    }
    this._emit();
  }
}

module.exports = {
  SidecarManager,
  findFreePort,
  waitForHealth,
  getHealth,
  pythonExeFor,
  bundledAgentExe,
};
