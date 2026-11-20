-- Run once in Supabase > SQL Editor
create table orders (
  id uuid primary key default gen_random_uuid(),
  table_no text not null,
  customer_name text,
  note text,
  items jsonb not null,
  total numeric(10,2) not null,
  status text not null default 'new' check (status in ('new','preparing','ready','served','cancelled')),
  created_at timestamptz not null default now()
);
alter table orders enable row level security;
create policy "Admin reads orders" on orders for select to authenticated using (true);
create policy "Admin updates orders" on orders for update to authenticated using (true) with check (true);
create policy "Admin deletes orders" on orders for delete to authenticated using (true);

-- Customers cannot touch the table directly. They use these two functions only.
-- Prices are read from menu_items on the server, so a customer cannot change a price.
create or replace function place_order(p_table text, p_name text, p_note text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_total numeric := 0; v_lines jsonb := '[]'::jsonb;
  r record; v_item menu_items%rowtype;
begin
  if coalesce(trim(p_table), '') = '' then raise exception 'Table number is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 40 then
    raise exception 'Invalid order';
  end if;
  for r in select (e->>'id')::bigint as id, least(greatest((e->>'qty')::int, 1), 20) as qty
           from jsonb_array_elements(p_items) e loop
    select * into v_item from menu_items where id = r.id;
    if not found or not v_item.available then raise exception 'Item not available'; end if;
    v_total := v_total + v_item.price * r.qty;
    v_lines := v_lines || jsonb_build_object('id', v_item.id, 'name', v_item.name, 'price', v_item.price, 'qty', r.qty);
  end loop;
  insert into orders (table_no, customer_name, note, items, total)
  values (left(trim(p_table), 10), left(nullif(trim(p_name), ''), 40), left(nullif(trim(p_note), ''), 200), v_lines, v_total)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function place_order(text, text, text, jsonb) to anon, authenticated;

create or replace function order_status(p_id uuid)
returns text language sql security definer set search_path = public as $$
  select status from orders where id = p_id
$$;
grant execute on function order_status(uuid) to anon, authenticated;

-- Instant updates (optional but recommended)
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table menu_items;
