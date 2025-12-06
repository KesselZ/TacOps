import http.server
import socketserver
import webbrowser
import mimetypes
import sys

# 设置端口
PORT = 8002

# 注册 Babylon.js 常用的 MIME 类型，防止加载错误
mimetypes.init()
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('model/gltf+json', '.gltf')
mimetypes.add_type('model/gltf-binary', '.glb')
mimetypes.add_type('application/octet-stream', '.bin')
mimetypes.add_type('application/octet-stream', '.env')
mimetypes.add_type('application/octet-stream', '.dds')
mimetypes.add_type('image/vnd.ms-dds', '.dds')

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 添加 No-Cache 头，确保每次修改代码后刷新都能看到最新效果
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        # 允许跨域访问 (CORS)，以防万一
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

# 允许端口复用，避免重启时提示端口被占用
socketserver.TCPServer.allow_reuse_address = True

try:
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        url = f"http://localhost:{PORT}"
        print(f"\n---------------------------------------")
        print(f" 游戏服务器已启动: {url}")
        print(f" 请保持此窗口打开")
        print(f" 按 Ctrl+C 停止服务器")
        print(f"---------------------------------------\n")
        
        # 尝试自动打开浏览器
        webbrowser.open(url)
        
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n服务器已停止。")
    sys.exit(0)
except OSError as e:
    print(f"\n错误: 端口 {PORT} 可能被占用了。")
    print("请尝试关闭其他 Python 服务器窗口，或者修改脚本中的 PORT 变量。")

