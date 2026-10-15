## English landing lookup

`POST /api/landing/lookup`과 `POST /api/landing/lookup_batch`는 랜딩 데모의
동적 영어 lemma 확장만을 위한 공개 읽기 전용 API입니다. 두 endpoint는
`central/data/static/en/<version>/lemma_pack.db`만 읽으며, NLP 분석 모델을
실행하거나 모바일 분석·조회 API를 대체하지 않습니다. 중앙 배포본에는 이 영어
SQLite만 유지하고, 다른 언어의 pack DB와 모델 파일은 배포하지 않습니다.

영어 SQLite를 설치하거나 최신 버전으로 바꾸려면 다음을 실행합니다. 이 스크립트는
영어 `lemma_pack.db`만 설치하고, 모바일용 언어 팩이나 NLP 모델은 설치하지 않습니다.

```sh
cd central
python install_packs.py
```

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

Set `TRUSTED_PROXY_IPS` to the comma-separated addresses of reverse proxies
controlled by this service when password-reset IP limiting runs behind one.

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
