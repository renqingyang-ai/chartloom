import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('linux_ocr', Path(__file__).parents[1] / 'scripts/recognize_text_linux.py')
ocr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ocr)


class LinuxOCR(unittest.TestCase):
    def test_line_and_word_boxes_retain_pixel_scale_and_confidence(self):
        tsv = ('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
               '5\t1\t1\t1\t1\t1\t20\t10\t40\t10\t95\t1,428\n'
               '5\t1\t1\t1\t1\t2\t70\t10\t20\t10\t90\tMW\n')
        result = ocr.spans_from_tsv(tsv, 200, 100)
        self.assertEqual(result['spans'][0]['text'], '1,428 MW')
        self.assertEqual(result['spans'][0]['bbox'], [10, 10, 35, 10])
        self.assertEqual(result['spans'][0]['confidence'], .9)
        self.assertEqual(result['spans'][1]['text'], '1,428')
        self.assertTrue(result['spans'][1]['word'])
