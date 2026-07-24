-- §6 of the 2026-07-24 Metro 2 spec: XB_NOT_REMOVED_AFTER_INVESTIGATION
-- fires only for FCRA_DIRECT disputes. For FDCPA-basis disputes the CRRG
-- lets a debt buyer / third-party collection agency retain XB "as long as
-- stated in [its] policies/procedures", so those must NOT fire a violation
-- — they generate a demand for that written policy under Reg V,
-- 12 C.F.R. §1022.42 instead. That branch needs the dispute's basis
-- recorded on the letter, which nothing captured before.
alter table public.letters
  add column if not exists dispute_basis text
  check (dispute_basis is null or dispute_basis in ('FCRA_DIRECT', 'FDCPA'));

comment on column public.letters.dispute_basis is
  'Basis of the underlying dispute: FCRA_DIRECT or FDCPA. Gates XB retention analysis (CRRG Dec. 2024 Exhibit 8).';
