# Fares, stops, coupons and rider earnings

How Piki Dada prices a ride or delivery, from the quote to what the rider is paid. All amounts are in UGX. Everything the admin can change is under **Admin → Pricing** (`/admin/pricing`) and **Admin → Coupons** (`/admin/coupons`). Changes take effect within a minute.

## 1. The quoted fare

```
ride fare     = base fare + per km × distance + per minute × duration
delivery fare = (size tier's base fare + surcharges) + per km × distance + per minute × duration
```

The result is rounded to the nearest **fare rounding unit** (500 by default) so cash fares can be paid in notes.

- **Rides** use the pricing rule for the ride type (Boda, Economy, Comfort).
- **Deliveries** use the item's **size tier**, not its category. The category (Parcel, Food, ...) only describes the item. Flat **surcharges** (Fragile, Liquid) are added when the sender ticks them.

### Where distance and duration come from

The route covers pickup → each stop in order → destination. The API tries, in this order:

1. **Google Routes**, the primary source for every fare.
2. **The Piki Dada maps platform** (`services/maps`), if Google doesn't answer.
3. **Straight line × the road distance factor** (1.3 by default), with duration from the **average speed** setting (28 km/h by default).

Google stays primary on purpose. About a year after the Hetzner move we compare the maps platform against Google to decide whether it's good enough to take over. The data for that comparison is collected on every trip and delivery from now on:

| Stored on each trip / delivery | What it is |
|---|---|
| `distanceKm`, `durationMin`, `routeSource` | The estimate that priced it, and where it came from (Google, maps platform or straight line). Only Google-priced trips count in the comparison |
| `mapsDistanceKm`, `mapsDurationMin` | What the maps platform answered for the same route at the same moment ("shadow quote"). Empty until it runs on Hetzner |
| `actualDistanceKm`, `actualDurationMin` | What really happened, from the rider's GPS: pickup to destination for rides, pickup to the final drop-off for deliveries. Time spent waiting at stops is left out, as the estimates leave it out |

The raw GPS points are kept too, so a better measure can be recomputed later. Trips with stops that were never reached should be left out of the comparison, because their estimate covered a longer route than was driven.

## 2. Stops

- A ride or delivery can have **up to 3 stops** between pickup and the final destination. For a delivery, each stop is an extra drop-off with its own contact name and phone.
- The quote covers the whole route through the stops.
- The passenger can **add, remove or reorder stops during the trip**. Stops the rider has already reached are locked. The app shows the new fare first (`/stops/preview`) and only saves it when the passenger confirms.
- The rider taps **Arrived** and **Leaving** at each stop. Those times drive the waiting fee.

### Waiting fee

Each stop gets **free waiting minutes**, then a **per-minute waiting rate**:

```
waiting fee = Σ over stops of max(0, minutes waited − free minutes) × waiting rate
```

The rate and free minutes are set per ride type (and per delivery size tier). Each trip **keeps the rates it was booked with**, so changing them in the admin only affects new bookings. The total is rounded to the fare rounding unit and added when the trip ends.

### Stops the rider never reached

When a trip ends with stops never reached, the admin's **unvisited stops policy** decides:

| Policy | Result |
|---|---|
| Remove from fare (default) | Re-price the route using only the stops actually reached. Never charges more than the quote. |
| Charge quoted fare | Keep the quoted fare. |

## 3. Coupons

Admins create coupons at `/admin/coupons`:

- **Discount:** either a fixed amount (e.g. 2,000 UGX off) or a percentage (1–100%), not both.
- **Code:** 3–40 letters, numbers, `-` or `_`. Codes are not case-sensitive (`welcome10` = `WELCOME10`).
- **Limits:** an optional total number of uses and an optional expiry date (the coupon works until the end of that day, Kampala time).
- A coupon can be deactivated at any time. Bookings already made with it keep their discount.

Rules:

- Works on **rides and deliveries**.
- **Once per passenger.** Each passenger can use each code once.
- The passenger enters the code on the booking page and sees what it's worth before booking. The code is checked again at booking, in case it ran out in between.
- The discount comes off the route fare, rounded **down** to the fare rounding unit so the passenger never pays more than they were shown. A fixed-amount coupon larger than the fare makes the ride free, not negative.
- The **waiting fee is not discounted**.
- If the stops change, the discount is recalculated on the new fare.
- **Cancelling gives the coupon back.** The passenger can use it again, and it no longer counts towards the coupon's use limit.
- If two people book with the last remaining use at the same moment, only one gets it. The other sees "This coupon is no longer available".

## 4. Who pays the discount, and what the rider earns

**Piki Dada pays for coupons, not the rider.** Commission is charged on the full fare before the discount, and the rider receives the same as if there were no coupon.

```
full fare  = fare paid + coupon discount
commission = full fare × platform commission rate   (15% by default)
```

| Payment | What happens to the rider's wallet |
|---|---|
| Card / mobile money / wallet | The rider is credited **full fare − commission** |
| Cash | The rider kept the cash, so they owe the commission: the wallet goes down by the commission and up by the coupon discount |

Example: a 10,000 UGX ride, 15% commission, 10% coupon. The passenger pays 9,000.

- Card: the rider is credited 10,000 − 1,500 = **8,500**.
- Cash: the rider keeps 9,000 cash, and the wallet changes by +1,000 − 1,500 = **−500**. Net: 8,500, the same as card.

## 5. Settings reference

| Setting | Where | Default |
|---|---|---|
| Base fare, per km, per minute | Per ride type / per size tier | Set in the seed |
| Waiting rate per minute, free waiting minutes | Per ride type / per size tier | 0, 3 |
| Fragile / liquid surcharge | Delivery surcharges | Set in the seed |
| Fare rounding unit | Pricing settings | 500 |
| Platform commission rate | Pricing settings | 15% |
| Unvisited stops policy | Pricing settings | Remove from fare |
| Road distance factor, average speed | Pricing settings (used only when no routing service answers) | 1.3, 28 km/h |
