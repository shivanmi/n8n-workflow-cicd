#!/usr/bin/env node
// Доставка собранных потоков в n8n через public API.
//
// Поведение:
//   • поток с таким именем есть  → PUT (обновление)
//   • потока нет                 → POST (создание)
//   • активация НЕ выполняется   → см. README
//
// Требует переменные окружения N8N_URL и N8N_API_KEY.
// Без них команда завершается кодом 0 и сообщением — чтобы CI в форке
// без секретов оставался зелёным, а не падал.

const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DRY_RUN = process.argv.includes('--dry-run');

const ALLOWED_SETTINGS = require('./validate').ALLOWED_SETTINGS;

function pickBody(workflow) {
  // Public API принимает только эти четыре поля. Всё остальное — read-only,
  // и его присутствие в теле даёт 400.
  const settings = {};
  for (const [k, v] of Object.entries(workflow.settings || {})) {
    if (ALLOWED_SETTINGS.has(k)) settings[k] = v;
  }
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings,
  };
}

async function api(base, key, route, method = 'GET', body) {
  const res = await fetch(`${base.replace(/\/+$/, '')}/api/v1${route}`, {
    method,
    headers: {
      'X-N8N-API-KEY': key,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function findByName(base, key, name) {
  // Листинг постранично: у больших инстансов одной страницы не хватает.
  let cursor = null;
  do {
    const query = `/workflows?limit=100${cursor ? `&cursor=${cursor}` : ''}`;
    const page = await api(base, key, query);
    const hit = (page.data || []).find((w) => w.name === name);
    if (hit) return hit;
    cursor = page.nextCursor;
  } while (cursor);
  return null;
}

async function main() {
  const base = process.env.N8N_URL;
  const key = process.env.N8N_API_KEY;

  const files = fs.existsSync(DIST_DIR)
    ? fs.readdirSync(DIST_DIR).filter((f) => f.endsWith('.json'))
    : [];

  if (files.length === 0) {
    console.error('в dist/ нет собранных потоков — сначала npm run build');
    process.exit(1);
  }

  if (DRY_RUN || !base || !key) {
    const why = DRY_RUN ? '--dry-run' : 'не заданы N8N_URL / N8N_API_KEY';
    console.log(`деплой пропущен (${why}). Готово к отправке:`);
    for (const file of files) {
      const wf = JSON.parse(fs.readFileSync(path.join(DIST_DIR, file), 'utf8'));
      const body = pickBody(wf);
      console.log(
        `  • "${body.name}" — ${body.nodes.length} нод, ` +
        `settings: ${Object.keys(body.settings).join(', ') || 'пусто'}`
      );
    }
    return;
  }

  for (const file of files) {
    const workflow = JSON.parse(fs.readFileSync(path.join(DIST_DIR, file), 'utf8'));
    const body = pickBody(workflow);

    const existing = await findByName(base, key, body.name);

    if (existing) {
      await api(base, key, `/workflows/${existing.id}`, 'PUT', body);
      console.log(`обновлён "${body.name}" (id ${existing.id})`);
      if (existing.active) {
        console.log('  ⚠  поток активен — новая версия уже в проде');
      }
    } else {
      const created = await api(base, key, '/workflows', 'POST', body);
      console.log(`создан "${body.name}" (id ${created.id}) — не активирован`);
    }
  }
}

main().catch((err) => {
  console.error(`деплой не удался: ${err.message}`);
  process.exit(1);
});
