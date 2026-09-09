const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Renderers can finish loading after a check has already resolved, so the latest status is
// kept here and replayed on request instead of only being pushed as it happens.
let lastStatus = { state: 'idle' };
let quitting = false;

function setStatus(state, payload = {}) {
  lastStatus = { state, ...payload };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('update-status', lastStatus);
  }
}

function checkForUpdates() {
  // checkForUpdates rejects and emits 'error', so the rejection is absorbed here and the
  // 'error' handler is left to report it.
  return autoUpdater.checkForUpdates().catch(() => null);
}

function initUpdater() {
  ipcMain.handle('update-status', () => lastStatus);
  ipcMain.handle('update-check', () => checkForUpdates().then(() => lastStatus));
  ipcMain.handle('update-install', () => {
    if (lastStatus.state !== 'ready' || quitting) return false;
    quitting = true;
    // Let this call return to the renderer before the app is torn down.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  });

  // There is no installer to replace when running from source, and electron-updater throws
  // rather than no-opping, so development runs skip the updater entirely.
  if (!app.isPackaged) {
    setStatus('disabled');
    return;
  }

  autoUpdater.logger = console;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => setStatus('checking'));
  autoUpdater.on('update-not-available', () => setStatus('up-to-date'));
  autoUpdater.on('update-available', info => setStatus('downloading', { version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', progress => {
    setStatus('downloading', { version: lastStatus.version, percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', info => setStatus('ready', { version: info.version }));
  autoUpdater.on('error', error => setStatus('error', { message: String(error?.message || error) }));

  checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS).unref();
}

module.exports = { initUpdater };
