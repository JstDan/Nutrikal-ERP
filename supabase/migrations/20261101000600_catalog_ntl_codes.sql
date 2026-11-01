-- =====================================================================
-- Permanent NTL codes for the new products (owner, Nov 2026). Existing
-- categories continue their numbers; new categories get WH, MH, GH, HC, BJ,
-- LC and LP. The temporary code stays in the internal notes.
-- =====================================================================

update public.catalog_products p
   set internal_notes = concat_ws(E'\n', 'Temporary code: ' || p.code, p.internal_notes),
       image = '/catalog/' || v.code || '.webp',
       code = v.code
  from (values
  ('NEW-001', 'NTL-EN122'),
  ('NEW-002', 'NTL-EN123'),
  ('NEW-003', 'NTL-EN124'),
  ('NEW-004', 'NTL-EN125'),
  ('NEW-005', 'NTL-EN126'),
  ('NEW-006', 'NTL-EN127'),
  ('NEW-007', 'NTL-EN128'),
  ('NEW-008', 'NTL-EN129'),
  ('NEW-009', 'NTL-EN130'),
  ('NEW-010', 'NTL-EN131'),
  ('NEW-011', 'NTL-EN132'),
  ('NEW-012', 'NTL-C105'),
  ('NEW-013', 'NTL-WH101'),
  ('NEW-014', 'NTL-WH102'),
  ('NEW-015', 'NTL-MH101'),
  ('NEW-016', 'NTL-MH102'),
  ('NEW-017', 'NTL-MH103'),
  ('NEW-018', 'NTL-GH101'),
  ('NEW-019', 'NTL-GH102'),
  ('NEW-020', 'NTL-GH103'),
  ('NEW-021', 'NTL-GH104'),
  ('NEW-022', 'NTL-GH105'),
  ('NEW-023', 'NTL-HC101'),
  ('NEW-024', 'NTL-HC102'),
  ('NEW-025', 'NTL-BJ101'),
  ('NEW-026', 'NTL-BJ102'),
  ('NEW-027', 'NTL-TH118'),
  ('NEW-028', 'NTL-TH119'),
  ('NEW-029', 'NTL-TH120'),
  ('NEW-030', 'NTL-LC101'),
  ('NEW-031', 'NTL-LC102'),
  ('NEW-032', 'NTL-LC103'),
  ('NEW-033', 'NTL-SP111'),
  ('NEW-034', 'NTL-SP112'),
  ('NEW-035', 'NTL-LP101'),
  ('NEW-036', 'NTL-LP102'),
  ('NEW-037', 'NTL-LP103'),
  ('NEW-038', 'NTL-LP104'),
  ('NEW-039', 'NTL-LP105'),
  ('NEW-040', 'NTL-WH103'),
  ('NEW-041', 'NTL-TH121'),
  ('NEW-044', 'NTL-TH122'),
  ('NEW-045', 'NTL-LC104'),
  ('NEW-046', 'NTL-MH104')
  ) as v (old_code, code)
 where p.code = v.old_code;

-- The same product under its new code in what was already sent
update public.catalog_enquiry_lines l
   set product_code = p.code
  from public.catalog_products p
 where p.id = l.product_id and l.product_code like 'NEW-%';
