-- "Експедиция", "експедиране" … become "Спедиция", "спедиране" … in Bulgarian (owner, Nov 2026):
-- the task templates and the boards of orders already made from them.
update public.order_task_template_columns
   set name_bg = replace(replace(name_bg, 'Експед', 'Спед'), 'експед', 'спед')
 where name_bg ~ '[Ее]кспед';

update public.order_task_template_items
   set title_bg = replace(replace(title_bg, 'Експед', 'Спед'), 'експед', 'спед')
 where title_bg ~ '[Ее]кспед';

update public.order_task_columns
   set name_bg = replace(replace(name_bg, 'Експед', 'Спед'), 'експед', 'спед')
 where name_bg ~ '[Ее]кспед';

update public.order_tasks
   set title = replace(replace(title, 'Експед', 'Спед'), 'експед', 'спед')
 where title ~ '[Ее]кспед';
