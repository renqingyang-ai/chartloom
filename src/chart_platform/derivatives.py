"""Copy-on-write editing: a caller never edits a shared conversion result."""
import copy
import json
import re
import shutil
import uuid


def fork_element(c, job_id, number, element_id, revision):
    with c.LOCK:
        parent = c.JOBS.get(job_id)
        if (not parent or type(number) is not int or not 1 <= number <= len(parent['pages'])
                or type(revision) is not int or revision < 1):
            raise ValueError('Saved chart revision is unavailable.')
        current = parent['pages'][number - 1]
        result = current.get('result')
        if not result or result.get('revision') != revision:
            archive = c.STORE / job_id / 'versions' / f'page-{number}-revision-{revision}.json'
            if not archive.is_file():
                raise ValueError('Saved chart revision is unavailable.')
            result = json.loads(archive.read_text())
        element = next((e for e in result.get('elements', []) if e.get('id') == element_id), None)
        if not element or not (element.get('chart') or element.get('figure')):
            raise ValueError('Saved chart element is unavailable.')
        identity = uuid.uuid4().hex
        folder = c.STORE / identity
        folder.mkdir(mode=0o700)
        try:
            # Original evidence and immutable renderer assets only. Do not copy
            # model receipts, queues or the conversion history into a new bill.
            for source in (c.STORE / job_id).iterdir():
                if source.is_file() and re.fullmatch(
                    rf'input\.(?:pdf|pptx?|png|jpe?g|webp|json)|(?:thumb|page)-{number}\.png|'
                    r'(?:mapbase-\d+-\d+|content-\d+-[a-f0-9]{20})\.png', source.name
                ):
                    shutil.copyfile(source, folder / source.name)
            selected = copy.deepcopy(result)
            selected['elements'] = [copy.deepcopy(element)]
            # Map assets belong to the derivative; source identities remain intact.
            selected = json.loads(json.dumps(selected).replace(
                f'/api/asset/{job_id}/', f'/api/asset/{identity}/'))
            pages = [{k: p[k] for k in ('number', 'width', 'height', 'title') if k in p}
                     | {'status': 'idle'} for p in parent['pages']]
            pages[number - 1].update(status='partial', result=selected)
            job = {k: copy.deepcopy(parent[k]) for k in
                   ('fileName', 'suffix', 'sha256', 'theme', 'themeSnapshot', 'clientId',
                    'inputKind', 'inputData', 'columnUnits', 'inputNotes', 'requirements', 'sourceLocator', 'asOf') if k in parent}
            job.update(id=identity, createdAt=c.now(), status='ready', stage='Independent editable chart',
                       pages=pages, prepareMs=0,
                       derivedFrom={'jobId': job_id, 'page': number, 'elementId': element_id, 'revision': revision})
            c.persist(job)
            c.JOBS[identity] = job
            return c.public_job(job)
        except Exception:
            shutil.rmtree(folder)
            raise
