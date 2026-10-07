# 图表绘制组件

`registry.tsx` 注册固定 D3 组件，`theme.ts` 提供字体和配色。
`source-layout.tsx` 按本次上传的数值、结构与布局绘图；字段契约见
[source-layout-contract.md](source-layout-contract.md)。

支持柱状、分组/堆叠、双轴、饼/环、散点、曲线、资产负债、时间轴、分层和甘特图。
`data-chart.tsx` 用于从原始表格创建的自适应图表。
`geographic-map.tsx` 与 `page-assets.tsx` 处理页面中的地图、矢量结构与独立素材。

转换结果进入 `pipelineFigure(element)`，统一字段后由 `RegisteredFigure` 分派。
组件不按样例文件名、项目名称或页码选择预制数据。
`component-probe.tsx` 中的合成数据只用于渲染回归。

修改数据后重绘；保存与 SVG/PNG 导出共用绘制器。
保留空值、单位、精度以及独立的原稿合计、倍数和 CAGR，不自行推算未提供的事实。
恢复坐标或几何得到的估计值需要继续核对。

修改组件后运行 TypeScript 检查、构建、相关 Python 回归与浏览器检查。
`svg_checks.mjs` 检查越界、文字碰撞、非法坐标和页面完整性。
浏览器实际绘制结果与单纯数据校验分别验证。
