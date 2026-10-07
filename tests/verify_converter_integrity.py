"""Regression invariants for source evidence, units, and independent scales."""
import copy,io,unittest
from PIL import Image,ImageDraw
from chart_platform.chart_numbers import printed_number
from chart_platform.chart_integrity import coverage
from chart_platform.raster_measurements import bind_raster
from chart_platform.raster_geometry import refine_bar_endpoints,calibrate_layout_axes,glyph_box
from chart_platform.native_evidence import printed_value_labels
from chart_platform.source_layout import validate_layout
import verify_source_layout as layout_checks
import numpy as np


class ConverterIntegrityChecks(unittest.TestCase):
    def test_unit_precision_and_signs_are_not_english_only(self):
        for text,n in [('3.34元',3.34),('2.960 MW',2.96),('−12.50万户',-12.5),('(1,230.00万元)',-1230),('￥6.890',6.89),('9.42%',9.42),('GBP 12.40',12.4)]:
            self.assertEqual(printed_number(text),n,text)
        for text in ['2026-07-31','12 to 20','Q3 3.34','10 and 20','Revenue 123','12,34','NaN']:
            self.assertIsNone(printed_number(text),text)

    def test_thousands_groups_are_not_separate_quantities(self):
        for separator in [' ', '\u00a0', '\u2009', '\u202f', ',']:
            for text,n in [(f'12{separator}345',12345),(f'1{separator}234{separator}567.80 MW',1234567.8),(f'−9{separator}876.50%',-9876.5),(f'(GBP 3{separator}210.00)',-3210)]:
                self.assertEqual(printed_number(text),n,text)
        for text in ['1 23','12 34 567','1234 567','1,234 567','1 234,567','1\n234','12  345','2026 07 31','12 345 / 67 890','85% (2011)']:
            self.assertIsNone(printed_number(text),text)

    def test_spaced_label_is_bound_to_whole_checked_value(self):
        helper=layout_checks.UploadLayoutChecks();f=helper.figure();l=helper.layout()
        f['chart']['series'][0]['values'][0]=12345.6
        l['texts'][0]['text']='12\u202f345.60 MW'
        result=validate_layout(l,f,2)
        self.assertEqual(result['texts'][0]['text'],'12\u202f345.60 MW')
        self.assertEqual(result['sourceData']['series'][0]['values'][0],12345.6)
        # Supporting the notation must not weaken the fact check.
        f['chart']['series'][0]['values'][0]=12
        with self.assertRaisesRegex(ValueError,'verified cell'):validate_layout(l,f,2)

    def test_raster_labels_survive_without_native_pdf_spans(self):
        f={'chart':{'series':[{'values':[3.34,2.96,6.89]}]},'valueLabels':[['3.34元','2.960 MW','6.89元']]}
        labels=printed_value_labels(f,{'spans':[]})
        self.assertEqual([x['text'] for x in labels[0]],f['valueLabels'][0])

    def test_bad_value_cannot_pass_by_adding_a_unit(self):
        helper=layout_checks.UploadLayoutChecks();f=helper.figure();l=helper.layout()
        l['texts'][0]['text']='13元';validate_layout(l,f,2)
        l['texts'][0]['text']='19元'
        with self.assertRaisesRegex(ValueError,'verified cell'):validate_layout(l,f,2)

    def dual(self):
        return {'kind':'chart','chart':{'kind':'grouped-bar','labels':['A','B'],'series':[{'name':'Price','values':[None,4.2]},{'name':'Count','values':[None,None]}]},'seriesGeometry':[{'series':0,'geometry':'bar','axis':'secondary'},{'series':1,'geometry':'line','axis':'primary'}], 'rasterPlot':{'yTicks':[{'position':10,'value':150},{'position':90,'value':110}],'secondaryYTicks':[{'position':10,'value':8},{'position':90,'value':0}],'points':[{'series':0,'index':0,'x':30,'y':50},{'series':0,'index':1,'x':70,'y':30},{'series':1,'index':0,'x':30,'y':30},{'series':1,'index':1,'x':70,'y':70}]}}

    def test_dual_axes_do_not_share_scale_or_overwrite_known_values(self):
        f=bind_raster(self.dual())
        self.assertEqual([s['values'] for s in f['chart']['series']],[[4,4.2],[140,120]])
        self.assertEqual(f['rasterEstimates'][0]['axisBinding'],'secondary')
        self.assertEqual(len(f['rasterEstimates']),3)

    def test_missing_secondary_ticks_cannot_use_primary_units(self):
        f=self.dual();del f['rasterPlot']['secondaryYTicks']
        with self.assertRaises(ValueError):bind_raster(f)

    def test_horizontal_axes_use_x_not_y(self):
        f=self.dual();r=f['rasterPlot'];r['orientation']='horizontal'
        r['xTicks']=r.pop('yTicks');r['secondaryXTicks']=r.pop('secondaryYTicks')
        for p in r['points']:p['x'],p['y']=p['y'],p['x']
        self.assertEqual([s['values'] for s in bind_raster(f)['chart']['series']],[[4,4.2],[140,120]])

    def test_empty_series_is_incomplete_even_if_other_labels_are_correct(self):
        f=self.dual();result=coverage(f)
        self.assertEqual(result['status'],'incomplete');self.assertEqual(result['series'][1]['known'],0)
        self.assertEqual(coverage(bind_raster(f))['status'],'complete')

    def test_mixed_layout_cannot_change_a_series_into_the_carrier_type(self):
        helper=layout_checks.UploadLayoutChecks();f=helper.figure();l=helper.layout()
        f['seriesGeometry']=[{'series':0,'geometry':'line','axis':'primary'}]
        with self.assertRaisesRegex(ValueError,'geometry and axis'):validate_layout(l,f,2)

    def test_endpoint_measurement_tracks_source_pixels_not_fixture_values(self):
        for x,y,color in [(40,30,'#678923'),(70,45,'#346d9e')]:
            im=Image.new('RGB',(400,300),'white');draw=ImageDraw.Draw(im)
            draw.rectangle((x*4-12,y*3,x*4+11,270),fill=color);buf=io.BytesIO();im.save(buf,format='PNG')
            f={'kind':'chart','chart':{'kind':'bar','labels':['Random'],'series':[{'name':'Value','values':[None]}]},'seriesColors':[{'name':'Value','color':color}],'rasterPlot':{'points':[{'series':0,'index':0,'x':x,'y':y+1}]}}
            refine_bar_endpoints(buf.getvalue(),f)
            self.assertAlmostEqual(f['rasterPlot']['points'][0]['y'],y)

    def test_plain_bar_endpoint_is_not_rebased_at_a_clipped_plot_edge(self):
        f=self.dual();f['rasterPlot']['points'][0]['baseY']=80
        self.assertEqual(bind_raster(f)['chart']['series'][0]['values'][0],4)

    def test_axes_keep_distinct_calibration_and_inside_plot_tick_text(self):
        ticks=[{'value':v,'text':str(v)} for v in (100,200,300)]
        secondary=[{'value':v,'text':str(v)} for v in (2,4,6)]
        l={'plotBox':[15,10,70,80],'valueAxis':{'domain':[0,400],'visible':True,'side':'left','ticks':ticks},'secondaryAxis':{'domain':[0,8],'visible':True,'side':'right','ticks':secondary}}
        spans=[{'text':str(value),'bbox':[x,y,3,4],'confidence':1} for x,values in [(6,[300,200,100]),(79,[6,4,2])] for y,value in zip([28,48,68],values)]
        calibrate_layout_axes(l,{'spans':spans})
        self.assertEqual(l['valueAxis']['domain'],[0,400]);self.assertEqual(l['secondaryAxis']['domain'],[0,8])
        self.assertEqual(l['secondaryAxis']['ticks'][0]['textX'],80.5)
        self.assertGreater(l['secondaryAxis']['fontSize'],.4)

    def test_thin_grid_stroke_is_not_a_text_glyph(self):
        pixels=np.full((80,180,3),255,dtype=np.int16);pixels[39:41,20:160]=[120,120,120]
        self.assertIsNone(glyph_box(pixels,[10,30,80,40]))

    def test_covered_line_vertex_uses_both_visible_segments(self):
        im=Image.new('RGB',(600,300),'white');d=ImageDraw.Draw(im)
        d.line([(180,120),(300,180),(420,90)],fill='#d89b12',width=3)
        d.rectangle((288,165,312,186),fill='#555555');buf=io.BytesIO();im.save(buf,format='PNG')
        f={'kind':'chart','chart':{'kind':'line','labels':['Point'],'series':[{'name':'Demand','values':[None]}]},'seriesColors':[{'name':'Demand','color':'#d89b12'}],'rasterPlot':{'points':[{'series':0,'index':0,'x':50,'y':58}]}}
        refine_bar_endpoints(buf.getvalue(),f)
        self.assertAlmostEqual(f['rasterPlot']['points'][0]['y'],60,delta=.5)

    def test_context_table_categories_are_retained_when_crop_omits_header(self):
        helper=layout_checks.UploadLayoutChecks();f=helper.figure();l=helper.layout()
        f['contextEvidence']=[{'series':0,'index':i,'columnLabel':label} for i,label in enumerate(f['chart']['labels'])]
        l['plotBox']=[15,20,70,78]
        out=validate_layout(l,f,2)
        self.assertTrue(out['categoryAxis']['visible']);self.assertGreater(out['bottomPadding'],0)
        del f['contextEvidence'];out=validate_layout(l,f,2)
        self.assertFalse(out['categoryAxis']['visible'])

    def test_omitted_color_metadata_does_not_skip_pixel_calibration(self):
        for color in ('#567cac','#858585'):
            im=Image.new('RGB',(500,300),'white');d=ImageDraw.Draw(im)
            heights=[37,52,29];points=[]
            for i,(x,y) in enumerate(zip((24,49,74),heights)):
                d.rectangle((x*5-17,y*3,x*5+17,270),fill=color)
                points.append({'series':0,'index':i,'x':x,'y':y+2})
            # A neutral label box must not become the inferred bar fill.
            d.rectangle((90,95,147,108),fill='#cccccc')
            buf=io.BytesIO();im.save(buf,format='PNG')
            f={'kind':'chart','chart':{'kind':'bar','labels':['A','B','C'],'series':[{'name':'New series','values':[None]*3}]},'rasterPlot':{'points':points}}
            refine_bar_endpoints(buf.getvalue(),f)
            for point,height in zip(f['rasterPlot']['points'],heights):self.assertAlmostEqual(point['y'],height)
            self.assertEqual(f['rasterGeometry']['barEndpointMethod']['matched'],3)
            self.assertEqual(f['seriesColors'][0]['color'],color)

    def test_absent_bars_cannot_produce_inferred_color_measurements(self):
        im=Image.new('RGB',(500,300),'white');d=ImageDraw.Draw(im)
        for y in (90,160,230):d.line((20,y,490,y),fill='#bbbbbb',width=2)
        buf=io.BytesIO();im.save(buf,format='PNG')
        f={'kind':'chart','chart':{'kind':'bar','labels':['A','B'],'series':[{'name':'No marks','values':[None,None]}]},'rasterPlot':{'points':[{'series':0,'index':0,'x':30,'y':30},{'series':0,'index':1,'x':60,'y':50}]}}
        refine_bar_endpoints(buf.getvalue(),f)
        self.assertFalse(f.get('seriesColors'));self.assertFalse(f.get('rasterGeometry'))

if __name__=='__main__':unittest.main()
