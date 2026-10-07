"""Editable data contracts for matrix, interval and multivariate marks."""
import math
from .validation_rules import violated, RuleViolation, rule_range

KINDS={'heatmap','boxplot','candlestick','bubble'}
PROMPT='''Additional supported numeric chart types (do NOT report these as unsupported gaps):
All use the SAME chart table and source/provenance rules as other charts. chart.kind is "grouped-bar" only as an editable numeric table carrier, never the output geometry.
Heatmap: kind:"heatmap", chart.labels are exact column labels; one series per matrix ROW, series.name is its exact row label and values are cells in column order. Copy annotated numeric cells exactly. Unlabelled cells stay null unless a printed color scale supports program-calibrated measurements. matrix:{showValues:boolean,colorDomain:[min,max],colorTicks:[{value,text}],colorBar:boolean}. Preserve all rows and columns. The renderer supplies cell geometry from the matrix, not a bar chart. An unannotated heatmap with no numeric color scale cannot establish numeric cell values; say so.
Box plot: kind:"boxplot", chart.labels are category names; series are "Lower whisker","Q1","Median","Q3","Upper whisker" in that order, plus one series "Outlier 1", "Outlier 2", etc. for each visible outlier per category, null when absent. Use rasterPlot points to CALIBRATE each visible summary endpoint from a numeric axis; do not fabricate hidden raw observations. fields:{lower:0,q1:1,median:2,q3:3,upper:4,outliers:[5,...]}. Keep horizontal orientation when source uses it. Note that the editable values describe the displayed summary, not the unavailable original observations.
Candlestick/OHLC: kind:"candlestick", chart.labels are the exact dates/categories; series "Open","High","Low","Close" with fields:{open:0,high:1,low:2,close:3}. Use printed values or rasterPlot points on the actual price axis; each of these four endpoint series is independently bound. Never collapse OHLC into one price series. Preserve the source order, missing trading dates, body widths and wick positions.
Bubble: kind:"bubble", chart.labels are point names (blank if unnamed). series "X","Y","Marker diameter (% image height)"; fields:{x:0,y:1,size:2}. rasterPlot points use the scatter contract to calibrate X/Y. bubbleMeasurements:[{index,x,y,diameter,color}] are source percent coordinates and source hex colors. diameter is the visible marker diameter, not an invented business size value; the program stores it explicitly as a measured visual field. If the source has an actual printed size legend, preserve its numeric meaning as additional data and notes. Preserve color group names in pointGroups:[string], one per point, using the printed legend; unknown groups are blank.
Stacked area: kind:"chart", chart.kind:"stacked-bar", stackedArea:true; seriesGeometry uses geometry:"area". rasterPlot points include both baseY and y for each stacked band (or baseX and x for horizontal). All series share the same categories. The renderer stacks editable values, never draws overlapping unstacked areas.
Error bars: preserve errorBars:[{series,index,axis:"x"|"y",low,high}] for explicitly printed lower/upper ENDPOINTS. Unprinted endpoints use rasterErrorBars:[{series,index,axis,lowPosition,highPosition}] measured in crop percent on the calibrated axis; the program calculates approximate endpoints. Error bars are data, not decorative source-layout lines. Do not draw them twice.
'''


def validate_advanced(figure):
    kind=figure.get('kind');chart=figure.get('chart',{});series=chart.get('series',[]);count=len(series)
    required={'candlestick':['open','high','low','close'],'boxplot':['lower','q1','median','q3','upper'],'bubble':['x','y','size']}.get(kind,[])
    fields=figure.get('fields',{})
    for key in required:
        v=fields.get(key)
        if violated('data-binding.advanced_charts.validate_advanced.33a433e8', locals()):raise RuleViolation('data-binding.advanced_charts.validate_advanced.33a433e8', 'Missing editable ' + kind + ' field: ' + key)
    if violated('data-binding.advanced_charts.validate_advanced.32b4793a', locals()):raise RuleViolation('data-binding.advanced_charts.validate_advanced.32b4793a', 'Distinct mark fields must use distinct data columns')
    if kind=='boxplot':
        outliers=fields.get('outliers',[])
        if violated('data-binding.advanced_charts.validate_advanced.7ec42989', locals()):
            raise RuleViolation('data-binding.advanced_charts.validate_advanced.7ec42989', 'Invalid editable outlier column binding')
    if kind in ('boxplot','candlestick'):
        for row in range(len(chart['labels'])):
            values={k:series[fields[k]]['values'][row] for k in required}
            if any(v is None for v in values.values()):continue
            order=['lower','q1','median','q3','upper'] if kind=='boxplot' else ['low','open','high']
            if violated('data-binding.advanced_charts.validate_advanced.6c9833fc', locals()):
                raise RuleViolation('data-binding.advanced_charts.validate_advanced.6c9833fc', 'Source interval endpoints are not ordered; recheck their numeric axis')
    if kind=='heatmap':
        matrix=figure.setdefault('matrix',{});domain=matrix.get('colorDomain')
        if not isinstance(domain,list) or len(domain)!=2 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in domain) or domain[0]>=domain[1]:
            known=[v for s in series for v in s['values'] if v is not None]
            if violated('data-binding.advanced_charts.validate_advanced.df5548db', locals()):raise RuleViolation('data-binding.advanced_charts.validate_advanced.df5548db', 'No readable numeric matrix cells')
            matrix['colorDomain']=[min(known),max(known) if max(known)>min(known) else min(known)+1]
        matrix['showValues']=matrix.get('showValues') is True
    for error in figure.get('errorBars',[]):
        if violated('data-binding.advanced_charts.validate_advanced.e2f21dc7', locals()):
            raise RuleViolation('data-binding.advanced_charts.validate_advanced.e2f21dc7', 'Invalid error-bar data binding')
        if violated('data-binding.advanced_charts.validate_advanced.374cea16', locals()):raise RuleViolation('data-binding.advanced_charts.validate_advanced.374cea16', 'Invalid error-bar endpoints')


def bind_visual_fields(figure):
    """Keep measured bubble sizes separate from inferred underlying quantities."""
    from .raster_measurements import calibration,value_at
    chart=figure.get('chart');r=figure.get('rasterPlot',{})
    if not chart:return
    if figure.get('kind')=='bubble':
        fields=figure.get('fields',{});si=fields.get('size',2)
        for point in figure.get('bubbleMeasurements',[]):
            i=point.get('index');d=point.get('diameter')
            if type(i) is int and 0<=i<len(chart['labels']) and isinstance(d,(int,float)) and math.isfinite(d) and 0<d<=100 and 0<=si<len(chart['series']):
                chart['series'][si]['values'][i]=d
        chart.setdefault('warnings',[]).append('气泡大小保存为原图中可测量的直径；未据此推断未标出的业务数值。')
    errors=[]
    for row in figure.get('rasterErrorBars',[]):
        axis=row.get('axis');si=row.get('series')
        if axis not in ('x','y'):continue
        secondary=any(s.get('series')==si and s.get('axis')=='secondary' for s in figure.get('seriesGeometry',[]))
        key=('secondary'+axis.upper()) if secondary else axis
        try:
            cal=calibration(r.get(key+'Ticks'),r.get(key+'Scale','linear'))
            values=sorted(value_at(cal,row[k]) for k in ('lowPosition','highPosition'))
        except (ValueError,KeyError,TypeError):continue
        errors.append({k:row[k] for k in ('series','index','axis')}|{'low':values[0],'high':values[1],'valueStatus':'coordinate-derived-estimate','calibration':cal})
    if errors:
        figure['errorBars']=errors
        chart.setdefault('warnings',[]).append('误差线端点由原图刻度和位置换算，属于近似值。')
