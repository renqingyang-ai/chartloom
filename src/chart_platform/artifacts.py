"""Export through the same browser renderer and data binding as the editor."""
import json
import subprocess
import threading
import uuid
from urllib.parse import urlencode
from .config import get_settings

_slots = threading.BoundedSemaphore(2)

def export_artifact(query, port):
    from . import converter
    job_id = query.get('id', [''])[0]
    number = int(query.get('page', ['1'])[0])
    element_id = query.get('elementId', [''])[0]
    kind = query.get('format', ['json'])[0]
    if kind not in ('json','svg','png','xlsx'):
        raise ValueError('Unsupported export format.')
    job = converter.get_job(job_id)
    if not 1 <= number <= len(job['pages']):
        raise ValueError('Page does not exist.')
    result = job['pages'][number-1].get('result')
    if not result:
        raise ValueError('No saved conversion result yet.')
    if query.get('revision') and str(result['revision']) != query['revision'][0]:
        raise ValueError('Revision changed; reload before exporting.')
    element = next((e for e in result['elements'] if e['id']==element_id), None)
    if not element or not (element.get('chart') or element.get('figure')):
        raise ValueError('No editable chart at that element.')
    if kind=='json':
        return json.dumps({'apiVersion':'v1','revision':result['revision'], 'theme':job.get('themeSnapshot'),
            'source':result['source'],'element':element,'validation':result.get('validation'),
            'audit':result.get('audit'),'humanAccepted':bool(element.get('chart',{}).get('reviewed'))},ensure_ascii=False).encode(), 'application/json'
    folder = get_settings().data_dir / 'exports'
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    output = folder / (uuid.uuid4().hex + '.' + kind)
    url = f'http://127.0.0.1:{port}/?' + urlencode({'mode':'data' if job.get('inputKind')=='data' else 'upload','job':job_id,'page':number,'audit':1})
    if not _slots.acquire(blocking=False):
        raise ValueError('Exports are busy; retry shortly.')
    try:
        proc = subprocess.run([get_settings().node, str(get_settings().web_dir/'artifact_export.mjs'),
            url,element_id,kind,str(output),str(result['revision'])],capture_output=True,timeout=60)
        if proc.returncode or not output.is_file():
            raise ValueError('Chart export did not finish; the saved source and data are unchanged.')
        return output.read_bytes(), {'svg':'image/svg+xml','png':'image/png','xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}[kind]
    finally:
        _slots.release()
        output.unlink(missing_ok=True)
