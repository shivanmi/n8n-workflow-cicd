// Нормализация входящей заявки.
//
// Данные приходят из разных источников (форма на сайте, чат-бот, рекламный кабинет)
// и приходят грязными: пробелы в ключах, разные написания одного значения,
// опечатки в названиях полей. Нормализация идёт ДО валидации — иначе фильтр
// отбраковывает записи, которые на самом деле валидны.

const STUDY_FORM_CANON = {
  'очная': 'Очная',
  'очно': 'Очная',
  'day': 'Очная',
  'заочная': 'Заочная',
  'заочно': 'Заочная',
  'очно-заочная': 'Очно-заочная',
  'очно заочная': 'Очно-заочная',
  'вечерняя': 'Очно-заочная',
  'дистанционная': 'Дистанционная',
  'дистант': 'Дистанционная',
  'online': 'Дистанционная',
};

// Опечатки в ключах, которые исторически шлют источники.
const KEY_ALIASES = {
  'kod': 'code',
  'сode': 'code',      // латинская c в начале
  'phone_number': 'phone',
  'tel': 'phone',
  'e-mail': 'email',
  'mail': 'email',
};

function deepTrim(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(deepTrim);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const key = KEY_ALIASES[k.trim().toLowerCase()] || k.trim();
      out[key] = deepTrim(v);
    }
    return out;
  }
  return value;
}

function canonUrl(raw) {
  if (!raw) return null;
  return String(raw)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function canonPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  // 8XXXXXXXXXX и 7XXXXXXXXXX приводим к одному виду
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
    return '7' + digits.slice(1);
  }
  return digits;
}

function canonStudyForm(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  return STUDY_FORM_CANON[key] || null;
}

/**
 * @param {object} input сырой объект заявки
 * @returns {object} нормализованная заявка
 */
function normalizeLead(input) {
  // Вебхук оборачивает данные в body, ручной запуск отдаёт их на верхнем уровне.
  const raw = input && input.body ? input.body : input;
  const t = deepTrim(raw || {});

  return {
    name: t.name || null,
    phone: canonPhone(t.phone),
    email: t.email ? String(t.email).toLowerCase() : null,
    source: canonUrl(t.source),
    study_form: canonStudyForm(t.study_form),
    city: t.city || null,
    visit: {
      visits: Number(t.visits) || 0,
      pageviews: Number(t.pageviews) || 0,
      duration_current: Number(t.duration_current) || 0,
      duration_total: Number(t.duration_total) || 0,
      depth: Number(t.depth) || 0,
    },
  };
}

module.exports = { normalizeLead, canonPhone, canonUrl, canonStudyForm };
