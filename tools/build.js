#!/usr/bin/env node
// Сборка JSON потоков из описаний в src/workflows/ и логики из src/code/.
//
// Идея: JSON — артефакт, а не источник правды. Правится код, пересобирается JSON.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOWS_DIR = path.join(ROOT, 'src', 'workflows');
const DIST_DIR = path.join(ROOT, 'dist');

const GRID_X = 260;
const GRID_Y = 160;

/**
 * Оборачивает модуль в код Code-ноды n8n.
 *
 * Code-нода не умеет require(), поэтому содержимое модуля встраивается целиком,
 * а строки module.exports вырезаются. Так один и тот же файл можно и тестировать
 * локально, и подставлять в поток.
 */
function wrapCodeNode(sourcePath, entry, entryArg, merge) {
  const source = fs.readFileSync(path.join(ROOT, sourcePath), 'utf8');

  const stripped = source
    .split('\n')
    .filter((line) => !/^\s*module\.exports\s*=/.test(line))
    .join('\n')
    .trimEnd();

  const arg = entryArg || 'item.json';
  const assignment = merge
    ? `item.json = { ...item.json, ...result };`
    : `item.json = result;`;

  return [
    `// ВНИМАНИЕ: этот код собран автоматически из ${sourcePath.replace(/\\/g, '/')}`,
    `// Не править здесь — правка будет затёрта следующей сборкой.`,
    ``,
    stripped,
    ``,
    `for (const item of $input.all()) {`,
    `  const result = ${entry}(${arg});`,
    `  ${assignment}`,
    `}`,
    ``,
    `return $input.all();`,
  ].join('\n');
}

/** Раскладывает ноды по сетке, если позиции не заданы явно. */
function layout(nodes, connections) {
  const depth = new Map();
  const incoming = new Map();

  for (const [from, to] of connections) {
    incoming.set(to, (incoming.get(to) || 0) + 1);
  }

  const roots = nodes.filter((n) => !incoming.has(n.name)).map((n) => n.name);
  const queue = [...roots];
  roots.forEach((r) => depth.set(r, 0));

  while (queue.length) {
    const current = queue.shift();
    for (const [from, to] of connections) {
      if (from !== current) continue;
      const next = (depth.get(current) || 0) + 1;
      if (!depth.has(to) || depth.get(to) < next) {
        depth.set(to, next);
        queue.push(to);
      }
    }
  }

  const perColumn = new Map();
  return nodes.map((node) => {
    if (node.position) return node;
    const column = depth.get(node.name) || 0;
    const row = perColumn.get(column) || 0;
    perColumn.set(column, row + 1);
    return { ...node, position: [column * GRID_X, row * GRID_Y] };
  });
}

/** Преобразует плоский список связей в формат connections n8n. */
function buildConnections(connections) {
  const out = {};
  for (const [from, to, outputIndex = 0] of connections) {
    out[from] = out[from] || { main: [] };
    while (out[from].main.length <= outputIndex) out[from].main.push([]);
    out[from].main[outputIndex].push({ node: to, type: 'main', index: 0 });
  }
  return out;
}

function buildWorkflow(spec) {
  const nodes = spec.nodes.map((node) => {
    const built = {
      name: node.name,
      type: node.type,
      typeVersion: node.typeVersion || 1,
      parameters: { ...(node.parameters || {}) },
    };

    if (node.codeFile) {
      built.parameters.jsCode = wrapCodeNode(
        node.codeFile,
        node.entry,
        node.entryArg,
        node.merge
      );
      built.parameters.mode = built.parameters.mode || 'runOnceForAllItems';
    }

    if (node.position) built.position = node.position;
    return built;
  });

  return {
    name: spec.name,
    nodes: layout(nodes, spec.connections),
    connections: buildConnections(spec.connections),
    settings: spec.settings || { executionOrder: 'v1' },
  };
}

function main() {
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

  const specs = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.js'));

  if (specs.length === 0) {
    console.error('Не найдено ни одного описания потока в src/workflows/');
    process.exit(1);
  }

  for (const file of specs) {
    const spec = require(path.join(WORKFLOWS_DIR, file));
    const workflow = buildWorkflow(spec);
    const outFile = path.join(DIST_DIR, file.replace(/\.js$/, '.json'));
    fs.writeFileSync(outFile, JSON.stringify(workflow, null, 2), 'utf8');
    console.log(
      `собран ${path.basename(outFile)} — ${workflow.nodes.length} нод, ` +
      `${Object.keys(workflow.connections).length} узлов связей`
    );
  }
}

if (require.main === module) main();
module.exports = { buildWorkflow, wrapCodeNode };
