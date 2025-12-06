const http = require('http');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const cluster = require('cluster');
const os = require('os');

// 设置端口
const PORT = 8003;

// MIME 类型映射
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.env': 'application/octet-stream',
  '.dds': 'image/vnd.ms-dds'
};

// 多进程模式支持
if (cluster.isMaster) {
  const numCPUs = os.cpus().length;
  
  console.log(`\n---------------------------------------`);
  console.log(` 启动 ${numCPUs} 个工作进程`);
  console.log(` 游戏服务器已启动: http://localhost:${PORT}`);
  console.log(` 请保持此窗口打开`);
  console.log(` 按 Ctrl+C 停止服务器`);
  console.log(`---------------------------------------\n`);
  
  // 创建工作进程
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  
  // 自动打开浏览器（只在主进程中）
  const { exec } = require('child_process');
  const url = `http://localhost:${PORT}`;
  
  // 根据操作系统选择浏览器打开命令
  switch (process.platform) {
    case 'darwin':
      exec(`open ${url}`);
      break;
    case 'win32':
      exec(`start ${url}`);
      break;
    default:
      exec(`xdg-open ${url}`);
  }
  
  // 当工作进程退出时，重新启动
  cluster.on('exit', (worker, code, signal) => {
    console.log(`工作进程 ${worker.process.pid} 已退出`);
    cluster.fork();
  });
  
  process.on('SIGINT', () => {
    console.log('\n正在关闭所有工作进程...');
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill();
    }
    process.exit(0);
  });
  
} else {
  // 工作进程处理请求
  const server = http.createServer((req, res) => {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // 设置缓存控制头
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // 处理 OPTIONS 请求
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    // 解析 URL
    let filePath = '.' + req.url;
    if (filePath === './') {
      filePath = './index.html';
    }
    
    // 获取文件扩展名
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeType = mimeTypes[extname] || 'application/octet-stream';
    
    // 读取文件
    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code === 'ENOENT') {
          // 文件不存在
          res.writeHead(404, { 'Content-Type': 'text/html' });
          res.end('<h1>404 Not Found</h1>', 'utf-8');
        } else {
          // 服务器错误
          res.writeHead(500);
          res.end(`Server Error: ${error.code}`, 'utf-8');
        }
      } else {
        // 成功返回文件
        res.writeHead(200, { 'Content-Type': mimeType });
        res.end(content, 'utf-8');
      }
    });
  });
  
  // 启动服务器
  server.listen(PORT, () => {
    console.log(`工作进程 ${process.pid} 正在监听端口 ${PORT}`);
  });
  
  // 处理服务器错误
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`错误: 端口 ${PORT} 可能被占用了。`);
      console.error('请尝试关闭其他服务器窗口，或者修改脚本中的 PORT 变量。');
    } else {
      console.error('服务器错误:', e);
    }
  });
}
