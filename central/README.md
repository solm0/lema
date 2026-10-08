- 언어팩 새로운 버전 올렸으면 `shared/language_packs.py`에서 버전 하나씩 올려주고
- `central/install_packs.py`로 일괄 설치

## Mobile analysis protection

All `/api/mobile/*` endpoints require the access token returned by `/api/login`:

```http
Authorization: Bearer <access-token>
```

The server applies a sliding-window limit to both the authenticated user and
the client IP. One analysis may run per user, and up to five may run per IP.
NLP work is independent per language; each language admits at most five
running-or-waiting analyses. A rate, concurrency, or queue rejection
returns `429` with a structured `detail.code` and a `Retry-After` header.

Defaults can be changed at process startup:

- `ANALYZE_USER_RATE_LIMIT=20`
- `ANALYZE_IP_RATE_LIMIT=40`
- `ANALYZE_RATE_LIMIT_WINDOW_SECONDS=60`
- `ANALYZE_USER_CONCURRENT_LIMIT=1`
- `ANALYZE_IP_CONCURRENT_LIMIT=5`
- `ANALYZE_LANGUAGE_QUEUE_LIMIT=5`
- `ANALYZE_TRUSTED_PROXY_IPS=127.0.0.1,::1`

Only add the address of a reverse proxy controlled by this service to
`ANALYZE_TRUSTED_PROXY_IPS`; forwarded client IP headers from other peers are
ignored.

The in-memory concurrency and language-queue limits apply per server process.
If this service is later started with multiple worker processes or instances,
move these counters to a shared store (for example Redis) before treating the
limits as server-wide.

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
3. While one deliberately slow request is running, a second request from the
   same user returns `429` with `detail.code=analysis_busy`.
4. With six distinct accounts from the same IP, the sixth concurrent request
   returns `429` with `detail.code=analysis_busy`.
5. With more than `ANALYZE_LANGUAGE_QUEUE_LIMIT` concurrent requests for one
   language, excess requests return `429` with `detail.code=analysis_queue_full`.

## Account and password security

New and reset passwords are normalized to Unicode NFC, must contain 8 to 128
characters, and are checked against both `data/common_passwords.txt` and the
Have I Been Pwned range API. Only the first five characters of a SHA-1 digest
are sent to that API. If the API is unavailable, the local denylist remains in
effect and the request is allowed to continue.

New password hashes use Argon2id. Existing bcrypt hashes are upgraded after a
successful login. Install `central/requirements.txt` before deploying so the
Argon2 backend is available.

Password reset links use a random token whose SHA-256 digest is stored in
`password_reset_tokens`. Tokens expire after 30 minutes, are single-use, and
are removed if email delivery fails. A successful reset increments the user's
`auth_version`, immediately invalidating JWTs issued with the previous version.
Requesting a reset link does not invalidate an existing session.

Password reset submission limits default to 10 attempts per IP over 10 minutes
and 5 failures per token over 15 minutes. These in-memory values apply per
server process and can be changed at startup:

- `AUTH_RESET_IP_LIMIT=10`
- `AUTH_RESET_IP_WINDOW_SECONDS=600`
- `AUTH_RESET_TOKEN_FAILURE_LIMIT=5`
- `AUTH_RESET_TOKEN_WINDOW_SECONDS=900`
- `PASSWORD_RESET_TTL_MINUTES=30`
- `PASSWORD_RESET_RESPONSE_MIN_MS=200`
- `PWNED_PASSWORDS_TIMEOUT_SECONDS=2`
- `PWNED_PASSWORDS_URL=https://api.pwnedpasswords.com/range`

Client IP extraction uses the same trusted-proxy configuration documented
above for mobile analysis.

## SQLite account database backups

`scripts/backup_sqlite.py` creates a consistent snapshot with SQLite's backup
API, runs `PRAGMA integrity_check`, and records row counts and a SHA-256 digest
in a JSON manifest. By default snapshots remain local. Optional rclone upload
can be enabled later; when enabled, it uses `rclone copy` followed by
`rclone check` and never deletes remote files.

Configure the existing `central/.env` file:

```env
CENTRAL_DATABASE_PATH=/srv/capstone/nautilus/central/user.db
CENTRAL_BACKUP_DIR=/var/backups/nautilus
CENTRAL_BACKUP_RETENTION_DAYS=35
CENTRAL_BACKUP_MIN_LOCAL_COPIES=7
```

Local-only backups protect against accidental changes and database corruption,
but not loss of the server or its disk. To enable off-server replication later,
configure an rclone remote and add:

```env
CENTRAL_BACKUP_RCLONE_DESTINATION=gdrive:nautilus
```

Run the backup as the same OS user that runs `nautilus.service`; that user must
be able to read the database, write the backup directory, and read the rclone
configuration. Test one manual run before enabling the timer:

```sh
cd /srv/capstone/nautilus/central
venv/bin/python scripts/backup_sqlite.py
```

A daily systemd timer is preferred over cron because `Persistent=true` catches
up after downtime and failures are visible in the journal. Use the same `User`
value as `nautilus.service` in the following service:

```ini
# /etc/systemd/system/nautilus-backup.service
[Unit]
Description=Nautilus SQLite backup

[Service]
Type=oneshot
User=REPLACE_WITH_NAUTILUS_SERVICE_USER
WorkingDirectory=/srv/capstone/nautilus/central
EnvironmentFile=/srv/capstone/nautilus/central/.env
ExecStart=/srv/capstone/nautilus/central/venv/bin/python /srv/capstone/nautilus/central/scripts/backup_sqlite.py
UMask=0077
```

```ini
# /etc/systemd/system/nautilus-backup.timer
[Unit]
Description=Run Nautilus SQLite backup daily

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true
RandomizedDelaySec=15m
Unit=nautilus-backup.service

[Install]
WantedBy=timers.target
```

After installing the units, run and inspect one backup before enabling the
schedule:

```sh
sudo systemctl daemon-reload
sudo systemctl start nautilus-backup.service
sudo systemctl status nautilus-backup.service --no-pager -l
sudo journalctl -u nautilus-backup.service -n 100 --no-pager
sudo systemctl enable --now nautilus-backup.timer
systemctl list-timers nautilus-backup.timer
```
