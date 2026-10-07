"""Parse one printed quantity without discarding its unit or inventing a scale.

Values stay in the source's displayed unit (e.g. 2.50 million is 2.50).
Never use this to extract a number from arbitrary prose or a date/range.
"""
import unicodedata
import re
from decimal import Decimal
from .validation_rules import active_bundle


def parse_quantity(text, bundle=None):
    if not isinstance(text, str):return {'status':'unsupported','raw':text}
    bundle=bundle or active_bundle()
    s=unicodedata.normalize('NFKC',text).strip().replace('−','-')
    negative=s.startswith('(') and s.endswith(')')
    if negative:s=s[1:-1].strip()
    matches=[]
    for fmt,rx in bundle.numeric:
        m=rx.fullmatch(s)
        if not m:continue
        digits=m['number'];sep=fmt['groupSeparator']
        if sep:digits=digits.replace(sep,'')
        digits=digits.replace(fmt['decimalSeparator'],'.')
        decimal=Decimal(digits)
        if negative:decimal=-abs(decimal)
        if not decimal.is_finite():continue
        matches.append({'status':'parsed','value':float(decimal),'decimal':str(decimal),
                        'formatId':fmt['id'],'raw':text,'prefix':m['prefix'] or '',
                        'unit':m['unit'] or '', 'accounting':negative,'ruleVersion':bundle.version})
    if not matches:return {'status':'unsupported','raw':text,'ruleVersion':bundle.version}
    if len({(m['value'],m['unit'],m['prefix']) for m in matches})>1:
        return {'status':'ambiguous','raw':text,'ruleVersion':bundle.version}
    return matches[0]


def printed_number(text):
    result=parse_quantity(text)
    return result['value'] if result['status']=='parsed' else None


def parse_bound_quantity(text, template=None, bundle=None):
    """Parse an explicitly bound value span without treating prose as a number.

    Source wording must reconstruct exactly. Numeric punctuation/signs cannot
    be moved into an annotation to make a different number pass validation.
    """
    if template is None:return parse_quantity(text,bundle)
    invalid={'status':'unsupported','raw':text,'reason':'Invalid valueTemplate: use a complete quantity and preserve source annotation'}
    if not isinstance(template,dict) or set(template)!={'prefix','quantity','suffix'}:return invalid
    if not all(isinstance(v,str) for v in template.values()):return invalid
    prefix,quantity,suffix=(template[k] for k in ('prefix','quantity','suffix'))
    if not quantity.strip() or prefix+quantity+suffix!=text:return invalid
    left=unicodedata.normalize('NFKC',prefix).rstrip()
    right=unicodedata.normalize('NFKC',suffix).lstrip()
    # Numeric token separators belong to the quantity. Annotation years are
    # allowed after a delimiter, not as a way to split digits or accounting.
    if left and re.search(r'[\d.,+−\-]$',left):return invalid
    if right and re.match(r'[\d.,%‰]',right):return invalid
    if left.endswith('(') and right.startswith(')'):return invalid
    if prefix and not prefix[-1].isspace() and prefix[-1].isalnum():return invalid
    if suffix and not suffix[0].isspace() and suffix[0].isalnum():return invalid
    parsed=parse_quantity(quantity,bundle)
    whole=parse_quantity(text,bundle)
    if whole['status']=='parsed' and (parsed['status']!='parsed' or whole['value']!=parsed['value']):return invalid
    return parsed
