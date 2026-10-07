import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace

from chart_platform.derivatives import fork_element


class DerivativeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        folder = self.root / 'parent'
        folder.mkdir()
        (folder / 'input.pdf').write_bytes(b'original-pdf')
        result = {'revision': 2, 'source': {'sha256': 'original'}, 'elements': [
            {'id': 'e1', 'chart': {'series': [{'values': [10]}]}, 'figure': {'basemap': '/api/asset/parent/mapbase-1-1.png'}},
            {'id': 'e2', 'chart': {'series': [{'values': [20]}]}}]}
        self.parent = {'id': 'parent', 'status': 'ready', 'fileName': 'source.pdf', 'suffix': '.pdf',
                       'sha256': 'original', 'theme': 'om', 'themeSnapshot': {'id': 'om', 'version': '1'},
                       'pages': [{'number': 1, 'status': 'done', 'result': result}]}
        self.c = SimpleNamespace(STORE=self.root, JOBS={'parent': copy.deepcopy(self.parent)}, LOCK=threading.RLock(),
                                 now=lambda: 'now', public_job=copy.deepcopy)
        self.c.persist = lambda j: (self.root / j['id'] / 'job.json').write_text(json.dumps(j))

    def test_copies_only_selected_element_without_modifying_source(self):
        result = fork_element(self.c, 'parent', 1, 'e1', 2)
        element = result['pages'][0]['result']['elements'][0]
        self.assertEqual(len(result['pages'][0]['result']['elements']), 1)
        self.assertIn(result['id'], element['figure']['basemap'])
        element['chart']['series'][0]['values'][0] = 99
        self.assertEqual(self.c.JOBS['parent'], self.parent)
        self.assertEqual((self.root / result['id'] / 'input.pdf').read_bytes(), b'original-pdf')
        self.assertEqual(result['themeSnapshot'], self.parent['themeSnapshot'])

    def test_replays_exact_archived_revision(self):
        folder = self.root / 'parent' / 'versions'
        folder.mkdir()
        old = copy.deepcopy(self.parent['pages'][0]['result'])
        old['revision'] = 1
        old['elements'][0]['chart']['series'][0]['values'] = [5]
        (folder / 'page-1-revision-1.json').write_text(json.dumps(old))
        result = fork_element(self.c, 'parent', 1, 'e1', 1)
        self.assertEqual(result['pages'][0]['result']['elements'][0]['chart']['series'][0]['values'], [5])
        self.assertEqual(self.c.JOBS['parent'], self.parent)

    def test_data_chart_copy_keeps_table_requirements_and_source(self):
        original={'columns':['Quarter','Revenue'],'rows':[['Q1',10]]}
        self.c.JOBS['parent'].update(inputKind='data',inputData=original,requirements='Draw revenue',columnUnits={'Revenue':'USD'})
        (self.root/'parent'/'input.json').write_text(json.dumps(original))
        result=fork_element(self.c,'parent',1,'e1',2)
        self.assertEqual(result['inputKind'],'data')
        self.assertEqual(result['inputData'],original)
        self.assertEqual(result['requirements'],'Draw revenue')
        self.assertEqual(json.loads((self.root/result['id']/'input.json').read_text()),original)
        result['inputData']['rows'][0][1]=20
        self.assertEqual(self.c.JOBS['parent']['inputData']['rows'][0][1],10)

    def test_unknown_revision_or_element_creates_no_copy(self):
        for element, revision in [('e1', 77), ('other', 2)]:
            with self.assertRaises(ValueError):
                fork_element(self.c, 'parent', 1, element, revision)
        self.assertEqual(list(self.c.JOBS), ['parent'])

    def test_failed_persistence_does_not_publish_partial_copy(self):
        def failed(_): raise OSError('disk')
        self.c.persist = failed
        with self.assertRaises(OSError): fork_element(self.c, 'parent', 1, 'e1', 2)
        self.assertEqual(list(self.c.JOBS), ['parent'])
        self.assertEqual([p.name for p in self.root.iterdir()], ['parent'])
