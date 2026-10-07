"""Source occurrence regressions; no chart benchmark answers or API calls."""
import copy
import unittest

import numpy as np

from chart_platform.raster_geometry import apply_text_geometry, measure_text_spans


class OccurrenceTests(unittest.TestCase):
    def figure(self):
        return {'kind': 'chart', 'chart': {'labels': [], 'series': []}}

    def test_caption_word_cannot_relocate_a_separate_series_heading(self):
        caption = {'role': 'caption', 'text': 'Accept or Decline these offers?',
                   'x': 5, 'y': 13, 'fontSize': 3}
        heading = {'role': 'series-name', 'text': 'Decline',
                   'x': 35, 'y': 23, 'anchor': 'middle', 'fontSize': 3}
        spans = [
            {'text': caption['text'], 'bbox': [5, 10, 90, 3], 'confidence': 1},
            {'text': 'Decline', 'bbox': [30, 10, 10, 3], 'confidence': 1, 'word': True},
            {'text': 'DeclineAccept', 'bbox': [30, 20, 30, 3], 'confidence': 1},
        ]
        # The same source occurrence must stay owned even if layout JSON puts
        # the short heading before the caption.
        for entries in [[caption, heading], [heading, caption]]:
            result = apply_text_geometry({'texts': copy.deepcopy(entries)},
                                         {'spans': spans}, self.figure())
            actual = next(t for t in result['texts'] if t['role'] == 'series-name')
            self.assertEqual((actual['x'], actual['y']), (35, 23))

    def test_same_word_at_an_independent_occurrence_can_still_match(self):
        raw = {'texts': [
            {'role': 'caption', 'text': 'Accept or Decline?', 'x': 5, 'y': 13},
            {'role': 'series-name', 'text': 'Decline', 'x': 35, 'y': 23,
             'anchor': 'middle'},
        ]}
        spans = [
            {'text': 'Accept or Decline?', 'bbox': [5, 10, 80, 3], 'confidence': 1},
            {'text': 'Decline', 'bbox': [30, 10, 10, 3], 'confidence': 1, 'word': True},
            {'text': 'Decline', 'bbox': [31, 21, 10, 3], 'confidence': 1},
        ]
        result = apply_text_geometry(raw, {'spans': spans}, self.figure())
        self.assertEqual((result['texts'][1]['x'], result['texts'][1]['y']), (36, 24))

    def test_multiline_caption_claims_each_matched_line(self):
        raw = {'texts': [
            {'role': 'caption', 'text': 'First explanatory line\nDecline or accept?',
             'x': 5, 'y': 13, 'fontSize': 3},
            {'role': 'series-name', 'text': 'Decline', 'x': 10, 'y': 24,
             'anchor': 'middle'},
        ]}
        spans = [
            {'text': 'First explanatory line', 'bbox': [5, 10, 80, 3], 'confidence': 1},
            {'text': 'Decline or accept?', 'bbox': [5, 14, 80, 3], 'confidence': 1},
            {'text': 'Decline', 'bbox': [5, 14, 10, 3], 'confidence': 1, 'word': True},
        ]
        result = apply_text_geometry(raw, {'spans': spans}, self.figure())
        self.assertEqual((result['texts'][1]['x'], result['texts'][1]['y']), (10, 24))

    def test_split_line_glyph_box_stays_within_its_own_horizontal_span(self):
        pixels = np.full((200, 400, 3), 255, dtype=np.int16)
        # A broad OCR line overlaps a short label on the next baseline.
        # Extra low glyphs belong to the broad line, not the short label.
        for x in range(82, 108, 7):
            pixels[112:119, x:x+3] = 0
        for x in range(160, 280, 9):
            pixels[101:112, x:x+3] = 0
            pixels[110:119, x+4:x+7] = 0
        spans = [
            {'text': 'A B C D E', 'confidence': 1, 'bbox': [20, 49, 55, 11]},
            {'text': '42.7', 'confidence': 1, 'bbox': [20, 55, 8, 6]},
        ]
        measure_text_spans(pixels, spans)
        left, _, width, _ = spans[1]['glyphBox']
        self.assertGreaterEqual(left, 20)
        self.assertLessEqual(left + width, 28.25)


if __name__ == '__main__':
    unittest.main()
