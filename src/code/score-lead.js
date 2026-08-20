// Скоринг заявки по поведению посетителя на сайте.
//
// Задача: в момент создания заявки оценить её перспективность, чтобы менеджер
// первым брал самые ценные. Оценка должна считаться за миллисекунды и не падать,
// если данных аналитики нет.
//
// Метод:
//   1. пять поведенческих метрик визита
//   2. логарифмическое сглаживание ln(1+x) — гасит выбросы: посетитель
//      с 200 просмотрами не должен получать в 100 раз больше веса, чем с двумя
//   3. нормализация каждой метрики к [0,1] по опорному максимуму
//   4. средневзвешенное и приведение к шкале 0–10
//
// Веса подбираются по корреляции метрики с фактической конверсией в оплату,
// а не назначаются на глаз. Значения ниже — иллюстративные.

const WEIGHTS = {
  visits: 0.25,
  pageviews: 0.20,
  duration_current: 0.25,
  duration_total: 0.20,
  depth: 0.10,
};

// Опорные максимумы: значение, выше которого метрика считается «максимальной».
// Берутся как перцентиль 95 по исторической выборке, чтобы выбросы не сжимали шкалу.
const REFERENCE_MAX = {
  visits: 12,
  pageviews: 40,
  duration_current: 900,   // секунд
  duration_total: 3600,    // секунд
  depth: 8,
};

const smooth = (x) => Math.log(1 + Math.max(0, x));

/**
 * @param {object} visit метрики визита
 * @returns {{score: number|null, reason: string}}
 */
function scoreLead(visit) {
  if (!visit || typeof visit !== 'object') {
    // Нет данных аналитики — заявка проходит БЕЗ скоринга, а не падает.
    // Это осознанное решение: потерять приоритет лучше, чем потерять заявку.
    return { score: null, reason: 'no_visit_data' };
  }

  const present = Object.keys(WEIGHTS).filter(
    (k) => Number.isFinite(Number(visit[k])) && Number(visit[k]) > 0
  );

  if (present.length === 0) {
    return { score: null, reason: 'all_metrics_empty' };
  }

  let weighted = 0;
  let weightSum = 0;

  for (const key of Object.keys(WEIGHTS)) {
    const value = Number(visit[key]) || 0;
    const normalized = Math.min(1, smooth(value) / smooth(REFERENCE_MAX[key]));
    weighted += normalized * WEIGHTS[key];
    weightSum += WEIGHTS[key];
  }

  const score = Math.round((weighted / weightSum) * 10 * 10) / 10;

  return {
    score,
    reason: present.length === Object.keys(WEIGHTS).length ? 'full' : 'partial',
  };
}

/**
 * Приоритет для CRM. Границы подбираются так, чтобы верхний сегмент
 * был обрабатываем силами отдела продаж, а не «половина всех заявок».
 */
function toPriority(score) {
  if (score === null) return 'unscored';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

/**
 * То, что вызывается из потока: считает скор и сразу приоритет,
 * чтобы ветвление ниже по потоку работало по одному готовому полю.
 */
function scoreAndPrioritize(visit) {
  const { score, reason } = scoreLead(visit);
  return { score, score_reason: reason, priority: toPriority(score) };
}

module.exports = { scoreLead, toPriority, scoreAndPrioritize, WEIGHTS, REFERENCE_MAX };
