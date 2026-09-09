const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startWasapiLoopback: sourceId => ipcRenderer.invoke('wasapi-start', sourceId),
  stopWasapiLoopback: () => ipcRenderer.invoke('wasapi-stop'),
  setDesktopVideoSource: sourceId => ipcRenderer.invoke('desktop-video-source', sourceId),
  onWasapiData: callback => ipcRenderer.on('wasapi-data', (_event, data) => callback(data)),
  onWasapiEnded: callback => ipcRenderer.on('wasapi-ended', callback),
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),
  getDesktopSources: () => ipcRenderer.invoke('desktop-sources'),
  setDesktopSource: (sourceId, audio, audioMode) => ipcRenderer.invoke('desktop-source-selection', { sourceId, audio, audioMode }),
  minimize: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  close: () => ipcRenderer.send('window-close'),
  appVersion: ipcRenderer.sendSync('app-version'),
  getUpdateStatus: () => ipcRenderer.invoke('update-status'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateStatus: callback => ipcRenderer.on('update-status', (_event, status) => callback(status)),
});