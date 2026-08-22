-- The Skool operating rule retires letter wording every seven weeks. Preserve
-- every template row and mailed snapshot; only normalize the next-review date.

alter table public.dispute_templates
  drop constraint if exists dispute_templates_review_dates_check,
  drop constraint if exists dispute_templates_seven_week_review_check;

update public.dispute_templates
set review_due_on = published_on + 49
where review_due_on is distinct from published_on + 49;

alter table public.dispute_templates
  add constraint dispute_templates_review_dates_check
    check (review_due_on >= published_on),
  add constraint dispute_templates_seven_week_review_check
    check (review_due_on = published_on + 49);

comment on column public.dispute_templates.review_due_on is
  'Seven-week (49-day) staff wording-review deadline. It never rewrites or retires a version automatically.';

-- Rollback: remove only dispute_templates_seven_week_review_check and deploy
-- the prior scheduling UI. Do not delete versions or mailed-letter snapshots.
