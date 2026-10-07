"""Versioned JSON predicates. No eval, imports, or model-generated executable code.

Rules are compiled once; a context-local snapshot follows each conversion and
its child tasks. Geometry extraction stays in code; acceptance policy is data.
"""
import contextlib
import contextvars
import copy
import hashlib
import json
import math
import operator
import re
import threading
import time
from pathlib import Path

from .config import rules_directory
ROOT = rules_directory()
_current = contextvars.ContextVar('chart_validation_rules', default=None)
_audit = contextvars.ContextVar('chart_validation_audit', default=None)
_lock = threading.RLock()
_cache = {}
_active = None
TYPES = {'int': int, 'float': float, 'str': str, 'bool': bool, 'list': list, 'dict': dict, 'tuple': tuple, 'set': set}


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def words(v):
    return re.sub(r'\s+', ' ', str(v)).strip()


OPS = {
    'len': len, 'finite': finite, 'isfinite': math.isfinite,
    'isType': isinstance, 'type': type, 'str': str, 'abs': abs,
    'list': list, 'set': set, 'sum': sum, 'min': min, 'max': max,
    'all': all, 'any': any, 'zip': zip, 'range': range,
    'eq': operator.eq, 'ne': operator.ne, 'lt': operator.lt, 'le': operator.le,
    'gt': operator.gt, 'ge': operator.ge, 'is': operator.is_, 'isNot': operator.is_not,
    'in': lambda a, b: a in b, 'notIn': lambda a, b: a not in b,
    'add': operator.add, 'sub': operator.sub, 'mul': operator.mul, 'div': operator.truediv,
    'union': operator.or_, 'intersection': operator.and_, 'neg': operator.neg,
    'get': lambda obj, key, default=None: obj.get(key, default),
    'item': operator.getitem, 'slice': lambda obj, start, end, step: obj[slice(start, end, step)],
    'strip': lambda s, *a: s.strip(*a), 'lower': lambda s: s.lower(),
    'values': lambda d: d.values(), 'keys': lambda d: d.keys(), 'items': lambda d: d.items(),
    'words': words,
    'matches': lambda pattern, value: re.fullmatch(pattern, value),
    'attr': lambda value, name: getattr(value, name) if name in ('mode',) else (_ for _ in ()).throw(ValueError('Invalid context attribute')),
    'isclose': lambda a, b, rel=1e-9, absolute=1e-9: math.isclose(a, b, rel_tol=rel, abs_tol=absolute),
}


def compile_expr(node, depth=0):
    if depth > 40: raise ValueError('Rule expression nesting is too deep')
    if not isinstance(node, dict):
        value=copy.deepcopy(node)
        return lambda env: value
    if set(node) == {'var'}:
        name=node['var']
        if not isinstance(name, str) or not name.isidentifier() or name.startswith('__'):raise ValueError('Invalid rule variable')
        return lambda env: env[name]
    if set(node) == {'type'}:
        t=TYPES[node['type']];return lambda env: t
    op=node.get('op')
    if op in ('map','flatMap'):
        source=compile_expr(node['in'],depth+1);value=compile_expr(node['value'],depth+1)
        where=[compile_expr(x,depth+1) for x in node.get('where',[])]
        names=node['as'];names=[names] if isinstance(names,str) else names
        if not names or any(not isinstance(n,str) or not n.isidentifier() or n.startswith('__') for n in names):raise ValueError('Invalid bound names')
        def mapped(env):
            for item in source(env):
                inner=env.copy()
                if len(names)==1:inner[names[0]]=item
                else:
                    if len(item)!=len(names):raise ValueError('Rule tuple binding mismatch')
                    inner.update(zip(names,item))
                if all(f(inner) for f in where):
                    if op=='flatMap':yield from value(inner)
                    else:yield value(inner)
        return mapped
    args=[compile_expr(x,depth+1) for x in node.get('args',[])]
    if op=='and':return lambda env: all(f(env) for f in args)
    if op=='or':
        def choose(env):
            value=None
            for f in args:
                value=f(env)
                if value:return value
            return value
        return choose
    if op=='not':return lambda env: not args[0](env)
    if op=='if':return lambda env: args[1](env) if args[0](env) else args[2](env)
    if op in ('array','tuple','setOf'):
        ctor={'array':list,'tuple':tuple,'setOf':set}[op]
        return lambda env: ctor(f(env) for f in args)
    if op=='object':
        entries=[(compile_expr(k,depth+1),compile_expr(v,depth+1)) for k,v in node['entries']]
        return lambda env: {k(env):v(env) for k,v in entries}
    if op not in OPS:raise ValueError('Unsupported rule operator: '+str(op))
    fn=OPS[op]
    return lambda env: fn(*(f(env) for f in args))


class RuleBundle:
    def __init__(self, data):
        if data.get('schemaVersion')!=1:raise ValueError('Unsupported rule bundle schema')
        self.data=copy.deepcopy(data)
        self.hash=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        self.version=data['version'];self.rules={};self.compiled={}
        for row in data['rules']:
            rid=row['id']
            if rid in self.rules:raise ValueError('Duplicate rule: '+rid)
            self.rules[rid]=row
            if 'invalidWhen' in row:self.compiled[rid]=compile_expr(row['invalidWhen'])
        self.numeric=[]
        for fmt in data['numberFormats']:
            sep=fmt['groupSeparator'];decimal=fmt['decimalSeparator'];size=fmt.get('groupSize',3)
            if len(sep)>1 or len(decimal)!=1 or sep==decimal or size not in (3,):raise ValueError('Invalid numeric grammar')
            integer=rf'(?:\d{{1,{size}}}(?:{re.escape(sep)}\d{{{size}}})+)' if sep else r'\d+'
            digits=rf'(?:{integer}(?:{re.escape(decimal)}\d+)?|{re.escape(decimal)}\d+)' if not sep else rf'{integer}(?:{re.escape(decimal)}\d+)?'
            rx=re.compile(r'(?P<prefix>[$€£¥₹]|[A-Za-z]{1,5}\s+)?\s*(?P<number>[+-]?'+digits+r')\s*(?P<unit>[%‰]|[A-Za-z\u3400-\u9fff°][A-Za-z\u3400-\u9fff° /²³·%]{0,23})?')
            self.numeric.append((fmt,rx))
    @property
    def identity(self):return {'version':self.version,'sha256':self.hash}


def active_bundle():
    global _active
    pinned=_current.get()
    if pinned is not None:return pinned
    with _lock:
        if _active is None:
            pointer=json.loads((ROOT/'active.json').read_text())
            _active=load_bundle(pointer['version'],pointer.get('sha256'))
        return _active


def load_bundle(version, expected_hash=None):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+',version):raise ValueError('Invalid rule version')
    with _lock:
        if version not in _cache:
            _cache[version]=RuleBundle(json.loads((ROOT/'bundles'/(version+'.json')).read_text()))
        bundle=_cache[version]
        if expected_hash and bundle.hash!=expected_hash:raise ValueError('Rule bundle content hash mismatch')
        return bundle


@contextlib.contextmanager
def session(bundle, audit=None):
    token=_current.set(bundle);log=_audit.set(audit)
    try:yield
    finally:_audit.reset(log);_current.reset(token)


def violated(rule_id, env):
    bundle=active_bundle();start=time.perf_counter()
    try:bad=bool(bundle.compiled[rule_id](env))
    except Exception as exc:
        raise ValueError('Rule execution error '+rule_id+': '+type(exc).__name__) from exc
    audit=_audit.get()
    if audit is not None:
        item=audit.setdefault(rule_id,{'checks':0,'failures':0,'ms':0})
        item['checks']+=1;item['failures']+=int(bad);item['ms']+=(time.perf_counter()-start)*1000
    return bad


class RuleViolation(ValueError):
    def __init__(self, rule_id, message, **details):
        super().__init__(message)
        bundle=active_bundle();rule=bundle.rules[rule_id]
        self.finding={'ruleId':rule_id,'ruleVersion':bundle.version,'ruleHash':bundle.hash,
                      'category':rule['category'],'message':str(message),'details':details}


def report(bundle, audit):
    return {'bundle':bundle.identity,'checks':sum(x['checks'] for x in audit.values()),
            'failures':sum(x['failures'] for x in audit.values()),
            'milliseconds':round(sum(x['ms'] for x in audit.values()),3),
            'rules':[{'id':k,**v,'ms':round(v['ms'],3)} for k,v in audit.items()]}


def catalog():
    b=active_bundle()
    return {**b.identity,'numberFormats':b.data['numberFormats'],'rules':list(b.rules.values()),
            'operators':sorted(OPS),'policy':b.data['policy'],'coverage':b.data.get('coverage',{})}


def rule_range(name):
    r=active_bundle().data['ranges'][name]
    return r['min'],r['max']
