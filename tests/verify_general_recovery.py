"""No model or stored chart answers: regressions on generic geometry contracts."""
import copy,io,math,unittest
from types import SimpleNamespace
from PIL import Image,ImageDraw
from chart_platform.pipeline import Pipeline
from chart_platform.advanced_charts import validate_advanced
from chart_platform.raster_recovery import recover_curves,recover_pie

class RecoveryChecks(unittest.TestCase):
 def test_empty_gantt_wrapper_is_not_a_failed_chart(self):
  pipeline=object.__new__(Pipeline)
  f={'kind':'gantt','title':'','ticks':['0','5','10'],'tasks':[{'label':'A','start':.1,'end':.3},{'label':'B','start':.3,'end':.8},{'label':'C','start':.8,'end':1}], 'phases':[{'title':'','firstRow':0,'rowCount':3}]}
  result=pipeline.validate(f,{'title':''});self.assertEqual(result['phases'],[]);self.assertEqual(result['tasks'],f['tasks'])
  f['phases'][0]['rowCount']=4
  with self.assertRaises(ValueError):pipeline.validate(f,{'title':''})

 def curve(self):
  image=Image.new('RGB',(800,400),'white');draw=ImageDraw.Draw(image)
  draw.line([(80+i,200-150*math.sin(i/640*math.pi*14)) for i in range(641)],fill='#2277bb',width=3)
  stream=io.BytesIO();image.save(stream,'PNG')
  f={'kind':'curves','chart':{'title':'Unseen waveform','kind':'line','labels':['0','2','4'],'series':[{'name':'signal','values':[0,0,0]}]},'seriesColors':[{'name':'signal','color':'#2277bb'}]}
  layout={'plotBox':[10,10,80,80],'xAxis':{'domain':[0,4],'scale':'linear'},'valueAxis':{'domain':[-16/15,16/15],'scale':'linear'},'seriesStyles':[{'series':0,'geometry':'line','marker':'none','axis':'primary'}],'texts':[],'categoryAxis':{}}
  return stream.getvalue(),f,layout

 def test_full_curve_preserves_oscillations_between_ticks(self):
  im,f,l=self.curve();recover_curves(im,f,l);v=f['chart']['series'][0]['values'];self.assertGreater(len(v),500)
  self.assertGreater(max(x for x in v if x is not None),.95);self.assertLess(min(x for x in v if x is not None),-.95)
  peaks=sum(a<.9<=b for a,b in zip(v,v[1:]) if a is not None and b is not None);self.assertEqual(peaks,7)
  self.assertTrue(f['curveRecovery']['approximate']);self.assertEqual(l['sourceData']['series'],f['chart']['series'])

 def test_ambiguous_color_does_not_invent_a_second_curve(self):
  im,f,l=self.curve();original=copy.deepcopy(f);f['chart']['series'].append({'name':'second','values':[0,1,0]});f['seriesColors'].append({'name':'second','color':'#2277bb'});l['seriesStyles'].append({'series':1,'geometry':'line','marker':'none'})
  recover_curves(im,f,l);self.assertNotIn('curveRecovery',f);self.assertEqual(f['chart']['series'][0],original['chart']['series'][0])

 def test_pie_winding_and_rotation_come_from_pixels(self):
  image=Image.new('RGB',(400,400),'white');draw=ImageDraw.Draw(image)
  values=[23,31,46];colors=['#2299bb','#cc7744','#669944'];angle=37
  # PIL angles run clockwise from right; first wedge begins 127 from top.
  for v,c in zip(values,colors):draw.pieslice((40,40,360,360),angle,angle+v*3.6,fill=c);angle+=v*3.6
  b=io.BytesIO();image.save(b,'PNG');f={'kind':'pie','chart':{'labels':['One','Two','Three'],'series':[{'name':'','values':values}]},'seriesColors':[{'name':n,'color':c} for n,c in zip(['One','Two','Three'],colors)]};l={'plotBox':[10,10,80,80],'pie':{'startAngle':0,'holeRatio':0}}
  recover_pie(b.getvalue(),f,l);self.assertTrue(l['pie']['clockwise']);self.assertLess(abs(l['pie']['startAngle']-127),2);self.assertGreater(l['pieMeasurement']['agreement'],.97)
  missing=copy.deepcopy(f);missing['chart']['series'][0]['values']=[23,None,46]
  recover_pie(b.getvalue(),missing,copy.deepcopy(l))
  self.assertAlmostEqual(sum(missing['chart']['series'][0]['values']),100,2)
  self.assertLess(max(abs(a-b) for a,b in zip(missing['chart']['series'][0]['values'],values)),1)
  self.assertEqual(missing['piePixelShares']['originalValues'],[23,None,46])
  self.assertEqual(missing['chart']['unit'],'%')

 def test_candle_and_quartile_edit_validation(self):
  f={'kind':'candlestick','chart':{'labels':['A'],'series':[{'values':[v]} for v in [4,9,2,6]]},'fields':{'open':0,'high':1,'low':2,'close':3}}
  validate_advanced(f);f['chart']['series'][3]['values'][0]=12
  with self.assertRaises(ValueError):validate_advanced(f)

if __name__=='__main__':unittest.main()
