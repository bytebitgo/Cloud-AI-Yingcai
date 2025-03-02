# GitHub Actions 工作流使用说明

本项目使用 GitHub Actions 实现自动化版本管理和发布流程。

## 工作流说明

### 1. 自动版本更新 (Auto Version Update)

此工作流用于自动更新项目版本号、更新CHANGELOG.md并创建Git标签。

**触发方式**：手动触发

**使用方法**：
1. 在GitHub仓库页面，点击"Actions"选项卡
2. 在左侧列表中选择"Auto Version Update"工作流
3. 点击"Run workflow"按钮
4. 选择版本更新类型（patch、minor或major）
5. 输入更新日志内容
6. 点击"Run workflow"按钮启动工作流

**工作流执行内容**：
- 更新package.json中的版本号
- 更新package-lock.json中的版本号
- 在CHANGELOG.md顶部添加新版本记录
- 提交更改并创建新的Git标签
- 推送更改和标签到远程仓库

### 2. 发布扩展 (Publish Extension)

此工作流用于自动构建和发布VSCode扩展。

**触发方式**：
- 推送到main分支时自动构建（但不发布）
- 推送标签（格式为v*）时自动构建并发布

**工作流执行内容**：
- 构建扩展
- 创建VSIX包
- 上传VSIX包作为构建产物
- 当推送标签时，自动发布到Visual Studio Marketplace

## 配置密钥

使用这些工作流需要在GitHub仓库中配置以下密钥：

1. **VSCE_PAT**：Visual Studio Marketplace的个人访问令牌，用于发布扩展
   - 获取方式：[https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token)

2. **GH_PAT**：GitHub的个人访问令牌，用于提交更改和创建标签
   - 获取方式：[https://docs.github.com/cn/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token](https://docs.github.com/cn/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
   - 需要的权限：`repo`

## 配置步骤

1. 在GitHub仓库页面，点击"Settings"选项卡
2. 在左侧列表中选择"Secrets and variables" -> "Actions"
3. 点击"New repository secret"按钮
4. 添加上述两个密钥（VSCE_PAT和GH_PAT）

## 使用流程

推荐的工作流程如下：

1. 开发新功能或修复bug
2. 使用"Auto Version Update"工作流更新版本号和CHANGELOG
3. 工作流会自动创建新的Git标签（例如v0.2.36）
4. 标签创建后，"Publish Extension"工作流会自动触发并发布扩展

这样，您只需手动触发"Auto Version Update"工作流，其余的构建和发布过程将自动完成。 