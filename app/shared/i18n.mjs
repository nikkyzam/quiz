/* Localisation (spec 8.4, 10.8).

   Interface strings live here in every supported locale, keyed the same way,
   so a missing translation is a lint failure rather than an English string
   leaking into an Arabic screen. Locales carry their writing direction;
   the client sets `dir` on the document from it, and the stylesheet uses
   logical properties so right-to-left layout needs no second stylesheet.

   Numbers are formatted with Intl for the locale. Mathematical notation is
   rendered as MathML, which is language-neutral; the spoken form for
   read-aloud follows the locale's speech voice (see ReadAloud). */

export const LOCALES = {
  en: { name: "English", dir: "ltr", speech: "en-GB" },
  es: { name: "Español", dir: "ltr", speech: "es-ES" },
  ar: { name: "العربية", dir: "rtl", speech: "ar-SA" }
};
export const DEFAULT_LOCALE = "en";

export const STRINGS = {
  en: {
    "app.name": "Math Quest",
    "nav.progress": "Progress", "nav.switch": "Switch", "nav.signout": "Sign out", "nav.back": "Back",
    "nav.home": "Home", "nav.lessons": "Lessons", "nav.review": "Review", "nav.contest": "Contest Corner",
    "nav.puzzles": "Puzzles", "nav.proofs": "Proofs", "nav.games": "Games", "nav.story": "Story", "nav.settings": "Settings",
    "auth.signin": "Sign in", "auth.create": "Create account", "auth.email": "Email", "auth.password": "Password",
    "auth.name": "Your name", "auth.forgot": "Forgotten your password?", "auth.consent":
      "I am the parent or legal guardian of the children I will add, and I consent to their progress being stored in this account.",
    "learners.who": "Who's practising?", "learners.add": "Add a learner", "learners.name": "Name", "learners.monster": "Pick a monster",
    "grades.choose": "Choose a grade", "grades.range": "Kindergarten → Grade 8", "grades.topics": "topics", "grades.units": "units",
    "grades.ready": "ready", "grades.none": "no questions yet",
    "quiz.question": "Question", "quiz.score": "score", "quiz.check": "Check", "quiz.next": "Next", "quiz.results": "See results",
    "quiz.hint": "Need a hint?", "quiz.hintMore": "Another hint", "quiz.hintNone": "No more hints", "quiz.correct": "Correct!",
    "quiz.incorrect": "Not quite — the answer is", "quiz.yourAnswer": "Your answer", "quiz.leave": "Leave",
    "quiz.readAloud": "Read aloud", "quiz.stop": "Stop reading", "quiz.worth": "worth", "quiz.stars": "stars", "quiz.star": "star",
    "home.streak": "day streak", "home.dailyGoal": "Today's goal", "home.challenge": "Challenge of the day", "home.bonus": "bonus",
    "home.map": "Your map", "home.core": "Core", "home.advanced": "Advanced", "home.mastered": "mastered",
    "settings.language": "Language", "settings.theme": "Theme", "settings.motion": "Reduce motion",
    "help.title": "How this works", "help.hint": "Hints cost stars but never marks. Take one when you are stuck.",
    "help.mastery": "Mastery means scoring the pass mark on a check with no hints.",
    "onboarding.welcome": "Welcome!", "onboarding.step1": "Pick a grade and a topic.", "onboarding.step2": "Practise: the questions adapt to you.",
    "onboarding.step3": "Master a topic to earn stars and unlock more.", "onboarding.done": "Let's go",
    "offline.banner": "You are offline. Answers are saved and will be marked when you reconnect.",
    "offline.synced": "Offline work marked.", "offline.download": "Save this topic for offline",
    "common.loading": "Loading…", "common.error": "Something went wrong. Please try again.", "common.close": "Close"
  },
  es: {
    "app.name": "Math Quest",
    "nav.progress": "Progreso", "nav.switch": "Cambiar", "nav.signout": "Cerrar sesión", "nav.back": "Atrás",
    "nav.home": "Inicio", "nav.lessons": "Lecciones", "nav.review": "Repaso", "nav.contest": "Rincón de concursos",
    "nav.puzzles": "Acertijos", "nav.proofs": "Demostraciones", "nav.games": "Juegos", "nav.story": "Historia", "nav.settings": "Ajustes",
    "auth.signin": "Iniciar sesión", "auth.create": "Crear cuenta", "auth.email": "Correo", "auth.password": "Contraseña",
    "auth.name": "Tu nombre", "auth.forgot": "¿Olvidaste tu contraseña?", "auth.consent":
      "Soy el padre, madre o tutor legal de los niños que añadiré y consiento que su progreso se guarde en esta cuenta.",
    "learners.who": "¿Quién practica?", "learners.add": "Añadir estudiante", "learners.name": "Nombre", "learners.monster": "Elige un monstruo",
    "grades.choose": "Elige un curso", "grades.range": "Infantil → 8.º curso", "grades.topics": "temas", "grades.units": "unidades",
    "grades.ready": "listos", "grades.none": "todavía sin preguntas",
    "quiz.question": "Pregunta", "quiz.score": "puntos", "quiz.check": "Comprobar", "quiz.next": "Siguiente", "quiz.results": "Ver resultados",
    "quiz.hint": "¿Necesitas una pista?", "quiz.hintMore": "Otra pista", "quiz.hintNone": "No hay más pistas", "quiz.correct": "¡Correcto!",
    "quiz.incorrect": "Casi — la respuesta es", "quiz.yourAnswer": "Tu respuesta", "quiz.leave": "Salir",
    "quiz.readAloud": "Leer en voz alta", "quiz.stop": "Dejar de leer", "quiz.worth": "vale", "quiz.stars": "estrellas", "quiz.star": "estrella",
    "home.streak": "días seguidos", "home.dailyGoal": "Meta de hoy", "home.challenge": "Reto del día", "home.bonus": "extra",
    "home.map": "Tu mapa", "home.core": "Básico", "home.advanced": "Avanzado", "home.mastered": "dominados",
    "settings.language": "Idioma", "settings.theme": "Tema", "settings.motion": "Reducir animaciones",
    "help.title": "Cómo funciona", "help.hint": "Las pistas cuestan estrellas, nunca puntos. Usa una si te atascas.",
    "help.mastery": "Dominar un tema es alcanzar la nota de corte en una prueba sin pistas.",
    "onboarding.welcome": "¡Bienvenido!", "onboarding.step1": "Elige un curso y un tema.", "onboarding.step2": "Practica: las preguntas se adaptan a ti.",
    "onboarding.step3": "Domina un tema para ganar estrellas y desbloquear más.", "onboarding.done": "¡Vamos!",
    "offline.banner": "Estás sin conexión. Tus respuestas se guardan y se corregirán al reconectar.",
    "offline.synced": "Trabajo sin conexión corregido.", "offline.download": "Guardar este tema sin conexión",
    "common.loading": "Cargando…", "common.error": "Algo salió mal. Inténtalo de nuevo.", "common.close": "Cerrar"
  },
  ar: {
    "app.name": "Math Quest",
    "nav.progress": "التقدم", "nav.switch": "تبديل", "nav.signout": "تسجيل الخروج", "nav.back": "رجوع",
    "nav.home": "الرئيسية", "nav.lessons": "الدروس", "nav.review": "مراجعة", "nav.contest": "ركن المسابقات",
    "nav.puzzles": "ألغاز", "nav.proofs": "براهين", "nav.games": "ألعاب", "nav.story": "القصة", "nav.settings": "الإعدادات",
    "auth.signin": "تسجيل الدخول", "auth.create": "إنشاء حساب", "auth.email": "البريد الإلكتروني", "auth.password": "كلمة المرور",
    "auth.name": "اسمك", "auth.forgot": "هل نسيت كلمة المرور؟", "auth.consent":
      "أنا الوالد أو الوصي القانوني للأطفال الذين سأضيفهم، وأوافق على حفظ تقدمهم في هذا الحساب.",
    "learners.who": "من يتدرب؟", "learners.add": "إضافة متعلم", "learners.name": "الاسم", "learners.monster": "اختر وحشًا",
    "grades.choose": "اختر الصف", "grades.range": "الروضة ← الصف الثامن", "grades.topics": "مواضيع", "grades.units": "وحدات",
    "grades.ready": "جاهز", "grades.none": "لا توجد أسئلة بعد",
    "quiz.question": "سؤال", "quiz.score": "النقاط", "quiz.check": "تحقق", "quiz.next": "التالي", "quiz.results": "عرض النتائج",
    "quiz.hint": "تحتاج تلميحًا؟", "quiz.hintMore": "تلميح آخر", "quiz.hintNone": "لا مزيد من التلميحات", "quiz.correct": "صحيح!",
    "quiz.incorrect": "ليس تمامًا — الجواب هو", "quiz.yourAnswer": "إجابتك", "quiz.leave": "خروج",
    "quiz.readAloud": "قراءة بصوت عالٍ", "quiz.stop": "إيقاف القراءة", "quiz.worth": "تساوي", "quiz.stars": "نجوم", "quiz.star": "نجمة",
    "home.streak": "أيام متتالية", "home.dailyGoal": "هدف اليوم", "home.challenge": "تحدي اليوم", "home.bonus": "مكافأة",
    "home.map": "خريطتك", "home.core": "أساسي", "home.advanced": "متقدم", "home.mastered": "متقن",
    "settings.language": "اللغة", "settings.theme": "المظهر", "settings.motion": "تقليل الحركة",
    "help.title": "كيف يعمل هذا", "help.hint": "التلميحات تكلف نجومًا لا درجات. خذ واحدًا عندما تتعثر.",
    "help.mastery": "الإتقان يعني تحقيق درجة النجاح في اختبار دون تلميحات.",
    "onboarding.welcome": "أهلًا بك!", "onboarding.step1": "اختر صفًا وموضوعًا.", "onboarding.step2": "تدرب: الأسئلة تتكيف معك.",
    "onboarding.step3": "أتقن موضوعًا لتكسب نجومًا وتفتح المزيد.", "onboarding.done": "هيا بنا",
    "offline.banner": "أنت غير متصل. تُحفظ إجاباتك وتُصحح عند إعادة الاتصال.",
    "offline.synced": "تم تصحيح العمل دون اتصال.", "offline.download": "حفظ هذا الموضوع للعمل دون اتصال",
    "common.loading": "جارٍ التحميل…", "common.error": "حدث خطأ ما. حاول مرة أخرى.", "common.close": "إغلاق"
  }
};

export function t(locale, key, vars = {}) {
  const table = STRINGS[locale] || STRINGS[DEFAULT_LOCALE];
  let s = table[key] ?? STRINGS[DEFAULT_LOCALE][key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  return s;
}

export const dirOf = locale => (LOCALES[locale] || LOCALES[DEFAULT_LOCALE]).dir;
export const speechOf = locale => (LOCALES[locale] || LOCALES[DEFAULT_LOCALE]).speech;

/* Numbers follow the locale; the maths itself does not change. */
export function formatNumber(locale, n) {
  try { return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : locale).format(n); } catch { return String(n); }
}

/* Every locale must carry every key; the lint enforces it. */
export function missingKeys(locale) {
  const base = Object.keys(STRINGS[DEFAULT_LOCALE]);
  return base.filter(k => !(k in (STRINGS[locale] || {})));
}
