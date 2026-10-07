"""Regression checks for arbitrary-upload data/layout binding and format recovery."""
import asyncio,copy,json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from chart_platform.source_layout import validate_layout,binding_warnings,axis
from chart_platform.raster_measurements import bind_raster,calibration
from chart_platform.pipeline import Pipeline
from chart_platform.raster_geometry import glyph_box,measure_marks,apply_text_geometry,calibrate_layout_axes
from PIL import Image,ImageDraw
import numpy as np,io

class UploadLayoutChecks(unittest.TestCase):
 def test_missing_placeholder_repairs_layout_without_reextracting_checked_data(self):
  async def run():
   p=Pipeline.__new__(Pipeline);p.mode='charts';p.extract=AsyncMock();p.extract_layout=AsyncMock();p.repair_text=AsyncMock()
   f=self.figure();f.update(verification={'status':'checked'},layoutVerification={'status':'incomplete'})
   e={'id':'fresh','type':'figure','sourceType':'chart','figure':f,'bbox':[0,0,100,100]};result={'elements':[e]};before=copy.deepcopy(f['chart'])
   await p.repair_visual_issues(result,[{'elementId':'fresh','kind':'missing','description':'Only an incomplete conversion placeholder is visible.'},{'elementId':'fresh','kind':'layout','description':'Chart is not rendered.'}])
   self.assertEqual(p.extract_layout.await_count,1);p.extract.assert_not_awaited();self.assertEqual(f['chart'],before)
   # A real data problem takes precedence over the layout finding.
   p.extract_layout.reset_mock()
   await p.repair_visual_issues(result,[{'elementId':'fresh','kind':'missing','description':'Chart not visible.'},{'elementId':'fresh','kind':'data','description':'One series has the wrong values.'}])
   p.extract.assert_awaited_once();p.extract_layout.assert_not_awaited()
  asyncio.run(run())

 def test_missing_series_and_unchecked_facts_still_require_extraction(self):
  async def run():
   for checked,has_layout in [(False,False),(True,True)]:
    p=Pipeline.__new__(Pipeline);p.mode='charts';p.extract=AsyncMock();p.extract_layout=AsyncMock();p.repair_text=AsyncMock()
    f=self.figure();f.update(verification={'status':'checked' if checked else 'unresolved'},layoutVerification={'status':'incomplete'})
    if has_layout:f['sourceLayout']=self.layout()
    e={'id':'fresh','type':'figure','figure':f,'bbox':[0,0,100,100]}
    await p.repair_visual_issues({'elements':[e]},[{'elementId':'fresh','kind':'missing','description':'A source series is missing.'}])
    p.extract.assert_awaited_once();p.extract_layout.assert_not_awaited()
  asyncio.run(run())

 def test_tick_calibration_retains_reversed_axis(self):
  layout={'plotBox':[20,10,60,80],'orientation':'vertical','valueAxis':{'domain':[1,9],'reversed':True,'visible':True,'ticks':[{'value':1,'text':'1'},{'value':9,'text':'9'}]}}
  ocr={'spans':[{'text':'1','confidence':1,'bbox':[12,9,4,2]},{'text':'9','confidence':1,'bbox':[12,89,4,2]}]}
  calibrate_layout_axes(layout,ocr)
  self.assertTrue(layout['valueAxis']['reversed']);self.assertEqual(layout['valueAxis']['domain'],[1,9])
  self.assertEqual(layout['valueAxis']['calibration']['method'],'ocr-tick-centers')

 def test_numeric_axes_preserve_descending_direction_without_reordering_data(self):
  for scale,domain in [('linear',[9,1]),('linear',[5,-5]),('log',[100,1])]:
   result=axis({'domain':domain,'scale':scale},'left')
   self.assertEqual(result['domain'],sorted(domain));self.assertTrue(result['reversed'])
   self.assertEqual(axis(result,'left'),result)
  self.assertFalse(axis({'domain':[1,9]},'left')['reversed'])
  self.assertTrue(axis({'domain':[1,9],'reversed':True},'right')['reversed'])
  for domain in ([1,1],[float('inf'),1]):
   with self.assertRaises(ValueError):axis({'domain':domain},'left')
  with self.assertRaises(ValueError):axis({'domain':[10,-1],'scale':'log'},'left')

 def figure(self):
  return {'kind':'chart','chart':{'title':'Independent graph','kind':'bar','labels':['New A','New B'],'series':[{'name':'Measure','values':[13,29]}],'presentation':{'legend':True}},'totals':[],'valueLabels':[['13','29']]}
 def layout(self):
  return {'plotBox':[15,20,70,65],'valueAxis':{'domain':[0,40]},'categoryPositions':[32,66],'seriesStyles':[{'series':0,'geometry':'bar'}],'legends':[{'series':0,'x':16,'y':8,'textX':19,'textY':10}], 'texts':[{'role':'value','series':0,'index':i,'text':str(v),'x':[32,66][i],'y':[62,39][i],'fontSize':3} for i,v in enumerate([13,29])]}
 def test_layout_numbers_cannot_overwrite_checked_facts(self):
  f=self.figure();l=self.layout();before=copy.deepcopy(f)
  out=validate_layout(l,f,1.7);self.assertEqual(f,before);self.assertEqual(binding_warnings(out,f),[])
  l['texts'][0]['text']='999'
  with self.assertRaisesRegex(ValueError,'verified cell'):validate_layout(l,f,1.7)
 def test_missing_bound_values_are_reported_instead_of_passing(self):
  f=self.figure();l=self.layout();l['texts']=l['texts'][:1]
  self.assertTrue(binding_warnings(validate_layout(l,f,1.7),f))
 def test_source_baseline_is_independent_from_later_edits(self):
  f=self.figure();out=validate_layout(self.layout(),f,2)
  f['chart']['series'][0]['values'][0]=70
  self.assertEqual(out['sourceData']['series'][0]['values'],[13,29])
  out['sourceData']['labels'][0]='changed';self.assertEqual(f['chart']['labels'][0],'New A')
 def test_measurements_reject_foreign_indices_and_nonfinite_geometry(self):
  for mutation in ('index','position','domain'):
   l=self.layout()
   if mutation=='index':l['texts'][0]['index']=99
   elif mutation=='position':l['categoryPositions'][0]=float('nan')
   else:l['valueAxis']['domain']=[1,1]
   with self.assertRaises(ValueError):validate_layout(l,self.figure(),1.5)
 def test_calibrated_screenshot_estimates_do_not_replace_printed_data(self):
  f=self.figure();f['chart']['series'][0]['values']=[13,None]
  f['rasterPlot']={'yTicks':[{'position':20,'value':100},{'position':50,'value':50},{'position':80,'value':0}],'points':[{'series':0,'index':0,'x':32,'y':30},{'series':0,'index':1,'x':66,'y':50}]}
  out=bind_raster(f);self.assertEqual(out['chart']['series'][0]['values'],[13,50]);self.assertEqual(len(out['rasterEstimates']),1)
  self.assertEqual(out['rasterEstimates'][0]['valueStatus'],'coordinate-derived-estimate')
  self.assertTrue(out['chart']['warnings'])
 def test_measurements_require_independent_consistent_ticks(self):
  for ticks in ([{'position':10,'value':2}], [{'position':10,'value':0},{'position':30,'value':10},{'position':50,'value':9}], [{'position':10,'value':0},{'position':30,'value':10},{'position':50,'value':100}]):
   with self.assertRaises(ValueError):calibration(ticks,'linear')
 def test_stacked_measurements_use_segment_height(self):
  f=self.figure();f['chart']['series'][0]['values']=[None,29]
  f['chart']['kind']='stacked-bar'
  f['rasterPlot']={'yTicks':[{'position':0,'value':100},{'position':100,'value':0}],'points':[{'series':0,'index':0,'x':30,'y':25,'baseY':50}]}
  self.assertEqual(bind_raster(f)['chart']['series'][0]['values'][0],25)
 def test_bad_json_retries_once_and_only_caches_valid_output(self):
  async def run():
   with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);(root/'new-upload').mkdir()
    response=lambda s:SimpleNamespace(raw={'model':'test','choices':[{'finish_reason':'stop'}]},content=s)
    client=SimpleNamespace(complete=AsyncMock(side_effect=[response('{bad'),response('{"elements":[]}')]))
    c=SimpleNamespace(STORE=root,CLIENT=client,get_settings=lambda:SimpleNamespace(llm_model='test',llm_api_base='test'),parse_json=json.loads)
    p=Pipeline(c,{'id':'new-upload'},1,'charts')
    self.assertEqual(await p.call('inventory','prompt',[],{}),{'elements':[]})
    self.assertEqual(client.complete.await_count,2);self.assertEqual(len(list(p.cache.glob('*.json'))),1)
    self.assertEqual(await p.call('inventory','prompt',[],{}),{'elements':[]});self.assertEqual(client.complete.await_count,2)
  asyncio.run(run())
 def test_colored_label_crossing_bar_edge_keeps_both_halves(self):
  pixels=np.full((100,200,3),255,dtype=np.int16);pixels[50:,:,:]=[74,125,170]
  pixels[32:69,81:85,:]=[177,80,71];pixels[32:36,81:99,:]=[177,80,71];pixels[48:52,81:97,:]=[177,80,71]
  b=glyph_box(pixels,[38,27,14,47]);self.assertAlmostEqual(b[1],32);self.assertAlmostEqual(b[3],37)
 def test_bar_width_is_measured_from_pixels_without_a_sample_identity(self):
  im=Image.new('RGB',(500,300),'white');d=ImageDraw.Draw(im)
  d.rectangle((115,135,134,239),fill='#34699a');d.rectangle((265,75,284,239),fill='#34699a');buf=io.BytesIO();im.save(buf,format='PNG')
  f=self.figure();f['seriesColors']=[{'name':'Measure','color':'#34699a'}]
  l=self.layout();l.update(plotBox=[10,10,70,70],categoryPositions=[25,55],barWidth=50)
  out=measure_marks(buf.getvalue(),f,l);self.assertAlmostEqual(out['barWidth'],4);self.assertAlmostEqual(out['categoryPositions'][0],24.9)
 def test_multiline_annotation_keeps_measured_baselines(self):
  raw=self.layout();raw['texts']=[{'role':'note','text':'A readable note\nwith two lines','x':50,'y':20,'fontSize':4,'anchor':'middle'}]
  ocr={'method':'test','spans':[{'text':'A readable note','confidence':1,'bbox':[30,15,40,5]},{'text':'with two lines','confidence':1,'bbox':[32,21,36,5]}]}
  out=apply_text_geometry(raw,ocr,self.figure());t=out['texts'][0]
  self.assertEqual(t['lineStep'],6);self.assertEqual(t['y'],20);self.assertEqual(t['x'],50)
 def test_unbound_callout_alias_requires_exact_checked_note(self):
  f=self.figure();f['note']='A standalone explanation';l=self.layout()
  l['texts'].append({'role':'callout','text':'A standalone\nexplanation','x':20,'y':25,'fontSize':3})
  self.assertEqual(validate_layout(l,f,1.7)['texts'][-1]['role'],'note')
  l['texts'][-1]['text']='A different invented claim'
  with self.assertRaises(ValueError):validate_layout(l,f,1.7)
if __name__=='__main__':unittest.main()
