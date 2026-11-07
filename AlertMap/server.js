// AlertMap server: збирає тривоги + повітряні цілі, пише історію для таймлапсу, віддає сайт.
const http = require('http'), fs = require('fs'), path = require('path');
const CHANNELS = (process.env.TG_CHANNELS || 'kpszsu').split(','); // публічні Telegram-канали (t.me/s/...)
const KEEP = 48 * 3600e3;
let DATA = path.join(__dirname, 'data'), TOKEN = process.env.ALERTS_TOKEN || '';
let alerts = [], source = 'очікування', snaps = [], threats = new Map();

// [основа слова, широта, довгота] — для визначення місць у повідомленнях
const P = [['Київ',50.45,30.52],['Харк',49.99,36.23],['Одес',46.48,30.72],['Дніпр',48.46,35.05],['Льв',49.84,24.03],
['Запоріж',47.84,35.14],['Миколаїв',46.97,32.0],['Херсон',46.64,32.62],['Полтав',49.59,34.55],['Сум(и|щин|ськ)',50.91,34.8],
['Чернігів',51.5,31.3],['Черкас',49.44,32.06],['Житомир',50.25,28.66],['Вінниц',49.23,28.47],['Хмельницьк',49.42,26.99],
['Рівн',50.62,26.25],['Луцьк|Волин',50.75,25.33],['Тернопіл',49.55,25.59],['Івано-Франків|Прикарпат',48.92,24.71],
['Ужгород|Закарпат',48.62,22.29],['Чернівц|Буковин',48.29,25.94],['Кропивниц|Кіровоградщ',48.51,32.26],['Краматорськ',48.72,37.55],
["Слов'янськ",48.87,37.62],['Донеччин|Донецьк',48.0,37.8],['Луганщин|Луганськ',48.57,39.31],['Покровськ',48.28,37.18],
['Кременчук',49.07,33.42],['Біла Церкв',49.8,30.12],['Умань',48.75,30.22],['Бровар',50.51,30.79],['Ніжин',51.05,31.89],
['Конотоп',51.24,33.2],['Шостк',51.87,33.48],['Кривий Ріг|Криворіж',47.91,33.39],['Павлоград',48.53,35.87],['Нікопол',47.57,34.4],
['Миргород',49.97,33.6],['Лубн',50.02,32.99],['Мелітопол',46.84,35.37],['Бердянськ',46.76,36.79],['Ізмаїл|Дунай',45.35,28.84],
['Чорноморськ',46.3,30.65],['Крим',45.0,34.1],["Куп'янськ",49.71,37.61],['Ізюм',49.21,37.27],['Фастів',50.08,29.92]
].map(([s, la, lo]) => [new RegExp(s, 'gi'), la, lo]);

function places(line) {
  const f = [];
  for (const [re, la, lo] of P) { re.lastIndex = 0; const m = re.exec(line); if (m) f.push([m.index, la, lo]); }
  return f.sort((a, b) => a[0] - b[0]).map(x => [x[1], x[2]]);
}
function kind(l) {
  if (/балістик/i.test(l)) return 'ballistic';
  if (/крилат|ракет|калібр|х-101|кинджал|циркон/i.test(l)) return 'missile';
  if (/шахед|бпла|дрон|безпілот|герань/i.test(l)) return 'shahed';
}
const get = async (u, h) => (await fetch(u, { headers: h, signal: AbortSignal.timeout(12000) }));

async function pollAlerts() {
  let list;
  try {
    if (TOKEN) { // безкоштовний токен: https://alerts.in.ua/api-request
      const j = await (await get('https://api.alerts.in.ua/v1/alerts/active.json', { Authorization: 'Bearer ' + TOKEN })).json();
      list = [...new Set(j.alerts.map(a => a.location_oblast))]; source = 'alerts.in.ua';
    } else { // запасний варіант без ключа (якщо сервіс доступний)
      const j = await (await get('https://ubilling.net.ua/aerialalerts/')).json();
      list = Object.entries(j.states).filter(([, v]) => v.alertnow).map(([k]) => k); source = 'ubilling.net.ua';
    }
  } catch (e) { source = 'помилка джерела: ' + e.message + (TOKEN ? '' : ' (додайте токен у config.json)'); return; }
  list.sort();
  if (!snaps.length || JSON.stringify(list) !== JSON.stringify(alerts)) snaps.push({ t: Date.now(), a: list });
  alerts = list;
}

async function pollTG(ch) {
  try {
    const h = await (await get('https://t.me/s/' + ch)).text();
    for (const p of h.split('tgme_widget_message_wrap').slice(1)) {
      const id = (p.match(/data-post="([^"]+)"/) || [])[1], ts = (p.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
      const m = p.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
      if (!id || !ts || !m) continue;
      const text = m[1].replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'");
      text.split('\n').forEach((line, i) => {
        const k = kind(line), pts = places(line), key = id + '#' + i;
        if (k && pts.length && !threats.has(key)) threats.set(key, { id: key, type: k, t: Date.parse(ts), pts, text: line.trim().slice(0, 300) });
      });
    }
  } catch (e) { /* канал тимчасово недоступний */ }
}

function save() {
  const cut = Date.now() - KEEP;
  for (const [k, v] of threats) if (v.t < cut) threats.delete(k);
  while (snaps.length > 1 && snaps[1].t < cut) snaps.shift();
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, 'history.json'), JSON.stringify({ snaps, threats: [...threats.values()] })); } catch (e) {}
}
const recent = ms => [...threats.values()].filter(t => t.t > Date.now() - ms).sort((a, b) => a.t - b.t);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/state') return json({ now: Date.now(), alerts, threats: recent(3600e3), source });
  if (u.pathname === '/api/history') {
    const ms = Math.min(48, +u.searchParams.get('hours') || 24) * 3600e3, from = Date.now() - ms;
    let s = snaps.filter(x => x.t >= from), before = snaps.filter(x => x.t < from).pop();
    if (before) s.unshift({ t: from, a: before.a });
    return json({ now: Date.now(), from, snaps: s, threats: recent(ms), source });
  }
  const f = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(f, (e, d) => e ? (res.writeHead(404), res.end('Not found')) : (res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }), res.end(d)));
});

exports.start = (port = +process.env.PORT || 3000, dataDir, host = process.env.HOST || '0.0.0.0') => new Promise(ok => {
  if (dataDir) DATA = dataDir;
  for (const d of [DATA, process.cwd(), process.env.PORTABLE_EXECUTABLE_DIR, __dirname]) {
    try { if (!TOKEN) TOKEN = JSON.parse(fs.readFileSync(path.join(d || '.', 'config.json'))).alertsToken || ''; } catch (e) {}
  }
  try { const h = JSON.parse(fs.readFileSync(path.join(DATA, 'history.json'))); snaps = h.snaps || []; h.threats.forEach(t => threats.set(t.id, t)); } catch (e) {}
  const tick = async () => { await pollAlerts(); await Promise.all(CHANNELS.map(pollTG)); save(); };
  tick(); setInterval(pollAlerts, 30e3); setInterval(() => Promise.all(CHANNELS.map(pollTG)), 60e3); setInterval(save, 60e3);
  srv.listen(port, host, () => { console.log('AlertMap: http://localhost:' + srv.address().port); ok(srv.address().port); });
});
if (require.main === module) exports.start();
