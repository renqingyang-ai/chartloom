"""Recover a numeric plot from native PDF coordinates, with explicit estimate provenance.

No raster-height measurement, known page numbers or known series values are used.
Only plots with independently calibrated numeric x/y ticks are eligible.
"""
import math
from .validation_rules import violated, RuleViolation, rule_range
import re
from .raster_measurements import bind_raster


def number(text):
    match=re.fullmatch(r'\s*([−\-]?\d[\d,]*(?:\.\d+)?)\s*([Bb%]?)\s*',text)
    return float(match[1].replace(',','').replace('−','-')) if match else None


def fit(pairs):
    if len(pairs)<2:return None
    mx=sum(x for x,_ in pairs)/len(pairs);my=sum(y for _,y in pairs)/len(pairs)
    den=sum((x-mx)**2 for x,_ in pairs)
    if den<1e-8:return None
    slope=sum((x-mx)*(y-my) for x,y in pairs)/den;offset=my-slope*mx
    if max(abs(slope*x+offset-y) for x,y in pairs)>max(1e-4,(max(y for _,y in pairs)-min(y for _,y in pairs))*.004):return None
    return slope,offset


def recover(spans,paths,bbox):
    lines=[]
    for p in paths:
        if p['fill']:continue
        for c in p['commands']:
            if c[0]=='l' and abs(c[1][1]-c[2][1])<.005 and abs(c[1][0]-c[2][0])>bbox[2]*.4:
                lines.append((min(c[1][0],c[2][0]),max(c[1][0],c[2][0]),c[1][1]))
    if len(lines)<3:return None
    # The dominant common endpoints identify grid lines, not the page frame.
    groups=[]
    for l in lines:
        g=next((g for g in groups if abs(g[0][0]-l[0])<.1 and abs(g[0][1]-l[1])<.1),None)
        if g is None:groups.append([l])
        else:g.append(l)
    grid=max(groups,key=len)
    if len(grid)<3:return None
    left,right=grid[0][:2];ypairs=[];yticks=[]
    numeric=[(s,number(s['text'])) for s in spans if number(s['text']) is not None]
    for _,_,y in grid:
        options=[(s,v) for s,v in numeric if 0<=left-(s['bbox'][0]+s['bbox'][2])<bbox[2]*.18 and abs(s['bbox'][1]+s['bbox'][3]/2-y)<1.4]
        if options:
            s,v=min(options,key=lambda sv:abs(sv[0]['bbox'][1]+sv[0]['bbox'][3]/2-y));ypairs.append((y,v));yticks.append(v)
    fy=fit(ypairs)
    if not fy or fy[0]>=0:return None
    bottom=max(l[2] for l in grid)
    candidates=[(s,v) for s,v in numeric if left-.3<=s['bbox'][0]+s['bbox'][2]/2<=right+.3 and s['bbox'][1]>bottom+1]
    rows=[]
    for s,v in candidates:
        row=next((r for r in rows if abs(r[0][0]['bbox'][1]-s['bbox'][1])<.3),None)
        if row is None:rows.append([(s,v)])
        else:row.append((s,v))
    if not rows:return None
    ticks=sorted(max(rows,key=len),key=lambda sv:sv[0]['bbox'][0])
    if len(ticks)<3 or any(a[1]>=b[1] for a,b in zip(ticks,ticks[1:])):return None
    xpairs=[(s['bbox'][0]+s['bbox'][2]/2,v) for s,v in ticks];fx=fit(xpairs)
    if not fx or fx[0]<=0:return None
    xticks=[v for _,v in ticks]
    # Include the zero/base tick even if its axis stroke was omitted by the PDF producer.
    for s,v in numeric:
        if 0<=left-(s['bbox'][0]+s['bbox'][2])<bbox[2]*.18 and abs(fy[0]*(s['bbox'][1]+s['bbox'][3]/2)+fy[1]-v)<abs(fy[0])*1.4:yticks.append(v)
    yticks=sorted(set(yticks));xd=[xticks[0],xticks[-1]];yd=[yticks[0],yticks[-1]]
    if xd[0]>=xd[1] or yd[0]>=yd[1]:return None
    xy=lambda p:[fx[0]*p[0]+fx[1],fy[0]*p[1]+fy[1]]
    points=[];curves=[]
    for i,p in enumerate(paths):
        x,y,w,h=p['bbox'];center=[x+w/2,y+h/2];data=xy(center)
        if p['fill'] and .2<w<2.6 and .2<h<3.2 and xd[0]-.1<=data[0]<=xd[1]+.1 and yd[0]-(yd[1]-yd[0])*.02<=data[1]<=yd[1]+(yd[1]-yd[0])*.02:
            if any(math.dist(center,a['sourceCenter'])<.11 and a['color']==p['fill'] for a in points):continue
            points.append({'id':f'point-{i}','x':round(data[0],3),'y':round(data[1],2),'sourceCenter':center,'color':p['fill']})
        if p['stroke'] and not p['fill'] and w>bbox[2]*.35 and 1<=len(p['commands'])<=100 and all(c[0]=='c' for c in p['commands']):
            segments=[[xy(q) for q in c[1:]] for c in p['commands']]
            if any(any(a[0]>b[0]+.01 for a,b in zip(s,s[1:])) for s in segments):continue
            curves.append({'id':f'curve-{i}','color':p['stroke'],'segments':segments})
    if not points and not curves:return None
    return {'method':'native-pdf-axis-calibration','valueStatus':'coordinate-derived-estimate','xDomain':xd,'yDomain':yd,'xTicks':xticks,'yTicks':yticks,'points':points,'curves':curves,'calibration':{'x':fx,'y':fy,'xPairs':xpairs,'yPairs':ypairs}}


def bezier(segment,t):
    return [sum(segment[k][axis]*weight for k,weight in enumerate([(1-t)**3,3*(1-t)**2*t,3*(1-t)*t*t,t**3])) for axis in (0,1)]


def sample(curve,x):
    for s in curve['segments']:
        if s[0][0]-.015<=x<=s[3][0]+.015:
            low,high=0.,1.
            for _ in range(35):
                mid=(low+high)/2
                if bezier(s,mid)[0]<x:low=mid
                else:high=mid
            return round(bezier(s,(low+high)/2)[1],2)
    return None


def bind_figure(figure,evidence):
    """Model names entities; only the program supplies coordinate-derived numeric values."""
    native=evidence.get('nativePlot')
    if figure.get('kind') not in ('scatter','curves'):return bind_raster(figure)
    if not native:
        if figure.get('rasterPlot'):return bind_raster(figure)
        raise ValueError('未找到可标定的原生坐标或截图刻度证据，保留待核对。')
    kind=figure['kind'];definition=figure.get('points' if kind=='scatter' else 'curves',[])
    available={p['id']:p for p in native['points' if kind=='scatter' else 'curves']}
    ids=[p.get('nativeId') for p in definition]
    if violated('axis-calibration.native_plot.bind_figure.0565cbb3', locals()):raise RuleViolation('axis-calibration.native_plot.bind_figure.0565cbb3', '图中点位或曲线与原生矢量数量未对齐，需重新核对。')
    figure['axes']={k:native[k] for k in ('xDomain','yDomain','xTicks','yTicks')};figure['nativePlot']=native
    warning='Values recovered from native PDF vector coordinates; approximate, not printed source values.'
    if kind=='scatter':
        labels=[str(p.get('label') or '') for p in definition]
        if violated('axis-calibration.native_plot.bind_figure.4f6f2fd5', locals()):raise RuleViolation('axis-calibration.native_plot.bind_figure.4f6f2fd5', '散点名称缺失')
        series=[{'name':'X','values':[available[p['nativeId']]['x'] for p in definition]},{'name':figure.get('unit') or 'Y','values':[available[p['nativeId']]['y'] for p in definition]}]
        norm=lambda s:re.sub(r'\s+','',s).casefold()
        figure['pointLabelOffsets']=[];fx=native['calibration']['x'];fy=native['calibration']['y']
        for item in definition:
            found=[s for s in evidence['spans'] if norm(s['text'])==norm(item['label'])]
            if not found:
                for a in evidence['spans']:
                    for b in evidence['spans']:
                        if 0<b['bbox'][1]-a['bbox'][1]<3 and abs(b['bbox'][0]-a['bbox'][0])<5 and norm(a['text']+b['text'])==norm(item['label']):found=[a,b];break
                    if found:break
            p=available[item['nativeId']]
            if found:
                x=min(s['bbox'][0] for s in found);y=min(s['bbox'][1] for s in found)
                # Text coordinates and point coordinates share the source axes.
                figure['pointLabelOffsets'].append({'dx':fx[0]*x+fx[1]-p['x'],'dy':fy[0]*(y+found[0]['bbox'][3]*.8)+fy[1]-p['y']})
            else:figure['pointLabelOffsets'].append(None)
    else:
        start,end=native['xDomain'];labels=[str(y) for y in range(math.ceil(start),math.floor(end)+1)] if end-start<=99 and end-start>=2 else [str(v) for v in native['xTicks']]
        series=[{'name':str(p.get('name') or ''),'values':[sample(available[p['nativeId']],float(x)) for x in labels]} for p in definition]
        if violated('axis-calibration.native_plot.bind_figure.3a588366', locals()):raise RuleViolation('axis-calibration.native_plot.bind_figure.3a588366', '部分曲线未覆盖坐标范围，保留待核对。')
        figure['nativeCurves']=[available[p['nativeId']]|{'name':p['name'],'sampleValues':series[i]['values']} for i,p in enumerate(definition)]
    figure['chart']={'title':figure.get('title',''),'kind':'grouped-bar' if kind=='scatter' else 'line','unit':figure.get('unit',''),'labels':labels,'series':series,'annotations':[str(p.get('annotation')) for p in definition if p.get('annotation')],'warnings':[warning],'presentation':{'valueAxis':True,'grid':True,'legend':kind=='curves','trendArrow':False}}
    figure['totals']=[];figure['notes']=list(figure.get('notes') or [])+[warning]
    return figure
