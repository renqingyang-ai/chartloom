"""Deterministic data coverage; model 'ok' never overrides missing series."""
import math
from .validation_rules import violated, RuleViolation, rule_range


def coverage(figure):
    chart=figure.get('chart',{});rows=[];issues=[]
    for i,s in enumerate(chart.get('series',[])):
        values=s.get('values',[])
        known=sum(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in values)
        rows.append({'series':i,'name':s.get('name',''),'categories':len(values),'known':known,'missing':len(values)-known})
        if violated('coverage.chart_integrity.coverage.8de2ad31', locals()):
            issues.append(f'Series {i} ({s.get("name", "")}): {len(values)-known}/{len(values)} values missing. Read matching full-page table evidence or calibrate visible marks against THIS series axis; absent/unreadable values must remain explicitly unresolved.')
    return {'series':rows,'issues':issues,'status':'incomplete' if issues else 'complete'}
