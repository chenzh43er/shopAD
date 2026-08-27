-- 沙特阿拉伯地区库（80 条三级地址路径，区号 966）
-- 由 scripts/generate-saudi-migration.mjs 生成，源数据：data/saudi-addresses.json

do $$
declare
  v_library_id uuid;
  v_library_name constant text := '沙特阿拉伯';
begin
  select id into v_library_id
  from public.address_libraries
  where lower(trim(name)) = lower(trim(v_library_name))
  limit 1;

  if v_library_id is null then
    insert into public.address_libraries (name, dial_code, remark)
    values (v_library_name, '966', 'Saudi Arabia / KSA')
    returning id into v_library_id;
  else
    update public.address_libraries
    set dial_code = '966',
        remark = 'Saudi Arabia / KSA',
        updated_at = now()
    where id = v_library_id;

    delete from public.address_regions where library_id = v_library_id;
  end if;

  create temp table _saudi_paths (
    l1 text not null,
    l2 text not null,
    l3 text not null
  ) on commit drop;

  insert into _saudi_paths (l1, l2, l3) values
    ('Riyadh Region','Riyadh','Al Olaya'),
    ('Riyadh Region','Riyadh','Al Malaz'),
    ('Riyadh Region','Riyadh','Al Nakheel'),
    ('Riyadh Region','Riyadh','Al Murabba'),
    ('Riyadh Region','Riyadh','Al Sulaymaniyah'),
    ('Riyadh Region','Riyadh','Al Woroud'),
    ('Riyadh Region','Riyadh','Al Sahafa'),
    ('Riyadh Region','Al Kharj','Al Kharj Center'),
    ('Riyadh Region','Al Kharj','Al Rayyan'),
    ('Riyadh Region','Al Kharj','Al Yamama'),
    ('Riyadh Region','Al Majma''ah','Al Majma''ah Center'),
    ('Riyadh Region','Diriyah','Diriyah Center'),
    ('Riyadh Region','Diriyah','Al Bujairi'),
    ('Makkah Region','Jeddah','Al Hamra'),
    ('Makkah Region','Jeddah','Al Rawdah'),
    ('Makkah Region','Jeddah','Al Shati'),
    ('Makkah Region','Jeddah','Al Salamah'),
    ('Makkah Region','Jeddah','Al Andalus'),
    ('Makkah Region','Jeddah','Al Baghdadiyah'),
    ('Makkah Region','Mecca','Al Aziziyah'),
    ('Makkah Region','Mecca','Al Shubaikah'),
    ('Makkah Region','Mecca','Al Misfalah'),
    ('Makkah Region','Mecca','Al Kakiyyah'),
    ('Makkah Region','Taif','Al Shafa'),
    ('Makkah Region','Taif','Al Hawiyah'),
    ('Makkah Region','Taif','Al Faisaliyah'),
    ('Makkah Region','Rabigh','Rabigh Center'),
    ('Madinah Region','Medina','Al Awali'),
    ('Madinah Region','Medina','Al Haram'),
    ('Madinah Region','Medina','Quba'),
    ('Madinah Region','Medina','Al Iskan'),
    ('Madinah Region','Yanbu','Yanbu Al Bahr'),
    ('Madinah Region','Yanbu','Yanbu Al Sinaiyah'),
    ('Madinah Region','Al Ula','Al Ula Center'),
    ('Eastern Province','Dammam','Al Faisaliyah'),
    ('Eastern Province','Dammam','Al Shati'),
    ('Eastern Province','Dammam','Al Adamah'),
    ('Eastern Province','Dammam','Al Mazruiyah'),
    ('Eastern Province','Khobar','Al Khobar Al Shamalia'),
    ('Eastern Province','Khobar','Al Khobar Al Janubia'),
    ('Eastern Province','Khobar','Al Ulaya'),
    ('Eastern Province','Dhahran','Dhahran Center'),
    ('Eastern Province','Dhahran','Al Doha'),
    ('Eastern Province','Jubail','Jubail Center'),
    ('Eastern Province','Jubail','Al Fanateer'),
    ('Eastern Province','Al Ahsa','Al Hofuf'),
    ('Eastern Province','Al Ahsa','Al Mubarraz'),
    ('Asir Region','Abha','Al Manhal'),
    ('Asir Region','Abha','Al Shafa'),
    ('Asir Region','Khamis Mushait','Al Khaleej'),
    ('Asir Region','Khamis Mushait','Al Rawdah'),
    ('Asir Region','Bisha','Bisha Center'),
    ('Tabuk Region','Tabuk','Al Muruj'),
    ('Tabuk Region','Tabuk','Al Faisaliyah'),
    ('Tabuk Region','Duba','Duba Center'),
    ('Tabuk Region','Haql','Haql Center'),
    ('Hail Region','Hail','Al Muntazah'),
    ('Hail Region','Hail','Al Khuzama'),
    ('Hail Region','Hail','Al Nuzha'),
    ('Northern Borders Region','Arar','Arar Center'),
    ('Northern Borders Region','Rafha','Rafha Center'),
    ('Northern Borders Region','Turaif','Turaif Center'),
    ('Jazan Region','Jazan','Al Rawdah'),
    ('Jazan Region','Jazan','Al Safa'),
    ('Jazan Region','Sabya','Sabya Center'),
    ('Jazan Region','Abu Arish','Abu Arish Center'),
    ('Najran Region','Najran','Al Faisaliyah'),
    ('Najran Region','Najran','Al Mukhaym'),
    ('Najran Region','Sharurah','Sharurah Center'),
    ('Al Bahah Region','Al Bahah','Al Zahrah'),
    ('Al Bahah Region','Al Bahah','Al Faisaliyah'),
    ('Al Bahah Region','Baljurashi','Baljurashi Center'),
    ('Al Jawf Region','Sakaka','Sakaka Center'),
    ('Al Jawf Region','Qurayyat','Qurayyat Center'),
    ('Al Jawf Region','Tabarjal','Tabarjal Center'),
    ('Al Qassim Region','Buraidah','Al Safra'),
    ('Al Qassim Region','Buraidah','Al Muruj'),
    ('Al Qassim Region','Buraidah','Al Iskan'),
    ('Al Qassim Region','Unayzah','Unayzah Center'),
    ('Al Qassim Region','Ar Rass','Ar Rass Center');

  insert into public.address_regions (library_id, parent_id, name, level, sort_order)
  select
    v_library_id,
    null,
    d.l1,
    1,
    (row_number() over (order by d.l1) - 1)::int
  from (select distinct l1 from _saudi_paths) d;

  insert into public.address_regions (library_id, parent_id, name, level, sort_order)
  select
    v_library_id,
    p.id,
    d.l2,
    2,
    (row_number() over (partition by d.l1 order by d.l2) - 1)::int
  from (select distinct l1, l2 from _saudi_paths) d
  join public.address_regions p
    on p.library_id = v_library_id
   and p.level = 1
   and p.name = d.l1;

  insert into public.address_regions (library_id, parent_id, name, level, sort_order)
  select
    v_library_id,
    p.id,
    sp.l3,
    3,
    (row_number() over (partition by sp.l1, sp.l2 order by sp.l3) - 1)::int
  from _saudi_paths sp
  join public.address_regions p
    on p.library_id = v_library_id
   and p.level = 2
   and p.name = sp.l2
  join public.address_regions p1
    on p1.id = p.parent_id
   and p1.level = 1
   and p1.name = sp.l1;
end $$;
