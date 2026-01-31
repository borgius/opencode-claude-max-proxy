import http.server
import socketserver
import os
import json

PORT = int(os.environ.get("PORT", 8080))
HOST = "0.0.0.0"

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "status": "healthy",
            "port": PORT,
            "method": "GET",
            "path": self.path
        }).encode())

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length else ''

        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "status": "healthy",
            "port": PORT,
            "method": "POST",
            "path": self.path,
            "body_received": True if body else False
        }).encode())

print(f"Starting server on {HOST}:{PORT}")
with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
    httpd.serve_forever()
