"""Serve the reviewed Studio build on Train's LAN interface."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class StaticPreview(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--bind", default="192.168.1.146", choices=["192.168.1.146", "127.0.0.1"])
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    directory = args.directory.resolve(strict=True)
    if not (directory / "index.html").is_file():
        parser.error("build directory must contain index.html")
    if any(path.is_symlink() for path in directory.rglob("*")):
        parser.error("build directory must not contain symlinks")
    handler = partial(StaticPreview, directory=str(directory))
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
