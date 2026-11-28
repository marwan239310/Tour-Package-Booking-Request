# Package Service: Test Cases and Results

**Owner:** Package Service
**How to run:** `cd package_service/src && npm install && npm test`
**Environment:** Node.js, Express app and Lambda handler, local DynamoDB emulator (dynalite), fake Cognito signing keys, fake exchange-rate API.
**Result of the last run:** 33 passed, 0 failed.

Evidence: run `npm test` and take a screenshot of the output (each line starts with the test ID).

## Automated tests

| ID | Scenario | Type | Expected result | Actual | Pass/Fail |
|---|---|---|---|---|---|
| PS-01 | `GET /health` | Normal | 200, DynamoDB connected | 200, connected | Pass |
| PS-02 | Unknown route | Invalid | 404 JSON message | 404 JSON | Pass |
| PS-03 | POST with malformed JSON | Invalid | 400 "Request body must be valid JSON" | 400, same message | Pass |
| PS-04 | Security headers on answers | Security | nosniff, X-Frame-Options DENY, no X-Powered-By | Present | Pass |
| PS-05 | CORS preflight from team site / other site | Security | Allowed origin echoed / no allow header | As expected | Pass |
| PS-06 | List packages | Normal | 200, only the 2 published, soonest first | 2, sorted | Pass |
| PS-07 | Search `destination=ALEX` | Normal | Only Alexandria (partial, any case) | Alexandria | Pass |
| PS-08 | Search by date range + max price | Normal | Only Giza Pyramids Adventure | Giza only | Pass |
| PS-09 | Search with no matches | Normal | 200, empty list | 200, `[]` | Pass |
| PS-10 | Invalid filters (`maxPrice=abc`, `-5`, bad/impossible dates, end before start) | Invalid | 400 for each | 400 for each | Pass |
| PS-11 | View package details | Normal | 200 with itinerary list | 200, itinerary | Pass |
| PS-12 | View package that does not exist | Invalid | 404 | 404 | Pass |
| PS-13 | List drafts: no login / customer / staff | Security | 401 / 403 / 200 with 1 draft | As expected | Pass |
| PS-14 | Create package: no login / customer | Security | 401 / 403 | 401 / 403 | Pass |
| PS-15 | Expired, forged, wrong-client, garbage tokens | Security | 401 for each | 401 for each | Pass |
| PS-16 | Staff creates a package | Normal | 201, draft, seatsLeft = totalSeats, not public | As expected | Pass |
| PS-17 | Create with missing fields | Invalid | 400 naming the missing fields | 400, fields listed | Pass |
| PS-18 | Create with invalid values (negative/text price, 0 or 2.5 seats, impossible date, end before start, empty or non-list itinerary, `<script>` title, 101-char title) | Invalid | 400 for each | 400 for each | Pass |
| PS-19 | Staff publishes a package | Normal | 200, isPublished true, now in public list | As expected | Pass |
| PS-20 | Staff edits title and price | Normal | 200 with new values | As expected | Pass |
| PS-21 | Edit with negative price, `seatsLeft`, end date before saved start date, bad isPublished, unknown field | Invalid | 400 for each | 400 for each | Pass |
| PS-22 | Edit without login / edit missing package | Security / Invalid | 401 / 404 | 401 / 404 | Pass |
| PS-23 | Staff hides a package | Normal | 200, removed from public list | As expected | Pass |
| PS-24 | Reserve 4 seats (booking confirmed) | Normal | 200, seatsLeft 10 to 6 | 6 | Pass |
| PS-25 | Reserve more seats than left | Business rule | 409 | 409 | Pass |
| PS-26 | Reserve with 0, -2, 1.5, text, missing travelers / unknown package | Invalid | 400 / 404 | 400 / 404 | Pass |
| PS-27 | Raise capacity 10 to 12 with 4 booked / lower to 3 | Business rule | seatsLeft 8 / 400 | 8 / 400 | Pass |
| PS-28 | Release 4 seats / release beyond capacity | Normal / Business rule | seatsLeft 12 / 409 | 12 / 409 | Pass |
| PS-29 | Old `PATCH /packages/:id/seats` | Security | 404 (removed) | 404 | Pass |
| PS-30 | Convert price to USD | External API | 200, 600 EGP x rate, rate date | 12.3 USD, date shown | Pass |
| PS-31 | Convert: missing currency, `DOLLARS`, unsupported `XYZ`, unknown package | Invalid | 400, 400, 400, 404 | As expected | Pass |
| PS-32 | Convert while exchange-rate API is down | Failure | 502 with clear message | 502 | Pass |
| PS-33 | Lambda handler with an API Gateway event | Integration | 200, filtered list | 200 | Pass |

## Frontend checks (done in a browser)

| ID | Scenario | Expected result | Actual | Pass/Fail |
|---|---|---|---|---|
| UI-01 | Open the page | Published packages loaded from the API | 2 cards shown | Pass |
| UI-02 | Search "alex" | Only Alexandria Weekend, "1 package(s) found." | As expected | Pass |
| UI-03 | Search with max price -5 | Red error "maxPrice must be a non-negative number" | As expected | Pass |
| UI-04 | View details | Itinerary list shown | 2 activities shown | Pass |
| UI-05 | Convert price to USD | "≈ 12.3 USD (1 EGP = 0.0205 USD on ...)" | As expected | Pass |
| UI-06 | Staff signed in | Manage list with Published/Draft badges, create form visible | As expected | Pass |
| UI-07 | Create a draft | "Package created as a draft..." and Draft badge | As expected | Pass |
| UI-08 | Create with end date before start date | Error message, nothing saved | As expected | Pass |
| UI-09 | Publish the draft | Appears in the public list | As expected | Pass |
| UI-10 | Edit the package | Form fills in (including itinerary), "Package updated." | As expected | Pass |
| UI-11 | Hide the package | Removed from the public list | As expected | Pass |

## After deployment (run on Floci and add screenshots to the report)

| ID | Scenario | How | Expected |
|---|---|---|---|
| DP-01 | API is live on Lambda | Open `<API URL>/health` | `"runtime":"lambda"`, DynamoDB connected |
| DP-02 | Website is served from S3 | Open `http://localhost:4566/tour-package-web/index.html` | Packages load from the API |
| DP-03 | Staff flow on the cloud URL | Sign in, create, publish, edit, hide | Same results as UI-06 to UI-11 |
| DP-04 | Request logs in CloudWatch | `aws --endpoint-url http://localhost:4566 logs tail /aws/lambda/PackageServiceLambda --since 15m` | One line per request |
| DP-05 | Integration with the Booking service | Confirm a booking, then cancel it | seatsLeft goes down, then back up |

## Limitations

| Limitation | Reason | Proposed improvement |
|---|---|---|
| Public `GET /packages/:id` also returns hidden packages if someone knows the ID | Other services read packages by ID; hiding them there could break existing bookings | Return 404 to customers for hidden packages once the other services send a service token |
| Search uses a DynamoDB Scan, then filters | Simple and fine for a small catalogue | Add a GSI (e.g. on destination/startDate) for large data |
| Reserve/release endpoints have no service-to-service authentication | The Booking and Review services call them without a token today | Add an API key or IAM-signed calls between services |
| Exchange rates are cached for 1 hour in each Lambda instance | Rates change once a day; avoids extra calls | Shared cache (e.g. DynamoDB) if traffic grows |
| Tests use an emulator, not Floci itself | Fast and repeatable offline | Run the same requests against the deployed API Gateway URL in CI |
