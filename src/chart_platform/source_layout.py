"""Source-relative chart layout, independent of document identity and sample data.

The model measures a crop. Fixed rendering code owns the theme and data bindings.
Coordinates are percentages of that crop; no source bitmap becomes an output mark.
"""
import copy
import math
from .validation_rules import violated, RuleViolation, rule_range
import re
from .chart_numbers import printed_number, parse_quantity, parse_bound_quantity
from .validation_rules import active_bundle
from .bar_arrangement import mirror_error, category_placement_error

SUPPORTED = {'chart', 'pie', 'scatter', 'curves', 'heatmap', 'boxplot', 'candlestick', 'bubble'}
PROMPT = '''Measure the INTERNAL LAYOUT of this chart crop. The supplied figure contains independently checked data; do not rewrite those facts. Return {layout:{...},warnings:[]}. This is a measurement task, not a redesign. All x/y/width/height and fontSize are PERCENTAGES of the supplied CROP (fontSize is percent of image HEIGHT). Use 0..100, not 0..1. The program substitutes OM fonts/colors, while preserving the source geometry. No code, SVG strings, URLs or images.
layout = {
  plotBox:[left,top,width,height], orientation:"vertical"|"horizontal",
  valueAxis:{domain:[min,max],reversed:boolean,scale:"linear"|"log",visible:boolean,side:"left"|"right"|"bottom"|"top",grid:boolean,ticks:[{value,text}],fontSize:number},
  categoryAxis:{visible:boolean,side:"bottom"|"top"|"left"|"right",rotation:number,fontSize:number},
  categoryPositions:[number],barWidth:number,groupGap:number,barSeriesOrder:[number],barPlacement?:"grouped"|"category",
  seriesStyles:[{series:number,geometry:"bar"|"line"|"area"|"point",marker:"none"|"circle"|"square"|"diamond"|"triangle",markerSize:number,lineWidth:number,curve:"linear"|"monotone"|"step",dashed:boolean,axis:"primary"|"secondary"}],
  legends:[{series:number,index:number,x:number,y:number,width:number,height:number,symbol:"rect"|"line"|"circle"|"diamond",textX:number,textY:number,fontSize:number}],
  texts:[{role,text,x,y,fontSize,anchor:"start"|"middle"|"end",bold:boolean,italic:boolean,rotation:number,series?:number,index?:number,item?:number,width?:number,color:"ink"|"inverse"|"muted",box?:[x,y,w,h]}],
  lines:[{points:[[x,y],...],arrowStart:boolean,arrowEnd:boolean,dashed:boolean,series?:number,width:number}],
  pie:{holeRatio:number,startAngle:number,clockwise:boolean}
}.
plotBox is the DATA drawing rectangle, excluding headings, labels and legends. For a pie it is the bounding box of the outer circle. Measure the actual aspect/proportions. A hidden numeric axis still needs the domain whose endpoints correspond exactly to plotBox edges, not arbitrary extra headroom. Stacked domain follows stack totals. Floating bars use supplied barBaselines. For horizontal bars the value axis maps LEFT to RIGHT; categoryPositions are Y coordinates. For vertical graphs categoryPositions are X coordinates. Positions follow the supplied category order, even if reversed on the source. Measure barWidth as the width of ONE bar (not entire group), in percent of the ENTIRE crop category dimension, never pixels or percent of a category band. groupGap is between adjacent bars in percent of that same dimension. A full group of bars must fit between neighboring category centers; bars from different categories cannot overlap. Preserve touching histogram bins only when the source actually touches. For a line/curve use the actual first and last point positions. For numeric X graphs (scatter/curves), also return xAxis:{domain:[min,max],scale,visible,grid,ticks:[{value,text}],fontSize}.
For numeric axes preserve direction: reversed:true means small values at the TOP for a vertical axis (e.g. rank 1 above rank 9), or at the RIGHT for a horizontal axis. Keep domain as [min,max]; never reorder source data to simulate reversed axes. This applies to valueAxis, secondaryAxis and xAxis. All markerSize and lineWidth values are percentages of crop HEIGHT, not source pixels.
Keep axis visibility and tick strings EXACT, including zeros/decimal precision/units. categoryAxis.visible means category TEXT labels are printed, not just an axis line. If category labels are individually positioned in texts, set categoryAxis.visible:false to avoid duplication. Do not treat a plotted data label as an axis tick. Only add axes/grid when present. For dual-axis graphs also return secondaryAxis using the valueAxis schema and bind each seriesStyles.axis explicitly; never put different units on one scale. Pie value/category axes are invisible.
Each data legend symbol uses binding:"series" and the zero-based series index; for pies index is the category index instead. A legend for an independent categoryCallout uses binding:"callout",item:the zero-based categoryCallouts index (never a fake series index). y is the TOP of the symbol; textY is the text BASELINE. Preserve the exact position, order, wrapping and symbol shape of EVERY legend item; do not move a top legend to the bottom. Do not repeat legend texts in texts. Omit legends when no legend is printed. Inline names along curves use role:"series-name",series:the exact series index; these are not series-annotation metrics.
Every remaining printed text belongs in texts with exact wording and source position. y is BASELINE, not top edge; multi-line text uses newline and width. role must be one of: title,caption,unit,category,value,total,series-annotation,callout,note,annotation,axis-title,point-label,free. Bind value labels with series and index; bind category and point-label with index; total with index; series-annotation with item index into figure.seriesAnnotations; callout with item and index into figure.categoryCallouts; annotation with item into chart.annotations. These bindings make edited values and names update. For scatter point-label refers to the point/category index. Value labels use the exact printed string; do not invent new labels. If source has NO value labels, do not add them. Avoid duplicating text handled by axes or legends. Include source credits/footnotes inside this crop as free text. Preserve title only if it is physically printed IN this crop, not just in supplied metadata. Do not print internal warnings or inferred titles. Inverse text is only for text printed on a dark filled mark. All other text uses ink.
lines holds source callout leaders, trend arrows and reference lines only, never data curves or bars (program draws those from numbers). Preserve endpoints and bends; arrow text is a bound annotation in texts with source rotation. A text box is theme neutral, not source colored. Do not invent arrows. Pie startAngle is measured clockwise from 12 o'clock. clockwise:false preserves COUNTERCLOCKWISE category order; clockwise:true preserves clockwise category order; preserve holeRatio, label positions and leader lines. For unfamiliar geometry keep warnings explicit; never turn it into a different graph. Return a complete layout, no prose outside JSON.'''


PROMPT+=' For heatmap, plotBox encloses the entire matrix; valueAxis/categoryAxis are invisible and no seriesStyles or numeric X axis are needed. Column and row names are drawn from the editable matrix data, so do not duplicate them in texts. Only title/caption/other notes go in texts. For boxplot and candlestick, preserve plotBox, axes, categoryPositions and ONE body barWidth; endpoint series are fields of each mark, not groups of bars. For bubble preserve two numeric axes and marker layout; circle diameters come from its editable size field. For all these types legends describe meaningful data categories, never automatically create legends for OHLC/quartile field names. Error bars are drawn from errorBars; do not duplicate them in lines.'

PROMPT+=' When a printed value/total label combines its quantity with a date, note or other annotation, keep the COMPLETE exact text and add valueTemplate:{prefix:string,quantity:string,suffix:string}. Their concatenation must equal text exactly. quantity is the complete printed numeric quantity including sign, currency, unit and accounting parentheses; it must equal the bound checked cell. prefix/suffix preserve only the independent source annotation. Do not split digits or punctuation, choose an annotation year as the value, or change checked data to fit a label. This template lets data edits update the numeric span while retaining its annotation. A plain scalar label needs no template.'

PROMPT+=' For side-by-side bars, barSeriesOrder is REQUIRED: list every bar series index exactly once in visual crop order (LEFT to RIGHT for vertical bars, TOP to BOTTOM for horizontal bars). This can differ from both data order and legend order; measure the bars themselves, never infer it from the legend or axis direction. Exclude line/point series. Preserve empty slots for null/zero values. Do not reorder data, colors, legends or value-label bindings to achieve this order. Stacked bars do not use this side-by-side order.'

PROMPT+=' If the source has exactly ONE bar centered on each category but different categories use different color/legend series, set barPlacement:"category", groupGap:0 and omit barSeriesOrder. All series share the measured categoryPositions and ONE barWidth; null cells remain null. This layout requires at most one non-null bar value per category (zero also counts). Measure the actual source: sparse side-by-side groups retain their empty series slots and must NOT use category placement merely because data contains nulls. Do not use category placement for stacks or mirrored bars.'

PROMPT+=' For two opposing magnitude series (a butterfly/population-pyramid chart), preserve the POSITIVE facts and supply mirrorBars:{directions:[-1,1]} in data-series order (swap signs if the visual sides are swapped). The signs project magnitudes onto the display axis ONLY; do not change the supplied facts. Both bars occupy the SAME category center and start at the SAME zero baseline, so groupGap is 0 and barSeriesOrder is omitted. Measure valueAxis.domain across the complete signed display extent, even if no ticks are visible; ticks retain their exact printed strings (which can show absolute magnitudes). Numeric direction uses the value axis including reversed:true, not screen left/right. This applies only to exactly two nonnegative unstacked bar series sharing one linear scale. Ordinary signed bars, side-by-side groups and stacks do not use mirrorBars. Reproduce header-only series names as bound series-name text, without inventing zero-size legend symbols.'


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def number(value, low, high, label):
    if violated('layout.source_layout.number.57443979', locals()):
        raise RuleViolation('layout.source_layout.number.57443979', f'Invalid source layout {label}')
    return value


def vector(value, length, label):
    if violated('layout.source_layout.vector.dd069f36', locals()):
        raise RuleViolation('layout.source_layout.vector.dd069f36', f'Invalid source layout {label}')
    return [number(v, *rule_range('range.-2.102'), label) for v in value]


def index(value, size, label):
    if violated('layout.source_layout.index.b76ec2bf', locals()):
        raise RuleViolation('layout.source_layout.index.b76ec2bf', f'Invalid source layout {label} binding')
    return value


def axis(raw, default_side):
    if violated('layout.source_layout.axis.07324b8b', locals()):
        raise RuleViolation('layout.source_layout.axis.07324b8b', 'Missing source numeric axis')
    domain = raw.get('domain')
    if violated('layout.source_layout.axis.5314bebe', locals()):
        raise RuleViolation('layout.source_layout.axis.5314bebe', 'Invalid source numeric domain')
    reversed_axis = raw.get('reversed') is True or domain[1] < domain[0]
    domain = sorted(domain)
    scale = raw.get('scale', 'linear')
    if violated('layout.source_layout.axis.8085c08c', locals()):
        raise RuleViolation('layout.source_layout.axis.8085c08c', 'Invalid source scale')
    ticks = raw.get('ticks', [])
    if violated('layout.source_layout.axis.3ecd09e3', locals()):
        raise RuleViolation('layout.source_layout.axis.3ecd09e3', 'Invalid source ticks')
    clean_ticks = []
    for t in ticks:
        if violated('layout.source_layout.axis.280c45b4', locals()):
            raise RuleViolation('layout.source_layout.axis.280c45b4', 'Invalid source tick')
        tick={'value': t['value'], 'text': t['text']}
        if all(finite(t.get(k)) for k in ('textX','textY')):
            tick.update(textX=number(t['textX'], *rule_range('range.-2.102'), 'tick x'),textY=number(t['textY'], *rule_range('range.-2.102'), 'tick y'),anchor='middle')
        clean_ticks.append(tick)
    side = raw.get('side', default_side)
    if violated('layout.source_layout.axis.be140005', locals()):
        raise RuleViolation('layout.source_layout.axis.be140005', 'Invalid axis side')
    return {'domain': domain, 'reversed': reversed_axis, 'scale': scale, 'visible': raw.get('visible') is True,
            'grid': raw.get('grid') is True, 'side': side, 'ticks': clean_ticks,
            'fontSize': number(raw.get('fontSize') or 2.8, *rule_range('range.0.4.12'), 'axis font'),
            **({'calibration':copy.deepcopy(raw['calibration'])} if raw.get('calibration',{}).get('method')=='ocr-tick-centers' else {})}


def bar_geometry_error(layout, figure):
    """Reject ambiguous units using category relationships, never a guessed cap."""
    if figure.get('kind')!='chart':return None
    chart=figure['chart'];n=len(chart['labels'])
    styles={s['series']:s for s in layout['seriesStyles']}
    bars=[si for si in range(len(chart['series'])) if styles.get(si,{}).get('geometry','line' if chart['kind']=='line' else 'bar')=='bar']
    bar_count=len(bars)
    mirrored=layout.get('mirrorBars') is not None
    issue=mirror_error(layout,figure,bars)
    if issue:return issue
    issue=category_placement_error(layout,figure,bars)
    if issue:return issue
    category_centered=layout.get('barPlacement')=='category'
    order=layout.get('barSeriesOrder')
    if order is not None or layout.get('barOrderRequired') and bar_count>1 and chart['kind']!='stacked-bar' and not mirrored and not category_centered:
        if (not isinstance(order,list) or any(type(si) is not int for si in order)
                or sorted(order)!=bars):
            return 'Source barSeriesOrder must list every bar series exactly once in visual crop order; remeasure bars independently of the legend'
    if not bar_count or not n:return None
    width=layout['barWidth']
    if width<=0:return 'Source bar width must be positive for visible categories'
    count=bar_count if chart['kind']!='stacked-bar' and not mirrored and not category_centered else 1
    extent=count*width+(count-1)*layout['groupGap']
    positions=sorted(layout['categoryPositions'])
    plot_size=layout['plotBox'][3 if layout['orientation']=='horizontal' else 2]
    steps=[b-a for a,b in zip(positions,positions[1:])] if positions else [plot_size/n]
    available=min(steps) if steps else plot_size
    if extent>available+active_bundle().data['visual']['categoryOverlapPercent']:
        return f'Source bar group width {extent:g}% overlaps categories spaced {available:g}%; remeasure in crop percent, not pixels or band percent'
    return None


def validate_layout(raw, figure, aspect):
    if violated('layout.source_layout.validate_layout.a456024b', locals()):
        raise RuleViolation('layout.source_layout.validate_layout.a456024b', 'Missing source layout')
    c = figure['chart']; series = c['series']; n = len(c['labels']); ns = len(series)
    out = {'version': 1, 'method': 'uploaded-crop-measurement', 'aspect': aspect}
    # Saved v1 layouts remain readable; newly extracted layouts must describe
    # group order explicitly. This flag is a contract revision, not a waiver.
    if raw.get('version')!=1 or raw.get('barOrderRequired'):out['barOrderRequired']=True
    out['plotBox'] = vector(raw.get('plotBox'), 4, 'plot box')
    x, y, w, h = out['plotBox']
    if violated('layout.source_layout.validate_layout.e2f8cdd8', locals()):
        raise RuleViolation('layout.source_layout.validate_layout.e2f8cdd8', 'Invalid source plot extent')
    out['orientation'] = raw.get('orientation', 'vertical')
    if violated('layout.source_layout.validate_layout.494dfd59', locals()):
        raise RuleViolation('layout.source_layout.validate_layout.494dfd59', 'Invalid source orientation')
    out['valueAxis'] = axis(raw.get('valueAxis', {'domain': [0, 1]}), 'left')
    for name, side in [('xAxis', 'bottom'), ('secondaryAxis', 'right')]:
        if raw.get(name):out[name] = axis(raw[name], side)
    cat = raw.get('categoryAxis', {})
    out['categoryAxis'] = {'visible': cat.get('visible') is True, 'side': cat.get('side', 'bottom'),
                          'rotation': number(cat.get('rotation', 0), *rule_range('range.-180.180'), 'category rotation'),
                          'fontSize': number(cat.get('fontSize') or 2.8, *rule_range('range.0.4.12'), 'category font')}
    positions = raw.get('categoryPositions', [])
    if violated('layout.source_layout.validate_layout.8daebe35', locals()):
        raise RuleViolation('layout.source_layout.validate_layout.8daebe35', 'Source category positions do not match data')
    out['categoryPositions'] = [number(v, *rule_range('range.0.100'), 'category center') for v in positions]
    # Non-bar plots legitimately have no bar width. Preserve that measurement.
    out['barWidth'] = number(raw.get('barWidth', 3), *rule_range('range.0.80'), 'bar width')
    out['groupGap'] = number(raw.get('groupGap', 0.3), *rule_range('range.0.30'), 'group gap')
    if 'barSeriesOrder' in raw:out['barSeriesOrder']=copy.deepcopy(raw['barSeriesOrder'])
    if 'mirrorBars' in raw:out['mirrorBars']=copy.deepcopy(raw['mirrorBars'])
    if 'barPlacement' in raw:out['barPlacement']=copy.deepcopy(raw['barPlacement'])
    out['seriesStyles'] = []
    for s in raw.get('seriesStyles', []):
        si = index(s.get('series'), ns, 'series style')
        if violated('layout.source_layout.validate_layout.eb58974c', locals()):raise RuleViolation('layout.source_layout.validate_layout.eb58974c', 'Invalid mark geometry')
        marker = s.get('marker', 'none')
        if violated('layout.source_layout.validate_layout.8d35dc3a', locals()):raise RuleViolation('layout.source_layout.validate_layout.8d35dc3a', 'Invalid marker')
        curve = s.get('curve', 'linear')
        if violated('layout.source_layout.validate_layout.efff3e5c', locals()):raise RuleViolation('layout.source_layout.validate_layout.efff3e5c', 'Invalid curve')
        if violated('layout.source_layout.validate_layout.1c4723ae', locals()):raise RuleViolation('layout.source_layout.validate_layout.1c4723ae', 'Invalid series axis')
        out['seriesStyles'].append({'series': si, 'geometry': s['geometry'], 'marker': marker,
                                    'markerSize': number(s.get('markerSize', 1.4), *rule_range('range.0.12'), 'marker size'),
                                    'lineWidth': number(s.get('lineWidth', 0.4), *rule_range('range.0.3'), 'line width'),
                                    'curve': curve, 'dashed': s.get('dashed') is True, 'axis': s.get('axis', 'primary')})
    out['legends'] = []
    # A data-table carrier is not the mark type. Never silently lose a mixed
    # series/axis when a layout response omits or contradicts its binding.
    for binding in figure.get('seriesGeometry',[]):
        matches=[s for s in out['seriesStyles'] if s['series']==binding.get('series')]
        if violated('layout.source_layout.validate_layout.a82428f2', locals()):
            raise RuleViolation('layout.source_layout.validate_layout.a82428f2', 'Source layout must preserve every series geometry and axis')
        if violated('layout.source_layout.validate_layout.1eaca5f5', locals()):
            raise RuleViolation('layout.source_layout.validate_layout.1eaca5f5', 'Secondary series needs its own numeric axis')
    geometry_issue=bar_geometry_error(out,figure)
    if violated('layout.source_layout.validate_layout.e85df2fd', locals()):raise RuleViolation('layout.source_layout.validate_layout.e85df2fd', geometry_issue)
    for l in raw.get('legends', []):
        if violated('layout.source_layout.validate_layout.a8d6d943', locals()):raise RuleViolation('layout.source_layout.validate_layout.a8d6d943', 'Too many legend items')
        binding=l.get('binding','series')
        if violated('layout.source_layout.validate_layout.6d2c75b6', locals()):raise RuleViolation('layout.source_layout.validate_layout.6d2c75b6', 'Invalid legend binding')
        li = index(l.get('item'),len(figure.get('categoryCallouts',[])),'callout legend') if binding=='callout' else index(l.get('index') if figure['kind'] == 'pie' else l.get('series'), n if figure['kind'] == 'pie' else ns, 'legend')
        symbol = l.get('symbol', 'rect')
        if violated('layout.source_layout.validate_layout.671ef117', locals()):raise RuleViolation('layout.source_layout.validate_layout.671ef117', 'Invalid legend symbol')
        out['legends'].append({'index': li, 'binding':binding, 'symbol': symbol,
                              **{k: number(l.get(k), *rule_range('range.-2.102'), 'legend ' + k) for k in ('x', 'y', 'textX', 'textY')},
                              'width': number(l.get('width', 1.5), *rule_range('range.0.1.20'), 'legend width'),
                              'height': number(l.get('height', 2.5), *rule_range('range.0.1.20'), 'legend height'),
                              'fontSize': number(l.get('fontSize', 2.8), *rule_range('range.0.4.12'), 'legend font')})
        if l.get('glyphBox'):out['legends'][-1]['glyphBox']=vector(l['glyphBox'],4,'legend glyph')
    roles = {'title', 'caption', 'unit', 'category', 'value', 'total', 'series-annotation', 'series-name', 'callout', 'note', 'annotation', 'axis-title', 'point-label', 'free'}
    out['texts'] = []
    for t in raw.get('texts', []):
        if violated('layout.source_layout.validate_layout.47e0b895', locals()):raise RuleViolation('layout.source_layout.validate_layout.47e0b895', 'Invalid source text')
        role = t.get('role')
        # Models sometimes call a standalone note box a "callout". It has no
        # category binding. Resolve that alias only when the complete wording
        # exactly matches the independently checked figure note.
        same_words=lambda s:re.sub(r'\s+',' ',str(s)).strip()
        if role=='callout' and t.get('index') is None and t.get('item') is None and figure.get('note') and same_words(t['text'])==same_words(figure['note']):role='note'
        # Inline curve names are series labels, not entries in the separate
        # per-series metric annotation table. Resolve only exact known wording.
        name_matches=[i for i,s in enumerate(series) if same_words(s['name'])==same_words(t['text'])]
        if role in ('series-annotation','free') and len(name_matches)==1:
            t={**t,'series':name_matches[0]};role='series-name'
        if role=='annotation' and not isinstance(t.get('item'),int):
            matches=[i for i,a in enumerate(c.get('annotations',[])) if same_words(a)==same_words(t['text'])]
            if len(matches)==1:t={**t,'item':matches[0]}
        if violated('layout.source_layout.validate_layout.d7d687aa', locals()):raise RuleViolation('layout.source_layout.validate_layout.d7d687aa', 'Invalid source text role')
        item = {'role': role, 'text': t['text'], 'x': number(t.get('x'), *rule_range('range.-2.102'), 'text x'),
                'y': number(t.get('y'), *rule_range('range.-2.102'), 'text y'), 'fontSize': number(t.get('fontSize'), *rule_range('range.0.4.16'), 'text font'),
                'anchor': t.get('anchor', 'start'), 'bold': t.get('bold') is True, 'italic': t.get('italic') is True,
                'rotation': number(t.get('rotation', 0), *rule_range('range.-180.180'), 'text rotation'), 'color': t.get('color', 'ink')}
        if violated('layout.source_layout.validate_layout.13259f22', locals()):raise RuleViolation('layout.source_layout.validate_layout.13259f22', 'Invalid text style')
        if role in ('value', 'category', 'point-label', 'total', 'callout'):item['index'] = index(t.get('index'), n, 'text category')
        if role == 'value':item['series'] = index(t.get('series'), ns, 'text series')
        if role == 'series-name':
            item['series']=index(t.get('series'),ns,'series name')
            if violated('layout.source_layout.validate_layout.1cd9d2bc', locals()):raise RuleViolation('layout.source_layout.validate_layout.1cd9d2bc', 'Source series label does not match its verified series')
        # Position extraction cannot introduce a different displayed number.
        if role in ('value','total'):
            expected=series[item['series']]['values'][item['index']] if role=='value' else figure.get('totals',[])[item['index']] if item['index']<len(figure.get('totals',[])) else None
            parsed=parse_bound_quantity(t['text'],t.get('valueTemplate'))
            printed=parsed['value'] if parsed['status']=='parsed' else None
            if violated('layout.source_layout.validate_layout.ec0e8ba0', locals()):
                raise RuleViolation('layout.source_layout.validate_layout.ec0e8ba0', 'Source layout numeric label does not match its verified cell',
                                    code='FORMAT_UNSUPPORTED' if parsed['status']=='unsupported' else 'FORMAT_AMBIGUOUS' if parsed['status']=='ambiguous' else 'VALUE_MISMATCH',
                                    rawText=t['text'],expected=expected,parsed=parsed,role=role)
            if t.get('valueTemplate') is not None:item['valueTemplate']=copy.deepcopy(t['valueTemplate'])
        if role in ('series-annotation', 'callout', 'annotation'):
            key = {'series-annotation':'seriesAnnotations', 'callout':'categoryCallouts', 'annotation':'annotations'}[role]
            values = c.get(key, []) if role == 'annotation' else figure.get(key, [])
            item['item'] = index(t.get('item'), len(values), role)
        if t.get('width') is not None:item['width'] = number(t['width'], *rule_range('range.0.1.102'), 'text width')
        if t.get('lineStep') is not None:item['lineStep'] = number(t['lineStep'], *rule_range('range.0.3.20'), 'text line spacing')
        if t.get('box') is not None:item['box'] = vector(t['box'], 4, 'text box')
        if t.get('glyphBox') is not None:item['glyphBox'] = vector(t['glyphBox'], 4, 'source glyph')
        if t.get('nativeFontSize') is not None:item['nativeFontSize']=number(t['nativeFontSize'], *rule_range('range.0.4.16'), 'native text font')
        out['texts'].append(item)
    # Some applications put category headings in a data-table header beneath
    # the plot. Extraction may correctly recover them from the whole page while
    # the tight chart crop excludes that row. Do not discard verified categories
    # merely because that crop ended early, and never invent absent categories.
    context_categories={e.get('columnLabel') for e in figure.get('contextEvidence',[]) if isinstance(e,dict)}
    if (n and all(c['labels']) and set(c['labels'])<=context_categories
            and not out['categoryAxis']['visible'] and not any(t['role']=='category' or t['text'] in c['labels'] for t in out['texts'])):
        out['categoryAxis'].update(visible=True,side='bottom' if out['orientation']=='vertical' else 'left')
        out['contextCategoriesDisplayed']=True
    out['bottomPadding']=max(0,y+h+out['categoryAxis']['fontSize']*1.4+2-100) if out['categoryAxis']['visible'] and out['orientation']=='vertical' else 0
    out['lines'] = []
    for l in raw.get('lines', []):
        pts = l.get('points', [])
        if violated('layout.source_layout.validate_layout.0af66106', locals()):raise RuleViolation('layout.source_layout.validate_layout.0af66106', 'Invalid source leader')
        item = {'points': [vector(p, 2, 'leader point') for p in pts], 'arrowStart': l.get('arrowStart') is True,
                'arrowEnd': l.get('arrowEnd') is True, 'dashed': l.get('dashed') is True,
                'width': number(l.get('width', 0.2), *rule_range('range.0.03.2'), 'leader width')}
        if l.get('series') is not None:item['series'] = index(l['series'], ns, 'leader series')
        out['lines'].append(item)
    if figure['kind'] == 'pie':
        p = raw.get('pie', figure.get('pieLayout', {}))
        out['pie'] = {'clockwise':p.get('clockwise',figure.get('pieLayout',{}).get('clockwise',True)) is not False,'holeRatio': number(p.get('holeRatio', 0), *rule_range('range.0.0.94'), 'pie hole'),
                      'startAngle': number(p.get('startAngle', 0), *rule_range('range.-360.360'), 'pie start')}
    # Immutable baseline is generated by code, never accepted from model/client.
    # It makes source-positioned labels track later numerical edits.
    out['sourceData'] = copy.deepcopy({'kind': c['kind'], 'title':c['title'], 'labels': c['labels'], 'series': c['series'],
                                     'totals': figure.get('totals', []), 'barBaselines': figure.get('barBaselines', [])})
    if raw.get('rasterTextMeasurement'):out['rasterTextMeasurement']=copy.deepcopy(raw['rasterTextMeasurement'])
    if raw.get('rasterMarkMeasurement'):out['rasterMarkMeasurement']=copy.deepcopy(raw['rasterMarkMeasurement'])
    if raw.get('nativeLayoutMeasurement'):out['nativeLayoutMeasurement']=copy.deepcopy(raw['nativeLayoutMeasurement'])
    out['validationRules']=active_bundle().identity
    out['numberFormats']=copy.deepcopy(active_bundle().data['numberFormats'])
    out['barGeometryTolerance']=active_bundle().data.get('visual',{}).get('categoryOverlapPercent',1e-6)
    return out


def binding_warnings(layout, figure):
    """A valid JSON shape is not proof that every source label was preserved."""
    warnings = []
    c = figure['chart']; pie = figure['kind'] == 'pie'
    if c.get('presentation', {}).get('legend'):
        expected = set(range(len(c['labels']) if pie else len(c['series'])))
        actual = {l['index'] for l in layout['legends'] if l.get('binding','series')=='series'}|{t['series'] for t in layout['texts'] if t['role']=='series-name'}
        if violated('layout.source_layout.binding_warnings.d3639714', locals()):warnings.append('部分系列图例缺少来源位置。')
    if figure.get('nativePlot') and figure.get('kind') in ('scatter','curves'):
        # Axis ticks can equal a derived X/Y value. Their number appearing on
        # the PDF is not evidence that the corresponding mark has a label.
        return warnings
    if figure.get('kind')=='heatmap' and figure.get('matrix',{}).get('showValues'):
        # The matrix renderer binds every cell label directly to its numeric
        # table. Separate OCR rectangles would duplicate those labels.
        return warnings
    for si, row in enumerate(figure.get('valueLabels', [])):
        for ci, label in enumerate(row):
            text = label.get('text') if isinstance(label, dict) else label
            if text and not any(t['role'] == 'value' and t.get('series') == si and t.get('index') == ci for t in layout['texts']):
                warnings.append('部分原图数值标签缺少位置，需重新核对。');return warnings
    return warnings
