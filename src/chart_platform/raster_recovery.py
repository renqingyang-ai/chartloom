"""Recover visible chart geometry from this input's pixels, never sample answers.

Source colors select pixels; OCR/model-measured scales calibrate the result.
Recovered coordinates remain explicitly approximate and editable.
"""
import copy
import io
import math
import re
import numpy as np
from PIL import Image
from .raster_geometry import color_mask
from .raster_measurements import calibration, value_at


def color(value):
    if not isinstance(value,str) or not re.fullmatch(r'#[a-fA-F0-9]{6}',value):return None
    return np.array([int(value[i:i+2],16) for i in (1,3,5)])


def axis_calibration(axis, layout, horizontal):
    measured=axis.get('calibration',{}).get('ticks')
    if measured:
        try:return calibration(measured,axis.get('scale','linear'))
        except ValueError:pass
    x,y,w,h=layout['plotBox'];lo,hi=axis['domain']
    values=[hi,lo] if axis.get('reversed') else [lo,hi]
    positions=[x,x+w] if horizontal else [y+h,y]
    return calibration([{'position':p,'value':v} for p,v in zip(positions,values)],axis.get('scale','linear'))


def recover_pie(image, figure, layout):
    """Fit clockwise/anticlockwise winding to category-bound wedge colors."""
    if figure.get('kind')!='pie':return
    c=figure['chart'];palette={s.get('name'):color(s.get('color')) for s in figure.get('seriesColors',[])}
    rgb=[palette.get(label) for label in c['labels']]
    if any(v is None for v in rgb) or len(rgb)<2:return
    a=np.asarray(Image.open(io.BytesIO(image)).convert('RGB')).astype(float);height,width=a.shape[:2]
    x,y,w,h=layout['plotBox'];cx=(x+w/2)*width/100;cy=(y+h/2)*height/100;r=min(w*width,h*height)/200
    hole=layout.get('pie',figure.get('pieLayout',{})).get('holeRatio',0)
    theta=np.linspace(0,2*np.pi,1440,endpoint=False)
    # Use three radii to reject small text and the hole, with a majority vote.
    votes=[]
    for fraction in (hole+(1-hole)*.35,hole+(1-hole)*.55,hole+(1-hole)*.75):
        xx=np.clip(np.rint(cx+np.sin(theta)*r*fraction).astype(int),0,width-1)
        yy=np.clip(np.rint(cy-np.cos(theta)*r*fraction).astype(int),0,height-1)
        distances=np.linalg.norm(a[yy,xx,None,:]-np.array(rgb)[None,:,:],axis=2)
        nearest=np.argmin(distances,axis=1);nearest[np.min(distances,axis=1)>75]=-1;votes.append(nearest)
    votes=np.array(votes);owners=np.full(len(theta),-1)
    for i in range(len(rgb)):owners[(votes==i).sum(axis=0)>=2]=i
    good=owners>=0
    if good.mean()<.85:return
    raw_values=c['series'][0]['values']
    if any(v is None for v in raw_values):
        shares=np.array([(owners==i).sum() for i in range(len(rgb))],dtype=float)
        if (shares==0).any():return
        figure['piePixelShares']={'method':'source-wedge-angular-proportions','originalValues':copy.deepcopy(raw_values),'samples':int(good.sum()),'valueStatus':'coordinate-derived-estimate'}
        c['series'][0]['values']=[round(float(v/shares.sum()*100),3) for v in shares]
        c['series'][0]['name']='Visible share (%)';c['unit']='%'
        note='未标出的扇区数值按可见角度恢复为百分比；原文标签保留，未推断重量、数量等隐藏数据。'
        c['warnings']=list(dict.fromkeys(c.get('warnings',[])+[note]));figure['notes']=list(dict.fromkeys(figure.get('notes',[])+[note]))
    values=np.array(c['series'][0]['values'],dtype=float)
    if not np.isfinite(values).all() or (values<0).any() or values.sum()<=0:return
    boundaries=np.cumsum(values/values.sum()*2*np.pi)
    best=None
    for direction in (1,-1):
        for start in range(1440):
            relative=(direction*(theta-start*2*np.pi/1440))%(2*np.pi)
            expected=np.searchsorted(boundaries,relative,side='right').clip(0,len(rgb)-1)
            score=float((expected[good]==owners[good]).mean())
            if best is None or score>best[0]:best=(score,start*.25,direction)
    score,start,direction=best
    if score<.92:return
    layout.setdefault('pie',{}).update(startAngle=start,clockwise=direction==1)
    figure.setdefault('pieLayout',{}).update(startAngle=start,clockwise=direction==1)
    layout['pieMeasurement']={'method':'category-bound-source-color-angular-sampling','agreement':round(score,5),'samples':int(good.sum()),'clockwise':direction==1}


def recover_curves(image, figure, layout):
    """Sample the complete visible path, not just the printed X tick positions.

    Only continuous, uniquely source-colored numeric curves qualify. Null runs
    stay null; ambiguous crossings/colors are not filled with invented values.
    """
    if figure.get('nativePlot') or figure.get('kind') not in ('curves','chart'):return
    c=figure['chart'];styles=layout.get('seriesStyles',[])
    if not styles or any(s.get('geometry')!='line' or s.get('marker','none')!='none' or s.get('dashed') for s in styles):return
    if len(styles)!=len(c['series']):return
    rplot=figure.get('rasterPlot',{})
    if not layout.get('xAxis'):
        if figure.get('kind')!='curves' or len(rplot.get('xTicks',[]))<2:return
        cal=calibration(rplot['xTicks'],rplot.get('xScale','linear'));x,y,w,h=layout['plotBox']
        d=[value_at(cal,x),value_at(cal,x+w)]
        layout['xAxis']={'domain':sorted(d),'reversed':d[1]<d[0],'scale':cal['scale'],'visible':True,'side':'bottom','grid':False,
            'ticks':[{'value':t['value'],'text':str(t['value'])} for t in rplot['xTicks']], 'fontSize':layout.get('categoryAxis',{}).get('fontSize',2.8),
            'calibration':{'method':'ocr-tick-centers','ticks':rplot['xTicks']}}
    try:xc=axis_calibration(layout['xAxis'],layout,True)
    except (ValueError,KeyError):return
    # Keep charts with explicit category-bound values/labels on their source rows.
    if any(t.get('role') in ('value','total','callout','point-label') for t in layout.get('texts',[])):return
    pixels=np.asarray(Image.open(io.BytesIO(image)).convert('RGB')).astype(np.int16);height,width=pixels.shape[:2]
    bx,by,bw,bh=layout['plotBox'];x0=max(0,math.ceil(bx*width/100));x1=min(width,math.floor((bx+bw)*width/100)+1)
    y0=max(0,math.ceil(by*height/100));y1=min(height,math.floor((by+bh)*height/100)+1)
    if x1-x0<30 or y1-y0<20:return
    palette={s.get('name'):color(s.get('color')) for s in figure.get('seriesColors',[])}
    rgbs=[palette.get(s['name']) for s in c['series']]
    if any(v is None for v in rgbs):return
    if any(np.linalg.norm(a-b)<35 for i,a in enumerate(rgbs) for b in rgbs[i+1:]):return
    recovered=[];records=[]
    for si,series in enumerate(c['series']):
        style=next(s for s in styles if s['series']==si)
        axis=layout.get('secondaryAxis') if style.get('axis')=='secondary' else layout['valueAxis']
        try:yc=axis_calibration(axis,layout,False)
        except (ValueError,KeyError):return
        mask=color_mask(pixels,rgbs[si])[y0:y1,x0:x1]
        # A source-colored axis/grid is not a flat data curve. Remove only plot
        # boundary rules; internal horizontal segments remain legitimate data.
        for edge in (0,len(mask)-1):
            if mask[edge].mean()>.85:mask[edge]=False
        positions=[]
        for xi in range(mask.shape[1]):
            ys=np.flatnonzero(mask[:,xi]);groups=np.split(ys,np.where(np.diff(ys)>1)[0]+1) if len(ys) else []
            groups=[g for g in groups if len(g)]
            if len(groups)!=1:positions.append(None);continue
            positions.append(float(np.median(groups[0])+y0))
        occupied=sum(v is not None for v in positions)
        if occupied<max(25,mask.shape[1]*.55):return
        # An opaque crossing can conceal a few pixels of a continuous curve.
        # Bridge only short interior gaps, and retain every inferred column in
        # provenance. Long gaps and unconnected/dashed data are never filled.
        bridges=[];at=0
        while at<len(positions):
            if positions[at] is not None:at+=1;continue
            start=at
            while at<len(positions) and positions[at] is None:at+=1
            if start>0 and at<len(positions) and at-start<=max(2,int((x1-x0)*.018)):
                left,right=positions[start-1],positions[at]
                if abs(right-left)<=height*.2:
                    for xi in range(start,at):positions[xi]=left+(right-left)*(xi-start+1)/(at-start+1)
                    bridges.append({'firstColumn':start,'lastColumn':at-1,'method':'linear-between-visible-endpoints'})
        vals=[None if v is None else float(f'{value_at(yc,v/height*100):.7g}') for v in positions]
        recovered.append({'name':series['name'],'values':vals})
        records.append({'series':si,'axisBinding':style.get('axis','primary'),'method':'source-colored-column-centers',
                        'measuredColumns':occupied,'calibration':yc,'pixelY':positions,'resolutionPixels':1,'valueStatus':'coordinate-derived-estimate','interpolatedOcclusions':bridges})
    # Crop empty common margins while preserving all internal gaps.
    occupied=[i for i in range(x1-x0) if any(s['values'][i] is not None for s in recovered)]
    if not occupied:return
    lo,hi=min(occupied),max(occupied)+1
    source_positions=[(x0+i)/width*100 for i in range(lo,hi)]
    labels=[format(value_at(xc,x),'.9g') for x in source_positions]
    for s in recovered:s['values']=s['values'][lo:hi]
    # Store compact series-level measurement provenance rather than repeating
    # the full axis calibration in every sampled cell.
    figure['curveRecovery']={'method':'full-visible-raster-path','xCalibration':xc,'samples':len(labels),'series':records,'approximate':True}
    c['labels']=labels;c['series']=recovered;c['kind']='line';figure['kind']='curves'
    figure['rasterEstimates']=[];figure.pop('rasterPlot',None)
    warning='曲线按原图像素逐列采样并用坐标轴换算；保留波峰波谷，数值为近似值，可编辑。'
    c['warnings']=list(dict.fromkeys(c.get('warnings',[])+[warning]));figure['notes']=list(dict.fromkeys(figure.get('notes',[])+[warning]))
    layout['categoryPositions']=source_positions;layout['categoryAxis']['visible']=False
    layout['texts']=[t for t in layout.get('texts',[]) if t.get('role')!='category']
    layout['sourceData']=copy.deepcopy({'kind':c['kind'],'title':c['title'],'labels':labels,'series':recovered,'totals':[],'barBaselines':[]})
    figure['totals']=[];figure['valueLabels']=[]
