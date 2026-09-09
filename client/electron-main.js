const { app, BrowserWindow, Menu, Tray, nativeImage, desktopCapturer, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { initUpdater } = require('./updater');

const captureSelections = new Map();

let mainWindow = null;
let tray = null;
let isQuitting = false;
let wasapiProcess = null;
let wasapiWebContents = null;
let wasapiHeaderBuffer = Buffer.alloc(0);
let wasapiFormat = null;
let wasapiHeaderParsed = false;
let wasapiStartup = null;
let wasapiStderr = '';
let captureHandlerSession = null;

function appIconPath() {
  return path.join(__dirname, 'gfx', 'icon.ico');
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;

  const icon = nativeImage.createFromPath(appIconPath());
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Konsmon');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Konsmon', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Quit Konsmon',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
}

function packagedNative(...parts) {
  return path.join(process.resourcesPath, 'native', ...parts);
}

const wasapiExe = app.isPackaged
  ? packagedNative('wasapi-loopback', 'wasapi-loopback.exe')
  : path.join(__dirname, 'native', 'wasapi-loopback', 'bin', 'Release', 'net8.0-windows', 'wasapi-loopback.exe');
const processLoopbackExe = app.isPackaged
  ? packagedNative('ApplicationLoopback.exe')
  : path.join(__dirname, 'native', 'ApplicationLoopback', 'cpp', 'x64', 'Release', 'ApplicationLoopback.exe');

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: '#111111',
    icon: appIconPath(),
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow = window;

  // Closing the window only hides it so voice/WebRTC stays alive in the tray.
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.webContents.session.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'display-capture' || permission === 'media';
  });

  window.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'display-capture' || permission === 'media');
  });

  window.loadFile(path.join(__dirname, 'index.html'));

  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    if (url.startsWith('file://')) {
      try {
        const localPath = fileURLToPath(url);
        if (localPath.startsWith(__dirname)) {
          window.loadFile(localPath);
        }
      } catch (error) {
        console.error('Could not open local link:', error);
      }
    }
    return { action: 'deny' };
  });
}

function nativeImageToDataUrl(image, jpegQuality) {
  if (!image || image.isEmpty()) return '';
  if (jpegQuality) {
    const jpeg = image.toJPEG(jpegQuality);
    return jpeg?.length ? `data:image/jpeg;base64,${jpeg.toString('base64')}` : '';
  }
  return image.toDataURL();
}

ipcMain.handle('desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    fetchWindowIcons: true,
    thumbnailSize: { width: 480, height: 270 },
  });

  return sources.map(source => ({
    id: source.id,
    name: source.name,
    type: source.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: nativeImageToDataUrl(source.thumbnail, 72),
    icon: nativeImageToDataUrl(source.appIcon),
  }));
});

ipcMain.handle('desktop-source-selection', (event, selection) => {
  if (!selection?.sourceId) return false;
  captureSelections.set(event.sender.id, {
    sourceId: String(selection.sourceId),
    audio: selection.audio === true,
    audioMode: selection.audioMode === 'loopbackWithMute' ? 'loopbackWithMute' : 'loopback',
  });
  return true;
});

ipcMain.handle('wasapi-start', async (event, sourceId) => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
  const source = sources.find(item => item.id === sourceId);
  if (!source) throw new Error('Selected screen or application is no longer available.');

  await stopWasapiLoopback();
  wasapiWebContents = event.sender;
  wasapiHeaderBuffer = Buffer.alloc(0);
  wasapiFormat = null;
  wasapiHeaderParsed = false;
  wasapiStderr = '';

  setCaptureSource(event.sender.session, source);

  // A window source id is "window:<HWND>:<n>", so the helper can target the process that
  // owns exactly that window and capture only its audio. Whole-screen sharing has no single
  // owning process, so it falls back to capturing the default render device.
  const windowHandle = source.id.startsWith('window:') ? source.id.split(':')[1] : null;

  if (windowHandle) {
    console.log(`[LOOPBACK] Capturing window ${windowHandle} ("${source.name}")`);
    wasapiProcess = spawn(processLoopbackExe, [`hwnd:${windowHandle}`, 'includetree', '-'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    console.log(`[LOOPBACK] Capturing the default render device for "${source.name}"`);
    wasapiProcess = spawn(wasapiExe, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  const helper = wasapiProcess;
  helper.stdout.on('data', chunk => handleWasapiOutput(chunk));
  helper.stderr.on('data', chunk => {
    const text = chunk.toString().trim();
    wasapiStderr += (wasapiStderr ? '\n' : '') + text;
    console.error('[LOOPBACK]', text);
  });
  helper.on('error', error => finishWasapiStartup(null, error));
  helper.on('close', code => {
    // Exiting before a format header means the helper never got as far as capturing.
    finishWasapiStartup(null, new Error(
      `The audio capture helper exited (code ${code}).` + (wasapiStderr ? ` ${wasapiStderr}` : '')));
    if (helper === wasapiProcess) handleWasapiClosed();
  });

  try {
    return await waitForWasapiHeader();
  } catch (error) {
    await stopWasapiLoopback();
    throw error;
  }
});

ipcMain.handle('wasapi-stop', async () => {
  await stopWasapiLoopback();
  return true;
});

ipcMain.handle('desktop-video-source', async (event, sourceId) => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
  const source = sources.find(item => item.id === sourceId);
  if (!source) throw new Error('Selected screen or application is no longer available.');
  setCaptureSource(event.sender.session, source);
  return true;
});

function setCaptureSource(session, source) {
  clearCaptureSource();
  captureHandlerSession = session;
  session.setDisplayMediaRequestHandler((_request, callback) => {
    callback({ video: source });
  });
}

// The handler pins getDisplayMedia to one source, so it has to be removed once the
// capture it was installed for is over.
function clearCaptureSource() {
  try {
    captureHandlerSession?.setDisplayMediaRequestHandler(null);
  } catch (error) {
    console.error('Could not clear the display media handler:', error);
  }
  captureHandlerSession = null;
}

function sendToCaptureRenderer(channel, payload) {
  if (!wasapiWebContents || wasapiWebContents.isDestroyed()) return;
  wasapiWebContents.send(channel, payload);
}

function handleWasapiOutput(chunk) {
  if (wasapiHeaderParsed) {
    sendToCaptureRenderer('wasapi-data', chunk);
    return;
  }

  wasapiHeaderBuffer = Buffer.concat([wasapiHeaderBuffer, chunk]);
  const headerEnd = wasapiHeaderBuffer.indexOf(0x0a);
  if (headerEnd === -1) return;

  const header = wasapiHeaderBuffer.subarray(0, headerEnd).toString('utf8');
  const audioData = wasapiHeaderBuffer.subarray(headerEnd + 1);
  wasapiHeaderBuffer = Buffer.alloc(0);

  let format;
  try {
    format = JSON.parse(header);
  } catch (error) {
    finishWasapiStartup(null, new Error(`The audio capture helper sent an unreadable format: ${header}`));
    return;
  }

  wasapiFormat = format;
  wasapiHeaderParsed = true;
  console.log(`[LOOPBACK] Format: ${format.sampleRate}Hz, ${format.channels}ch, ${format.bitsPerSample}-bit ${format.encoding}`);
  finishWasapiStartup(format, null);

  if (audioData.length) sendToCaptureRenderer('wasapi-data', audioData);
}

function handleWasapiClosed() {
  wasapiProcess = null;
  sendToCaptureRenderer('wasapi-ended');
}

// Resolves with the format the helper announced, or rejects if it dies or stalls first.
function waitForWasapiHeader() {
  if (wasapiFormat) return Promise.resolve(wasapiFormat);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finishWasapiStartup(null, new Error('The audio capture helper did not start in time.')), 5000);
    wasapiStartup = { resolve, reject, timeout };
  });
}

function finishWasapiStartup(format, error) {
  if (!wasapiStartup) return;
  const { resolve, reject, timeout } = wasapiStartup;
  wasapiStartup = null;
  clearTimeout(timeout);
  if (format) resolve(format);
  else reject(error);
}

async function stopWasapiLoopback() {
  finishWasapiStartup(null, new Error('Audio capture was stopped.'));
  if (wasapiProcess) {
    wasapiProcess.removeAllListeners('close');
    wasapiProcess.kill();
    wasapiProcess = null;
  }
  clearCaptureSource();
  wasapiWebContents = null;
  wasapiHeaderBuffer = Buffer.alloc(0);
  wasapiFormat = null;
  wasapiHeaderParsed = false;
  wasapiStderr = '';
}

ipcMain.on('window-minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('window-toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window?.isMaximized()) window.unmaximize();
  else window?.maximize();
});

ipcMain.on('window-close', (event) => {
  // Same path as the OS close button: hide to tray instead of destroying the session.
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// Read synchronously so the preload can hand the renderer a plain string, which lets the
// page render its version straight away instead of patching it in after a round trip.
ipcMain.on('app-version', (event) => { event.returnValue = app.getVersion(); });

app.on('web-contents-created', (_event, contents) => {
  contents.once('destroyed', () => {
    captureSelections.delete(contents.id);
    // The helper runs until it is killed, so it must not outlive the page that asked for it.
    if (contents === wasapiWebContents) stopWasapiLoopback();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  stopWasapiLoopback();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createTray();
  createWindow();
  initUpdater();

  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Stay alive in the tray on Windows/Linux; only macOS uses the activate/reopen pattern above.
  if (process.platform === 'darwin') return;
  if (isQuitting) app.quit();
});