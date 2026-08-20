-- The fixed body already uses 15 USC 1681s-2(b). Correct only the visible
-- source/template label; do not change the course law or mailed snapshots.
update public.dispute_templates
set
  name = 'ACC - R8 - 1681s-2(b)',
  notes = replace(notes, 'ACC - R8 - 1681s-2(a)(b).docx', 'ACC - R8 - 1681s-2(b).docx'),
  updated_at = now()
where id = '3b4e12a6-d773-51da-8162-4f6776283967'
  and flow_code = 'accuracy'
  and round_number = 8;
