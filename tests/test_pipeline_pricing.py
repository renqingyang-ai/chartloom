"""Verify real Pipeline.call integration without sending any model requests."""
import asyncio
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest
from chart_platform.pipeline import Pipeline


class PipelinePricingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.responses=['{}'];self.calls=0
        async def complete(**kw):
            self.calls+=1
            content=self.responses.pop(0)
            if isinstance(content,Exception):raise content
            return NS(content=content,raw={'model':'gemini-3.8-flash','usage':{
                'prompt_tokens':1000,'completion_tokens':200,'total_tokens':1200}})
        self.c=NS(STORE=Path(self.temp.name),get_settings=lambda:NS(llm_model='gemini/gemini-3.8-flash',llm_api_base=None),
            parse_json=json.loads,CLIENT=NS(complete=complete))
        self.p=Pipeline(self.c,{'id':'isolated-test'},1,'charts')

    def call(self):return asyncio.run(self.p.call('inventory','test prompt',[b'test-image'],{},200))

    def test_invalid_json_is_billed_before_retry(self):
        self.responses=['broken JSON','{}'];self.assertEqual(self.call(),{})
        self.assertEqual(self.calls,2)
        self.assertEqual(self.p.meter.save()['estimatedCostUsd'],.003)
        rows=self.p.meter.summary()['records']
        self.assertEqual([r['structuredResponse']['status'] for r in rows],['invalid','parsed'])
        self.assertEqual(rows[0]['request']['imageCount'],1)

    def test_failed_parse_keeps_both_receipts(self):
        self.responses=['broken JSON','still broken']
        with self.assertRaises(ValueError):self.call()
        self.assertEqual(self.p.meter.save()['estimatedCostUsd'],.003)

    def test_local_response_cache_calls_no_provider_and_costs_zero(self):
        self.call()
        fresh=Pipeline(self.c,{'id':'isolated-test'},1,'charts')
        asyncio.run(fresh.call('inventory','test prompt',[b'test-image'],{},200))
        self.assertEqual(self.calls,1)
        self.assertEqual(fresh.meter.save()['estimatedCostUsd'],0)
        self.assertEqual(fresh.meter.save()['localCacheHits'],1)

    def test_timeout_records_unknown_charge_without_fake_tokens(self):
        self.responses=[TimeoutError('test')]
        with self.assertRaises(TimeoutError):self.call()
        self.assertIsNone(self.p.meter.save()['estimatedCostUsd'])
        self.assertEqual(self.p.meter.save()['unknownCalls'],1)

    def test_live_snapshot_exposes_pending_and_completed_response_without_touching_history(self):
        from chart_platform.model_pricing import register_live, release_live, with_live_costs
        job={'id':'isolated-test','pages':[{'number':1,'status':'converting','billing':{'runId':'old'}}]}
        register_live(job['id'],1,self.p.meter)
        try:
            async def scenario():
                entered=asyncio.Event();resume=asyncio.Event()
                async def provider(**kw):
                    entered.set();await resume.wait()
                    return NS(content='{"elements":[]}',raw={'model':'gemini-3.8-flash','usage':{'prompt_tokens':1000,'completion_tokens':200,'total_tokens':1200}})
                self.c.CLIENT.complete=provider
                task=asyncio.create_task(self.p.call('inventory','private instructions',[b'private image'],{'nativeText':'private text'},200))
                await entered.wait()
                live=with_live_costs(job)['pages'][0]['billing']
                self.assertEqual(live['records'][0]['status'],'pending')
                self.assertIsNone(live['estimatedCostUsd'])
                self.assertNotIn('private',json.dumps(live))
                self.assertEqual(job['pages'][0]['billing']['runId'],'old')
                resume.set();await task
                done=with_live_costs(job)['pages'][0]['billing']
                self.assertEqual(done['estimatedCostUsd'],.0015)
                self.assertEqual(done['records'][0]['structuredResponse']['summary']['elementsCount'],0)
                self.assertEqual(len(done['records']),1)
            asyncio.run(scenario())
        finally:release_live(job['id'],1,self.p.meter)
        self.assertIs(with_live_costs(job),job)

    def test_logging_does_not_keep_source_values_or_response_text(self):
        self.responses=['{"chart":{"labels":["PRIVATE_CATEGORY"],"series":[{"name":"PRIVATE_SERIES","values":[123]}]}}']
        self.call();text=json.dumps(self.p.meter.summary())
        self.assertNotIn('PRIVATE',text)
        self.assertNotIn('test prompt',text)
        record=self.p.meter.summary()['records'][0]
        self.assertEqual(record['structuredResponse']['summary']['valueCount'],1)
        self.assertEqual(record['structuredResponse']['summary']['seriesCount'],1)

    def test_bad_optional_observation_does_not_fail_conversion_or_leak_live_meter(self):
        from chart_platform.model_pricing import with_live_costs
        async def result():return {'title':'retained chart','quality':{'issues':None}}
        self.p._run_pipeline=result
        finished=asyncio.run(self.p.run_pipeline())
        self.assertEqual(finished['title'],'retained chart')
        self.assertIn('observation-result-summary-unavailable',finished['billing']['errors'])
        job={'id':'isolated-test','pages':[{'number':1}]}
        self.assertIs(with_live_costs(job),job)


if __name__=='__main__':unittest.main()
