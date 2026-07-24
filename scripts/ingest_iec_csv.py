# -*- coding: utf-8 -*-
"""
Ingest the IEC (חברת חשמל) cost-calculator CSV (produced by the Chrome-Claude
crawl) into the ZEREM pricing knowledge map.

Usage:  python scripts/ingest_iec_csv.py <iec_calculator.csv>

Outputs (next to the CSV):
  iec_map_block.txt — compact Hebrew data block to paste into the pricing map
                      (admin panel → "מפת התמחור (DB)" → save; no deploy), or to
                      append to functions/api/_pricing_map.js DEFAULT_PRICING_MAP.
  iec_full.json     — full normalized table for future use (engine/BOQ).

Robust to column-name variations (Hebrew headers as specified in the crawl
prompt); skips N/A rows; groups by order type.
"""
import csv, json, sys, os, io, collections

def sniff_read(path):
    raw = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'utf-8', 'cp1255'):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise SystemExit('cannot decode CSV')
    sample = text[:2000]
    delim = ';' if sample.count(';') > sample.count(',') else ','
    return list(csv.DictReader(io.StringIO(text), delimiter=delim))

ALIASES = {
    'order':   ['סוג_הזמנה', 'סוג הזמנה', 'order_type', 'סוג'],
    'from':    ['חיבור_קיים', 'חיבור קיים', 'existing', 'גודל_קיים'],
    'to':      ['חיבור_מבוקש', 'חיבור מבוקש', 'requested', 'גודל_מבוקש'],
    'conn':    ['סוג_חיבור', 'סוג חיבור', 'connection_type'],
    'cost':    ['עלות_הזמנה', 'עלות הזמנה', 'order_cost'],
    'dig':     ['עלות_חפירה', 'עלות חפירה', 'dig_cost'],
    'check':   ['עלות_בדיקת_מתקן', 'עלות בדיקת מתקן', 'בדיקת_מתקן', 'inspection_cost'],
    'pre_vat': ['סהכ_לפני_מעמ', 'סה"כ לפני מע"מ', 'total_pre_vat'],
    'total':   ['סהכ_כולל', 'סה"כ כולל', 'total'],
}

def pick(row, key):
    for name in ALIASES[key]:
        for k in row:
            if k and k.strip().replace('"', '') == name:
                return (row[k] or '').strip()
    return ''

def num(s):
    s = str(s).replace('₪', '').replace(',', '').strip()
    try:
        return round(float(s), 2)
    except ValueError:
        return None

def main():
    path = sys.argv[1]
    rows = sniff_read(path)
    out_dir = os.path.dirname(os.path.abspath(path))
    norm = []
    for r in rows:
        rec = {
            'order': pick(r, 'order'), 'from': pick(r, 'from'), 'to': pick(r, 'to'),
            'conn': pick(r, 'conn'), 'cost': num(pick(r, 'cost')), 'dig': num(pick(r, 'dig')),
            'check': num(pick(r, 'check')), 'pre_vat': num(pick(r, 'pre_vat')), 'total': num(pick(r, 'total')),
        }
        if rec['order'] and rec['pre_vat'] is not None:
            norm.append(rec)
    json.dump(norm, open(os.path.join(out_dir, 'iec_full.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    # Compact Hebrew block for the AI map: group by order type, one line per combo.
    lines = ['\n## עלויות חברת החשמל (מהמחשבון הרשמי — לפני מע"מ, לעדכן תקופתית)',
             'אלה אגרות חח"י שהלקוח משלם לחברת החשמל — הצג אותן בנפרד מהעבודה שלך, אל תבלע אותן במחיר.']
    by_order = collections.OrderedDict()
    for rec in norm:
        by_order.setdefault(rec['order'], []).append(rec)
    for order, recs in by_order.items():
        lines.append(f'### {order}')
        for rec in recs:
            combo = ' → '.join(x for x in (rec['from'], rec['to']) if x) or rec['to'] or rec['from']
            conn = f' ({rec["conn"]})' if rec['conn'] else ''
            extras = []
            if rec['check']: extras.append(f'בדיקה {rec["check"]:,.0f}')
            if rec['dig']: extras.append(f'חפירה {rec["dig"]:,.0f}')
            extra = (' + ' + ', '.join(extras)) if extras else ''
            lines.append(f'- {combo}{conn}: {rec["pre_vat"]:,.0f} ₪{extra}')
    block = '\n'.join(lines)
    open(os.path.join(out_dir, 'iec_map_block.txt'), 'w', encoding='utf-8').write(block)
    print(f'rows: {len(norm)} | orders: {len(by_order)}')
    print('wrote iec_full.json + iec_map_block.txt')
    print('להטמעה: מסך האדמין -> "מפת התמחור (DB)" -> הדבק את הבלוק בסוף -> שמור.')

if __name__ == '__main__':
    main()
