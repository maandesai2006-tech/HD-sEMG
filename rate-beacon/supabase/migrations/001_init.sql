-- Rate Beacon initial schema.
-- All access goes through the Next.js server with the service_role key, so RLS
-- is enabled with no public policies: anon/authenticated clients see nothing.

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  hotel_name text,
  city_code text,
  city_name text,
  currency text not null default 'USD',
  horizon_days int not null default 60 check (horizon_days between 7 and 120),
  adults int not null default 2 check (adults between 1 and 9),
  updated_at timestamptz not null default now()
);

create table if not exists hotels (
  hotel_id text primary key,          -- Amadeus hotelId
  name text not null,
  is_mine boolean not null default false,
  city_code text,
  latitude double precision,
  longitude double precision,
  added_at timestamptz not null default now()
);

create table if not exists rate_snapshots (
  id bigint generated always as identity primary key,
  hotel_id text not null references hotels(hotel_id) on delete cascade,
  check_in date not null,
  captured_on date not null default current_date,
  price numeric,
  currency text,
  available boolean not null default true,
  room_desc text,
  captured_at timestamptz not null default now(),
  unique (hotel_id, check_in, captured_on)
);

create index if not exists rate_snapshots_check_in_idx
  on rate_snapshots (check_in);
create index if not exists rate_snapshots_latest_idx
  on rate_snapshots (hotel_id, check_in, captured_on desc);

-- Manually entered own-hotel rates (used when the hotel isn't bookable via
-- Amadeus, or to override the scraped rate).
create table if not exists my_rates (
  check_in date primary key,
  price numeric,
  updated_at timestamptz not null default now()
);

-- Latest snapshot per (hotel, check-in date).
create or replace view latest_rates as
  select distinct on (hotel_id, check_in)
    hotel_id, check_in, price, currency, available, room_desc, captured_on
  from rate_snapshots
  order by hotel_id, check_in, captured_on desc;

alter table settings enable row level security;
alter table hotels enable row level security;
alter table rate_snapshots enable row level security;
alter table my_rates enable row level security;
