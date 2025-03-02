@echo off
setlocal enabledelayedexpansion

REM 获取当前版本号
for /f "tokens=*" %%a in ('node -p "require('./package.json').version"') do (
    set VERSION=%%a
)

echo 当前版本号: v%VERSION%
echo.

REM 检查标签是否已存在
git tag -l "v%VERSION%" > nul
if %ERRORLEVEL% EQU 0 (
    echo 警告: 标签 v%VERSION% 已存在!
    set /p FORCE=是否强制重新创建并推送标签? (y/n): 
    
    if /i "!FORCE!"=="y" (
        echo 正在删除现有标签...
        git tag -d v%VERSION%
        git push origin :refs/tags/v%VERSION%
    ) else (
        echo 操作已取消。
        goto :end
    )
)

set /p CONFIRM=是否推送标签 v%VERSION% 触发发布工作流? (y/n): 

if /i "%CONFIRM%"=="y" (
    echo 正在创建标签 v%VERSION%...
    git tag v%VERSION%
    
    echo 正在推送标签到远程仓库...
    git push origin v%VERSION%
    
    echo.
    echo 标签 v%VERSION% 已推送!
    echo 请在 GitHub Actions 页面查看发布工作流的执行状态。
    echo https://github.com/bytebitgo/Cloud-AI-Yingcai/actions
) else (
    echo 操作已取消。
)

:end
pause 