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

// ---- Звідки летить і рух цілі ----
test('originOf: «з Брянщини», «з боку Білорусі», стрілка; без «з» — не місце запуску', () => {
  assert.strictEqual(t.originOf('Шахед з Брянщини на Сумщину').n, 'Брянщини');
  assert.strictEqual(t.originOf('3х БпЛА з боку Білорусі на Київ').n, 'Білорусі');
  assert.strictEqual(t.originOf('Ракети з акваторії Чорного моря курсом на Одесу').n, 'Чорного моря');
  assert.strictEqual(t.originOf('Курщина → Суми, БпЛА').n, 'Курщини');
  assert.strictEqual(t.originOf('🛸 Шахед біля Конотопа'), undefined);
  assert.strictEqual(t.originOf('Шахед на Курськ'), undefined, 'пункт призначення — не місце запуску');
});

test('entryPoint: відрізок з Брянщини до Сум заходить в Україну на кордоні', () => {
  const en = t.entryPoint([52.9, 33.4], [51.1, 34.1]);
  assert.ok(en && t.inUA(en[0], en[1]), 'точка входу всередині України');
  assert.ok(en[0] < 52.5 && en[0] > 51.1, 'десь біля кордону, а не в центрі області: ' + en);
  assert.ok(t.inUA(50.45, 30.52) && !t.inUA(55.75, 37.6), 'Київ — Україна, Москва — ні');
});

test('«з Брянщини на Сумщину» без відомої позиції ставить ціль на кордоні з треком і місцем запуску', async () => {
  t.threats.clear();
  await feed('org_a', [[1, '🛸 Шахед з Брянщини на Сумщину']]);
  const all = [...t.threats.values()];
  assert.strictEqual(all.length, 1);
  const x = all[0];
  assert.strictEqual(x.org.n, 'Брянщини'); assert.strictEqual(x.org.x, true);
  assert.strictEqual(x.ent, true); assert.strictEqual(x.trk.length, 1);
  assert.ok(x.dst && Math.abs(x.dst[0] - x.pts[1][0]) < 1e-9);
});

test('справжня позиція після оцінки на кордоні оновлює ту саму ціль, а не дублює', async () => {
  t.threats.clear();
  await feed('org_b', [[6, '🛸 Шахед з Брянщини на Сумщину']]);
  await feed('org_c', [[1, '🛸 Шахед біля Глухова']]);
  const all = [...t.threats.values()];
  assert.strictEqual(all.length, 1, 'одна ціль');
  assert.strictEqual(all[0].ent, false);
  assert.ok(all[0].org && all[0].org.n === 'Брянщини');
  assert.ok(Math.abs(all[0].trk[all[0].trk.length - 1][1] - 51.68) < 0.15, 'остання позиція — Глухів');
});

test('нові позиції однієї цілі дописуються в трек (з них клієнт рахує напрямок і рух)', () => {
  t.threats.clear();
  const now = Date.now(), mk = (id, ago, p) => ({ id, post: 'trk/' + id, type: 'shahed', t: now - ago * 60e3, pts: [p], text: 'x', ch: 'trk', dest: false, reg: false });
  t.addThreat(mk('a#0', 3, [50.30, 30.90]));
  t.addThreat(mk('b#0', 1, [50.38, 30.82]));
  const all = [...t.threats.values()];
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].trk.length, 2);
  assert.ok(all[0].trk[0][0] < all[0].trk[1][0]);
  assert.ok(all[0].org, 'для шахеда поблизу кордону — ймовірний напрямок');
});

test('вибух не отримує місця запуску', async () => {
  t.threats.clear();
  await feed('org_d', [[1, 'Вибухи у Харкові']]);
  const x = [...t.threats.values()][0];
  assert.ok(x && !x.org);
});

test('«Ймовірно, це була ракета Герань-5. Момент прольоту над Полтавою» — розбір минулої події, не жива ціль; Герань-5 — реактивний', async () => {
  t.threats.clear();
  await feed('past_a', [[1, '☀️Ймовірно, це була ракета Герань-5. Момент прольоту цілі над Полтавою.']]);
  assert.strictEqual(t.threats.size, 0);
  assert.strictEqual(t.kind('Ракета Герань-5 курсом на Київ'), 'jet');
  assert.strictEqual(t.kind('Ракета на Київ'), 'missile');
});

// ---- Точніше розміщення відносно населеного пункту ----
test('«на північній околиці X», «північніше X», «за N км на північ від X» зсувають точку в бік, а не ставлять у центр', () => {
  const [c] = t.placesRaw('Шахед біля Харкова'), [o] = t.placesRaw('Шахед на північній околиці Харкова');
  assert.ok(o[0] > c[0] + 0.04 && o[0] < c[0] + 0.15 && Math.abs(o[1] - c[1]) < 0.02, 'околиця: трохи північніше центру');
  const [pc] = t.placesRaw('БпЛА над Полтавою'), [pn] = t.placesRaw('БпЛА північніше Полтави'), [pk] = t.placesRaw('БпЛА за 10 км на північ від Полтави');
  assert.ok(pn[0] > pc[0] + 0.1 && pn[0] < pc[0] + 0.25, 'північніше');
  assert.ok(Math.abs(pk[0] - pc[0] - 10 / 111) < 0.01, '10 км ≈ 0,09°');
  const [ps] = t.placesRaw('БпЛА на півдні Полтави'); assert.ok(ps[0] < pc[0] - 0.02, 'південь міста');
  const [pd] = t.placesRaw('у південно-східній частині Харкова'); assert.ok(pd[0] < c[0] && pd[1] > c[1], 'діагональ');
});

test('напрям діє і для малих сіл із газетира (без слів «біля/над»)', () => {
  const [a] = t.placesRaw('БпЛА над Решетилівкою'), [b] = t.placesRaw('БпЛА північніше Решетилівки');
  assert.ok(b[0] > a[0] + 0.1 && Math.abs(b[1] - a[1]) < 0.02);
});

test('«між X та Y» — одна точка посередині', () => {
  const r = t.placesRaw('БпЛА між Решетилівкою та Полтавою');
  assert.strictEqual(r.length, 1);
  assert.ok(Math.abs(r[0][0] - (49.5531 + 49.59) / 2) < 0.02);
  assert.strictEqual(t.placesRaw('БпЛА Решетилівка, Полтава').length, 2, 'без «між» — як раніше');
});

test('«курсом на X» біля кордону: ціль ставиться на кордоні з боку пуску (оцінка), далеко від кордону — не малюється', () => {
  t.threats.clear(); t.orphans.clear();
  const now = Date.now(), mk = (id, p, text) => ({ id, post: 'inf/' + id, type: 'shahed', t: now, pts: [p], text, ch: 'inf', dest: true });
  t.addThreat(mk('s', [51.5, 31.3], 'БпЛА курсом на Чернігів'));
  const x = [...t.threats.values()][0];
  assert.ok(x && x.ent === true && x.org && x.org.x === false, 'оцінена позиція, місце запуску — здогад');
  t.addThreat(mk('p', [49.59, 34.55], 'БпЛА курсом на Полтаву'));
  assert.strictEqual(t.threats.size, 1, 'Полтава далеко від кордону — не малюємо');
  assert.ok(t.noCourse() >= 1);
  t.threats.clear(); t.orphans.clear();
});

test('seen очищається за часом, а не росте безкінечно', () => {
  t.seenAt.clear();
  t.seenAt.set('old#1', Date.now() - 73 * 3600e3); t.seenAt.set('new#1', Date.now() - 3600e3);
  t.pruneSeen();
  assert.ok(!t.seenAt.has('old#1') && t.seenAt.has('new#1'));
  t.seenAt.clear();
});
