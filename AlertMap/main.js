// Обгортка Electron: запускає сервер усередині та відкриває вікно (для .exe)
const { app, BrowserWindow } = require('electron');
const server = require('./server');
app.whenReady().then(async () => {
  const port = await server.start(0, app.getPath('userData'), '127.0.0.1');
  const w = new BrowserWindow({ width: 1280, height: 800, backgroundColor: '#111', autoHideMenuBar: true, title: 'AlertMap' });
  w.loadURL('http://127.0.0.1:' + port);
});
app.on('window-all-closed', () => app.quit());
