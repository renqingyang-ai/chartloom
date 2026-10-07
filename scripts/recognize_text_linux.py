#!/usr/bin/env python3
"""Portable OCR measurements with the same contract as the macOS helper."""
import csv
import io
import json
import subprocess
import sys
from collections import defaultdict
from PIL import Image


def spans_from_tsv(tsv, width, height):
    lines = defaultdict(list)
    for row in csv.DictReader(io.StringIO(tsv), delimiter='\t', quoting=csv.QUOTE_NONE):
        if row['level'] != '5' or not (row.get('text') or '').strip():
            continue
        confidence = float(row['conf']) / 100
        if confidence < 0:
            continue
        item = {'text': row['text'], 'bbox': [int(row['left']) / width * 100,
            int(row['top']) / height * 100, int(row['width']) / width * 100,
            int(row['height']) / height * 100], 'confidence': confidence, 'word': True}
        lines[tuple(row[k] for k in ('page_num', 'block_num', 'par_num', 'line_num'))].append(item)
    spans = []
    for words in lines.values():
        boxes = [w['bbox'] for w in words]
        x, y = min(b[0] for b in boxes), min(b[1] for b in boxes)
        spans.append({'text': ' '.join(w['text'] for w in words), 'bbox': [x, y,
            max(b[0]+b[2] for b in boxes)-x, max(b[1]+b[3] for b in boxes)-y],
            'confidence': min(w['confidence'] for w in words), 'word': False})
        if len(words) > 1:
            spans.extend(words)
    return {'method': 'tesseract-local-ocr', 'spans': spans}


if __name__ == '__main__':
    width, height = Image.open(sys.argv[1]).size
    result = subprocess.run(['tesseract', sys.argv[1], 'stdout', '-l', 'eng+chi_sim', '--psm', '11', 'tsv'],
                            capture_output=True, check=True, timeout=20)
    print(json.dumps(spans_from_tsv(result.stdout.decode(), width, height), ensure_ascii=False))
