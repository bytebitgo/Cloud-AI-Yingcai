const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// 图标列表
const icons = [
  'brain-ai-icon',
  'cloud-ai-icon',
  'chat-ai-icon',
  'robot-ai-icon',
  'quantum-ai-icon',
  'ai-halo-icon',
  'data-flow-ai-icon',
  'hex-tech-ai-icon',
  'wave-ai-icon',
  'nebula-ai-icon',
  'circuit-ai-icon'
];

// 确保输出目录存在
const outputDir = path.join(__dirname, 'png');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// 转换所有SVG到PNG
async function convertAll() {
  console.log('开始转换SVG到PNG...');
  
  for (const icon of icons) {
    const svgPath = path.join(__dirname, `${icon}.svg`);
    const pngPath = path.join(outputDir, `${icon}.png`);
    
    // 检查SVG文件是否存在
    if (!fs.existsSync(svgPath)) {
      console.log(`跳过 ${icon}.svg (文件不存在)`);
      continue;
    }
    
    try {
      // 读取SVG文件
      const svgBuffer = fs.readFileSync(svgPath);
      
      // 转换为PNG
      await sharp(svgBuffer)
        .resize(128, 128)
        .png()
        .toFile(pngPath);
      
      console.log(`成功转换: ${icon}.svg -> ${icon}.png`);
    } catch (error) {
      console.error(`转换 ${icon}.svg 失败:`, error);
    }
  }
  
  console.log('转换完成!');
}

// 执行转换
convertAll().catch(err => {
  console.error('转换过程中发生错误:', err);
}); 