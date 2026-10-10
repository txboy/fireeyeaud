'use strict';

const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

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
async function waitForHealth(port, token, { attempts = 60, intervalMs = 500 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const health = await getHealth(port, token);
    if (health && health.status === 'ok') return health;
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
    this.child.stdout.on('data', (d) => this.logger.info(`[sidecar:out] ${String(d).trimEnd()}`));
    this.child.stderr.on('data', (d) => this.logger.info(`[sidecar:err] ${String(d).trimEnd()}`));
    this.child.on('exit', (code, signal) => this._onExit(code, signal));

    const health = await waitForHealth(this.port, this.token);
    if (this._stopping) {
      return this.getInfo();
    }
    if (health) {
      this.status = 'running';
      this.health = health;
    } else {
      this.status = 'failed';
      this.logger.error('[sidecar] health check timed out');
    }
    this._emit();
    return this.getInfo();
  }

  _onExit(code, signal) {
    if (this._stopping) return;
    this.logger.info(`[sidecar] exited code=${code} signal=${signal}`);
    this.health = null;
    this.child = null;
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
