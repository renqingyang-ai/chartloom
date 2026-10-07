"""Geometry regressions built from pixels, independent of benchmark answers."""
import copy
import unittest
import numpy as np
from chart_platform.raster_geometry import measure_text_spans, apply_text_geometry


class MultilineTextTests(unittest.TestCase):
    def fixture(self):
        pixels=np.full((200,300,3),255,dtype=np.int16)
        for x in range(12,185,9):
            pixels[20:36,x:x+3]=0
            pixels[44:60,x:x+3]=0
        # Detached accents are part of the upper line, not a separate line.
        pixels[17:19,12:15]=0
        spans=[{'text':'Upper line with accents','confidence':1,'word':False,'bbox':[2,8,65,18]},
               {'text':'Lower line','confidence':1,'word':False,'bbox':[2,21,65,13]}]
        return pixels,spans

    def test_overlapping_boxes_exclude_neighbor_but_keep_diacritics(self):
        pixels,spans=self.fixture();original=copy.deepcopy(spans)
        measure_text_spans(pixels,spans)
        self.assertEqual([s['text'] for s in spans],[s['text'] for s in original])
        self.assertEqual([s['bbox'] for s in spans],[s['bbox'] for s in original])
        self.assertAlmostEqual(spans[0]['glyphBox'][1],8.5)
        self.assertAlmostEqual(spans[0]['glyphBox'][3],9.5)
        self.assertAlmostEqual(spans[1]['glyphBox'][1],22)
        self.assertAlmostEqual(spans[1]['glyphBox'][3],8)

    def test_line_order_does_not_change_pixel_measurement(self):
        pixels,spans=self.fixture();reverse=copy.deepcopy(spans[::-1])
        measure_text_spans(pixels,spans);measure_text_spans(pixels,reverse)
        self.assertEqual([s['glyphBox'] for s in spans],[s['glyphBox'] for s in reverse[::-1]])

    def test_descenders_and_ascenders_without_blank_rows_keep_whole_glyphs(self):
        pixels=np.full((200,300,3),255,dtype=np.int16)
        for x in range(12,185,12):
            pixels[20:37,x:x+3]=0
            pixels[35:52,x+6:x+9]=0
        spans=[{'text':'top line','confidence':1,'bbox':[2,8,65,14]},
               {'text':'next line','confidence':1,'bbox':[2,17,65,13]}]
        measure_text_spans(pixels,spans)
        self.assertAlmostEqual(spans[0]['glyphBox'][1],10)
        self.assertAlmostEqual(spans[0]['glyphBox'][3],8.5)
        self.assertAlmostEqual(spans[1]['glyphBox'][1],17.5)
        self.assertAlmostEqual(spans[1]['glyphBox'][3],8.5)

    def test_single_disconnected_glyph_is_not_trimmed_to_largest_band(self):
        pixels=np.full((100,100,3),255,dtype=np.int16)
        # Disconnected horizontal strokes, as in a CJK glyph.
        pixels[20:23,20:40]=0;pixels[28:31,20:40]=0;pixels[37:40,20:40]=0
        spans=[{'text':'三','confidence':1,'word':False,'bbox':[15,15,30,30]}]
        measure_text_spans(pixels,spans)
        self.assertEqual(spans[0]['glyphBox'],[20,20,20,20])

    def test_no_whitespace_does_not_invent_line_separator(self):
        pixels,spans=self.fixture();pixels[20:60,12:50]=0
        from chart_platform.raster_geometry import glyph_box
        before=[glyph_box(pixels,s['bbox']) for s in spans]
        measure_text_spans(pixels,spans)
        self.assertEqual([s.get('glyphBox') for s in spans],before)

    def test_multiline_width_and_leading_come_from_matched_source_lines(self):
        raw={'texts':[{'role':'title','text':'Long title row\nshort row','x':2,'y':9,'fontSize':6,'width':95}]}
        ocr={'method':'test','spans':[
            {'text':'Long title row','confidence':1,'bbox':[2,5,70,5],'glyphBox':[2,5,70,3]},
            {'text':'short row','confidence':1,'bbox':[2,11,40,5],'glyphBox':[2,11,40,3]}]}
        result=apply_text_geometry(raw,ocr,{'kind':'chart','chart':{'labels':[],'series':[]}})
        self.assertEqual(result['texts'][0]['width'],70)
        self.assertEqual(result['texts'][0]['lineStep'],6)
        self.assertEqual(result['texts'][0]['text'],raw['texts'][0]['text'])
        self.assertEqual(raw['texts'][0]['width'],95)


if __name__=='__main__':unittest.main()
