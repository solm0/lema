- 언어팩 새로운 버전 올렸으면 `shared/language_packs.py`에서 버전 하나씩 올려주고
- `central/install_packs.py`로 일괄 설치

## Mobile analysis protection

All `/api/mobile/*` endpoints require the access token returned by `/api/login`:

```http
Authorization: Bearer <access-token>
```

The server applies a sliding-window limit to both the authenticated user and
the client IP. Only one central analysis may run at a time across server
processes. A rate or concurrency rejection returns `429` with a structured
`detail.code` and a `Retry-After` header.

Defaults can be changed at process startup:

- `ANALYZE_USER_RATE_LIMIT=20`
- `ANALYZE_IP_RATE_LIMIT=40`
- `ANALYZE_RATE_LIMIT_WINDOW_SECONDS=60`
- `ANALYZE_LOCK_PATH=/tmp/lema-central-analysis.lock`
- `ANALYZE_TRUSTED_PROXY_IPS=127.0.0.1,::1`

Only add the address of a reverse proxy controlled by this service to
`ANALYZE_TRUSTED_PROXY_IPS`; forwarded client IP headers from other peers are
ignored.

Run the limiter/concurrency regression tests with:

```sh
cd central
python -m unittest discover -s tests -v
```

For staging HTTP checks, temporarily set both rate limits to `2`, obtain a
real test account token, then confirm:

1. A request without `Authorization` returns `401`.
2. The first two sequential requests succeed and the third returns `429` with
   `detail.code=analysis_rate_limited`.
3. While one deliberately slow request is running, a second request returns
   `429` with `detail.code=analysis_busy`.
