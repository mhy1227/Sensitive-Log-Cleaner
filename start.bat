@echo off
chcp 65001 >nul
title 日志脱敏工具 GUI 版本

echo.
echo ========================================
echo   日志脱敏工具 GUI 版本启动脚本
echo ========================================
echo.

:: 检查 Node.js 是否安装
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未检测到 Node.js
    echo 请先安装 Node.js ^(https://nodejs.org^)
    echo.
    pause
    exit /b 1
)

echo ✅ Node.js 版本:
node --version

:: 检查是否已安装依赖
if not exist "node_modules" (
    echo.
    echo 📦 首次运行，正在安装依赖...
    echo.
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
    echo.
    echo ✅ 依赖安装完成
)

:: 启动应用
echo.
echo 🚀 正在启动日志脱敏工具...
echo.
echo 提示:
echo - 按 Ctrl+C 可以停止应用
echo - 关闭此窗口也会停止应用
echo.

npm start

echo.
echo 应用已关闭
pause