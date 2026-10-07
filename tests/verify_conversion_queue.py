"""Queue regressions with isolated files and fake conversion; no model calls."""
import copy
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from chart_platform.conversion_queue import start, cancel_pending, recover_interrupted, summary, export_document


class QueueChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.started = []; self.running = 0; self.maximum = 0
        self.block = threading.Event()
        self.job = {'id':'test', 'status':'ready', 'fileName':'new-input.pdf', 'sha256':'new-source',
                    'pages':[{'number':n, 'status':'idle'} for n in range(1,6)]}
        self.c = SimpleNamespace(LOCK=threading.RLock(), JOBS={'test':self.job},
                                 POOL=ThreadPoolExecutor(max_workers=2), now=lambda:'now',
                                 public_job=copy.deepcopy)
        self.c.persist = lambda job: (Path(self.temp.name)/'job.json').write_text(json.dumps(job))
        self.c.convert_page = self.convert

    def tearDown(self):
        self.block.set(); self.c.POOL.shutdown(wait=True); self.temp.cleanup()

    def convert(self, jid, n, mode):
        with self.c.LOCK:
            self.started.append(n); self.running += 1; self.maximum = max(self.maximum,self.running)
        self.block.wait(3)
        with self.c.LOCK:
            self.running -= 1
            if n == 3: raise ValueError('isolated failure')
            p=self.c.JOBS[jid]['pages'][n-1]
            p.update(status='done',result={'revision':p.get('result',{}).get('revision',0)+1,'value':n})
            self.c.persist(self.c.JOBS[jid])

    def wait_for(self, check):
        end=time.monotonic()+3
        while not check() and time.monotonic()<end: time.sleep(.005)
        self.assertTrue(check())

    def test_bounded_parallelism_failure_isolation_and_duplicate_click(self):
        start(self.c,'test'); self.wait_for(lambda:len(self.started)==2)
        start(self.c,'test'); self.assertEqual(summary(self.c.JOBS['test'])['queued'],3)
        self.block.set(); self.c.POOL.shutdown(wait=True)
        self.assertEqual(self.maximum,2); self.assertEqual(sorted(self.started),[1,2,3,4,5])
        pages=self.c.JOBS['test']['pages']; self.assertEqual(pages[2]['status'],'failed')
        self.assertEqual(pages[4]['result']['value'],5)

    def test_existing_edited_results_skipped_by_default(self):
        self.job['pages'][0].update(status='partial',result={'revision':7,'value':999,'userEdited':True})
        start(self.c,'test',[1,2]); self.block.set(); self.c.POOL.shutdown(wait=True)
        self.assertEqual(self.started,[2]); self.assertEqual(self.c.JOBS['test']['pages'][0]['result']['value'],999)

    def test_explicit_reconvert_and_failed_retry_keep_previous_result(self):
        for n in (1,3):self.job['pages'][n-1].update(status='failed',result={'revision':4,'value':999})
        start(self.c,'test',[1,3]); self.block.set(); self.c.POOL.shutdown(wait=True)
        self.assertEqual(self.c.JOBS['test']['pages'][0]['result']['revision'],5)
        self.assertEqual(self.c.JOBS['test']['pages'][2]['result']['value'],999)

    def test_cancel_only_pending_and_requeue_uses_new_token(self):
        start(self.c,'test'); self.wait_for(lambda:len(self.started)==2)
        out=cancel_pending(self.c,'test')
        self.assertEqual([p['status'] for p in out['pages']],['converting','converting','idle','idle','idle'])
        start(self.c,'test',[5]); self.block.set(); self.c.POOL.shutdown(wait=True)
        self.assertEqual(sorted(self.started),[1,2,5])

    def test_bad_ranges_do_not_enqueue_or_mutate(self):
        for pages in ([],[0],[6],[1,'2'],[True],list(range(100))):
            with self.assertRaises(ValueError):start(self.c,'test',pages)
        self.assertEqual(self.started,[]); self.assertTrue(all(p['status']=='idle' for p in self.job['pages']))

    def test_failed_persistence_does_not_enqueue(self):
        def fail(_):raise OSError('disk full')
        self.c.persist=fail
        with self.assertRaises(OSError):start(self.c,'test',[1])
        self.assertEqual(self.started,[]);self.assertEqual(self.job['pages'][0]['status'],'idle')

    def test_restart_recovery_retains_data_and_export_has_page_failures(self):
        self.job['pages'][0].update(status='converting',result={'revision':2,'value':77})
        self.job['pages'][1].update(status='queued')
        recover_interrupted(self.job)
        self.assertEqual([p['status'] for p in self.job['pages'][:2]],['failed','failed'])
        exported=export_document(self.job)
        self.assertEqual(exported['sourceSha256'],'new-source')
        self.assertEqual(exported['pages'][0]['result']['value'],77)
        self.assertEqual(exported['summary']['failed'],2)

    def test_cancel_pending_reconversion_restores_editable_status(self):
        start(self.c,'test',[1,2]);self.wait_for(lambda:len(self.started)==2)
        self.c.JOBS['test']['pages'][4].update(status='partial',result={'revision':8,'value':55})
        start(self.c,'test',[5],replace=True)
        out=cancel_pending(self.c,'test')
        self.assertEqual(out['pages'][4]['status'],'partial')
        self.assertEqual(out['pages'][4]['result']['revision'],8)


if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(QueueChecks))
    Path('evidence/conversion-capability-20261003/queue-tests.json').write_text(json.dumps({'passed':result.wasSuccessful(),'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors)},indent=2))
    raise SystemExit(not result.wasSuccessful())
