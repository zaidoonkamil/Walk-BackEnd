# WhatsApp QR OTP

This is an optional OTP delivery provider that keeps the existing OTPIQ code intact.

## Enable

Add these values to `.env`:

```env
OTP_DELIVERY_PROVIDER=whatsapp_qr
WHATSAPP_QR_AUTO_INIT=true
WHATSAPP_QR_DEVICE_NAME=Walk
```

Optional:

```env
WHATSAPP_QR_SESSION_PATH=.whatsapp_qr_auth
WHATSAPP_QR_AUTO_RECONNECT=true
WHATSAPP_QR_QR_WAIT_TIMEOUT_MS=8000
WHATSAPP_QR_CONNECT_WAIT_TIMEOUT_MS=60000
```

To switch back to OTPIQ:

```env
OTP_DELIVERY_PROVIDER=otpiq
```

Then restart PM2 with env reload:

```bash
pm2 restart Walk-BackEnd-1011 --update-env
```

## Admin Routes

All routes require admin token:

- `POST /admin/whatsapp/init`
- `GET /admin/whatsapp/status`
- `GET /admin/whatsapp/qr`
- `POST /admin/whatsapp/logout`
- `POST /admin/whatsapp/reset-session`
- `POST /admin/whatsapp/test-message`

