// Запуск: npm test  (потрібен Node 18+). Перевіряє розбір повідомлень з Telegram-каналів.
const test = require('node:test'), assert = require('node:assert');
const { _t: t } = require('../server');
t.loadGaz(); t.loadGeo();

test('kind: тип цілі', () => {
  assert.strictEqual(t.kind('🛸 Шахед на Київ'), 'shahed');
  assert.strictEqual(t.kind('Балістика на Одесу'), 'ballistic');
  assert.strictEqual(t.kind('Вибухи у Харкові'), 'boom');
  assert.strictEqual(t.kind('Відбій тривоги'), undefined);
  assert.strictEqual(t.kind('Дякуємо, що читаєте, донат на monobank'), undefined);
});

test('countOf: кількість цілей у групі', () => {
  assert.strictEqual(t.countOf('2 шахеди курсом на Житомир'), 2);
  assert.strictEqual(t.countOf('3х БпЛА з боку Чернігова на Київ'), 3);
  assert.strictEqual(t.countOf('🛸 Шахед на Київ'), undefined);
});

test('placesRaw: місця з координатами', () => {
  const near = (p, la, lo) => Math.abs(p[0] - la) < 0.05 && Math.abs(p[1] - lo) < 0.05;
  const k = t.placesRaw('🛸 Шахед на Київ');
  assert.strictEqual(k.length, 1); assert.ok(near(k[0], 50.45, 30.52));
  const two = t.placesRaw('3х БпЛА з боку Чернігова на Київ'); // у порядку згадування: Чернігів, потім Київ
  assert.strictEqual(two.length, 2); assert.ok(near(two[0], 51.5, 31.3)); assert.ok(near(two[1], 50.45, 30.52));
  assert.deepStrictEqual(t.placesRaw('Відбій тривоги'), []);
});

test('канал, що не має публічного перегляду, стає «недоступним» і не опитується щохвилини', async () => {
  const st = t.chStat.__test = { ok: false, n: 0 };
  // підміна fetch: t.me/s/... повертає сторінку без постів
  require('../server').setFetch(async () => ({ ok: true, status: 200, text: async () => '<html></html>', headers: { get: () => null } }));
  for (let i = 0; i < 3; i++) { st.until = 0; await t.pollTG('__test'); }
  assert.strictEqual(st.dead, true);
  assert.ok(st.until - Date.now() > 3600e3, 'повторна спроба має бути не раніше ніж за годину');
  delete t.chStat.__test;
});

// ---- Регресія: «дезінфа» на карті (Шостка → Козин) ----
function feed(ch, posts) { // підміняє t.me/s/<ch> сторінкою з такими постами [[хвилин тому, текст], …]
  const html = posts.map(([ago, text], i) => `<div class="tgme_widget_message_wrap" data-post="${ch}/${i + 1}"><time datetime="${new Date(Date.now() - ago * 60e3).toISOString()}"></time><div class="tgme_widget_message_text">${text}</div></div>`).join('');
  require('../server').setFetch(async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => html }));
  t.chStat[ch] = {}; return t.pollTG(ch);
}

test('«БпЛА на Козин» не чіпляється до цілі за сотні кілометрів', async () => {
  t.threats.clear();
  await feed('reg_a', [[11, '🛸 БпЛА біля Шостки']]);
  await feed('reg_b', [[7, 'РбпЛА на Козин']]);
  const all = [...t.threats.values()];
  assert.strictEqual(all.length, 1, 'лише ціль біля Шостки');
  assert.strictEqual(all[0].pts.length, 1, 'маршрут не продовжено до Козина');
  assert.ok(Math.abs(all[0].pts[0][0] - 51.87) < 0.1);
});

test('«БпЛА на Київ» продовжує курс цілі, що поруч (Бориспіль → Київ)', async () => {
  t.threats.clear();
  await feed('reg_c', [[3, '🛸 БпЛА над Борисполем']]);
  await feed('reg_d', [[1, 'БпЛА на Київ']]);
  const all = [...t.threats.values()];
  assert.strictEqual(all.length, 1); assert.strictEqual(all[0].pts.length, 2);
});

test('звіти про наслідки від ДСНС не стають маркером цілі', async () => {
  t.threats.clear();
  await feed('reg_e', [[5, '😩 У Шосткинській громаді через удар ворожого дрона спалахнув вантажний автомобіль. Поранених не зафіксовано, — ДСНС'],
                       [4, 'Жесть, момент падіння російського дрона на трасі Київ – Бориспіль прямо перед автівкою.']]);
  assert.strictEqual(t.threats.size, 0);
});

test('фото/опис наслідків («вирва після прильоту») — не маркер вибуху, а живі «Прильоти у…» — маркер', async () => {
  t.threats.clear();
  await feed('reg_f', [[5, "😮 Величезна вирва після прильоту просто під будинком у Солом'янському районі Києва."]]);
  assert.strictEqual(t.threats.size, 0);
  await feed('reg_g', [[1, "Прильоти у Солом'янському районі Києва"]]);
  assert.strictEqual(t.threats.size, 1);
  assert.strictEqual([...t.threats.values()][0].type, 'boom');
});

test('«Момент падіння та детонації…», «відео влучання» — це записи минулих подій, не маркери', async () => {
  t.threats.clear();
  await feed('reg_h', [[3, 'Момент падіння та детонації дрона на трасі Київ — Бориспіль'],
                       [3, 'Момент вибуху у Харкові'], [2, 'Відео прильоту у Києві'], [2, 'Кадри влучання в Одесі']]);
  assert.strictEqual(t.threats.size, 0);
  await feed('reg_i', [[1, 'Вибухи у Харкові']]);
  assert.strictEqual(t.threats.size, 1, 'живе повідомлення про вибухи лишається');
});

test('«курсом на X» без відомого місця не малюється, а рахується як «без курсу»', () => {
  const { addThreat, threats, orphans, noCourse } = require('../server')._t;
  threats.clear(); orphans.clear();
  addThreat({ id: 't#0', post: 'c/1', type: 'shahed', t: Date.now(), pts: [[49.59, 34.55]], text: 'БпЛА курсом на Полтаву', ch: 'c', dest: true, n: 3 });
  assert.strictEqual(threats.size, 0);
  assert.strictEqual(noCourse(), 3);
  orphans.clear();
});

test('перелік сіл після двокрапки розпізнається, область у дужках не стає пунктом призначення', () => {
  const { placesRaw, loadGeo, loadGaz } = require('../server')._t;
  loadGeo(); loadGaz();
  assert.ok(placesRaw('БпЛА: Решетилівка, Козельщина').length >= 1);
});

test('числові HTML-коди (&#33;) та &amp; розкодовуються в тексті поста', () => {
  const { decodeHtml } = require('../server')._t;
  assert.strictEqual(decodeHtml('Черкаси&#33; &#x41; &quot;так&quot; &amp;amp;'), 'Черкаси! A "так" &amp;');
});

// ---- Точність: місце і кількість ----
test('область після місця через «/» чи «,» — уточнення, а не пункт призначення (→ЧЗВ/Житомирщина)', () => {
  const near = (p, la, lo) => Math.abs(p[0] - la) < 0.05 && Math.abs(p[1] - lo) < 0.05;
  const a = t.placesRaw('→ЧЗВ/Житомирщина');
  assert.strictEqual(a.length, 1, 'центр Житомирщини не додається');
  assert.ok(near(a[0], 51.33, 30.1) && !a[0][2]);
  assert.strictEqual(t.placesRaw('Шахед: Бровари/Київщина').length, 1);
  assert.strictEqual(t.placesRaw('БпЛА біля Суми, Київщина').length, 2, 'місце поза областю — окремий пункт');
  assert.strictEqual(t.placesRaw('БпЛА на Київщину, Житомирщина').length, 2, 'дві області — дві точки');
});

test('двозначна назва («Ямпіль») тягнеться до місця, про яке цей канал писав щойно', async () => {
  t.threats.clear(); delete t.lastPos.hint_a; delete t.lastPos.hint_b;
  await feed('hint_b', [[1, 'БпЛА на Ямпіль']]);
  assert.strictEqual(t.threats.size, 0, 'без підказки Ямпіль неоднозначний — не малюємо');
  t.threats.clear();
  await feed('hint_a', [[6, 'БпЛА біля Глухова'], [1, 'БпЛА на Ямпіль']]);
  const all = [...t.threats.values()];
  assert.strictEqual(all.length, 1);
  const last = all[0].pts[all[0].pts.length - 1];
  assert.ok(Math.abs(last[0] - 51.95) < 0.1 && Math.abs(last[1] - 33.79) < 0.1, 'Ямпіль на Сумщині, а не на Вінниччині');
});

test('countMinOf: «кілька/група» → «2+», точне число — окремо', () => {
  assert.strictEqual(t.countMinOf('кілька шахедів на Київ'), true);
  assert.strictEqual(t.countMinOf('Група БпЛА курсом на Суми'), true);
  assert.strictEqual(t.countMinOf('🛸 Шахед на Київ'), false);
  assert.strictEqual(t.countOf('кілька шахедів на Київ'), undefined);
});

test('кількість у групі: максимум серед каналів, а свій канал оновлює власне число', () => {
  const { addThreat, threats, orphans } = t, now = Date.now();
  const mk = (id, ch, dt, n, nMin) => ({ id, post: ch + '/' + id, type: 'shahed', t: now + dt, pts: [[50.45, 30.52]], text: 'x', ch, dest: false, n, nMin });
  threats.clear(); orphans.clear();
  addThreat(mk('a#0', 'cA', 0, 3)); addThreat(mk('b#0', 'cB', 30e3, 2));
  assert.strictEqual(threats.size, 1); assert.strictEqual([...threats.values()][0].n, 3, 'два канали: береться максимум');
  threats.clear();
  addThreat(mk('a#1', 'cA', 0, 3)); addThreat(mk('a#2', 'cA', 60e3, 2));
  assert.strictEqual([...threats.values()][0].n, 2, 'той самий канал уточнив число');
  threats.clear();
  addThreat(mk('a#3', 'cA', 0, 2, true)); addThreat(mk('b#3', 'cB', 20e3, 4));
  const x = [...threats.values()][0]; assert.strictEqual(x.n, 4); assert.ok(!x.nMin, 'точне число скасовує «2+»');
  threats.clear();
  addThreat(mk('a#4', 'cA', 0, 2, true));
  const y = [...threats.values()][0]; assert.strictEqual(y.n, 2); assert.strictEqual(y.nMin, true);
  threats.clear();
});

// ---- Регресія: «Влучання… у Київському районі, – Терехов» (Харків) не має ставити значки під Києвом і Бердичевом ----
test('район міста і прізвище посадовця не стають місцем: Харків, а не Київ і не село Терехов', () => {
  const near = (p, la, lo) => Math.abs(p[0] - la) < 0.05 && Math.abs(p[1] - lo) < 0.05;
  const KHR = [[49.99, 36.23, 3]];
  const a = t.placesRaw('Влучання ударного дрону в Київському районі, – Терехов.', KHR);
  assert.strictEqual(a.length, 1); assert.ok(near(a[0], 49.99, 36.23), 'Київський район Харкова');
  assert.deepStrictEqual(t.placesRaw('Влучання ударного дрону в Київському районі, – Терехов.'), [], 'без харківського контексту — краще без значка, ніж під Києвом');
  const b = t.placesRaw('Ще одне влучання Бандеролі було у Слобідському районі, – Терехов.');
  assert.strictEqual(b.length, 1); assert.ok(near(b[0], 49.99, 36.23));
  const c = t.placesRaw('Влучання в Шевченківському районі Києва', KHR);
  assert.strictEqual(c.length, 1); assert.ok(near(c[0], 50.45, 30.52), 'Шевченківський район Києва лишається Києвом');
  assert.strictEqual(t.placesRaw('Влучання у Харкові, – Терехов').length, 1);
});

test('пост харківського каналу про Київський район дає один значок у Харкові', async () => {
  t.threats.clear(); delete t.lastPos.truexakharkiv;
  await feed('truexakharkiv', [[1, 'Влучання ударного дрону в Київському районі, – Терехов.']]);
  const all = [...t.threats.values()];
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].type, 'boom');
  assert.ok(Math.abs(all[0].pts[0][0] - 49.99) < 0.05 && Math.abs(all[0].pts[0][1] - 36.23) < 0.05);
  t.threats.clear();
});
