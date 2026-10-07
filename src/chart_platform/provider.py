"""Vision provider interface. A model change does not change the chart contract."""
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlparse
import httpx
from .config import get_settings

@dataclass
class ModelResult:
    content: str | None
    raw: dict
    usage_contract: str = 'openai-normalized'

class VisionProvider(Protocol):
    async def complete(self, *, model: str, messages: list, **options) -> ModelResult: ...

class OpenAICompatibleProvider:
    def __init__(self, transport=None):
        self.transport = transport

    async def complete(self, *, model, messages, purpose=None, temperature=0,
                       max_tokens=24000, timeout=100, response_format=None, api_base=None):
        settings = get_settings()
        base = (api_base or settings.llm_api_base).rstrip('/')
        api_model = model.removeprefix('openai/')
        if model.startswith(('gemini/', 'gemini-')) and not base:
            # Google's documented OpenAI-compatible vision endpoint.
            # https://ai.google.dev/gemini-api/docs/openai
            base = 'https://generativelanguage.googleapis.com/v1beta/openai'
            api_model = model.removeprefix('gemini/')
        if not model or not settings.llm_api_key or not base:
            raise ValueError('请配置 CHART_MODEL、CHART_API_BASE 和 CHART_API_KEY 后再转换。')
        parsed = urlparse(base)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError('Invalid model endpoint.')
        payload = {'model': api_model, 'messages': messages,
                   'temperature': temperature, 'max_tokens': max_tokens}
        if response_format:
            payload['response_format'] = response_format
        async with httpx.AsyncClient(timeout=timeout, proxy=settings.proxy,
                                     transport=self.transport) as client:
            try:
                response = await client.post(base + '/chat/completions', json=payload,
                    headers={'Authorization': 'Bearer ' + settings.llm_api_key})
            except httpx.TimeoutException:
                raise ValueError('模型请求超时；原始文件与已有结果已保留。') from None
            except httpx.HTTPError:
                raise ValueError('模型服务连接失败；请检查已配置的服务。') from None
        if response.is_error:
            # Provider bodies may contain credentials or private prompt content.
            raise ValueError(f'模型服务返回 HTTP {response.status_code}；本次转换未完成。')
        try:
            raw = response.json()
            content = raw['choices'][0]['message']['content']
            if not isinstance(content, (str, type(None))):
                raise TypeError()
            contract = 'gemini-openai' if parsed.hostname == 'generativelanguage.googleapis.com' else 'openai-normalized'
            return ModelResult(content, raw, usage_contract=contract)
        except (ValueError, KeyError, IndexError, TypeError):
            raise ValueError('模型服务响应格式无法读取。') from None
