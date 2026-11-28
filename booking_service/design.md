# Booking Request Service - Design

Owner: Karim Abo Elnaser. Customers use this service to send booking requests for tour packages, follow them, change the number of travelers and cancel.

## Entity: BookingRequest (DynamoDB table `BookingRequests`, key `requestID`)

| Field | Type | Set by | Notes |
|---|---|---|---|
| requestID | string | server | `REQ-` + 8 characters, key of the table |
| packageID | string | customer | must be a published package in the package service |
| packageTitle | string | server | copied from the package when the request is sent |
| customerName | string | customer | 3 to 80 characters |
| customerEmail | string | customer | saved in lower case; identifies the customer |
| phone | string | customer | 8 to 15 digits, optional `+` |
| travelers | number | customer | whole number 1 to 10 |
| totalPrice | number | server | package price x travelers |
| note | string | customer | optional, up to 300 characters |
| status | string | server / staff | starts as `pending` (flow below) |
| createdAt | string | server | `YYYY-MM-DD` (the review service filters by this) |
| createdAtTime, updatedAt | string | server | full ISO time |

## Entity: StatusHistory (table `StatusHistory`, keys `requestID` + `changedAt`)

One row per status change: `fromStatus`, `toStatus`, `reason`, `note`, `changedBy` (`customer` from this service, `staff` from the review service).

## Status flow (shared with the review service)

```
pending -> under_review -> confirmed -> awaiting_payment -> accepted
   |            |              |               |
   +------------+--------------+---------------+--> cancelled   (customer here, or staff)
   +------------+--> rejected                                    (staff)
```

## Endpoints

| Function | Method | Path | Body / query | Success | Errors |
|---|---|---|---|---|---|
| Send a booking request | POST | /bookings | packageID, customerName, customerEmail, phone, travelers, note? | 201 + request | 400, 404, 409, 503 |
| View my requests | GET | /bookings?email=&status= | email, optional status | 200 + list | 400 |
| View one request + history | GET | /bookings/:requestID?email= | email | 200 + request with history | 400, 404 |
| Cancel my request | PATCH | /bookings/:requestID/cancel | email | 200 + request, seatsReleased, notificationPublished | 400, 404, 409 |
| Change travelers (pending only) | PATCH | /bookings/:requestID/travelers | email, travelers | 200 + request | 400, 404, 409, 503 |

## Talking to the other services

- **Package service (Marwan):** `GET /packages/:id` to check the package, `PATCH /packages/:id/reserve` and `/release` with `{ travelers }` to take and give back seats. These change the seats inside DynamoDB in one conditional step, so there is no overbooking.
- **Review and notification service (Ahmed):** reads the same `BookingRequests` and `StatusHistory` tables and moves the status. When staff reject or cancel, Ahmed's service releases the seats.
- **SNS `booking-status-topic`:** when the customer cancels, this service publishes `{ requestID, status, changedAt }`, and Ahmed's service emails the customer.

## Business rules

- Only published packages can be booked, and only if there are enough free seats.
- Seats are reserved when the request is sent, and given back when it is cancelled or travelers go down.
- If saving the request fails after the seats were reserved, the seats are given back.
- If the cancel is saved but the seats cannot be given back (package service down), the cancel still counts and the answer says `seatsReleased: false`.
- Only the email that made a request can see, change or cancel it (other emails get 404).
- If staff change the status at the same moment, the customer gets 409.
