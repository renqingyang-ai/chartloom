"""Versioned API estimates and durable, request-scoped usage receipts.

No application or LLM dependency. Amounts are estimates from observed usage,
not invoices. Never infer missing tokens from response length or max_tokens.
"""
from contextvars import ContextVar
from datetime import datetime, timezone
from decimal import Decimal
import copy
import hashlib
import json
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlparse
import uuid

CATALOG = Path(__file__).with_name('resources') / 'pricing' / 'catalog.json'
_ATTEMPTS = ContextVar('chartloom_provider_attempts', default=None)
_LIVE = {}
_LIVE_LOCK = threading.RLock()


def register_live(job_id, page, meter):
    with _LIVE_LOCK:
        _LIVE[(job_id, page)] = meter


def release_live(job_id, page, meter):
    with _LIVE_LOCK:
        if _LIVE.get((job_id, page)) is meter:
            _LIVE.pop((job_id, page))


def with_live_costs(job):
    # Copy registry references first; never hold its lock while taking a meter
    # lock or the converter's lock. Reads cannot mutate a persisted old run.
    with _LIVE_LOCK:
        active = [(page, meter) for (job_id, page), meter in _LIVE.items() if job_id == job['id']]
    if not active:
        return job
    result = copy.deepcopy(job)
    for number, meter in active:
        try:
            page = result['pages'][number - 1]
            bill = meter.summary()
            page.setdefault('costRuns', {})[meter.run_id] = bill
            page['billing'] = bill
        except Exception:
            continue
    return result


def request_summary(images, prompt, data, max_output_tokens):
    """Metadata only: never persist prompt text, image bytes or source values."""
    return {'imageCount': len(images), 'imageBytes': sum(len(im) for im in images),
            'instructionCharacters': len(prompt),
            'contextCharacters': len(json.dumps(data, ensure_ascii=False)),
            'dataFields': [k for k in data if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', k)][:32] if isinstance(data, dict) else [],
            'maxOutputTokens': max_output_tokens}


def response_summary(value):
    if not isinstance(value, dict):
        return {'jsonType': type(value).__name__}
    result = {'jsonType': 'object', 'fields': [k for k in value if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', k)][:32]}
    for key in ('elements', 'issues', 'remaining', 'warnings', 'regions'):
        if isinstance(value.get(key), list):
            result[key + 'Count'] = len(value[key])
    chart = value.get('chart')
    if isinstance(chart, dict):
        if isinstance(chart.get('labels'), list):result['categoryCount'] = len(chart['labels'])
        if isinstance(chart.get('series'), list):
            result['seriesCount'] = len(chart['series'])
            result['valueCount'] = sum(len(s.get('values', [])) for s in chart['series'] if isinstance(s, dict) and isinstance(s.get('values'), list))
    return result


def now():
    return datetime.now(timezone.utc).isoformat()


def instant(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Pricing timestamps must include timezone')
    return parsed


def field(obj, key, default=None):
    return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)


def token(value):
    return value if type(value) is int and value >= 0 else None


def provider_for(model, api_base=None):
    host = urlparse(api_base or '').hostname
    if host and host != 'generativelanguage.googleapis.com':
        return 'custom:' + host
    return 'google-gemini' if host == 'generativelanguage.googleapis.com' or model.startswith(('gemini/', 'gemini-')) else 'unknown'


def catalog(path=CATALOG):
    data = json.loads(Path(path).read_text())
    if data.get('schemaVersion') != 1 or not isinstance(data.get('rates'), list):
        raise ValueError('Invalid pricing catalog')
    ids = set()
    for rate in data['rates']:
        if rate['id'] in ids:
            raise ValueError('Duplicate rate ID')
        ids.add(rate['id'])
        if rate['currency'] != 'USD' or (rate['effectiveUntil'] is not None and
                instant(rate['effectiveFrom']) >= instant(rate['effectiveUntil'])):
            raise ValueError('Invalid pricing period or currency')
        for key in ('inputPerMillion', 'cachedInputPerMillion', 'outputPerMillion'):
            n = Decimal(str(rate[key]))
            if not n.is_finite() or n < 0:
                raise ValueError('Invalid token price')
    return data


def usage_from(response):
    raw = field(response, 'raw', response)
    thinking_basis = 'reported'
    reported_output = None
    native = field(raw, 'usageMetadata')
    if native is not None:
        inp = token(field(native, 'promptTokenCount'))
        candidates = token(field(native, 'candidatesTokenCount'))
        thoughts = token(field(native, 'thoughtsTokenCount', 0))
        total = token(field(native, 'totalTokenCount'))
        cached = token(field(native, 'cachedContentTokenCount', 0))
        # Gemini versions differ on whether candidate count includes thoughts.
        # Reconcile the provider's total; reject ambiguity instead of double billing.
        output = None
        if inp is not None and candidates is not None and thoughts is not None:
            if total == inp + candidates:
                output = candidates
            elif total is None or total == inp + candidates + thoughts:
                output = candidates + thoughts
        source = 'gemini-usage-metadata'
    else:
        u = field(raw, 'usage') or field(response, 'usage')
        inp = token(field(u, 'prompt_tokens'))
        output = token(field(u, 'completion_tokens'))
        total = token(field(u, 'total_tokens'))
        details = field(u, 'prompt_tokens_details')
        cached = token(field(details, 'cached_tokens', field(u, 'cached_tokens', 0)) or 0)
        thoughts = token(field(field(u, 'completion_tokens_details'), 'reasoning_tokens'))
        # LiteLLM/OpenAI completion_tokens already includes reasoning tokens.
        source = 'normalized-usage'
        if field(response, 'usage_contract') == 'gemini-openai':
            # Google's direct compatibility endpoint returns visible completion
            # tokens but total_tokens also includes thinking (confirmed live).
            # This adapter is explicitly marked by the trusted request endpoint;
            # never apply the reconciliation to arbitrary compatible providers.
            source = 'gemini-openai-usage'
            reported_output = output
            if inp is not None and output is not None and total is not None and total > inp + output:
                difference = total - inp - output
                if thoughts is None or thoughts == difference:
                    thoughts = difference
                    output = total - inp
                    thinking_basis = 'provider-total-minus-input-minus-visible-output'
    valid = (inp is not None and output is not None and cached is not None
             and cached <= inp and (thoughts is None or thoughts <= output)
             and (total is None or total == inp + output))
    return {'inputTokens': inp, 'cachedInputTokens': cached,
            'outputTokens': output, 'thinkingTokens': thoughts, 'totalTokens': total,
            'outputIncludesThinking': True, 'source': source, 'valid': valid,
            'thinkingBasis': thinking_basis if thoughts is not None else 'not-reported',
            'reportedCompletionTokens': reported_output}


def quote(usage, *, model, provider, mode, at, prices):
    matches = [r for r in prices['rates'] if r['provider'] == provider
               and model in r['models'] and r['mode'] == mode
               and instant(r['effectiveFrom']) <= instant(at)
               and (r['effectiveUntil'] is None or instant(at) < instant(r['effectiveUntil']))]
    if len(matches) != 1:
        return {'status': 'unpriced', 'estimatedCostUsd': None,
                'reason': 'missing-or-ambiguous-rate', 'price': None}
    price = copy.deepcopy(matches[0])
    price['catalogVersion'] = prices['version']
    price['sha256'] = hashlib.sha256(json.dumps(price, sort_keys=True).encode()).hexdigest()
    if not usage.get('valid'):
        return {'status': 'missing-usage', 'estimatedCostUsd': None,
                'reason': 'missing-or-inconsistent-token-counts', 'price': price}
    million = Decimal(1_000_000)
    cost = (Decimal(usage['inputTokens'] - usage['cachedInputTokens']) * Decimal(str(price['inputPerMillion']))
            + Decimal(usage['cachedInputTokens']) * Decimal(str(price['cachedInputPerMillion']))
            + Decimal(usage['outputTokens']) * Decimal(str(price['outputPerMillion']))) / million
    return {'status': 'priced', 'estimatedCostUsd': float(cost), 'price': price,
            'reason': 'observed-tokens-times-published-rate'}


def observe_provider_attempts(module):
    """Observe the local adapter's retry hook, preserving its existing behavior.

    Only allowlisted metadata is retained. Failed attempts have unknown charges.
    ContextVar keeps concurrent pages and figures isolated.
    """
    original = module.record_generation_debug_provider_attempt
    if getattr(original, '_chartloom_usage_observer', False):
        return

    def observe(data, *args, **kwargs):
        events = _ATTEMPTS.get()
        if events is not None:
            try:
                event = {k: data[k] for k in ('layer', 'attempt', 'maxAttempts', 'httpStatus',
                         'errorType', 'latencySeconds') if k in data}
                event['status'] = kwargs.get('status', args[0] if args else None)
                events.append(event)
            except Exception:
                pass
        return original(data, *args, **kwargs)

    observe._chartloom_usage_observer = True
    module.record_generation_debug_provider_attempt = observe


def summarize(records, *, errors=None):
    errors = errors or []
    known = sum((Decimal(str(r['estimatedCostUsd'])) for r in records
                 if r.get('estimatedCostUsd') is not None), Decimal(0))
    unknown = sum(r.get('estimatedCostUsd') is None for r in records)
    hidden = sum(r.get('unknownProviderAttempts', 0) for r in records)
    complete = bool(records) and not unknown and not hidden and not errors
    tokens = {k: sum(r.get('usage', {}).get(k) or 0 for r in records)
              for k in ('inputTokens', 'cachedInputTokens', 'outputTokens', 'thinkingTokens')}
    return {'schemaVersion': 1, 'currency': 'USD', 'basis': 'estimate-not-invoice',
            'status': 'estimated' if complete else 'partial' if records else 'unrecorded',
            'estimatedCostUsd': float(known) if complete else None,
            'knownCostUsd': float(known), 'complete': complete,
            'calls': len(records), 'apiCalls': sum(not r.get('localCache') for r in records),
            'localCacheHits': sum(bool(r.get('localCache')) for r in records),
            'unknownCalls': unknown, 'unknownProviderAttempts': hidden,
            'tokens': tokens, 'errors': list(errors), 'records': copy.deepcopy(records)}


class UsageMeter:
    def __init__(self, folder, run_id, model, provider, mode='standard', prices=None):
        self.folder, self.run_id = Path(folder), run_id
        self.model, self.provider, self.mode = model, provider, mode
        self.records, self.errors, self.lock = [], [], threading.RLock()
        self.started_at, self.run_status, self.phases, self.run_info = now(), 'running', [], {}
        self.finished_at = None
        try:
            self.prices = copy.deepcopy(prices if prices is not None else catalog())
        except Exception:
            self.prices = {'version': 'unavailable', 'rates': []}
            self.errors.append('pricing-catalog-unavailable')

    def _write(self, event, record):
        try:
            with (self.folder / 'usage-events.jsonl').open('a') as f:
                f.write(json.dumps({'event': event, 'at': now(), 'record': record}, ensure_ascii=False) + '\n')
        except Exception:
            if 'usage-ledger-write-failed' not in self.errors:
                self.errors.append('usage-ledger-write-failed')

    def start(self, stage, attempt=1, local_cache=False, metadata=None):
        record = {'id': uuid.uuid4().hex, 'runId': self.run_id, 'stage': stage,
                  'attempt': attempt, 'requestedModel': self.model, 'provider': self.provider,
                  'mode': self.mode, 'startedAt': now(), 'localCache': local_cache,
                  'status': 'pending', 'estimatedCostUsd': None}
        if metadata is not None:
            record['request'] = copy.deepcopy(metadata)
        with self.lock:
            self.records.append(record)
            self._write('started', record)
        return record

    def finish(self, record, response=None, error=None, events=None, elapsed_ms=0):
        """Metering must never replace a valid conversion result with an error."""
        with self.lock:
            try:
                record.update(finishedAt=now(), ms=round(elapsed_ms, 1),
                              outcome='error' if error else 'response',
                              errorType=type(error).__name__ if error else None)
                if record['localCache']:
                    record.update(status='local-cache', estimatedCostUsd=0, outcome='local-cache')
                else:
                    raw = field(response, 'raw', response)
                    model = field(raw, 'model') or field(raw, 'modelVersion') or self.model
                    record['responseModel'] = model
                    record['usage'] = usage_from(response)
                    record['providerAttempts'] = list(events or [])
                    # A failed transport attempt may still have been billable. Do
                    # not silently count it as free when a later retry succeeds.
                    started = sum(e.get('status') == 'started' for e in events or [])
                    record['unknownProviderAttempts'] = max(0, started - (1 if response is not None else 0))
                    record.update(quote(record['usage'], model=model, provider=self.provider,
                                        mode=self.mode, at=record['startedAt'], prices=self.prices))
            except Exception:
                record.update(status='metering-error', estimatedCostUsd=None)
                self.errors.append('usage-normalization-failed')
            self._write('finished', record)

    async def complete(self, stage, attempt, request, metadata=None):
        record = self.start(stage, attempt, metadata=metadata)
        events, started, response, error = [], time.perf_counter(), None, None
        context = _ATTEMPTS.set(events)
        try:
            response = await request()
            return response
        except BaseException as exc:
            error = exc
            raise
        finally:
            _ATTEMPTS.reset(context)
            self.finish(record, response, error, events, (time.perf_counter() - started) * 1000)

    def cache_hit(self, stage, metadata=None):
        record = self.start(stage, local_cache=True, metadata=metadata)
        self.finish(record)

    def inspect_response(self, stage, attempt, value=None, error=None, finish_reason=None, characters=None):
        """Post-response JSON outcome is distinct from successful transport."""
        try:
            with self.lock:
                record = next(r for r in reversed(self.records) if r['stage'] == stage and r['attempt'] == attempt)
                record['structuredResponse'] = {'status': 'invalid' if error else 'parsed',
                    'errorType': type(error).__name__ if error else None,
                    'finishReason': str(finish_reason)[:64] if finish_reason else None,
                    'characters': characters, 'summary': response_summary(value) if error is None else None}
                self._write('inspected', record)
        except Exception:
            pass

    def phase(self, name):
        try:
            with self.lock:
                event = {'at': now(), 'name': name}
                self.phases.append(event)
                with (self.folder / 'run-events.jsonl').open('a') as f:
                    f.write(json.dumps({'event': 'phase', **event}, ensure_ascii=False) + '\n')
        except Exception:
            pass

    def end(self, outcome, error=None):
        with self.lock:
            self.run_status, self.finished_at = outcome, now()
            if error:self.run_info['errorType'] = type(error).__name__

    def summary(self):
        with self.lock:
            return summarize(self.records, errors=self.errors) | {
                'runId': self.run_id, 'startedAt': self.started_at, 'finishedAt': self.finished_at,
                'runStatus': self.run_status, 'phases': copy.deepcopy(self.phases),
                'runInfo': copy.deepcopy(self.run_info)}

    def save(self):
        with self.lock:
            value = self.summary()
            try:
                target = self.folder / 'usage-cost.json'
                temp = target.with_suffix('.tmp')
                temp.write_text(json.dumps(value, ensure_ascii=False, indent=2))
                temp.replace(target)
            except Exception:
                if 'usage-summary-write-failed' not in self.errors:
                    self.errors.append('usage-summary-write-failed')
                value = self.summary()
            return value


def job_cost(job):
    """Cumulative observed attempts; never infer historic charges as zero."""
    rows, historic_pages, runs, errors = [], [], 0, []
    for page in job.get('pages', []):
        if page.get('status') in ('queued', 'converting'):
            errors.append('conversion-in-progress')
        values = list(page.get('costRuns', {}).values())
        if page.get('result') and not page['result'].get('billing'):
            historic_pages.append(page['number'])
        elif not values and page.get('status') in ('failed', 'done', 'partial'):
            historic_pages.append(page['number'])
        if page.get('unmeteredHistory') and page['number'] not in historic_pages:
            historic_pages.append(page['number'])
        runs += len(values)
        for value in values:
            rows.extend(value.get('records', []))
            errors.extend(value.get('errors', []))
    value = summarize(rows, errors=errors + (['historic-usage-not-recorded'] if historic_pages else []))
    value.update(runs=runs, unmeteredPages=historic_pages)
    value.pop('records')
    return value


def recover_job_costs(job, folder):
    """Rebuild interrupted run totals from receipts, without repricing history."""
    for path in sorted((Path(folder) / 'runs').glob('*/usage-events.jsonl')):
        try:
            run_id = path.parent.name
            number = int(run_id.split('-')[0])
            page = job['pages'][number - 1]
            if run_id in page.get('costRuns', {}):
                continue
            records, errors = {}, []
            for line in path.read_text().splitlines():
                try:
                    record = json.loads(line)['record']
                    records[record['id']] = record
                except (ValueError, KeyError, TypeError):
                    errors.append('interrupted-usage-receipt')
            if not records:
                continue
            value = summarize(list(records.values()), errors=errors) | {'runId': run_id}
            value.update(runStatus='interrupted', startedAt=min(r['startedAt'] for r in records.values()))
            events = path.with_name('run-events.jsonl')
            if events.exists():
                value['phases'] = []
                for line in events.read_text().splitlines():
                    try:
                        event = json.loads(line)
                        if event.get('event') == 'phase':value['phases'].append({'at':event['at'],'name':event['name']})
                    except (ValueError, KeyError):continue
            saved = path.with_name('usage-cost.json')
            if saved.exists():
                try:
                    previous = json.loads(saved.read_text())
                    if previous.get('runId') == run_id and previous.get('records') == list(records.values()):
                        for key in ('runStatus','startedAt','finishedAt','runInfo'):
                            if key in previous:value[key] = previous[key]
                except (ValueError, TypeError):pass
            if page.get('result') and not page['result'].get('billing'):
                page['unmeteredHistory'] = True
            page.setdefault('costRuns', {})[run_id] = value
            if int(run_id.split('-')[-1]) >= int(page.get('billing', {}).get('runId', '0').split('-')[-1]):
                page['billing'] = value
        except Exception:
            # Corrupt accounting must not block opening an otherwise valid chart.
            continue
