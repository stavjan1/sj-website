# Every everyday row gets a decided price. Not a blanket multiplier — a price
# built the way an electrician builds one: OUR hours at OUR rate, plus the
# materials, where Dekel tells us what the materials cost (Dekel's price is
# contractor labour + materials; the material share differs by family).
#
# Decisions (mine — Stav overrides by saying "X, not Y"):
#   rate 300 ₪/h certified · materials = Dekel × share × 1.15 (small purchase)
#   visit minimum 450 ₪ — once per visit, never per item
#   chases per metre: block 700 / concrete 1,000 for metres 1–2, then 280 / 400
import json, io, os, re
os.chdir(r"C:/Users/stavj/Desktop/הנדסת SJ חשמל/Skills/אתרי אינטרנט/sj-website")
cat = json.load(io.open('data/dekel/helper_catalog.json', encoding='utf-8'))

RATE = 300            # loaded rate behind every ITEM price (a "מוצר מדף" number)
PREMIUM = 1.15
VISIT = 350           # "הגעה" — one line per quote, never inside an item (the group's structure)
HOURLY = 250          # the hourly MODE: fault-finding / open-ended work only — הגעה 350 + 250 ₪/h
VISIT_MIN = VISIT
CHASE = {'block': (700, 280), 'conc': (1000, 400)}
INDEX = 1.18
RAYSDOR = {'08.017.0010': 134.28, '08.018.0010': 146.57, '08.019.0100': 217.49, '08.021.0010': 0.95, '08.021.0020': 0.95,
           '08.031.0170': 24.59, '08.031.0230': 54.84, '08.071.0200': 28.37, '08.072.0010': 32.15, '08.062.0060': 42.55,
           '08.062.0230': 149.40, '08.081.0840': 79.43, '08.040.0050': 79.43}

def has(d, *words): return any(w in d for w in words)
def num(pattern, d, default=None):
    m = re.search(pattern, d); return float(m.group(1)) if m else default

# ---- the rule per row: returns (hours, material_share, tag, why) or ('chase', kind) or ('pass',) or ('tender',) ----
def rule(code, d, unit, sub, dk=None):
    tosefet = d.startswith('תוספת')
    renov = code.startswith('08.') and code.split('.')[-1].startswith('9')

    # --- a small part is a part, not a job: a cover, a clamp, a bulb, a rope, a
    # sign. Its labour sits inside the item it belongs to; it gets a retail
    # markup and nothing else. (This is what turned a 5 ₪ cover into 79 ₪.) ---
    WORK_WORDS = ('נקודת', 'נקודה', 'חציבה', 'קידוח', 'התקנה', 'ניתוק', 'פירוק', 'שיפוץ', 'העתקת', 'החלפת', 'בדיקת', 'תליה', 'השחלה', 'חיבור')
    if 'חודש' in unit or has(d, 'עלות חודשית', 'ייעוץ קרינה'): return ('pass', 'דמי שירות / ייעוץ — כמו שהם')
    # an accessory is put in — a job, small as it is. 08.073 (glands, covers,
    # blanks, boxes) is a bag of parts and stays under the small-part guard.
    INSTALLED = ('08.017', '08.018', '08.019', '08.071', '08.072', '08.074', '08.081')
    if dk is not None and (dk <= 70 or unit in ('ק"ג', 'קג')) and unit in ("יח'", "מ'", 'יח', 'קומפ', 'ק"ג', 'קג') and not has(d, *WORK_WORDS) and sub not in INSTALLED:
        return ('part', 'חלק קטן — קנייה + 25%, העבודה בתוך הפריט שהוא שייך לו')

    # --- renovation / dismantling (9xxx) ---
    if renov:
        # contractor-scale dismantling (a panel by the m², a pole crown, a Bezeq
        # manhole) and rentals are not small-job labour: Dekel's own price, ×1.1
        if unit in ('מ"ר',) or (dk is not None and dk >= 800) or has(d, 'השאלה', 'עמוד תאורה', 'עמוד ', 'תא בקרה', 'מרכזיית תאורה', 'קרח יבש', 'אמצעי הרמה'):
            return ('tender', 'פירוק/השאלה בהיקף קבלני או בגובה — דקל ×1.1')
        if has(d, 'פירוק אביזר לוח'):
            a = num(r'עד (\d+) אמפר', d, 60)
            return (0.4 + 0.25 * (a // 100), 0, 'work', f'פירוק רכיב לוח עד {int(a)}A: ניתוק, פירוק, סימון')
        if has(d, 'ניתוק וביטול', 'ניתוק ופירוק', 'פירוק וניתוק'):
            if has(d, 'לוח'): return (1.0 if has(d, 'עד 16') else 1.6 if has(d, 'עד 36') else 2.4, 0, 'work', 'פירוק לוח דירתי: ניתוק, סימון קווים, פירוק')
            if has(d, 'עמוד'): return (3.0, 0, 'work', 'פירוק עמוד — צוות + מנוף קטן')
            if has(d, 'עמדת עבודה'): return (0.6, 0, 'work', 'ניתוק עמדת עבודה: חשמל + תקשורת')
            return (0.3, 0, 'work', 'ניתוק וביטול נקודה: ניתוק בלוח, פירוק אביזר, סגירה')
        if has(d, 'העתקת'): return (0.8, 0.2, 'work', 'העתקה עד 2 מ׳ — העבודה בלי החציבה (חציבה נמדדת בנפרד)')
        if has(d, 'שיפוץ נקודת דוד', 'שיפוץ נקודת דוד'): return (0.9, 0.35, 'work', 'שיפוץ נקודת דוד: כבל ומפסק')
        if has(d, 'שיפוץ נקודת'): return (0.6, 0.3, 'work', 'שיפוץ נקודה: אביזר, מוליכים, בדיקת הארקה')
        if has(d, 'החלפת בית מנורה'): return (0.25, 0.5, 'work', 'החלפת בית מנורה')
        if has(d, 'פירוק מפסק', 'פירוק בית תקע', 'פירוק אביזר'): return (0.15, 0, 'work', 'פירוק אביזר קצה')
        if has(d, 'פירוק גוף', 'פירוק ג.ת'): return (0.3, 0, 'work', 'פירוק גוף תאורה')
        if unit in ("מ'", 'מ"ר') and has(d, 'פירוק'): return (0.08 if has(d, 'צנרת', 'צינור', 'כבל') else 0.12, 0, 'work', 'פירוק לפי מטר: ~5–7 דק׳ למטר')
        if has(d, 'פירוק מתקן חשמל דירתי'): return (4.0, 0, 'work', 'פירוק מתקן דירתי שלם')
        if has(d, 'פירוק') and has(d, 'תקע', 'ספוט', 'אביזר', 'מפסק', 'נורה', 'בית מנורה'): return (0.15, 0, 'work', 'פירוק פריט קטן')
        if has(d, 'פירוק') and has(d, 'ממסר', 'מא"ז', 'מגען'): return (0.3, 0, 'work', 'פירוק רכיב מהלוח')
        if has(d, 'פירוק'): return (0.5, 0, 'work', 'פירוק פריט')
        if has(d, 'גשר'): return (0.6, 0.3, 'work', 'גשר הארקה')
        return (0.5, 0.2, 'work', 'שיפוץ/החלפה — הערכה')

    # --- points ---
    if sub in ('08.017', '08.018', '08.019'):
        if tosefet:
            return (0.3 if not has(d, 'מגען') else 0.4, 0.4, 'work', 'תוספת לנקודה: עוד מוליכים/אביזר — ~20 דק׳ + חומר')
        if has(d, 'תליה בלבד של מסך'): return (1.0 if 'בטון' in d or 'בלוקים' in d else 0.7, 0.05, 'work', 'תליית מסך')
        if has(d, 'השחלה בלבד'): return (0.6, 0.05, 'work', 'השחלה בצנרת קיימת')
        if has(d, 'עמדת עבודה'): return (1.5, 0.5, 'work', 'עמדת עבודה: נקודה + מודול רב-שקעים')
        if has(d, 'הכנה למערכת מתח נמוך', 'הכנה'): return (0.6, 0.25, 'work', 'הכנה: צינור + קופסה + חוט משיכה')
        h = 0.9; why = 'נקודה במנה: ~55 דק׳'
        if has(d, 'מזגן'): h = 1.5; why = 'מזגן: קו נפרד, מנתק/שקע, מרחק'
        # "דוד" as a word — "בידוד" is in every point description and is not a boiler
        if re.search(r'(^|[\s(])(ל)?דוד(\s|$)', d): h = 1.2; why = 'דוד: קו נפרד, מפסק דו-קוטבי עם נורית'
        if has(d, 'סולארי'): h += 0.3; why += ', סולארי על הגג'
        if has(d, 'תנור'): h = 1.2; why = 'תנור אמבטיה: כמו דוד'
        if has(d, 'תלת'): h += 0.4; why += ', תלת-פאזי'
        if has(d, 'דירתית'): h += 0.2; why += ', דירתית'
        if has(d, 'מגען'): h += 0.4; why += ', מגען'
        if has(d, 'השהיה'): h += 0.2
        if has(d, 'בית חכם'): h += 0.3; why += ', בית חכם'
        return (h, 0.35, 'work', why)

    # --- chases, drilling, openings ---
    if sub == '08.026':
        if has(d, 'חציבה בקירות בלוקים') and unit == "מ'": return ('chase', 'block')
        if has(d, 'חציבה בקירות בטון') and unit == "מ'": return ('chase', 'conc')
        if has(d, 'קידוח מעבר'):
            dia = num(r'בקוטר "?(\d+)', d, 2); conc = 'בטון' in d
            h = (0.7 if not conc else 1.2) * (1 + 0.35 * max(dia - 2, 0)); return (h, 0.1, 'work', f'קידוח מעבר {"בטון" if conc else "בלוק"} {int(dia)}" — כוס יהלום')
        if has(d, 'חציבה בקיר או ברצפת בטון'): return (1.5, 0.1, 'work', 'חציבת פתח בבטון למעבר כבלים')
        if has(d, 'חציבת פתח', 'פתח'): return (1.2, 0.1, 'work', 'חציבת פתח')
        return (1.0, 0.1, 'work', 'חציבה/שונות — הערכה')
    if sub in ('24.021', '24.022', '24.032', '08.044'): return ('tender', 'קידוחים/פתחים/איטום בהיקף קבלני — דקל ×1.3')

    # --- accessories (install on an existing point + the item) ---
    if sub in ('08.071', '08.072', '08.073', '08.074'):
        if tosefet: return (0.1, 0.6, 'work', 'תוספת לאביזר')
        h = 0.25
        if has(d, 'IP', 'משוריין', '67'): h = 0.4
        if has(d, 'עמדת', 'רב בתי תקע'): h = 0.6
        if has(d, 'תלת', 'CEE', '3X', '5X'): h = 0.4
        if has(d, 'בית חכם', 'KNX', 'DALI'): h = 0.5
        return (h, 0.6, 'work', 'אביזר קצה: ~15 דק׳ התקנה + האביזר')

    # --- panels: enclosures and components ---
    if sub == '08.061':
        if has(d, 'התקנה מכאנית וחיבור'): return (2.5 if has(d, 'עד 36') else 3.5, 0.1, 'work', 'התקנה וחיבור לוח דירתי — בלי הרכיבים')
        if has(d, 'לוח דירתי'): return (0.5, 0.8, 'work', 'מבנה לוח דירתי: החומר + הרכבה על הקיר')
        return ('tender', 'מבנה לוח תעשייתי — דקל ×1.3')
    if sub in ('08.062', '08.063', '08.064', '08.065', '08.066', '08.067', '08.068', '08.069', '08.060'):
        if tosefet: return (0.15, 0.7, 'work', 'תוספת לרכיב')
        h = 0.25; why = 'מא״ז/רכיב: הרכבה על פס דין + חיווט'
        if sub in ('08.063', '08.064'): h = 0.6; why = 'מאמ״ת: מקום בלוח, פסים, חיווט'
        if sub == '08.065': h = 0.4; why = 'מפסק זרם: הרכבה + חיווט'
        if sub in ('08.066', '08.067'): h = 0.4; why = 'ממסר/מגען/מתנע: חיווט פיקוד'
        if sub == '08.069': h = 0.5; why = 'פיקוד/מדידה: חיווט וכיול'
        if has(d, '3X', 'תלת'): h += 0.1
        a = num(r'(\d+)\s*A', d) or num(r'X(\d+)', d)
        if a and a >= 100: h += 0.3
        return (h, 0.75, 'work', why)

    # --- earthing and tests ---
    if sub == '08.040':
        if has(d, 'בדיקה', 'בדיקת'): return ('pass', 'תעריף בודק')
        if unit == 'מ"ר' or has(d, 'הארקות יסוד של מבנה'): return ('tender', 'הארקת יסוד של מבנה — עבודת קבלן, דקל ×1.2')
        if unit == "מ'": return (0.15, 0.6, 'work', 'פס הארקה למטר: הנחה וריתוך/חיבור')
        if has(d, 'נקודת הארקה'): return (0.7, 0.3, 'work', 'נקודת הארקה לאלמנט מתכתי')
        if has(d, 'גשר'): return (0.6, 0.3, 'work', 'גשר הארקה על מונה מים')
        if has(d, 'אלקטרודה'): return (2.5, 0.5, 'work', 'אלקטרודה: חפירה/קידוח, שוחה')
        if has(d, 'פס השוואת'): return (0.8, 0.5, 'work', 'פס השוואת פוטנציאלים')
        return (0.6, 0.4, 'work', 'הארקה — הערכה')
    if sub == '08.043': return ('pass', 'תעריף בודק / חברת חשמל — לא שלנו')

    # --- conduits, trays, ladders (per metre) ---
    if sub in ('08.021', '08.022'):
        if unit != "מ'": return (0.2, 0.6, 'work', 'אביזר צנרת')
        dia = num(r'קוטר (\d+)', d, 20)
        h = 0.05 if dia <= 25 else 0.09 if dia <= 50 else 0.15   # 3 / 5 / 9 minutes a metre, laid in runs
        if has(d, 'מתכת', 'מגולוון', 'ממתכת') or sub == '08.022': h *= 1.5
        return (h, 0.7, 'work', f'צינור {int(dia)} מ״מ למטר: ~{int(h*60)} דק׳ + חומר')
    if sub in ('08.023', '08.024'):
        if unit != "מ'": return (0.25, 0.7, 'work', 'אביזר תעלה/סולם')
        return (0.25 if sub == '08.023' else 0.35, 0.7, 'work', 'תעלה/סולם למטר: תליה + חיבור')

    # --- cables (per metre) ---
    if sub.startswith('08.03') and sub != '08.036':
        if unit != "מ'": return (0.4, 0.6, 'work', 'סיומת/אביזר כבל')
        sec = num(r'X\s?(\d+(?:\.\d+)?)', d.replace('x', 'X'), 2.5)
        h = 0.04 if sec <= 6 else 0.07 if sec <= 35 else 0.12
        return (h, 0.75, 'work', f'השחלה/הנחה למטר, חתך {sec:g}')
    if sub == '08.036': return (0.8, 0.6, 'work', 'מופה/מפצל')

    # --- lighting fixtures (supply + install) and install-only ---
    if sub == '08.081':
        h = 0.5
        if has(d, 'ספוט'): h = 0.35
        if has(d, 'גבס'): h -= 0.1
        if has(d, 'אקוסטית', 'פריקה'): h += 0.05
        if has(d, 'High Bay', 'תעשייתי'): h = 1.0
        if has(d, 'דרייבר'): h = 0.3
        if has(d, 'מכסה'): h = 0.4
        if unit == "מ'": h = 0.4
        if has(d, 'פסי לדים', 'הדבקה'): h = 0.1
        if has(d, 'עמוד תאורה', 'עמוד ') and not has(d, 'מכסה'): return ('tender', 'עבודה על עמוד — דקל ×1.2')
        return (max(h, 0.1), 0, 'work', 'התקנה בלבד — הגוף של הלקוח')
    if sub in ('08.083', '08.084', '08.085'):
        h = 0.5
        if has(d, 'ספוט'): h = 0.35
        if has(d, 'חירום', 'חרום'): h = 0.6
        if has(d, 'פס צבירה'): h = 0.3
        if unit == "מ'": h = 0.4
        return (h, 0.85, 'work', 'גוף תאורה: החומר + התקנה')
    if sub in ('08.086', '08.087', '08.056', '08.051', '08.052', '08.053', '08.054', '08.055', '08.057', '08.059'):
        return ('tender', 'תאורת חוץ/עמודים — עבודת קבלן, דקל ×1.2')
    if sub in ('08.050', '08.048', '08.046', '08.076', '08.077', '08.088'):
        if sub == '08.050': return (4.0, 0.8, 'work', 'עמדת טעינה: קו, הגנות, התקנה, הפעלה')
        if sub == '08.048': return (1.0, 0.9, 'work', 'UPS: התקנה וחיבור')
        return (0.8, 0.8, 'work', 'חימום/בית חכם: החומר + התקנה')
    return ('tender', 'תשתית/תקשורת/גילוי אש/בקרה/שונות — דקל ×1.2, עולם המכרז')

def rnd(x):
    if x is None: return None
    if x >= 1000: return int(round(x / 10.0) * 10)
    if x >= 100: return int(round(x / 5.0) * 5)
    if x >= 20: return int(round(x))
    return round(x, 1)

rows = []; stats = {'work': 0, 'chase': 0, 'pass': 0, 'tender': 0}
for g in cat['groups']:
    for s in g['subs']:
        for it in s['items']:
            code, d, unit = it['code'], it['desc'], it['unit']
            sp = it['dekel']['shipuz']; dk = (sp[0] if sp else None) or it['dekel']['bniya']
            r = rule(code, d, unit, s['code'], dk)
            row = {'code': code, 'group': g['name'], 'sub': s['name'], 'name': it['name'], 'unit': unit,
                   'dekel': dk, 'raysdor_2026': (round(RAYSDOR[code] * INDEX, 1) if code in RAYSDOR else None)}
            if r[0] == 'part':
                row.update(basis='part', sj=rnd(dk * 1.25) if dk else None, why=r[1]); stats['part'] = stats.get('part', 0) + 1
            elif r[0] == 'pass' and 'שירות' in r[1]:
                row.update(basis='pass', sj=rnd(dk) if dk else None, why=r[1]); stats['pass'] += 1
            elif r[0] == 'chase':
                first, nxt = CHASE[r[1]]
                row.update(basis='chase', sj=first, sj_next_m=nxt, why=f'מטר 1–2 {first}, מהמטר השלישי {nxt} — {"בלוק" if r[1]=="block" else "בטון"}')
                stats['chase'] += 1
            elif r[0] == 'pass':
                row.update(basis='pass', sj=rnd(dk), why=r[1]); stats['pass'] += 1
            elif r[0] == 'tender':
                mult = 1.3 if '1.3' in r[1] else 1.1 if '1.1' in r[1] else 1.2
                row.update(basis='tender', sj=rnd(dk * mult) if dk else None, why=r[1]); stats['tender'] += 1
            else:
                h, share, _, why = r
                mat = (dk or 0) * share * PREMIUM
                row.update(basis='work', hours=round(h, 2), materials=rnd(mat), sj=rnd(h * RATE + mat), why=why)
                stats['work'] += 1
            # A: what a customer reads as an item — points, relocations, chases, installs, dismantles.
            # B: material that carries its install — cables/m, conduit/m, panel parts, fixtures, small parts.
            item_subs = ('08.017', '08.018', '08.019', '08.026', '08.081', '08.043', '08.040', '24.021', '24.022', '24.032')
            row['mode'] = 'A' if (row['basis'] in ('chase', 'pass') or s['code'] in item_subs or (code.startswith('08.') and code.split('.')[-1].startswith('9')) or 'התקנה' in d[:12]) else 'B'
            rows.append(row)

# the everyday call the book has no row for: REPLACING a breaker / switch (not just removing it)
extra = []
for r in rows:
    if r['sub'] in ('מא"זים אופיין C ו- K', 'מפסקי זרם') and r['basis'] == 'work' and not r['name'].startswith('תוספת') and r['dekel']:
        mat = r['dekel'] * 0.75 * PREMIUM
        extra.append({'code': r['code'] + '.R', 'group': 'שיפוץ והחלפה', 'sub': 'החלפת רכיב בלוח', 'name': 'החלפת ' + r['name'][:70], 'unit': r['unit'],
                      'dekel': None, 'raysdor_2026': None, 'basis': 'work', 'hours': 0.3, 'materials': rnd(mat), 'sj': rnd(0.3 * RATE + mat), 'mode': 'A',
                      'why': 'החלפה: ניתוק, פירוק הישן, הרכבת החדש, בדיקה — ~20 דק׳ + הרכיב'})
rows.extend(extra)

json.dump({'decisions': {'rate': RATE, 'material_premium': PREMIUM, 'visit': VISIT, 'hourly_mode': {'visit': VISIT, 'rate': HOURLY, 'when': 'איתור תקלות / עבודה פתוחה בלבד'}, 'chase': CHASE, 'index_2022_2026': INDEX},
           'rows': rows}, io.open('data/dekel/prices_sj_proposed.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# ---- summary ----
by = {r['code']: r for r in rows}
md = io.open('data/dekel/prices_sj_summary.md', 'w', encoding='utf-8')
md.write('# מחירון SJ — כל סעיפי היומיום, מחיר שנקבע\n\n')
md.write('כל שורה נבנתה כמו שחשמלאי בונה מחיר: **השעות שלנו × %d ₪ + החומר** (דקל אומר כמה עולה החומר — חלקו במחיר דקל שונה לכל משפחה — ועוד 15%% קנייה קטנה). **מינימום ביקור %d ₪ — פעם אחת לביקור, לא לכל פריט.**\n\n' % (RATE, VISIT_MIN))
md.write('| בסיס | סעיפים | מה זה |\n|---|---|---|\n')
md.write('| עבודה (שעות + חומר) | %d | נקודות, שיפוץ, קידוחים, אביזרים, רכיבי לוח, הארקות, צנרת, כבלים, גופים, טעינה |\n' % stats['work'])
md.write('| חציבה מדורגת | %d | בלוק %d/%d · בטון %d/%d למטר (מטר 1–2 / מהשלישי) |\n' % (stats['chase'], *CHASE['block'], *CHASE['conc']))
md.write('| תעריף צד שלישי | %d | בודק, חברת חשמל |\n' % stats['pass'])
md.write('| עולם המכרז (דקל ×1.2–1.3) | %d | תאורת חוץ, עמודים, חפירות, תקשורת, גילוי אש, בקרה, מתח גבוה — לא עבודה פרטית |\n\n' % stats['tender'])

nA = sum(1 for r in rows if r.get('mode') == 'A'); nB = len(rows) - nA
md.write('## שני מצבים, סה״כ אחד\n\n')
md.write('- **מצב א׳ (ברירת מחדל) — לפי סעיפים:** %d סעיפי "מוצר מדף" (A) — נקודה, העתקה, חציבה, התקנה, החלפה — מספר אחד כולל הכל; ועוד %d סעיפי חומר (B) שההתקנה בתוך המחיר שלהם. **הגעה %d ₪ — שורה אחת לכל הצעה.**\n' % (nA, nB, VISIT))
md.write('- **מצב ב׳ — לפי שעות:** רק לאיתור תקלות ועבודה פתוחה: הגעה %d + **%d ₪ לשעה** + חומר ב-+20%%. כמו שנאמר בקבוצה: עצמאי גובה לפי פריט; שעתי רק כשאין ברירה.\n' % (VISIT, HOURLY))
mcb = next((r for r in rows if r['code'] == '08.062.0230.R'), None)
if mcb: md.write('- **הבדיקה מול הדוגמה מהקבוצה** ("החלפת 2 מא״זים תלת, לקוח חוזר" → 700): אצלנו 2 × %s + הגעה %d = **%d**. הקבוצה: "הייתי לוקח אפילו יותר".\n\n' % (mcb['sj'], VISIT, 2 * mcb['sj'] + VISIT))
md.write('## החלטות שקבעתי (תשנה מה שלא מסתדר לך — "X ולא Y")\n\n')
md.write('- מאחורי כל מחיר סעיף: שעות × **%d ₪** + חומר. הגעה **%d ₪** בנפרד, פעם אחת.\n- חציבה: בלוק **%d** למטר 1–2 ואז **%d**; בטון **%d** ואז **%d**. הבדיקה מול השטח: הזזה עם 1.2 מ׳ בלוק = %d (אמרתם 1,000) · 2 מ׳ = %d (1,600) · 6 מ׳ = %d (2,500).\n- חלק החומר במחיר דקל: נקודות 35%% · אביזרים 60%% · רכיבי לוח 75%% · כבלים 75%% · צנרת 70%% · גופי תאורה 85%%.\n- מדד 2022→2026 לרייסדור: +18%% (אומדן).\n\n' % (
    RATE, VISIT_MIN, *CHASE['block'], *CHASE['conc'],
    by['08.017.9200']['sj'] + 700 + 0.2 * 0 + 0 if False else by['08.017.9200']['sj'] + 700 * 1.2 if False else by['08.017.9200']['sj'] + 700 + 700 * 0.2,
    by['08.017.9200']['sj'] + 1400, by['08.017.9200']['sj'] + 1400 + 4 * 280))

def table(title, codes):
    md.write('\n## %s\n\n| סעיף | שם | יח׳ | שעות | חומר | **SJ** | דקל | למה |\n|---|---|---|---|---|---|---|---|\n' % title)
    for c in codes:
        r = by.get(c)
        if not r: continue
        md.write('| %s | %s | %s | %s | %s | **%s** | %s | %s |\n' % (c, r['name'][:48], r['unit'], r.get('hours', '—'), r.get('materials', '—'), r['sj'], ('%g' % r['dekel']) if r['dekel'] else '—', r['why']))

table('נקודות', ['08.017.0010', '08.017.0040', '08.017.0050', '08.017.0035', '08.018.0010', '08.018.0110', '08.018.0180', '08.019.0010', '08.019.0012', '08.019.0050', '08.019.0100', '08.019.0110', '08.019.0150', '08.019.0700', '08.017.0020', '08.018.0030'])
table('החלפת רכיב בלוח (סעיפים שהוספתי — אין בדקל)', ['08.062.0060.R', '08.062.0230.R', '08.062.0104.R', '08.065.1330.R', '08.065.1340.R'])
table('שיפוץ והחלפה', ['08.017.9200', '08.017.9100', '08.017.9000', '08.018.9000', '08.017.9300', '08.019.9050', '08.019.9060', '08.019.9100', '08.061.9020', '08.061.9030', '08.021.9000', '08.031.9000', '08.023.9000', '08.072.9080'])
table('חציבות וקידוחים', ['08.026.0010', '08.026.0020', '08.026.0030', '08.026.0050', '08.026.0060', '08.026.0080', '08.026.0085'])
table('אביזרי קצה', ['08.071.0200', '08.071.1000', '08.072.0010', '08.074.0020'])
table('לוחות', ['08.061.0610', '08.061.0640', '08.061.1000', '08.061.1010', '08.062.0060', '08.062.0230', '08.062.0104', '08.065.1330', '08.065.1340', '08.066.0010'])
table('הארקות ובדיקות', ['08.040.0050', '08.040.0100', '08.040.0120', '08.043.0010', '08.043.1010'])
table('צנרת וכבלים (למטר)', ['08.021.0010', '08.021.0020', '08.021.0310', '08.023.0010', '08.031.0090', '08.031.0170', '08.031.0230', '08.034.0010'])
table('גופי תאורה', ['08.081.0840', '08.081.0930', '08.085.0136', '08.083.0100', '08.050.0030'])
md.write('\n\n%d שורות קיבלו מחיר. הקובץ המלא: `data/dekel/prices_sj_proposed.json`.\n' % len(rows))
md.close()
print('rows', len(rows), stats)
