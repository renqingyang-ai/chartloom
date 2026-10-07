"""Calibrate screenshot measurements against printed axes; never claim exact facts.

Vision returns source-relative positions, not invented numeric facts. The program
fits the scale, keeps printed values, and records every estimated data cell.
"""
import math
from .validation_rules import violated, RuleViolation, rule_range
import copy

PROMPT = '''For an IMAGE chart without native numeric caches, retain all printed numbers exactly. If some values are not printed BUT the source has at least TWO readable numeric ticks on the applicable axis, you may supply rasterPlot to let the PROGRAM calibrate approximate values. Do not guess numbers directly. Return chart data with null in unprinted cells and rasterPlot:{orientation:"vertical"|"horizontal",xTicks:[{position,value}],yTicks:[{position,value}],xScale:"linear"|"log",yScale:"linear"|"log",points:[{series,index,x,y,baseX?,baseY?}]}. Coordinates are percentages of the SELECTED CROP; tick position and mark center/end use the same 0..100 coordinate frame. y grows DOWN. xTicks positions are horizontal, yTicks vertical. Each point refers to zero-based chart series and category index. For stacked/floating bars include baseY (vertical) or baseX (horizontal) for the other end of the segment. For ordinary bars the baseline is zero. For lines, measure each plotted point at the category. Preserve missing points as null; do not interpolate across absent data. If ticks or positions cannot be read, leave null and flag.
For raster scatter return kind:"scatter" and a chart:{kind:"grouped-bar",title,unit,labels:[point names],series:[{name:"X",values:[printed x or null]},{name:"Y",values:[printed y or null]}],warnings:[],annotations:[],presentation:{valueAxis:true,grid,legend:false,trendArrow:false}}. rasterPlot.points has ONE record per point with series:0, index, x, y. The program supplies approximate X and Y. Preserve marker labels, including an empty label if unnamed; do not fabricate names.
For raster numeric curves return kind:"curves", chart:{kind:"line",title,unit,labels:[numeric x tick strings],series:[{name,values:[printed y or null]}],warnings:[],annotations:[],presentation:{valueAxis:true,grid,legend,trendArrow:false}}, rasterPlot.points with one record per series and selected x tick, and both calibrated axes. Native PDF scatter/curve evidence, when available, takes precedence; use its nativeId schema instead. An approximate coordinate is NEVER an exact printed value; the program labels estimates and keeps their positions/ticks for audit.'''
PROMPT+=' For dual-axis charts yTicks/xTicks describe PRIMARY axes; add secondaryYTicks/secondaryXTicks and secondaryYScale/secondaryXScale for SECONDARY axes. Every seriesGeometry.axis binding controls its own calibration. Never calibrate two different units with one axis. Supply coordinates for EVERY visible mark lacking an exact value. Printed values and an explicitly matching table in the full-page context take priority over calibration; do not add table numbers as printed-on-chart valueLabels. Do not use baseY/baseX for a ordinary bar merely because the plot is truncated above zero: an ordinary bar encodes its endpoint, while a floating or stacked segment encodes the difference between two endpoints.'


def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)


def calibration(ticks,scale):
    if violated('axis-calibration.raster_measurements.calibration.27343977', locals()):raise RuleViolation('axis-calibration.raster_measurements.calibration.27343977', 'Screenshot estimates need at least two readable axis ticks')
    if violated('axis-calibration.raster_measurements.calibration.b216336b', locals()):raise RuleViolation('axis-calibration.raster_measurements.calibration.b216336b', 'Unsupported screenshot axis scale')
    pairs=[]
    for t in ticks:
        p,v=t.get('position'),t.get('value')
        if violated('axis-calibration.raster_measurements.calibration.72c33a18', locals()):raise RuleViolation('axis-calibration.raster_measurements.calibration.72c33a18', 'Invalid screenshot tick')
        pairs.append((p,math.log10(v) if scale=='log' else v))
    pairs.sort()
    if violated('axis-calibration.raster_measurements.calibration.13b85b1a', locals()):raise RuleViolation('axis-calibration.raster_measurements.calibration.13b85b1a', 'Screenshot ticks are too close to calibrate')
    diffs=[b[1]-a[1] for a,b in zip(pairs,pairs[1:])]
    if violated('axis-calibration.raster_measurements.calibration.46874ce5', locals()):raise RuleViolation('axis-calibration.raster_measurements.calibration.46874ce5', 'Screenshot ticks are not monotonic')
    mx=sum(p for p,_ in pairs)/len(pairs);my=sum(v for _,v in pairs)/len(pairs)
    slope=sum((p-mx)*(v-my) for p,v in pairs)/sum((p-mx)**2 for p,_ in pairs);offset=my-slope*mx
    span=max(v for _,v in pairs)-min(v for _,v in pairs)
    if violated('axis-calibration.raster_measurements.calibration.f26bb282', locals()):raise RuleViolation('axis-calibration.raster_measurements.calibration.f26bb282', 'Screenshot ticks do not agree on one scale')
    return {'slope':slope,'offset':offset,'scale':scale,'domain':[min(t['value'] for t in ticks),max(t['value'] for t in ticks)],'ticks':copy.deepcopy(ticks)}


def value_at(cal,position):
    if violated('axis-calibration.raster_measurements.value_at.1ca122fd', locals()):raise RuleViolation('axis-calibration.raster_measurements.value_at.1ca122fd', 'Invalid screenshot mark position')
    raw=cal['slope']*position+cal['offset']
    return 10**raw if cal['scale']=='log' else raw


def bind_raster(figure):
    r=figure.get('rasterPlot')
    if not r:return figure
    c=figure.get('chart')
    if violated('axis-calibration.raster_measurements.bind_raster.013478d9', locals()):raise RuleViolation('axis-calibration.raster_measurements.bind_raster.013478d9', 'Screenshot measurements need an editable data table')
    horizontal=r.get('orientation')=='horizontal';scatter=figure.get('kind') in ('scatter','bubble')
    scales={}
    def calibrated(key,secondary=False):
        prefix=('secondary'+key.upper()) if secondary else key
        if prefix not in scales:scales[prefix]=calibration(r.get(prefix+'Ticks'),r.get(prefix+'Scale','linear'))
        return scales[prefix]
    cx=calibrated('x') if scatter or figure.get('kind')=='curves' else None
    cy=calibrated('y') if scatter or figure.get('kind')=='curves' else None
    estimates=[];seen=set()
    for p in r.get('points',[]):
        si,i=p.get('series'),p.get('index')
        if violated('axis-calibration.raster_measurements.bind_raster.3407b6d2', locals()):raise RuleViolation('axis-calibration.raster_measurements.bind_raster.3407b6d2', 'Invalid screenshot data binding')
        if violated('axis-calibration.raster_measurements.bind_raster.6ac86f0b', locals()):raise RuleViolation('axis-calibration.raster_measurements.bind_raster.6ac86f0b', 'Duplicate screenshot mark')
        seen.add((si,i))
        geometry=next((s for s in figure.get('seriesGeometry',[]) if s.get('series')==si),{})
        secondary=geometry.get('axis')=='secondary';key='x' if horizontal else 'y'
        bindings=[(0,cx,'x'),(1,cy,'y')] if scatter else [(si,None,key)]
        for j,cal,key in bindings:
            if c['series'][j]['values'][i] is not None:continue
            cal=cal or calibrated(key,secondary)
            v=value_at(cal,p.get(key))
            base=p.get('baseX' if key=='x' else 'baseY')
            floating=any(b.get('categoryIndex')==i and b.get('series')==c['series'][j]['name'] for b in figure.get('barBaselines',[]))
            if base is not None and not scatter and (c.get('kind')=='stacked-bar' or floating):v-=value_at(cal,base)
            uncertainty=(cal['domain'][1]-cal['domain'][0])*.01
            decimals=max(0,min(4,-math.floor(math.log10(uncertainty)))) if uncertainty else 2
            v=round(v,decimals);c['series'][j]['values'][i]=v
            estimates.append({'series':j,'index':i,'value':v,'valueStatus':'coordinate-derived-estimate','axis':key,'axisBinding':'secondary' if secondary else 'primary','sourcePosition':p.get(key),'calibration':cal,'resolutionEstimate':uncertainty})
    if estimates:
        figure['rasterEstimates']=estimates
        warning='部分数值由截图刻度与图形位置换算，为近似值，不是原稿印出的精确数字。'
        c['warnings']=list(dict.fromkeys(c.get('warnings',[])+[warning]));figure['notes']=list(dict.fromkeys(figure.get('notes',[])+[warning]))
    if scatter or figure.get('kind')=='curves':
        figure['axes']={'xDomain':cx['domain'],'yDomain':cy['domain'],'xTicks':[t['value'] for t in cx['ticks']],'yTicks':[t['value'] for t in cy['ticks']]}
    return figure
