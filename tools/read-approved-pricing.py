"""Read-only OOXML extraction of the user's approved pricing cells."""
import hashlib
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

source = sys.argv[1]
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(source) as book:
    strings = []
    if 'xl/sharedStrings.xml' in book.namelist():
        strings = [''.join(row.itertext()) for row in ET.fromstring(book.read('xl/sharedStrings.xml'))]
    relationships = {row.attrib['Id']: row.attrib['Target'] for row in ET.fromstring(book.read('xl/_rels/workbook.xml.rels'))}
    sheets = ET.fromstring(book.read('xl/workbook.xml')).find('s:sheets', ns)
    records = []
    notes = []
    for sheet in sheets:
        name = sheet.attrib['name']
        if name not in ['商品看图确认', 'Surprise看图确认', 'Game看图确认']:
            continue
        target = relationships[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
        target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        for row in ET.fromstring(book.read(target)).findall('.//s:sheetData/s:row', ns):
            cells = {}
            for cell in row:
                col = ''.join(x for x in cell.attrib['r'] if x.isalpha())
                value = cell.find('s:v', ns)
                kind = cell.attrib.get('t')
                if kind == 'inlineStr':
                    text = ''.join(cell.find('s:is', ns).itertext())
                elif value is None:
                    text = ''
                elif kind == 's':
                    text = strings[int(value.text)]
                else:
                    text = value.text or ''
                cells[col] = text.strip()
                if col in ['E', 'F', 'N'] and cell.find('s:f', ns) is not None:
                    raise ValueError('Approval cells must be literal, not cached formulas: ' + name + cell.attrib['r'])
            if int(row.attrib['r']) < 7 or not cells.get('N'):
                continue
            price = int(cells['E'])
            assert str(price) == cells['E'] and 0 <= price <= 1000000, cells
            assert cells['F'] in ['Free', 'Plus'], cells
            record = dict(id=cells['N'], code=cells.get('B'), title=cells.get('D'), price=price,
                          plusOnly=cells['F'] == 'Plus', sheet=name, row=int(row.attrib['r']))
            records.append(record)
            if cells.get('M'):
                notes.append(dict(id=record['id'], note=cells['M']))
assert len(records) == 496 and len({row['id'] for row in records}) == 496
with open(source, 'rb') as stream:
    sha = hashlib.sha256(stream.read()).hexdigest()
print(json.dumps(dict(source=source, sha256=sha, records=records, notes=notes), ensure_ascii=False))
