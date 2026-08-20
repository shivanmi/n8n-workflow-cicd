#!/usr/bin/env node
// Проверки собранных потоков до деплоя.
//
// Ловит ровно те ошибки, которые в UI обнаруживаются только на проде:
// опечатку в имени ноды внутри связи, две ноды с одинаковым именем,
// поток без триггера, недостижимую ветку.

const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');

// respondToWebhook содержит «webhook» в названии, но триггером не является —
// исключаем явно, иначе любой поток с ответом вебхуку считается двухтриггерным.
const TRIGGER_PATTERN = /(trigger|webhook|cron)/i;
const NOT_TRIGGER = /respondToWebhook/i;
const isTrigger = (type) => TRIGGER_PATTERN.test(type) && !NOT_TRIGGER.test(type);

// Ключи settings, которые принимает public API n8n. Остальное даёт 400.
const ALLOWED_SETTINGS = new Set([
  'saveExecutionProgress',
  'saveManualExecutions',
  'saveDataErrorExecution',
  'saveDataSuccessExecution',
  'executionTimeout',
  'errorWorkflow',
  'timezone',
  'executionOrder',
  'callerPolicy',
]);

function validate(workflow, file) {
  const errors = [];
  const warnings = [];

  if (!workflow.name) errors.push('нет имени потока');
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    errors.push('нет нод');
    return { errors, warnings };
  }

  const names = new Set();
  for (const node of workflow.nodes) {
    if (!node.name) errors.push('нода без имени');
    if (!node.type) errors.push(`нода "${node.name}" без типа`);
    if (names.has(node.name)) errors.push(`дубль имени ноды: "${node.name}"`);
    names.add(node.name);

    if (node.type === 'n8n-nodes-base.code' && !node.parameters?.jsCode) {
      errors.push(`Code-нода "${node.name}" без кода`);
    }
    if (node.parameters?.jsCode?.includes('require(')) {
      errors.push(`Code-нода "${node.name}" содержит require() — в n8n он недоступен`);
    }
  }

  // Связи ссылаются только на существующие ноды.
  const referenced = new Set();
  for (const [from, outputs] of Object.entries(workflow.connections || {})) {
    if (!names.has(from)) errors.push(`связь из несуществующей ноды "${from}"`);
    referenced.add(from);
    for (const branch of outputs.main || []) {
      for (const link of branch || []) {
        if (!names.has(link.node)) {
          errors.push(`связь "${from}" → несуществующая нода "${link.node}"`);
        }
        referenced.add(link.node);
      }
    }
  }

  // Ровно один триггер.
  const triggers = workflow.nodes.filter((n) => isTrigger(n.type));
  if (triggers.length === 0) errors.push('нет ни одной триггер-ноды');
  if (triggers.length > 1) {
    warnings.push(`триггеров больше одного: ${triggers.map((t) => t.name).join(', ')}`);
  }

  // Висячие ноды: не участвуют ни в одной связи.
  for (const node of workflow.nodes) {
    if (!referenced.has(node.name) && !isTrigger(node.type)) {
      warnings.push(`нода "${node.name}" не связана ни с чем`);
    }
  }

  // settings по белому списку.
  for (const key of Object.keys(workflow.settings || {})) {
    if (!ALLOWED_SETTINGS.has(key)) {
      errors.push(`settings."${key}" не принимается public API — будет 400`);
    }
  }

  return { errors, warnings };
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('dist/ не найден — сначала npm run build');
    process.exit(1);
  }

  const files = fs.readdirSync(DIST_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('в dist/ нет собранных потоков');
    process.exit(1);
  }

  let failed = 0;

  for (const file of files) {
    const workflow = JSON.parse(fs.readFileSync(path.join(DIST_DIR, file), 'utf8'));
    const { errors, warnings } = validate(workflow, file);

    for (const w of warnings) console.log(`  ⚠  ${file}: ${w}`);
    for (const e of errors) console.error(`  ✗  ${file}: ${e}`);

    if (errors.length === 0) {
      console.log(`  ✓  ${file} — ${workflow.nodes.length} нод, проверки пройдены`);
    } else {
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\nвалидация не пройдена: потоков с ошибками — ${failed}`);
    process.exit(1);
  }
  console.log(`\nвалидация пройдена: потоков — ${files.length}`);
}

if (require.main === module) main();
module.exports = { validate, ALLOWED_SETTINGS };
