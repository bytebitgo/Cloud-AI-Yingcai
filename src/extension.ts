import * as vscode from 'vscode';
import axios from 'axios';

interface Configuration {
    name: string;
    endpoint: string;
    apiKey: string;
    models: Array<{name: string; selected: boolean}>;
}

class SettingsManager {
    constructor(private readonly _context: vscode.ExtensionContext) {}

    public getCurrentConfig(): string {
        const config = vscode.workspace.getConfiguration('cloudflare-ai-gateway');
        return config.get('currentConfig') || '';
    }

    public getConfigurations(): { [key: string]: Configuration } {
        const config = vscode.workspace.getConfiguration('cloudflare-ai-gateway');
        return config.get('configurations') || {};
    }

    public getSettings(): Configuration {
        const currentConfig = this.getCurrentConfig();
        const configurations = this.getConfigurations();
        
        if (currentConfig && configurations[currentConfig]) {
            return configurations[currentConfig];
        }

        // 如果没有当前配置，保持现有配置中的模型设置
        const existingConfigs = this.getConfigurations();
        const defaultModels = Object.values(existingConfigs)[0]?.models || [
            { name: 'gpt-3.5-turbo', selected: true },
            { name: 'gpt-4', selected: false }
        ];
        
        return {
            name: '',
            endpoint: '',
            apiKey: '',
            models: defaultModels
        };
    }

    public async saveSettings(settings: Configuration) {
        const config = vscode.workspace.getConfiguration('cloudflare-ai-gateway');
        const configurations = this.getConfigurations();
        
        configurations[settings.name] = settings;
        
        try {
            await config.update('configurations', configurations, true);
            await config.update('currentConfig', settings.name, true);
            
            // 验证保存是否成功
            const savedConfigs = this.getConfigurations();
            const savedConfig = savedConfigs[settings.name];
            if (!savedConfig || JSON.stringify(savedConfig) !== JSON.stringify(settings)) {
                throw new Error('设置保存验证失败');
            }
            
            return true;
        } catch (error) {
            console.error('保存设置失败:', error);
            throw new Error('保存设置失败: ' + (error instanceof Error ? error.message : '未知错误'));
        }
    }

    public async deleteConfig(name: string) {
        const config = vscode.workspace.getConfiguration('cloudflare-ai-gateway');
        const configurations = this.getConfigurations();
        
        // 创建一个新的配置对象，而不是直接修改现有对象
        const newConfigurations = { ...configurations };
        delete newConfigurations[name];
        
        try {
            // 先更新当前配置（如果需要）
            if (this.getCurrentConfig() === name) {
                await config.update('currentConfig', '', true);
            }
            
            // 然后更新配置列表
            await config.update('configurations', newConfigurations, true);
            
            // 验证删除是否成功
            const updatedConfigs = this.getConfigurations();
            if (updatedConfigs[name]) {
                throw new Error('配置删除验证失败');
            }
            
            return true;
        } catch (error) {
            console.error('删除配置失败:', error);
            throw new Error('删除配置失败: ' + (error instanceof Error ? error.message : '未知错误'));
        }
    }

    public getSelectedModel(): string {
        const settings = this.getSettings();
        const selectedModel = settings.models.find(m => m.selected);
        return selectedModel ? selectedModel.name : settings.models[0].name;
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
                        await this._handleMessage(message.text, message.configName);
                        break;
                }
            }
        );
    }

    private async _handleMessage(text: string, configName?: string) {
        if (!this._view) {
            console.error('Webview is not initialized');
            return;
        }

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

        // 获取设置，如果指定了配置名称，则使用该配置
        let settings: Configuration;
        if (configName) {
            const configurations = this._settingsManager.getConfigurations();
            if (configurations[configName]) {
                settings = configurations[configName];
            } else {
                this._showError(`找不到配置: ${configName}`);
                return;
            }
        } else {
            settings = this._settingsManager.getSettings();
        }

        if (!settings.endpoint || !settings.apiKey) {
            this._showError('请先在设置面板配置endpoint和apiKey');
            return;
        }

        try {
            // 获取选中的模型
            const selectedModel = settings.models.find(m => m.selected)?.name || settings.models[0].name;
            
            // 记录请求信息
            console.log('发送请求到:', settings.endpoint);
            console.log('使用配置:', settings.name);
            console.log('请求参数:', {
                model: selectedModel,
                messages: this._messages,
                temperature: 0.7,
                max_tokens: 2048,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
                stream: true
            });

            const response = await axios.post(settings.endpoint, {
                model: selectedModel,
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

            let aiMessage = {
                role: 'assistant',
                content: ''
            };
            this._messages.push(aiMessage);

            // 移除加载状态消息
            this._view.webview.postMessage({
                type: 'removeTemporary'
            });

            // 显示初始空消息
            this._view.webview.postMessage({
                type: 'addMessage',
                message: aiMessage,
                temporary: false
            });

            // 处理流式数据
            response.data.on('data', (chunk: Buffer) => {
                if (!this._view) return;
                
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (line.trim() === '') continue;
                    if (line.trim() === 'data: [DONE]') continue;
                    
                    try {
                        const data = JSON.parse(line.replace('data: ', ''));
                        if (data.choices && data.choices[0]?.delta?.content) {
                            aiMessage.content += data.choices[0].delta.content;
                            this._view.webview.postMessage({
                                type: 'updateMessage',
                                message: aiMessage
                            });
                        }
                    } catch (error) {
                        console.error('解析响应数据失败:', error);
                    }
                }
            });

            return new Promise<void>((resolve, reject) => {
                if (!this._view) {
                    reject(new Error('Webview is not initialized'));
                    return;
                }

                response.data.on('end', () => {
                    resolve();
                });
                
                response.data.on('error', (error: Error) => {
                    this._handleError(error);
                    reject(error);
                });
            });

        } catch (error: any) {
            this._handleError(error);
            throw error;
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
        if (!this._view) return;

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
        
        vscode.window.showErrorMessage(message);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const configurations = this._settingsManager.getConfigurations();
        const currentConfig = this._settingsManager.getCurrentConfig();
        
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
                        flex-direction: column;
                        gap: 8px;
                    }
                    .input-row {
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
                    #configSelect {
                        padding: 6px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        min-width: 120px;
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
                    .config-info {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 5px;
                    }
                </style>
            </head>
            <body>
                <div class="chat-container">
                    <div class="messages" id="messages"></div>
                    <div class="input-container">
                        <div class="config-info">
                            选择要使用的配置：
                        </div>
                        <div class="input-row">
                            <select id="configSelect">
                                ${Object.entries(configurations).map(([name]) => `
                                    <option value="${name}" ${name === currentConfig ? 'selected' : ''}>${name}</option>
                                `).join('')}
                            </select>
                            <input type="text" id="messageInput" placeholder="输入消息...">
                            <button onclick="sendMessage()" id="sendButton">发送</button>
                        </div>
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

                        const configSelect = document.getElementById('configSelect');
                        const selectedConfig = configSelect.value;
                        
                        isProcessing = true;
                        const sendButton = document.getElementById('sendButton');
                        sendButton.disabled = true;
                        sendButton.textContent = '发送中...';

                        vscode.postMessage({
                            command: 'sendMessage',
                            text: text,
                            configName: selectedConfig
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
                            .replace(/\`\`\`(\\w*\\n)?([\\s\\S]*?)\\n?\`\`\`/g, '<pre><code>$2</code><button class="copy-button" onclick="copyCode(this)">复制</button></pre>')
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
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getSettingsHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async (message: any) => {
                switch (message.command) {
                    case 'saveSettings':
                        try {
                            await this._settingsManager.saveSettings(message.settings);
                            if (this._view) {
                                this._view.webview.html = this._getSettingsHtml(this._view.webview);
                                vscode.window.showInformationMessage('设置已保存');
                            }
                        } catch (error) {
                            vscode.window.showErrorMessage(error instanceof Error ? error.message : '保存设置失败');
                        }
                        break;
                    case 'showDeleteConfirm':
                        const answer = await vscode.window.showWarningMessage(
                            `确定要删除配置 "${message.name}" 吗？`,
                            { modal: true },
                            '确定'
                        );
                        if (answer === '确定') {
                            try {
                                await this._settingsManager.deleteConfig(message.name);
                                if (this._view) {
                                    this._view.webview.html = this._getSettingsHtml(this._view.webview);
                                    vscode.window.showInformationMessage('配置已删除');
                                }
                            } catch (error) {
                                vscode.window.showErrorMessage(error instanceof Error ? error.message : '删除配置失败');
                            }
                        }
                        break;
                }
            }
        );
    }

    private _getSettingsHtml(webview: vscode.Webview): string {
        const settings = this._settingsManager.getSettings();
        const configurations = this._settingsManager.getConfigurations();
        const currentConfig = this._settingsManager.getCurrentConfig();
        
        return `
            <!DOCTYPE html>
            <html lang="zh">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        padding: 10px;
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
                    input[type="text"],
                    input[type="password"] {
                        width: 100%;
                        padding: 6px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        margin-bottom: 10px;
                    }
                    button {
                        padding: 6px 12px;
                        border: none;
                        border-radius: 4px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        cursor: pointer;
                        margin-right: 8px;
                        margin-bottom: 8px;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    button.danger {
                        background: var(--vscode-errorForeground);
                    }
                    button.icon {
                        padding: 4px 8px;
                        font-size: 12px;
                    }
                    .model-select {
                        margin-bottom: 5px;
                        display: flex;
                        align-items: center;
                    }
                    .model-select input[type="radio"] {
                        margin-right: 5px;
                    }
                    .card {
                        padding: 10px;
                        margin-bottom: 10px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                    }
                    .config-list {
                        margin-bottom: 20px;
                    }
                    .config-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 10px;
                    }
                    .config-dropdown {
                        position: relative;
                        width: 100%;
                    }
                    .dropdown-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 6px 10px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        cursor: pointer;
                    }
                    .dropdown-content {
                        display: none;
                        position: absolute;
                        width: 100%;
                        max-height: 200px;
                        overflow-y: auto;
                        z-index: 1;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        background: var(--vscode-input-background);
                        margin-top: 2px;
                    }
                    .dropdown-content.show {
                        display: block;
                    }
                    .dropdown-item {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 8px 10px;
                        cursor: pointer;
                    }
                    .dropdown-item:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .dropdown-item-actions {
                        display: flex;
                        gap: 5px;
                    }
                    .dropdown-item-name {
                        flex: 1;
                    }
                </style>
            </head>
            <body>
                <div class="config-list">
                    <div class="config-header">
                        <h3>已保存的配置</h3>
                    </div>
                    <div class="config-dropdown">
                        <div class="dropdown-header" onclick="toggleDropdown()">
                            <span id="selected-config">${currentConfig || '-- 选择配置 --'}</span>
                            <span>▼</span>
                        </div>
                        <div id="dropdown-content" class="dropdown-content">
                            <div class="dropdown-item" onclick="selectConfig('')">
                                <div class="dropdown-item-name">-- 新建配置 --</div>
                            </div>
                            ${Object.entries(configurations).map(([name]) => `
                                <div class="dropdown-item" onclick="selectConfig('${name}')">
                                    <div class="dropdown-item-name">${name}</div>
                                    <div class="dropdown-item-actions">
                                        <button class="icon" onclick="event.stopPropagation(); editConfig('${name}')">编辑</button>
                                        <button class="icon danger" onclick="event.stopPropagation(); deleteConfig('${name}')">删除</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <div class="form-group">
                        <label for="name">配置名称</label>
                        <input type="text" id="name" value="${settings.name || ''}">
                    </div>
                    <div class="form-group">
                        <label for="endpoint">API 端点</label>
                        <input type="text" id="endpoint" value="${settings.endpoint || ''}">
                    </div>
                    <div class="form-group">
                        <label for="apiKey">API 密钥</label>
                        <input type="password" id="apiKey" value="${settings.apiKey || ''}">
                    </div>
                    <div class="form-group">
                        <label>模型选择</label>
                        <div id="modelsList">
                            ${(settings.models || []).map(model => `
                                <div class="model-select">
                                    <input type="radio" 
                                        name="model" 
                                        value="${model.name}"
                                        id="${model.name}"
                                        ${model.selected ? 'checked' : ''}>
                                    <label for="${model.name}">${model.name}</label>
                                </div>
                            `).join('')}
                        </div>
                        <div style="margin-top: 10px;">
                            <input type="text" id="newModelName" placeholder="输入新模型名称">
                            <button onclick="addNewModel()" style="margin-top: 5px;">添加新模型</button>
                        </div>
                    </div>
                    <button onclick="saveSettings()">保存设置</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function toggleDropdown() {
                        document.getElementById('dropdown-content').classList.toggle('show');
                    }
                    
                    // 点击下拉菜单外部时关闭下拉菜单
                    window.onclick = function(event) {
                        if (!event.target.matches('.dropdown-header') && !event.target.matches('.dropdown-header *')) {
                            const dropdowns = document.getElementsByClassName('dropdown-content');
                            for (let i = 0; i < dropdowns.length; i++) {
                                const openDropdown = dropdowns[i];
                                if (openDropdown.classList.contains('show')) {
                                    openDropdown.classList.remove('show');
                                }
                            }
                        }
                    }
                    
                    function selectConfig(name) {
                        document.getElementById('dropdown-content').classList.remove('show');
                        document.getElementById('selected-config').textContent = name || '-- 选择配置 --';
                        
                        if (name) {
                            editConfig(name);
                        } else {
                            // 清空表单
                            document.getElementById('name').value = '';
                            document.getElementById('endpoint').value = '';
                            document.getElementById('apiKey').value = '';
                            
                            // 重置模型选择
                            const modelInputs = document.getElementsByName('model');
                            if (modelInputs.length > 0) {
                                modelInputs[0].checked = true;
                            }
                        }
                    }

                    function saveSettings() {
                        const settings = {
                            name: document.getElementById('name').value,
                            endpoint: document.getElementById('endpoint').value,
                            apiKey: document.getElementById('apiKey').value,
                            models: Array.from(document.getElementsByName('model')).map(radio => ({
                                name: radio.value,
                                selected: radio.checked
                            }))
                        };
                        
                        if (!settings.name) {
                            vscode.postMessage({
                                command: 'showError',
                                text: '请填写配置名称'
                            });
                            return;
                        }

                        vscode.postMessage({
                            command: 'saveSettings',
                            settings: settings
                        });
                    }

                    function editConfig(name) {
                        if (!name) return;

                        const configs = ${JSON.stringify(configurations)};
                        const config = configs[name];
                        
                        if (config) {
                            document.getElementById('name').value = config.name;
                            document.getElementById('endpoint').value = config.endpoint;
                            document.getElementById('apiKey').value = config.apiKey;
                            
                            // 更新模型选择
                            const modelInputs = document.getElementsByName('model');
                            config.models.forEach(configModel => {
                                for(let input of modelInputs) {
                                    if(input.value === configModel.name) {
                                        input.checked = configModel.selected;
                                    }
                                }
                            });
                        }
                    }

                    function deleteConfig(name) {
                        if (!name) return;
                        
                        vscode.postMessage({
                            command: 'showDeleteConfirm',
                            name: name
                        });
                    }

                    function addNewModel() {
                        const newModelName = document.getElementById('newModelName').value.trim();
                        if (!newModelName) {
                            vscode.postMessage({
                                command: 'showError',
                                text: '请输入模型名称'
                            });
                            return;
                        }

                        const modelsList = document.getElementById('modelsList');
                        const newModelHtml = \`
                            <div class="model-select">
                                <input type="radio" 
                                    name="model" 
                                    value="\${newModelName}"
                                    id="\${newModelName}">
                                <label for="\${newModelName}">\${newModelName}</label>
                            </div>
                        \`;
                        modelsList.insertAdjacentHTML('beforeend', newModelHtml);
                        document.getElementById('newModelName').value = '';
                    }
                </script>
            </body>
            </html>
        `;
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const settingsManager = new SettingsManager(context);
    
    // 确保配置项存在
    const config = vscode.workspace.getConfiguration('cloudflare-ai-gateway');
    if (!config.has('configurations')) {
        await config.update('configurations', {}, true);
    }
    if (!config.has('currentConfig')) {
        await config.update('currentConfig', '', true);
    }
    
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
