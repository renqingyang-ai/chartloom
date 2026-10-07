"""Bind PDF layout to its actual text and vector measurements, independent of content."""
import copy
import math
import re
import statistics


def normalized(text):
    return re.sub(r'[\s,]+', '', str(text)).replace('−', '-').replace('–', '-').casefold()


def apply_native_layout(layout, figure, evidence, crop, page_height):
    out=copy.deepcopy(layout)
    if not page_height or not evidence.get('spans'):return out
    x,y,w,h=crop
    rx=lambda n:(n-x)/w*100
    ry=lambda n:(n-y)/h*100
    spans=evidence['spans'];used=set();matched=0
    positions=out.get('categoryPositions',[])
    steps=[abs(b-a) for a,b in zip(positions,positions[1:]) if b!=a]
    step=min(steps) if steps else 100
    horizontal=out.get('orientation')=='horizontal'

    def locate(text, tx, ty, anchor='start', lane=None):
        options=[]
        for i,s in enumerate(spans):
            if i in used or normalized(s['text'])!=normalized(text):continue
            a,b,sw,sh=s['bbox'];sx=rx(a+(sw/2 if anchor=='middle' else sw if anchor=='end' else 0));sy=ry(s.get('origin',[a,b+sh*.8])[1])
            if lane is not None and abs((ry(b+sh/2) if horizontal else rx(a+sw/2))-lane)>step*.55:continue
            distance=math.hypot(sx-tx,sy-ty)
            if distance<18:options.append((distance,i,s,sx,sy))
        if not options:return None
        _,i,s,sx,sy=min(options,key=lambda v:v[0]);used.add(i)
        return s,sx,sy

    for t in out.get('texts',[]):
        if not isinstance(t,dict) or not isinstance(t.get('x'),(int,float)) or not isinstance(t.get('y'),(int,float)):continue
        lane=None;ci=t.get('index');tx,ty=t['x'],t['y']
        if t.get('role') in ('value','total','category') and isinstance(ci,int) and 0<=ci<len(positions):
            lane=positions[ci]
            if horizontal:
                if abs(ty-lane)>step*.5:ty=lane
            elif abs(tx-lane)>step*.5:tx=lane
        rows=t.get('text','').split('\n');found=[]
        for j,row in enumerate(rows):
            hit=locate(row,tx,ty+j*t.get('fontSize',3)*1.13,t.get('anchor','start'),lane)
            if hit:found.append(hit)
        if len(found)!=len(rows):continue
        s,sx,sy=found[0];t.update(x=sx,y=sy)
        direction=s.get('direction',[1,0])
        if abs(direction[1])>.01:
            t.update(x=rx(s['origin'][0]),y=ry(s['origin'][1]),anchor='start',rotation=math.degrees(math.atan2(direction[1],direction[0])))
        if s.get('size'):
            t['nativeFontSize']=s['size']/page_height/h*10000
            t['fontSize']=t['nativeFontSize']
        t.pop('glyphBox',None)
        if len(found)>1:t['lineStep']=statistics.median([b[2]-a[2] for a,b in zip(found,found[1:])])
        matched+=len(found)

    # Superscripts are sometimes emitted as standalone annotations with no
    # data binding. Keep them with their source text instead of rejecting a
    # whole chart, printing them twice, or colliding after a font substitution.
    superscript=str.maketrans('0123456789','⁰¹²³⁴⁵⁶⁷⁸⁹')
    remove=set()
    for mi,marker in enumerate(out.get('texts',[])):
        if marker.get('role') not in ('free','annotation') or not re.fullmatch(r'\d{1,2}',marker.get('text','')) or not marker.get('nativeFontSize'):continue
        suffix=marker['text'].translate(superscript)
        for text in out['texts']:
            if text is marker or math.dist([marker['x'],marker['y']],[text['x'],text['y']])>22:continue
            if text.get('role')=='callout':
                item,ci=text.get('item'),text.get('index')
                callouts=figure.get('categoryCallouts',[])
                if isinstance(item,int) and isinstance(ci,int) and 0<=item<len(callouts) and 0<=ci<len(callouts[item]['values']):
                    value=str(callouts[item]['values'][ci] or '')
                    if value.endswith(suffix) and normalized(value[:-len(suffix)])==normalized(text['text']):remove.add(mi);break
            if text.get('role')=='title' and text.get('nativeFontSize',0)>marker['nativeFontSize']*1.15 and marker['y']<text['y']:
                if not text['text'].endswith(suffix):text['text']+=suffix
                remove.add(mi);break
    out['texts']=[t for i,t in enumerate(out.get('texts',[])) if i not in remove]

    # Callout legends are independently editable annotations, not invented
    # numeric series. Recover the binding only from the exact PDF wording.
    names=[('series',i,s['name']) for i,s in enumerate(figure['chart']['series'])]+[('callout',i,c['label']) for i,c in enumerate(figure.get('categoryCallouts',[]))]
    for legend in out.get('legends',[]):
        options=[]
        for binding,i,name in names:
            for s in spans:
                if normalized(name)!=normalized(s['text']):continue
                sx=rx(s['bbox'][0]);sy=ry(s.get('origin',[s['bbox'][0],s['bbox'][1]+s['bbox'][3]*.8])[1])
                distance=math.hypot(sx-legend.get('textX',0),sy-legend.get('textY',0))
                if distance<8:options.append((distance,binding,i,s,sx,sy))
        if options:
            _,binding,i,s,sx,sy=min(options,key=lambda p:p[0])
            legend.update(binding=binding,series=i,item=i,textX=sx,textY=sy,fontSize=s['size']/page_height/h*10000)
            legend.pop('glyphBox',None)

    # Only match model-identified leaders to nearby native line segments.
    # This keeps data marks separate and preserves actual thin PDF strokes.
    for line in out.get('lines',[]):
        if len(line.get('points',[]))!=2:continue
        a,b=line['points'];options=[]
        for path in evidence.get('paths',[]):
            commands=path.get('commands',[])
            for command in commands:
                if command[0]!='l':continue
                p,q=[[rx(v[0]),ry(v[1])] for v in command[1:]]
                direct=math.dist(a,p)+math.dist(b,q);reverse=math.dist(a,q)+math.dist(b,p)
                width=path.get('width') if path.get('stroke') else None
                if width is None and path.get('fill') and math.dist(p,q)>20:
                    # PDF exports may encode a thin arrow shaft as two edges
                    # of a filled polygon, not as a stroked line.
                    widths=[]
                    for other in commands:
                        if other[0]!='l' or other==command:continue
                        u,v=[[rx(z[0]),ry(z[1])] for z in other[1:]]
                        if abs(math.dist(u,v)-math.dist(p,q))>1:continue
                        d=abs((q[0]-p[0])*(u[1]-p[1])-(q[1]-p[1])*(u[0]-p[0]))/math.dist(p,q)
                        if .01<d<1:widths.append(d*page_height*h/10000)
                    if widths:width=min(widths)
                if width and min(direct,reverse)<10:options.append((min(direct,reverse),p if direct<reverse else q,q if direct<reverse else p,width))
        if options:
            _,a,b,width=min(options,key=lambda v:v[0]);line.update(points=[a,b],width=max(.03,width/page_height/h*10000))

    native=figure.get('nativePlot')
    if native and native.get('calibration') and figure.get('kind') in ('scatter','curves'):
        fx,fy=native['calibration']['x'],native['calibration']['y'];xd,yd=native['xDomain'],native['yDomain']
        left,right=(xd[0]-fx[1])/fx[0],(xd[1]-fx[1])/fx[0]
        top,bottom=(yd[1]-fy[1])/fy[0],(yd[0]-fy[1])/fy[0]
        out['plotBox']=[rx(left),ry(top),(right-left)/w*100,(bottom-top)/h*100]
        for key,domain in [('xAxis',xd),('valueAxis',yd)]:
            a=out.get(key)
            if not a:continue
            a['domain']=list(domain);a.pop('calibration',None)
            for tick in a.get('ticks',[]):
                matches=[s for s in spans if normalized(s['text'])==normalized(tick['text'])]
                if not matches:continue
                def cost(s):
                    b=s['bbox'];px,py=b[0]+b[2]/2,b[1]+b[3]/2
                    target=(tick['value']-(fx[1] if key=='xAxis' else fy[1]))/(fx[0] if key=='xAxis' else fy[0])
                    return abs(px-target)/w+abs(py-bottom)/h if key=='xAxis' else abs(py-target)/h+abs(px-left)/w
                s=min(matches,key=cost);b=s['bbox']
                tick.update(textX=rx(b[0]+b[2]/2),textY=ry(s.get('origin',[b[0],b[1]+b[3]*.8])[1]))
                a['fontSize']=s['size']/page_height/h*10000
        if figure['kind']=='scatter':
            heights=[]
            for point in native.get('points',[]):
                center=point['sourceCenter']
                paths=[p for p in evidence.get('paths',[]) if p.get('fill')==point.get('color') and math.dist([p['bbox'][0]+p['bbox'][2]/2,p['bbox'][1]+p['bbox'][3]/2],center)<.02]
                if paths:heights.append(min(paths,key=lambda p:p['bbox'][2]*p['bbox'][3])['bbox'][3]/h*100)
            if heights:
                for style in out.get('seriesStyles',[]):
                    if style.get('geometry')=='point':style['markerSize']=statistics.median(heights)
        else:
            widths=[p['width']/page_height/h*10000 for p in evidence.get('paths',[]) if p.get('stroke') and p.get('width') and any(c[0]=='c' for c in p.get('commands',[])) and p['bbox'][2]>w*.35]
            if widths:
                for style in out.get('seriesStyles',[]):
                    if style.get('geometry')=='line':style['lineWidth']=statistics.median(widths)
    out['nativeLayoutMeasurement']={'method':'pdf-text-baselines-and-vector-axes','matchedTextRows':matched}
    return out
