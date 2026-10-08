# API reference

Base URL: `https://api.pikidada.com` (locally `http://localhost:<PORT>`). Requests and responses are JSON. Request bodies are validated, and unknown or wrong-typed fields get a `400` with the reasons.

## Authentication

- `POST /auth/login` or `/auth/register` returns `{ accessToken, user }` and sets an httpOnly **refresh cookie**.
- Send the access token as `Authorization: Bearer <accessToken>`.
- When it expires, `POST /auth/refresh` (with the cookie, from the website's own origin) returns a new access token and rotates the cookie.

**Who** in the tables below:

| Who | Meaning |
|---|---|
| Public | No token needed |
| Signed in | Any signed-in user |
| Passenger, Driver, Admin | Only that role. "Driver" covers boda riders and delivery riders |

Errors come back as `{ statusCode, message }`. `message` is written to be shown to the user.

## Auth: `/auth`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/auth/register` | Public | `{ name, email, phone, password, role }`, role `PASSENGER` or `DRIVER` (admins are promoted, not registered). 10 per minute per IP |
| POST | `/auth/login` | Public | `{ email, password }`. 5 per minute per IP |
| POST | `/auth/refresh` | Refresh cookie | Same-origin only |
| POST | `/auth/logout` | Refresh cookie | Ends this session |
| POST | `/auth/forgot-password` | Public | Emails a reset link |
| POST | `/auth/reset-password` | Public | `{ token, password }` |
| POST | `/auth/verify-email` | Public | `{ token }` |
| POST | `/auth/resend-verification` | Signed in | |
| POST | `/auth/resend-verification-email` | Public | `{ email }` |
| GET | `/auth/sessions` | Signed in | The user's signed-in devices |
| DELETE | `/auth/sessions/:id` | Signed in | Sign one device out |
| POST | `/auth/sessions/revoke-all` | Signed in | Sign out everywhere |
| GET | `/auth/google`, `/auth/google/callback` | Public | Google sign-in redirect flow |

## Users: `/users`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/users/me` | Signed in | |
| PATCH | `/users/me` | Signed in | Name, phone, etc. |
| PATCH | `/users/me/fcm-token` | Signed in | Register a phone for FCM push |

## Rides: `/trips`

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/trips` | Passenger | Book a ride. Body below |
| GET | `/trips/me` | Signed in | The user's rides (as passenger or rider) |
| GET | `/trips/:id` | Signed in | Only the ride's passenger, its rider or an admin |
| GET | `/trips/waiting-policy` | Signed in | Current waiting rates per ride type |
| PATCH | `/trips/:id/accept` | Driver | |
| PATCH | `/trips/:id/reject` | Driver | |
| PATCH | `/trips/:id/status` | Signed in | `{ status, cancellationReason? }`. `ARRIVED`, `IN_PROGRESS`, `COMPLETED` by the rider; `CANCELLED` by either. Completing sets the final fare |
| POST | `/trips/:id/stops/preview` | Passenger | `{ stops }` → the new fare, without saving |
| PUT | `/trips/:id/stops` | Passenger | `{ stops }`: the stops still to come, in order. Reached stops are kept |
| PATCH | `/trips/:id/stops/:stopId/arrive` | Driver | Starts that stop's waiting clock |
| PATCH | `/trips/:id/stops/:stopId/depart` | Driver | Stops it |
| POST | `/trips/:id/rate` | Signed in | `{ stars: 1–5, comment? }` |

Booking a ride:

```json
{
  "pickupLat": 0.3136, "pickupLng": 32.5811, "pickupAddress": "Kampala Rd",
  "destinationLat": 0.3621, "destinationLng": 32.6193, "destinationAddress": "Ntinda",
  "stops": [{ "lat": 0.3354, "lng": 32.5695, "address": "Wandegeya" }],
  "rideType": "BODA",
  "paymentMethod": "CASH",
  "couponCode": "WELCOME10"
}
```

`stops` (up to 3) and `couponCode` are optional. A bad coupon fails the whole booking with the reason, so the passenger can remove it and try again. The response is the trip, including `fare` (what the passenger pays), `discount` and `couponCode`.

Statuses: `REQUESTED → SEARCHING → ACCEPTED → ARRIVED → IN_PROGRESS → COMPLETED`, or `CANCELLED`.

## Deliveries: `/deliveries`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/deliveries/categories` | Signed in | Active item categories |
| GET | `/deliveries/size-tiers` | Signed in | Active size tiers (these set the price) |
| GET | `/deliveries/waiting-policy` | Signed in | |
| POST | `/deliveries/upload-photo` | Passenger | Multipart `file` → `{ url }` for `itemPhotoUrl` |
| POST | `/deliveries` | Passenger | Book a delivery. Body below |
| GET | `/deliveries/me` | Signed in | |
| GET | `/deliveries/:id` | Signed in | Only its sender, its rider or an admin |
| PATCH | `/deliveries/:id/accept`, `/reject` | Driver | |
| PATCH | `/deliveries/:id/status` | Signed in | `{ status, cancellationReason? }` |
| POST | `/deliveries/:id/stops/preview` | Passenger | As for rides |
| PUT | `/deliveries/:id/stops` | Passenger | As for rides |
| PATCH | `/deliveries/:id/stops/:stopId/arrive`, `/depart` | Driver | As for rides |

Booking a delivery: `categoryId`, `sizeTierId`, the pickup and drop-off contact name, phone, address and coordinates (`pickupContactName`, `pickupContactPhone`, `pickupLat`, `pickupLng`, `pickupAddress`, `dropoffContactName`, `dropoffContactPhone`, `destinationLat`, `destinationLng`, `destinationAddress`), `itemDescription` and `paymentMethod`. Optional: `itemPhotoUrl`, `isFragile`, `isLiquid`, `cashOnDeliveryAmount`, `couponCode`, and `stops` (each with `address`, `lat`, `lng`, `contactName`, `contactPhone`).

Statuses: `REQUESTED → SEARCHING → ACCEPTED → ARRIVED_PICKUP → PICKED_UP → ARRIVED_DROPOFF → DELIVERED`, or `CANCELLED`.

## Address search: `/places`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/places/search?q=` | Signed in | `{ places: [{ label, lat, lng }] }` from our own gazetteer, most-used first. Empty until the maps platform runs; the booking page then falls back to Google |

## Coupons: `/coupons`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/coupons/check?code=` | Passenger | `{ code, discountAmount, discountPercent }` if this passenger can use it, otherwise `400` with the reason |

## Riders: `/drivers`

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/drivers/me` | Driver | Profile, vehicle, documents, approval status |
| POST | `/drivers/me/vehicle` | Driver | |
| POST | `/drivers/me/documents` | Driver | Multipart upload: national ID, permit, registration, insurance |
| PATCH | `/drivers/me/availability` | Driver | Go online or offline |
| PATCH | `/drivers/me/location` | Driver | |
| GET | `/drivers/pending` | Admin | Riders waiting for approval |
| PATCH | `/drivers/:id/approve`, `/reject` | Admin | |

## Payments and wallet

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/payments/:tripId/stripe/checkout` | Passenger | Returns a checkout link |
| POST | `/payments/:tripId/flutterwave/checkout` | Passenger | Returns a checkout link |
| POST | `/payments/:tripId/cash/confirm` | Passenger | Passenger confirms they paid cash. Credits the rider |
| POST | `/payments/delivery/:deliveryId/stripe/checkout` | Passenger | |
| POST | `/payments/delivery/:deliveryId/flutterwave/checkout` | Passenger | |
| POST | `/payments/delivery/:deliveryId/cash/confirm` | Passenger | |
| POST | `/payments/webhooks/stripe` | Stripe | Signature checked |
| POST | `/payments/webhooks/flutterwave` | Flutterwave | Signature checked |
| GET | `/wallet/me` | Signed in | Balance and history |
| POST | `/wallet/withdraw` | Signed in | |

## Notifications and push

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/notifications/me` | Signed in | In-app notification feed |
| PATCH | `/notifications/:id/read` | Signed in | |
| GET | `/push/public-key` | Public | Web push VAPID key |
| POST | `/push/subscribe`, `/push/unsubscribe` | Signed in | Browser push subscription |

## Admin: `/admin` (Admin only)

| Area | Routes |
|---|---|
| Dashboard | `GET stats`, `GET finance`, `GET finance/range` |
| Riders | `GET drivers/active`, `GET drivers/wallets`, `PATCH drivers/:id/wallet/settle`, `GET documents/:id` |
| Users | `GET users`, `GET users/:id`, `PATCH users/:id/suspend`, `PATCH users/:id/activate`, `PATCH users/:id/promote`, `DELETE users/:id` |
| Rides and deliveries | `GET trips`, `GET deliveries` |
| Ride pricing | `GET pricing`, `PATCH pricing/:rideType` (base fare, per km, per minute, waiting rate, free waiting minutes) |
| Pricing settings | `GET pricing-settings`, `PATCH pricing-settings` (rounding unit, commission, unvisited stops policy, fallback factor, average speed, Google duration correction on/off, trips needed, largest correction) |
| Estimate accuracy | `GET estimate-accuracy`: real trips against Google's and our map's estimates, per ride type and time of day, with the correction each would get |
| Delivery pricing | `GET/POST delivery-categories`, `PATCH delivery-categories/:id`, `GET/POST delivery-size-tiers`, `PATCH delivery-size-tiers/:id`, `PATCH delivery-size-tiers/:id/pricing`, `GET delivery-surcharges`, `PATCH delivery-surcharges/:key` |
| Coupons | `GET coupons`, `POST coupons` (`{ code, discountAmount? \| discountPercent?, maxUses?, expiresAt? }`), `PATCH coupons/:id/deactivate` |
| Push | `POST push/broadcast`, `GET push/history` |

What each pricing setting does is explained in [pricing-stops-coupons.md](pricing-stops-coupons.md).

## Health

| Method | Path | Who |
|---|---|---|
| GET | `/health` | Public |

## Live updates (Socket.IO)

Connect to the API's address with the access token (`auth: { token }`). Each user automatically gets their own room, `user:<id>`.

Sent by the client:

| Event | Payload | Purpose |
|---|---|---|
| `trip:join` | `{ tripId }` | Follow one ride (passenger, its rider, or admin) |
| `delivery:join` | `{ deliveryId }` | Follow one delivery |
| `driver:location_update` | `{ tripId? \| deliveryId?, location: { lat, lng }, heading? }` | The rider's position while on a job |

Sent by the server:

| Event | When |
|---|---|
| `trip:requested`, `delivery:requested` | A nearby online rider has a new job offer |
| `trip:accepted`, `delivery:accepted` | A rider took it |
| `trip:rejected`, `delivery:rejected` | A rider declined |
| `trip:status_updated`, `delivery:status_updated` | Any status, stop or fare change. The payload is the full trip or delivery |
| `trip:cancelled`, `delivery:cancelled` | Cancelled |
| `driver:location_update` | The rider moved |

## Maps platform (internal)

The Go service in `services/maps` is called only by the API, with a shared key. Its routes (`/v1/route`, `/v1/pings`, `/v1/places`, `/v1/places/search`, `/v1/stats`) are documented in [services/maps/README.md](../services/maps/README.md).
