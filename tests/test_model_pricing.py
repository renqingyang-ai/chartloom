"""Accounting invariants; no network, credentials, or original jobs modified."""
import asyncio
import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from chart_platform.model_pricing import (UsageMeter, catalog, usage_from, quote, provider_for,
                           job_cost, observe_provider_attempts, recover_job_costs)

AT='2026-10-05T01:00:00+00:00'
MODEL='gemini-3.8-flash'


def response(input=20000, output=10000, cached=0, thinking=4000):
    return NS(raw={'model':MODEL,'usage':{'prompt_tokens':input,'completion_tokens':output,
        'total_tokens':input+output,'prompt_tokens_details':{'cached_tokens':cached},
        'completion_tokens_details':{'reasoning_tokens':thinking}}})


class PricingTests(unittest.TestCase):
    def price(self, result, **kw):
        return quote(usage_from(result), **({'model':MODEL,'provider':'google-gemini',
            'mode':'standard','at':AT,'prices':catalog()}|kw))

    def test_whole_conversion_example(self):
        self.assertEqual(self.price(response())['estimatedCostUsd'], .0525)

    def test_cached_input_is_not_counted_at_both_rates(self):
        self.assertEqual(self.price(response(cached=10000))['estimatedCostUsd'], .04575)

    def test_thinking_is_not_added_twice(self):
        self.assertEqual(usage_from(response())['outputTokens'],10000)
        for total,candidates in [(30000,6000),(30000,10000)]:
            native={'raw':{'usageMetadata':{'promptTokenCount':20000,
                'candidatesTokenCount':candidates,'thoughtsTokenCount':4000,'totalTokenCount':total}}}
            self.assertEqual(self.price(native)['estimatedCostUsd'],.0525)

    def test_missing_usage_unknown_but_explicit_zero_is_zero(self):
        self.assertIsNone(self.price(NS(raw={}))['estimatedCostUsd'])
        self.assertEqual(self.price(response(0,0,thinking=0))['estimatedCostUsd'],0)

    def test_direct_gemini_compatibility_counts_reported_total_with_thinking(self):
        r=NS(raw={'usage':{'prompt_tokens':12,'completion_tokens':5,'total_tokens':181}},usage_contract='gemini-openai')
        self.assertEqual(self.price(r)['estimatedCostUsd'],.00064275)
        self.assertEqual(usage_from(r)['thinkingTokens'],164)
        self.assertEqual(usage_from(r)['reportedCompletionTokens'],5)
        r.usage_contract='openai-normalized'
        self.assertIsNone(self.price(r)['estimatedCostUsd'])

    def test_invalid_counts_do_not_get_invented_or_clamped(self):
        for r in [response(cached=30000),response(input=-1),response(thinking=20000)]:
            self.assertIsNone(self.price(r)['estimatedCostUsd'])
        r=response();r.raw['usage']['total_tokens']=99999
        self.assertIsNone(self.price(r)['estimatedCostUsd'])

    def test_response_model_provider_and_mode_are_exact(self):
        for options in [{'model':'gemini-3.8-flash-imaginary'}, {'provider':'custom:example.test'}, {'mode':'mystery'}]:
            self.assertEqual(self.price(response(),**options)['status'],'unpriced')
        self.assertEqual(provider_for('gemini/'+MODEL,'https://example.test/v1'),'custom:example.test')
        self.assertEqual(self.price(response(),mode='batch')['estimatedCostUsd'],.02625)

    def test_effective_date_boundary_uses_timezone(self):
        self.assertEqual(self.price(response(),at='2027-01-01T07:59:59+08:00')['estimatedCostUsd'],.0525)
        self.assertEqual(self.price(response(),at='2027-01-01T08:00:00+08:00')['estimatedCostUsd'],.105)

    def test_ambiguous_price_is_not_silently_selected(self):
        prices=catalog();prices['rates'].append(copy.deepcopy(prices['rates'][0]))
        self.assertIsNone(self.price(response(),prices=prices)['estimatedCostUsd'])

    def test_snapshot_not_repriced_after_catalog_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            prices=catalog();m=UsageMeter(tmp,'run',MODEL,'google-gemini',prices=prices)
            prices['rates'][0]['outputPerMillion']='999'
            r=m.start('extract');m.finish(r,response());stored=m.save()
            self.assertEqual(stored['estimatedCostUsd'],.0525)
            self.assertEqual(json.loads((Path(tmp)/'usage-cost.json').read_text()),stored)

    def test_parse_failure_still_costs_and_retry_is_additional(self):
        with tempfile.TemporaryDirectory() as tmp:
            m=UsageMeter(tmp,'run',MODEL,'google-gemini')
            for attempt in [1,2]:
                r=m.start('extract',attempt);m.finish(r,response())
            self.assertEqual(m.save()['estimatedCostUsd'],.105)
            self.assertEqual(len((Path(tmp)/'usage-events.jsonl').read_text().splitlines()),4)

    def test_local_cache_cost_is_incremental_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            m=UsageMeter(tmp,'run',MODEL,'google-gemini');m.cache_hit('extract')
            s=m.save();self.assertEqual((s['estimatedCostUsd'],s['apiCalls'],s['localCacheHits']),(0,0,1))

    def test_async_failure_keeps_prior_cost_and_unknown_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            m=UsageMeter(tmp,'run',MODEL,'google-gemini')
            r=m.start('extract');m.finish(r,response())
            async def fail():raise TimeoutError('no usage')
            with self.assertRaises(TimeoutError):asyncio.run(m.complete('check',1,fail))
            s=m.save();self.assertEqual(s['knownCostUsd'],.0525)
            self.assertIsNone(s['estimatedCostUsd']);self.assertEqual(s['unknownCalls'],1)

    def test_internal_retry_is_visible_and_not_claimed_free(self):
        adapter=NS(record_generation_debug_provider_attempt=lambda *a,**kw:None)
        observe_provider_attempts(adapter)
        with tempfile.TemporaryDirectory() as tmp:
            m=UsageMeter(tmp,'run',MODEL,'google-gemini')
            async def retry():
                for attempt in [1,2]:
                    adapter.record_generation_debug_provider_attempt({'attempt':attempt},status='started')
                    adapter.record_generation_debug_provider_attempt({'attempt':attempt},status='failed' if attempt==1 else 'completed')
                return response()
            asyncio.run(m.complete('extract',1,retry));s=m.save()
            self.assertEqual(s['knownCostUsd'],.0525);self.assertEqual(s['unknownProviderAttempts'],1)
            self.assertFalse(s['complete'])

    def test_concurrent_contexts_do_not_mix_and_no_prompt_is_logged(self):
        adapter=NS(record_generation_debug_provider_attempt=lambda *a,**kw:None)
        observe_provider_attempts(adapter)
        with tempfile.TemporaryDirectory() as a,tempfile.TemporaryDirectory() as b:
            m1,m2=UsageMeter(a,'one',MODEL,'google-gemini'),UsageMeter(b,'two',MODEL,'google-gemini')
            async def run(m,n):
                async def call():
                    adapter.record_generation_debug_provider_attempt({'attempt':n,'message':'SECRET','prompt':'PRIVATE'},status='started')
                    await asyncio.sleep(.001)
                    return response(input=n,output=n,thinking=0)
                await m.complete('extract',1,call)
            async def both():await asyncio.gather(run(m1,1),run(m2,2))
            asyncio.run(both())
            for m,n in [(m1,1),(m2,2)]:
                record=m.save()['records'][0]
                self.assertEqual(record['providerAttempts'][0]['attempt'],n)
                text=(m.folder/'usage-events.jsonl').read_text()
                self.assertNotIn('SECRET',text);self.assertNotIn('PRIVATE',text)

    def test_accounting_failure_never_breaks_model_call(self):
        with tempfile.TemporaryDirectory() as tmp:
            m=UsageMeter(tmp,'run',MODEL,'google-gemini')
            async def call():return response()
            with patch('chart_platform.model_pricing.quote',side_effect=ValueError('broken price')):
                self.assertIsNotNone(asyncio.run(m.complete('extract',1,call)))
            self.assertFalse(m.save()['complete'])
            with patch.object(Path,'open',side_effect=OSError('disk full')):
                self.assertIsNotNone(asyncio.run(m.complete('extract',2,call)))
            self.assertIn('usage-ledger-write-failed',m.errors)

    def test_legacy_and_new_file_totals_and_editing_do_not_double_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            m=UsageMeter(tmp,'run',MODEL,'google-gemini');r=m.start('extract');m.finish(r,response());s=m.save()
            job={'pages':[{'number':1,'status':'done','result':{'billing':s},'costRuns':{'run':s}}]}
            self.assertEqual(job_cost(job)['estimatedCostUsd'],.0525)
            job['pages'][0]['result']['revision']=100
            self.assertEqual(job_cost(job)['estimatedCostUsd'],.0525)
            job['pages'].append({'number':2,'status':'done','result':{'revision':1}})
            self.assertEqual(job_cost(job)['unmeteredPages'],[2]);self.assertFalse(job_cost(job)['complete'])
            self.assertEqual(job_cost(job)['knownCostUsd'],.0525)

    def test_restart_keeps_finished_usage_and_unknown_inflight_attempt(self):
        with tempfile.TemporaryDirectory() as tmp:
            run=Path(tmp)/'runs'/'1-123';run.mkdir(parents=True)
            m=UsageMeter(run,'1-123',MODEL,'google-gemini')
            m.phase('读取原始图表')
            r=m.start('extract');m.finish(r,response());m.start('check')
            job={'pages':[{'number':1,'status':'failed'}]}
            recover_job_costs(job,tmp);recover_job_costs(job,tmp)
            value=job_cost(job)
            self.assertEqual(value['knownCostUsd'],.0525)
            self.assertEqual(value['unknownCalls'],1)
            self.assertEqual(value['runs'],1)
            self.assertFalse(value['complete'])
            self.assertEqual(job['pages'][0]['billing']['runStatus'],'interrupted')
            self.assertEqual(job['pages'][0]['billing']['phases'][0]['name'],'读取原始图表')


if __name__=='__main__':unittest.main()
