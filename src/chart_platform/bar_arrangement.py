"""Source-measured opposing bars; drawing direction is not a negative fact."""
import math
import statistics


def category_placement_error(layout, figure, bars):
    """Color series may share category centers only when explicitly measured.

    Nulls alone cannot distinguish a sparse grouped chart from this layout.
    A zero is still an observation and must retain its own category binding.
    """
    placement = layout.get('barPlacement')
    if placement is None or placement == 'grouped':
        return None
    if placement != 'category':
        return 'Source barPlacement must be category or grouped'
    chart = figure['chart']
    if not bars or chart['kind'] == 'stacked-bar' or layout.get('mirrorBars') is not None:
        return 'Category-centered bars require unstacked, non-mirrored bar series'
    if len(layout.get('categoryPositions', [])) != len(chart['labels']):
        return 'Category-centered bars require one measured center per category'
    if layout.get('groupGap', 0) != 0:
        return 'Category-centered bars have no side-by-side group gap'
    for i in range(len(chart['labels'])):
        if sum(chart['series'][si]['values'][i] is not None for si in bars) > 1:
            return 'Category-centered bars require at most one present bar per category; use measured grouped slots for multiple bars'
    return None


def mirror_error(layout, figure, bars):
    mirror = layout.get('mirrorBars')
    if mirror is None:
        return None
    if not isinstance(mirror, dict):
        return 'Source mirrorBars must contain explicit series directions'
    directions = mirror.get('directions')
    chart = figure['chart']
    if (figure.get('kind') != 'chart' or chart['kind'] == 'stacked-bar'
            or bars != list(range(2)) or len(chart['series']) != 2):
        return 'Mirrored bars require exactly two unstacked bar series'
    if (not isinstance(directions, list) or len(directions) != 2
            or any(type(v) is not int for v in directions) or sorted(directions) != [-1, 1]):
        return 'Mirrored bars require one negative and one positive drawing direction'
    if any(v is not None and (not isinstance(v, (int, float)) or isinstance(v, bool)
            or not math.isfinite(v) or v < 0) for s in chart['series'] for v in s['values']):
        return 'Mirrored magnitudes must remain nonnegative; signed data uses an ordinary signed axis'
    axis = layout['valueAxis']
    if axis['scale'] != 'linear' or not axis['domain'][0] < 0 < axis['domain'][1]:
        return 'Mirrored bars need a linear display axis spanning both sides of zero'
    if figure.get('barBaselines') or any(s.get('axis', 'primary') != 'primary' for s in layout['seriesStyles']):
        return 'Mirrored bars share one zero baseline and one numeric scale'
    return None


def measure_mirror(measurements, figure, layout, value_pixels, category_pixels):
    """Recover only a coherent shared edge and opposite source-colored spans.

    At least two complete categories and a common pixels-per-unit ratio must
    support the result. Ordinary signed/grouped/stacked bars are left alone.
    No source names or corpus answers participate in this decision.
    """
    chart = figure['chart']
    styles = layout.get('seriesStyles', [])
    if (layout.get('barPlacement') == 'category' or chart['kind'] == 'stacked-bar' or len(chart['series']) != 2
            or len(styles) != 2 or sorted(s.get('series', -1) for s in styles) != [0, 1]
            or any(s.get('geometry') != 'bar' or s.get('axis', 'primary') != 'primary' for s in styles)
            or figure.get('barBaselines') or layout.get('valueAxis', {}).get('scale', 'linear') != 'linear'):
        return None
    if any(v is not None and (not isinstance(v, (int, float)) or isinstance(v, bool)
            or not math.isfinite(v) or v < 0) for s in chart['series'] for v in s['values']):
        return None
    marks = {m['series']: {p['index']: p for p in m['marks'] if p.get('span')}
             for m in measurements if m['geometry'] == 'bar'}
    if set(marks) != {0, 1}:
        return None
    paired = sorted(set(marks[0]) & set(marks[1]))
    if len(paired) < 2:
        return None
    edge_tolerance = 2.1 / value_pixels * 100
    center_tolerance = 2.1 / category_pixels * 100
    for si in (0, 1):
        lengths = [marks[si][i]['span'][1] - marks[si][i]['span'][0] for i in paired]
        # A constant-width first stack has two constant edges: source pixels
        # alone cannot prove which one is the intended zero baseline.
        if max(lengths) - min(lengths) <= edge_tolerance:
            return None
    if any(abs(marks[0][i]['center'] - marks[1][i]['center']) > center_tolerance for i in paired):
        return None
    # A lower-coordinate bar must end exactly where its peer starts, across
    # multiple rows. A stacked pair with varying seams does not meet this test.
    candidates = []
    for low_series in (0, 1):
        high_series = 1 - low_series
        edges = [marks[low_series][i]['span'][1] for i in paired]
        edges += [marks[high_series][i]['span'][0] for i in paired]
        if max(edges) - min(edges) > edge_tolerance:
            continue
        baseline = statistics.median(edges)
        scales = []
        evidence = []
        for si in (0, 1):
            for i, mark in marks[si].items():
                value = chart['series'][si]['values'][i]
                if value is None or value <= 0:
                    continue
                lo, hi = mark['span']
                edge = hi if si == low_series else lo
                if abs(edge - baseline) > edge_tolerance:
                    break
                scale = (hi - lo) / value
                scales.append(scale)
                evidence.append({'series': si, 'index': i, 'span': [lo, hi], 'value': value})
            else:
                continue
            break
        else:
            if len(scales) < 4:
                continue
            scale = statistics.median(scales)
            # Pixel quantization can dominate a very short bar; tolerate only
            # two pixels plus 2.5% of the source length, not arbitrary drift.
            if any(abs((e['span'][1] - e['span'][0]) - e['value'] * scale)
                   > edge_tolerance + (e['span'][1] - e['span'][0]) * .025 for e in evidence):
                continue
            candidates.append((low_series, baseline, scale, evidence))
    if len(candidates) != 1:
        return None
    low_series, baseline, scale, evidence = candidates[0]
    axis = layout['valueAxis']
    horizontal = layout.get('orientation') == 'horizontal'
    natural_direction = (1 if horizontal else -1) * (-1 if axis.get('reversed') else 1)
    directions = [0, 0]
    directions[low_series] = -natural_direction
    directions[1 - low_series] = natural_direction
    start = layout['plotBox'][0 if horizontal else 1]
    end = start + layout['plotBox'][2 if horizontal else 3]
    axis['domain'] = sorted([(start - baseline) / (scale * natural_direction),
                             (end - baseline) / (scale * natural_direction)])
    layout['mirrorBars'] = {'directions': directions}
    layout['groupGap'] = 0
    layout.pop('barSeriesOrder', None)
    for i in paired:
        layout['categoryPositions'][i] = statistics.mean([marks[0][i]['center'], marks[1][i]['center']])
    return {'method': 'source-shared-edge-opposite-spans', 'baseline': baseline,
            'percentPerUnit': scale, 'directions': directions, 'pairedCategories': paired,
            'observations': evidence}
