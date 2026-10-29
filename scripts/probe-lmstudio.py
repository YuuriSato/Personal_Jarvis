"""Read-only diagnostics for the configured loopback LM Studio server."""
import json
import httpx

with httpx.Client(timeout=5, trust_env=False, follow_redirects=False) as client:
    for endpoint in ('/v1/models', '/api/v1/models', '/api/v0/models'):
        try:
            response = client.get('http://127.0.0.1:1234' + endpoint)
            print(json.dumps({'endpoint': endpoint, 'status': response.status_code,
                              'data': response.json() if response.is_success else None}, ensure_ascii=False))
        except (httpx.HTTPError, ValueError) as exc:
            print(json.dumps({'endpoint': endpoint, 'error': type(exc).__name__}))
