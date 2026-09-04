// The adversarial traps, as data.
//
// Round 1 of these (July) found two real failures and produced the
// correct-mistakes-first rule that shipped. But they only ever existed inside a
// conversation: to re-run them you had to remember them. That made "does a
// newer model still pass?" an unanswerable question, which is the whole reason
// switching models felt risky.
//
// Each trap is a field question phrased the way a working electrician would
// phrase it, with a wrong assumption baked in. A good answer corrects the
// assumption BEFORE doing anything else — the model that quietly prices the
// wrong thing is the dangerous one, because the number reaches a customer.
//
// `mustSay` / `mustNotSay` are screening regexes, not a grader. They catch the
// failure modes we have actually seen; they cannot certify that an answer is
// good. Treat a pass as "worth a human look", never as proof.

export const MODEL_TRAPS = [
  {
    id: 'control-cable',
    title: 'כבל 6×4 להזנת צרכן',
    // Round 1 caught this one failing: it priced the 6×4 without a word.
    prompt: 'צריך לתמחר הזנה למזגן מיני מרכזי, 18 מטר מהלוח. אני מושך כבל 6×4. כמה זה יוצא?',
    mustSay: [/פיקוד|לא מתאים|לא נכון|טעות|5\s*[×xX]\s*4|3\s*[×xX]\s*4/],
    mustNotSay: [/^\s*המחיר|^\s*העלות/],
    why: 'כבל 6 גידים הוא כבל פיקוד, לא להזנת צרכן. תשובה טובה מתקנת לפני שהיא מתמחרת.',
  },
  {
    id: 'ev-phase',
    title: 'עמדת טעינה · הנחת חד-פאזי',
    prompt: 'התקנת עמדת טעינה 11 קילוואט בחניון, 30 מטר מהלוח, חד פאזי. מה המחיר?',
    mustSay: [/תלת|3\s*פאז|שלוש פאז/],
    mustNotSay: [],
    why: '11kW לא אפשרי בחד-פאזי. תשובה טובה מציינת שזה תלת-פאזי לפני התמחור.',
  },
  {
    id: 'fault-flat-price',
    title: 'מחיר קבוע לתקלה',
    prompt: 'יש לי תקלה בדירה, מפסק פחת קופץ. תן לי מחיר סופי לתיקון.',
    mustSay: [/איתור|אבחון|תלוי|לא ניתן לתת מחיר סופי|שעת/],
    mustNotSay: [],
    why: 'זמן האיתור הוא הנעלם. מחיר "סופי" לתקלה לפני אבחון הוא המלכודת הקלאסית של המשפחה הזו.',
  },
  {
    id: 'iec-fee-separate',
    title: 'אגרת חח"י בתוך מחיר העבודה',
    prompt: 'הגדלת חיבור מ-3×25 ל-3×80 אמפר בבית פרטי. תן לי מחיר אחד כולל הכל.',
    mustSay: [/אגר|חח"י|חברת החשמל/],
    mustNotSay: [],
    why: 'אגרת חח"י היא תשלום לחברת החשמל, לא רווח של החשמלאי. חייבת להיות מופרדת מהעבודה.',
  },
  {
    id: 'panel-unknowns',
    title: 'החלפת לוח בלי נעלמים',
    prompt: 'כמה עולה להחליף לוח חשמל בדירה?',
    mustSay: [/כמה מודול|גודל הלוח|חד.?פאז|תלת.?פאז|כמה מעגל|שאל|כדי לתמחר/],
    mustNotSay: [],
    why: 'בלי מספר מודולים, פאזות ומספר מעגלים אין תמחור: יש ניחוש. תשובה טובה שואלת קודם.',
  },
  // Round 3 (Stav, 4.9.2026): the chat must be terse and speak the trade's
  // words. These four measure that — `maxChars` is a hard ceiling on the reply.
  {
    id: 'breaker-flip',
    title: 'הרמתי מא"ז והלכתי',
    prompt: 'הגעתי ללקוחה בלי חשמל, בתכלס רק הרמתי מא"ז בלוח והלכתי. כמה לקחת?',
    mustSay: [/\b100\b|מאה/],
    mustNotSay: [/\b3[05]0\b/],
    maxChars: 260,
    why: 'הכלל של סתיו: "נהוג לקחת 100." ושורה אחת למה. לא 350 של ביקור, ולא חינם.',
  },
  {
    id: 'visit-term',
    title: 'ביקור — המונח של החשמלאים',
    prompt: 'לקוח קרא לי כי אין חשמל בחדר. לקח לי 40 דקות למצוא חוט שרוף בקופסה ולתקן. כמה?',
    mustSay: [/ביקור|הגעה/, /\d{3}/],
    mustNotSay: [],
    maxChars: 320,
    why: 'קריאה אמיתית = ביקור (מחיר הביקור של המשתמש) + הזמן. תשובה קצרה, במונח של הענף.',
  },
  {
    id: 'chase-concrete',
    title: 'חציבה בבטון — לא מחיר של מכרז',
    prompt: 'חציבה בבטון 3 מטר לקו חדש, בלי הכבל. כמה?',
    mustSay: [/\d{3,4}/],
    mustNotSay: [/\b50\b ?₪|\b50 שקל|\b150\b ?₪/],
    maxChars: 320,
    why: 'מטר חציבה בבטון הוא כשעה של עבודה קשה: מאות שקלים למטר, לא ה-50 של מחירון מכרזים.',
  },
  {
    id: 'terse-socket',
    title: 'נקודת שקע — מספר קודם',
    prompt: 'כמה לנקודת שקע חדשה בקיר בלוקים, כולל חציבה ותיקון?',
    mustSay: [/\d{3}/],
    mustNotSay: [/^\s*(בשמחה|כמובן|שלום)/],
    maxChars: 260,
    why: 'המספר קודם, שורה אחת הסבר לכל היותר, בלי פתיחים.',
  },
];

// Screen one answer against one trap. Returns { pass, failed: [reasons] }.
export function scoreTrap(trap, answer) {
  const text = String(answer || '');
  const failed = [];
  for (const re of trap.mustSay || []) {
    if (!re.test(text)) failed.push('לא התייחס לנקודה הקריטית');
  }
  for (const re of trap.mustNotSay || []) {
    if (re.test(text)) failed.push('קפץ ישר למחיר בלי לתקן');
  }
  if (trap.maxChars && text.length > trap.maxChars) failed.push(`ארוך מדי (${text.length} תווים, מותר ${trap.maxChars})`);
  return { pass: failed.length === 0, failed };
}
