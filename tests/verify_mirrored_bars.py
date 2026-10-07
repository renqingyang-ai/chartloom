"""Generic contracts and unseen synthetic geometry; no corpus answer lookup."""
import copy
import io
import unittest
from PIL import Image, ImageDraw
from chart_platform.raster_geometry import measure_marks
from chart_platform.source_layout import validate_layout


def fixture(horizontal=True, reversed_axis=False, swapped=False):
    chart={'kind':'grouped-bar','title':'Unseen opposing magnitudes','labels':['Alpha','Beta','Gamma'],
           'series':[{'name':'Group A','values':[17,31,23]}, {'name':'Group B','values':[37,21,29]}]}
    colors=['#257985','#c45625']
    figure={'kind':'chart','chart':chart,'seriesColors':[{'name':s['name'],'color':color} for s,color in zip(chart['series'],colors)]}
    image=Image.new('RGB',(600,400),'white');draw=ImageDraw.Draw(image)
    for si,series in enumerate(chart['series']):
        low=si==(1 if swapped else 0)
        for i,value in enumerate(series['values']):
            y=95+i*105;start=300-value*4 if low else 300;end=300 if low else 300+value*4
            draw.rectangle([start,y-10,end-1,y+9],fill=colors[si])
    layout={'plotBox':[10,15,80,70],'orientation':'horizontal','valueAxis':{'domain':[-60,60],'scale':'linear','visible':False,'reversed':reversed_axis,'ticks':[]},
            'categoryPositions':[23.75,50,76.25],'barWidth':20,'groupGap':7,'barOrderRequired':True,
            'seriesStyles':[{'series':i,'geometry':'bar','axis':'primary'} for i in range(2)],'texts':[],'legends':[],'lines':[]}
    if not horizontal:
        image=image.transpose(Image.Transpose.TRANSPOSE)
        layout.update(orientation='vertical',plotBox=[15,10,70,80])
    data=io.BytesIO();image.save(data,format='PNG')
    return data.getvalue(),figure,layout,image.width/image.height


class MirroredBars(unittest.TestCase):
    def test_source_geometry_and_fact_independence(self):
        for horizontal in (False,True):
            for reversed_axis in (False,True):
                for swapped in (False,True):
                    with self.subTest(horizontal=horizontal,reversed_axis=reversed_axis,swapped=swapped):
                        image,f,l,aspect=fixture(horizontal,reversed_axis,swapped);original=copy.deepcopy(f)
                        clean=validate_layout(measure_marks(image,f,l),f,aspect)
                        direction=(1 if horizontal else -1)*(-1 if reversed_axis else 1)*(-1 if swapped else 1)
                        self.assertEqual(clean['mirrorBars']['directions'],[-direction,direction])
                        self.assertAlmostEqual(clean['barWidth'],5)
                        self.assertEqual(f,original)
                        self.assertEqual(clean['sourceData']['series'],f['chart']['series'])
                        self.assertEqual(len(clean['rasterMarkMeasurement']['mirrorBars']['observations']),6)

    def checked(self):
        im,f,l,aspect=fixture();return f,validate_layout(measure_marks(im,f,l),f,aspect)

    def test_invalid_directions_cannot_bypass_overlap(self):
        for directions in ([1,1],[-1,-1],[True,-1],[1],[-1,1,1],'auto',None):
            f,l=self.checked();l['mirrorBars']={'directions':directions}
            with self.subTest(directions=directions),self.assertRaisesRegex(ValueError,'direction'):
                validate_layout(l,f,1.5)

    def test_negative_facts_not_silently_inverted(self):
        f,l=self.checked();f['chart']['series'][0]['values'][0]=-17
        with self.assertRaisesRegex(ValueError,'nonnegative'):validate_layout(l,f,1.5)

    def test_null_and_zero_remain_distinct(self):
        f,l=self.checked();f['chart']['series'][0]['values']=[None,0,23]
        out=validate_layout(l,f,1.5)
        self.assertEqual(out['sourceData']['series'][0]['values'],[None,0,23])

    def test_adjacent_category_overlap_still_rejected(self):
        f,l=self.checked();l['barWidth']=30
        with self.assertRaisesRegex(ValueError,'overlap'):validate_layout(l,f,1.5)

    def test_one_axis_zero_baseline_required(self):
        for mutation in ('log','positive','secondary','floating','stacked'):
            f,l=self.checked()
            if mutation=='log':l['valueAxis'].update(scale='log',domain=[1,100])
            elif mutation=='positive':l['valueAxis']['domain']=[0,100]
            elif mutation=='secondary':l['seriesStyles'][0]['axis']='secondary'
            elif mutation=='floating':f['barBaselines']=[{'series':'Group A','categoryIndex':0,'value':10}]
            else:f['chart']['kind']='stacked-bar'
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):validate_layout(l,f,1.5)

    def test_missing_group_order_is_not_waived_for_ordinary_bars(self):
        f,l=self.checked();l.pop('mirrorBars')
        with self.assertRaisesRegex(ValueError,'barSeriesOrder'):validate_layout(l,f,1.5)

    def test_signed_source_is_not_inferred_as_magnitudes(self):
        image,f,l,_=fixture();f['chart']['series'][0]['values'][0]=-17
        self.assertNotIn('mirrorBars',measure_marks(image,f,l))

    def test_unequal_pixel_scales_are_not_forced_onto_one_axis(self):
        image,f,l,_=fixture();f['chart']['series'][1]['values']=[v*2 for v in f['chart']['series'][1]['values']]
        self.assertNotIn('mirrorBars',measure_marks(image,f,l))

    def test_constant_length_ambiguous_seam_is_not_automatically_mirrored(self):
        from chart_platform.bar_arrangement import measure_mirror
        _,f,l,_=fixture();f['chart']['series'][0]['values']=[20,20,20]
        measurements=[{'series':si,'geometry':'bar','marks':[{'index':i,'center':30+i*20,'width':4,'span':([20,40] if si==0 else [40,40+v])} for i,v in enumerate(s['values'])]} for si,s in enumerate(f['chart']['series'])]
        self.assertIsNone(measure_mirror(measurements,f,l,600,400))


if __name__=='__main__':unittest.main()
