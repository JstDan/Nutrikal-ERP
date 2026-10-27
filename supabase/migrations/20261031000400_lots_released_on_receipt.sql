-- No quality-control step (owner, 27 Oct 2026): the QC page is removed and every new lot
-- (delivery, production count, finished batch) is released when it is received. Admin can still
-- set a lot to quarantine or rejected with set_lot_qc_status; stock adjustments are approved in Склад.
alter table public.lots alter column qc_status set default 'released';

update public.lots set qc_status = 'released', qc_decided_at = now(), qc_notes = coalesce(qc_notes, 'Released: QC step removed')
 where qc_status = 'quarantine';
