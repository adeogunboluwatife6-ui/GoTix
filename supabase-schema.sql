-- Run this file in Supabase SQL Editor before using the dashboard.
-- RLS is enabled on every table. Browser clients only receive the public anon key.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'organizer' check (role in ('organizer', 'attendee', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'organizer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill organizer profiles for accounts created before the auth trigger existed.
insert into public.profiles (id, full_name, role)
select
  users.id,
  coalesce(users.raw_user_meta_data ->> 'full_name', ''),
  'organizer'
from auth.users as users
where users.raw_user_meta_data ->> 'role' = 'organizer'
on conflict (id) do nothing;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text,
  category text not null default 'other',
  format text not null default 'in_person' check (format in ('in_person', 'online', 'hybrid')),
  venue text,
  banner_url text,
  organizer_name text not null default '',
  contact_email text,
  contact_phone text,
  organizer_website text,
  organizer_instagram text,
  organizer_x text,
  capacity integer check (capacity is null or capacity > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  registration_deadline timestamptz,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'published', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_end_after_start check (ends_at > starts_at)
);

alter table public.events add column if not exists banner_url text;
alter table public.events add column if not exists organizer_name text not null default '';
alter table public.events add column if not exists contact_email text;
alter table public.events add column if not exists contact_phone text;
alter table public.events add column if not exists organizer_website text;
alter table public.events add column if not exists organizer_instagram text;
alter table public.events add column if not exists organizer_x text;
alter table public.events add column if not exists capacity integer check (capacity is null or capacity > 0);
alter table public.events add column if not exists registration_deadline timestamptz;
alter table public.events add column if not exists visibility text not null default 'public'
  check (visibility in ('public', 'private'));

create table if not exists public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  price numeric(12, 2) not null default 0 check (price >= 0),
  quantity integer not null check (quantity >= 0),
  sales_start timestamptz,
  sales_end timestamptz,
  created_at timestamptz not null default now(),
  constraint ticket_sale_dates_valid check (
    sales_start is null or sales_end is null or sales_end > sales_start
  )
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete restrict,
  attendee_id uuid references public.profiles (id) on delete set null,
  attendee_email text not null,
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  currency text not null default 'NGN',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  payment_reference text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types (id) on delete restrict,
  ticket_code uuid not null unique default gen_random_uuid(),
  attendee_name text,
  attendee_email text,
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  provider text not null,
  provider_reference text not null unique,
  amount numeric(12, 2) not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'failed', 'refunded')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  reference text unique,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.event_staff (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'checkin' check (role in ('checkin', 'manager')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists events_organizer_starts_idx on public.events (organizer_id, starts_at);
create index if not exists ticket_types_event_idx on public.ticket_types (event_id);
create index if not exists orders_event_created_idx on public.orders (event_id, created_at desc);
create index if not exists tickets_event_created_idx on public.tickets (event_id, created_at desc);
create index if not exists tickets_order_idx on public.tickets (order_id);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.ticket_types enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.tickets enable row level security;
alter table public.payments enable row level security;
alter table public.payouts enable row level security;
alter table public.event_staff enable row level security;
alter table public.notifications enable row level security;
alter table public.platform_settings enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = 'organizer');

drop policy if exists "Anyone reads published events" on public.events;
create policy "Anyone reads published events" on public.events
  for select to anon, authenticated using (status = 'published' and visibility = 'public');
drop policy if exists "Organizers read own events" on public.events;
create policy "Organizers read own events" on public.events
  for select to authenticated using (organizer_id = (select auth.uid()));
drop policy if exists "Organizers create own draft or submission" on public.events;
drop policy if exists "Organizers create own draft or published event" on public.events;
create policy "Organizers create own draft or published event" on public.events
  for insert to authenticated
  with check (
    organizer_id = (select auth.uid())
    and status in ('draft', 'published')
  );
drop policy if exists "Organizers update own unpublished events" on public.events;
drop policy if exists "Organizers update own events" on public.events;
create policy "Organizers update own events" on public.events
  for update to authenticated
  using (organizer_id = (select auth.uid()))
  with check (organizer_id = (select auth.uid()));
drop policy if exists "Organizers delete own drafts" on public.events;
create policy "Organizers delete own drafts" on public.events
  for delete to authenticated
  using (organizer_id = (select auth.uid()) and status = 'draft');

drop policy if exists "Anyone reads published ticket types" on public.ticket_types;
create policy "Anyone reads published ticket types" on public.ticket_types
  for select to anon, authenticated using (
    exists (
      select 1 from public.events e
      where e.id = event_id and e.status = 'published' and e.visibility = 'public'
    )
  );
drop policy if exists "Organizers manage ticket types for own events" on public.ticket_types;
create policy "Organizers manage ticket types for own events" on public.ticket_types
  for all to authenticated
  using (exists (
    select 1 from public.events e
    where e.id = event_id and e.organizer_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.events e
    where e.id = event_id and e.organizer_id = (select auth.uid())
      and e.status in ('draft', 'published')
  ));

drop policy if exists "Organizers read orders for own events" on public.orders;
create policy "Organizers read orders for own events" on public.orders
  for select to authenticated using (
    exists (select 1 from public.events e where e.id = event_id and e.organizer_id = (select auth.uid()))
  );
drop policy if exists "Attendees read own orders" on public.orders;
create policy "Attendees read own orders" on public.orders
  for select to authenticated using (attendee_id = (select auth.uid()));

drop policy if exists "Organizers read items for own events" on public.order_items;
create policy "Organizers read items for own events" on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      join public.events e on e.id = o.event_id
      where o.id = order_id and e.organizer_id = (select auth.uid())
    )
  );
drop policy if exists "Attendees read own order items" on public.order_items;
create policy "Attendees read own order items" on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and o.attendee_id = (select auth.uid()))
  );

drop policy if exists "Organizers read tickets for own events" on public.tickets;
create policy "Organizers read tickets for own events" on public.tickets
  for select to authenticated using (
    exists (select 1 from public.events e where e.id = event_id and e.organizer_id = (select auth.uid()))
  );
drop policy if exists "Attendees read own tickets" on public.tickets;
create policy "Attendees read own tickets" on public.tickets
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and o.attendee_id = (select auth.uid()))
  );

drop policy if exists "Organizers read payments for own events" on public.payments;
create policy "Organizers read payments for own events" on public.payments
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      join public.events e on e.id = o.event_id
      where o.id = order_id and e.organizer_id = (select auth.uid())
    )
  );
drop policy if exists "Organizers read own payouts" on public.payouts;
create policy "Organizers read own payouts" on public.payouts
  for select to authenticated using (organizer_id = (select auth.uid()));

drop policy if exists "Event owners manage staff" on public.event_staff;
create policy "Event owners manage staff" on public.event_staff
  for all to authenticated
  using (exists (
    select 1 from public.events e
    where e.id = event_id and e.organizer_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.events e
    where e.id = event_id and e.organizer_id = (select auth.uid())
  ));
drop policy if exists "Staff read own assignments" on public.event_staff;
create policy "Staff read own assignments" on public.event_staff
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications" on public.notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Deliberately no browser write policies for orders, order_items, tickets, payments,
-- payouts, or platform_settings. Create/verify payments and issue tickets from a
-- trusted Supabase Edge Function using a server-side service-role key.

notify pgrst, 'reload schema';
