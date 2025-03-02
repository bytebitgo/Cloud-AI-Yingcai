@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

REM 获取当前版本号
for /f "tokens=*" %%a in ('node -p "require('./package.json').version"') do (
    set VERSION=%%a
)

echo 当前版本号: v%VERSION%
echo.

REM 检查标签是否已存在
git tag > tags_temp.txt
findstr /C:"v%VERSION%" tags_temp.txt > nul
if %ERRORLEVEL% EQU 0 (
    echo 警告: 标签 v%VERSION% 已存在!
    set /p FORCE=是否强制重新创建并推送标签? (y/n): 
    
    if /i "!FORCE!"=="y" (
        echo 正在删除现有标签...
        git tag -d v%VERSION%
        git push origin :refs/tags/v%VERSION%
    ) else (
        echo 操作已取消。
        del tags_temp.txt
        goto :end
    )
)
del tags_temp.txt

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
REM =====================================================================
REM 批处理脚本常见错误说明：
REM 1. ": was unexpected at this time." 错误通常由以下原因导致：
REM    - 在管道(|)或重定向(>)后面直接使用变量而没有使用延迟变量扩展
REM    - 在if语句中使用了复杂的命令组合，如重定向或管道
REM    - 括号嵌套不正确
REM 2. 解决方法：
REM    - 使用enabledelayedexpansion并用!var!代替%var%
REM    - 使用临时文件代替直接管道操作
REM    - 简化命令结构，避免复杂的嵌套
REM =====================================================================
pause 