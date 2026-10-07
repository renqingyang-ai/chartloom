"""One command, local-only preview. This serves only the comparison artifact directory."""
import argparse
import functools
import http.server
import json
import os
import hashlib
import re
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from .config import get_settings
from . import __version__
from . import converter
from .themes import get_theme, list_themes
root = get_settings().web_dir

class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def json_response(self, result, status=200):
        body = json.dumps(result, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def local_request(self):
        hosts = (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')
        # Explicit private-service hostnames only; no public listener is implied.
        hosts += tuple(h.strip() for h in os.environ.get('CHART_INTERNAL_HOSTS', '').split(',') if h.strip())
        if self.headers.get('Host') not in hosts or self.headers.get('Origin') not in (None, *('http://' + h for h in hosts)):
            self.json_response({'error': '仅允许本机同源请求。'}, 403)
            return False
        return True

    def do_GET(self):
        if not self.local_request():
            return
        url = urlparse(self.path)
        if url.path.startswith('/api/v1/'):url=url._replace(path='/api/'+url.path[len('/api/v1/'):])
        query = parse_qs(url.query)
        try:
            if url.path == '/api/pricing':
                from .model_pricing import catalog
                self.json_response(catalog())
                return
            if url.path == '/api/health':
                from .pipeline import VERSION
                self.json_response({'status':'ok','platform':'chartloom','version':__version__,'pipelineVersion':VERSION,'apiVersion':'v1','modelConfigured':bool(converter.get_settings().llm_api_key and converter.get_settings().llm_model)})
                return
            if url.path == '/api/capabilities':
                from .api_contract import capabilities
                self.json_response(capabilities())
                return
            if url.path == '/api/theme':
                theme_id=query.get('theme',[''])[0]
                if not theme_id and query.get('job'):
                    snapshot=converter.get_job(query['job'][0]).get('themeSnapshot')
                    if snapshot:self.json_response(snapshot);return
                self.json_response(get_theme(theme_id or 'om'))
                return
            if url.path == '/api/source-crop':
                from .native_evidence import crop
                job = converter.get_job(query.get('id',[''])[0])
                number = int(query.get('page',['1'])[0])
                if not 1 <= number <= len(job['pages']):raise ValueError('Page does not exist.')
                result = job['pages'][number-1].get('result') or {}
                element = next((e for e in result.get('elements',[]) if e['id']==query.get('elementId',[''])[0]),None)
                if not element:raise ValueError('Element does not exist.')
                payload = crop(converter.source_page(job,number)[0],element['bbox'])
                self.send_response(200);self.send_header('Content-Type','image/png');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
                return
            if url.path == '/api/artifact':
                from .artifacts import export_artifact
                payload,mime=export_artifact(query, self.server.server_port)
                self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(payload)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(payload)
                return
            if url.path == '/api/validation-rules':
                from .validation_rules import catalog
                from .validation_learning import candidates
                self.json_response({**catalog(),'candidates':candidates()})
                return
            if url.path == '/api/jobs':
                self.json_response({'jobs': converter.recent_jobs(), 'model': converter.get_settings().llm_model})
                return
            if url.path == '/api/document-data':
                from .conversion_queue import export_document
                self.json_response(export_document(converter.get_job(query.get('id', [''])[0])))
                return
            if url.path == '/api/job':
                self.json_response(converter.get_job(query.get('id', [''])[0]))
                return
            map_asset=re.fullmatch(r'/api/asset/([a-f0-9]{32})/((?:mapbase-\d+-\d+|content-\d+-[a-f0-9]{20})\.png)',url.path)
            if map_asset:
                job_id,name=map_asset.groups();converter.get_job(job_id)
                data=(converter.STORE/job_id/name).read_bytes()
                self.send_response(200);self.send_header('Content-Type','image/png');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
            asset = re.fullmatch(r'/api/asset/([a-f0-9]{32})/(thumb|page|result)-(\d+)\.(png|json)', url.path)
            if asset:
                job_id, kind, number, ext = asset.groups()
                job = converter.get_job(job_id)
                if not 1 <= int(number) <= len(job['pages']) or (kind == 'result') != (ext == 'json'):
                    raise ValueError('文件不存在。')
                if kind == 'page':
                    converter.source_page(job, int(number))
                if kind == 'result':
                    result=job['pages'][int(number)-1].get('result')
                    if not result:raise ValueError('结果尚未生成。')
                    self.json_response(result);return
                path = converter.STORE / job_id / f'{kind}-{number}.{ext}'
                if not path.is_file():
                    raise ValueError('文件尚未生成。')
                body = path.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'image/png' if ext == 'png' else 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                if ext == 'json':
                    self.send_header('Content-Disposition', f'attachment; filename="page-{number}-data.json"')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if url.path.startswith('/api/'):
                self.json_response({'error': '接口不存在。'}, 404)
                return
        except ValueError as exc:
            self.json_response({'error': str(exc)}, 404)
            return
        super().do_GET()

    def do_POST(self):
        if not self.local_request():
            return
        url = urlparse(self.path)
        if url.path.startswith('/api/v1/'):url=url._replace(path='/api/'+url.path[len('/api/v1/'):])
        if url.path.startswith('/api/'):
            try:
                size = int(self.headers.get('Content-Length', '0'))
                limit = 50 * 1024 * 1024 if url.path == '/api/upload' else 1_000_000
                if not 0 < size <= limit:
                    self.json_response({'error': '文件为空或超出大小限制。'}, 413)
                    return
                raw = self.rfile.read(size)
                if url.path == '/api/upload':
                    q=parse_qs(url.query)
                    result = converter.add_upload(raw, q.get('name', [''])[0], q.get('theme',['om'])[0],q.get('client',['standalone'])[0])
                else:
                    body = json.loads(raw)
                    if url.path == '/api/validation/check':
                        from .chart_numbers import parse_quantity
                        from .validation_rules import active_bundle
                        result=parse_quantity(body.get('text'))
                        expected=body.get('expected')
                        result['matchesExpected']=None if expected is None else result.get('status')=='parsed' and result.get('value')==expected
                        result['bundle']=active_bundle().identity
                    elif url.path == '/api/validation/propose':
                        import asyncio
                        from .validation_learning import PROPOSAL_PROMPT, propose
                        from .validation_rules import active_bundle
                        text=body.get('text','')
                        if not isinstance(text,str) or not 0<len(text)<=500:raise ValueError('请输入一个原始数字标签。')
                        bundle=active_bundle()
                        async def request_proposal():
                            return await converter.CLIENT.complete(model=converter.get_settings().llm_model,purpose='reference_upload_trial.validation_rule_proposal',
                                messages=[{'role':'system','content':PROPOSAL_PROMPT},{'role':'user','content':json.dumps({'rawText':text,'allowedFormats':bundle.data['numberFormats']},ensure_ascii=False)}],temperature=0,max_tokens=2000,timeout=60,response_format={'type':'json_object'},api_base=converter.get_settings().llm_api_base)
                        reply=asyncio.run_coroutine_threadsafe(request_proposal(),converter.LOOP).result(timeout=65)
                        result=propose(converter.parse_json(reply.content or ''),{'rawText':text,'origin':'local-rule-workbench'},bundle)
                    elif url.path == '/api/validation/candidate':
                        from .validation_learning import propose
                        result=propose(body['proposal'],{'rawText':body['text'],'origin':'local-json-editor'})
                    elif url.path == '/api/validation/activate':
                        from .validation_learning import activate
                        result=activate(body['candidateId'],body['expectedVersion'])
                    elif url.path == '/api/validation/rollback':
                        from .validation_learning import rollback
                        result=rollback(body['expectedVersion'])
                    elif url.path == '/api/create-chart':
                        from .data_creation import create
                        result = create(converter, body)
                    elif url.path == '/api/convert':
                        result = converter.start_conversion(body['id'], int(body['page']), body['mode'])
                    elif url.path == '/api/convert-document':
                        result = converter.start_document_conversion(body['id'], body.get('pages'), body.get('mode', 'page'), body.get('replace', False))
                    elif url.path == '/api/cancel-pending':
                        result = converter.cancel_pending_conversion(body['id'])
                    elif url.path == '/api/save-chart':
                        result = converter.save_chart(body['id'], int(body['page']), body['elementId'], body['chart'], body['revision'],body.get('figure'))
                    elif url.path == '/api/save-figure':
                        result=converter.save_figure(body['id'],int(body['page']),body['elementId'],body['figure'],body['revision'])
                    elif url.path == '/api/fork-element':
                        from .derivatives import fork_element
                        result = fork_element(converter, body['id'], body['page'], body['elementId'], body['revision'])
                    else:
                        self.json_response({'error': '接口不存在。'}, 404)
                        return
                self.json_response(result, 202 if url.path in ('/api/upload', '/api/convert', '/api/convert-document', '/api/create-chart') else 200)
            except ValueError as exc:
                self.json_response({'error': str(exc)[:300]}, 400)
            except (KeyError, TypeError):
                self.json_response({'error': '请求内容不正确，请检查文件或刷新后重试。'}, 400)
            except Exception:
                self.json_response({'error': '文件处理失败，请确认格式正确后重试。'}, 400)
            return
        if url.path != '/prepare-export':
            self.send_error(404)
            return
        name = parse_qs(url.query).get('name', [''])[0]
        size = int(self.headers.get('Content-Length', '0'))
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}\.(png|svg)', name) or not 0 < size <= 20_000_000:
            self.send_error(400)
            return
        body = self.rfile.read(size)
        if name.endswith('.png') and not body.startswith(b'\x89PNG\r\n\x1a\n'):
            self.send_error(400)
            return
        folder = root / 'exports'
        folder.mkdir(exist_ok=True)
        filename = hashlib.sha256(body).hexdigest()[:12] + '-' + name
        (folder / filename).write_bytes(body)
        result = json.dumps({'url': '/exports/' + filename}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(result)))
        self.end_headers()
        self.wfile.write(result)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        if self.path.startswith('/exports/'):
            self.send_header('Content-Disposition', 'attachment')
        super().end_headers()

def main():
    parser=argparse.ArgumentParser(description='Independent chart conversion platform')
    parser.add_argument('--port',type=int,default=8897)
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--runtime-file',type=Path,default=get_settings().data_dir/'runtime.json')
    args=parser.parse_args()
    args.runtime_file.parent.mkdir(parents=True,exist_ok=True)
    handler = functools.partial(PreviewHandler, directory=str(root))
    server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    converter.PREVIEW_PORT=server.server_port
    args.runtime_file.write_text(json.dumps({
        'pid': os.getpid(), 'port': server.server_port, 'root': str(root),
        'project': 'chartloom', 'version': __version__, 'bind': args.host
    }, indent=2))
    print(f'Chartloom: http://127.0.0.1:{server.server_port}', flush=True)
    server.serve_forever()

if __name__ == "__main__":main()
