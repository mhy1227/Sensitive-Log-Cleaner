@echo off
chcp 65001 >nul
title 日志脱敏工具 GUI 调试模式

echo.
echo ========================================
echo   日志脱敏工具 GUI 调试模式
echo ========================================
echo.

:: 检查依赖
if not exist "node_modules" (
    echo 📦 安装依赖...
    npm install
    if %errorlevel% neq 0 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
)

:: 启动调试模式
echo 🐛 启动调试模式...
echo 提示: 开发者工具会自动打开，请查看 Console 标签页的调试信息
echo.

npm run dev

pause