"""Source-based ownership and table groups, independent of page/document identity."""
import re


def norm(value):
    return re.sub(r'[^a-z0-9]', '', str(value).lower())


def contains(parent, child):
    x,y,w,h=parent; a,b,c,d=child
    intersection=max(0,min(x+w,a+c)-max(x,a))*max(0,min(y+h,b+d)-max(y,b))
    return intersection/max(.01,c*d)>.9


def bind_relationships(result, native):
    elements=result['elements']
    # Portrait + biography + affiliated logos belong to one composite card;
    # absolute positioning each fragment separately would obscure the copy.
    for card in [e for e in elements if e['type']=='card' and e.get('text')]:
        children=[e for e in elements if e['type'] in ('asset','logo-group')
                  and contains(card['bbox'],e['bbox'])]
        photos=[e for e in children if e.get('assetRole')=='photo']
        if len(photos)!=1:
            continue
        card['componentKind']='profile-card'
        card['childIds']=[e['id'] for e in children]
        for e in children:e['parentId']=card['id']

    for table in [e for e in elements if e['type']=='table' and e.get('rows')]:
        x,y,w,h=table['bbox']
        groups=sorted([e for e in elements if e['type']=='card' and not e.get('text')
                       and abs(e['bbox'][0]+e['bbox'][2]-x)<2
                       and e['bbox'][1]>=y and e['bbox'][1]+e['bbox'][3]<=y+h+3],key=lambda e:e['bbox'][1])
        if len(groups)<2:continue
        spans=[s for s in native.get('spans',[]) if x-1<=s['bbox'][0]<=x+w*.29 and y<=s['bbox'][1]<=y+h]
        assignments=[]
        for row in table['rows']:
            key=norm(row[0]) if row else ''
            exact=[s for s in spans if norm(s['text'])==key]
            candidates=exact or [s for s in spans if len(norm(s['text']))>=6 and key.startswith(norm(s['text']))]
            if not candidates:break
            pos=min(candidates,key=lambda s:s['bbox'][1])['bbox'][1]
            matching=[g for g in groups if g['bbox'][1]-.5<=pos<g['bbox'][1]+g['bbox'][3]+.2]
            if len(matching)!=1:break
            assignments.append(matching[0]['id'])
        if len(assignments)!=len(table['rows']):continue
        rows=[]
        for group in groups:
            indexes=[i for i,gid in enumerate(assignments) if gid==group['id']]
            if not indexes or indexes!=list(range(indexes[0],indexes[-1]+1)):break
            rows.append({'title':group['title'],'firstRow':indexes[0],'rowCount':len(indexes),'sourceElementId':group['id']})
        if len(rows)!=len(groups):continue
        table['rowGroups']=rows;table['groupHeader']=''
        left=min(g['bbox'][0] for g in groups)
        for e in elements:
            if e['type'] in ('text','section') and abs(e['bbox'][0]-left)<1 and y-.7<=e['bbox'][1]<groups[0]['bbox'][1]:
                table['groupHeader']=e.get('title') or e.get('text','');e['parentId']=table['id']
        for g in groups:g['parentId']=table['id']
        table['bbox']=[left,y,x+w-left,h]
        table['hideTitle']=True
