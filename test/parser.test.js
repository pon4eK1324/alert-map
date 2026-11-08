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
