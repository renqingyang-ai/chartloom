"""Bounded document conversion using the same live pipeline as a single page."""
import copy
import uuid

ACTIVE = ('queued', 'converting')


def recover_interrupted(job):
    for page in job.get('pages', []):
        if page.get('status') in ACTIVE:
            page.update(status='failed', stage='上次任务中断，可继续未完成页',
                        error='上次任务被服务重启打断，可继续转换未完成的页面；已有结果保留。')
            page.pop('candidate', None)
            page.pop('queueToken', None)
            page.pop('statusBeforeQueue', None)


def summary(job):
    pages = job.get('pages', [])
    return {
        'total': len(pages),
        'generated': sum(bool(p.get('result')) for p in pages),
        'queued': sum(p['status'] == 'queued' for p in pages),
        'running': sum(p['status'] == 'converting' for p in pages),
        'failed': sum(p['status'] == 'failed' for p in pages),
        'review': sum(p['status'] == 'partial' for p in pages),
    }


def start(c, job_id, pages=None, mode='page', replace=False):
    if mode not in ('page', 'chart', 'charts') or not isinstance(replace, bool):
        raise ValueError('转换模式或重新转换选项不正确。')
    with c.LOCK:
        current = c.JOBS.get(job_id)
        if not current or current['status'] != 'ready':
            raise ValueError('文件仍在读取，或文件不存在。')
        if current.get('inputKind') == 'data':
            raise ValueError('此任务来自表格数据，请通过“用数据生成”创建新版本，不需要图片识别。')
        if pages is None:
            pages = [p['number'] for p in current['pages']]
        if (not isinstance(pages, list) or not 1 <= len(pages) <= 80
                or any(type(n) is not int or not 1 <= n <= len(current['pages']) for n in pages)):
            raise ValueError('请选择文件内的有效页码，每次最多 80 页。')
        numbers = list(dict.fromkeys(pages))
        eligible = [n for n in numbers
                    if current['pages'][n-1]['status'] not in ACTIVE
                    and (replace or not current['pages'][n-1].get('result')
                         or current['pages'][n-1]['status'] == 'failed')]
        pending = sum(p['status'] == 'queued' for j in c.JOBS.values() for p in j['pages'])
        if pending + len(eligible) > 160:
            raise ValueError('等待转换的页面较多，请等当前任务完成后再添加。')
        if not eligible:
            return c.public_job(current)
        job = copy.deepcopy(current)
        tasks = []
        for n in eligible:
            p = job['pages'][n-1]
            if p['status'] in ('done', 'partial', 'failed') and not p.get('costRuns'):
                p['unmeteredHistory'] = True
            token = uuid.uuid4().hex
            p.update(statusBeforeQueue=p['status'], status='queued', queueToken=token,
                     queuedAt=c.now(), mode=mode, stage='已排队，等待转换')
            tasks.append((n, token))
        c.persist(job)
        c.JOBS[job_id] = job
        # Submit under the same lock as persistence, so duplicate requests cannot
        # enqueue the same page twice. POOL has two workers for all documents.
        for n, token in tasks:
            c.POOL.submit(run_page, c, job_id, n, mode, token)
        return c.public_job(job)


def run_page(c, job_id, number, mode, token):
    with c.LOCK:
        current = c.JOBS.get(job_id)
        if not current:
            return
        page = current['pages'][number-1]
        if page['status'] != 'queued' or page.get('queueToken') != token:
            return
        job = copy.deepcopy(current)
        page = job['pages'][number-1]
        page.update(status='converting', startedAt=c.now(), stage='正在读取页面数据和结构')
        page.pop('error', None)
        page.pop('statusBeforeQueue', None)
        c.persist(job)
        c.JOBS[job_id] = job
    try:
        c.convert_page(job_id, number, mode)
    except Exception as exc:
        # convert_page normally isolates errors itself. Also contain unexpected
        # worker errors so a single page never aborts later queued work.
        with c.LOCK:
            job = copy.deepcopy(c.JOBS[job_id])
            page = job['pages'][number-1]
            page.update(status='failed', stage='此页转换未完成，可单独重试',
                        error='此页转换未完成；其他页面继续处理，已有结果保留。',
                        errorType=type(exc).__name__)
            page.pop('candidate', None)
            c.persist(job)
            c.JOBS[job_id] = job


def cancel_pending(c, job_id):
    with c.LOCK:
        if job_id not in c.JOBS:
            raise ValueError('找不到这份文件。')
        job = copy.deepcopy(c.JOBS[job_id])
        for p in job['pages']:
            if p['status'] != 'queued':
                continue
            p['status'] = p.pop('statusBeforeQueue', 'partial' if p.get('result') else 'idle')
            p.pop('queueToken', None)
            p['stage'] = '已取消等待；已有结果保留'
        c.persist(job)
        c.JOBS[job_id] = job
        return c.public_job(job)


def export_document(job):
    return {'version': 1, 'fileName': job['fileName'], 'sourceSha256': job['sha256'],
            'jobId': job['id'], 'summary': summary(job),
            'pages': [{k: p[k] for k in ('number', 'status', 'error', 'result') if k in p}
                      for p in job['pages']]}
