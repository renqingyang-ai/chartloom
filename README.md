# Chartloom

把图片、PDF、PowerPoint 和表格数据织成可编辑图表。

项目仓库：[renqingyang-ai/chartloom](https://github.com/renqingyang-ai/chartloom)。

Chartloom 是独立的 Python + React/D3 项目。它提取图表数据和布局，用固定绘图组件重绘，
支持编辑、保存、Excel 导入导出，以及 SVG / PNG 导出。也可以直接输入 CSV、Excel 或 JSON，
描述图表需求后生成图表，无需原图。通过 HTTP API 和轻量 Python SDK 可以接入其他应用。

本项目只包含源码、依赖锁文件、字体及其许可证、合成测试和公开配置模板。
模型 API key 由使用者自行配置。

## 本地启动

需要 Python 3.11+、Node.js 22+ 和 npm。以下命令在本项目根目录执行：

```bash
git clone https://github.com/renqingyang-ai/chartloom.git
cd chartloom
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pip install --no-deps -e sdk/python -e .
npm ci --ignore-scripts
npm run build
npx playwright install chromium
cp .env.example .env
```

在 `.env` 中填写自己的模型名称、API base 和 API key，然后启动：

```bash
CHART_MODEL_ENV_FILE=.env .venv/bin/python -m chart_platform.server --port 8907
```

打开 <http://localhost:8907/>。数据创建入口为 <http://localhost:8907/?mode=data>。
`.env`、依赖目录、任务数据、原文件、日志和导出产物均由 `.gitignore` 排除。
未配置 key 时可以打开界面、查看组件和规则；实际模型转换需要自行填写配置。

模型接口使用 OpenAI-compatible 协议。带 `gemini/` 前缀的模型名称支持内置 Gemini 兼容接口，
其他服务填写 `CHART_API_BASE`。配置只从进程环境或显式指定的环境文件读取。
可选变量及设置方式见 [.env.example](.env.example) 和 [配置说明](docs/configuration.md)。

PPT/PPTX 预览需要 LibreOffice headless。macOS OCR 可运行 `bash scripts/build_ocr.sh`；
Linux OCR 使用 Tesseract，Docker 镜像中已包含它。缺少 OCR 时会记录相关测量不可用。

## 使用 Python SDK

调用方只需安装本项目的 `sdk/python`，无需安装整个转换服务：

```python
from chartloom_sdk import ChartloomClient

client = ChartloomClient("http://localhost:8907", client_id="my-app", theme="neutral")
job = client.upload("chart.png")
client.wait(job["id"])
client.convert(job["id"], pages=[1])
result = client.wait(job["id"], pages=[1])
print(client.editor_url(job["id"]))
```

也可以直接从表格创建：

```python
job = client.create_chart(
    [{"Month": "Jan", "Revenue": 120.5}, {"Month": "Feb", "Revenue": 145.75}],
    "Compare monthly revenue with bars and show the exact values.",
    file_name="Monthly revenue",
)
result = client.wait(job["id"])
```

当前接口清单：`GET /api/v1/capabilities`。API 统一使用 `/api/v1/` 前缀。
模型调用、数据修改、导出和费用记录保存在各自任务中；数字缺失保留为缺失值。

## Docker

填写项目根目录的 `.env` 后启动：

```bash
docker compose -f deploy/compose.yml up --build
```

默认在本机 `http://localhost:8907` 提供服务，数据存放在该 Compose 项目的独立 volume 中。
Compose 使用当前目录源码构建镜像，模型配置来自用户自己的 `.env`。

## 开发与检查

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python -m unittest discover -s tests -p 'verify_*.py'
npm run typecheck
npm run build
python3 scripts/check_public_source.py
git diff --check
```

浏览器检查需要先启动本项目服务，再运行：

```bash
CHART_TEST_URL=http://localhost:8907 npm run test:browser
```

源码发布检查只输出问题文件、行号和规则名称，不打印匹配到的密钥内容。
它检查待提交源码、配置模板和常见凭据格式；不替代人工检查自己的新增文件。

目录结构、转换流程和数据边界见 [架构说明](docs/architecture.md)。
本次无凭据验证范围见 [验证记录](docs/verification.md)。
贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

项目源码使用 [MIT License](LICENSE)。字体许可证和第三方说明见 [NOTICE](NOTICE)。
