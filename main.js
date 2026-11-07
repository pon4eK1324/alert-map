// Обгортка Electron: запускає сервер усередині та відкриває вікно (для .exe)
const { app, BrowserWindow, net, shell, Menu } = require('electron');
const path = require('path'), fs = require('fs');
const server = require('./server');

// Усередині exe запити до джерел тривог і Telegram ідуть через мережевий стек Chromium (системний проксі, сертифікати),
// а якщо він не спрацював — через звичайний fetch.
server.setFetch(async (u, o) => {
  try { return await net.fetch(u, o); } catch (e) { return await fetch(u, o); }
});

let win = null, prefs = {};
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const loadPrefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch (e) { return {}; } };
const savePrefs = () => { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch (e) {} };
// Автозапуск разом із Windows. Для portable-збірки шлях — це сам .exe, а не тимчасова тека розпакування.
function applyAutostart(on) {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: [] }); } catch (e) {}
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    prefs = loadPrefs();
    if (prefs.autostart === undefined) { prefs.autostart = false; savePrefs(); } // за замовчуванням автозапуск вимкнено (вмикається в меню AlertMap)
    applyAutostart(prefs.autostart);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'AlertMap', submenu: [
        { label: 'Запускати разом із Windows', type: 'checkbox', checked: !!prefs.autostart, click: mi => { prefs.autostart = mi.checked; savePrefs(); applyAutostart(prefs.autostart); } },
        { label: 'На весь екран', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
        { type: 'separator' }, { role: 'quit', label: 'Вийти' }] },
      { label: 'Вигляд', submenu: [{ role: 'reload', label: 'Оновити' }, { role: 'zoomIn', label: 'Збільшити' }, { role: 'zoomOut', label: 'Зменшити' }, { role: 'resetZoom', label: 'Масштаб 100%' }] }
    ]));
    const port = await server.start(0, app.getPath('userData'), '127.0.0.1');
    win = new BrowserWindow({
      width: 1280, height: 800, backgroundColor: '#111', autoHideMenuBar: true, title: 'AlertMap',
      icon: path.join(__dirname, 'public', 'avatar.png')
    });
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; }); // посилання на пости Telegram — у звичайному браузері
    win.loadURL('http://127.0.0.1:' + port);
  });
  app.on('window-all-closed', () => app.quit());
}
