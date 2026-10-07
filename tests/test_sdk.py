"""Thin SDK wire contract: no converter, model, renderer or CRE dependencies."""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from chartloom_sdk import ChartloomClient


class SDKContract(unittest.TestCase):
    def setUp(self):
        self.receipts = []
        receipts = self.receipts
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                receipts.append((self.path, None))
                raw = b'export' if '/artifact?' in self.path else json.dumps({'id':'job','status':'ready','pages':[{'number':1,'status':'partial'}]}).encode()
                self.send_response(200); self.end_headers(); self.wfile.write(raw)
            def do_POST(self):
                raw = self.rfile.read(int(self.headers['Content-Length']))
                receipts.append((self.path, raw))
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"id":"job"}')
        self.server = ThreadingHTTPServer(('127.0.0.1',0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.client = ChartloomClient('http://127.0.0.1:'+str(self.server.server_port), client_id='my-app')

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def test_upload_is_original_bytes_and_filename_is_encoded(self):
        self.client.upload_bytes(b'%PDF-original', 'source (7 & 31).pdf')
        path, body = self.receipts[-1]
        self.assertEqual(body,b'%PDF-original')
        self.assertEqual(parse_qs(urlparse(path).query)['name'],['source (7 & 31).pdf'])
        self.assertEqual(parse_qs(urlparse(path).query)['client'],['my-app'])

    def test_convert_and_edit_use_v1_and_revision(self):
        self.client.convert('job', [6,11], replace=False)
        path, body = self.receipts[-1]; self.assertEqual(path,'/api/v1/convert-document')
        self.assertEqual(json.loads(body),{'id':'job','pages':[6,11],'mode':'charts','replace':False})
        self.client.save_figure('job',6,'e1',{'kind':'timeline'},3)
        self.assertEqual(json.loads(self.receipts[-1][1])['revision'],3)

    def test_data_chart_sends_table_and_requirements_without_image(self):
        data=[{'Month':'Jan','Revenue':12.5}]
        self.client.create_chart(data, 'Draw revenue bars', file_name='Revenue data')
        path, raw=self.receipts[-1]; body=json.loads(raw)
        self.assertEqual(path, '/api/v1/create-chart')
        self.assertEqual(body['data'], data)
        self.assertEqual(body['requirements'], 'Draw revenue bars')
        self.assertEqual(body['clientId'], 'my-app')
        self.assertNotIn('image', body)

    def test_partial_is_terminal_not_accepted(self):
        result=self.client.wait('job',pages=[1],timeout=1)
        self.assertEqual(result['pages'][0]['status'],'partial')

    def test_artifact_pins_revision(self):
        self.assertEqual(self.client.artifact('job',1,'e 1','png',revision=3),b'export')
        self.assertEqual(parse_qs(urlparse(self.receipts[-1][0]).query)['revision'],['3'])

    def test_document_edit_forks_exact_revision(self):
        self.client.fork_element('shared', 11, 'e1', 2)
        path, body = self.receipts[-1]
        self.assertEqual(path, '/api/v1/fork-element')
        self.assertEqual(json.loads(body), {'id': 'shared', 'page': 11, 'elementId': 'e1', 'revision': 2})
