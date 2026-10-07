"""Generic regressions from fresh uploads: no sample identity or answer data."""
import copy
import unittest
from chart_platform.native_layout import apply_native_layout
from chart_platform.source_layout import validate_layout, binding_warnings
import verify_source_layout as fixtures


class NativeLayoutChecks(unittest.TestCase):
    def test_repeated_numbers_keep_distinct_category_anchors(self):
        f=fixtures.UploadLayoutChecks().figure();f['chart']['series'][0]['values']=[29,29]
        layout=fixtures.UploadLayoutChecks().layout()
        layout['texts']=[{'role':'value','index':i,'series':0,'text':'29','x':32,'y':39,'fontSize':3,'anchor':'middle'} for i in range(2)]
        spans=[{'text':'29','bbox':[x-2,35,4,5],'origin':[x-2,39],'size':10} for x in (32,66)]
        before=copy.deepcopy(f)
        result=apply_native_layout(layout,f,{'spans':spans},[0,0,100,100],500)
        self.assertEqual([t['x'] for t in result['texts']],[32,66])
        self.assertEqual([t['nativeFontSize'] for t in result['texts']],[2,2])
        self.assertEqual(f,before)

    def test_callout_legend_is_not_a_numeric_series(self):
        f=fixtures.UploadLayoutChecks().figure();f['categoryCallouts']=[{'label':'Margin ratio','values':['5%',None]}]
        l=fixtures.UploadLayoutChecks().layout();l['legends'].append({'binding':'callout','item':0,'x':50,'y':8,'textX':53,'textY':10})
        out=validate_layout(l,f,1.7)
        self.assertEqual(out['legends'][-1]['binding'],'callout')
        self.assertEqual(binding_warnings(out,f),[])
        l['legends'][-1]['item']=1
        with self.assertRaises(ValueError):validate_layout(l,f,1.7)

    def test_inline_curve_name_resolves_only_exact_known_name(self):
        f=fixtures.UploadLayoutChecks().figure();l=fixtures.UploadLayoutChecks().layout()
        l['texts'].append({'role':'series-annotation','text':'Measure','x':30,'y':15,'fontSize':3})
        self.assertEqual(validate_layout(l,f,1.7)['texts'][-1]['role'],'series-name')
        l['texts'][-1]['text']='Unverified name'
        with self.assertRaises(ValueError):validate_layout(l,f,1.7)

    def test_native_leader_width_and_rotated_baseline(self):
        f=fixtures.UploadLayoutChecks().figure();l=fixtures.UploadLayoutChecks().layout()
        l['texts']=[{'role':'free','text':'Growth','x':30,'y':20,'fontSize':3,'rotation':-10}]
        l['lines']=[{'points':[[10,30],[90,10]],'width':1.5}]
        ev={'spans':[{'text':'Growth','bbox':[30,14,14,7],'origin':[30,20],'size':9,'direction':[.9848,-.17365]}], 'paths':[{'stroke':'#000000','width':.4,'commands':[['l',[10,30],[90,10]]]}]}
        r=apply_native_layout(l,f,ev,[0,0,100,100],400)
        self.assertAlmostEqual(r['lines'][0]['width'],.1)
        self.assertAlmostEqual(r['texts'][0]['rotation'],-10,places=2)
        self.assertEqual(r['texts'][0]['anchor'],'start')

    def test_native_superscript_is_kept_once_with_bound_callout(self):
        f=fixtures.UploadLayoutChecks().figure();f['categoryCallouts']=[{'label':'Ratio','values':['0.7x²',None]}]
        l=fixtures.UploadLayoutChecks().layout();l['texts']=[{'role':'callout','text':'0.7x','item':0,'index':0,'x':50,'y':30,'fontSize':4},{'role':'annotation','text':'2','x':60,'y':27,'fontSize':2}]
        ev={'spans':[{'text':'0.7x','bbox':[50,26,9,5],'origin':[50,30],'size':12},{'text':'2','bbox':[60,24,2,3],'origin':[60,27],'size':7}]}
        r=apply_native_layout(l,f,ev,[0,0,100,100],300)
        self.assertEqual(len(r['texts']),1)
        self.assertEqual(validate_layout(r,f,1.7)['texts'][0]['role'],'callout')
        self.assertEqual(f['categoryCallouts'][0]['values'][0],'0.7x²')


if __name__=='__main__':unittest.main()
