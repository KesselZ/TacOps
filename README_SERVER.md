# TacOps 服务器说明

## Python 服务器 (server.py)
- **端口**: 8002
- **启动命令**: `python server.py`
- **功能**: 基础 HTTP 服务器，支持 Babylon.js 文件类型

## Node.js 服务器 (server.js)
- **端口**: 8003
- **启动命令**: `node server.js` 或 `npm start`
- **功能**: 
  - 多进程支持 (自动使用所有 CPU 核心)
  - 支持并发连接
  - 自动重启工作进程
  - 跨域支持
  - 无缓存策略

## 使用方法

### 启动 Python 服务器
```bash
python server.py
```

### 启动 Node.js 服务器
```bash
npm start
# 或者
node server.js
```

## 特性对比

| 特性 | Python 服务器 | Node.js 服务器 |
|------|---------------|----------------|
| 多线程 | ❌ | ✅ (多进程) |
| 并发处理 | 基础 | 高性能 |
| 自动重启 | ❌ | ✅ |
| 端口 | 8002 | 8003 |

两个服务器可以同时运行，但需要使用不同的端口。
