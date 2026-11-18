// SEO-сторінки /tryvoha-<область>: той самий index.html, але з власними title/description і початковим наведенням на регіон.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const BASE = (process.env.SITE_URL || 'https://alert-map-ect7.onrender.com').replace(/\/+$/, '');
const SLUGS = { 'Вінницька область': 'vinnytsia', 'Волинська область': 'volyn', 'Дніпропетровська область': 'dnipro', 'Донецька область': 'donetsk', 'Житомирська область': 'zhytomyr', 'Закарпатська область': 'zakarpattia', 'Запорізька область': 'zaporizhzhia', 'Івано-Франківська область': 'ivano-frankivsk', 'Київська область': 'kyiv-oblast', 'м. Київ': 'kyiv', 'Кіровоградська область': 'kirovohrad', 'Луганська область': 'luhansk', 'Львівська область': 'lviv', 'Миколаївська область': 'mykolaiv', 'Одеська область': 'odesa', 'Полтавська область': 'poltava', 'Рівненська область': 'rivne', 'Сумська область': 'sumy', 'Тернопільська область': 'ternopil', 'Харківська область': 'kharkiv', 'Херсонська область': 'kherson', 'Хмельницька область': 'khmelnytskyi', 'Черкаська область': 'cherkasy', 'Чернівецька область': 'chernivtsi', 'Чернігівська область': 'chernihiv', 'Автономна Республіка Крим': 'crimea' };
const BY_SLUG = Object.fromEntries(Object.entries(SLUGS).map(([n, s]) => [s, n]));
const sub = (h, re, v) => h.replace(re, () => v); // функція-замінник: «$» у тексті не спрацьовує як шаблон

exports.handle = (req, res, u, PUB, gz) => {
  if (req.method !== 'GET') return false;
  if (u.pathname === '/sitemap.xml') {
    const d = new Date().toISOString().slice(0, 10), urls = ['/', ...Object.values(SLUGS).map(s => '/tryvoha-' + s)];
    const x = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((p, i) => `  <url><loc>${BASE}${p}</loc><lastmod>${d}</lastmod><changefreq>always</changefreq><priority>${i ? '0.8' : '1.0'}</priority></url>`).join('\n') + '\n</urlset>\n';
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }); res.end(x); return true;
  }
  const m = /^\/tryvoha-([a-z-]+)\/?$/.exec(u.pathname), n = m && BY_SLUG[m[1]];
  if (!n) return false;
  fs.readFile(path.join(PUB, 'index.html'), 'utf8', (err, h) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const t = `Повітряна тривога: ${n} — карта онлайн | AlertMap`, url = `${BASE}/tryvoha-${m[1]}`,
      d = `Де зараз повітряна тривога: ${n}. Карта тривог у реальному часі з районами, шахедами, ракетами, балістикою та таймлапсом. Безкоштовно, без реєстрації.`;
    h = sub(h, /<title>[^<]*<\/title>/, `<title>${t}</title>`);
    h = sub(h, /<meta name="description" content="[^"]*"/, `<meta name="description" content="${d}"`);
    h = sub(h, /<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${url}"`);
    h = sub(h, /<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${url}"`);
    h = sub(h, /<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${t}"`);
    h = sub(h, /<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${t}"`);
    h = sub(h, /<h1 class="sr-only">[^<]*<\/h1>/, `<h1 class="sr-only">Повітряна тривога: ${n} — карта онлайн</h1>`);
    h = sub(h, /<meta charset="utf-8">/, `<meta charset="utf-8"><script>window.__R=${JSON.stringify(n)}</script>`);
    const raw = Buffer.from(h), z = gz && zlib.gzipSync(raw), hd = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
    res.writeHead(200, z ? { ...hd, 'Content-Encoding': 'gzip' } : hd); res.end(z || raw);
  });
  return true;
};
exports.SLUGS = SLUGS;
