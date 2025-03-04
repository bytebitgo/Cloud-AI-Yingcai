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
        const config = vscode.workspace.getConfiguration('cloud-ai-yingcai');
        return config.get('currentConfig') || '';
    }

    public getConfigurations(): { [key: string]: Configuration } {
        const config = vscode.workspace.getConfiguration('cloud-ai-yingcai');
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

    // 验证端点URL
    private validateEndpoint(endpoint: string): { isValid: boolean; error?: string } {
        if (!endpoint) {
            return { isValid: false, error: '请输入API端点URL' };
        }

        try {
            const url = new URL(endpoint);
            
            // 检查协议
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return { isValid: false, error: '仅支持http和https协议' };
            }

            // 检查危险字符
            const dangerousChars = /[<>'"\\%\`]/g;
            if (dangerousChars.test(endpoint)) {
                return { isValid: false, error: 'URL包含非法字符' };
            }

            // 检查URL长度
            if (endpoint.length > 2048) {
                return { isValid: false, error: 'URL长度超过限制' };
            }

            // 检查域名格式
            const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
            if (!domainRegex.test(url.hostname)) {
                return { isValid: false, error: '无效的域名格式' };
            }

            return { isValid: true };
        } catch (e) {
            return { isValid: false, error: '无效的URL格式' };
        }
    }

    public async saveSettings(settings: Configuration) {
        // 验证配置名称
        if (!settings.name || settings.name.trim().length === 0) {
            throw new Error('配置名称不能为空');
        }

        // 验证端点URL
        const endpointValidation = this.validateEndpoint(settings.endpoint);
        if (!endpointValidation.isValid) {
            throw new Error(`API端点无效: ${endpointValidation.error}`);
        }

        // 验证API密钥
        if (!settings.apiKey || settings.apiKey.trim().length === 0) {
            throw new Error('API密钥不能为空');
        }

        // 验证模型列表
        if (!settings.models || settings.models.length === 0) {
            throw new Error('至少需要一个模型');
        }

        const config = vscode.workspace.getConfiguration('cloud-ai-yingcai');
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
        const config = vscode.workspace.getConfiguration('cloud-ai-yingcai');
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

    // 导出配置
    public exportConfigurations(): string {
        const configurations = this.getConfigurations();
        const currentConfig = this.getCurrentConfig();
        
        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            configurations: configurations,
            currentConfig: currentConfig
        };
        
        return JSON.stringify(exportData, null, 2);
    }

    // 导入配置
    public async importConfigurations(jsonString: string): Promise<boolean> {
        try {
            const importData = JSON.parse(jsonString);
            
            // 验证导入数据的格式
            if (!importData.version || !importData.configurations || typeof importData.configurations !== 'object') {
                throw new Error('无效的配置文件格式');
            }

            // 验证每个配置
            for (const [name, config] of Object.entries(importData.configurations)) {
                if (!this._validateConfiguration(config)) {
                    throw new Error(`配置 "${name}" 格式无效`);
                }
            }

            const config = vscode.workspace.getConfiguration('cloud-ai-yingcai');
            
            // 保存配置
            await config.update('configurations', importData.configurations, true);
            
            // 如果导入数据包含当前配置，且该配置存在，则更新当前配置
            if (importData.currentConfig && importData.configurations[importData.currentConfig]) {
                await config.update('currentConfig', importData.currentConfig, true);
            }
            
            return true;
        } catch (error) {
            console.error('导入配置失败:', error);
            throw new Error('导入配置失败: ' + (error instanceof Error ? error.message : '未知错误'));
        }
    }

    // 验证配置格式
    private _validateConfiguration(config: any): boolean {
        if (!config || typeof config !== 'object') {
            return false;
        }

        // 检查必需字段
        if (!config.name || typeof config.name !== 'string') {
            return false;
        }

        if (!config.endpoint || typeof config.endpoint !== 'string') {
            return false;
        }

        if (!config.apiKey || typeof config.apiKey !== 'string') {
            return false;
        }

        // 检查模型列表
        if (!Array.isArray(config.models) || config.models.length === 0) {
            return false;
        }

        // 验证每个模型
        for (const model of config.models) {
            if (!model.name || typeof model.name !== 'string' || 
                typeof model.selected !== 'boolean') {
                return false;
            }
        }

        return true;
    }
}

class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _messages: Array<{role: string, content: string}> = [];
    private _lastSelectedConfig: string = '';
    private _lastSelectedModel: string = '';
    private _stateInitialized: boolean = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _settingsManager: SettingsManager
    ) {
        this._initializeState();
    }

    private _initializeState() {
        // 初始化最后选择的配置为当前配置
        this._lastSelectedConfig = this._settingsManager.getCurrentConfig();
        
        // 初始化最后选择的模型为当前配置的第一个模型
        const settings = this._settingsManager.getSettings();
        if (settings.models && settings.models.length > 0) {
            const selectedModel = settings.models.find(m => m.selected);
            this._lastSelectedModel = selectedModel ? selectedModel.name : settings.models[0].name;
        }
        
        this._stateInitialized = true;
        console.log('状态初始化完成:', {
            config: this._lastSelectedConfig,
            model: this._lastSelectedModel
        });
    }

    // 添加清空上下文的方法
    private _clearContext() {
        this._messages = [];
        if (this._view) {
            this._view.webview.postMessage({
                type: 'clearMessages'
            });
        }
    }

    // 添加验证JSON字符串的方法
    private _isValidJSON(str: string): boolean {
        try {
            // 检查基本的JSON结构
            if (!str.startsWith('{') || !str.endsWith('}')) {
                return false;
            }
            
            // 尝试解析
            JSON.parse(str);
            return true;
        } catch {
            return false;
        }
    }

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

        // 确保状态已初始化
        if (!this._stateInitialized) {
            this._initializeState();
        }

        // 生成HTML并设置到webview
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        console.log('Webview已创建，使用配置:', this._lastSelectedConfig, '模型:', this._lastSelectedModel);

        // 添加配置变更监听器
        const configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('cloud-ai-yingcai.configurations')) {
                console.log('检测到配置变更，刷新Webview');
                if (this._view) {
                    this._view.webview.html = this._getHtmlForWebview(this._view.webview);
                    // 同步状态
                    this._view.webview.postMessage({
                        type: 'syncState',
                        config: this._lastSelectedConfig,
                        model: this._lastSelectedModel
                    });
                }
            }
        });
        
        // 确保在webview处置时清理监听器
        webviewView.onDidDispose(() => {
            configChangeListener.dispose();
        });

        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        // 保存用户选择的配置和模型
                        this._lastSelectedConfig = message.configName;
                        this._lastSelectedModel = message.modelName;
                        console.log('发送消息，更新选择:', this._lastSelectedConfig, this._lastSelectedModel);
                        await this._handleMessage(message.text, message.configName, message.modelName);
                        break;
                    case 'configChanged':
                        // 当用户切换配置时，保存选择
                        this._lastSelectedConfig = message.configName;
                        console.log('配置已更改:', this._lastSelectedConfig);
                        break;
                    case 'modelChanged':
                        // 当用户切换模型时，保存选择
                        this._lastSelectedModel = message.modelName;
                        console.log('模型已更改:', this._lastSelectedModel);
                        break;
                    case 'webviewLoaded':
                        // Webview加载完成后，确保UI状态与后端状态一致
                        console.log('Webview加载完成，同步状态');
                        webviewView.webview.postMessage({
                            type: 'syncState',
                            config: this._lastSelectedConfig,
                            model: this._lastSelectedModel
                        });
                        break;
                    case 'reloadConfigurations':
                        // 当前端检测到配置不存在时，重新加载配置
                        console.log('收到重新加载配置请求');
                        // 重新获取最新配置
                        const configurations = this._settingsManager.getConfigurations();
                        // 如果当前选择的配置不存在，重置为空或第一个可用配置
                        if (this._lastSelectedConfig && !configurations[this._lastSelectedConfig]) {
                            const configNames = Object.keys(configurations);
                            this._lastSelectedConfig = configNames.length > 0 ? configNames[0] : '';
                            console.log('重置当前配置为:', this._lastSelectedConfig);
                        }
                        // 重新生成HTML
                        if (this._view) {
                            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
                            // 同步状态
                            this._view.webview.postMessage({
                                type: 'syncState',
                                config: this._lastSelectedConfig,
                                model: this._lastSelectedModel
                            });
                        }
                        break;
                    case 'clearContext':
                        this._clearContext();
                        break;
                    case 'exportConfig':
                        try {
                            const configJson = this._settingsManager.exportConfigurations();
                            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                            if (!workspaceFolder) {
                                throw new Error('未找到工作区文件夹');
                            }
                            
                            const fileName = `cloud-ai-yingcai-config-${new Date().toISOString().split('T')[0]}.json`;
                            const filePath = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
                            
                            await vscode.workspace.fs.writeFile(filePath, Buffer.from(configJson, 'utf8'));
                            vscode.window.showInformationMessage(`配置已导出到: ${fileName}`);
                        } catch (error) {
                            vscode.window.showErrorMessage('导出配置失败: ' + (error instanceof Error ? error.message : '未知错误'));
                        }
                        break;
                    case 'importConfig':
                        try {
                            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                            if (!workspaceFolder) {
                                throw new Error('未找到工作区文件夹');
                            }

                            const fileUri = await vscode.window.showOpenDialog({
                                canSelectFiles: true,
                                canSelectFolders: false,
                                canSelectMany: false,
                                filters: {
                                    'JSON Files': ['json']
                                }
                            });

                            if (fileUri && fileUri[0]) {
                                const fileContent = await vscode.workspace.fs.readFile(fileUri[0]);
                                const jsonString = Buffer.from(fileContent).toString('utf8');
                                
                                await this._settingsManager.importConfigurations(jsonString);
                                vscode.window.showInformationMessage('配置导入成功');
                                
                                // 刷新设置界面
                                if (this._view) {
                                    this._view.webview.html = this._getHtmlForWebview(this._view.webview);
                                }
                            }
                        } catch (error) {
                            vscode.window.showErrorMessage('导入配置失败: ' + (error instanceof Error ? error.message : '未知错误'));
                        }
                        break;
                }
            }
        );
    }

    private async _handleMessage(text: string, configName?: string, modelName?: string) {
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
            // 获取选中的模型，如果指定了模型名称，则使用该模型
            let selectedModel: string;
            if (modelName) {
                selectedModel = modelName;
            } else {
                selectedModel = settings.models.find(m => m.selected)?.name || settings.models[0].name;
            }
            
            // 记录请求信息
            console.log('发送请求到:', settings.endpoint);
            console.log('使用配置:', settings.name);
            console.log('使用模型:', selectedModel);
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
                        // 确保行以 "data: " 开头
                        if (!line.trim().startsWith('data: ')) {
                            console.warn('跳过无效的数据行:', line);
                            continue;
                        }

                        // 提取JSON部分
                        const jsonStr = line.replace('data: ', '').trim();
                        
                        // 验证JSON字符串的完整性
                        if (!this._isValidJSON(jsonStr)) {
                            console.warn('检测到不完整的JSON:', jsonStr);
                            continue;
                        }

                        const data = JSON.parse(jsonStr);
                        if (data.choices && data.choices[0]?.delta?.content) {
                            aiMessage.content += data.choices[0].delta.content;
                            this._view.webview.postMessage({
                                type: 'updateMessage',
                                message: aiMessage
                            });
                        }
                    } catch (error) {
                        console.error('解析响应数据失败:', error);
                        if (error instanceof Error) {
                            console.error('错误详情:', error.message);
                            console.error('问题数据:', line);
                        }
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

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const configurations = this._settingsManager.getConfigurations();
        const currentConfig = this._lastSelectedConfig || this._settingsManager.getCurrentConfig();
        
        // 获取当前配置的设置
        let currentSettings: Configuration;
        if (currentConfig && configurations[currentConfig]) {
            currentSettings = configurations[currentConfig];
        } else {
            currentSettings = this._settingsManager.getSettings();
        }
        
        // 确定要选中的模型
        const selectedModel = this._lastSelectedModel || 
                             (currentSettings.models && currentSettings.models.length > 0 ? 
                              currentSettings.models[0].name : '');
        
        // 每次生成HTML时重新获取最新的配置列表
        console.log('重新生成HTML，当前配置列表:', Object.keys(configurations));
        
        // 在设置表单后添加导出和导入按钮
        const settingsHtml = `
            <div class="settings-container">
                <form id="settingsForm">
                    <div class="form-group">
                        <label for="name">配置名称</label>
                        <input type="text" id="name" value="${currentSettings.name || ''}">
                        <div id="nameError" class="error-message">请输入有效的配置名称</div>
                    </div>
                    <div class="form-group">
                        <label for="endpoint">API 端点</label>
                        <input type="text" id="endpoint" value="${currentSettings.endpoint || ''}" onchange="validateEndpoint(this)">
                        <div id="endpointError" class="error-message">请输入有效的API端点URL</div>
                    </div>
                    <div class="form-group">
                        <label for="apiKey">API 密钥</label>
                        <input type="password" id="apiKey" value="${currentSettings.apiKey || ''}">
                    </div>
                    <div class="form-group">
                        <label>模型选择</label>
                        <div id="modelsList">
                            ${(currentSettings.models || []).map((model: {name: string; selected: boolean}) => `
                                <div class="model-select">
                                    <input type="radio" 
                                        name="model" 
                                        value="${model.name}"
                                        id="${model.name}"
                                        ${model.selected ? 'checked' : ''}>
                                    <label for="${model.name}">${model.name}</label>
                                    <button class="icon danger" onclick="deleteModel('${model.name}')">删除</button>
                                </div>
                            `).join('')}
                        </div>
                        <div style="margin-top: 10px; display: flex; gap: 8px;">
                            <input type="text" id="newModelName" placeholder="输入新模型名称" style="flex: 1;">
                            <button onclick="addNewModel()">添加模型</button>
                        </div>
                    </div>
                    <button onclick="saveSettings()">保存设置</button>
                </form>
                <div class="settings-actions">
                    <button id="exportConfig" class="action-button">
                        <i class="codicon codicon-export"></i> 导出配置
                    </button>
                    <button id="importConfig" class="action-button">
                        <i class="codicon codicon-import"></i> 导入配置
                    </button>
                </div>
            </div>
        `;

        // 添加导出和导入按钮的样式
        const styles = `
            .settings-actions {
                margin-top: 20px;
                display: flex;
                gap: 10px;
                justify-content: flex-end;
            }
            .action-button {
                display: flex;
                align-items: center;
                gap: 5px;
                padding: 8px 16px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            .action-button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        `;

        // 添加导出和导入功能的JavaScript代码
        const script = `
            // 导出配置
            document.getElementById('exportConfig').addEventListener('click', () => {
                vscode.postMessage({
                    type: 'exportConfig'
                });
            });

            // 导入配置
            document.getElementById('importConfig').addEventListener('click', () => {
                vscode.postMessage({
                    type: 'importConfig'
                });
            });
        `;

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
                        align-items: center;
                    }
                    .select-container {
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
                    select {
                        padding: 6px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                    }
                    #configSelect {
                        min-width: 120px;
                    }
                    #modelSelect {
                        min-width: 150px;
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
                    .select-label {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        margin-right: 5px;
                        display: flex;
                        align-items: center;
                    }
                    .clear-button {
                        padding: 6px 10px;
                        border: none;
                        border-radius: 4px;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        cursor: pointer;
                        font-size: 16px;
                        line-height: 1;
                    }
                    .clear-button:hover {
                        background: var(--vscode-button-secondaryHoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="chat-container">
                    <div class="messages" id="messages"></div>
                    <div class="input-container">
                        <div class="select-container">
                            <div>
                                <div class="select-label">配置:</div>
                                <select id="configSelect" onchange="handleConfigChange(this.value)">
                                    ${Object.entries(configurations).map(([name]) => `
                                        <option value="${name}" ${name === currentConfig ? 'selected' : ''}>${name}</option>
                                    `).join('')}
                                </select>
                            </div>
                            <div>
                                <div class="select-label">模型:</div>
                                <select id="modelSelect" onchange="handleModelChange(this.value)">
                                    ${(currentSettings.models || []).map(model => `
                                        <option value="${model.name}" ${model.name === selectedModel ? 'selected' : ''}>${model.name}</option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="input-row">
                            <button class="clear-button" onclick="clearContext()" title="开始新对话">+</button>
                            <input type="text" id="messageInput" placeholder="输入消息...">
                            <button onclick="sendMessage()" id="sendButton">发送</button>
                        </div>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    let isProcessing = false;
                    
                    // 存储所有配置信息，用于动态更新模型选择
                    const allConfigurations = ${JSON.stringify(configurations)};
                    
                    // 当前选中的配置和模型
                    let currentConfigName = "${currentConfig}";
                    let currentModelName = "${selectedModel}";
                    
                    // 页面加载完成后通知扩展
                    document.addEventListener('DOMContentLoaded', () => {
                        vscode.postMessage({
                            command: 'webviewLoaded'
                        });
                    });
                    
                    // 监听来自扩展的消息
                    window.addEventListener('message', event => {
                        const message = event.data;
                        
                        if (message.type === 'addMessage') {
                            appendMessage(message.message, message.temporary);
                        } else if (message.type === 'removeTemporary') {
                            removeTemporaryMessages();
                        } else if (message.type === 'updateMessage') {
                            updateMessage(message.message);
                        } else if (message.type === 'clearMessages') {
                            document.getElementById('messages').innerHTML = '';
                        } else if (message.type === 'syncState') {
                            // 同步状态
                            if (message.config && allConfigurations[message.config]) {
                                currentConfigName = message.config;
                                document.getElementById('configSelect').value = message.config;
                                
                                // 更新模型列表
                                updateModelSelect(message.config);
                                
                                // 如果有指定模型，则选中该模型
                                if (message.model) {
                                    currentModelName = message.model;
                                    const modelSelect = document.getElementById('modelSelect');
                                    // 检查该模型是否在列表中
                                    const modelExists = Array.from(modelSelect.options).some(option => option.value === message.model);
                                    if (modelExists) {
                                        modelSelect.value = message.model;
                                    }
                                }
                            } else {
                                // 如果配置不存在，通知扩展重新加载配置
                                console.log('配置不存在，请求重新加载配置');
                                vscode.postMessage({
                                    command: 'reloadConfigurations'
                                });
                            }
                        }
                        
                        if (message.type === 'addMessage' && message.message.role === 'assistant' && !message.temporary) {
                            isProcessing = false;
                            const sendButton = document.getElementById('sendButton');
                            sendButton.disabled = false;
                            sendButton.textContent = '发送';
                        }
                    });
                    
                    function handleConfigChange(configName) {
                        // 检查配置是否存在
                        if (!allConfigurations[configName]) {
                            console.log('配置不存在，请求重新加载配置');
                            vscode.postMessage({
                                command: 'reloadConfigurations'
                            });
                            return;
                        }
                        
                        currentConfigName = configName;
                        updateModelSelect(configName);
                        
                        // 通知扩展配置已更改
                        vscode.postMessage({
                            command: 'configChanged',
                            configName: configName
                        });
                    }
                    
                    function handleModelChange(modelName) {
                        currentModelName = modelName;
                        
                        // 通知扩展模型已更改
                        vscode.postMessage({
                            command: 'modelChanged',
                            modelName: modelName
                        });
                    }
                    
                    function updateModelSelect(configName) {
                        const config = allConfigurations[configName];
                        if (!config || !config.models) {
                            console.log('配置或模型不存在，请求重新加载配置');
                            vscode.postMessage({
                                command: 'reloadConfigurations'
                            });
                            return;
                        }
                        
                        const modelSelect = document.getElementById('modelSelect');
                        modelSelect.innerHTML = '';
                        
                        // 记住之前选择的模型名称
                        const previousModelName = currentModelName;
                        let modelFound = false;
                        
                        config.models.forEach((model, index) => {
                            const option = document.createElement('option');
                            option.value = model.name;
                            option.textContent = model.name;
                            
                            // 如果之前选择的模型在新配置中存在，则选中它
                            if (model.name === previousModelName) {
                                option.selected = true;
                                modelFound = true;
                            }
                            
                            modelSelect.appendChild(option);
                        });
                        
                        // 如果之前选择的模型在新配置中不存在，则选中第一个
                        if (!modelFound && config.models.length > 0) {
                            modelSelect.value = config.models[0].name;
                            currentModelName = config.models[0].name;
                            
                            // 通知扩展模型已更改
                            vscode.postMessage({
                                command: 'modelChanged',
                                modelName: currentModelName
                            });
                        }
                    }
                    
                    document.getElementById('messageInput').addEventListener('keypress', (e) => {
                        if (e.key === 'Enter' && !isProcessing) {
                            sendMessage();
                        }
                    });

                    function sendMessage() {
                        if (isProcessing) return;
                        
                        // 检查配置是否存在
                        if (!allConfigurations[currentConfigName]) {
                            console.log('配置不存在，请求重新加载配置');
                            vscode.postMessage({
                                command: 'reloadConfigurations'
                            });
                            return;
                        }
                        
                        const input = document.getElementById('messageInput');
                        const text = input.value.trim();
                        if (!text) return;
                        
                        isProcessing = true;
                        const sendButton = document.getElementById('sendButton');
                        sendButton.disabled = true;
                        sendButton.textContent = '发送中...';

                        vscode.postMessage({
                            command: 'sendMessage',
                            text: text,
                            configName: currentConfigName,
                            modelName: currentModelName
                        });

                        input.value = '';
                    }

                    function updateMessage(message) {
                        const messagesDiv = document.getElementById('messages');
                        const messageDiv = messagesDiv.lastElementChild;
                        if (messageDiv && messageDiv.classList.contains(\`\${message.role}-message\`) && !message.temporary) {
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

                    function clearContext() {
                        // 清空消息显示
                        document.getElementById('messages').innerHTML = '';
                        // 通知扩展清空上下文
                        vscode.postMessage({
                            command: 'clearContext'
                        });
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
                    case 'deleteConfig':
                        // 直接删除配置，不需要确认
                        try {
                            await this._settingsManager.deleteConfig(message.name);
                            if (this._view) {
                                this._view.webview.html = this._getSettingsHtml(this._view.webview);
                                vscode.window.showInformationMessage(`配置 "${message.name}" 已删除`);
                            }
                        } catch (error) {
                            vscode.window.showErrorMessage(error instanceof Error ? error.message : '删除配置失败');
                        }
                        break;
                    case 'showError':
                        // 显示错误消息
                        vscode.window.showErrorMessage(message.text);
                        break;
                }
            }
        );
    }

    private _getSettingsHtml(webview: vscode.Webview): string {
        const configurations = this._settingsManager.getConfigurations();
        const currentConfig = this._settingsManager.getCurrentConfig();
        
        // 获取当前配置的设置
        let currentSettings: Configuration;
        if (currentConfig && configurations[currentConfig]) {
            currentSettings = configurations[currentConfig];
        } else {
            currentSettings = this._settingsManager.getSettings();
        }
        
        return `
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>AI 设置</title>
                <style>
                    body {
                        padding: 20px;
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                    }
                    .settings-container {
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    .form-group {
                        margin-bottom: 20px;
                    }
                    label {
                        display: block;
                        margin-bottom: 5px;
                        color: var(--vscode-input-foreground);
                    }
                    input[type="text"],
                    input[type="password"] {
                        width: 100%;
                        padding: 8px;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                    }
                    button {
                        padding: 8px 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .error-message {
                        color: var(--vscode-errorForeground);
                        font-size: 12px;
                        margin-top: 4px;
                        display: none;
                    }
                    .model-select {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        margin-bottom: 8px;
                    }
                    .model-select input[type="radio"] {
                        margin: 0;
                    }
                    .model-select label {
                        margin: 0;
                        flex: 1;
                    }
                    .icon {
                        padding: 4px 8px;
                        font-size: 12px;
                        border-radius: 3px;
                    }
                    .danger {
                        background: var(--vscode-errorForeground);
                        color: var(--vscode-errorBackground);
                    }
                    .danger:hover {
                        background: var(--vscode-errorForeground);
                        opacity: 0.8;
                    }
                    .settings-actions {
                        margin-top: 20px;
                        display: flex;
                        gap: 10px;
                        justify-content: flex-end;
                    }
                    .action-button {
                        display: flex;
                        align-items: center;
                        gap: 5px;
                        padding: 8px 16px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        transition: background-color 0.2s;
                    }
                    .action-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div class="settings-container">
                    <form id="settingsForm">
                        <div class="form-group">
                            <label for="name">配置名称</label>
                            <input type="text" id="name" value="${currentSettings.name || ''}">
                            <div id="nameError" class="error-message">请输入有效的配置名称</div>
                        </div>
                        <div class="form-group">
                            <label for="endpoint">API 端点</label>
                            <input type="text" id="endpoint" value="${currentSettings.endpoint || ''}" onchange="validateEndpoint(this)">
                            <div id="endpointError" class="error-message">请输入有效的API端点URL</div>
                        </div>
                        <div class="form-group">
                            <label for="apiKey">API 密钥</label>
                            <input type="password" id="apiKey" value="${currentSettings.apiKey || ''}">
                        </div>
                        <div class="form-group">
                            <label>模型选择</label>
                            <div id="modelsList">
                                ${(currentSettings.models || []).map((model: {name: string; selected: boolean}) => `
                                    <div class="model-select">
                                        <input type="radio" 
                                            name="model" 
                                            value="${model.name}"
                                            id="${model.name}"
                                            ${model.selected ? 'checked' : ''}>
                                        <label for="${model.name}">${model.name}</label>
                                        <button class="icon danger" onclick="deleteModel('${model.name}')">删除</button>
                                    </div>
                                `).join('')}
                            </div>
                            <div style="margin-top: 10px; display: flex; gap: 8px;">
                                <input type="text" id="newModelName" placeholder="输入新模型名称" style="flex: 1;">
                                <button onclick="addNewModel()">添加模型</button>
                            </div>
                        </div>
                        <button onclick="saveSettings()">保存设置</button>
                    </form>
                    <div class="settings-actions">
                        <button id="exportConfig" class="action-button">
                            <i class="codicon codicon-export"></i> 导出配置
                        </button>
                        <button id="importConfig" class="action-button">
                            <i class="codicon codicon-import"></i> 导入配置
                        </button>
                    </div>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    // 导出配置
                    document.getElementById('exportConfig').addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'exportConfig'
                        });
                    });

                    // 导入配置
                    document.getElementById('importConfig').addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'importConfig'
                        });
                    });

                    // ... 其他现有的JavaScript代码 ...
                </script>
            </body>
            </html>
        `;
    }
}

export async function activate(context: vscode.ExtensionContext) {
    const settingsManager = new SettingsManager(context);
    
    // 确保配置项存在
    const config = vscode.workspace.getConfiguration('cloud-ai-yingcai');
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
        
        vscode.commands.registerCommand('cloud-ai-yingcai.startChat', () => {
            vscode.commands.executeCommand('workbench.view.ai-chat');
        }),
        
        vscode.commands.registerCommand('cloud-ai-yingcai.openSettings', () => {
            vscode.commands.executeCommand('workbench.view.ai-chat');
        })
    );
}

export function deactivate() {}
