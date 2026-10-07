# 从数据创建图表

打开 `/?mode=data`，粘贴 CSV、TSV 或 JSON，或导入 Excel 并选择工作表。
描述指标、比较方式和展示要求后，模型返回字段及图型方案，程序绑定原始数值并绘图。

- 输入表格作为原始版本保留；修改图表不覆盖原始输入。
- 保留精度、负数、百分比、单位和空白。无法解析的数值会提示核对。
- 字段映射必须引用存在的列；模型不能返回替代数值或可执行程序。
- 显式聚合保留参与计算的行号及算法；有缺失值时不伪造完整合计。
- 保存、重开、SVG / PNG / Excel 导出使用同一修订版本。

API 为 `POST /api/v1/create-chart`，必填 `data` 和 `requirements`。
`data` 接受 CSV/TSV 文本、JSON 对象数组或 `{columns, rows}`。
SDK 对应方法为 `ChartloomClient.create_chart`。
