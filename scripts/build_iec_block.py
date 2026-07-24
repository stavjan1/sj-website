# -*- coding: utf-8 -*-
"""
Build the compact IEC-fees block for the pricing map from the full crawl CSV
(iec_calculator.csv, 786 rows). Full data → data/iec_full.json (engine use);
compact common-size digest → printed block (goes into DEFAULT_PRICING_MAP).

Usage: python scripts/build_iec_block.py <iec_calculator.csv>
"""
import csv, io, json, sys, os

COMMON = ['1X25', '1X40', '3X25', '3X40', '3X63', '3X80', '3X100', '3X125']

def nis(s):
    try: return round(float(str(s).replace(',', '')))
    except ValueError: return None

def main():
    path = sys.argv[1]
    rows = list(csv.DictReader(io.StringIO(open(path, 'rb').read().decode('utf-8-sig'))))
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(os.path.join(repo, 'data'), exist_ok=True)
    json.dump(rows, open(os.path.join(repo, 'data', 'iec_full.json'), 'w', encoding='utf-8'),
              ensure_ascii=False)

    L = []
    L.append('## אגרות חברת החשמל (מהמחשבון הרשמי, לפני מע"מ; חח"י מדגישה: הערכה בלבד)')
    L.append('אלה אגרות שהלקוח משלם לחח"י — שורה נפרדת בהצעה, לא חלק מהעבודה שלך. לכל הזמנה מתווספת בדיקת מתקן ~545 ₪ (כלולה בסכומים כאן). גדלים לא-שגרתיים: הפנה למחשבון חח"י.')

    for btype, label in [('מגורים', 'הגדלת חיבור — מגורים'), ('תעשייה ומסחר', 'הגדלת חיבור — תעשייה ומסחר')]:
        pairs = {}
        for r in rows:
            if r['סוג_הזמנה'] == 'הגדלת חיבור קיים' and r['סוג_מבנה'] == btype:
                f, t = r['חיבור_קיים'], r['חיבור_מבוקש']
                if f in COMMON and t in COMMON:
                    pairs[(f, t)] = nis(r['סהכ_לפני_מעמ'])
        L.append(f'### {label} (קיים→מבוקש: ₪)')
        line = []
        for (f, t), v in sorted(pairs.items(), key=lambda kv: (COMMON.index(kv[0][0]), COMMON.index(kv[0][1]))):
            line.append(f'{f}→{t}: {v:,}')
        # pack 4 per line to keep the block tight
        for i in range(0, len(line), 4):
            L.append('- ' + ' | '.join(line[i:i+4]))

    ph = [r for r in rows if r['סוג_הזמנה'] == 'חיבור חדש לבית פרטי']
    if ph:
        # two dig variants per size (short/long service line)
        by_size = {}
        for r in ph:
            by_size.setdefault(r['גודל_חיבור'], []).append((nis(r['סהכ_לפני_מעמ']), nis(r['עלות_חפירה'])))
        L.append('### חיבור חדש לבית פרטי (שתי רמות חפירה: ₪)')
        for size in [s for s in ['1X40', '3X25', '3X40', '3X63', '3X80'] if s in by_size]:
            vals = sorted(set(v for v, _ in by_size[size]))
            L.append(f'- {size}: ' + ' / '.join(f'{v:,}' for v in vals))

    L.append('- קיימים נתונים מלאים גם להעברת מיקום חיבור, חיבור בפילר וחיבור בניין מגורים (לפי מספר יחידות) — אם נשאל, אמור שזה תלוי-פרטים והפנה למחשבון חח"י או תן סדר גודל לפי ההיגיון של הטבלאות למעלה.')
    block = '\n'.join(L)
    out = os.path.join(repo, 'data', 'iec_map_block.txt')
    open(out, 'w', encoding='utf-8').write(block)
    print(f'block: {len(block)} chars, {len(L)} lines -> data/iec_map_block.txt + data/iec_full.json')

if __name__ == '__main__':
    main()
