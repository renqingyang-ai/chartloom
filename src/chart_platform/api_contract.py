from .themes import list_themes
from . import __version__

def capabilities():
    return {
        'platform': 'chartloom', 'version': __version__, 'apiVersion': 'v1',
        'input': ['png', 'jpg', 'webp', 'pdf', 'pptx', 'ppt', 'csv', 'tsv', 'json-table', 'xlsx-via-browser'],
        'modes': ['charts', 'page', 'data'],
        'exports': ['json', 'svg', 'png', 'xlsx'],
        'themes': list_themes(),
        'routes': {
            'upload': 'POST /api/v1/upload?name=file.png&theme=neutral&client=my-app',
            'createChart': 'POST /api/v1/create-chart {data,requirements,theme?,clientId?,fileName?,sourceLocator?,columnUnits?,asOf?}',
            'job': 'GET /api/v1/job?id={id}',
            'pricing': 'GET /api/v1/pricing',
            'convert': 'POST /api/v1/convert {id,page,mode}',
            'convertDocument': 'POST /api/v1/convert-document {id,pages,mode,replace}',
            'data': 'GET /api/v1/document-data?id={id}',
            'saveChart': 'POST /api/v1/save-chart {id,page,elementId,chart,figure?,revision}',
            'saveFigure': 'POST /api/v1/save-figure {id,page,elementId,figure,revision}',
            'forkElement': 'POST /api/v1/fork-element {id,page,elementId,revision}',
            'artifact': 'GET /api/v1/artifact?id={id}&page=1&elementId={id}&format=svg',
            'rules': 'GET /api/v1/validation-rules',
            'check': 'POST /api/v1/validation/check {text,expected?}',
            'propose': 'POST /api/v1/validation/propose {text}',
            'activate': 'POST /api/v1/validation/activate {candidateId,expectedVersion}',
            'rollback': 'POST /api/v1/validation/rollback {expectedVersion}'
        },
        'quality': {'processedIsAccepted':False,'keepsUnknownNull':True,
                    'retainsSourceAndHistory':True,'modelProposalsRequireRegression':True},
        'runtime': 'Single local process; loopback HTTP; not a hosted multi-tenant service.',
        'optionalRuntimes': {'ppt':'LibreOffice headless', 'localOcr':'macOS Vision helper'},
    }
