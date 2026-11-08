// AlertMap server: збирає тривоги + повітряні цілі, пише історію для таймлапсу, віддає сайт.
const http = require('http'), fs = require('fs'), path = require('path');
const { PLACES } = require('./places');
// Публічні Telegram-канали (t.me/s/...). Можна змінити у config.json: { "channels": ["kpszsu", "..."] } або змінною TG_CHANNELS.
// При старті недійсні канали (немає публічного перегляду) автоматично вилучаються з опитування.
const DEFAULT_CHANNELS = [
  // лише канали з робочим публічним переглядом t.me/s/... (перевірено за логом; недійсні сервер і далі відсіює сам)
  'kpszsu', 'kudy_letyt', 'UkraineRadar_24_7', 'povitryanatrivogaaa', 'eRadarrua', 'rlsukr', 'raketa_trevoga', 'monikppy',
  'deraketaua', 'truexakyiv', 'truexanewsua', 'truexazhitomir', 'truexadnepr', 'truexakharkiv', 'truexapoltava', 'truexazaporozie',
  'truexakhersonua', 'odesatruexa', 'lvivtruexa', 'chernigivtruexa', 'kievinfo_kyiv', 'monitoring_kiev', 'operativniy_monitor', 'VA_Kyiv',
  'synegubov', 'odessa_infonews', 'kyivoperativ', 'operativnoZSU', 'vanek_nikolaev', 'monitor_ukr', 'mon1tor_ua', 'radar_ukr',
  'raketa_shahed', 'air_alert_ua', 'war_monitor', 'lachentyt', 'uastartap', 'real_kyiv', 'sumy_monitor', 'kievrealnoy',
  'kyiv_operativ', 'radar_kyiv', 'kievobl', 'odesa_radar', 'mykolaiv_radar', 'kherson_radar', 'dnipro_operativ', 'poltava_monitor',
  'kharkiv_radar', 'live_kharkov', 'dnipro_radar', 'zaporozhye_radar', 'poltava_radar', 'kyiv_m0nitoring', 'vinnytsia_radar', 'khmelnitsky_radar',
  'lviv_radar', 'cherkasy_radar'];
const cleanCh = c => String(c).trim().replace(/^.*t\.me\/(s\/)?/, '').replace(/^@/, '').replace(/[/?#].*$/, '');
DEFAULT_CHANNELS.splice(0, DEFAULT_CHANNELS.length, ...DEFAULT_CHANNELS.filter((c, i, a) => a.findIndex(x => x.toLowerCase() === c.toLowerCase()) === i));
let CHANNELS = (process.env.TG_CHANNELS ? process.env.TG_CHANNELS.split(',') : DEFAULT_CHANNELS).map(cleanCh).filter(Boolean);
const KEEP = 48 * 3600e3;
const TTL = 10 * 60e3; // ціль зникає з мапи, якщо про неї 10 хвилин нічого не пишуть
const FADE_TIME = 60e3; // остання хвилина до кінця TTL: ціль плавно стає прозорою
let DATA = path.join(__dirname, 'data'), TOKEN = process.env.ALERTS_TOKEN || '';
let alerts = [], ballWarn = [], source = 'очікування', snaps = [], threats = new Map(), geoErr = '';
const chStat = {}; // стан кожного каналу: { ok, n, at, err, tried, fails, until, busy }
let POLL_EVERY = 30e3; // кожен канал опитується раз на стільки; канали йдуть по черзі, а не всі разом
const FRESH = 2 * 60e3;  // канал вважається «живим», якщо востаннє відповів не раніше ніж стільки тому
const STALE_MAX = 30 * 60e3; // скільки максимум показувати «останні відомі» цілі, коли всі канали недоступні
let lastGood = 0; // коли востаннє хоч один канал відповів успішно
const DEAD_AFTER = 3, DEAD_RETRY = 6 * 3600e3; // після 3 поспіль «немає перегляду» канал вважаємо недоступним і пробуємо раз на 6 год
const sleep = ms => new Promise(r => setTimeout(r, ms));
function health() {
  const now = Date.now(), v = Object.values(chStat);
  const fresh = v.filter(x => x.ok && now - x.at < FRESH).length, tried = v.filter(x => x.tried).length;
  return { fresh, total: CHANNELS.length, stale: CHANNELS.length > 0 && tried >= CHANNELS.length && fresh === 0 };
}
const refTime = hl => hl.stale ? Math.max(lastGood, Date.now() - STALE_MAX) : Date.now();

let F = (u, o) => fetch(u, o);
const get = async (u, h) => F(u, { headers: h, signal: AbortSignal.timeout(12000) });
function logErr(m) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const f = path.join(DATA, 'log.txt');
    try { if (fs.statSync(f).size > 200 * 1024) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').slice(-100 * 1024).replace(/^[^\n]*\n/, '')); } catch (e) {}
    fs.appendFileSync(f, new Date().toISOString() + ' ' + m + '\n');
  } catch (e) {}
}

const RAION_P = [];
const LB = '(?<![а-яіїєґ\'’])';
const REGIONS = [['вінницьк', 'Вінниччин'], ['волинськ', "Волинщин|Волин(?:ь|і|ю)(?![а-яіїєґ])"], ['дніпропетровськ', 'Дніпропетровщин|Дніпровщин'], ['донецьк', 'Донеччин'],
  ['житомирськ', 'Житомирщин'], ['закарпатськ', 'Закарпатт[а-яіїєґ]*'], ['запорізьк', 'Запоріжчин'], ['івано-франківськ', 'Прикарпатт[а-яіїєґ]*|Івано-Франківщин|Франківщин'],
  ['київськ', 'Київщин'], ['кіровоградськ', 'Кіровоградщин'], ['луганськ', 'Луганщин'], ['львівськ', 'Львівщин'], ['миколаївськ', 'Миколаївщин'], ['одеськ', 'Одещин'],
  ['полтавськ', 'Полтавщин'], ['рівненськ', 'Рівненщин'], ['сумськ', 'Сумщин'], ['тернопільськ', 'Тернопільщин'], ['харківськ', 'Харківщин'], ['херсонськ', 'Херсонщин'],
  ['хмельницьк', 'Хмельниччин'], ['черкаськ', 'Черкащин'], ['чернівецьк', 'Буковин[а-яіїєґ]*|Чернівеччин'], ['чернігівськ', 'Чернігівщин']]
  .map(([stem, words]) => [stem, new RegExp(LB + '(?:' + words + '|' + stem + '[а-яіїєґ]*\\s+(?:област|обл(?![а-яіїєґ])))', 'i')]);
const OBL_GEO = new Map();
function addGeo(o, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  let g = OBL_GEO.get(norm(o)); if (!g) OBL_GEO.set(norm(o), g = { a: 0, x: 0, y: 0, la0: 90, la1: -90, lo0: 180, lo1: -180 });
  for (const poly of polys) {
    const ring = poly[0]; let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1], c = x0 * y1 - x1 * y0;
      a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
      g.la0 = Math.min(g.la0, y0); g.la1 = Math.max(g.la1, y0); g.lo0 = Math.min(g.lo0, x0); g.lo1 = Math.max(g.lo1, x0);
    }
    a /= 2; if (!a) continue; const w = Math.abs(a); g.a += w; g.x += cx / (6 * a) * w; g.y += cy / (6 * a) * w;
  }
}
const regionGeo = stem => { for (const [k, g] of OBL_GEO) if (k.startsWith(stem) && g.a) return { la: g.y / g.a, lo: g.x / g.a, h: g.la1 - g.la0, w: g.lo1 - g.lo0 }; };
function dirShift(line, m, g) {
  const rest = line.slice(m.index + m[0].length), D = "(півн|півд|схід|захід)[а-яіїєґ'’-]*";
  const before = new RegExp(D + '\\s*(?:частин[а-яіїєґ]*\\s*)?$', 'i').exec(line.slice(Math.max(0, m.index - 24), m.index)),
    after = new RegExp("^[а-яіїєґ'’]*\\s*(?:через|по|на|в|у)?\\s*" + D + '\\s*(?:частин[а-яіїєґ]*\\s*)?област', 'i').exec(rest.slice(0, 48)), t = (before || after || [''])[0];
  return [((/півн/i.test(t) ? 1 : 0) - (/півд/i.test(t) ? 1 : 0)) * g.h * .32, ((/схід/i.test(t) ? 1 : 0) - (/захід/i.test(t) ? 1 : 0)) * g.w * .32];
}
const GAZ = new Map();
const STEM_END = /(ою|ею|єю|ої|ій|ами|ями|ах|ях|ам|ям|ів|ом|ем|єм|[аяеєоиіуюї])$/;
const stemOf = w => { const x = String(w).toLowerCase().replace(/[’ʼ`‘]/g, "'"); return x.length > 4 ? x.replace(STEM_END, '') : x; };
function loadGaz() {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'settlements.json')));
  GAZ.clear();
  for (const [kindKey, rows] of [['m', d.m], ['x', d.x], ['c', d.c]]) for (const r of rows || []) {
    const k = stemOf(r[0]); if (k.length < 4) continue;
    let a = GAZ.get(k); if (!a) GAZ.set(k, a = []);
    a.push({ n: r[0], la: r[1], lo: r[2], pop: r[3] || 0, kk: kindKey });
  }
}

const GAZ_STOP = new Set([
  'група', 'групи', 'групою', 'увага', 'уважно', 'швидко', 'гучно', 'відбій', 'тривога', 'тривоги', 'загроза', 'загрози', 
  'небезпека', 'балістика', 'балістики', 'ракета', 'ракети', 'ракет', 'шахед', 'шахеди', 'шахедів', 'бпла', 'укриття', 
  'новини', 'україна', 'росія', 'росії', 'курсом', 'напрямку', 'реактивний', 'реактивні', 'молнія', 'молнії', 'ціль', 
  'цілі', 'збито', 'збиття', 'вибух', 'вибухи', 'пуск', 'пуски', 'сидимо', 'оновлення', 'обережно', 'повітряна', 'повітряні', 
  'ударні', 'ударний', 'можливо', 'можлива', 'ймовірно', 'скоріше', 'далі', 'область', 'області', 'районі', 'район', 
  'повз', 'біля', 'через', 'попередня', 'інформація', 'підтвердження', 'локаційно', 'втрачено', 'чисто', 'фіксація', 
  'спостереження', 'перебувайте', 'безпеці', 'безпека', 'тримайтесь', 'працює', 'працюють', 'наші', 'сили', 'оборони', 
  'ппо', 'авіація', 'винищувач', 'тривожність', 'напрямок', 'вектор', 'маневр', 'розвороту', 'повторно', 'додатково', 
  'спокійно', 'контролем', 'повітряних', 'збройних', 'сил', 'монітор', 'канал', 'адмін', 'підписка', 'поширення', 
  'репост', 'терміново', 'важливо', 'зафіксовано', 'виліт', 'посадка', 'аеродром', 'базування', 'активність', 'стратегічна',
  'тактична', 'гучний', 'хлопок', 'детонація', 'приліт', 'влучання'
].map(stemOf));

const CUE = /(?:[:：—–]|(?<![а-яіїєґ])(?:бпла|шахед\S*|дрон\S*|ракет\S*|ціл[іьи]\S*)|(?<![а-яіїєґ'’])(?:на|до|повз|біля|через|над|від|курс\S*|напрямк\S*|район\S*|р-н\S*|в|у|з|із)|→|➡)\s*(?:\S{1,12}\s+)?$/i;
function gazPlaces(line, covered, anchors, hint) {
  const out = [], W = /(?<![А-ЯІЇЄҐа-яіїєґ'’ʼ-])[А-ЯІЇЄҐ][а-яіїєґ'’ʼ]{2,}(?:[-\s][А-ЯІЇЄҐ][а-яіїєґ'’ʼ]{2,}){0,2}(?![а-яіїєґ'’ʼ])/g;
  let m, prevOk = false, anchor = anchors[anchors.length - 1];
  while ((m = W.exec(line))) {
    const idx = m.index;
    if (covered.some(([a, b]) => idx >= a - 1 && idx < b)) { prevOk = true; continue; }
    const ends = []; m[0].replace(/[^-\s]+/g, (w, o) => { ends.push(o + w.length); return w; });
    let hit = null, used = 0;
    for (let n = ends.length; n >= 1 && !hit; n--) {
      const cand = m[0].slice(0, ends[n - 1]), key = stemOf(cand);
      if (n === 1 && GAZ_STOP.has(key)) continue;
      const list = GAZ.get(key); if (list) { hit = list; used = cand.length; }
    }
    W.lastIndex = idx + (used || m[0].length);
    if (!hit) { prevOk = false; continue; }
    const before = line.slice(Math.max(0, idx - 30), idx);
    const listed = prevOk && /[,/]\s*$|\sі\s$/.test(before);
    if (!CUE.test(before) && !listed) { prevOk = false; continue; }
    let pick = null;
    if (hit.length === 1) pick = hit[0];
    else {
      const cs = hit.slice().sort((a, b) => b.pop - a.pop);
      if (anchor) { const near = cs.map(c => [c, dist([c.la, c.lo], anchor)]).sort((a, b) => a[1] - b[1])[0]; if (near[1] < 1.6) pick = near[0]; }
      if (!pick && hint) { const near = cs.map(c => [c, dist([c.la, c.lo], hint)]).sort((a, b) => a[1] - b[1])[0]; if (near[1] < 3) pick = near[0]; }
      if (!pick && cs[0].pop >= 1.8 * (cs[1].pop || 0.01) && cs[0].pop >= 1) pick = cs[0];
    }
    if (pick) { out.push([idx, pick.la, pick.lo, false]); anchor = [pick.la, pick.lo]; prevOk = true; covered.push([idx, idx + used + 1]); } else prevOk = false;
  }
  return out;
}
function placesRaw(line, hint) {
  line = String(line).replace(/[ʼ`‘]/g, '’');
  const f = [], covered = [], regs = [];
  for (const [stem, re] of REGIONS) {
    const m = re.exec(line), g = m && regionGeo(stem); if (!g) continue;
    const [dl, dn] = dirShift(line, m, g);
    f.push([m.index, g.la + dl, g.lo + dn, true]); regs.push([m.index, m.index + m[0].length]); covered.push([m.index, m.index + m[0].length + 2]);
  }
  for (const p of PLACES) {
    const m = p.re.exec(line);
    if (m && !regs.some(([a, b]) => m.index >= a && m.index < b)) { f.push([m.index, p.la, p.lo, false]); covered.push([m.index, m.index + m[0].length + 2]); }
  }
  for (const [re, la, lo] of RAION_P) {
    const m = re.exec(line);
    if (m && !covered.some(([a, b]) => m.index >= a - 1 && m.index <= b)) { f.push([m.index, la, lo, false]); covered.push([m.index, m.index + m[0].length + 2]); }
  }
  if (GAZ.size) { const an = f.filter(x => !x[3]).sort((a, b) => a[0] - b[0]).map(x => [x[1], x[2]]); f.push(...gazPlaces(line, covered, an, hint)); }
  const out = [];
  for (const [ix, la, lo, reg] of f.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - la, last[1] - lo) > 0.12) out.push([+la.toFixed(4), +lo.toFixed(4), reg, ix]);
  }
  return out;
}
const places = line => placesRaw(line).map(p => [p[0], p[1]]);

const BOOM_NEGATION = /(?:немає|без|не\s+чу\S*|тихо|відсутн\S*|наразі\s+спокійно)\s+(?:\S+\s+){0,3}?(?:вибух|влучан|прильот|хлопк)|(?:вибух|влучан|прильот|хлопк)\S*\s+(?:немає|не\s+було|не\s+зафіксовано|відсутн|не\s+чути)/i;

function kind(l) {
  if (/вибух|прильот|влучанн|влучив|влучили|детонаці|(?:чути|чутно|гучн\S*)\s+хлопк/i.test(l) && !BOOM_NEGATION.test(l)) return 'boom';
  if (/балістик|балістичн|аеробаліст|іскандер|кн-?2[345]|х-?47|кинджал|кінжал|фатех|фатх|точка-?у|оперативно-тактичн|(?:ракет\S*|пуск\S*|удар\S*)\s+(?:зрк\s+)?с-?[34]00|с-?[34]00\s+(?:на|по|курсом)/i.test(l)) return 'ballistic';
  if (/крилат|ракет|калібр|х-?101|х-?555|х-?22|х-?59|х-?69|циркон|онікс|буревісник|орєшнік|орешнік/i.test(l)) return 'missile';
  if (/реактивн\S*\s+(?:\S+\s+){0,2}?(?:шахед|бпла|дрон|безпілот|герань|геран|ударн)|геран[ьі]?[-\s]?3|(?<![a-z])jet[-\s]?(?:shahed|geran|drone)|шахед\S*[-\s]?3\d\d/i.test(l) && !/артилері|рсзв|град\b|смерч|ураган/i.test(l)) return 'jet';
  if (/шахед|шахеді|бпла|бпл(?![а-яіїєґ])|дрон|безпілот|герань|геран|гербер|мопед|молни[яі]|камікадзе|імітатор|shahed|geran|\buav\b|\bdrones?\b/i.test(l)) return 'shahed';
}

const NIGHT = /(?:у|за|протягом)\s+ніч\S*|протягом ночі|вранці|зафіксовано влучання|місцях падіння|локаці[яй] влучан|(?<![а-яіїєґ])[ув]ночі|минул\S*\s+ноч|цієї\s+ночі|сьогодні\s+вночі|вчора|за\s+добу|упродовж\s+(?:ночі|доби)|завдал[аио]\s+(?:\S+\s+){0,2}?удар|завдав\s+(?:\S+\s+){0,2}?удар|завдан\S*\s+удар|(?:було|були)\s+(?:випущен|запущен|збит|знищен|завдан|пошкоджен)|випустил[аи]|запустил[аи]\s+по|наслідки|заявив|заявила|за\s+словами|[—–-]\s*зеленськ|зеленськ\S*\s+(?:заявив|повідомив)|дснс|(?:поранених|постраждалих|загиблих)\s+не\s+зафіксован\S*|спалахн\S*\s+(?:\S+\s+){0,2}?(?:автомобіл|авто|будинок|будівл|склад)|момент\S*\s+(?:\S+\s+){0,3}?(?:падінн|влучанн|детонаці|вибух|прильот|удар|знищенн|збиття|польот)|(?:відео|кадри|фото|запис)\S*\s+(?:\S+\s+){0,3}?(?:падінн|влучанн|детонаці|вибух|прильот|удар|знищенн|збиття|польот)|вирв(?:а|и|у|і|ою)(?![а-яіїєґ])|після\s+(?:прильот|влучанн)|звіт\s+за|підсумки\s+(?:доби|ночі)|ранкове\s+зведення|зведення\s+генштабу|подробиці\s+атаки|ліквідація\s+наслідків|пожежно-рятувальн|руйнування\s+взанаслідок|пошкоджено\s+приватні|уламки\s+(?:впали|ушкодили|пошкодили)|знайдено\s+боєголовку|роботи\s+з\s+знешкодження|результати\s+роботи\s+ппо|підтверджено\s+знищення|ураження\s+цілі|знищено\s+ворожу\s+техніку/i;

const NOISE = /дякуємо|дякую\s|донат|підтримайте|реклам|проєкт|проект\s|monobank|переходьте|читач|довіряйте|прожили|найважч|app\s?store|google\s?play|збір\b|соборка|підписуйтесь|канал\s+друзів|партнерський\s+пост|промокод|знижка|крипта|заробіток|казино|ставки|посилання\s+в\s+шапці|читайте\s+також|джерело:|інсайд|ексклюзив|надіслати\s+новину|наш\s+бот|опитування|ставте\s+лайк|реакції|підпишись|найновіші\s+новини|офіційний\s+мерч|роззіграш|вигравай|безкоштовно|рекомендація|вже\s+на\s+каналі|подробиці\s+посилання/i;

const FALSE_ALARM = /не\s+підтвердил|хибна\s+ціль|акустична\s+помилка|загроза\s+минула|чисте\s+небо|цілей\s+не\s+виявлено|помилковий\s+пуск|чисто\s+в\s+області/i;

const BALL_CUE = /загроз|небезпек|пуск|запуск|курс|летить|летять|прямує|рухаєт|напрямк|уваг|група|швидкісн|у\s+повітрі|виліт|зліт/i;
const DEST = /^[^а-яіїєґa-z0-9]*(?:→|➡|далі)|курс|напрямк|прямує|рухаєт/i;
const NOUN = "шахед|геран|бпла|дрон|безпілот|ракет|герань|калібр|іскандер|кинджал|мопед|молні|ціл|об['’ʼ]єкт";
const NUMW = { пар: 2, дв: 2, дві: 2, три: 3, трьох: 3, чотир: 4, "п['’ʼ]ят": 5, "п['’ʼ]яти": 5, шіст: 6, шест: 6, сім: 7, сем: 7, вісім: 8, восьм: 8, "дев['’ʼ]ят": 9, десят: 10 };
const NUMRE = new RegExp('(?<![а-яіїєґ])(' + Object.keys(NUMW).join('|') + ")[а-яіїєґ]*\\s+(?:[а-яіїєґ'’ʼ-]+\\s+){0,2}?(?:" + NOUN + ')', 'i');
function countOf(l) {
  let m = /(?<![\d.,:])(\d{1,2})\s*[xх×](?![а-яіїєґa-z0-9])/i.exec(l) || /(?<![а-яіїєґa-z0-9])[xх×]\s*(\d{1,2})(?!\d)/i.exec(l)
    || new RegExp("(?<![\\d.,:])(\\d{1,2})\\s+(?:[а-яіїєґ'’ʼ-]+\\s+){0,2}?(?:" + NOUN + ')', 'i').exec(l);
  let n = m && +m[1];
  if (!n) { m = NUMRE.exec(l); if (m) { const k = Object.keys(NUMW).find(k => new RegExp('^(?:' + k + ')$', 'i').test(m[1])); n = NUMW[k] || NUMW[m[1].toLowerCase()]; } }
  return n >= 2 && n <= 99 ? n : undefined;
}

const CLOSING = /збит[аіоу]?|збив\w*|знищен[аіоу]?|мінус\b|ліквідован[аіоу]?|посаджен[аіоу]?|приземлен[аіоу]?|усунут[аіоу]?|зник|відбій|відбито|покинув|покинули|вийшов за межі|вийшли за межі|ціль втрачен|локаційно\s+втрачено|впав|розбився|припинив\s+існування|немає\s+цілей|чисто/i;
const dist = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(a[0] * Math.PI / 180));

const norm = s => String(s || '').replace(/[’ʼ`‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const CANON = new Map(), NAMES = new Map(); let TREE = {}, treeAt = 0;
function loadGeo() {
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'raions.json')));
  for (const f of g.features) {
    const { o, n } = f.properties, k = o + '|' + n;
    try {
      const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
      const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
      const stem = n.replace(/\s*район.*/i, '').replace(/(ськ|цьк|зьк)?(ий|ій)$/i, '$1');
      if (stem.length >= 4) RAION_P.push([new RegExp(LB + stem, 'i'), (Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...xs) + Math.max(...xs)) / 2]);
    } catch (e) {}
    try { addGeo(o, f.geometry); } catch (e) {}
    CANON.set(norm(k), k); CANON.set(norm(o), o);
    if (!NAMES.has(norm(n))) NAMES.set(norm(n), []);
    NAMES.get(norm(n)).push(k);
  }
  CANON.set(norm('м. Київ'), 'м. Київ');
}
async function loadTree() {
  const j = await (await get('https://siren.pp.ua/api/v3/regions')).json(), t = {};
  const walk = (n, st, di) => {
    if (n.regionType === 'State') { st = n.regionName; di = null; }
    if (n.regionType === 'District') di = n.regionName;
    t[String(n.regionId)] = { name: n.regionName, type: n.regionType, st, di };
    (n.regionChildIds || []).forEach(c => walk(c, st, di));
  };
  (j.states || []).forEach(s => walk(s, null, null)); TREE = t; treeAt = Date.now();
}
const RANK = { yellow: 1, red: 2 };
function add(m, k, l, t, p) {
  k = CANON.get(norm(k)); if (!k) return false;
  const id = k + '#' + t + (p ? '~' : ''), o = m.get(id);
  if (!o) m.set(id, { k, l, t, p }); else if (RANK[l] > RANK[o.l]) o.l = l;
  return true;
}
const atype = x => x === 'AIR' || x === 'air_raid' ? 'AIR' : ['ARTILLERY', 'URBAN_FIGHTS', 'artillery_shelling', 'urban_fights'].includes(x) ? 'ART' : null;
async function tokenAlerts() {
  const j = await (await get('https://api.alerts.in.ua/v1/alerts/active.json', { Authorization: 'Bearer ' + TOKEN })).json(), m = new Map();
  for (const a of j.alerts) {
    const t = atype(a.alert_type); if (!t) continue;
    const l = String(a.alert_level || a.level || 'red').toLowerCase() === 'yellow' ? 'yellow' : 'red';
    const k = a.location_oblast === 'м. Київ' ? 'м. Київ' : a.location_type === 'oblast' ? a.location_oblast
      : a.location_type === 'raion' ? a.location_oblast + '|' + a.location_title : null;
    if (k) add(m, k, l, t, false);
  }
  return { list: [...m.values()], note: 'alerts.in.ua' };
}
async function sirenAlerts() {
  if (!Object.keys(TREE).length || Date.now() - treeAt > 6 * 3600e3) { try { await loadTree(); } catch (e) {} }
  const j = await (await get('https://siren.pp.ua/api/v3/alerts')).json(), m = new Map(); let miss = 0;
  for (const r of j) for (const a of r.activeAlerts || []) {
    const t = atype(a.type); if (!t) continue;
    const lv = new Set((a.activeAlertLevels || []).map(x => String(x.alertLevel || '').toLowerCase()));
    const l = lv.has('red') ? 'red' : lv.has('yellow') ? 'yellow' : 'red';
    const i = TREE[String(r.regionId)] || {}, type = r.regionType || i.type; let k = null, p = false;
    if (type === 'State') k = r.regionName;
    else if (type === 'District') { const c = NAMES.get(norm(r.regionName)) || []; k = i.st ? i.st + '|' + r.regionName : c.length === 1 ? c[0] : null; }
    else if (i.st && i.di) { k = i.st + '|' + i.di; p = true; }
    if (!k || !add(m, k, l, t, p)) miss++;
  }
  return { list: [...m.values()], note: 'siren.pp.ua' + (miss ? ` (поза мапою: ${miss})` : '') };
}
async function ubillingAlerts() {
  const j = await (await get('https://ubilling.net.ua/aerialalerts/')).json(), m = new Map();
  for (const [k, v] of Object.entries(j.states)) if (v.alertnow) add(m, k, 'red', 'AIR', false);
  return { list: [...m.values()], note: 'ubilling.net.ua (лише області)' };
}
async function pollAlerts() {
  const errs = [];
  for (const f of [...(TOKEN ? [tokenAlerts] : []), sirenAlerts, ubillingAlerts]) {
    try {
      const r = await f(); source = r.note;
      r.list.sort((a, b) => (a.k + a.t).localeCompare(b.k + b.t));
      if (!snaps.length || JSON.stringify(r.list) !== JSON.stringify(alerts)) snaps.push({ t: Date.now(), a: r.list });
      alerts = r.list; return;
    } catch (e) { errs.push(f.name + ': ' + e.message); }
  }
  source = 'помилка джерел: ' + errs.join('; ') + (geoErr ? ' [' + geoErr + ']' : '') + (TOKEN ? '' : ' (можна додати токен у config.json)');
  logErr(source);
}

const KYV = [50.45, 30.52], ODS = [46.48, 30.72], KHR = [49.99, 36.23];
const CH_HINT = { truexakyiv: KYV, kievinfo_kyiv: KYV, monitoring_kiev: KYV, operativniy_monitor: KYV, VA_Kyiv: KYV, kyivoperativ: KYV, realkiev: KYV, truexazhitomir: [50.25, 28.66], truexadnepr: [48.46, 35.05],
  truexakharkiv: KHR, synegubov: KHR, truexapoltava: [49.59, 34.55], truexazaporozie: [47.84, 35.14], truexakhersonua: [46.64, 32.62], odesatruexa: ODS, odessa_infonews: ODS, lvivtruexa: [49.84, 24.03], chernigivtruexa: [51.5, 31.3],
  kievrealnoy: KYV, kyiv_operativ: KYV, radar_kyiv: KYV, kievobl: KYV, kharkiv_radar: KHR, live_kharkov: KHR, dnipro_radar: [48.46, 35.05], zaporozhye_radar: [47.84, 35.14],
  odesa_radar: ODS, mykolaiv_radar: [46.97, 32.0], kherson_radar: [46.64, 32.62], vinnytsia_radar: [49.23, 28.47], khmelnitsky_radar: [49.42, 26.99], lviv_radar: [49.84, 24.03], poltava_radar: [49.59, 34.55], cherkasy_radar: [49.44, 32.06] };
const lastK = {};
const BULLET = /^[\s▪️•🔹🔸🔻🔺➡️→▶️\-–—*·]+/u;
const seen = new Set();
const SPEED = { shahed: 0.03, jet: 0.06, missile: 0.12, ballistic: 0.4 }, REACH0 = 0.35;

const orphans = new Map();
function noCourse(ref = Date.now()) { let n = 0; for (const [k, v] of orphans) { if (ref - v.t > TTL) orphans.delete(k); else n += v.n; } return n; }
function addThreat(o) {
  const src = { ch: o.ch, id: o.post, key: o.id, t: o.t, text: o.text };
  const join = x => { x.src = x.src || []; if (!x.src.some(a => a.key === src.key)) x.src.push(src); };
  for (const x of threats.values()) {
    if (x.type !== o.type || x.dead || Math.abs(x.t - o.t) > TTL) continue;
    // радіус злиття росте з часом між постами: ціль за кілька хвилин встигає відлетіти далі
    const dtm = Math.abs(x.t - o.t) / 60e3;
    const rad = o.type === 'boom' ? 0.25 : Math.min(0.8, 0.15 + (SPEED[o.type] || SPEED.shahed) * dtm * 0.5);
    if (dist(x.pts[x.pts.length - 1], o.pts[o.pts.length - 1]) < rad) {
      join(x);
      if (o.t >= x.t) { x.t = o.t; if (!o.dest) { x.pts = o.pts; x.reg = o.reg; x.t0 = o.t; } x.text = o.text; x.ch = o.ch; if (o.n) x.n = o.n; }
      else if (o.n && !x.n) x.n = o.n;
      return;
    }
  }
  if (o.dest) {
    let best = null, bd = 4;
    for (const x of threats.values()) {
      if (x.type !== o.type || x.dead || Math.abs(x.t - o.t) > TTL) continue;
      const d = dist(x.pts[0], o.pts[0]), reach = REACH0 + (SPEED[o.type] || SPEED.shahed) * Math.abs(o.t - x.t) / 60e3;
      if (d < bd && d <= reach) { bd = d; best = x; }
    }
    if (best) {
      join(best);
      if (o.t >= best.t) { best.t = o.t; best.text = o.text; best.ch = o.ch; if (o.n) best.n = o.n; if (bd > 0.25) best.pts = [best.pts[0], o.pts[0]]; }
      else if (o.n && !best.n) best.n = o.n;
      return;
    }
    if (o.type !== 'boom') orphans.set(o.type + '@' + o.pts[0].map(v => v.toFixed(1)).join(','), { t: o.t, n: o.n || 1 }); // «курс на X» без відомого місця: не малюємо, лише рахуємо
    return;
  }
  o.src = [src]; o.t0 = o.t; threats.set(o.id, o);
}
function closeNear(o) {
  let best = null, bd = 0.6;
  for (const x of threats.values()) {
    if (x.type !== o.type || x.dead || x.t > o.t || o.t - x.t > TTL) continue;
    const d = Math.min(dist(x.pts[x.pts.length - 1], o.pts[0]), dist(x.pts[0], o.pts[0]));
    if (d < bd) { bd = d; best = x; }
  }
  if (best) best.dead = o.t;
}

const TG_HOSTS = ['t.me', 'telegram.me', 'tx.me']; let tgHost = 0;
async function tgGet(ch) {
  let last;
  for (let i = 0; i < TG_HOSTS.length; i++) {
    const hi = (tgHost + i) % TG_HOSTS.length;
    try {
      const r = await get('https://' + TG_HOSTS[hi] + '/s/' + ch);
      if (r.ok) { tgHost = hi; return r; }
      last = new Error('HTTP ' + r.status); last.retry = (+r.headers.get('retry-after') || 0) * 1000;
      if (r.status === 404) last.nopreview = true;
      if (r.status === 429 || r.status === 404) throw last;
    } catch (e) { if (e === last) throw e; last = e; }
  }
  throw last;
}
const decodeHtml = x => x.replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => cp(+d)).replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const cp = n => { try { return String.fromCodePoint(n); } catch (e) { return ''; } };
async function pollTG(ch) {
  const st = chStat[ch] = chStat[ch] || { ok: false, n: 0 };
  st.busy = true;
  try {
    const r = await tgGet(ch);
    const h = await r.text();
    const parts = h.split('tgme_widget_message_wrap').slice(1);
    if (!parts.length) throw Object.assign(new Error('немає публічного перегляду (t.me/s/' + ch + ')'), { nopreview: true });
    let n = 0;
    for (const p of parts) {
      const id = (p.match(/data-post="([^"]+)"/) || [])[1], ts = (p.match(/<time[^>]*datetime="([^"]+)"/) || [])[1];
      const m = p.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
      if (!id || !ts || !m) continue;
      const text = decodeHtml(m[1].replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''));
      let carry = null;
      const tms = Date.parse(ts);
      text.split('\n').forEach((line, i) => {
        let k = kind(line);
        if (k) carry = k; else if (BULLET.test(line) && carry && line.trim().length < 220) k = carry; else if (line.trim() && !BULLET.test(line)) carry = null;
        const key = id + '#' + i;

        if (NIGHT.test(line) || NOISE.test(line) || FALSE_ALARM.test(line)) return;

        if (k === 'ballistic' && !seen.has(key + 'b') && BALL_CUE.test(line) && line.trim().length > 6 && line.trim().length < 260) {
          seen.add(key + 'b');
          if (CLOSING.test(line)) { for (const w of ballWarn) if (w.t <= tms && !w.dead) w.dead = tms; }
          else if (!ballWarn.some(w => w.key === key)) ballWarn.push({ key, post: id, ch, t: tms, text: line.trim().slice(0, 220) });
        }

        if (k && CLOSING.test(line) && /відбій|відбою/i.test(line) && !placesRaw(line).length) {
          if (!seen.has(key + 'c')) { seen.add(key + 'c'); for (const x of threats.values()) if (x.type === k && !x.dead && x.t <= tms && tms - x.t <= TTL && (x.src || []).some(a => a.ch === ch)) x.dead = tms; }
          return;
        }
        const raw = placesRaw(line, CH_HINT[ch]);
        if (raw.length >= 2) {
          const bef = p => line.slice(Math.max(0, p[3] - 22), p[3]);
          const isTo = p => /(?:^|[\s(])(?:на|до|→|➡️?|напрямку|напрямок|курс\S*\s+на)\s*$/i.test(bef(raw[0])) && p === raw[0];
          const isFrom = p => /(?:^|[\s(])(?:з|із|зі|від|з\s+боку|із\s+боку|з\s+напрямку)\s*$/i.test(bef(p));
          if (isTo(raw[0]) && isFrom(raw[raw.length - 1])) raw.reverse();
        }
        for (let i = raw.length - 1; i > 0 && raw.length > 1; i--) if (raw[i][2] && line[raw[i][3] - 1] === '(' && raw.some((q, j) => j !== i && !q[2])) raw.splice(i, 1);
        const pts = raw.map(p => [p[0], p[1]]);
        if (!pts.length || seen.has(key)) return;
        const L = lastK[ch] || lastK['*'];
        if (!k && L && tms >= L.t && tms - L.t <= TTL && /курс|далі|напрямк|→|➡|прямує|рухаєт|рухаютьс/i.test(line) && !/тривог|відбій/i.test(line)) k = L.k;
        if (!k) return;
        seen.add(key);
        if (k === 'boom') {
          raw.forEach((p, i) => addThreat({ id: key + 'p' + i, post: id, type: 'boom', t: tms, pts: [[p[0], p[1]]], text: line.trim().slice(0, 300), ch, dest: false, reg: !!p[2] }));
          n++; return;
        }
        const o = { id: key, post: id, type: k, t: tms, pts, text: line.trim().slice(0, 300), ch, dest: pts.length === 1 && (DEST.test(line) || (/(?:^|[\s,])(?:на|до)\s/i.test(line) && !/біля|над\s|район|околиц|поблизу|\sв\s|\sу\s/i.test(line))), n: countOf(line), reg: !!(raw[0] && raw[0][2]) };
        
        if (CLOSING.test(line)) { 
          closeNear(o); 
          o.dead = tms; 
        }

        if (!lastK[ch] || tms >= lastK[ch].t) lastK[ch] = { k, t: tms };
        if (!lastK['*'] || tms >= lastK['*'].t) lastK['*'] = { k, t: tms };
        
        addThreat(o); 
        n++;
      });
    }
    const title = (h.match(/tgme_channel_info_header_title[^>]*>(?:<[^>]+>)*([^<]+)/) || [])[1];
    Object.assign(st, { ok: true, n: parts.length, at: Date.now(), err: '', title: title ? title.trim() : ch, tried: true, fails: 0, nop: 0, dead: false, until: 0 });
    lastGood = Date.now();
  } catch (e) {
    const fails = (st.fails || 0) + 1;
    const nop = e.nopreview ? (st.nop || 0) + 1 : 0;
    const dead = nop >= DEAD_AFTER;
    const back = dead ? DEAD_RETRY : e.retry || (fails >= 2 ? Math.min(5 * 60e3, POLL_EVERY * 2 ** (fails - 1)) : 0);
    Object.assign(st, { ok: false, err: dead ? 'недоступний (немає публічного перегляду), повтор раз на 6 год' : e.message, tried: true, fails, nop, dead, until: back ? Date.now() + (dead ? back : Math.min(back, 10 * 60e3)) : 0 });
    if (!dead || nop === DEAD_AFTER) logErr('канал ' + ch + ': ' + e.message + (dead ? ' — позначено недоступним' : ''));
  } finally { st.busy = false; }
}

function save() {
  const cut = Date.now() - KEEP;
  for (const [k, v] of threats) if (v.t < cut) threats.delete(k);
  ballWarn = ballWarn.filter(w => w.t >= cut);
  while (snaps.length > 1 && snaps[1].t < cut) snaps.shift();
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const f = path.join(DATA, 'history.json'), tmp = f + '.tmp';
    fs.writeFile(tmp, JSON.stringify({ snaps, lastGood, threats: [...threats.values()], ballWarn }), e => { if (!e) fs.rename(tmp, f, () => {}); });
  } catch (e) {}
}

// Прозорість: ціль напівпрозора ТІЛЬКИ в останні 3 хвилини перед зникненням (TTL - FADE_TIME).
// est: розрахункова поточна позиція цілі, якщо відомо і «звідки», і «куди» (рух від першої точки до останньої зі швидкістю типу цілі).
const recent = (ms, ref = Date.now()) => [...threats.values()]
  .filter(t => !t.dead && t.t > ref - ms)
  .map(t => {
    const age = ref - t.t, timeLeft = TTL - age;
    let opacity = 1.0;
    if (timeLeft <= FADE_TIME && timeLeft > 0) opacity = Math.max(0.02, +(timeLeft / FADE_TIME).toFixed(2));

    let est;
    if (t.pts.length >= 2 && !t.reg && t.type !== 'boom') {
      const a = t.pts[0], b = t.pts[t.pts.length - 1], total = dist(a, b);
      if (total > 0.05) {
        const mins = Math.max(0, ref - (t.t0 || t.t)) / 60e3;
        const k = Math.min(1, ((SPEED[t.type] || SPEED.shahed) * mins) / total);
        est = [+(a[0] + (b[0] - a[0]) * k).toFixed(4), +(a[1] + (b[1] - a[1]) * k).toFixed(4)];
      }
    }
    return { ...t, opacity, est };
  }).sort((a, b) => a.t - b.t);

const BALL_TTL = 15 * 60e3;
const ballRecent = (ms = BALL_TTL * 2, ref = Date.now()) => ballWarn.filter(w => !w.dead && w.t > ref - ms).sort((a, b) => a.t - b.t).slice(-40);
const diag = () => ({ geo: geoErr, channels: chStat, health: health() });
const CITIES = PLACES.filter(p => p.r > 0 && p.n !== 'Київ' && p.n !== 'Севастополь').map(p => ({ n: p.n, la: p.la, lo: p.lo, r: p.r }));

const CH_OK = /^[A-Za-z0-9_]{4,64}$/;
const uniq = a => [...new Set(a.map(cleanCh).filter(c => CH_OK.test(c)))];
function setChannels(list) {
  const next = uniq(list); if (!next.length) return false;
  CHANNELS.length = 0; CHANNELS.push(...next);
  for (const k of Object.keys(chStat)) if (!CHANNELS.includes(k)) delete chStat[k];
  const fresh = CHANNELS.filter(c => !chStat[c]);
  CHANNELS.forEach(c => { chStat[c] = chStat[c] || { ok: false, n: 0 }; });
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, 'channels.json'), JSON.stringify({ channels: CHANNELS })); } catch (e) {}
  fresh.forEach((c, i) => setTimeout(() => pollTG(c), 400 * (i + 1)));
  return true;
}

const PROXY_H = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'cf-ray', 'via'];
const isLocal = req => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '')
  && !PROXY_H.some(h => req.headers[h])
  && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || '')
  && (!req.headers.origin || (() => { try { return new URL(req.headers.origin).host === req.headers.host; } catch (e) { return false; } })());
function readBody(req, cb) { let b = ''; req.on('data', c => { b += c; if (b.length > 20000) req.destroy(); }); req.on('end', () => { try { cb(JSON.parse(b || '{}')); } catch (e) { cb(null); } }); }

const MIME = { '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const srv = http.createServer((req, res) => {
  let u; try { u = new URL(req.url.replace(/^\/+/, '/'), 'http://x'); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  const json = o => { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); return res.end('ok'); }
  if (u.pathname === '/api/state') { const hl = health(), ref = refTime(hl); return json({ now: Date.now(), ref, stale: hl.stale, lastGood, alerts, threats: recent(35 * 60e3, ref), ball: ballRecent(BALL_TTL * 2, ref), ballTtl: BALL_TTL, source, ttl: TTL, noCourse: noCourse(ref), diag: diag() }); }
  if (u.pathname === '/api/cities') return json(CITIES);
  if (u.pathname === '/api/channels') {
    const canEdit = isLocal(req);
    if (req.method === 'POST') {
      if (!canEdit) { res.writeHead(403); return res.end('Forbidden'); }
      return readBody(req, b => {
        const ok = b && (b.reset ? setChannels(DEFAULT_CHANNELS) : Array.isArray(b.channels) && setChannels(b.channels));
        json({ ok: !!ok, channels: CHANNELS });
      });
    }
    return json({ canEdit, defaults: DEFAULT_CHANNELS, channels: CHANNELS.map(c => ({ ch: c, ...(chStat[c] ? { ok: chStat[c].ok, dead: !!chStat[c].dead, tried: !!chStat[c].tried, err: chStat[c].err || '', title: chStat[c].title || '' } : {}) })) });
  }
  if (u.pathname === '/api/history') {
    const ms = Math.min(48, +u.searchParams.get('hours') || 24) * 3600e3, from = Date.now() - ms;
    let s = snaps.filter(x => x.t >= from), before = snaps.filter(x => x.t < from).pop();
    if (before) s.unshift({ t: from, a: before.a });
    return json({ now: Date.now(), from, snaps: s, threats: recent(ms), ball: ballRecent(ms), ballTtl: BALL_TTL, source, ttl: TTL });
  }
  const f = path.join(__dirname, 'public', u.pathname === '/' ? 'index.html' : path.normalize(u.pathname).replace(/^(\.\.[\/\\])+/, ''));
  fs.readFile(f, (e, d) => e ? (res.writeHead(404), res.end('Not found')) : (res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }), res.end(d)));
});

exports.setFetch = f => { F = f; };
exports.start = (port = +process.env.PORT || 3000, dataDir, host = process.env.HOST || '0.0.0.0') => new Promise(ok => {
  if (dataDir) DATA = dataDir;
  for (const d of [DATA, process.cwd(), process.env.PORTABLE_EXECUTABLE_DIR, __dirname]) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(d || '.', 'config.json')));
      if (!TOKEN && c.alertsToken && !/^ВАШ_/.test(c.alertsToken)) TOKEN = c.alertsToken;
      if (Array.isArray(c.channels) && c.channels.length && !process.env.TG_CHANNELS) CHANNELS = c.channels.map(cleanCh).filter(Boolean);
      if (+c.pollSeconds >= 15 && +c.pollSeconds <= 300) POLL_EVERY = +c.pollSeconds * 1000;
    } catch (e) {}
  }
  try { const c = JSON.parse(fs.readFileSync(path.join(DATA, 'channels.json'))); if (!process.env.TG_CHANNELS && Array.isArray(c.channels) && uniq(c.channels).length) CHANNELS = uniq(c.channels); } catch (e) {}
  try { loadGaz(); } catch (e) { logErr('settlements.json: ' + e.message); }
  try { loadGeo(); } catch (e) { geoErr = 'raions.json: ' + e.message; console.error(geoErr); logErr(geoErr); }
  try {
    const h = JSON.parse(fs.readFileSync(path.join(DATA, 'history.json')));
    snaps = h.snaps || []; lastGood = h.lastGood || 0;
    (h.threats || []).filter(t => !NIGHT.test(t.text || '') && !NOISE.test(t.text || '') && !FALSE_ALARM.test(t.text || '')).forEach(t => { threats.set(t.id, t); seen.add(t.id); (t.src || []).forEach(a => seen.add(a.key)); });
    ballWarn = (h.ballWarn || []).filter(w => !NIGHT.test(w.text || '') && !NOISE.test(w.text || '') && !FALSE_ALARM.test(w.text || '') && BALL_CUE.test(w.text || ''));
    ballWarn.forEach(w => seen.add(w.key + 'b'));
  } catch (e) {}
  CHANNELS.forEach(c => { chStat[c] = chStat[c] || { ok: false, n: 0 }; });
  let rot = 0;
  const pollNext = () => {
    for (let i = 0; i < CHANNELS.length; i++) {
      const ch = CHANNELS[rot++ % CHANNELS.length], st = chStat[ch];
      if (st && !st.busy && !((st.until || 0) > Date.now())) return pollTG(ch);
    }
  };
  const warmup = async () => {
    for (const ch of CHANNELS.slice()) { await pollTG(ch); await sleep(700); }
    // вилучаємо канали, яких не існує або де немає публічного перегляду (429 і збої мережі не чіпаємо)
    const bad = CHANNELS.filter(c => chStat[c] && !chStat[c].ok && chStat[c].nop >= 1);
    if (bad.length && bad.length < CHANNELS.length) {
      logErr('вилучено недійсні канали: ' + bad.join(', '));
      console.log('Вилучено недійсні канали: ' + bad.join(', '));
      CHANNELS = CHANNELS.filter(c => !bad.includes(c));
      bad.forEach(c => delete chStat[c]);
    }
    console.log('Робочі канали (' + CHANNELS.length + '): ' + CHANNELS.join(', '));
  };
  pollAlerts().then(save); setInterval(pollAlerts, 30e3); setInterval(save, 60e3);
  const tick = () => { pollNext(); setTimeout(tick, Math.max(1200, Math.round(POLL_EVERY / Math.max(1, CHANNELS.length)))); };
  warmup().then(tick);
  // Render (безкоштовний план) присипляє сервіс без вхідних запитів: поки він прокинутий, пінгуємо власну публічну адресу.
  // Якщо сервіс уже заснув, цей таймер не працює, тому додатково потрібен зовнішній пінг (UptimeRobot / cron-job.org) на /health.
  const selfUrl = process.env.SELF_PING_URL || process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) setInterval(() => { fetch(selfUrl.replace(/\/+$/, '') + '/health', { signal: AbortSignal.timeout(15000) }).catch(() => {}); }, 10 * 60e3);
  srv.listen(port, host, () => { console.log('AlertMap: http://localhost:' + srv.address().port); console.log('Канали: ' + CHANNELS.join(', ')); ok(srv.address().port); });
});
exports._t = { decodeHtml, noCourse, orphans, gazPlaces, GAZ, loadGaz, ballWarn: () => ballWarn, DEFAULT_CHANNELS, placesRaw, OBL_GEO, countOf, health, refTime, chStat, recent, sirenAlerts, tokenAlerts, loadGeo, places, kind, pollTG, addThreat, closeNear, threats, setT: t => { TREE = t; }, get: () => alerts };
if (require.main === module) exports.start();
