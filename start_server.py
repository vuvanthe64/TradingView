import http.server, socketserver, webbrowser, os
os.chdir(os.path.dirname(__file__))
PORT=8000
with socketserver.TCPServer(("",PORT), http.server.SimpleHTTPRequestHandler) as httpd:
    webbrowser.open(f"http://localhost:{PORT}")
    print(f"Serving at http://localhost:{PORT}")
    httpd.serve_forever()
