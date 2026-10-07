"""Read-only local raster measurements; model hints select, never create, pixels.

OCR boxes calibrate typography independently of the model's approximate sizes.
Compact colored components refine scatter point centers when every match agrees.
"""
import copy
import hashlib
import io
import json
import math
import re
import subprocess
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image
from .chart_numbers import printed_number
from .raster_measurements import calibration,value_at
from .bar_arrangement import measure_mirror


def tick_number(text):
    value=printed_number(text)
    # OCR can append a horizontal grid stroke to an otherwise complete tick.
    # This alias is used for axis positioning only, never source fact parsing.
    if value is None and isinstance(text,str) and re.fullmatch(r'\d+(?:\.\d+)?[-–—]',text.strip()):
        value=printed_number(text.strip()[:-1])
    return value


def color_mask(pixels,rgb):
    mask=np.linalg.norm(pixels-rgb,axis=2)<65
    chroma=int(rgb.max()-rgb.min())
    if chroma>40:mask &= pixels.max(axis=2)-pixels.min(axis=2)>chroma*.45
    return mask


def _glyph_ink(patch):
    """Foreground pixels against edge backgrounds, without guessing words."""
    edge=np.concatenate((patch[0],patch[-1],patch[:,0],patch[:,-1]))
    codes=(edge//16).astype(np.int32);keys,counts=np.unique(codes,axis=0,return_counts=True)
    modes=[np.median(edge[(codes==keys[i]).all(axis=1)],axis=0) for i in np.argsort(counts)[::-1][:3] if counts[i]>=len(edge)*.12]
    if not modes:modes=[np.median(edge,axis=0)]
    ink=np.min(np.stack([np.linalg.norm(patch-bg,axis=2) for bg in modes]),axis=0)>38
    neutral=(patch.max(axis=2)-patch.min(axis=2)<25)&(patch.max(axis=2)<170)
    if all(bg.min()>210 for bg in modes) and (ink&neutral).sum()>8:ink &= neutral
    ink[ink.mean(axis=1)>.75,:]=False
    return ink


def glyph_box(pixels,bbox):
    """Trim OCR padding against all dominant edge backgrounds, including a
    label crossing a bar edge. A single median background loses half its text.
    """
    height,width=pixels.shape[:2];x,y,w,h=bbox
    x0=max(0,int(x*width/100));y0=max(0,int(y*height/100));x1=min(width,math.ceil((x+w)*width/100));y1=min(height,math.ceil((y+h)*height/100))
    patch=pixels[y0:y1,x0:x1]
    if not patch.size:return None
    ink=_glyph_ink(patch)
    ys,xs=np.nonzero(ink)
    # A grid stroke through pale tick text must not become the measured glyph.
    if len(xs)>4 and ys.max()-ys.min()+1>patch.shape[0]*.35:return [(x0+int(xs.min()))/width*100,(y0+int(ys.min()))/height*100,(int(xs.max())-int(xs.min())+1)/width*100,(int(ys.max())-int(ys.min())+1)/height*100]
    return None


def _line_component_boxes(ink,centers):
    """Assign whole connected glyphs to adjacent line centers, never slices.

    Descenders and ascenders can overlap in Y without touching in X, leaving
    no fully blank row. A few touching letters may be excluded from typography
    measurement, but only when over 90% of ink independently identifies lines.
    """
    visited=np.zeros_like(ink);parts=[];height,width=ink.shape;bridged=0
    for sy,sx in zip(*np.nonzero(ink)):
        if visited[sy,sx]:continue
        queue=deque([(int(sy),int(sx))]);visited[sy,sx]=True;xs=[];ys=[]
        while queue:
            y,x=queue.popleft();xs.append(x);ys.append(y)
            for yy in range(max(0,y-1),min(height,y+2)):
                for xx in range(max(0,x-1),min(width,x+2)):
                    if ink[yy,xx] and not visited[yy,xx]:visited[yy,xx]=True;queue.append((yy,xx))
        if len(xs)<2:continue
        top,bottom=min(ys),max(ys)+1
        if top<min(centers) and bottom>max(centers):bridged+=len(xs);continue
        parts.append(((min(xs),top,max(xs)+1,bottom),sum(ys)/len(ys),len(ys)))
    # OCR centers have asymmetric padding. Recenter on the majority ink before
    # assigning small detached dots, so they follow their line's full glyphs.
    for _ in range(3):
        assigned=[[],[]]
        for box,at,weight in parts:assigned[min(range(2),key=lambda i:abs(at-centers[i]))].append((box,at,weight))
        if not all(assigned):return None
        centers=[sum(at*weight for _,at,weight in g)/sum(weight for _,_,weight in g) for g in assigned]
    groups=[[box for box,_,_ in g] for g in assigned]
    if bridged>int(ink.sum())*.1 or any(len(g)<3 for g in groups):return None
    return [(min(b[0] for b in g),min(b[1] for b in g),max(b[2] for b in g),max(b[3] for b in g)) for g in groups]


def measure_text_spans(pixels,spans):
    """Separate overlapping OCR line boxes using independent ink evidence.

    Vision may extend a line box into the next line. Measuring their union
    inflates the font. A blank separator between the two line centers gives
    independent bounds; otherwise assign whole disconnected glyphs to lines.
    Without pixel evidence keep the original measurement.
    Word boxes and disconnected strokes inside a single line are not split.
    """
    height,width=pixels.shape[:2]
    lines=[(i,s['bbox']) for i,s in enumerate(spans) if not s.get('word') and s.get('confidence',0)>=.45]
    windows={i:[b[1],b[1]+b[3]] for i,b in lines};components={}
    for j,(i,a) in enumerate(lines):
        for k,b in lines[j+1:]:
            overlap=min(a[0]+a[2],b[0]+b[2])-max(a[0],b[0])
            if overlap<min(a[2],b[2])*.5:continue
            ca,cb=a[1]+a[3]/2,b[1]+b[3]/2
            if abs(ca-cb)<min(a[3],b[3])*.4:continue
            if min(a[1]+a[3],b[1]+b[3])<=max(a[1],b[1]):continue
            x0=max(0,int(min(a[0],b[0])*width/100));x1=min(width,math.ceil(max(a[0]+a[2],b[0]+b[2])*width/100))
            y0=max(0,int(min(a[1],b[1])*height/100));y1=min(height,math.ceil(max(a[1]+a[3],b[1]+b[3])*height/100))
            patch=pixels[y0:y1,x0:x1]
            if not patch.size:continue
            ink=_glyph_ink(patch);lo=math.ceil(min(ca,cb)*height/100)-y0;hi=math.floor(max(ca,cb)*height/100)-y0
            blanks=np.flatnonzero(~ink[max(0,lo):min(len(ink),hi)].any(axis=1))+max(0,lo)
            if not len(blanks):
                boxes=_line_component_boxes(ink,[ca*height/100-y0,cb*height/100-y0])
                if boxes:
                    for index,box,original in zip((i,k),boxes,(a,b)):
                        xx,yy,right,bottom=box
                        measured=[(x0+xx)/width*100,(y0+yy)/height*100,(right-xx)/width*100,(bottom-yy)/height*100]
                        if original[3]*.35<measured[3]<original[3]:
                            previous=components.get(index)
                            if previous is None or measured[3]<previous[3]:components[index]=measured
                continue
            groups=np.split(blanks,np.flatnonzero(np.diff(blanks)>1)+1)
            gap=min(groups,key=lambda g:abs(float(np.mean(g))-(lo+hi)/2))
            # A midpoint inside blank rows never clips a glyph or a diacritic.
            cut=(y0+(int(gap[0])+int(gap[-1])+1)/2)/height*100
            upper,lower=(i,k) if ca<cb else (k,i)
            windows[upper][1]=min(windows[upper][1],cut);windows[lower][0]=max(windows[lower][0],cut)
    for i,s in enumerate(spans):
        box=s['bbox']
        if i in windows:
            top,bottom=windows[i]
            if bottom>top:box=[box[0],top,box[2],bottom-top]
        b=components.get(i)
        # Line separation uses the union of two OCR windows. Its connected
        # components may include another short label at the same baseline.
        # A measured occurrence must stay inside its OWN horizontal window,
        # allowing only the pixel rounding used by glyph_box.
        if b and (b[0] < box[0]-100/width or b[0]+b[2] > box[0]+box[2]+100/width):
            b=None
        b=b or glyph_box(pixels,box)
        if b:s['glyphBox']=b


def read_text(image, cache):
    key=hashlib.sha256(b'glyph-v6-occurrence-bounds'+image).hexdigest();folder=cache/'raster-text';folder.mkdir(exist_ok=True)
    target=folder/(key+'.json')
    if target.exists():return json.loads(target.read_text())
    from .config import get_settings
    binary=get_settings().ocr_binary
    if not binary.exists():return {'method':'unavailable','spans':[]}
    source=folder/(key+'.png');source.write_bytes(image)
    try:
        result=subprocess.run([str(binary),str(source)],capture_output=True,timeout=25)
        if result.returncode:return {'method':'incomplete','spans':[]}
        out=json.loads(result.stdout)
        pixels=np.asarray(Image.open(io.BytesIO(image)).convert('RGB')).astype(np.int16)
        measure_text_spans(pixels,out.get('spans',[]))
        target.write_text(json.dumps(out,ensure_ascii=False));return out
    except (OSError,ValueError,subprocess.TimeoutExpired):return {'method':'incomplete','spans':[]}


def match_text(spans, text, x, y, anchor='start',category=False):
    norm=lambda s:re.sub(r'\s+','',s).replace('−','-').replace('–','-').casefold()
    matches=[s for s in spans if s.get('confidence',0)>=.45 and (norm(s['text'])==norm(text) or category and norm(s['text']).rstrip('-')==norm(text))]
    def distance(s):
        a,b,w,h=s['bbox'];at=a+(w/2 if anchor=='middle' else w if anchor=='end' else 0)
        return math.hypot(at-x,b+h-y)
    matches.sort(key=distance)
    return matches[0] if matches and distance(matches[0])<12 else None


def apply_text_geometry(raw, ocr, figure):
    out=copy.deepcopy(raw);spans=ocr.get('spans',[]);count=0;used=set();claimed=[]
    prose={'title','caption','note','footnote','source','axis-title'}

    def available_spans():
        def occupied(s):
            x,y,w,h=s['bbox']
            for a,b,sw,sh in claimed:
                overlap=max(0,min(x+w,a+sw)-max(x,a))*max(0,min(y+h,b+sh)-max(y,b))
                if w*h>0 and overlap/(w*h)>.8:return True
            return False
        return [s for s in spans if id(s) not in used and not occupied(s)]

    def claim(found,t):
        used.update(id(s) for s in found)
        if t.get('role') in prose:claimed.extend(s['bbox'] for s in found)

    positions=out.get('categoryPositions',[]);horizontal=out.get('orientation')=='horizontal'
    steps=[abs(b-a) for a,b in zip(positions,positions[1:]) if b!=a];step=min(steps) if steps else 100
    # Match complete prose occurrences first, independent of model JSON order.
    # A word inside an already placed caption is not a separate legend heading.
    entries=sorted(out.get('texts',[]),key=lambda t:0 if isinstance(t,dict) and t.get('role') in prose else 1)
    for t in entries:
        if not isinstance(t,dict) or abs(t.get('rotation') or 0)>15:continue
        if not isinstance(t.get('x'),(int,float)) or not isinstance(t.get('y'),(int,float)):continue
        if '\n' in t.get('text',''):
            found=[match_text(available_spans(),line,t['x'],t['y']+i*t.get('fontSize',3)*1.13,t.get('anchor','start')) for i,line in enumerate(t['text'].split('\n'))]
            if all(found):
                bs=[s.get('glyphBox',s['bbox']) for s in found];steps=[(b[1]+b[3])-(a[1]+a[3]) for a,b in zip(bs,bs[1:])]
                if steps and min(steps)>0 and max(steps)<min(steps)*1.6:
                    x,y,w,h=bs[0];t['x']=x+(w/2 if t.get('anchor')=='middle' else w if t.get('anchor')=='end' else 0);t['y']=y+h;t['glyphBox']=bs[0];t['lineStep']=float(np.median(steps));t['width']=max(b[2] for b in bs);count+=len(bs)
                    claim(found,t)
            continue
        available=available_spans();tx,ty=t['x'],t['y'];ci=t.get('index')
        if t.get('role') in ('value','total','category') and isinstance(ci,int) and 0<=ci<len(positions):
            lane=positions[ci];dimension=1 if horizontal else 0
            available=[s for s in available if abs(s['bbox'][dimension]+s['bbox'][dimension+2]/2-lane)<step*.55]
            if horizontal and abs(ty-lane)>step*.5:ty=lane
            if not horizontal and abs(tx-lane)>step*.5:tx=lane
        found=match_text(available,t.get('text',''),tx,ty,t.get('anchor','start'),t.get('role')=='category')
        if not found:continue
        claim([found],t)
        x,y,w,h=found.get('glyphBox',found['bbox']);t['x']=x+(w/2 if t.get('anchor')=='middle' else w if t.get('anchor')=='end' else 0);t['y']=y+h
        t['glyphBox']=[x,y,w,h];count+=1
    for l in out.get('legends',[]):
        # Legend text is supplied by the immutable figure below, not OCR guessing.
        if not isinstance(l,dict):continue
        i=l.get('index') if figure['kind']=='pie' else l.get('series')
        names=figure['chart']['labels'] if figure['kind']=='pie' else [s['name'] for s in figure['chart']['series']]
        if not isinstance(i,int) or not 0<=i<len(names):continue
        found=match_text(available_spans(),names[i],l.get('textX',0),l.get('textY',0))
        if found:
            b=found.get('glyphBox',found['bbox'])
            if b[0]>=l.get('x',0)+l.get('width',0)*.85:
                l['glyphBox']=b;l['textX']=b[0];l['textY']=b[1]+b[3];count+=1
        # Symbol and text are separate legend fields. A coarse symbol width
        # must not paint underneath its own dark label or the next legend item.
        if isinstance(l.get('textX'),(int,float)) and isinstance(l.get('x'),(int,float)) and l['textX']>l['x']:
            l['width']=min(l.get('width',1.5),max(.1,l['textX']-l['x']-.35))
    # Tick fonts are measured separately; their positions still follow the scale.
    for key in ('valueAxis','xAxis','secondaryAxis'):
        a=out.get(key)
        if not a:continue
        heights=[]
        for t in a.get('ticks',[]):
            candidates=[s for s in spans if s['text']==t['text'] and s.get('glyphBox')]
            if candidates:heights.append(float(np.median([s['glyphBox'][3] for s in candidates])))
        if heights:a['fontSize']=float(np.median(heights))/.72
    cat=out.get('categoryAxis',{});horizontal=out.get('orientation')=='horizontal';positions=out.get('categoryPositions',[])
    if cat.get('visible') and len(positions)==len(figure['chart']['labels']) and not out.get('xAxis'):
        matched=[];bx,by,bw,bh=out['plotBox']
        for i,name in enumerate(figure['chart']['labels']):
            x=bx-1 if horizontal else positions[i];y=positions[i] if horizontal else by+bh+5;anchor='end' if horizontal else 'middle'
            found=match_text(spans,name,x,y,anchor,True)
            if found:
                x0,y0,w,h=found.get('glyphBox',found['bbox']);matched.append({'role':'category','index':i,'text':name,'x':x0+(w if horizontal else w/2),'y':y0+h,'anchor':anchor,'fontSize':cat.get('fontSize',3),'glyphBox':[x0,y0,w,h]})
        if len(matched)==len(positions):
            cat['visible']=False;out['texts'].extend(matched);count+=len(matched)
    out['rasterTextMeasurement']={'method':ocr.get('method'),'matchedLabels':count}
    calibrate_layout_axes(out,ocr)
    return out


def calibrate_layout_axes(layout,ocr):
    """Tick positions, independent of series ordering, calibrate each source axis.

    Only accept at least two aligned text matches near the corresponding axis.
    Source right-axis labels may sit inside the plot; keep their actual X offset.
    """
    if not isinstance(layout,dict) or not layout.get('plotBox'):return
    x,y,w,h=layout['plotBox'];horizontal=layout.get('orientation')=='horizontal'
    for key in ('valueAxis','secondaryAxis','xAxis'):
        a=layout.get(key)
        if not a or not a.get('visible'):continue
        is_x=key=='xAxis' or horizontal;side=a.get('side','bottom' if is_x else 'left');domain=a.get('domain',[])
        if len(domain)!=2 or domain[1]==domain[0]:continue
        matched=[];ticks=[]
        for t in a.get('ticks',[]):
            if not isinstance(t.get('value'),(float,int)):continue
            candidates=[]
            for s in ocr.get('spans',[]):
                if s.get('confidence',0)<.5 or tick_number(s.get('text'))!=t['value']:continue
                b=s.get('glyphBox',s['bbox']);cx=b[0]+b[2]/2;cy=b[1]+b[3]/2
                if is_x:
                    near=abs(cy-(y if side=='top' else y+h))<13 and x-2<=cx<=x+w+2
                else:
                    near=abs(cx-(x+w if side=='right' else x))<17 and y-2<=cy<=y+h+2
                if near:candidates.append((abs(cy-(y if side=='top' else y+h)) if is_x else abs(cx-(x+w if side=='right' else x)),s,b))
            if not candidates:continue
            _,s,b=min(candidates,key=lambda a:a[0]);p=b[0]+b[2]/2 if is_x else b[1]+b[3]/2
            matched.append((t,s,b));ticks.append({'position':p,'value':t['value']})
        if len(matched)<2:continue
        ortho=[b[1]+b[3]/2 if is_x else b[0]+b[2]/2 for _,_,b in matched]
        if max(ortho)-min(ortho)>4:continue
        try:
            cal=calibration(ticks,a.get('scale','linear'))
            lo,hi=(value_at(cal,x),value_at(cal,x+w)) if is_x else (value_at(cal,y+h),value_at(cal,y))
            if hi==lo:continue
        except ValueError:continue
        a['domain']=sorted([lo,hi]);a['reversed']=hi<lo;a['calibration']={'method':'ocr-tick-centers','ticks':ticks}
        for t,s,b in matched:
            t.update(textX=b[0]+b[2]/2,textY=b[1]+b[3],anchor='middle')
        heights=[b[3] if s.get('glyphBox') else b[3]*.78 for _,s,b in matched]
        a['fontSize']=float(np.median(heights))/.72


def measured_bar_order(centers, bars):
    """Infer only a unique spatial order supported by separated source marks.

    Pair comparisons allow missing values without compressing their slots.
    Conflicting or disconnected observations cannot silently choose data order.
    """
    votes={}
    for marks in centers.values():
        ordered=sorted(marks,key=lambda m:m[2])
        for i,a in enumerate(ordered):
            for b in ordered[i+1:]:
                if a[2]+a[1]/2>b[2]-b[1]/2+.15:continue
                votes[a[0],b[0]]=votes.get((a[0],b[0]),0)+1
    edges=set()
    for (a,b),count in votes.items():
        reverse=votes.get((b,a),0)
        if not reverse or count>=3*reverse:edges.add((a,b))
    order=[];remaining=set(bars)
    while remaining:
        first=[b for b in remaining if not any(a in remaining and end==b for a,end in edges)]
        if len(first)!=1:return None
        order.append(first[0]);remaining.remove(first[0])
    return {'order':order,'method':'source-color-pair-order',
            'comparisons':[{'before':a,'after':b,'observations':n} for (a,b),n in sorted(votes.items())]}


def measure_marks(image,figure,layout):
    """Measure widths/centers from source-colored pixels, not model-sized marks."""
    if figure.get('kind') not in ('chart','curves'):return layout
    a=np.asarray(Image.open(io.BytesIO(image)).convert('RGB')).astype(np.int16);h,w=a.shape[:2]
    styles=layout.get('seriesStyles',[]);series=figure['chart']['series'];categories=figure['chart']['labels'];horizontal=layout.get('orientation')=='horizontal'
    box=layout.get('plotBox')
    if not isinstance(box,list) or len(box)!=4:return layout
    bx,by,bw,bh=box;x0=max(0,int(bx*w/100));x1=min(w,int((bx+bw)*w/100));y0=max(0,int(by*h/100));y1=min(h,int((by+bh)*h/100))
    measurements=[];centers={i:[] for i in range(len(categories))};widths=[]
    def runs(mask):
        hits=np.flatnonzero(mask);groups=[]
        for v in hits:
            if not groups or v-groups[-1][-1]>1:groups.append([int(v)])
            else:groups[-1].append(int(v))
        return groups
    for style in styles:
        si=style.get('series')
        if not isinstance(si,int) or not 0<=si<len(series):continue
        color=next((c.get('color') for c in figure.get('seriesColors',[]) if c.get('name')==series[si]['name']),None)
        if not isinstance(color,str) or not re.fullmatch('#[a-fA-F0-9]{6}',color):continue
        rgb=np.array([int(color[i:i+2],16) for i in (1,3,5)])
        mask=color_mask(a,rgb)
        # Tolerance alone can classify one bar as two nearby series colors.
        # Partition shared candidates by the closest declared source fill.
        distance=np.linalg.norm(a-rgb,axis=2)
        for peer in figure.get('seriesColors',[]):
            other=peer.get('color')
            if not isinstance(other,str) or not re.fullmatch('#[a-fA-F0-9]{6}',other) or other.lower()==color.lower():continue
            other_rgb=np.array([int(other[i:i+2],16) for i in (1,3,5)])
            mask &= distance<np.linalg.norm(a-other_rgb,axis=2)
        geometry=style.get('geometry');sub=mask[y0:y1,x0:x1]
        if not sub.size:continue
        if geometry=='bar':
            profile=sub.sum(axis=1 if horizontal else 0);minimum=max(3,profile.max()*.025)
            parts=runs(profile>minimum);dimension=h if horizontal else w;offset=y0 if horizontal else x0
            parts=[p for p in parts if len(p)>=dimension*.003]
            indices=[i for i,v in enumerate(series[si]['values']) if v is not None and v!=0]
            sourcepos=layout.get('categoryPositions',[])
            if len(sourcepos)!=len(categories) or not indices:continue
            # Axis glyphs can share the exact bar color and be INSIDE the plot.
            # Bind pixel runs to individual source category hints instead of
            # requiring the global number of colored runs to equal the data.
            ordered=sorted(sourcepos);steps=[b-a for a,b in zip(ordered,ordered[1:]) if b>a]
            tolerance=min(12,min(steps)*.48) if steps else 12
            hints={(p.get('series'),p.get('index')):p.get('y' if horizontal else 'x') for p in figure.get('rasterPlot',{}).get('points',[])}
            candidates=[(j,len(p)/dimension*100,(offset+(p[0]+p[-1])/2)/dimension*100) for j,p in enumerate(parts)]
            local=[];used=set()
            for i in sorted(indices,key=lambda i:sourcepos[i]):
                target=hints.get((si,i),sourcepos[i])
                if not isinstance(target,(int,float)):target=sourcepos[i]
                near=[p for p in candidates if p[0] not in used and abs(p[2]-target)<tolerance]
                if not near:break
                j,width,at=min(near,key=lambda p:abs(p[2]-target));used.add(j)
                local.append((i,width,at))
            else:
                # Thin same-colored glyph fragments can lie closer to a model
                # center than the actual bar. Prefer repeated source widths;
                # never use a lone anomalous fragment to move an entire group.
                typical=float(np.median([width for _,width,_ in local]))
                coherent=lambda width:typical*.65<=width<=typical*1.5
                if len(local)>=3 and sum(coherent(width) for _,width,_ in local)>=len(local)*.6:
                    repaired=[]
                    for i,width,at in local:
                        if not coherent(width):
                            target=hints.get((si,i),sourcepos[i])
                            if not isinstance(target,(int,float)):target=sourcepos[i]
                            alternatives=[p for p in candidates if p[0] not in used and coherent(p[1]) and abs(p[2]-target)<tolerance]
                            if not alternatives:continue
                            j,width,at=min(alternatives,key=lambda p:abs(p[2]-target));used.add(j)
                        repaired.append((i,width,at))
                    local=repaired
                for i,width,at in local:widths.append(width);centers[i].append((si,width,at))
                measured=[]
                for i,width,at in local:
                    # Recover the two value-axis edges independently of the
                    # model. A majority across the bar thickness rejects glyphs.
                    low=max(offset,round((at-width*.35)*dimension/100));high=min(offset+sub.shape[0 if horizontal else 1],round((at+width*.35)*dimension/100)+1)
                    strip=mask[low:high,x0:x1] if horizontal else mask[y0:y1,low:high]
                    occupied=np.flatnonzero(strip.mean(axis=0 if horizontal else 1)>.6) if strip.size else []
                    mark={'index':i,'width':width,'center':at}
                    if len(occupied)>2:
                        start=x0 if horizontal else y0;size=w if horizontal else h
                        mark['span']=[(start+int(occupied[0]))/size*100,(start+int(occupied[-1])+1)/size*100]
                    measured.append(mark)
                measurements.append({'series':si,'geometry':'bar','bars':len(local),'marks':measured,
                                     'ignoredColorRuns':len(parts)-len(local)})
        elif geometry in ('line','area') and not horizontal:
            lengths=[]
            for x in range(x0,x1):
                pieces=[p for p in runs(mask[y0:y1,x]) if 0<len(p)<h*.025]
                if len(pieces)==1:lengths.append(len(pieces[0]))
            if len(lengths)>max(12,(x1-x0)*.15):
                style['lineWidth']=float(np.percentile(lengths,35))/h*100
                measurements.append({'series':si,'geometry':'line','lineWidth':style['lineWidth']})
            if style.get('marker') not in (None,'none'):
                axis=layout.get('secondaryAxis') if style.get('axis')=='secondary' else layout.get('valueAxis');domain=axis.get('domain') if axis else None;ps=layout.get('categoryPositions',[])
                sizes=[]
                if domain and len(ps)==len(categories):
                    for i,v in enumerate(series[si]['values']):
                        if v is None:continue
                        ratio=(v-domain[0])/(domain[1]-domain[0])
                        if axis.get('reversed') and domain[0]<domain[1]:ratio=1-ratio
                        x=int(ps[i]*w/100);y=(by+bh-ratio*bh)*h/100
                        if not 0<=x<w:continue
                        pieces=runs(mask[:,x]);near=[p for p in pieces if min(abs(p[0]-y),abs(p[-1]-y),abs((p[0]+p[-1])/2-y))<h*.025 and 3<len(p)<h*.075]
                        if near:sizes.append(len(min(near,key=lambda p:abs((p[0]+p[-1])/2-y))))
                if len(sizes)>=2:style['markerSize']=float(np.median(sizes))/h*100
    order_evidence=None
    mirror_evidence=measure_mirror(measurements,figure,layout,w if horizontal else h,h if horizontal else w)
    if widths:
        layout['barWidth']=float(np.median(widths))
        bars=[s['series'] for s in styles if s.get('geometry')=='bar']
        bar_count=len(bars)
        grouped=figure['chart'].get('kind')!='stacked-bar' and bar_count>1 and not layout.get('mirrorBars') and layout.get('barPlacement')!='category'
        if grouped:
            clean={i:[m for m in marks if layout['barWidth']*.65<=m[1]<=layout['barWidth']*1.5] for i,marks in centers.items()}
            order_evidence=measured_bar_order(clean,bars)
            if order_evidence:
                order=order_evidence['order'];layout['barSeriesOrder']=order
                ranks={si:rank for rank,si in enumerate(order)};steps=[]
                for marks in clean.values():
                    ordered=sorted(marks,key=lambda m:ranks[m[0]])
                    steps.extend((b[2]-a[2])/(ranks[b[0]]-ranks[a[0]]) for a,b in zip(ordered,ordered[1:]))
                step=float(np.median(steps))
                if step>=layout['barWidth']-.15:
                    layout['groupGap']=max(0,step-layout['barWidth'])
                    step=layout['barWidth']+layout['groupGap']
                    for i,marks in clean.items():
                        if marks:
                            # Missing bars keep their series slots; averaging
                            # only the visible bars would shift the whole group.
                            layout['categoryPositions'][i]=float(np.median([m[2]-(ranks[m[0]]-(bar_count-1)/2)*step for m in marks]))
        else:
            for i,marks in centers.items():
                if marks:layout['categoryPositions'][i]=float(np.mean([m[2] for m in marks]))
    # Callout/rule widths are stylistic strokes; measure long neutral horizontal
    # rules directly when supplied endpoints form one.
    for l in layout.get('lines',[]):
        pts=l.get('points',[])
        if len(pts)==2 and abs(pts[0][1]-pts[1][1])<.2 and abs(pts[0][0]-pts[1][0])>30:
            yy=int(np.mean([p[1] for p in pts])*h/100);xx0=max(0,int(min(p[0] for p in pts)*w/100));xx1=min(w,int(max(p[0] for p in pts)*w/100))
            area=a[max(0,yy-5):min(h,yy+6),xx0:xx1]
            if area.size:
                occupied=((area.max(axis=2)-area.min(axis=2)<15)&(area.mean(axis=2)<200)).mean(axis=1)>.7
                if 0<occupied.sum()<5:l['width']=float(occupied.sum())/h*100
    layout['rasterMarkMeasurement']={'method':'source-color-pixel-runs','series':measurements}
    if order_evidence:layout['rasterMarkMeasurement']['barSeriesOrder']=order_evidence
    if mirror_evidence:layout['rasterMarkMeasurement']['mirrorBars']=mirror_evidence
    return layout


def refine_ticks(figure,ocr):
    r=figure.get('rasterPlot')
    if not r:return
    def numeric(s):return tick_number(s['text'])
    for key,dimension in [('xTicks',0),('yTicks',1),('secondaryXTicks',0),('secondaryYTicks',1)]:
        ticks=r.get(key,[])
        if len(ticks)<2:continue
        chosen=[]
        for t in ticks:
            possible=[s for s in ocr.get('spans',[]) if s.get('confidence',0)>.5 and numeric(s)==t['value']]
            def center(s):
                b=s.get('glyphBox',s['bbox']);return b[dimension]+b[dimension+2]/2
            possible.sort(key=lambda s:abs(center(s)-t['position']))
            if not possible or abs(center(possible[0])-t['position'])>5:continue
            chosen.append((t,possible[0]))
        if len(chosen)<2:continue
        ortho=[s['bbox'][1-dimension]+s['bbox'][3-dimension]/2 for _,s in chosen]
        if max(ortho)-min(ortho)>3:continue
        for t,s in chosen:
            b=s.get('glyphBox',s['bbox']);t['position']=round(b[dimension]+b[dimension+2]/2,4)
        r[key]=[t for t,_ in chosen]
        figure.setdefault('rasterGeometry',{})['axisMethod']='local-ocr-tick-centers'


def infer_bar_colors(pixels,figure):
    """Recover omitted source fill hints from repeated rectangular pixel runs.

    The model may omit optional color metadata. Candidate colors come only from
    neighborhoods of this upload's marks; coherent bars must support a majority
    of hints. Backgrounds, short label boxes and ambiguous fills are rejected.
    """
    r=figure.get('rasterPlot',{});horizontal=r.get('orientation')=='horizontal'
    h,w=pixels.shape[:2];colors=figure.setdefault('seriesColors',[])
    if not isinstance(colors,list):return
    def runs(hits,gap=1):
        groups=[]
        for hit in hits:
            if not groups or hit-groups[-1][-1]>gap:groups.append([int(hit)])
            else:groups[-1].append(int(hit))
        return groups
    for si,series in enumerate(figure.get('chart',{}).get('series',[])):
        if any(c.get('name')==series['name'] and re.fullmatch('#[a-fA-F0-9]{6}',str(c.get('color',''))) for c in colors):continue
        style=next((s for s in figure.get('seriesGeometry',[]) if s.get('series')==si),{})
        if style.get('geometry','line' if figure['chart']['kind']=='line' else 'bar')!='bar':continue
        points=[p for p in r.get('points',[]) if p.get('series')==si and all(isinstance(p.get(k),(int,float)) and 0<=p[k]<=100 for k in ('x','y'))]
        if not points:continue
        samples=[]
        for p in points:
            x,y=p['x']*w/100,p['y']*h/100;dx,dy=(w*.085,h*.014) if horizontal else (w*.014,h*.085)
            patch=pixels[max(0,int(y-dy)):min(h,math.ceil(y+dy)),max(0,int(x-dx)):min(w,math.ceil(x+dx))]
            if patch.size:samples.append(patch.reshape(-1,3))
        if not samples:continue
        sample=np.concatenate(samples);codes=sample//16;keys,counts=np.unique(codes,axis=0,return_counts=True);scored=[]
        for ki in np.argsort(counts)[::-1][:12]:
            if counts[ki]<len(sample)*.015:continue
            rgb=np.median(sample[(codes==keys[ki]).all(axis=1)],axis=0)
            if rgb.min()>242 or rgb.max()-rgb.min()<16 and rgb.mean()>215:continue
            mask=color_mask(pixels,rgb)
            if horizontal:mask=mask.T
            length,width=mask.shape
            columns=runs(np.flatnonzero(mask.sum(axis=0)>max(5,length*.025)))
            columns=[g for g in columns if width*.004<len(g)<width*.3]
            distances=[];support=[]
            for p in points:
                at=p['y' if horizontal else 'x']/100*width;target=p['x' if horizontal else 'y']/100*length
                near=[g for g in columns if abs((g[0]+g[-1])/2-at)<width*.045]
                if not near:continue
                g=min(near,key=lambda a:abs((a[0]+a[-1])/2-at))
                hits=np.flatnonzero(mask[:,g[0]:g[-1]+1].mean(axis=1)>.5)
                segments=[a for a in runs(hits,max(2,round(length*.006))) if len(a)>=max(6,length*.05)]
                matches=[(abs(end-target),len(a)) for a in segments for end in (a[0],a[-1]+1) if abs(end-target)<length*.08]
                if matches:
                    distance,amount=min(matches);distances.append(distance);support.append(amount)
            if len(distances)>=max(1,math.ceil(len(points)*.65)):
                scored.append((len(distances),float(np.mean(support)),float(np.mean(distances)),rgb))
        if not scored:continue
        scored.sort(key=lambda a:(a[0],a[1],-a[2]),reverse=True);best=scored[0]
        # Similar support for different fills is ambiguous, e.g. stacked colors
        # sharing the same endpoint hints; leave it for source review.
        if len(scored)>1:
            other=scored[1]
            if other[0]==best[0] and other[1]>best[1]*.85 and np.linalg.norm(other[3]-best[3])>65:continue
        color='#'+''.join(f'{round(v):02x}' for v in best[3]);colors.append({'name':series['name'],'color':color})
        figure.setdefault('rasterGeometry',{}).setdefault('sourceColorRecovery',[]).append({'series':si,'color':color,'method':'source-rectangular-fill-consensus','matched':best[0]})


def refine_bar_endpoints(image,figure):
    """Snap model mark hints to a source-color bar, never to a stored example.

    Require a coherent colored run near the model's endpoint. Printed numbers
    are untouched, and the later axis calibration retains estimate provenance.
    """
    r=figure.get('rasterPlot')
    if not r or figure.get('kind')!='chart':return
    pixels=np.asarray(Image.open(io.BytesIO(image)).convert('RGB')).astype(np.int16)
    infer_bar_colors(pixels,figure)
    h,w=pixels.shape[:2];horizontal=r.get('orientation')=='horizontal';count=0;centers={}
    def runs(hits,gap=1):
        groups=[]
        for hit in hits:
            if not groups or hit-groups[-1][-1]>gap:groups.append([int(hit)])
            else:groups[-1].append(int(hit))
        return groups
    for p in r.get('points',[]):
        si=p.get('series');series=figure.get('chart',{}).get('series',[])
        if not isinstance(si,int) or not 0<=si<len(series):continue
        style=next((s for s in figure.get('seriesGeometry',[]) if s.get('series')==si),{})
        if style.get('geometry', 'line' if figure['chart']['kind']=='line' else 'bar')!='bar':continue
        color=next((c.get('color') for c in figure.get('seriesColors',[]) if c.get('name')==series[si]['name']),None)
        if not isinstance(color,str) or not re.fullmatch('#[a-fA-F0-9]{6}',color):continue
        if not all(isinstance(p.get(k),(int,float)) and 0<=p[k]<=100 for k in ('x','y')):continue
        rgb=np.array([int(color[i:i+2],16) for i in (1,3,5)])
        mask=color_mask(pixels,rgb)
        if horizontal:mask=mask.T
        length,width=mask.shape;at=round(p['y' if horizontal else 'x']/100*width)
        # Locate the filled bar across its width. A label/marker covering its
        # centre must not turn an interior color-run boundary into the bar end.
        columns=runs(np.flatnonzero(mask.sum(axis=0)>max(5,length*.02)))
        columns=[g for g in columns if width*.004<len(g)<width*.3 and abs((g[0]+g[-1])/2-at)<width*.065]
        if not columns:continue
        group=min(columns,key=lambda g:abs((g[0]+g[-1])/2-at));lo,hi=group[0],group[-1]+1
        strip=mask[:,lo:hi];hits=np.flatnonzero(strip.mean(axis=1)>.4)
        segments=runs(hits,gap=max(2,round(length*.006)))
        key='x' if horizontal else 'y';target=p[key]*length/100
        candidates=[(abs(end-target),end) for run in segments if len(run)>=max(4,length*.025) for end in (run[0],run[-1]+1)]
        if candidates and min(candidates)[0]<length*.08:
            p[key]=min(candidates)[1]/length*100;p['y' if horizontal else 'x']=(lo+hi-1)/2/width*100;count+=1
            centers.setdefault(p.get('index'),[]).append(p['y' if horizontal else 'x'])
    if count:figure.setdefault('rasterGeometry',{})['barEndpointMethod']={'method':'source-color-pixel-run','matched':count}
    bar_series={s.get('series') for s in figure.get('seriesGeometry',[]) if s.get('geometry')=='bar'}
    # Shared category coordinates locate a combo line; the line itself still
    # comes from its own colored pixels and axis, not the bar's value.
    for p in r.get('points',[]):
        si=p.get('series');series=figure.get('chart',{}).get('series',[])
        if not isinstance(si,int) or not 0<=si<len(series):continue
        style=next((s for s in figure.get('seriesGeometry',[]) if s.get('series')==si),{})
        if style.get('geometry','line' if figure['chart']['kind']=='line' else 'bar') not in ('line','point'):continue
        color=next((c.get('color') for c in figure.get('seriesColors',[]) if c.get('name')==series[si]['name']),None)
        if not isinstance(color,str) or not re.fullmatch('#[a-fA-F0-9]{6}',color):continue
        if not all(isinstance(p.get(k),(int,float)) and 0<=p[k]<=100 for k in ('x','y')):continue
        rgb=np.array([int(color[i:i+2],16) for i in (1,3,5)]);mask=color_mask(pixels,rgb)
        if horizontal:mask=mask.T
        length,width=mask.shape;catkey='y' if horizontal else 'x';key='x' if horizontal else 'y'
        if len(bar_series)==1 and p['index'] in centers:p[catkey]=float(np.median(centers[p['index']]))
        at=round(p[catkey]/100*width);strip=mask[:,max(0,at-1):min(width,at+2)]
        if not strip.size:continue
        candidates=[g for g in runs(np.flatnonzero(strip.mean(axis=1)>.3)) if len(g)<length*.09]
        target=p[key]*length/100;candidates=[g for g in candidates if abs((g[0]+g[-1])/2-target)<length*.07]
        if candidates:
            g=min(candidates,key=lambda g:abs((g[0]+g[-1])/2-target));p[key]=(g[0]+g[-1])/2/length*100
            figure.setdefault('rasterGeometry',{})['linePointMethod']='source-color-pixel-run'
        else:
            # Icons/callout labels may cover a line vertex. Fit the visible
            # short line segments on each side to the category coordinate.
            # Two sides must agree; this stays an explicit coordinate estimate.
            projected=[];radius=max(12,round(width*.035));inner=max(3,round(width*.004))
            for direction in (-1,1):
                points=[]
                for delta in range(inner,radius):
                    xx=at+direction*delta
                    if not 0<=xx<width:continue
                    ys=np.flatnonzero(mask[max(0,int(target-length*.09)):min(length,int(target+length*.09)),xx])
                    if not len(ys):continue
                    ys=ys+max(0,int(target-length*.09));pieces=runs(ys)
                    piece=min(pieces,key=lambda g:abs((g[0]+g[-1])/2-target))
                    if len(piece)<length*.03:points.append((xx,(piece[0]+piece[-1])/2))
                if len(points)<max(5,radius//5):continue
                xs=np.array([q[0] for q in points]);ys=np.array([q[1] for q in points]);coeff=np.polyfit(xs,ys,1)
                if np.max(np.abs(np.polyval(coeff,xs)-ys))>max(2,length*.005):continue
                projected.append(float(np.polyval(coeff,at)))
            if projected and max(projected)-min(projected)<max(3,length*.018) and abs(float(np.mean(projected))-target)<length*.09:
                p[key]=float(np.mean(projected))/length*100
                figure.setdefault('rasterGeometry',{})['linePointMethod']='visible-segment-intersection-at-category'


def refine_grid_axes(image,figure):
    """Snap modeled tick values to independently measured long grid/axis lines."""
    r=figure.get('rasterPlot')
    if not r or figure.get('kind') not in ('scatter','curves') or min(len(r.get('xTicks',[])),len(r.get('yTicks',[])))<3:return
    a=np.asarray(Image.open(io.BytesIO(image)).convert('RGB')).astype(np.int16);h,w=a.shape[:2]
    neutral=(a.max(axis=2)-a.min(axis=2)<12)&(a.mean(axis=2)<246)
    xs=[t['position'] for t in r['xTicks']];ys=[t['position'] for t in r['yTicks']]
    for key,dimension,other in [('xTicks',0,ys),('yTicks',1,xs)]:
        total=w if dimension==0 else h;orthogonal=h if dimension==0 else w
        lo=int((min(other)+3)/100*orthogonal);hi=int((max(other)-3)/100*orthogonal)
        if hi-lo<orthogonal*.2:continue
        profile=neutral[lo:hi,:].mean(axis=0) if dimension==0 else neutral[:,lo:hi].mean(axis=1)
        hits=np.flatnonzero(profile>.67)
        clusters=[]
        for hit in hits:
            if not clusters or hit-clusters[-1][-1]>2:clusters.append([int(hit)])
            else:clusters[-1].append(int(hit))
        centers=[float(np.mean(g))/total*100 for g in clusters if len(g)<total*.012]
        ticks=r[key];mapped=[]
        for t in ticks:
            nearest=min(centers,key=lambda pos:abs(pos-t['position'])) if centers else None
            if nearest is None or abs(nearest-t['position'])>4:break
            mapped.append(nearest)
        if len(mapped)==len(ticks) and len(set(mapped))==len(ticks):
            for t,p in zip(ticks,mapped):t['position']=round(p,4)
            figure.setdefault('rasterGeometry',{})['axisMethod']='pixel-grid-lines-with-printed-tick-values'


def refine_scatter(image,figure):
    r=figure.get('rasterPlot');points=r.get('points',[]) if r else []
    if figure.get('kind')!='scatter' or not 2<=len(points)<=100:return
    im=Image.open(io.BytesIO(image)).convert('RGB');im.thumbnail((1800,1800));a=np.asarray(im).astype(np.int16);h,w=a.shape[:2]
    # Color is only a segmentation cue. We never preserve source colors in output.
    original=(a.max(axis=2)-a.min(axis=2)>35)&(a.min(axis=2)<185)
    padded=np.pad(original,1);mask=np.zeros_like(original)
    for dy in range(3):
        for dx in range(3):mask |= padded[dy:dy+h,dx:dx+w]
    visited=np.zeros(mask.shape,dtype=bool);candidates=[]
    for y,x in zip(*np.nonzero(mask)):
        if visited[y,x]:continue
        queue=deque([(int(x),int(y))]);visited[y,x]=True;xs=[];ys=[]
        while queue:
            xx,yy=queue.popleft();xs.append(xx);ys.append(yy)
            for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nx,ny=xx+dx,yy+dy
                if 0<=nx<w and 0<=ny<h and mask[ny,nx] and not visited[ny,nx]:visited[ny,nx]=True;queue.append((nx,ny))
        keep=[i for i,(xx,yy) in enumerate(zip(xs,ys)) if original[yy,xx]]
        if not keep:continue
        xs=[xs[i] for i in keep];ys=[ys[i] for i in keep]
        bw=max(xs)-min(xs)+1;bh=max(ys)-min(ys)+1
        if 4<=bw<=w*.045 and 4<=bh<=h*.08 and .65<=bw/bh<=1.55 and len(xs)/(bw*bh)>.35:
            candidates.append({'x':(min(xs)+max(xs))/2/w*100,'y':(min(ys)+max(ys))/2/h*100,'w':bw/w*100,'h':bh/h*100,'area':len(xs),'color':np.median(a[ys,xs],axis=0).tolist()})
    selected=[]
    for p in points:
        if not isinstance(p.get('x'),(int,float)) or not isinstance(p.get('y'),(int,float)):return
        nearby=sorted(candidates,key=lambda q:math.hypot((q['x']-p['x'])*w/h,q['y']-p['y']))
        if not nearby or math.hypot((nearby[0]['x']-p['x'])*w/h,nearby[0]['y']-p['y'])>5:return
        selected.append(nearby[0])
    if len({id(q) for q in selected})!=len(selected):return
    areas=[q['area'] for q in selected]
    if max(areas)/min(areas)>1.8:return
    # All selected marks must have the same appearance. This prevents snapping
    # some points to colored label text or an unrelated legend symbol.
    mean=np.median(np.array([q['color'] for q in selected]),axis=0)
    if any(np.linalg.norm(np.array(q['color'])-mean)>35 for q in selected):return
    for p,q in zip(points,selected):p['x']=round(q['x'],4);p['y']=round(q['y'],4)
    figure['rasterGeometry']={'method':'colored-connected-components','pointCount':len(selected),
                              'markerHeight':float(np.median([q['h'] for q in selected])),
                              'positions':[[q['x'],q['y']] for q in selected]}
