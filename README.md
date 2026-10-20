# Gather — Event Organizer Dashboard

A responsive organizer dashboard built with plain HTML, CSS, and JavaScript. Supabase Auth, Postgres, Row Level Security, and Realtime provide the backend; the dashboard does not use hardcoded sample business data.

## Get started

1. Create a Supabase project.
2. In the Supabase dashboard for the project configured in `supabase-config.js`, open **SQL Editor**, create a query, paste the entire contents of [`supabase-schema.sql`](./supabase-schema.sql), and click **Run**. Running SQL in the local editor does not apply it to Supabase.
3. In Supabase project settings, copy the project URL and **anon/public** key into [`supabase-config.js`](./supabase-config.js).
4. Serve this folder from a local web server, for example with the VS Code Live Server extension, then open `index.html`.
5. Create an organizer account from the sign-in screen. If email confirmation is enabled in Supabase, confirm your email before signing in.

The anon/public key is intended for browser use. Keep Row Level Security enabled. **Never** put a Supabase service-role key, payment secret, or other server credential in `supabase-config.js` or any other frontend file.

## Included

- Organizer sign-up/sign-in and sign-out using Supabase Auth.
- Organizer-scoped event creation with title, category, format, description, cover URL, venue, dates, capacity, registration deadline, public/private visibility, organizer contacts, social links, draft saving, and immediate publishing.
- Live dashboard summaries for events, issued tickets, attendees, and verified order revenue.
- Sales chart, upcoming events, recent orders, attendee/ticket tables, finance summary, and account settings.
- Supabase Realtime refreshes for event, order, and ticket changes.
- Postgres schema and RLS policies for profiles, events, ticket types, orders, attendees/tickets, payments, payouts, staff, and notifications.
- A public event discovery page at `public.html` with published events, ticket types, and your Monnify payment link.

## Security and next steps

Orders, payments, and tickets intentionally have no browser-side write policies. A trusted Supabase Edge Function or other server must verify payment-provider webhooks, safely create paid orders, and issue tickets. Do not treat a browser redirect or client-side payment message as proof of payment.

Organizers can publish public events immediately; their published events and ticket types become visible on the event discovery page. Drafts remain private. Applying the schema updates the RLS policies and publishes existing pending events. The schema creates profiles for new accounts and backfills existing accounts with organizer role metadata. If Supabase reports a missing `public.events` table or organizer profile foreign-key error, run the full SQL file in that project's Supabase SQL Editor, confirm the query succeeds, and reload the app. The script requests a PostgREST schema-cache refresh at the end. The public Monnify button opens the configured shared link, but it does not send the selected event, ticket type, or price to Monnify. It does not verify payment, reserve inventory, create an order, or issue a ticket. Complete ticket checkout requires a trusted server-side Monnify integration and webhook verification. Ticket-type management, QR scanning, payouts, and admin tools are represented in the data model or navigation but are not yet implemented as workflows.
