import json
import re
import os
from html.parser import HTMLParser

# Simple HTML parser to extract table rows
class SternTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_tbody = False
        self.in_tr = False
        self.in_td = False
        self.current_row = []
        self.current_td_data = ""
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag == "tbody":
            self.in_tbody = True
        elif tag == "tr" and self.in_tbody:
            self.in_tr = True
            self.current_row = []
        elif tag == "td" and self.in_tr:
            self.in_td = True
            self.current_td_data = ""

    def handle_endtag(self, tag):
        if tag == "tbody":
            self.in_tbody = False
        elif tag == "tr" and self.in_tr:
            self.in_tr = False
            if self.current_row:
                self.rows.append(self.current_row)
        elif tag == "td" and self.in_td:
            self.in_td = False
            self.current_row.append(self.current_td_data.strip())

    def handle_data(self, data):
        if self.in_td:
            self.current_td_data += data

def parse_price(price_str):
    # Remove all non-numeric characters except dots and digits
    # Handle values like "₪ 300.00" or "? 300.00"
    digits = re.findall(r'[0-9,.]+', price_str)
    if not digits:
        return 0.0
    val = digits[0].replace(',', '')
    try:
        return float(val)
    except ValueError:
        return 0.0

def main():
    html_path = r"C:\Users\stavj\.gemini\antigravity-ide\brain\89746617-ca30-4272-85ed-99c966320f29\.system_generated\steps\70\content.md"
    
    if not os.path.exists(html_path):
        print(f"Error: HTML content file not found at {html_path}")
        return

    print("Reading HTML file...")
    with open(html_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    print("Parsing HTML table...")
    parser = SternTableParser()
    parser.feed(html_content)

    print(f"Found {len(parser.rows)} raw rows.")
    
    parsed_items = []
    for row in parser.rows:
        # We expect rows to have at least 2 or 3 columns
        # Column 1: Description, Column 2: Details/Unit, Column 3: Price
        if len(row) >= 2:
            desc = row[0]
            # Clean up double spaces, strange characters
            desc = re.sub(r'\s+', ' ', desc).strip()
            
            # Skip header row or empty description rows
            if not desc or "פירוט עבודה" in desc or "מחיר" in desc:
                continue

            price_str = row[-1] # Usually the last column has the price
            price = parse_price(price_str)
            
            # If price is 0, let's see if we have 3 columns and price is in the middle? 
            # In some tables the price is the 3rd column
            if price == 0 and len(row) >= 3:
                price = parse_price(row[1])

            unit = row[1] if len(row) >= 3 else ""
            unit = re.sub(r'\s+', ' ', unit).strip()

            parsed_items.append({
                "description": desc,
                "unit": unit,
                "price": price
            })

    output_path = r"C:\Users\stavj\.gemini\antigravity-ide\scratch\quote-generator\stern-pricing.json"
    print(f"Saving {len(parsed_items)} items to {output_path}...")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(parsed_items, f, ensure_ascii=False, indent=2)
    print("Done!")

if __name__ == "__main__":
    main()
