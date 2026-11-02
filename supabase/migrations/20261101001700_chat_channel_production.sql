-- The channel with the facility is called производство (owner, Nov 2026).
update public.chat_channels set name = 'производство'
 where kind = 'external' and name = 'партньор'
   and not exists (select 1 from public.chat_channels where name = 'производство');
