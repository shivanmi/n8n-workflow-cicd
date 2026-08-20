// Описание потока «Маршрутизация заявки».
//
// Здесь только структура: какие ноды, как связаны, какие параметры.
// Код Code-нод берётся из src/code/ и подставляется сборщиком —
// поэтому логику видно в диффе и можно тестировать отдельно от n8n.

const path = require('path');

const WEBHOOK_PATH = 'lead-router';

module.exports = {
  name: 'Lead Router (as code)',

  // Ноды. Позиции проставляются сборщиком, если не заданы явно.
  nodes: [
    {
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      parameters: {
        httpMethod: 'POST',
        path: WEBHOOK_PATH,
        responseMode: 'responseNode',
      },
    },
    {
      name: 'Normalize',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      // Файл с логикой + имя экспортируемой функции, которую надо вызвать.
      codeFile: path.join('src', 'code', 'normalize-lead.js'),
      entry: 'normalizeLead',
    },
    {
      name: 'Score',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      codeFile: path.join('src', 'code', 'score-lead.js'),
      // Возвращает score + priority одним вызовом: ветвление ниже
      // работает по готовому полю, а не пересчитывает границы в выражении.
      entry: 'scoreAndPrioritize',
      // Скорингу нужен вложенный объект visit, а не вся заявка целиком.
      entryArg: 'item.json.visit',
      // Результат домешивается к заявке, а не заменяет её.
      merge: true,
    },
    {
      name: 'Route by priority',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3,
      parameters: {
        rules: {
          values: [
            { outputKey: 'high', conditions: { conditions: [{ leftValue: '={{ $json.priority }}', rightValue: 'high', operator: { type: 'string', operation: 'equals' } }] } },
            { outputKey: 'medium', conditions: { conditions: [{ leftValue: '={{ $json.priority }}', rightValue: 'medium', operator: { type: 'string', operation: 'equals' } }] } },
            { outputKey: 'low', conditions: { conditions: [{ leftValue: '={{ $json.priority }}', rightValue: 'low', operator: { type: 'string', operation: 'equals' } }] } },
          ],
        },
        options: { fallbackOutput: 'extra' },
      },
    },
    { name: 'To sales queue', type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} },
    { name: 'To nurture', type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} },
    { name: 'To bot', type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} },
    { name: 'Unscored — manual review', type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} },
    {
      name: 'Respond',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1,
      parameters: { respondWith: 'json', responseBody: '={{ { ok: true, priority: $json.priority, score: $json.score } }}' },
    },
  ],

  // Связи: откуда → куда. Индекс выхода нужен только для ветвящихся нод.
  connections: [
    ['Webhook', 'Normalize'],
    ['Normalize', 'Score'],
    ['Score', 'Route by priority'],
    ['Route by priority', 'To sales queue', 0],
    ['Route by priority', 'To nurture', 1],
    ['Route by priority', 'To bot', 2],
    ['Route by priority', 'Unscored — manual review', 3],
    ['To sales queue', 'Respond'],
    ['To nurture', 'Respond'],
    ['To bot', 'Respond'],
    ['Unscored — manual review', 'Respond'],
  ],

  // Разрешённые ключи settings — см. README, раздел «Почему settings фильтруются».
  settings: {
    executionOrder: 'v1',
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'all',
  },
};
