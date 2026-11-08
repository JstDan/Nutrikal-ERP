-- Smart search (owner, Nov 2026): a raw material, client or product is found whether it is typed in Cyrillic or in
-- Latin letters, and with a letter wrong or missing ("цитрулин" finds Citrulline Malate, "magensium" finds
-- Magnesium). The same rules are in web/src/lib/fuzzy.ts for lists filtered in the browser; keep both alike.
-- Plain SQL and PL/pgSQL only (no extension), so it runs the same on Supabase and in the local database.

-- A sound-alike key: Cyrillic in Latin letters, accents dropped, letters that sound alike made one
create or replace function nk_search_key(p text) returns text
language plpgsql immutable parallel safe as $$
declare s text := lower(coalesce(p, ''));
begin
  -- Accents off (é → e); й and ё lose their marks too, which is what the Latin key wants
  s := regexp_replace(normalize(s, NFD), '[' || chr(768) || '-' || chr(879) || ']', '', 'g');
  -- A lone ц is the letter C (vitamin C), not the sound
  s := regexp_replace(s, '(^|[^а-яёєіїґ])ц(?![а-яёєіїґ])', '\1c', 'g');
  s := replace(replace(replace(replace(replace(replace(s, 'щ', 'sht'), 'ш', 'sh'), 'ж', 'zh'), 'ч', 'ch'), 'ю', 'iu'), 'я', 'ia');
  s := translate(s, 'абвгдеёзийклмнопрстуфхцъыьэєіїґ', 'abvgdeeziiklmnoprstufhsaiieeiig');
  s := regexp_replace(s, '[^a-z0-9]+', ' ', 'g');
  s := replace(replace(replace(replace(replace(s, 'ph', 'f'), 'th', 't'), 'sch', 'sh'), 'qu', 'kv'), 'x', 'ks');
  s := regexp_replace(s, 'c([eiy])', 's\1', 'g');
  s := regexp_replace(s, '(?<=[a-z0-9])c|c(?=[a-z0-9])', 'k', 'g');
  s := translate(s, 'qzwyj', 'ksvii');
  s := regexp_replace(s, '([a-z])\1+', '\1', 'g');
  return btrim(regexp_replace(s, '\s+', ' ', 'g'));
end $$;

-- The three-letter pieces of a word, padded as pg_trgm does
create or replace function nk_trigrams(w text) returns text[]
language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct substr('  ' || w || ' ', i, 3)), '{}')
    from generate_series(1, length(w) + 1) i
$$;

-- The letters to change, add or drop to turn one word into the other
create or replace function nk_distance(a text, b text) returns int
language plpgsql immutable parallel safe as $$
declare
  la int := length(a); lb int := length(b);
  prev int[]; cur int[]; i int; j int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $$;

-- 0 to 1: how well a text answers what was typed. Every typed word has to fit, the weakest counts:
-- 1 when it is part of the text (a word of 1-2 letters only as the start of a word); 0.8 when a word of the text,
-- or its start, is a letter away (two from 8 letters; never the first letter); else the share of its three-letter
-- pieces found in the text's best word. 0.6 and up is a hit (nk_search_hit).
create or replace function nk_search_score(p_text text, p_query text) returns real
language plpgsql immutable parallel safe as $$
declare
  q text := nk_search_key(p_query);
  h text;
  words text[];
  w text; x text; px text; t text;
  mine text[];
  allowed int;
  best real; result real := 1;
  n int;
begin
  if q = '' or p_text is null then return 0; end if;
  h := nk_search_key(p_text);
  if position(q in h) > 0 then return 1; end if;
  words := string_to_array(h, ' ');
  foreach w in array string_to_array(q, ' ') loop
    if length(w) < 3 then
      best := 0;
      foreach x in array words loop
        if left(x, length(w)) = w then best := 1; exit; end if;
      end loop;
    elsif position(w in h) > 0 then
      best := 1;
    else
      best := 0;
      mine := nk_trigrams(w);
      allowed := case when length(w) >= 8 then 2 when length(w) >= 4 then 1 else 0 end;
      foreach x in array words loop
        if allowed > 0 and left(x, 1) = left(w, 1)
           and (nk_distance(w, left(x, length(w))) <= allowed
                or (abs(length(x) - length(w)) <= allowed and nk_distance(w, x) <= allowed)) then
          best := greatest(best, 0.8);
        end if;
        -- Plain string look-ups, no query per word: this runs for every row of a list
        px := '  ' || x || ' ';
        n := 0;
        foreach t in array mine loop
          if position(t in px) > 0 then n := n + 1; end if;
        end loop;
        best := greatest(best, n::real / greatest(array_length(mine, 1), 1));
      end loop;
    end if;
    result := least(result, best);
    if result < 0.6 then return result; end if;
  end loop;
  return result;
end $$;

create or replace function nk_search_hit(p_text text, p_query text) returns boolean
language sql immutable parallel safe as $$ select nk_search_score(p_text, p_query) >= 0.6 $$;
