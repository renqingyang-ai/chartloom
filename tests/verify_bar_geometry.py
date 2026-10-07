"""Generic source-shape regressions: stray glyphs, grouping and unit mistakes."""
import copy
import io
import unittest
from PIL import Image, ImageDraw, ImageFont
from chart_platform.raster_geometry import measure_marks, measured_bar_order
from chart_platform.source_layout import validate_layout
import verify_source_layout as layout_checks


class BarGeometryChecks(unittest.TestCase):
    def source(self, horizontal=False, grouped=False):
        image = Image.new('RGB', (600, 360), 'white')
        draw = ImageDraw.Draw(image)
        colors = ['#6198bd', '#a36579'] if grouped else ['#6198bd']
        centers = [22, 47, 72]
        figure = {'kind': 'chart', 'chart': {'kind': 'grouped-bar' if grouped else 'bar',
            'title': 'Independent source', 'labels': ['A', 'B', 'C'],
            'series': [{'name': str(si), 'values': [14, -8, 25]} for si in range(len(colors))]},
            'seriesColors': [{'name': str(si), 'color': c} for si, c in enumerate(colors)]}
        for si, color in enumerate(colors):
            for i, center in enumerate(centers):
                at = center * 6 + ((si-.5)*30 if grouped else 0)
                # 24px width = 4% of category dimension; grouped gap = 1%.
                y = 85 + i*19
                draw.rectangle((at-12, y, at+11, 300), fill=color)
        # Same-color tick text inside the plot is not an additional data bar.
        font = ImageFont.load_default(size=19)
        for y in (105, 170, 235):draw.text((557, y), '8.00', fill=colors[0], font=font)
        layout = {'plotBox': [8, 12, 91, 74], 'categoryPositions': centers,
                  'barWidth': 35, 'groupGap': 11,
                  'orientation': 'horizontal' if horizontal else 'vertical',
                  'valueAxis': {'domain': [-10, 30]},
                  'seriesStyles': [{'series': i, 'geometry': 'bar'} for i in range(len(colors))]}
        if horizontal:
            image = image.transpose(Image.Transpose.TRANSPOSE)
            layout['plotBox'] = [12, 8, 74, 91]
        buffer = io.BytesIO(); image.save(buffer, format='PNG')
        return buffer.getvalue(), figure, layout

    def test_same_color_axis_glyphs_do_not_cancel_all_width_measurements(self):
        for horizontal in (False, True):
            image, figure, layout = self.source(horizontal)
            measured = measure_marks(image, figure, layout)
            self.assertAlmostEqual(measured['barWidth'], 4)
            self.assertEqual(measured['rasterMarkMeasurement']['series'][0]['bars'], 3)

    def test_grouped_bar_gap_comes_from_measured_source_centers(self):
        for horizontal in (False, True):
            image, figure, layout = self.source(horizontal, True)
            measured = measure_marks(image, figure, layout)
            self.assertAlmostEqual(measured['barWidth'], 4)
            self.assertAlmostEqual(measured['groupGap'], 1)
            for actual, expected in zip(measured['categoryPositions'], [22-1/12,47-1/12,72-1/12]):
                self.assertAlmostEqual(actual, expected)

    def test_percent_width_cannot_overlap_different_categories(self):
        helper = layout_checks.UploadLayoutChecks()
        for horizontal in (False, True):
            figure, layout = helper.figure(), helper.layout()
            layout.update(barWidth=35, orientation='horizontal' if horizontal else 'vertical')
            with self.assertRaisesRegex(ValueError, 'bar.*categor'):
                validate_layout(layout, figure, 2)

    def test_grouped_width_includes_all_bar_series_but_not_line_series(self):
        helper = layout_checks.UploadLayoutChecks(); figure, layout = helper.figure(), helper.layout()
        figure['chart']['kind'] = 'grouped-bar'
        figure['chart']['series'].append({'name': 'Other', 'values': [5, 10]})
        layout.update(barWidth=18, groupGap=0)
        layout['seriesStyles'].append({'series':1,'geometry':'bar'})
        layout['barSeriesOrder']=[0,1]
        with self.assertRaisesRegex(ValueError, 'bar.*categor'):
            validate_layout(layout, figure, 2)
        layout['seriesStyles'][1]['geometry'] = 'line'
        layout['barSeriesOrder']=[0]
        self.assertEqual(validate_layout(layout, figure, 2)['barWidth'],18)

    def test_histogram_touching_and_stacked_series_are_not_false_overlap(self):
        helper = layout_checks.UploadLayoutChecks(); figure, layout = helper.figure(), helper.layout()
        layout.update(barWidth=34, groupGap=0)
        self.assertEqual(validate_layout(layout, figure, 2)['barWidth'],34)
        figure['chart']['kind'] = 'stacked-bar'
        figure['chart']['series'].append({'name':'Upper', 'values':[3,9]})
        layout['seriesStyles'].append({'series':1,'geometry':'bar'})
        self.assertEqual(validate_layout(layout, figure, 2)['barWidth'],34)

    def test_visual_bar_order_is_independent_of_legend_and_orientation(self):
        for horizontal in (False, True):
            for order in ([3,2,1,0],[2,0,3,1],[0,1,2,3]):
                image=Image.new('RGB',(600,400),'white');draw=ImageDraw.Draw(image)
                colors=['#6198bd','#a36579','#53a37e','#824ca8'];centers=[22,47,72]
                figure={'kind':'chart','chart':{'kind':'grouped-bar','title':'Synthetic unseen geometry','labels':['A','B','C'],
                    'series':[{'name':str(si),'values':[10+si, None if si==0 else 20+si,30+si]} for si in range(4)]},
                    'seriesColors':[{'name':str(si),'color':color} for si,color in enumerate(colors)]}
                for rank,si in enumerate(order):
                    for i,center in enumerate(centers):
                        if figure['chart']['series'][si]['values'][i] is None:continue
                        at=center*6+(rank-1.5)*15
                        draw.rectangle((int(at-6),120+i*30,int(at+5),320),fill=colors[si])
                # A thin same-color fragment closer to the category hint than
                # the bar must not determine a group's center or series order.
                draw.rectangle((130,75,131,85),fill=colors[order[-1]])
                layout={'plotBox':[8,12,83,73],'categoryPositions':centers[:],'barWidth':9,'groupGap':4,
                    'orientation':'horizontal' if horizontal else 'vertical','valueAxis':{'domain':[0,40]},
                    'seriesStyles':[{'series':si,'geometry':'bar'} for si in range(4)]}
                if horizontal:
                    image=image.transpose(Image.Transpose.TRANSPOSE);layout['plotBox']=[12,8,73,83]
                buffer=io.BytesIO();image.save(buffer,format='PNG');before=copy.deepcopy(figure)
                measured=measure_marks(buffer.getvalue(),figure,layout)
                self.assertEqual(measured.get('barSeriesOrder'),list(order), measured)
                self.assertAlmostEqual(measured['barWidth'],2)
                self.assertAlmostEqual(measured['groupGap'],.5)
                self.assertEqual(figure,before,'Measurement must not rewrite values or series order')
                for i,center in enumerate(measured['categoryPositions']):
                    self.assertAlmostEqual(center,centers[i]-1/6,places=4)

    def test_partial_groups_can_establish_order_without_guessing(self):
        measured=measured_bar_order({0:[(2,2,10),(0,2,13)],1:[(0,2,30),(1,2,33)]},[0,1,2])
        self.assertEqual(measured['order'],[2,0,1])
        self.assertIsNone(measured_bar_order({0:[(0,2,10),(1,2,13)],1:[(1,2,20),(0,2,23)]},[0,1]))
        self.assertIsNone(measured_bar_order({0:[(0,2,10)]},[0,1]))

    def test_bar_order_schema_rejects_missing_duplicate_or_foreign_series(self):
        helper=layout_checks.UploadLayoutChecks();figure,layout=helper.figure(),helper.layout()
        figure['chart']['kind']='grouped-bar';figure['chart']['series'].append({'name':'Other','values':[5,10]})
        layout['seriesStyles'].append({'series':1,'geometry':'bar'})
        for order in (None,[],[0,0],[0,2],[False,1],['0',1]):
            candidate=copy.deepcopy(layout)
            if order is not None:candidate['barSeriesOrder']=order
            with self.assertRaisesRegex(ValueError,'barSeriesOrder'):validate_layout(candidate,figure,2)
        layout['barSeriesOrder']=[1,0]
        self.assertEqual(validate_layout(layout,figure,2)['barSeriesOrder'],[1,0])


if __name__ == '__main__':unittest.main()
