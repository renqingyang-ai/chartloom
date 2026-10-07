"""Source-bound page components. No document names, page numbers or sample data.

Statistical plots never enter the asset path. Native geography is a vector
layer; each caption is separate editable data, not a screenshot of the map.
"""
import copy
import hashlib
import io
import json
import math
from .validation_rules import violated, RuleViolation, rule_range
import re

import fitz
from PIL import Image
from .native_evidence import inside, crop


def norm(value):
    return re.sub(r'[^a-z0-9]', '', str(value).casefold())


def rgb_role(color):
    if not color:return 'ink'
    r,g,b=(int(color[i:i+2],16)/255 for i in (1,3,5))
    if max(r,g,b)-min(r,g,b)>.12 and r>=b:return 'accent'
    return 'neutral' if (r+g+b)/3>.78 else 'muted'


def omit_production_placeholders(result):
    """Keep source production omissions in review notes, not finished page copy."""
    def clean(value):
        if not isinstance(value,str):return value
        if re.fullmatch(r'\s*(?:x{2,}|tbu|to be updated)\s*',value,re.I):
            result['warnings'].append('原稿占位文字已移到核对提示：'+value);return ''
        out=re.sub(r'\s*\(\s*x{2,}\s+(?:sq\.?\s*ft\.?|sf)\s*\)', '',value,flags=re.I)
        if out!=value:result['warnings'].append('原稿面积尚未提供，未在页面印出占位数值：'+value)
        return out
    result['subtitle']=clean(result.get('subtitle',''))
    for e in result['elements']:
        for k in ('title','text'):
            if k in e:e[k]=clean(e[k])
    result['warnings']=list(dict.fromkeys(result['warnings']))


def native_geography(native, bbox, figure):
    """Retain geographic polygons; remove the source header/card decorations.

    Only a genuine multi-polygon PDF layer qualifies. Raster maps cannot be
    silently represented as an empty geographic canvas.
    """
    if figure.get('kind') not in ('map','diagram'):return None
    spatial=figure.get('kind')=='diagram'
    paths=[p for p in native['paths'] if inside(p['bbox'],bbox)]
    polygons=[p for p in paths if p['fill'] and len(p['commands'])>=6 and p['bbox'][2]*p['bbox'][3]<bbox[2]*bbox[3]*.6]
    rectangles=[p for p in paths if p['fill'] and any(c[0]=='rect' for c in p['commands'])]
    if spatial and len(rectangles)<8:return None
    if not spatial and len(polygons)<8:return None
    x,y,w,h=bbox
    shapes=[]
    for p in paths:
        # Irregular filled polygons, small source marker circles and leaders.
        cmds=p['commands'];area=p['bbox'][2]*p['bbox'][3]
        is_marker=p['fill'] and len(cmds)==4 and all(c[0]=='c' for c in cmds) and area<4
        is_leader=not p['fill'] and all(c[0]=='l' for c in cmds) and p['bbox'][2]>2
        if not spatial and p not in polygons and not is_marker and not is_leader:continue
        shapes.append(copy.deepcopy(p)|{'role':rgb_role(p['fill'] or p['stroke']), 'layer':'spatial' if spatial else 'geography' if p in polygons else 'marker' if is_marker else 'leader'})
    # Include legend swatches independently, without drop shadows.
    spans=[s for s in native['spans'] if inside(s['bbox'],bbox)]
    for p in ([] if spatial else paths):
        if p['fill'] and len(p['commands'])==1 and p['commands'][0][0]=='rect' and p['bbox'][2]<3 and p['bbox'][3]<3:
            if any(0<=s['bbox'][0]-p['bbox'][0]-p['bbox'][2]<2 and abs(s['bbox'][1]-p['bbox'][1])<2 for s in spans):
                shapes.append(copy.deepcopy(p)|{'role':rgb_role(p['fill']),'layer':'legend'})
    title=norm(figure.get('title',''));labels=[]
    for s in spans:
        text=s['text'].strip()
        if not text or re.fullmatch(r'(?i)x{2,}(?:\s*sq\s*ft)?',text):continue
        if norm(text) and norm(text) in title and s['bbox'][1]<y+h*.15:continue
        # Native white header text is source decoration, not a map label.
        if s['color']=='#ffffff' and s['bbox'][1]<y+h*.15:continue
        labels.append({'id':f'label-{len(labels)+1}','text':text,'x':(s['bbox'][0]-x)/w*100,'y':(s['bbox'][1]-y)/h*100,
                       'width':s['bbox'][2]/w*100,'height':s['bbox'][3]/h*100,'fontSize':s['size']/native['width']*100/w*1000,
                       'role':rgb_role(s['color']),'sourceBBox':s['bbox']})
    # Preserve these labels in the editor. Do not leave a second, non-rendered
    # node table that would claim edits succeeded while pixels stayed unchanged.
    figure['mapLabels']=labels
    # Distinct source fills keep distinct meanings in a floor plan. The same
    # source fill in a legend and a room receives the same theme swatch.
    fills=[]
    if spatial:
        for shape in shapes:
            color=shape.get('fill')
            if not color or color.lower()=='#ffffff':continue
            rgb=[int(color[i:i+2],16) for i in (1,3,5)]
            match=next((i for i,c in enumerate(fills) if max(abs(a-b) for a,b in zip(rgb,c))<=6),None)
            if match is None:match=len(fills);fills.append(rgb)
            shape['paletteIndex']=match
    return {'region':bbox,'shapes':shapes,'polygonCount':len(polygons),'geometryKind':'spatial' if spatial else 'geographic','paletteCount':len(fills),'method':'PDF vector geometry + native editable text; OM theme substituted','sourceKind':'pdf-vector'}


def image_bytes(folder, native_image):
    with fitz.open(folder/'input.pdf') as doc:
        xref=native_image['xref'];pix=fitz.Pixmap(doc,xref)
        smask=doc.extract_image(xref).get('smask')
        if smask:
            mask=fitz.Pixmap(doc,smask)
            # PyMuPDF may report an alpha channel that is uniformly opaque;
            # the PDF's SMask still has to be applied. Preserve true mask data.
            if pix.alpha:pix=fitz.Pixmap(pix,0)
            pix=fitz.Pixmap(pix,mask)
        if pix.colorspace and pix.colorspace.n>3:pix=fitz.Pixmap(fitz.csRGB,pix)
        return pix.tobytes('png')


def materialize_assets(folder, number, native, page_image, elements, job_id):
    """One entity/logo per item. Never export a statistical/chart region.

    A single logo can consist of separate PDF mark and wordmark images. Keep
    those fragments as separate sourced assets within its item.
    """
    by_id={im['id']:im for im in native['images']};report=[]
    for e in elements:
        if e.get('type') not in ('asset','logo-group'):continue
        items=e.get('items',[]) if e['type']=='logo-group' else [e]
        if not isinstance(items,list) or len(items)>40:
            e['assetIssue']='素材清单无效';continue
        for i,item in enumerate(items):
            item['assets']=[];role=item.get('assetRole', 'entity-logo' if e['type']=='logo-group' else '')
            if role not in ('entity-logo','photo'):
                item['assetIssue']='需要明确素材类型，未将未知图形当作图片使用。';continue
            ids=item.get('nativeImageIds',[])
            if not isinstance(ids,list):ids=[]
            region=item.get('bbox') or e['bbox']
            for image_id in dict.fromkeys(ids):
                im=by_id.get(image_id)
                if not im or not inside(im['bbox'],e['bbox']):continue
                # Reject a full logo-wall/card crop masquerading as one logo.
                if role=='entity-logo' and (im['bbox'][2]>18 or im['bbox'][3]>15):continue
                payload=image_bytes(folder,im)
                digest=hashlib.sha256(payload).hexdigest();name=f'content-{number}-{digest[:20]}.png'
                (folder/name).write_bytes(payload)
                item['assets'].append({'file':name,'url':f'/api/asset/{job_id}/{name}','bbox':im['bbox'],'sha256':digest,'nativeImageId':image_id,'role':role,'pageAspect':native['width']/native['height']})
            # Image/PDF vector logos are semantic crops of INDIVIDUAL assets.
            # Statistical figures and map regions cannot use this path.
            if not item['assets'] and item.get('bbox') and role=='entity-logo' and region[2]<=18 and region[3]<=15:
                payload=crop(page_image,region);digest=hashlib.sha256(payload).hexdigest();name=f'content-{number}-{digest[:20]}.png'
                (folder/name).write_bytes(payload)
                item['assets'].append({'file':name,'url':f'/api/asset/{job_id}/{name}','bbox':region,'sha256':digest,'role':role,'pageAspect':native['width']/native['height'],'method':'individual source logo region'})
            if not item['assets']:item['assetIssue']='缺少可核对的独立素材。'
            report.append({'elementId':e['id'],'item':str(item.get('name') or item.get('title') or ''),'role':role,'fragments':len(item['assets']),'issue':item.get('assetIssue')})
    return report


def quality_contract(result, native, inventory):
    """Completeness gates are separate from model opinion and image beauty.

    Inventory is not truth: compare against native source words as an additional
    omission signal. Numbers/footnotes remain in source review, not this score.
    """
    issues=[];elements=result['elements'];expected=inventory.get('elements',[])
    figures=[e for e in elements if e.get('figure')];assets=[]
    expected_figures=sum(e.get('type') in ('chart','pie','scatter','curves','timeline','tiers','gantt','map','diagram','heatmap','boxplot','candlestick','bubble') for e in expected)
    if violated('completeness.page_fidelity.quality_contract.19e48dda', locals()):issues.append({'kind':'missing','severity':'error','description':f'源页识别了 {expected_figures} 个图形，实际绘制 {len(figures)} 个，数量尚未对齐。'})
    for e in elements:
        if e.get('type')=='logo-group':assets.extend((e,x) for x in e.get('items',[]))
        elif e.get('type')=='asset':assets.append((e,e))
        f=e.get('figure',{})
        if violated('completeness.page_fidelity.quality_contract.9363b5e8', locals()):
            issues.append({'elementId':e['id'],'kind':'missing','severity':'error','description':'地图缺少地理底图；节点示意图不能算地图已还原。'})
        if f.get('kind')=='diagram' and not f.get('nativeGeography'):
            rects=[p for p in native['paths'] if inside(p['bbox'],e['bbox']) and p.get('fill') and any(c[0]=='rect' for c in p['commands'])]
            if violated('completeness.page_fidelity.quality_contract.3cf6e79e', locals()):issues.append({'elementId':e['id'],'kind':'missing','severity':'error','description':'空间结构图尚未保留源形状尺寸；等大的文字框不能替代平面布局。'})
        if violated('completeness.page_fidelity.quality_contract.07322862', locals()):issues.append({'elementId':e['id'],'kind':'missing','severity':'error','description':'此区域尚未转换。'})
    for e,item in assets:
        if violated('completeness.page_fidelity.quality_contract.2cde0da2', locals()):issues.append({'elementId':e['id'],'kind':'missing','severity':'error','description':'缺少独立素材：'+str(item.get('name') or item.get('title') or '')})
        extracted={a.get('nativeImageId') for a in item.get('assets',[])}
        fragments=set(item.get('nativeImageIds',[]))-extracted
        if violated('completeness.page_fidelity.quality_contract.21c5841d', locals()):issues.append({'elementId':e['id'],'kind':'missing','severity':'error','description':'独立素材的部分片段未保留：'+str(item.get('name') or item.get('title') or ''),'nativeImageIds':sorted(fragments)})
    used={a.get('nativeImageId') for _,item in assets for a in item.get('assets',[])}
    used.update(i for e in elements for i in (e.get('icon') or {}).get('nativeImageIds',[]))
    ignored={d.get('imageId') for d in inventory.get('imageDecisions',[]) if d.get('role') in ('decoration','publisher-branding') and d.get('reason')}
    unassigned=[]
    for im in native['images']:
        b=im['bbox'];area=b[2]*b[3]
        if im['id'] in used or im['id'] in ignored or b[1]<12 or b[1]>90 or not .3<area<45:continue
        if sum(i['xref']==im['xref'] for i in native['images'])>1:continue
        if any(inside(b,e['bbox']) for e in figures):continue
        if any(inside(b,item.get('bbox',e['bbox'])) and item.get('assets') for e,item in assets):continue
        unassigned.append(im['id'])
    if violated('completeness.page_fidelity.quality_contract.4be57578', locals()):issues.append({'kind':'missing','severity':'warning','description':f'{len(unassigned)} 个独立源图片尚未归类，需要核对是否遗漏 logo 或有含义的图标。','nativeImageIds':unassigned})
    # Check copy coverage only for native text in body regions. Bank/footer
    # branding and production notes are intentionally excluded.
    def content_strings(e):
        if isinstance(e,str):return [e]
        if isinstance(e,list):return [s for x in e for s in content_strings(x)]
        if isinstance(e,dict):return [s for k,v in e.items() if k not in ('nativeGeography','nativeGeometry','paths','verification','notes','assets','source','diagnostic','textEvidence') for s in content_strings(v)]
        return [str(e)] if isinstance(e,(int,float)) else []
    rendered=norm(' '.join(content_strings(elements)+[result.get('title',''),result.get('subtitle','')]+result.get('footnotes',[])))
    missing=[]
    for s in native['spans']:
        t=s['text'].strip();b=s['bbox']
        if b[1]<11 or b[1]>90 or len(norm(t))<10 or re.search(r'\b(TBU|XXX|to be updated|confidential)\b',t,re.I):continue
        if norm(t) not in rendered and len(t.split())>=3:missing.append(t)
    if violated('completeness.page_fidelity.quality_contract.f7d827a0', locals()):issues.append({'kind':'missing','severity':'warning','description':'PDF 原生文字尚未逐字对齐：'+'；'.join(missing[:6]),'sourceText':missing})
    return {'version':'page-fidelity-v1','expectedFigures':expected_figures,
            'renderedFigures':len(figures),'assetItems':len(assets),'assetItemsReady':sum(bool(x.get('assets')) for _,x in assets),
            'vectorMaps':sum(e.get('figure',{}).get('kind')=='map' and bool(e.get('figure',{}).get('nativeGeography')) for e in elements),'vectorDiagrams':sum(e.get('figure',{}).get('kind')=='diagram' and bool(e.get('figure',{}).get('nativeGeography')) for e in elements),'issues':issues,
            'status':'incomplete' if any(i['severity']=='error' for i in issues) else 'needs-review' if issues else 'source-checks-passed',
            'imageDecisions':inventory.get('imageDecisions',[]),'humanVerified':False}
