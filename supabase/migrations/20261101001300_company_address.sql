-- The company address is 133 Knyaz Boris I Blvd. (owner, Nov 2026). Drafts follow; issued documents stay as they were issued.
alter table public.calc_settings alter column company_address set default '133 Knyaz Boris I Blvd., 9000 Varna, Bulgaria';

update public.calc_settings
   set company_address = regexp_replace(company_address, 'Knyaz +Bori[sz] +(1|I)([^A-Za-z0-9]|$)', 'Knyaz Boris I\2', 'gi')
 where company_address ~* 'Knyaz +Boriz|Knyaz +Boris +1([^0-9]|$)';

update public.invoices
   set seller = jsonb_set(seller, '{address}', to_jsonb(regexp_replace(seller ->> 'address', 'Knyaz +Bori[sz] +(1|I)([^A-Za-z0-9]|$)', 'Knyaz Boris I\2', 'gi')))
 where status = 'draft' and seller ->> 'address' ~* 'Knyaz +Boriz|Knyaz +Boris +1([^0-9]|$)';
