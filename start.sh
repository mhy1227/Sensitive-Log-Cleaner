#!/bin/bash

# 日志脱敏工具 GUI 版本启动脚本

echo ""
echo "========================================"
echo "  日志脱敏工具 GUI 版本启动脚本"
echo "========================================"
echo ""

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 错误: 未检测到 Node.js"
    echo "请先安装 Node.js (https://nodejs.org)"
    echo ""
    exit 1
fi

echo "✅ Node.js 版本:"
node --version

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
    echo ""
    echo "📦 首次运行，正在安装依赖..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "❌ 依赖安装失败"
        exit 1
    fi
    echo ""
    echo "✅ 依赖安装完成"
fi

# 启动应用
echo ""
echo "🚀 正在启动日志脱敏工具..."
echo ""
echo "提示:"
echo "- 按 Ctrl+C 可以停止应用"
echo "- 关闭终端也会停止应用"
echo ""

npm start

echo ""
echo "应用已关闭"