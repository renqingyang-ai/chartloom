"""Local trial: read source geometry as evidence, never use a chart screenshot as output."""
import io
import json
import math
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

import fitz
from PIL import Image
from .native_plot import recover


def hexcolor(value):
    if value is None:
        return None
    return '#' + ''.join(f'{max(0,min(255,round(v*255))):02x}' for v in value[:3])


def package(folder, number, image):
    result = {'kind': 'image', 'spans': [], 'paths': [], 'nativeCharts': [], 'images': []}
    pdf = folder / 'input.pdf'
    if pdf.exists():
        with fitz.open(pdf) as doc:
            page = doc[number-1]
            w, h = page.rect.width, page.rect.height
            box = lambda r: [round(r[0]/w*100,3), round(r[1]/h*100,3), round((r[2]-r[0])/w*100,3), round((r[3]-r[1])/h*100,3)]
            point = lambda p: [round(p.x/w*100,3), round(p.y/h*100,3)]
            result.update(kind='pdf', width=w, height=h)
            for b in page.get_text('dict')['blocks']:
                for line in b.get('lines', []):
                    for s in line['spans']:
                        if s['text'].strip():
                            result['spans'].append({'text':s['text'], 'bbox':box(s['bbox']), 'size':s['size'], 'origin':[s['origin'][0]/w*100,s['origin'][1]/h*100], 'direction':list(line['dir']), 'color':f"#{s['color']:06x}"})
            for d in page.get_drawings():
                # Horizontal/vertical paths have an empty Rect in PyMuPDF.
                # intersects() returns false for them, dropping map leaders,
                # table rules and diagram connectors despite valid positions.
                r=d['rect']
                if r.x1<0 or r.y1<0 or r.x0>w or r.y0>h or r.get_area() > w*h*.95:
                    continue
                commands = []
                for i in d['items']:
                    if i[0] in ('l','c'):
                        commands.append([i[0], *[point(p) for p in i[1:]]])
                    elif i[0] == 're':
                        commands.append(['rect', box(i[1])])
                    elif i[0] == 'qu':
                        commands.append(['quad', *[point(p) for p in (i[1].ul,i[1].ur,i[1].lr,i[1].ll)]])
                dash=re.search(r'\[([^\]]*)\]',d.get('dashes') or '')
                result['paths'].append({'bbox':box(d['rect']), 'fill':hexcolor(d['fill']), 'stroke':hexcolor(d['color']), 'width':d['width'], 'closed':d['closePath'], 'dashes':[float(v) for v in re.findall(r'[\d.]+',dash[1])] if dash else [], 'commands':commands})
            for index, im in enumerate(page.get_image_info(xrefs=True)):
                # A readable wordmark may be only 18 pixels high. Size is not a
                # semantic classifier; inventory decides logo/photo/shadow roles.
                if im['xref'] and im['width']>8 and im['height']>8:
                    result['images'].append({'id':f'image-{index}', 'xref':im['xref'],'bbox':box(im['bbox']),'width':im['width'],'height':im['height']})
    else:
        with Image.open(io.BytesIO(image)) as im:
            result.update(width=im.width,height=im.height)
    ppt = folder / 'input.pptx'
    if ppt.exists():
        result['nativeCharts'] = ppt_charts(ppt, number)
    return result


def inside(a, b):
    return b[0] <= a[0]+a[2]/2 <= b[0]+b[2] and b[1] <= a[1]+a[3]/2 <= b[1]+b[3]


def region_evidence(native, bbox):
    spans = [s for s in native['spans'] if inside(s['bbox'], bbox)]
    paths = [p for p in native['paths'] if inside(p['bbox'], bbox)]
    # Color swatches are linked geometrically to printed legend names, not guessed from series order.
    swatches = [p for p in paths if p['fill'] and .2<p['bbox'][2]<2 and .3<p['bbox'][3]<3]
    legend = []
    for p in swatches:
        x,y,w,h=p['bbox']
        options=[s for s in spans if 0 <= s['bbox'][0]-(x+w)<2 and abs(s['bbox'][1]+s['bbox'][3]/2-y-h/2)<1.2 and re.search('[A-Za-z]',s['text'])]
        if options:
            label=min(options,key=lambda s:s['bbox'][0])
            legend.append({'name':label['text'],'color':p['fill'],'bbox':p['bbox']})
    rectangles=[]
    for p in paths:
        rectangles.extend({'bbox':cmd[1],'fill':p['fill']} for cmd in p['commands'] if cmd[0]=='rect' and p['fill'])
    numbers=[]
    for s in spans:
        if not re.fullmatch(r'\s*[($−\-]?[\d,.]+[%)]?\s*',s['text']):
            continue
        containing=[p for p in rectangles if inside(s['bbox'],p['bbox']) and p['bbox'][2]*p['bbox'][3]<bbox[2]*bbox[3]*.2]
        if containing:
            p=min(containing,key=lambda p:p['bbox'][2]*p['bbox'][3])
            names=sorted(set(l['name'] for l in legend if l['color']==p['fill']))
            if len(names)==1:
                numbers.append({'printed':s['text'],'series':names[0],'bbox':s['bbox'],'fill':p['fill']})
    return {'spans':spans,'legendColorEvidence':legend,'numberColorEvidence':numbers,'nativePlot':recover(spans,paths,bbox),
            'nativeCharts':[c for c in native['nativeCharts'] if inside(c['bbox'],bbox)],
            'paths':paths[:240], 'nativePathCount':len(paths)}


def printed_value_labels(figure,evidence):
    """Retain source currency, parentheses and decimal precision without altering data."""
    if not figure.get('chart'):return []
    from .chart_numbers import printed_number
    candidates={}
    for span in evidence['spans']:
        text=span['text'].strip()
        value=printed_number(text)
        if value is None:continue
        candidates.setdefault(value,[]).append(text)
    extracted=figure.get('valueLabels') or []
    def label(v,j,i):
        if v is None:return None
        raw=extracted[j][i] if isinstance(extracted,list) and j<len(extracted) and isinstance(extracted[j],list) and i<len(extracted[j]) else None
        if isinstance(raw,dict):raw=raw.get('text') if raw.get('value')==v else None
        if isinstance(raw,str) and printed_number(raw)==v:return {'value':v,'text':raw.strip()}
        return {'value':v,'text':max(candidates[v],key=lambda s:(len(s.split('.')[-1].rstrip('%)')) if '.' in s else 0,len(s)))} if v in candidates else None
    return [[label(v,j,i) for i,v in enumerate(s['values'])] for j,s in enumerate(figure['chart']['series'])]


def native_bar_baselines(figure,evidence):
    """Bind floating bars to exact printed amounts, using PDF geometry only to
    establish alignment. Never turn an unprinted pixel height into a data value.
    """
    chart=figure.get('chart',{})
    if figure.get('kind')!='chart' or chart.get('kind')!='stacked-bar':return
    rectangles=[{'bbox':cmd[1],'fill':p['fill']} for p in evidence['paths'] if p.get('fill') for cmd in p['commands'] if cmd[0]=='rect']
    bound=[]
    for number in evidence['numberColorEvidence']:
        try:value=float(number['printed'].strip().replace(',','').strip('$%()'))
        except ValueError:continue
        if value<=0:continue
        matches=[(s,i) for s in chart['series'] if s['name'].strip()==number['series'].strip() for i,v in enumerate(s['values']) if v==value]
        shapes=[r for r in rectangles if r['fill']==number['fill'] and inside(number['bbox'],r['bbox'])]
        if len(matches)!=1 or len(shapes)!=1:continue
        s,i=matches[0];bound.append({'series':s['name'],'categoryIndex':i,'value':value,'bbox':shapes[0]['bbox']})
    if len(bound)<2:return
    zeros=[p['bbox'][1] for p in evidence['paths'] if not p.get('fill') and p['bbox'][3]<.01 and p['bbox'][2]>max(b['bbox'][2] for b in bound)*2]
    zero=next((y for y in sorted(zeros,reverse=True) if any(abs(b['bbox'][1]+b['bbox'][3]-y)<.02 for b in bound)),None)
    if zero is None:return
    groups={}
    for b in bound:groups.setdefault(b['categoryIndex'],[]).append(b)
    bases=list(figure.get('barBaselines') or [])
    for i,bars in groups.items():
        if len(bars)!=1:continue
        b=bars[0];x,y,w,h=b['bbox']
        if zero-(y+h)<=.03:continue
        for j,other in groups.items():
            ordered=sorted(other,key=lambda item:item['bbox'][1])
            if j==i or abs(ordered[0]['bbox'][1]-y)>.02 or abs(ordered[-1]['bbox'][1]+ordered[-1]['bbox'][3]-zero)>.02:continue
            if any(abs(a['bbox'][1]+a['bbox'][3]-c['bbox'][1])>.02 for a,c in zip(ordered,ordered[1:])):continue
            top=sum(o['value'] for o in other);offset=top-b['value']
            if offset<=0:continue
            # Sanity-check source alignment, without treating geometry as a fact.
            ratio=(zero-y-h)/(zero-y)
            if abs(offset/top-ratio)>.006:continue
            printed=' + '.join(format(o['value'],'g') for o in other)
            base={'series':b['series'],'category':chart['labels'][i],'categoryIndex':i,'value':offset,
                  'derivation':f"PDF bar top aligns with printed stack total {printed} = {top:g}; offset {top:g} - {b['value']:g} = {offset:g}. Display geometry only."}
            bases=[old for old in bases if not (old.get('series')==b['series'] and old.get('categoryIndex')==i)]+[base]
            break
    figure['barBaselines']=bases


def printed_balance_discrepancies(figure):
    """Report an observable arithmetic discrepancy; never relabel source facts."""
    chart=figure.get('chart',{})
    if figure.get('componentKind')!='balance':return []
    amounts={}
    for s in chart.get('series',[]):
        values=[v for v in s['values'] if v is not None]
        if len(values)==1:amounts[s['name'].strip().casefold()]=values[0]
    cash=amounts.get('cash');net=amounts.get('total net debt')
    totals=[v for v in figure.get('totals',[]) if v is not None]
    if cash is None or net is None or len(totals)!=1:return []
    gross=totals[0]
    if abs(gross-cash-net)<=max(1,abs(gross)*.001):return []
    return [f'Source arithmetic discrepancy: printed Total Gross Debt {gross:,.0f} minus Cash {cash:,.0f} equals {gross-cash:,.0f}, while the source maps Total Net Debt to {net:,.0f}. Source values and labels retained; confirmation required.']


def restore_native_legend(figure,evidence):
    """Resolve a complete, unique legend assignment from numeric labels inside fills.

    Values and categories never change. Ambiguous assignments are left for review.
    """
    series=figure.get('chart',{}).get('series',[])
    # Dashed total/leverage callouts can also have a legend swatch, but are
    # independent annotations rather than a data series.
    annotations={a['label'].strip() for a in figure.get('categoryCallouts',[]) if isinstance(a,dict) and isinstance(a.get('label'),str)}
    legend={l['name'].strip() for l in evidence['legendColorEvidence'] if l['name'].strip() not in annotations}
    candidate_names={s['name'].strip() for s in series}
    if len(candidate_names)==len(series) and candidate_names<=legend:legend=candidate_names
    if len(legend)!=len(series) or not series:return False
    assigned={}
    for i,s in enumerate(series):
        scores={}
        for n in evidence['numberColorEvidence']:
            try:v=float(n['printed'].strip().replace(',','').strip('$%()'))
            except ValueError:continue
            if v in s['values']:scores[n['series'].strip()]=scores.get(n['series'].strip(),0)+1
        ranked=sorted(scores.items(),key=lambda x:x[1],reverse=True)
        if ranked and (len(ranked)==1 or ranked[0][1]>=ranked[1][1]*3):assigned[i]=ranked[0][0]
    if len(set(assigned.values()))!=len(assigned):return False
    unknown=[i for i in range(len(series)) if i not in assigned];remaining=legend-set(assigned.values())
    if len(unknown)==len(remaining)==1:assigned[unknown[0]]=next(iter(remaining))
    if len(assigned)!=len(series) or all(s['name'].strip()==assigned[i] for i,s in enumerate(series)):return False
    for i,s in enumerate(series):s['name']=assigned[i]
    colors={l['name'].strip():l.get('color') for l in evidence['legendColorEvidence']}
    figure['seriesColors']=[{'name':s['name'],'color':colors.get(s['name'])} for s in series]
    return True


def native_callouts(figure,evidence):
    """Keep independently printed totals and nearby superscript footnotes visible.

    Only a unique otherwise-unassigned native legend label can name a totals row.
    Footnotes must be native text immediately above/right of the matching value.
    """
    if not figure.get('chart'):return
    callouts=figure.setdefault('categoryCallouts',[])
    used={s['name'].strip() for s in figure['chart']['series']}|{c['label'].strip() for c in callouts}
    extra={l['name'].strip() for l in evidence['legendColorEvidence']}-used
    totals=figure.get('totals') or []
    if len(extra)==1 and any(v is not None for v in totals) and len(callouts)<4:
        label=next(iter(extra));values=[]
        for value in totals:
            candidates=[]
            for span in evidence['spans']:
                try:n=float(span['text'].strip().replace(',','').strip('$%()'))
                except ValueError:continue
                if value is not None and n==value:candidates.append(span['text'].strip())
            values.append(candidates[0] if candidates else None)
        if any(values):callouts.append({'label':label,'values':values})
    for callout in callouts:
        for i,value in enumerate(callout['values']):
            if not value:continue
            matches=[s for s in evidence['spans'] if s['text'].strip()==value]
            if len(matches)!=1:continue
            x,y,w,h=matches[0]['bbox']
            superscripts=[s for s in evidence['spans'] if re.fullmatch(r'\d{1,2}',s['text'].strip()) and y-3<=s['bbox'][1]<y and x+w-.2<=s['bbox'][0]<=x+w+1.5 and s['bbox'][3]<h*.9]
            if len(superscripts)==1:callout['values'][i]=value+superscripts[0]['text'].strip().translate(str.maketrans('0123456789','⁰¹²³⁴⁵⁶⁷⁸⁹'))


def diagram_geometry(native, bbox, figure):
    """Preserve source vector geometry and editable semantic label references for tier diagrams."""
    ev=region_evidence(native,bbox)
    if figure.get('kind')!='tiers' or not ev['paths']:return None
    entities=[(figure.get('title',''),['title'])] if figure.get('title') else []
    for j,t in enumerate(figure['tiers']):
        entities.append((t['name'],['tiers',j,'name']))
        entities.extend((name,['tiers',j,'cities',i]) for i,name in enumerate(t['cities']))
    if figure.get('direction'):entities.append((figure['direction'],['direction']))
    norm=lambda s:re.sub(r'\s+','',s).casefold()
    spans=ev['spans'];labels=[]
    for name,ref in entities:
        matches=[s for s in spans if norm(s['text'])==norm(name)]
        if not matches:
            for a in spans:
                for b in spans:
                    if a is b:continue
                    if 0<=b['bbox'][1]-a['bbox'][1]<4 and abs(b['bbox'][0]-a['bbox'][0])<5 and norm(a['text']+b['text'])==norm(name):matches=[a,b];break
                if matches:break
        if matches:
            x=min(s['bbox'][0] for s in matches);y=min(s['bbox'][1] for s in matches);right=max(s['bbox'][0]+s['bbox'][2] for s in matches);bottom=max(s['bbox'][1]+s['bbox'][3] for s in matches)
            labels.append({'ref':ref,'text':name,'lines':[s['text'] for s in matches],'bbox':[x,y,right-x,bottom-y],'size':max(s['size'] for s in matches),'light':matches[0]['color']=='#ffffff'})
    if len(labels)<len(entities)*.8:return None
    members=[l for l in labels if l['ref'][0]=='tiers']
    # Native filled tier shapes own the member labels. This excludes neighbouring
    # explanatory cards when discovery supplied an overly broad section box.
    areas=[p for p in ev['paths'] if p['fill'] and sum(inside(l['bbox'],p['bbox']) for l in members)>=2]
    if areas:
        x=min(p['bbox'][0] for p in areas);y=min(p['bbox'][1] for p in areas);right=max(p['bbox'][0]+p['bbox'][2] for p in areas);bottom=max(p['bbox'][1]+p['bbox'][3] for p in areas)
        labels=[l for l in labels if l['ref']!=['title'] or x<=l['bbox'][0]+l['bbox'][2]/2<=right]
        all_boxes=[p['bbox'] for p in areas]+[l['bbox'] for l in labels]
        bbox=[min(b[0] for b in all_boxes)-.5,min(b[1] for b in all_boxes)-.5,0,0]
        bbox[2]=max(b[0]+b[2] for b in all_boxes)-bbox[0]+.5;bbox[3]=max(b[1]+b[3] for b in all_boxes)-bbox[1]+.5
    paths=[p for p in ev['paths'] if inside(p['bbox'],bbox) and p['bbox'][2]<bbox[2]*1.1 and p['bbox'][3]<bbox[3]*1.1]
    fills=sorted({p['fill'] for p in paths if p['fill']},key=lambda fill:max(p['bbox'][2]*p['bbox'][3] for p in paths if p['fill']==fill),reverse=True)
    fill_tiers={}
    for label in labels:
        if label['ref'][0]!='tiers' or label['ref'][-1]!='name':continue
        containing=[p for p in paths if p['fill'] and inside(label['bbox'],p['bbox'])]
        if containing:fill_tiers[min(containing,key=lambda p:p['bbox'][2]*p['bbox'][3])['fill']]=label['ref'][1]
    return {'paths':paths,'labels':labels,'fillOrder':fills,'fillTiers':fill_tiers,'pageWidth':native['width'],'sourceAspect':native['width']/native['height'],'region':bbox,'method':'source vector paths + native text coordinates; theme substituted; labels editable'}


def crop_bounds(bbox):
    x,y,w,h=bbox
    left,top=max(0,x-1),max(0,y-1)
    return [left,top,min(100,x+w+1)-left,min(100,y+h+1)-top]


def crop(image, bbox, max_size=1600):
    with Image.open(io.BytesIO(image)) as im:
        x,y,w,h=crop_bounds(bbox)
        im=im.crop((x/100*im.width,y/100*im.height,(x+w)/100*im.width,(y+h)/100*im.height))
        im.thumbnail((max_size,max_size))
        out=io.BytesIO();im.convert('RGB').save(out,format='PNG');return out.getvalue()


def ppt_charts(path, number):
    ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main','c':'http://schemas.openxmlformats.org/drawingml/2006/chart','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
    result=[]
    with zipfile.ZipFile(path) as z:
        pres=ET.fromstring(z.read('ppt/presentation.xml'));size=pres.find('p:sldSz',ns)
        sw,sh=int(size.attrib['cx']),int(size.attrib['cy'])
        slide=f'ppt/slides/slide{number}.xml';rel=f'ppt/slides/_rels/slide{number}.xml.rels'
        if rel not in z.namelist():return []
        targets={r.attrib['Id']:posixpath.normpath('ppt/slides/'+r.attrib['Target']) for r in ET.fromstring(z.read(rel)) if r.attrib.get('TargetMode')!='External'}
        for frame in ET.fromstring(z.read(slide)).findall('.//p:graphicFrame',ns):
            chart=frame.find('.//c:chart',ns)
            if chart is None:continue
            target=targets.get(chart.attrib.get('{'+ns['r']+'}id'))
            if target not in z.namelist():continue
            root=ET.fromstring(z.read(target));off=frame.find('p:xfrm/a:off',ns);ext=frame.find('p:xfrm/a:ext',ns)
            if off is None or ext is None:continue
            read=lambda node:[p.find('c:v',ns).text or '' for p in sorted(node.findall('.//c:pt',ns),key=lambda p:int(p.attrib['idx']))] if node is not None else []
            series=[];labels=[]
            for s in root.findall('.//c:ser',ns):
                labels=read(s.find('c:cat',ns)) or labels
                val=read(s.find('c:val',ns))
                tx=s.find('c:tx',ns);name_node=tx.find('.//c:v',ns) if tx is not None else None
                name=name_node.text or '' if name_node is not None else ''
                if val:series.append({'name':name,'values':[float(v) if v else None for v in val]})
            item={'nativeId':target,'bbox':[float(off.attrib['x'])/sw*100,float(off.attrib['y'])/sh*100,float(ext.attrib['cx'])/sw*100,float(ext.attrib['cy'])/sh*100],'labels':labels,'series':series}
            pie=root.find('.//c:doughnutChart',ns)
            if pie is None:pie=root.find('.//c:pieChart',ns)
            if pie is not None:
                hole=pie.find('c:holeSize',ns);angle=pie.find('c:firstSliceAng',ns)
                item['pieOptions']={'holeRatio':float(hole.attrib['val'])/100 if hole is not None else 0,'startAngle':float(angle.attrib['val']) if angle is not None else 0,'dataLabels':any(n.attrib.get('val') in ('1','true') for name in ('showVal','showPercent') for n in pie.findall('.//c:'+name,ns))}
            result.append(item)
    return result


def map_basemap(folder,number,native,bbox):
    """Extract an embedded *basemap* asset only; charts never enter this path."""
    candidates=[i for i in native['images'] if inside(i['bbox'],bbox) and i['bbox'][2]*i['bbox'][3]>bbox[2]*bbox[3]*.35]
    if not candidates or not (folder/'input.pdf').exists():return None
    # PDF drop shadows are often a slightly larger image behind the actual map.
    # Rank information-bearing embedded images, not bounding-box area alone.
    ranked=[]
    with fitz.open(folder/'input.pdf') as doc:
        for candidate in candidates:
            raw=doc.extract_image(candidate['xref'])
            with Image.open(io.BytesIO(raw['image'])) as img:
                thumb=img.convert('L');thumb.thumbnail((300,300));score=thumb.entropy()
            ranked.append((score,candidate,raw))
    score,im,data=max(ranked,key=lambda x:x[0])
    if score<2:return None
    out=io.BytesIO()
    with Image.open(io.BytesIO(data['image'])) as img:img.convert('RGB').save(out,format='PNG')
    name=f'mapbase-{number}-{im["xref"]}.png';(folder/name).write_bytes(out.getvalue())
    return {'file':name,'bbox':im['bbox'],'role':'embedded-geographic-basemap','notChartFallback':True}
