"""A small application-neutral HTTP client. No CRE source or database access."""
import json
import time
import urllib.request
from urllib.parse import urlencode
from pathlib import Path

class ChartloomClient:
    def __init__(self, base_url, *, client_id='standalone', theme='om'):
        self.base_url = base_url.rstrip('/')
        self.client_id = client_id
        self.theme = theme

    def request(self, route, data=None, *, raw=None, timeout=90):
        return self.resource('api/v1/' + route, data, raw=raw, timeout=timeout)

    def resource(self, route, data=None, *, raw=None, timeout=90):
        """Fetch a service-relative resource for an authenticated host gateway."""
        if route.startswith(('/', '\\')) or '..' in route.split('?', 1)[0].split('/'):
            raise ValueError('A service-relative resource is required')
        body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
        request = urllib.request.Request(self.base_url+'/'+route, data=body,
            headers={'Content-Type':'application/octet-stream' if raw is not None else 'application/json'})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read(), response.headers.get('Content-Type','')

    def json(self, route, data=None):
        raw,_ = self.request(route,data)
        return json.loads(raw)

    def upload(self, path):
        path=Path(path)
        return self.upload_bytes(path.read_bytes(), path.name)

    def upload_bytes(self, content, filename):
        route='upload?'+urlencode({'name':filename,'theme':self.theme,'client':self.client_id})
        raw,_=self.request(route,raw=content)
        return json.loads(raw)

    def create_chart(self, data, requirements, *, file_name='输入数据', source_locator='Provided data', column_units=None, as_of=''):
        """Generate a chart directly from CSV/TSV, JSON rows or {columns, rows}."""
        return self.json('create-chart', {'data': data, 'requirements': requirements,
            'theme': self.theme, 'clientId': self.client_id, 'fileName': file_name,
            'sourceLocator': source_locator, 'columnUnits': column_units or {}, 'asOf': as_of})

    def job(self, job_id):
        return self.json('job?'+urlencode({'id':job_id}))

    def pricing(self):
        return self.json('pricing')

    def convert(self, job_id, pages=None, *, mode='charts', replace=False):
        return self.json('convert-document',{'id':job_id,'pages':pages,'mode':mode,'replace':replace})

    def wait(self, job_id, *, timeout=600, pages=None):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            job=self.job(job_id)
            if job['status']=='failed':
                return job
            selected=[p for p in job['pages'] if pages is None or p['number'] in pages]
            if job['status']!='preparing' and selected and all(p['status'] not in ('queued','converting') for p in selected):
                return job
            time.sleep(1)
        raise TimeoutError('Conversion is still running; the job id remains valid.')

    def save_chart(self, job_id, page, element_id, chart, revision, figure=None):
        return self.json('save-chart',{'id':job_id,'page':page,'elementId':element_id,
            'chart':chart,'figure':figure,'revision':revision})

    def fork_element(self, job_id, page, element_id, revision):
        """Create a private editable copy of an exact saved chart revision."""
        return self.json('fork-element', {'id': job_id, 'page': page,
                         'elementId': element_id, 'revision': revision})

    def artifact(self, job_id, page, element_id, kind='json', *, revision=None):
        return self.request('artifact?'+urlencode({'id':job_id,'page':page,'elementId':element_id,'format':kind, **({'revision':revision} if revision else {})}))[0]

    def editor_url(self, job_id, page=1):
        return self.base_url+'/?'+urlencode({'mode':'upload','job':job_id,'page':page})


    def source_crop(self, job_id, page, element_id):
        return self.request('source-crop?'+urlencode({'id':job_id,'page':page,'elementId':element_id}))[0]

    def save_figure(self, job_id, page, element_id, figure, revision):
        return self.json('save-figure', {'id':job_id,'page':page,'elementId':element_id,'figure':figure,'revision':revision})

    def capabilities(self):
        return self.json('capabilities')
