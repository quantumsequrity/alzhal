-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Table 1: products
create table products (
  id uuid primary key default uuid_generate_v4(),
  product_name text not null,
  brand text,
  category text, -- food/cosmetic/household/pharma
  image_url text, -- optional, if we store images
  total_ingredients integer,
  scanned_count integer default 1,
  first_scanned_at timestamp with time zone default now(),
  last_scanned_at timestamp with time zone default now()
);

-- Table 2: ingredients
create table ingredients (
  id uuid primary key default uuid_generate_v4(),
  name text unique not null,
  simple_name text,
  chemical_formula text,
  raw_materials text,
  manufacturing_process text,
  common_uses text[],
  fda_status text,
  eu_status text,
  who_status text,
  banned_in text[],
  safe_limit text,
  concerns text[],
  category text,
  analyzed_count integer default 1
);

-- Table 3: scans
create table scans (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id),
  user_phone text, -- hashed
  input_type text, -- whatsapp_image/whatsapp_voice/web_upload/web_text
  language text,
  timestamp timestamp with time zone default now(),
  ingredients_found text[],
  response_sent boolean
);

-- Table 4: queries
create table queries (
  id uuid primary key default uuid_generate_v4(),
  scan_id uuid references scans(id),
  question text,
  question_type text, -- ingredient_detail/safety_check/comparison
  language text,
  response text,
  timestamp timestamp with time zone default now()
);

-- Table 5: analytics
create table analytics (
  id uuid primary key default uuid_generate_v4(),
  date date default current_date,
  total_scans integer default 0,
  whatsapp_scans integer default 0,
  web_scans integer default 0,
  voice_queries integer default 0,
  languages_used jsonb default '{}'::jsonb,
  top_products jsonb default '[]'::jsonb,
  top_concerns jsonb default '[]'::jsonb
);
