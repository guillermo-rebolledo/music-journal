# Display times in the listener's time zone, falling back to UTC

Status: accepted (2026-11-23)

## Context

The app stores moments as timestamps with time zone, such as when an album joined Want to Listen or when a listen was recorded. Pages are server-rendered, and the server doesn't know the listener's time zone. If the server formats a timestamp in its own zone or in UTC, a listener far from UTC sees the wrong calendar date, for example an album added late on 2026-11-22 in Mexico City shows as 2026-11-23.

## Decision

Every timestamp shown to a listener is converted to the listener's current time zone before it is formatted. If that zone is unknown or invalid, format in UTC.

- The client reports its zone, taken from `Intl.DateTimeFormat().resolvedOptions().timeZone`. The server reads that reported zone so server-rendered HTML shows the converted date on first paint. Converting after hydration would make the text change after the page appears.
- When there is no reported zone yet (for example the first request from a new device) or it isn't a valid IANA zone, the server formats in UTC.
- The display format doesn't change: dates are ISO `YYYY-MM-DD` in mono, per DESIGN.md.
- **Listen dates are excluded.** A listen date is a calendar date the listener chose, not a moment in time. Show it exactly as stored and never convert it.

## Consequences

- One shared formatting helper takes a timestamp and a time zone, so every screen formats dates the same way and the UTC fallback lives in one place.
- The same timestamp can show a different date for the same listener on two devices set to different time zones. This is intended: the date shown matches where the listener is.
- Tests that check displayed timestamps must set a browser time zone (Playwright `timezoneId`) and check the fallback separately.
