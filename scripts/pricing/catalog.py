# Sort the Dekel harvest into the catalogue an electrician would actually open.
# Groups and their order are a judgment call (Stav: "תעבור ותמיין ותחליט בעצמך"):
# what a renovation/installation electrician touches every week comes first,
# panel work and cabling in the middle, tenders-only specialities last.
import json, io, os, re, statistics
os.chdir(r"C:/Users/stavj/Desktop/הנדסת SJ חשמל/Skills/אתרי אינטרנט/sj-website")
d = json.load(io.open('data/dekel/dekel_prices_raw.json', encoding='utf-8'))

# ---- groups: (id, name, one line of why, [sub-chapter prefixes]) ----
GROUPS = [
    ('points',   'נקודות',                        'הלחם והחמאה — מאור, בתי תקע, דוד, מזגן, תנור',            ['08.017', '08.018', '08.019']),
    ('renov',    'שיפוץ והחלפה',                  'העתקת נקודה, שיפוץ נקודה, ניתוק וביטול, פירוקים — סדרת 9xxx של מחירון השיפוצים', ['__9xxx__']),
    ('chase',    'חציבות, קידוחים ומעברים',        'תעלה בבלוק/בטון, פתחים, קידוחי מעבר, איטום נגד אש',      ['08.026', '24.022', '24.021', '24.032', '08.044']),
    ('access',   'אביזרי קצה',                    'מפסקים, בתי תקע, דימרים, אביזרים שונים',                  ['08.071', '08.072', '08.074', '08.073']),
    ('panels',   'לוחות חשמל',                    'מבנה לוח, מא"זים, מאמ"תים, מפסקי זרם, ממסרים, פיקוד ומדידה', ['08.061', '08.062', '08.063', '08.065', '08.064', '08.066', '08.068', '08.069', '08.067', '08.060']),
    ('earth',    'הארקות, בדיקות ואישורים',        'הארקות והגנות, חשמלאי בודק, תרמוגרפיה',                  ['08.040', '08.043']),
    ('conduit',  'צנרת, תעלות וסולמות',           'צנרת פלסטית ומתכת, תעלות כבלים, סולמות',                 ['08.021', '08.022', '08.023', '08.024']),
    ('cables',   'כבלים ומוליכים',                'N2XY, אלומיניום, משוריין, מוליכים, חסיני אש, טלפון, התקנה', ['08.031', '08.032', '08.033', '08.034', '08.035', '08.037', '08.038', '08.036', '08.039']),
    ('light_in', 'גופי תאורה — פנים וחירום',       'לדים פנים, ספוטים, תאורת חירום, התקנה בלבד',              ['08.085', '08.084', '08.083', '08.081']),
    ('light_out','תאורת חוץ ועמודים',             'לדים חוץ, עמודי תאורה וזרועות, עמודי עץ, סולארי',         ['08.086', '08.056', '08.087', '08.051', '08.052', '08.053', '08.054', '08.055', '08.057', '08.059']),
    ('special',  'טעינה, אל-פסק, חימום, בית חכם',  'עמדות טעינה לרכב, UPS, חימום תת-רצפתי, בית חכם',         ['08.050', '08.048', '08.046', '08.076', '08.077', '08.088']),
    ('civil',    'תשתית חוץ: חפירות ותאי בקרה',    'חפירות ובסיסי בטון, תאי בקרה, גומחות מונים',              ['08.011', '08.012', '08.013', '08.014']),
    ('comm',     'תקשורת',                        'כבלים, ארונות, אופטיקה, אינטרקום, כריזה',                 ['18.']),
    ('fire',     'גילוי וכיבוי אש',               'רכזות, גלאים, חייגנים, כיבוי',                            ['34.']),
    ('control',  'בקרה, טמ"ס וגילוי פריצה',        'מצלמות, אזעקה, בקרת כניסה, בניין חכם, בקרת תאורה',       ['35.']),
    ('other',    'מנועים, מתח גבוה ושונות',        'חיבור מנועים, פסי צבירה, מזרקות, רמזורים, מתח גבוה, מוגן התפוצצות', ['08.027', '08.078', '08.090', '08.079', '08.091', '08.092', '08.093', '08.094', '08.095', '08.075', '08.080', '08.089', '08.028', '08.042']),
]
SKIP_SUBS = ('24.010', '24.011', '24.012', '24.013', '24.014', '24.031', '24.041', '24.042', '24.050', '24.060', '24.070', '24.072', '24.081', '24.082', '24.083', '08.001', '18.001', '24.001', '34.001', '35.001')

# ---- merge both books by item code ----
items = {}
sub_names = {}
def sub_of(code): return code[:6]
for book, folders in d.items():
    src = 'shipuz' if book.startswith('shipuz') else 'bniya'
    for f in folders:
        m = re.match(r'(\d\d\.\d\d\d)\s+(.*)', f['folder'])
        if m: sub_names.setdefault(m.group(1), m.group(2).split(' / ')[0])
        for it in f['items']:
            code = it['code']
            rec = items.setdefault(code, {'code': code, 'desc': it['desc'], 'unit': it['unit'], 'shipuz': None, 'bniya': None})
            prices = [float(p.replace(',', '')) for p in it['p'] if re.match(r'^[\d,]+(\.\d+)?$', p)]
            if src == 'shipuz': rec['shipuz'] = prices[:2] if prices else None
            else: rec['bniya'] = prices[0] if prices else None
            if len(it['desc']) > len(rec['desc']): rec['desc'] = it['desc']

# ---- a name the trade would say: the description up to the first "including…" clause ----
CUTS = [' לרבות', ', לרבות', ', כולל', ' כולל ', ', דגם', ' דגם ', ', כדוגמת', ' כדוגמת', ' תוצרת', ', מותקן', ' מותקן', ', בהתקנה', ' בהתקנה', ' עשוי', ', עשוי', ' מהלוח']
def short(desc):
    s = desc
    cut = min([s.find(c) for c in CUTS if s.find(c) > 12] + [len(s)])
    s = s[:cut].strip().rstrip(',;:. ')
    if len(s) > 72:
        s = s[:72].rsplit(' ', 1)[0] + '…'
    return s

# Rows in one sub-chapter that share a short name differ further down the
# description (how many sockets, which amperage). Give each the piece that
# tells it apart, so "עמדת עבודה…" ×20 becomes twenty different names.
def dedupe_names(rows):
    by = {}
    for r in rows: by.setdefault(r['name'], []).append(r)
    for name, group in by.items():
        if len(group) < 2: continue
        descs = [g['desc'] for g in group]
        # common prefix of the full descriptions
        pre = os.path.commonprefix(descs)
        cut = pre.rfind(' ') if ' ' in pre else len(pre)
        for g in group:
            tail = g['desc'][cut:].strip(' ,:;-')
            tail = re.split(r'[,;]| לרבות | כדוגמת | דגם ', tail)[0].strip()
            if not tail: tail = g['code']
            g['name'] = (name + ' — ' + tail)[:110]
    return rows

def is_renov(code):  # Dekel's 9xxx rows are the renovation/replacement items
    return code.split('.')[-1].startswith('9')

def group_of(code):
    sub = sub_of(code)
    if sub.startswith(SKIP_SUBS): return None
    if code.startswith('08.') and is_renov(code): return 'renov'
    for gid, _, _, prefs in GROUPS:
        for p in prefs:
            if p == '__9xxx__': continue
            if sub.startswith(p) or code.startswith(p): return gid
    return None

# ---- build ----
out = {'source': 'מחירון דקל — שיפוצים ותחזוקה 5/2026 ו-בנייה ותשתיות 8/2026 (נשלף 2.9.2026)', 'note': 'מחירי דקל הם מחירי קבלן/מכרז. price_stav ממתין לסתיו.', 'groups': []}
bucket = {gid: {} for gid, *_ in GROUPS}
for code, rec in items.items():
    gid = group_of(code)
    if not gid: continue
    bucket[gid].setdefault(sub_of(code), []).append(rec)

def sort_key(rec):
    # base rows before their "תוספת ל…" additions, otherwise Dekel's own order
    return (1 if rec['desc'].startswith('תוספת') else 0, rec['code'])

total = 0
for gid, name, why, prefs in GROUPS:
    subs = bucket[gid]
    if not subs: continue
    # sub-chapter order: as listed in prefs, then the rest
    order = {p: i for i, p in enumerate(prefs)}
    def sub_rank(s):
        for p, i in order.items():
            if s.startswith(p): return i
        return 99
    g = {'id': gid, 'name': name, 'why': why, 'subs': []}
    for sub in sorted(subs, key=lambda s: (sub_rank(s), s)):
        rows = sorted(subs[sub], key=sort_key)
        named = dedupe_names([{
            'code': r['code'], 'name': short(r['desc']), 'desc': r['desc'], 'unit': r['unit'],
            'dekel': {'shipuz': r['shipuz'], 'bniya': r['bniya']}, 'price_stav': None,
        } for r in rows])
        g['subs'].append({'code': sub, 'name': sub_names.get(sub, sub), 'items': named})
        total += len(rows)
    g['count'] = sum(len(s['items']) for s in g['subs'])
    out['groups'].append(g)

io.open('data/dekel/helper_catalog.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1))

# ---- what the data says about itself ----
def price(code, which='shipuz', tier=0):
    r = items.get(code);
    if not r: return None
    if which == 'shipuz': return r['shipuz'][tier] if r['shipuz'] and len(r['shipuz']) > tier else None
    return r['bniya']
def ratio(a, b): return (a / b) if (a and b) else None
ratios = []
tiers = []
for r in items.values():
    if r['shipuz'] and r['bniya'] and r['bniya'] > 0: ratios.append(r['shipuz'][0] / r['bniya'])
    if r['shipuz'] and len(r['shipuz']) == 2 and r['shipuz'][0] > 0: tiers.append(r['shipuz'][1] / r['shipuz'][0])
key = {
    'בטון / בלוק (חציבת תעלה, 08.026.0020/0010)': ratio(price('08.026.0020'), price('08.026.0010')),
    'נקודת מאור דירתית / רגילה (08.017.0040/0010)': ratio(price('08.017.0040'), price('08.017.0010')),
    'נקודת מאור תלת-פאזי / חד-פאזי (08.017.0050/0010)': ratio(price('08.017.0050'), price('08.017.0010')),
    'נקודת בית תקע / נקודת מאור (08.018.0010/08.017.0010)': ratio(price('08.018.0010'), price('08.017.0010')),
    'נקודת מזגן / נקודת מאור (08.019.0100/08.017.0010)': ratio(price('08.019.0100'), price('08.017.0010')),
    'העתקת נקודה עד 2 מ׳ / נקודה חדשה (08.017.9200/0010)': ratio(price('08.017.9200'), price('08.017.0010')),
    'חציון שיפוצים/בנייה על כל הסעיפים המשותפים': statistics.median(ratios) if ratios else None,
    'חציון מדרגה "מעל" / "עד" (הנחת כמות)': statistics.median(tiers) if tiers else None,
}
md = io.open('data/dekel/helper_catalog_summary.md', 'w', encoding='utf-8')
md.write('# קטלוג העזרה — מיון של שליפת דקל\n\n%d סעיפים מ-%d קבוצות. סדר הקבוצות = מה חשמלאי פותח הכי הרבה, לדעתי.\n\n' % (total, len(out['groups'])))
md.write('| # | קבוצה | סעיפים | למה |\n|---|---|---|---|\n')
for i, g in enumerate(out['groups'], 1): md.write('| %d | %s | %d | %s |\n' % (i, g['name'], g['count'], g['why']))
md.write('\n## מה הדאטה אומרת על עצמה (יחסים)\n\n')
for k, v in key.items(): md.write('- %s: **%s**\n' % (k, ('×%.2f' % v) if v else '—'))
# ---- "הכי בשימוש": the strip at the top of the helper page. My call (Stav: "תחליט
# בעצמך") — what a renovation/installation electrician prices every week, one
# row each, found by code or by the words Dekel uses. ----
STARTER = [
    ('08.017.0010', None), ('08.018.0010', None), ('08.019.0100', None), ('08.019.0010', None), ('08.019.0050', None),
    ('08.017.9200', None), ('08.017.9100', None), ('08.017.9000', None), ('08.018.9000', None),
    ('08.026.0010', None), ('08.026.0020', None), ('08.026.0080', None), ('08.026.0050', None),
    ('08.071', 'מפסק זרם יחיד'), ('08.072', 'בית תקע יחיד'), ('08.074', 'עמעם'),
    ('08.062', 'מא"ז חד קוטבי 16A'), ('08.062', 'מא"ז תלת קוטבי 25A'), ('08.065', 'מפסק מגן בזרם דלף 40A'), ('08.065', 'מפסק זרם ראשי 3X63A'),
    ('08.061', 'לוח חשמל דירתי'), ('08.040', 'הארקת יסוד'), ('08.040', 'פס השוואת פוטנציאלים'), ('08.043', 'בדיקת מתקן'),
    ('08.021', 'צינור פלסטי כפיף 20 מ"מ'), ('08.021', 'צינור פלסטי כפיף 25 מ"מ'), ('08.031', 'N2XY 3X2.5'), ('08.031', 'N2XY 5X6'), ('08.031', 'N2XY 5X16'),
    ('08.085', 'ספוט שקוע'), ('08.083', 'גוף תאורת חירום'), ('08.050', 'עמדת טעינה'),
]
all_items = {it['code']: it for g in out['groups'] for s in g['subs'] for it in s['items']}
def find_starter(code, words):
    if words is None: return all_items.get(code)
    keys = words.lower().split()
    cands = [it for c, it in all_items.items() if c.startswith(code) and not it['desc'].startswith('תוספת')]
    scored = sorted(cands, key=lambda it: (-sum(1 for k in keys if k in it['desc'].lower()), len(it['desc'])))
    return scored[0] if scored and sum(1 for k in keys if k in scored[0]['desc'].lower()) >= max(1, len(keys) - 1) else None
starter, seen = [], set()
for code, words in STARTER:
    it = find_starter(code, words)
    if it and it['code'] not in seen: starter.append(it['code']); seen.add(it['code'])
out['starter'] = starter
io.open('data/dekel/helper_catalog.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1))

md.write('\n## "הכי בשימוש" — הרצועה שתיפתח ראשונה (%d סעיפים, לבחירתי)\n\n| סעיף | שם | יח׳ | שיפוצים עד/מעל | בנייה |\n|---|---|---|---|---|\n' % len(starter))
for code in starter:
    it = all_items[code]; sp = it['dekel']['shipuz']; b = it['dekel']['bniya']
    md.write('| %s | %s | %s | %s | %s |\n' % (it['code'], it['name'], it['unit'], ('/'.join('%g' % x for x in sp) if sp else '—'), ('%g' % b if b else '—')))
missed = [f'{c} {w or ""}'.strip() for c, w in STARTER if not find_starter(c, w)]
if missed: md.write('\nלא נמצאו בדאטה (לבדוק ידנית): ' + ', '.join(missed) + '\n')
md.close()
print('starter rows:', len(starter), 'missed:', missed)
print('catalog: %d items in %d groups' % (total, len(out['groups'])))
for g in out['groups']: print('  %-34s %5d  (%d subs)' % (g['name'], g['count'], len(g['subs'])))
print('unassigned codes:', sum(1 for c in items if group_of(c) is None))
for k, v in key.items(): print('  %s: %s' % (k, ('x%.2f' % v) if v else '-'))
