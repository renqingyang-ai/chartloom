import asyncio
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import httpx

from chart_platform import config, validation_rules as rules
from chart_platform.provider import OpenAICompatibleProvider
from chart_platform.themes import get_theme
from chart_platform.chart_numbers import parse_quantity
from chart_platform.validation_learning import propose, activate, rollback

class StandalonePlatformChecks(unittest.TestCase):
    def tearDown(self):
        config.get_settings.cache_clear()

    def test_provider_protocol_preserves_image_and_does_not_forward_local_metadata(self):
        seen=[]
        def respond(request):
            seen.append(json.loads(request.content))
            return httpx.Response(200,json={'model':'returned-model','choices':[{'message':{'content':'{"ok":true}'},'finish_reason':'stop'}]})
        with patch.dict(os.environ,{'CHART_MODEL':'openai/test-model','CHART_API_BASE':'https://model.invalid/v1','CHART_API_KEY':'unit-test-only'},clear=True):
            config.get_settings.cache_clear()
            provider=OpenAICompatibleProvider(httpx.MockTransport(respond))
            messages=[{'role':'user','content':[{'type':'image_url','image_url':{'url':'data:image/png;base64,unit-fixture'}}]}]
            result=asyncio.run(provider.complete(model='openai/test-model',messages=messages,purpose='local-diagnostic'))
        self.assertEqual(seen[0]['model'],'test-model')
        self.assertEqual(seen[0]['messages'],messages)
        self.assertNotIn('purpose',seen[0]);self.assertEqual(result.raw['model'],'returned-model')

    def test_provider_failure_never_echoes_key_or_response_body(self):
        with patch.dict(os.environ,{'CHART_MODEL':'test','CHART_API_BASE':'https://model.invalid/v1','CHART_API_KEY':'private-value'},clear=True):
            config.get_settings.cache_clear()
            provider=OpenAICompatibleProvider(httpx.MockTransport(lambda _:httpx.Response(403,text='private-value')))
            with self.assertRaises(ValueError) as found:
                asyncio.run(provider.complete(model='test',messages=[]))
            self.assertNotIn('private-value',str(found.exception))
            self.assertNotIn('private-value',repr(config.get_settings()))

    def test_gemini_uses_explicit_builtin_endpoint_without_external_config(self):
        seen=[]
        def respond(request):
            seen.append((str(request.url),json.loads(request.content)))
            return httpx.Response(200,json={'choices':[{'message':{'content':'{}'}}]})
        with patch.dict(os.environ,{'CHART_MODEL':'gemini/gemini-test','CHART_API_KEY':'unit-test-only'},clear=True):
            config.get_settings.cache_clear()
            asyncio.run(OpenAICompatibleProvider(httpx.MockTransport(respond)).complete(model='gemini/gemini-test',messages=[]))
        self.assertEqual(seen[0][0],'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
        self.assertEqual(seen[0][1]['model'],'gemini-test')

    def test_themes_are_independent_data_and_reproducible(self):
        om=get_theme('om');neutral=get_theme('neutral')
        self.assertNotEqual(om['sha256'],neutral['sha256'])
        self.assertNotEqual(om['chartColors'],neutral['chartColors'])
        self.assertEqual(get_theme('om'),om)
        with self.assertRaises(ValueError):get_theme('../private')

    def test_rule_candidate_requires_regression_and_retains_rollback(self):
        base=json.loads((Path(rules.__file__).parent/'resources/rules/bundles/chart-rules-1.0.0.json').read_text())
        with tempfile.TemporaryDirectory() as directory,patch.object(rules,'ROOT',Path(directory)),patch.object(rules,'_cache',{}),patch.object(rules,'_active',None):
            (rules.ROOT/'bundles').mkdir();(rules.ROOT/'bundles'/(base['version']+'.json')).write_text(json.dumps(base));(rules.ROOT/'active.json').write_text(json.dumps({'version':base['version']}))
            before=rules.active_bundle()
            record=propose({'format':{'id':'underscore-grouped','groupSeparator':'_','decimalSeparator':'.','groupSize':3}}, {'rawText':'1_234'})
            self.assertEqual(record['status'],'tested')
            self.assertEqual(rules.active_bundle().identity,before.identity)
            current=activate(record['id'],before.version)
            self.assertEqual(parse_quantity('1_234')['value'],1234)
            self.assertEqual(parse_quantity('85% (2011)')['status'],'unsupported')
            self.assertEqual(rollback(current['version']),before.identity)

    def test_rule_snapshots_do_not_follow_active_pointer_changes(self):
        before=rules.active_bundle()
        next_data=copy.deepcopy(before.data);next_data['version']='unit-other'
        other=rules.RuleBundle(next_data)
        with rules.session(before):
            with patch.object(rules,'_active',other):self.assertEqual(rules.active_bundle().identity,before.identity)

    def test_runtime_has_no_application_source_dependencies(self):
        root=Path(__file__).resolve().parents[1]
        for folder in ('src','web'):
            for p in (root/folder).rglob('*'):
                if p.suffix not in ('.py','.ts','.tsx','.mjs'):continue
                text=p.read_text()
                self.assertNotIn('/Users/',text,str(p))
                self.assertNotIn('from app.',text,str(p))
                self.assertNotIn('om_generator_web',text,str(p))
        self.assertFalse((root/'node_modules').is_symlink())
        self.assertFalse((root/'.venv').is_symlink())

if __name__=='__main__':unittest.main()
