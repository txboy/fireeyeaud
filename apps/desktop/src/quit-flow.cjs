'use strict';

/**
 * 退出流程：先停 sidecar，再决定是否拉起已下载的更新安装器。
 * 依赖全部注入，便于单测。
 */
function createQuitFlow({
  app,
  sidecar,
  getUpdater,
  logger = console,
  stopWorkspaceWatch = () => {},
  sidecarStopTimeoutMs = 5000,
  installTimeoutMs = 5000,
}) {
  let shutdownStarted = false;
  let allowQuit = false;

  /** 等待 sidecar 停止，超时则继续退出。 */
  function stopSidecar() {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        logger.error('[quit] sidecar stop timed out, continuing shutdown');
        resolve();
      }, sidecarStopTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      Promise.resolve()
        .then(() => sidecar.stop())
        .catch((err) => logger.error(`[sidecar] stop failed: ${err}`))
        .finally(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        });
    });
  }

  function finishQuit() {
    const updater = getUpdater();
    const ready = Boolean(updater && updater.isUpdateReady && updater.isUpdateReady());
    if (!ready) {
      app.exit(0);
      return;
    }
    // 必须先把 allowQuit 置为 true：quitAndInstall 内部会同步再次 app.quit()，
    // 那时 before-quit 必须直接放行，否则会再次 preventDefault 把自己卡住。
    allowQuit = true;
    try {
      updater.quitAndInstall();
    } catch (err) {
      logger.error(`[update] quitAndInstall failed: ${err}`);
      app.exit(0);
      return;
    }
    logger.info('[update] installing downloaded update on quit');
    // 故意不 unref：这个看门狗就是用来兜底进程不退出的情况。
    setTimeout(() => {
      logger.error('[update] installer did not quit the app, forcing exit');
      app.exit(0);
    }, installTimeoutMs);
  }

  function onBeforeQuit(event) {
    if (allowQuit) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    stopWorkspaceWatch();
    stopSidecar()
      .then(finishQuit)
      .catch((err) => {
        // finishQuit 已做内部保护；这里兜住意外的同步异常，避免应用卡在退出中。
        logger.error(`[quit] finish quit failed: ${err}`);
        app.exit(0);
      });
  }

  return { onBeforeQuit };
}

module.exports = { createQuitFlow };
