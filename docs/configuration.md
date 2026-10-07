# 配置说明

复制根目录 `.env.example` 为 `.env`，自行填写以下变量：

| 变量 | 用途 |
| --- | --- |
| `CHART_MODEL` | 具有图像理解能力的模型名称 |
| `CHART_API_BASE` | OpenAI-compatible API base；Gemini 前缀模型可使用内置接口 |
| `CHART_API_KEY` | 使用者自己的模型 API key |
| `CHART_MODEL_ENV_FILE` | 显式读取的环境文件；启动示例使用 `.env` |
| `CHART_PROXY_URL` | 可选模型请求代理 |
| `CHART_DATA_DIR` | 私有任务目录；默认 `.runtime/data` |
| `CHART_WEB_DIR` | 前端静态文件目录；默认 `web` |
| `CHART_NODE_BINARY` | Node.js 路径；默认从 PATH 查找 |
| `CHART_SOFFICE` | LibreOffice 路径；默认从 PATH 查找 |
| `CHART_OCR_BINARY` | OCR 可执行文件路径 |

环境文件支持兼容变量 `LLM_MODEL`、`LLM_API_BASE`、`LLM_API_KEY`；优先使用
`CHART_*` 变量。服务不扫描其他项目或个人目录中的配置，也不内置任何密钥。

只有模型名称、API base 和 API key 从显式文件读取；其他可选设置传入启动进程环境。
例如使用自定义任务目录：

```bash
CHART_MODEL_ENV_FILE=.env CHART_DATA_DIR=./.runtime/my-data \
  .venv/bin/python -m chart_platform.server --port 8907
```

使用 `.env` 后可将文件权限设为仅本人可读写：`chmod 600 .env`。
Docker Compose 从 `.env` 注入进程环境，使用 `/data` 作为容器内任务目录。
