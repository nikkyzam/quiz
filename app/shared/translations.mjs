/* Content translations (spec 8.4). Keyed by locale, then topic id, then the
   question's index in its bank. Only text is translated; answers, options'
   ORDER and figures come from the source bank so grading never changes.
   Where a translation is missing the English question is served and the
   response says so, rather than silently mixing languages. */

export const TRANSLATIONS = {
  es: {
    "k-count": [
      { q: "¿Qué número viene justo después del 7?", hint: "Cuenta a partir de 7.", expl: "Contando hacia arriba: 6, 7 y luego 8. Así que el 8 viene justo después del 7." },
      { q: "¿Qué número viene justo después del 15?", hint: "Cuenta a partir de 15.", expl: "Después del 15 viene el 16." },
      { q: "¿Qué número falta?  4, 5, __, 7", expl: "Contando 4, 5, 6, 7: el número que falta es el 6." },
      { q: "¿Cuánto es 10 y 1 más?", hint: "Cuenta uno más a partir de 10.", expl: "Uno más que 10 es 11." },
      { q: "¿Qué número falta?  17, 18, __, 20", expl: "Contando 17, 18, 19, 20: el número que falta es el 19." },
      { q: "¿Qué número viene justo después del 29?", hint: "Empieza una decena nueva.", expl: "Después del 29 empieza la siguiente decena, así que es el 30." },
      { q: "Ordena estos números del más pequeño al más grande.", expl: "Contando hacia arriba: 8, luego 12, luego 15, luego 20." },
      { q: "Empieza en 10 y cuenta 5 más. ¿Dónde llegas?", hint: "11, 12, 13...", expl: "10, luego 11, 12, 13, 14, 15. Llegas al 15." }
    ],
    "k-add10": [
      { q: "3 + 2 = ?", hint: "Levanta 3 dedos y luego 2 más.", expl: "3 y 2 más hacen 5." },
      { q: "4 + 4 = ?", expl: "4 y 4 más hacen 8. Este es un doble." },
      { q: "6 + 1 = ?", hint: "Uno más que 6.", expl: "Sumar 1 es contar uno más: 7." },
      { q: "5 + 3 = ?", expl: "Empieza en 5 y cuenta 3 más: 6, 7, 8." },
      { q: "¿Cuál suma 10?", expl: "7 + 3 = 10. Las otras dan 9, 9 y 12." },
      { q: "2 + 3 + 4 = ?", hint: "Suma dos de ellos primero.", expl: "2 + 3 = 5, y luego 5 + 4 = 9." },
      { q: "Selecciona TODAS las parejas que suman 8.", expl: "5 + 3, 4 + 4 y 2 + 6 suman 8. 6 + 1 suma 7." },
      { q: "Tengo 4 manzanas. Mi amiga me da algunas más y ahora tengo 9. ¿Cuántas me dio?", hint: "¿Qué le sumas a 4 para llegar a 9?", expl: "4 + 5 = 9, así que me dio 5 manzanas." }
    ]
  },
  ar: {
    "k-count": [
      { q: "ما العدد الذي يأتي مباشرة بعد 7؟", hint: "عُدّ ابتداءً من 7.", expl: "العدّ تصاعديًا: 6، 7، ثم 8. إذن 8 يأتي مباشرة بعد 7." },
      { q: "ما العدد الذي يأتي مباشرة بعد 15؟", hint: "عُدّ ابتداءً من 15.", expl: "بعد 15 يأتي 16." },
      { q: "ما العدد الناقص؟  4، 5، __، 7", expl: "العدّ 4، 5، 6، 7: العدد الناقص هو 6." },
      { q: "كم يساوي 10 وواحد زيادة؟", hint: "عُدّ واحدًا بعد 10.", expl: "واحد أكثر من 10 هو 11." },
      { q: "ما العدد الناقص؟  17، 18، __، 20", expl: "العدّ 17، 18، 19، 20: العدد الناقص هو 19." },
      { q: "ما العدد الذي يأتي مباشرة بعد 29؟", hint: "تبدأ عشرة جديدة.", expl: "بعد 29 تبدأ العشرة التالية، فهو 30." },
      { q: "رتّب هذه الأعداد من الأصغر إلى الأكبر.", expl: "بالعدّ تصاعديًا: 8 ثم 12 ثم 15 ثم 20." },
      { q: "ابدأ من 10 وعُدّ 5 زيادة. أين تصل؟", hint: "11، 12، 13...", expl: "10 ثم 11، 12، 13، 14، 15. تصل إلى 15." }
    ]
  }
};

/* Merge a translation onto a public question. Options are translated only
   if the translation supplies the same NUMBER of options, so an index still
   points at the same choice. */
export function translateQuestion(publicQ, locale, topicId, idx) {
  const tr = TRANSLATIONS[locale]?.[topicId]?.[idx];
  if (!tr) return { question: publicQ, translated: false };
  const out = { ...publicQ, q: tr.q, hint: tr.hint ?? publicQ.hint };
  if (tr.opts && publicQ.opts && tr.opts.length === publicQ.opts.length) out.opts = tr.opts;
  return { question: out, translated: true };
}
export function translatedExplanation(locale, topicId, idx, fallback) {
  return TRANSLATIONS[locale]?.[topicId]?.[idx]?.expl ?? fallback;
}
export const translatedTopics = locale => Object.keys(TRANSLATIONS[locale] || {});
