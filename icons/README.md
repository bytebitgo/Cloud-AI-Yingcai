# VSCode AI 图标

这个目录包含了为Cloud-AI-Yingcai VSCode扩展设计的一系列现代化AI图标。

## 图标列表

1. **智能大脑图标** (brain-ai-icon) - 抽象的大脑轮廓，内部有连接线路
2. **云端AI图标** (cloud-ai-icon) - 云朵形状与电路板元素结合
3. **对话气泡AI** (chat-ai-icon) - 带有AI芯片元素的对话气泡
4. **机器人头像** (robot-ai-icon) - 现代简约风格的AI机器人头像
5. **量子AI节点** (quantum-ai-icon) - 量子计算风格的节点连接图案
6. **AI光环** (ai-halo-icon) - 中心有"AI"字样，周围有光环效果
7. **数据流AI** (data-flow-ai-icon) - 数据流线条形成的AI形象
8. **六边形科技图标** (hex-tech-ai-icon) - 六边形内嵌AI相关元素
9. **渐变波形AI** (wave-ai-icon) - 代表语音和智能的波形图案
10. **星云AI** (nebula-ai-icon) - 星云形状与数字元素结合的图标
11. **电路AI** (circuit-ai-icon) - 电路板风格的AI图标

## 文件格式

- SVG格式 - 矢量图形，可缩放而不失真
- PNG格式 - 128px x 128px，带透明背景

## 如何使用转换工具

这个目录包含一个Node.js脚本，可以将SVG图标转换为PNG格式。

### 安装依赖

```bash
cd icons
npm install
```

### 运行转换脚本

```bash
npm run convert
```

转换后的PNG文件将保存在`icons/png`目录中。

## 在VSCode扩展中使用

要在VSCode扩展中使用这些图标，请在`package.json`文件中更新图标路径：

```json
"icon": "icons/png/your-chosen-icon.png",
```

或者在`contributes.viewsContainers.activitybar`部分中：

```json
"icon": "icons/png/your-chosen-icon.png"
```

## 自定义

所有图标都是SVG格式，可以使用任何SVG编辑器（如Inkscape、Adobe Illustrator或在线SVG编辑器）进行自定义。 