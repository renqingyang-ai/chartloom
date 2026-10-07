"""Customer themes are versioned data, independent of extraction and source facts."""
import hashlib
import json
import os
import re
from pathlib import Path

def get_theme(name='om'):
    if not re.fullmatch(r'[a-z][a-z0-9_-]{0,60}', name):
        raise ValueError('Invalid theme id.')
    folder = Path(os.environ.get('CHART_THEME_DIR', Path(__file__).parent / 'resources/themes'))
    path = folder / (name + '.json')
    if not path.is_file():
        raise ValueError('Theme does not exist.')
    data = json.loads(path.read_text())
    if data.get('id') != name or not data.get('version'):
        raise ValueError('Theme id and version are required.')
    for key in ('ink', 'primary', 'secondary', 'tertiary', 'background'):
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', data.get('chartColors', {}).get(key, '')):
            raise ValueError('Chart colors must be six-digit hex values.')
    if not isinstance(data.get('colors'), dict) or not isinstance(data.get('typography', {}).get('fonts'), dict):
        raise ValueError('Theme tokens are incomplete.')
    data['sha256'] = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return data

def list_themes():
    folder = Path(os.environ.get('CHART_THEME_DIR', Path(__file__).parent / 'resources/themes'))
    return [{k:t[k] for k in ('id','version','name','sha256')}
            for t in (get_theme(p.stem) for p in sorted(folder.glob('*.json')))]
