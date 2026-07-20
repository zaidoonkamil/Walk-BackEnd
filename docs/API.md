# Walk Backend API

Base URL: `http://localhost:1011`

Auth header for protected routes:

```http
Authorization: Bearer <token>
```

Security notes:

- User access tokens default to `JWT_EXPIRES_IN=30d`.
- Admin access tokens default to `ADMIN_JWT_EXPIRES_IN=30m`.
- Admin tokens are backed by `AdminSessions`; logout/revoke invalidates tokens immediately.
- In production, `JWT_SECRET` must be at least 32 characters.
- Admin and brand owner passwords require at least 10 characters with uppercase, lowercase, number and symbol.

## Auth

### Register

`POST /auth/register`

Multipart fields: `name`, `phone`, `password`, `location`, optional `image`.

### Login

`POST /auth/login`

JSON:

```json
{ "phone": "07700000000", "password": "123456" }
```

### Current User

`GET /auth/me`

### Logout

`POST /auth/logout`

For admins, this revokes the current admin session immediately.

### Revoke My Admin Sessions

`POST /auth/admin/revoke-sessions`

Admin only. Revokes all active sessions for the current admin account.

## Profile

### Get Profile

`GET /profile`

### Update Profile

`PATCH /profile`

Multipart fields: `name`, `location`, `language`, `dailyStepGoal`, `facebookUrl`, `instagramUrl`, `tiktokUrl`, `whatsappSupportUrl`, optional `image`.

### Month Stats

`GET /profile/month-stats`

### My Coupons

`GET /profile/coupons`

## Steps

Points settings come from `.env`:

- `STEPS_PER_POINT`, default `100`
- `DAILY_POINTS_LIMIT`, default `200`
- `MAX_DAILY_STEPS`, default `50000`

### Save Daily Steps

`POST /steps`

JSON:

```json
{
  "date": "2026-07-19",
  "steps": 8500,
  "calories": 340,
  "source": "google_fit",
  "deviceId": "android-device-id"
}
```

Allowed `source`: `manual`, `pedometer`, `google_fit`, `healthkit`.

Trusted sources `pedometer`, `google_fit`, `healthkit` require `deviceId`.

### Steps Dashboard

`GET /steps/dashboard`

Returns today stats, points rule, totals, streak and last 7 days.

## Brands

### Categories

`GET /categories`

### Brands

`GET /brands`

Optional query: `categoryId`, `featured=true`, `q`.

### Brand Details

`GET /brands/:id`

Includes category, social links and active coupons.

## Coupons

### List Coupons

`GET /coupons`

Optional query: `brandId`.

### Add Coupon To Cart

`POST /coupon-cart`

```json
{ "couponId": 1 }
```

### Get Cart

`GET /coupon-cart`

### Remove Cart Item

`DELETE /coupon-cart/:id`

### Checkout Cart

`POST /coupon-cart/checkout`

Creates coupon purchases, subtracts points, clears cart, and returns `qrCodeDataUrl`.

### Direct Buy

`POST /coupons/:id/buy`

Keeps the old direct purchase flow and returns `qrCodeDataUrl`.

### Purchase QR

`GET /coupon-purchases/:id/qr`

Returns `code`, `qrPayload`, and `qrCodeDataUrl`.

## Brand Owner

### My Brands

`GET /brand-owner/brands`

### Update My Brand

`PATCH /brand-owner/brands/:id`

### Create Coupon

`POST /brand-owner/coupons`

```json
{
  "brandId": 1,
  "title": "10% discount",
  "discountType": "percentage",
  "discountValue": 10,
  "pointsCost": 25,
  "quantity": 100
}
```

### Update Coupon

`PATCH /brand-owner/coupons/:id`

### Redeem Coupon

`POST /brand-owner/coupons/redeem`

```json
{ "code": "WLK-ABC123-DEF456" }
```

### Brand Coupon Purchases

`GET /brand-owner/coupons/purchases`

## Admin

### Dashboard

`GET /admin/dashboard`

### Users

`GET /admin/users`

Optional query: `role`, `q`.

### Create User/Admin/Brand Owner

`POST /admin/users`

Multipart fields: `name`, `phone`, `password`, `role`, optional `location`, `image`.

Allowed roles: `user`, `admin`, `brand_owner`.

Admin and brand owner passwords must be strong.

### Revoke Admin Sessions

`POST /admin/users/:id/revoke-admin-sessions`

Admin only. Revokes all active sessions for another admin user.

### Adjust User Points

`PATCH /admin/users/:id/points`

```json
{ "points": 100, "description": "Bonus" }
```

### Create Category

`POST /admin/categories`

### Create Brand

`POST /admin/brands`

Send `latitude` and `longitude` only for maps. The mobile app should open Google Maps, Apple Maps or Waze from those coordinates.

Use `socialLinks` as JSON string:

```json
[
  { "platform": "instagram", "url": "https://instagram.com/example" },
  { "platform": "facebook", "url": "https://facebook.com/example" }
]
```

### Update Brand

`PATCH /admin/brands/:id`

### Create Coupon

`POST /admin/coupons`

### Brand Report

`GET /admin/brands/:id/report`

### Commission Logs

`GET /admin/commissions`

### Expire Old Coupons Manually

`POST /admin/coupons/expire`

The server also runs an automatic expiry job every `COUPON_EXPIRY_JOB_MS`.

## Home Sections

### Public Home Sections

`GET /home/sections`

### Admin Sections

`GET /admin/featured-sections`

`POST /admin/featured-sections`

`PATCH /admin/featured-sections/:id`

`POST /admin/featured-sections/:id/brands`

`DELETE /admin/featured-items/:id`
