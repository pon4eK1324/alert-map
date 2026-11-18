// Web Push: сповіщення про початок/кінець тривоги у вибраних користувачем областях і районах.
// Потрібні змінні середовища VAPID_PUBLIC і VAPID_PRIVATE (npx web-push generate-vapid-keys). Без них пуші вимкнені.
const fs = require('fs'), path = require('path');
let wp = null; try { wp = require('web-push'); } catch (e) {}
let subs = [], file = null, on = false, getAlerts = () => [];
const MAX = 5000;

const matches = (r, k) => { const [o, d] = r.split('|'); return d ? (k === r || k === o) : (k === r || k.startsWith(r + '|')); };
const active = (alerts, r) => alerts.some(a => (a.t || 'AIR') === 'AIR' && matches(r, a.k));
const name = r => r.replace('|', ', ');
const save = () => { if (!file) return; try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(subs)); } catch (e) {} };

exports.init = (dataDir, alertsFn) => {
  getAlerts = alertsFn || getAlerts; file = path.join(dataDir, 'push.json');
  try { subs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { subs = []; }
  let pub = process.env.VAPID_PUBLIC, priv = process.env.VAPID_PRIVATE;
  if (!wp) return console.log('Push вимкнено: немає пакета web-push (npm install)');
  if (!pub || !priv) return console.log('Push вимкнено: задайте VAPID_PUBLIC і VAPID_PRIVATE');
  wp.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv); on = true; exports.key = pub;
};

exports.handle = (req, res, u, json, readBody) => {
  if (u.pathname === '/api/push/key') { json({ key: on ? exports.key : null }); return true; }
  if (u.pathname !== '/api/push/sub' && u.pathname !== '/api/push/unsub') return false;
  if (req.method !== 'POST' || !on) { res.writeHead(on ? 405 : 503); res.end(); return true; }
  readBody(req, b => {
    const ep = b && (b.sub ? b.sub.endpoint : b.endpoint);
    if (typeof ep !== 'string' || !/^https:\/\//.test(ep) || ep.length > 600) return json({ ok: false });
    subs = subs.filter(s => s.sub.endpoint !== ep);
    if (u.pathname === '/api/push/sub') {
      const k = b.sub.keys || {}, regions = (Array.isArray(b.regions) ? b.regions : []).filter(r => typeof r === 'string' && r.length < 120).slice(0, 10);
      if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || !regions.length || subs.length >= MAX) return json({ ok: false });
      const al = getAlerts(), st = {}; regions.forEach(r => { st[r] = active(al, r); }); // поточний стан без «запізнілих» пушів
      subs.push({ sub: { endpoint: ep, keys: { p256dh: k.p256dh, auth: k.auth } }, regions, st });
    }
    save(); json({ ok: true });
  });
  return true;
};

exports.onAlerts = alerts => {
  if (!on) return; let dirty = false;
  for (const s of subs.slice()) for (const r of s.regions) {
    const now = active(alerts, r), prev = s.st[r]; s.st[r] = now;
    if (prev === undefined || prev === now) continue; dirty = true;
    const payload = JSON.stringify({ title: now ? '🔴 Повітряна тривога' : '🟢 Відбій тривоги', body: name(r), tag: 'am-' + r, url: '/?r=' + encodeURIComponent(r) });
    wp.sendNotification(s.sub, payload, { TTL: 300, urgency: 'high' }).catch(e => {
      if (e.statusCode === 404 || e.statusCode === 410) { subs = subs.filter(x => x !== s); save(); }
    });
  }
  if (dirty) save();
};
exports._t = { matches, active };
