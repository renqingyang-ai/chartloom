"""Generic compound-label binding checks; no benchmark answers are loaded."""
import copy
import unittest
import verify_source_layout
from chart_platform.source_layout import validate_layout
from chart_platform.chart_numbers import parse_quantity

class CompoundLabels(unittest.TestCase):
    def sample(self,text,quantity,prefix='',suffix='',value=13):
        helper=verify_source_layout.UploadLayoutChecks();f=helper.figure();f['chart']['series'][0]['values'][0]=value
        layout=helper.layout();layout['texts'][0].update(text=text,valueTemplate={'prefix':prefix,'quantity':quantity,'suffix':suffix})
        return f,layout

    def test_bound_quantity_keeps_year_note_separate(self):
        for text,quantity,prefix,suffix in [('13% (2004)','13%','',' (2004)'),('FY 2034: $13.0M','$13.0M','FY 2034: ',''),('13\n(provisional)','13','','\n(provisional)')]:
            f,l=self.sample(text,quantity,prefix,suffix);before=copy.deepcopy(f)
            result=validate_layout(l,f,1.7)
            self.assertEqual(result['texts'][0]['valueTemplate'],l['texts'][0]['valueTemplate'])
            self.assertEqual(result['texts'][0]['text'],text);self.assertEqual(f,before)

    def test_value_mismatch_still_rejected(self):
        f,l=self.sample('17% (2004)','17%','',' (2004)')
        with self.assertRaisesRegex(ValueError,'verified cell'):validate_layout(l,f,1.7)

    def test_compound_label_requires_explicit_binding(self):
        f,l=self.sample('13% (2004)','13%','',' (2004)');del l['texts'][0]['valueTemplate']
        with self.assertRaisesRegex(ValueError,'verified cell'):validate_layout(l,f,1.7)
        self.assertEqual(parse_quantity('13% (2004)')['status'],'unsupported')

    def test_template_cannot_drop_or_invent_source_text(self):
        f,l=self.sample('13% (2004)','13%','',' (2005)')
        with self.assertRaises(ValueError):validate_layout(l,f,1.7)

    def test_template_cannot_truncate_or_change_number_sign(self):
        for text,quantity,prefix,suffix in [('130','13','','0'),('13.9','13','','.9'),('-13','13','-',''),('(13)','13','(',')'),('-13 (note)','13','-',' (note)'),('(13) (note)','13','(',') (note)'),('1,013 (note)','13','1,0',' (note)')]:
            f,l=self.sample(text,quantity,prefix,suffix)
            with self.assertRaises(ValueError):validate_layout(l,f,1.7)

    def test_accounting_quantity_and_unit_remain_whole(self):
        f,l=self.sample('($13.0) (audited)','($13.0)','',' (audited)',value=-13)
        self.assertEqual(validate_layout(l,f,1.7)['sourceData']['series'][0]['values'][0],-13)

if __name__=='__main__':unittest.main()
