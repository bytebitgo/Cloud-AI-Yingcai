import * as vscode from 'vscode';
import axios from 'axios';

class SettingsManager {
    constructor(private readonly _context: vscode.ExtensionContext) {}

    public getSettings(): { endpoint: string; apiKey: string; models: string[] } {
        const config = vscode.workspace.getConfiguration('cloudflare-ai-gateway');
        return {
            endpoint: config.get('endpoint') || '',
            apiKey: config.get('apiKey') || '',
            models: config.get('models') || ['gpt-3.5-turbo', 'gpt-4']
        };
    }

    public saveSettings(settings: { endpoint: string; apiKey: string; models: string[] }) {
        const config = vscode.workspace.getConfiguration('cloudflare-ai-gateway');
        config.update('endpoint', settings.endpoint, true);
        config.update('apiKey', settings.apiKey, true);
        config.update('models', settings.models, true);
    }
}

class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _messages: Array<{role: string, content: string}> = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _settingsManager: SettingsManager
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        await this._handleMessage(message.text);
                        break;
                }
            }
        );
    }

    private async _handleMessage(text: string) {
        if (!this._view) return;

        const userMessage = { role: 'user', content: text };
        this._messages.push(userMessage);
        
        // 立即显示用户消息
        this._view.webview.postMessage({
            type: 'addMessage',
            message: userMessage,
            temporary: false
        });

        // 显示加载状态
        this._view.webview.postMessage({
            type: 'addMessage',
            message: { role: 'assistant', content: '正在思考...' },
            temporary: true
        });

        const settings = this._settingsManager.getSettings();
        if (!settings.endpoint || !settings.apiKey) {
            this._showError('请先在设置面板配置endpoint和apiKey');
            return;
        }

        try {
            // 记录请求信息
            console.log('发送请求到:', settings.endpoint);
            console.log('请求参数:', {
                model: settings.models[0],
                messages: this._messages,
                temperature: 0.7,
                max_tokens: 2048,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
                stream: false
            });

            const response = await axios.post(settings.endpoint, {
                model: settings.models[0],
                messages: this._messages,
                temperature: 0.7,
                max_tokens: 2048,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
                stream: true
            }, {
                headers: {
                    'Authorization': `Bearer ${settings.apiKey}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream'
            });

            // 移除加载状态消息
            this._view.webview.postMessage({
                type: 'removeTemporary'
            });

            // 创建新的助手消息
            const aiMessage = { 
                role: 'assistant', 
                content: '' 
            };
            this._messages.push(aiMessage);

            // 初始化流式消息
            this._view.webview.postMessage({
                type: 'addMessage',
                message: aiMessage,
                temporary: false
            });

            if (!response.data) {
                throw new Error('响应数据为空');
            }

            // 处理流式数据
            response.data.on('data', (chunk: Buffer) => {
                if (!this._view) return;
                
                try {
                    const lines = chunk.toString().split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;
                            
                            const json = JSON.parse(data);
                            const delta = json.choices[0]?.delta?.content || '';
                            if (delta) {
                                aiMessage.content += delta;
                                this._view.webview.postMessage({
                                    type: 'updateMessage',
                                    message: aiMessage
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.error('处理流式数据错误:', error);
                }
            });

            response.data.on('end', () => {
                console.log('流式响应结束');
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'addMessage',
                        message: aiMessage,
                        temporary: false
                    });
                }
            });
        } catch (error: any) {
            this._handleError(error);
        }
    }

    private _handleError(error: any) {
        let errorMessage = '发送消息失败';
        if (axios.isAxiosError(error)) {
            if (error.response?.status === 400) {
                errorMessage += `: 请求格式错误 (${error.response.data?.error || '未知错误'})`;
            } else if (error.response?.status === 401) {
                errorMessage += ': API密钥无效';
            } else if (error.response?.status === 403) {
                errorMessage += ': 没有访问权限';
            } else if (error.response?.status === 404) {
                errorMessage += ': API端点不存在';
            } else {
                errorMessage += `: ${error.response?.data?.error || error.message || '未知错误'}`;
            }
            console.error('错误详情:', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                headers: error.response?.headers
            });
        } else {
            errorMessage += `: ${error.message}`;
            console.error('未知错误:', error);
        }
        this._showError(errorMessage);
    }

    private _showError(message: string) {
        if (this._view) {
            // 移除加载状态消息
            this._view.webview.postMessage({
                type: 'removeTemporary'
            });
            // 显示错误消息
            this._view.webview.postMessage({
                type: 'addMessage',
                message: { role: 'error', content: message },
                temporary: false
            });
        }
        vscode.window.showErrorMessage(message);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `
            <!DOCTYPE html>
            <html lang="zh">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        padding: 0;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-editor-foreground);
                    }
                    .chat-container {
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        padding: 10px;
                    }
                    .messages {
                        flex: 1;
                        overflow-y: auto;
                        margin-bottom: 10px;
                        padding: 10px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                    }
                    .message {
                        margin-bottom: 10px;
                        padding: 8px;
                        border-radius: 4px;
                        opacity: 1;
                        transition: opacity 0.3s ease;
                    }
                    .message.temporary {
                        opacity: 0.6;
                    }
                    .user-message {
                        background-color: var(--vscode-debugToolBar-background);
                        margin-left: 20%;
                        border: 1px solid var(--vscode-input-border);
                    }
                    .assistant-message {
                        background-color: var(--vscode-editor-lineHighlightBackground);
                        margin-right: 20%;
                        border: 1px solid var(--vscode-input-border);
                    }
                    .error-message {
                        background-color: var(--vscode-errorForeground);
                        color: var(--vscode-editor-background);
                        margin: 0 20%;
                    }
                    .input-container {
                        display: flex;
                        gap: 8px;
                    }
                    #messageInput {
                        flex: 1;
                        padding: 6px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                    }
                    button {
                        padding: 6px 12px;
                        border: none;
                        border-radius: 4px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    pre {
                        background: var(--vscode-textCodeBlock-background);
                        padding: 10px;
                        border-radius: 4px;
                        overflow-x: auto;
                        position: relative;
                    }
                    code {
                        font-family: var(--vscode-editor-font-family);
                    }
                    .copy-button {
                        position: absolute;
                        top: 5px;
                        right: 5px;
                        padding: 4px 8px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        opacity: 0;
                        transition: opacity 0.2s;
                    }
                    pre:hover .copy-button {
                        opacity: 1;
                    }
                    .copy-button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="chat-container">
                    <div class="messages" id="messages"></div>
                    <div class="input-container">
                        <input type="text" id="messageInput" placeholder="输入消息...">
                        <button onclick="sendMessage()" id="sendButton">发送</button>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    let isProcessing = false;
                    
                    document.getElementById('messageInput').addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && !isProcessing) {
                            sendMessage();
                        }
                    });

                    function sendMessage() {
                        if (isProcessing) return;
                        
                        const input = document.getElementById('messageInput');
                        const text = input.value.trim();
                        if (!text) return;

                        isProcessing = true;
                        const sendButton = document.getElementById('sendButton');
                        sendButton.disabled = true;
                        sendButton.textContent = '发送中...';

                        vscode.postMessage({
                            command: 'sendMessage',
                            text: text
                        });

                        input.value = '';
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        
                        if (message.type === 'addMessage') {
                            appendMessage(message.message, message.temporary);
                        } else if (message.type === 'removeTemporary') {
                            removeTemporaryMessages();
                        } else if (message.type === 'updateMessage') {
                            updateMessage(message.message);
                        }
                        
                        if (message.type === 'addMessage' && message.message.role === 'assistant' && !message.temporary) {
                            isProcessing = false;
                            const sendButton = document.getElementById('sendButton');
                            sendButton.disabled = false;
                            sendButton.textContent = '发送';
                        }
                    });

                    function updateMessage(message) {
                        const messagesDiv = document.getElementById('messages');
                        const messageDiv = messagesDiv.lastElementChild;
                        if (messageDiv && messageDiv.classList.contains(\`\${message.role}-message\`)) {
                            const content = message.content
                                .replace(/\`\`\`(\\w*\\n)?([\\s\\S]*?)\\n?\`\`\`/g, '<pre><code>$2</code><button class="copy-button" onclick="copyCode(this)">复制</button></pre>')
                                .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                                .replace(/\\n/g, '<br>');
                            messageDiv.innerHTML = content;
                            messagesDiv.scrollTop = messagesDiv.scrollHeight;
                        }
                    }

                    function appendMessage(message, temporary = false) {
                        const messagesDiv = document.getElementById('messages');
                        const messageDiv = document.createElement('div');
                        messageDiv.className = \`message \${message.role}-message\${temporary ? ' temporary' : ''}\`;
                        
                        const content = message.content
                            .replace(/\`\`\`(\\w*\\n)?([\\s\\S]*?)\\n?\`\`\`/g, '<pre><code>$2</code></pre>')
                            .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                            .replace(/\\n/g, '<br>');
                        
                        messageDiv.innerHTML = content;
                        messagesDiv.appendChild(messageDiv);
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    }

                    function removeTemporaryMessages() {
                        const tempMessages = document.querySelectorAll('.message.temporary');
                        tempMessages.forEach(msg => msg.remove());
                    }
                    async function copyCode(button) {
                        const code = button.previousElementSibling.textContent;
                        try {
                            await navigator.clipboard.writeText(code);
                            const originalText = button.textContent;
                            button.textContent = '已复制!';
                            button.style.background = 'var(--vscode-button-secondaryBackground)';
                            setTimeout(() => {
                                button.textContent = originalText;
                                button.style.background = '';
                            }, 1500);
                        } catch (err) {
                            console.error('复制失败:', err);
                        }
                    }
                </script>
            </body>
            </html>
        `;
    }
}

class SettingsViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _settingsManager: SettingsManager
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this.getSettingsHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'saveSettings':
                        this._settingsManager.saveSettings(message.settings);
                        vscode.window.showInformationMessage('设置已保存');
                        break;
                }
            }
        );
    }

    public getSettingsHtml(webview: vscode.Webview) {
        const settings = this._settingsManager.getSettings();
        
        return `
            <!DOCTYPE html>
            <html lang="zh">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        padding: 15px;
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-editor-foreground);
                    }
                    .form-group {
                        margin-bottom: 15px;
                    }
                    label {
                        display: block;
                        margin-bottom: 5px;
                    }
                    input {
                        width: 100%;
                        padding: 6px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                    }
                    button {
                        padding: 6px 12px;
                        border: none;
                        border-radius: 4px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .models-container {
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        padding: 10px;
                        margin-top: 5px;
                    }
                    .models-list {
                        margin-bottom: 10px;
                        max-height: 150px;
                        overflow-y: auto;
                    }
                    .model-item {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 5px;
                        margin: 2px 0;
                        background: var(--vscode-input-background);
                        border-radius: 3px;
                    }
                    .add-model {
                        display: flex;
                        gap: 8px;
                    }
                    .add-model input {
                        flex: 1;
                    }
                    .remove-btn {
                        padding: 2px 6px;
                        font-size: 12px;
                        background: var(--vscode-errorForeground);
                    }
                    .add-btn {
                        padding: 6px 12px;
                    }
                </style>
            </head>
            <body>
                <div class="form-group">
                    <label>API Endpoint:</label>
                    <input type="text" id="endpoint" value="${settings.endpoint}" placeholder="输入API endpoint">
                </div>
                <div class="form-group">
                    <label>API Key:</label>
                    <input type="password" id="apiKey" value="${settings.apiKey}" placeholder="输入API key">
                </div>
                <div class="form-group">
                    <label>可用模型:</label>
                    <div class="models-container">
                        <div id="modelsList" class="models-list">
                            ${settings.models.map(model => `
                                <div class="model-item">
                                    <span>${model}</span>
                                    <button onclick="removeModel('${model}')" class="remove-btn">删除</button>
                                </div>
                            `).join('')}
                        </div>
                        <div class="add-model">
                            <input type="text" id="newModel" placeholder="输入模型名称">
                            <button onclick="addModel()" class="add-btn">添加</button>
                        </div>
                    </div>
                </div>
                <button onclick="saveSettings()">保存设置</button>

                <script>
                    const vscode = acquireVsCodeApi();
                    let models = ${JSON.stringify(settings.models)};

                    function addModel() {
                        const input = document.getElementById('newModel');
                        const model = input.value.trim();
                        if (!model) return;
                        
                        if (!models.includes(model)) {
                            models.push(model);
                            updateModelsList();
                        }
                        input.value = '';
                    }

                    function removeModel(model) {
                        models = models.filter(m => m !== model);
                        updateModelsList();
                    }

                    function updateModelsList() {
                        const list = document.getElementById('modelsList');
                        list.innerHTML = models.map(model => \`
                            <div class="model-item">
                                <span>\${model}</span>
                                <button onclick="removeModel('\${model}')" class="remove-btn">删除</button>
                            </div>
                        \`).join('');
                    }

                    function saveSettings() {
                        const endpoint = document.getElementById('endpoint').value.trim();
                        const apiKey = document.getElementById('apiKey').value.trim();
                        
                        vscode.postMessage({
                            command: 'saveSettings',
                            settings: { endpoint, apiKey, models }
                        });
                    }

                    document.getElementById('newModel').addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            addModel();
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}

export function activate(context: vscode.ExtensionContext) {
    const settingsManager = new SettingsManager(context);
    
    const chatViewProvider = new ChatViewProvider(context.extensionUri, settingsManager);
    const settingsViewProvider = new SettingsViewProvider(context.extensionUri, settingsManager);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('aiChatView', chatViewProvider),
        vscode.window.registerWebviewViewProvider('aiSettingsView', settingsViewProvider),
        
        vscode.commands.registerCommand('cloudflare-ai-gateway.startChat', () => {
            vscode.commands.executeCommand('workbench.view.ai-chat');
        }),
        
        vscode.commands.registerCommand('cloudflare-ai-gateway.openSettings', () => {
            vscode.commands.executeCommand('workbench.view.ai-chat');
        })
    );
}

export function deactivate() {}
