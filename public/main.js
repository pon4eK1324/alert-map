// Electron-обгортка: піднімає локальний сервер AlertMap на вільному порту та відкриває його у вікні.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const server = require('./server');

let win = null;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    // portable-збірка тримає дані (history.json, config.json) поруч із .exe, інакше — у профілі користувача
    const dataDir = process.env.PORTABLE_EXECUTABLE_DIR
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data')
      : path.join(app.getPath('userData'), 'data');
    const port = await server.start(0, dataDir, '127.0.0.1');
    win = new BrowserWindow({
      width: 1280, height: 800, backgroundColor: '#12151b', autoHideMenuBar: true,
      icon: path.join(__dirname, 'public', 'avatar.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.loadURL('http://127.0.0.1:' + port + '/');
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    win.on('closed', () => { win = null; });
  });
  app.on('window-all-closed', () => app.quit());
}
