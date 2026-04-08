"""
Full request/response logger addon for mitmproxy.
Writes JSON-lines to /logs/traffic.jsonl.
"""

import json
import time
import os
from mitmproxy import http, ctx

LOG_DIR = "/logs"
LOG_FILE = os.path.join(LOG_DIR, "traffic.jsonl")
MAX_BODY_SIZE = 512 * 1024  # 512 KB


def _safe_body(content: bytes | None) -> str | None:
    if content is None:
        return None
    if len(content) > MAX_BODY_SIZE:
        return content[:MAX_BODY_SIZE].decode("utf-8", errors="replace") + f"\n... [TRUNCATED at {MAX_BODY_SIZE} bytes, total: {len(content)}]"
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return f"[binary data, {len(content)} bytes]"


class TrafficLogger:
    def response(self, flow: http.HTTPFlow) -> None:
        entry = {
            "timestamp": time.time(),
            "ts_human": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
            "client": flow.client_conn.peername[0] if flow.client_conn.peername else None,
            "request": {
                "method": flow.request.method,
                "url": flow.request.pretty_url,
                "host": flow.request.pretty_host,
                "headers": dict(flow.request.headers),
                "body": _safe_body(flow.request.get_content()),
            },
            "response": {
                "status_code": flow.response.status_code if flow.response else None,
                "headers": dict(flow.response.headers) if flow.response else None,
                "body": _safe_body(flow.response.get_content() if flow.response else None),
            },
        }

        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")

        status = flow.response.status_code if flow.response else "?"
        size = len(flow.response.get_content()) if flow.response else 0
        ctx.log.info(
            f"[LOG] {flow.request.method} {flow.request.pretty_url} "
            f"-> {status} ({size} bytes)"
        )

    def error(self, flow: http.HTTPFlow) -> None:
        entry = {
            "timestamp": time.time(),
            "ts_human": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
            "type": "error",
            "request": {
                "method": flow.request.method,
                "url": flow.request.pretty_url,
                "host": flow.request.pretty_host,
            },
            "error": str(flow.error) if flow.error else "unknown",
        }

        os.makedirs(LOG_DIR, exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")

        ctx.log.warn(f"[ERROR] {flow.request.pretty_url}: {flow.error}")


addons = [TrafficLogger()]
