# Cloudflare AI Gateway VSCode 扩展

这是一个VSCode扩展，允许你在编辑器中直接与AI进行交互。通过配置Cloudflare AI Gateway的endpoint和API key，你可以方便地使用AI聊天功能。

## 功能特点

- 🔌 支持配置自定义API endpoint和key
- 🤖 支持配置多个AI模型（如GPT-3.5、GPT-4等）
- 💬 提供简洁的聊天界面
- 🎨 使用VSCode主题样式，提供一致的视觉体验
- 💾 自动保存配置到VSCode设置
- ⌨️ 支持快捷键发送消息
- 🔥 支持代码块和Markdown格式
- 📋 支持代码块一键复制功能
- ⚡ 支持流式响应，实时显示AI回复
- ❗ 智能错误提示和处理

## 使用方法

1. 点击VSCode侧边栏中的AI Chat图标(💭)打开聊天窗口
2. 在设置面板中配置：
   - API Endpoint: Cloudflare AI Gateway的API地址
   - API Key: 你的API密钥
   - 可用模型: 添加或删除AI模型
3. 配置完成后即可在聊天窗口与AI对话

## 命令

扩展提供以下命令:

- `打开AI聊天`: 打开聊天窗口
- `打开AI设置`: 打开设置面板

## 快捷键

- 在输入框中按`Enter`发送消息
- 使用命令面板(`Ctrl+Shift+P` / `Cmd+Shift+P`)可以快速访问所有命令

## 设置项

在VSCode设置中可以找到以下配置项：

- `cloudflare-ai-gateway.endpoint`: API endpoint地址
- `cloudflare-ai-gateway.apiKey`: API密钥
- `cloudflare-ai-gateway.models`: 可用的AI模型列表

## 错误处理

扩展提供了详细的错误提示：
- API连接问题
- 认证错误
- 请求格式错误
- 权限问题
- 模型响应错误

## 安全说明

- API密钥保存在VSCode的安全存储中
- 所有请求都通过HTTPS加密传输
- 不会收集或存储聊天记录

## 开发

1. 克隆仓库
2. 运行`npm install`安装依赖
3. 打开VSCode并按`F5`启动调试
4. 在新窗口中测试扩展

## 发布

```bash
vsce package
vsce publish
```

## 贡献

欢迎提交Issue和Pull Request！

## 许可证

MIT
