"""No source images or model-generated numeric values are needed on the data path."""
import copy
import unittest
from chart_platform.data_creation import bind, numeric, table_from, DesignPlan

SOURCE = dict(kind='spreadsheet', fileName='test.csv', locator='Table', sha256='a'*64, importedAt='2026-10-05T00:00:00Z', asOf='')


def plan(kind='bar', **extra):
    return dict(kind=kind, title='Revenue', category='Quarter', series=[{'column': 'Revenue'}], **extra)


class DataCreationTests(unittest.TestCase):
    def test_quoted_csv_and_clipboard_preserve_precision_negatives_blanks(self):
        table = table_from('Quarter,Revenue\n"Q1, actual","1,234.56789"\nQ2,(20.75)\nQ3,\n')
        element = bind(table, plan(), SOURCE)
        self.assertEqual(element['chart']['labels'], ['Q1, actual', 'Q2', 'Q3'])
        self.assertEqual(element['chart']['series'][0]['values'], [1234.56789, -20.75, None])
        self.assertEqual(table_from('Quarter\tRevenue\nQ1\t12.5')['rows'], [['Q1', '12.5']])

    def test_json_object_order_does_not_reassign_columns(self):
        table = table_from([{'Quarter': 'Q1', 'Revenue': 12}, {'Revenue': 35, 'Quarter': 'Q2'}])
        self.assertEqual(bind(table, plan(), SOURCE)['chart']['series'][0]['values'], [12, 35])

    def test_model_cannot_return_numbers_or_executable_plan(self):
        for invalid in [plan(values=[999]), plan(code='exec(...)'), plan() | {'series': [{'column':'Revenue', 'values':[999]}]}]:
            with self.assertRaises(ValueError): DesignPlan.model_validate(invalid)

    def test_model_cannot_reference_missing_columns(self):
        with self.assertRaisesRegex(ValueError, '不存在'):
            bind(table_from('Quarter,Other\nQ1,1'), plan(), SOURCE)

    def test_bindings_record_original_cell_rows_and_keep_input_immutable(self):
        table = table_from('Quarter,Revenue\nQ1,12.3\nQ2,19.8')
        original = copy.deepcopy(table)
        e = bind(table, plan(), SOURCE)
        self.assertEqual(e['dataBinding']['cells'][0][1], {'column':'Revenue', 'rows':[3], 'operation':'none'})
        e['chart']['series'][0]['values'][0] = 999
        self.assertEqual(table, original)

    def test_dual_axis_percent_remains_percentage_points(self):
        table = table_from('Quarter,Revenue,Margin\nQ1,120,18.2%\nQ2,135,20.40%')
        p = plan('combo') | {'series':[{'column':'Revenue','geometry':'bar'}, {'column':'Margin','geometry':'line','axis':'secondary'}]}
        e = bind(table, p, SOURCE)
        self.assertEqual(e['chart']['series'][1]['values'], [18.2, 20.4])
        self.assertEqual(e['figure']['dataDesign']['secondaryUnit'], '%')

    def test_percent_cannot_silently_share_money_axis(self):
        table = table_from('Quarter,Revenue,Margin\nQ1,120,18.2%')
        with self.assertRaisesRegex(ValueError, '分别使用坐标轴'):
            bind(table, plan('grouped-bar') | {'series':[{'column':'Revenue'},{'column':'Margin'}]}, SOURCE)

    def test_mixed_percent_notation_rejected(self):
        with self.assertRaisesRegex(ValueError, '混用'):
            bind(table_from('Quarter,Revenue\nQ1,20%\nQ2,0.25'), plan(), SOURCE)

    def test_explicit_aggregation_retains_row_lineage(self):
        table = table_from('Quarter,Revenue\nQ1,10\nQ1,20\nQ2,5')
        e = bind(table, plan(aggregation='sum'), SOURCE)
        self.assertEqual(e['chart']['series'][0]['values'], [30, 5])
        self.assertEqual(e['dataBinding']['cells'][0][0]['rows'], [2, 3])
        mean = bind(table, plan(aggregation='mean'), SOURCE)
        self.assertEqual(mean['chart']['series'][0]['values'], [15, 5])
        with self.assertRaisesRegex(ValueError, '重复'):
            bind(table, plan(), SOURCE)

    def test_missing_group_member_is_not_zero_or_partial_total(self):
        e = bind(table_from('Quarter,Revenue\nQ1,10\nQ1,\nQ2,5'), plan(aggregation='sum'), SOURCE)
        self.assertEqual(e['chart']['series'][0]['values'], [None, 5])

    def test_invalid_numeric_cell_is_not_dropped(self):
        with self.assertRaisesRegex(ValueError, '第 3 行'):
            bind(table_from('Quarter,Revenue\nQ1,10\nQ2,N/A'), plan(), SOURCE)
        for value in [True, float('nan'), float('inf'), '1,23', '12.3.4']:
            with self.assertRaises(ValueError): numeric(value)

    def test_pie_requires_valid_part_to_whole(self):
        for values in ['-1\nQ2,3', '\nQ2,3', '0\nQ2,0']:
            with self.assertRaises(ValueError):
                bind(table_from('Quarter,Revenue\nQ1,'+values), plan('pie'), SOURCE)

    def test_scatter_keeps_xy_values_and_missing_points(self):
        table = table_from('Quarter,Revenue\n2,10\n3,15\n4,')
        e = bind(table, plan('scatter'), SOURCE)
        self.assertEqual(e['chart']['series'][0]['values'], [2,3,4])
        self.assertEqual(e['chart']['series'][1]['values'], [10,15,None])

    def test_invalid_table_is_not_silently_padded_or_deduplicated(self):
        for value in ['A,A\nx,1', 'A,B\nx,1,3', [{'A':1, 'B':2},{'A':3}], {'columns':['A','B'],'rows':[[1,True]]}]:
            with self.assertRaises(ValueError): table_from(value)


if __name__ == '__main__': unittest.main()
