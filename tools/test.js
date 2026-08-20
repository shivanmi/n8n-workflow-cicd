#!/usr/bin/env node
// Тесты на логику Code-нод.
//
// Смысл выноса логики из n8n в модули ровно в этом: чистые функции
// тестируются без платформы, без вебхуков и без прода.

const assert = require('assert');
const { normalizeLead, canonPhone, canonUrl, canonStudyForm } = require('../src/code/normalize-lead');
const { scoreLead, toPriority, scoreAndPrioritize } = require('../src/code/score-lead');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}\n     ${err.message}`);
    failed++;
  }
}

// ── нормализация ────────────────────────────────────────────────────────────

test('телефон приводится к единому виду независимо от написания', () => {
  assert.strictEqual(canonPhone('8 (911) 105-07-57'), '79111050757');
  assert.strictEqual(canonPhone('+7 911 105 07 57'), '79111050757');
  assert.strictEqual(canonPhone('79111050757'), '79111050757');
});

test('пустой телефон не превращается в пустую строку', () => {
  assert.strictEqual(canonPhone(''), null);
  assert.strictEqual(canonPhone(null), null);
  assert.strictEqual(canonPhone('без цифр'), null);
});

test('URL канонизируется, поддомен кроме www сохраняется', () => {
  assert.strictEqual(canonUrl('https://www.Example.com/'), 'example.com');
  assert.strictEqual(canonUrl('http://lp.example.com/page/'), 'lp.example.com/page');
});

test('зоопарк форм обучения сводится к канону', () => {
  assert.strictEqual(canonStudyForm('очно'), 'Очная');
  assert.strictEqual(canonStudyForm('ЗАОЧНО'), 'Заочная');
  assert.strictEqual(canonStudyForm('  дистант '), 'Дистанционная');
});

test('неизвестная форма обучения даёт null, а не мусор', () => {
  assert.strictEqual(canonStudyForm('вторник'), null);
});

test('опечатки в ключах чинятся, пробелы срезаются', () => {
  const out = normalizeLead({ ' name ': '  Иван  ', 'tel': '89111050757', 'e-mail': 'A@B.RU' });
  assert.strictEqual(out.name, 'Иван');
  assert.strictEqual(out.phone, '79111050757');
  assert.strictEqual(out.email, 'a@b.ru');
});

test('вебхук с обёрткой body и прямой вызов дают одинаковый результат', () => {
  const raw = { name: 'Иван', phone: '89111050757' };
  assert.deepStrictEqual(normalizeLead({ body: raw }), normalizeLead(raw));
});

// ── скоринг ─────────────────────────────────────────────────────────────────

test('нет данных аналитики — заявка проходит без скоринга, а не падает', () => {
  assert.deepStrictEqual(scoreLead(null), { score: null, reason: 'no_visit_data' });
  assert.strictEqual(scoreLead({ visits: 0, pageviews: 0 }).score, null);
  assert.strictEqual(toPriority(null), 'unscored');
});

test('скор лежит в границах 0–10', () => {
  const huge = scoreLead({ visits: 9999, pageviews: 9999, duration_current: 99999, duration_total: 99999, depth: 999 });
  assert.ok(huge.score <= 10, `ожидали <= 10, получили ${huge.score}`);
  assert.ok(huge.score >= 0);
});

test('активный посетитель получает больше пассивного', () => {
  const active = scoreLead({ visits: 8, pageviews: 30, duration_current: 700, duration_total: 2400, depth: 6 });
  const passive = scoreLead({ visits: 1, pageviews: 2, duration_current: 20, duration_total: 20, depth: 1 });
  assert.ok(active.score > passive.score, `${active.score} должен быть больше ${passive.score}`);
});

test('логарифмическое сглаживание гасит выбросы', () => {
  // Рост просмотров в 100 раз не должен давать роста скора в 100 раз.
  const few = scoreLead({ pageviews: 2 }).score;
  const many = scoreLead({ pageviews: 200 }).score;
  assert.ok(many < few * 20, `выброс не сглажен: ${few} → ${many}`);
});

test('частичные данные помечаются как partial', () => {
  assert.strictEqual(scoreLead({ visits: 3 }).reason, 'partial');
  assert.strictEqual(
    scoreLead({ visits: 3, pageviews: 5, duration_current: 60, duration_total: 120, depth: 2 }).reason,
    'full'
  );
});

test('границы приоритета соответствуют шкале', () => {
  assert.strictEqual(toPriority(9), 'high');
  assert.strictEqual(toPriority(7), 'high');
  assert.strictEqual(toPriority(5), 'medium');
  assert.strictEqual(toPriority(1), 'low');
});

test('scoreAndPrioritize отдаёт готовый приоритет для ветвления', () => {
  const r = scoreAndPrioritize({ visits: 9, pageviews: 35, duration_current: 800, duration_total: 3000, depth: 7 });
  assert.ok(['high','medium','low'].includes(r.priority), 'приоритет не выставлен: ' + r.priority);
  assert.strictEqual(scoreAndPrioritize(null).priority, 'unscored');
});

// ── сборка ──────────────────────────────────────────────────────────────────

const { wrapCodeNode } = require('./build');

test('собранный код Code-ноды не содержит require()', () => {
  const code = wrapCodeNode('src/code/score-lead.js', 'scoreLead', 'item.json.visit', true);
  assert.ok(!code.includes('require('), 'в собранном коде остался require()');
  assert.ok(code.includes('return $input.all();'), 'нет возврата элементов');
});

// ── валидатор ───────────────────────────────────────────────────────────────
//
// Валидатор должен не только пропускать целые потоки, но и падать на битых.
// Второе важнее: пропущенная ошибка уезжает в прод.

const { validate } = require('./validate');

const validWorkflow = () => ({
  name: 'Test',
  nodes: [
    { name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: {} },
    { name: 'Do', type: 'n8n-nodes-base.noOp', parameters: {} },
  ],
  connections: { Webhook: { main: [[{ node: 'Do', type: 'main', index: 0 }]] } },
  settings: { executionOrder: 'v1' },
});

const errorsOf = (wf) => validate(wf, 'test.json').errors;

test('валидатор пропускает корректный поток', () => {
  assert.deepStrictEqual(errorsOf(validWorkflow()), []);
});

test('валидатор ловит связь на несуществующую ноду', () => {
  const wf = validWorkflow();
  wf.connections.Webhook.main[0][0].node = 'Опечатка';
  const errors = errorsOf(wf);
  assert.ok(errors.some((e) => e.includes('несуществующая нода')), errors.join('; '));
});

test('валидатор ловит дубль имени ноды', () => {
  const wf = validWorkflow();
  wf.nodes.push({ name: 'Do', type: 'n8n-nodes-base.noOp', parameters: {} });
  assert.ok(errorsOf(wf).some((e) => e.includes('дубль имени')));
});

test('валидатор ловит поток без триггера', () => {
  const wf = validWorkflow();
  wf.nodes[0] = { name: 'Webhook', type: 'n8n-nodes-base.noOp', parameters: {} };
  assert.ok(errorsOf(wf).some((e) => e.includes('нет ни одной триггер-ноды')));
});

test('валидатор ловит запрещённый ключ в settings', () => {
  const wf = validWorkflow();
  wf.settings.somethingWeird = true;
  const errors = errorsOf(wf);
  assert.ok(errors.some((e) => e.includes('не принимается public API')), errors.join('; '));
});

test('валидатор ловит Code-ноду без кода', () => {
  const wf = validWorkflow();
  wf.nodes.push({ name: 'Empty', type: 'n8n-nodes-base.code', parameters: {} });
  assert.ok(errorsOf(wf).some((e) => e.includes('без кода')));
});

test('валидатор ловит require() внутри Code-ноды', () => {
  const wf = validWorkflow();
  wf.nodes.push({
    name: 'Bad',
    type: 'n8n-nodes-base.code',
    parameters: { jsCode: "const x = require('fs');" },
  });
  assert.ok(errorsOf(wf).some((e) => e.includes('require()')));
});

test('валидатор ловит поток без нод', () => {
  assert.ok(errorsOf({ name: 'Empty', nodes: [], connections: {} }).some((e) => e.includes('нет нод')));
});

test('respondToWebhook не считается вторым триггером', () => {
  const wf = validWorkflow();
  wf.nodes.push({ name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', parameters: {} });
  wf.connections.Do = { main: [[{ node: 'Respond', type: 'main', index: 0 }]] };
  const { errors, warnings } = validate(wf, 'test.json');
  assert.deepStrictEqual(errors, []);
  assert.ok(!warnings.some((w) => w.includes('триггеров больше одного')), warnings.join('; '));
});

test('висячая нода даёт предупреждение, но не ошибку', () => {
  const wf = validWorkflow();
  wf.nodes.push({ name: 'Orphan', type: 'n8n-nodes-base.noOp', parameters: {} });
  const { errors, warnings } = validate(wf, 'test.json');
  assert.deepStrictEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('не связана ни с чем')));
});

// ── итог ────────────────────────────────────────────────────────────────────

console.log(`\nтестов пройдено: ${passed}, провалено: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
