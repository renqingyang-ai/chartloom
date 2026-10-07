# 新截图的可复用绘制契约

用户目标：新图截图上传后提取本图的数据与结构，用 OM 主题重绘，并能编辑数据。不能按固定页码、文件名或已保存的例子选择一份预制结果。

## 固定程序和每次变化的数据

- `source-layout.tsx` 是固定 D3 程序。比例尺、柱/线/点/弧、图例、文字、引线、字体度量和拥挤标签处理只实现一次。
- 每次上传提取 `chart` 数据，以及 `sourceLayout`：绘图区、方向、数轴与刻度、分类中心、柱宽、系列几何、图例位置、带数据绑定的文字、注释框与引线。布局是数据，不是模型生成的 JavaScript 或 SVG。
- 样例集与评估答案只在 `evidence/` 中使用；识别后端没有导入它们。没有文件名、项目名或页码分支。
- 支持这套布局契约的数值图为柱、分组柱、堆叠柱、折线/面积、双轴柱线、饼/环、散点/曲线。时间轴、甘特和分层图仍使用原有通用组件。没有覆盖的图形要报告缺口，不能伪装成别的图形。

## 每张图实际经过的步骤

1. 发现所有图表区域。像素坐标或千分比误写成百分比时，重新对照整图定位，不直接截断到 100%。
2. 逐图提取数据；独立复核数字、分类、系列配色、单位、合计与注释。PDF/PPT 可提供原生证据；纯截图路径独立运行。
3. 图内布局单独识别。程序验证索引、坐标、尺度、数值文字与已核对单元格的绑定。
4. 原图像素辅助测量柱宽、折线宽度、点位和文字。OCR 只是辅助证据，不能代替原图；当前本地文字测量使用 macOS Vision，缺少此工具时保留模型布局并标明测量不可用。
5. 调用固定 D3 绘图规则。布局问题只修布局，不让模型为改变布局重写正确数字。截图无明确数字时，仅在可校准刻度下恢复近似值，并保存误差/方法说明。
6. 浏览器检查实际显示和模型复核。图表模式复核独立图表画面，整页模式才复核整页，避免整页排版问题误判为图表提取失败。最多一轮局部修正；未解决问题保留可见提示。

## 分组柱的排列关系（v4.8.5）

- 新提取布局保存 `barSeriesOrder`：竖向按从左到右，横向按从上到下列出柱形系列索引；与数据顺序、图例顺序分别保存。缺值或零值保留原槽位，混合图排除折线系列，堆叠图不使用这个并列顺序。
- 源色像素在相近系列之间按最近颜色分配。柱宽异常的细碎文字不能移动整组柱；多组柱的相对关系只能在确定唯一顺序时覆盖模型测量。
- 新转换必须描述排列关系；旧 v1 结果仍能打开，其缺失的关系不因此成为已验证。数据和图例不因绘制顺序变化而改写。使用已有动态布局关系校验规则检查索引完整性，错误交回布局修正。

## 编辑与导出

v4.5.2 的柱形约束：

- 色块按系列和类别位置绑定，而非要求整张图的同色色块数等于柱子数；同色轴文字不能让全部测量失效。每根柱子的中心和宽度记录在 `rasterMarkMeasurement`，组间距从完整分组的源像素恢复。
- 一组柱形宽度不得超过相邻类别中心的距离；堆叠系列共享一个类别宽度，折线系列不计入柱数。单位不明时重新测量，不按猜测比例缩小。相接但不相互覆盖的直方图允许保留。
- 浏览器逐一检查实际矩形重叠与坐标文字遮挡，不能仅凭文本无溢出判定图形通过。绘制器对旧存档里的不可能宽度给出显式未完成提示，保留数据，不继续画出错误黑块。

v4.5 的补充约束：

- 单图提取与复核仍读取整页上下文，同页表格证据存入 `contextEvidence`，不把表格精确值冒充图中印出的标签。紧裁切遗漏的类别只有在上下文证据完整对应时才补回，使用 `bottomPadding` 保留显示空间；缺失的类别名不编造。
- `seriesGeometry.axis` 与主、副轴分别标定。每个轴保留自己的原图刻度位置和单位；首系列属于副轴时不得用于绘制主轴。柱端或被装饰覆盖的折线点由原图像素辅助定位，恢复的数值记录为估计值。v4.5.1 在颜色元数据缺失时从多数柱形对应的矩形像素段推断源色；背景、短标签框或候选冲突不能作为有效柱子测量。
- 普通柱形读取端点对应的轴值；只有堆叠段或悬浮段才计算端点减基线。折线编辑不强制把比例尺扩到零。
- 完整性检查按系列计算，整条线缺失不能通过。混合图布局失败不能静默显示为普通柱状图；数据仍保留，界面明确标示未完成。

`sourceLayout.sourceData` 是程序保存的原始基线。改值时重新计算比例尺、图形和绑定标签；合计、CAGR 等独立原文标注不会被擅自重算。改变类别数量或系列数量时，旧位置不再适用，降回通用布局并提示，不静默漏掉新增数据。

Excel 的可见单元格是导回时的数值依据。百分数按 Excel 的数值与格式一起保存，例如 `0.47` 和 `0%` 格式表示 47%，不能丢格式后读成 0.47%。SVG、PNG 与编辑预览共用绘制器，导出附带数据与来源；原图只用于对照。

本契约描述独立项目的图表绘制行为。已覆盖的测试不构成任意截图均能精确恢复的保证；模糊、遮挡和原图本来未印出的事实需要继续核对。
# Bound text inside a bar

`texts[].color` describes the source ink; it does not imply centered text or
override contrast on a themed bar. Since v4.8.11, a value whose anchor lies
inside its bound rendered bar takes contrast from that mark's actual theme
color, regardless of whether the source used dark or inverse ink. Outside
labels retain readable background contrast. Boxed, rotated and multiline
labels keep their existing placement behavior and remain a separate boundary.
The renderer preserves the measured `anchor` (`start`, `middle`, `end`) and a
usable source position. Since v4.8.12, an observed glyph box beyond the source
bar endpoint identifies an external label even when its OCR anchor is slightly
inside the bar. Its endpoint binding is kept after editing. Without a glyph
box, already external anchors keep their existing measured position.
For an unrotated, single-line label inside its bound bar, it fits glyphs to the
available width and segment height. If an edge anchor would force a much
smaller font than the segment requires, it first translates the ink minimally
inside the same segment. A severely undersized fit is reported for review.
Numbers, sourceData and bar geometry do not change during label placement.
Labels near a bar's baseline follow that baseline when values are edited;
labels near its endpoint follow the endpoint. Missing values remain missing.
Rotated and multiline text retain the existing source placement rules.

Browser validation measures actual glyph ink as well as DOM bounds. SVG
`getBBox()` may include font line-box whitespace and is not by itself proof
that painted letters overlap a neighbouring segment.

### 左右展开的正数柱（v4.8.9–v4.8.11）

- 两组正数共用一个零点、向相反方向展开时，数据仍保存正数；绘制布局保存 `mirrorBars: {"directions": [-1, 1]}`，也可交换顺序。不要为了画向左而把百分比改成负数。
- 使用两组未堆叠柱的绘制载体；两个系列共享分类中心和柱宽，不使用并列柱的 `barSeriesOrder`、间距或人工负基线。真正的负数、堆叠和悬浮柱继续走各自契约。
- 原图像素测量可以确认共同基线：至少两行在两侧都有柱、共用边缘、各组宽度有变化、长度与正数使用同一比例。不能只因两段相接或加起来是 100 就认定为对称柱。
- 坐标轴的正负范围是显示坐标；编辑、Excel、来源数据仍是原始数值。修改时只重算绘制方向、长度和绑定标签；超出原量程可扩域，空值不画。非法负数编辑不覆盖已保存结果。
- 数据提取和独立复核都读同一正数契约；布局检查不通过时仍保留数据和诊断，不能关闭普通分组柱的重叠校验来放行。
- 回归需要分别检查正反轴、横竖布局、普通堆叠反例、Excel 百分比往返和保存重开。


### 饼图和环形图的内部文字（v4.8.8）

- 文字仍按 category/value 的 index 绑定扇区；颜色、字体来自 OM 主题，数值不由排版修改。
- 原位置的实际字形完整落在扇区内时保持位置。OCR 基线偏移、改值或换字体导致越界时，在所属扇区内做最小位移；必要时缩字号，最低到原字号的 60%。检查外圆、内圆和扇区边界，不用整个矩形图框代替扇区。
- 内部分类名称和数值统一按实际主题底色选择明暗文字。改数值后两者一起按扇区中线变化转动；外部引线标签、环心说明不拉进扇区。
- 小到无法容纳的扇区保留原数值和标签，加描边保证可辨，并通过 data-label-review 进入现有待核对报告，不冒充通过，不中止其他图形。
- 此次范围是未旋转、绑定清楚的内部文字。极小扇区外置引线的自动排布、原图未绑定标签、外部标签和引线改值后的全自动重排仍有边界。
- `verify_pie_labels.mjs` 用实际 SVG 路径的 isPointInFill 检查字形，与排版器的几何算法独立；涵盖顺/逆时针、起始角、环孔、编辑、未知值及超小扇区提示。

### v4.8.13 单柱的颜色分类

`barPlacement: "category"` 明确表示每个分类位置只绘制一根柱，颜色由系列决定。模型需根据原图选择，并给出完整 `categoryPositions`、单柱宽和 `groupGap: 0`。每个分类至多一个非空柱值（零也计作一个），不适用于堆叠或对称柱。该字段缺省时，分组柱仍保留所有系列的位置，不能因为数据有 null 就自动挪动柱子。

原数值、空值与系列名称不变。像素测量只细化单柱宽和分类中心。编辑新增第二个同分类柱后，保存会转为自适应布局并提示重新核对，不能在原单柱位置相互覆盖。空值是结构空白还是读不到的值，目前仍按待核对处理。
