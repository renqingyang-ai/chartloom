"""Explicit, local configuration; never discovers credentials in other projects."""
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
import os
import shutil

PROJECT = Path(__file__).resolve().parents[2]

@dataclass(frozen=True)
class Settings:
    llm_model: str
    llm_api_base: str
    llm_api_key: str = field(repr=False)
    proxy: str | None = field(repr=False)
    data_dir: Path
    web_dir: Path
    node: str
    soffice: str
    ocr_binary: Path

@lru_cache(maxsize=1)
def get_settings():
    values = {}
    env_file = os.environ.get('CHART_MODEL_ENV_FILE')
    if env_file:
        from dotenv import dotenv_values
        if not Path(env_file).is_file():
            raise ValueError('Configured model environment file does not exist.')
        values = dotenv_values(env_file)
    def value(name, legacy):
        return os.environ.get(name) or os.environ.get(legacy) or values.get(name) or values.get(legacy) or ''
    return Settings(
        llm_model=value('CHART_MODEL', 'LLM_MODEL'),
        llm_api_base=value('CHART_API_BASE', 'LLM_API_BASE'),
        llm_api_key=value('CHART_API_KEY', 'LLM_API_KEY'),
        proxy=os.environ.get('CHART_PROXY_URL'),
        data_dir=Path(os.environ.get('CHART_DATA_DIR', PROJECT / '.runtime/data')).expanduser().resolve(),
        web_dir=Path(os.environ.get('CHART_WEB_DIR', PROJECT / 'web')).expanduser().resolve(),
        node=os.environ.get('CHART_NODE_BINARY') or shutil.which('node') or 'node',
        soffice=os.environ.get('CHART_SOFFICE') or shutil.which('soffice') or '',
        ocr_binary=Path(os.environ.get('CHART_OCR_BINARY', PROJECT / '.runtime/recognize_text')).expanduser().resolve(),
    )

def rules_directory():
    target = get_settings().data_dir / 'validation-rules'
    # Runtime candidates and active pointers are separate from shipped immutable seeds.
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    seed = Path(__file__).parent / 'resources/rules'
    for source in seed.rglob('*.json'):
        out = target / source.relative_to(seed)
        out.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not out.exists():
            with out.open('x') as stream:
                stream.write(source.read_text())
    return target
