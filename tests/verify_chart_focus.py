import asyncio,copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from chart_platform.chart_focus import scope_evidence,include_native_charts,normalize_regions
from chart_platform.pipeline import Pipeline,box
from chart_platform import converter as c
class ChartFocusChecks(unittest.TestCase):
 def test_fraction_coordinates_are_normalized_before_cropping(self):
  es=[{'bbox':[.025,.148,.96,.72]}];normalize_regions(es)
  self.assertEqual(es[0]['bbox'],[2.5,14.799999999999999,96,72]);self.assertEqual(es[0]['coordinateNormalization'],'fraction-to-percent')
 def test_percent_boxes_are_never_rescaled(self):
  es=[{'bbox':[2.5,14.8,96,72]},{'bbox':[.2,.3,40,20]}];before=copy.deepcopy(es);normalize_regions(es);self.assertEqual(es,before)
 def test_ambiguous_units_cannot_silently_cut_off_source(self):
  for b in ([18,44,952,909],[10,20,95,50],[-8,0,20,30]):
   with self.assertRaises(ValueError):box(b)
 def test_invalid_units_are_remeasured_against_full_image(self):
  with tempfile.TemporaryDirectory() as temp:
   fake=type('Converter',(),{'STORE':Path(temp),'get_settings':staticmethod(lambda:type('Settings',(),{'llm_model':'test','llm_api_base':''})())})();p=Pipeline(fake,{'id':'test'},1,'charts');p.image=b'full-original'
   async def call(stage,prompt,images,payload,*args):
    self.assertEqual(stage,'region-coordinate-check');self.assertEqual(images,[b'full-original']);self.assertEqual(payload['invalidRegions'][0]['index'],1)
    return {'regions':[{'index':1,'bbox':[2,4,96,92]}]}
   p.call=call;inv={'elements':[{'id':'good','bbox':[1,2,30,40]},{'id':'bad','bbox':[18,44,952,909]}]}
   asyncio.run(p.verify_regions(inv));self.assertEqual(inv['elements'][0]['bbox'],[1,2,30,40]);self.assertEqual(inv['elements'][1]['bbox'],[2,4,96,92]);self.assertEqual(len(p.review_events),1)
 def test_native_chart_cannot_disappear_after_empty_model_inventory(self):
  inv={'elements':[]};native=[{'nativeId':'plot-1','bbox':[10,20,30,40]}]
  include_native_charts(inv,native);include_native_charts(inv,native)
  self.assertEqual(len(inv['elements']),1);self.assertEqual(inv['elements'][0]['nativeId'],'plot-1')
 def test_existing_geometry_matches_native_chart_without_duplicate(self):
  inv={'elements':[{'type':'pie','bbox':[8,18,35,45]}]}
  include_native_charts(inv,[{'nativeId':'plot-1','bbox':[10,20,30,40]}])
  self.assertEqual(len(inv['elements']),1)
 def test_page_body_and_logos_are_not_chart_completeness_targets(self):
  native={'spans':[{'text':'chart','bbox':[20,20,3,2]},{'text':'body','bbox':[80,80,5,5]}],'images':[{'id':'logo'}],'paths':[{'id':'vector'}]}
  scoped=scope_evidence(native,[{'bbox':[10,10,30,30]}]);self.assertEqual([s['text'] for s in scoped['spans']],['chart']);self.assertEqual(scoped['images'],[]);self.assertEqual(len(native['images']),1)
 def test_no_charts_requires_independent_discovery_and_returns_valid_empty_result(self):
  old=(c.STORE,c.JOBS);jid='isolated';stages=[]
  with tempfile.TemporaryDirectory() as temp:
   try:
    c.STORE=Path(temp);(c.STORE/jid).mkdir();job={'id':jid,'sha256':'a','fileName':'text-only.pdf','createdAt':'today','pages':[{'status':'converting'}]};c.JOBS={jid:job}
    p=Pipeline(c,job,1,'charts')
    async def call(stage,*args,**kwargs):stages.append(stage);return {'title':'Text page','elements':[]}
    p.call=call
    with patch.object(c,'source_page',return_value=(b'pixels','')),patch('chart_platform.pipeline.package',return_value={'spans':[],'paths':[],'images':[],'nativeCharts':[],'width':800,'height':450}):r=asyncio.run(p.run_pipeline())
    self.assertEqual(stages,['inventory','chart-discovery-check']);self.assertEqual(r['audit']['status'],'no-charts');self.assertEqual(r['elements'],[])
   finally:c.STORE,c.JOBS=old

if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ChartFocusChecks))
 Path('evidence/conversion-capability-20261003/chart-focus-tests.json').write_text(json.dumps({'passed':result.wasSuccessful(),'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors)},indent=2));raise SystemExit(not result.wasSuccessful())
