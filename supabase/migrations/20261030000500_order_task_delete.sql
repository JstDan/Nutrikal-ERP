-- Order Task Manager: deleting tasks of a board.
-- Before: only manual tasks added by hand could be deleted. Now admin deletes
-- any task of an order (also those of the template and automatic ones: only
-- this board changes, never the template); sales still deletes only the
-- manual tasks they added. Its checklist, messages, links, dependencies and
-- activity go with it (on delete cascade), so the deletion itself is written
-- to audit_log with the task as it was.

create or replace function public.delete_order_task(p_task uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.order_tasks := public.order_task_for_change(p_task);
begin
  if not public.has_role('admin')
     and (t.kind = 'auto' or t.template_key is not null or t.created_by is distinct from auth.uid()) then
    raise exception 'Only admin deletes tasks of the template; you can delete the tasks you added' using errcode = '42501';
  end if;
  if exists (select 1 from public.order_task_files where task_id = p_task and deleted_at is null) then
    raise exception 'Delete the files of the task first';
  end if;
  insert into public.audit_log (table_name, row_id, action, old_data)
  values ('order_tasks', t.id::text, 'DELETE', to_jsonb(t));
  delete from public.order_tasks where id = p_task;
  perform public.order_task_renumber(t.column_id);
end
$$;
