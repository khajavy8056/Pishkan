# PostgreSQL برای پشکان

نصب‌کننده (`scripts/install.sh`) نقش و پایگاه داده را خودکار می‌سازد. این پوشه برای نصب
دستی یا سرورهای مدیریت‌شده است.

## راه‌اندازی دستی

```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres psql -f deploy/postgres/setup.sql   # ابتدا رمز را تغییر دهید
```

سپس در `/etc/pishkan/pishkan.env`:

```env
DB_DRIVER=postgres
DATABASE_URL=postgres://pishkan:PASSWORD@127.0.0.1:5432/pishkan
DB_PASSWORD=PASSWORD
```

## پیشنهادهای تنظیمات (سرور ۲GB RAM)

در `postgresql.conf`:

```conf
shared_buffers = 512MB
effective_cache_size = 1536MB
work_mem = 16MB
maintenance_work_mem = 128MB
max_connections = 100
wal_compression = on
log_min_duration_statement = 1000
```

## نکات امنیتی

- سرور پایگاه داده روی `127.0.0.1` گوش بدهد (`listen_addresses = 'localhost'`).
- در `pg_hba.conf` فقط اتصال `host ... 127.0.0.1/32 scram-sha-256` برای نقش `pishkan` مجاز باشد.
- پشتیبان‌گیری شبانه با `pishkan backup` انجام می‌شود (pg_dump با قالب custom).
- بازیابی را روی یک پایگاه داده آزمایشی تمرین کنید:
  `pg_restore -d pishkan_restore_test --no-owner <file.dump>`
