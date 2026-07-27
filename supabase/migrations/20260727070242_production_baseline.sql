


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
  declare
    pending_profile record;
  begin
    select * into pending_profile
    from public.client_profiles
    where email = new.email
    limit 1;

    if found then
      insert into public.profiles (id, full_name, role)
      values (new.id, pending_profile.full_name, 'client')
      on conflict (id) do update set role = 'client', full_name = pending_profile.full_name;

      update public.client_profiles
      set user_id = new.id
      where email = new.email and user_id = '00000000-0000-0000-0000-000000000000';
    end if;

    return new;
  end;
  $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_client_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  declare
    allowed_cols text[] := array[
      'lpoa_signed', 'lpoa_signed_at', 'lpoa_signature_data',
      'monitoring_service', 'monitoring_email', 'monitoring_enrolled', 'monitoring_portal_url'
    ];
    col    text;
    merged jsonb;
  begin
    if auth.uid() is null then
      null;
    elsif exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'auditor')
    ) then
      null;
    else
      merged := to_jsonb(old);
      foreach col in array allowed_cols loop
        merged := jsonb_set(merged, array[col], to_jsonb(new) -> col);
      end loop;
      new := jsonb_populate_record(new, merged);
    end if;

    if new.billing_status is distinct from old.billing_status then
      new.status_changed_at := now();
    else
      new.status_changed_at := old.status_changed_at;
    end if;

    return new;
  end;
  $$;


ALTER FUNCTION "public"."protect_client_columns"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."affiliates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "name" "text" NOT NULL,
    "company" "text",
    "email" "text",
    "commission_rate" numeric DEFAULT 0.20,
    "brand_name" "text",
    "brand_color" "text" DEFAULT '#22C55E'::"text",
    "brand_logo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."affiliates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ag_directory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "state" "text" NOT NULL,
    "agency_name" "text" NOT NULL,
    "portal_url" "text",
    "mail_address" "text",
    "attachment_notes" "text",
    "fcra_scope_confirmed" boolean DEFAULT false NOT NULL,
    "source_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ag_directory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "mode" "text" NOT NULL,
    "files" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "stage" "text",
    "pct" numeric,
    "tokens" integer DEFAULT 0 NOT NULL,
    "result" "jsonb",
    "usage" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "selected_client_id" "uuid",
    "selected_client_is_new" boolean DEFAULT false NOT NULL,
    CONSTRAINT "audit_jobs_mode_check" CHECK (("mode" = ANY (ARRAY['combined'::"text", 'individual'::"text", 'single'::"text"]))),
    CONSTRAINT "audit_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'done'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."audit_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audits" (
    "id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_name" "text" NOT NULL,
    "client_address" "text",
    "report_date" "text" NOT NULL,
    "saved_at" timestamp with time zone DEFAULT "now"(),
    "audit" "jsonb" NOT NULL,
    "created_by" "uuid",
    "client_id" "uuid"
);


ALTER TABLE "public"."audits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "category" "text" NOT NULL,
    "month" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "business_expenses_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "business_expenses_category_check" CHECK (("category" = ANY (ARRAY['subscription'::"text", 'variable'::"text"]))),
    CONSTRAINT "business_expenses_month_check" CHECK ((("month" IS NULL) OR ("month" ~ '^\d{4}-\d{2}$'::"text")))
);


ALTER TABLE "public"."business_expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_name" "text" NOT NULL,
    "norm_furnisher" "text",
    "display_furnisher" "text",
    "original_creditor" "text",
    "account_last4" "text",
    "needs_review" boolean DEFAULT false NOT NULL,
    "review_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_id" "uuid"
);


ALTER TABLE "public"."client_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "full_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "address" "text",
    "date_of_birth" "text",
    "onboarding_complete" boolean DEFAULT false,
    "onboarding_step" integer DEFAULT 0,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "nmi_vault_id" "text",
    "card_last4" "text",
    "card_type" "text",
    "card_expiry" "text",
    "signature_data" "text",
    "signature_signed_at" timestamp with time zone,
    "agreement_signed_at" timestamp with time zone,
    "agreement_pdf_path" "text",
    "lpoa_url" "text",
    "client_id" "uuid"
);


ALTER TABLE "public"."client_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_sensitive_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "ssn_last4" "text",
    "monitoring_password" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_sensitive_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "is_vip" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "email" "text",
    "lpoa_signed" boolean DEFAULT false,
    "lpoa_signed_at" timestamp with time zone,
    "lpoa_signature_data" "jsonb",
    "phone" "text",
    "date_of_birth" "text",
    "monitoring_service" "text" DEFAULT 'Privacy Guard'::"text",
    "monitoring_email" "text",
    "monitoring_enrolled" boolean DEFAULT false,
    "monitoring_portal_url" "text" DEFAULT 'https://www.privacyguard.com'::"text",
    "referral_source" "text",
    "notes" "text",
    "tags" "text"[],
    "enrollment_date" "date",
    "score_eq_start" integer,
    "score_exp_start" integer,
    "score_tu_start" integer,
    "referred_by" "uuid",
    "referral_fee" numeric,
    "commission_paid" boolean DEFAULT false,
    "commission_paid_at" timestamp with time zone,
    "monitoring_not_required" boolean DEFAULT false,
    "status" "text" DEFAULT 'active'::"text",
    "lead_source" "text",
    "lead_phone" "text",
    "lead_notes" "text",
    "lead_created_at" timestamp with time zone DEFAULT "now"(),
    "lead_drips_sent" "jsonb" DEFAULT '[]'::"jsonb",
    "billing_status" "text",
    "billing_type" "text",
    "ledger" "jsonb" DEFAULT '[]'::"jsonb",
    "billing_start_date" "date",
    "billing_tier" "text",
    "exit_reason" "text",
    "status_changed_at" timestamp with time zone,
    "lead_viewed_at" timestamp with time zone,
    "winback_notifications_sent" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sign_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lpoa_document_hash" "text",
    CONSTRAINT "clients_billing_status_enum" CHECK ((("billing_status" IS NULL) OR ("billing_status" = ANY (ARRAY['Active'::"text", 'Paused'::"text", 'Graduated'::"text", 'Inactive'::"text"])))),
    CONSTRAINT "clients_exit_reason_enum" CHECK ((("exit_reason" IS NULL) OR ("exit_reason" = ANY (ARRAY['graduated'::"text", 'non_payment'::"text", 'dissatisfied'::"text", 'went_dark'::"text", 'client_paused'::"text", 'price'::"text", 'other'::"text"])))),
    CONSTRAINT "clients_exit_reason_required" CHECK ((("billing_status" IS NULL) OR ("billing_status" = 'Active'::"text") OR ("exit_reason" IS NOT NULL)))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commission_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "affiliate_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "client_name" "text" NOT NULL,
    "covered_tx_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "paid_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paid_by" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."commission_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deletions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_name" "text" NOT NULL,
    "furnisher" "text" NOT NULL,
    "account_type" "text",
    "bureau" "text" NOT NULL,
    "deletion_confirmed_at" timestamp with time zone DEFAULT "now"(),
    "fee_amount" numeric NOT NULL,
    "fee_charged" boolean DEFAULT false,
    "fee_charged_at" timestamp with time zone,
    "nmi_transaction_id" "text",
    "created_by" "uuid",
    "notes" "text"
);


ALTER TABLE "public"."deletions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_name" "text" NOT NULL,
    "doc_type" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "uploaded_at" timestamp with time zone DEFAULT "now"(),
    "client_id" "uuid"
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."escalations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "client_account_id" "uuid",
    "phase3_letter_id" "text",
    "track" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "state" "text",
    "furnisher_name" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "cfpb_category" "text",
    "cfpb_sub_issue" "text",
    "narrative" "text",
    "attachments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "filed_at" timestamp with time zone,
    "response_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ag_narrative" "text",
    "key_facts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "recommended_attachments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "escalations_channel_check" CHECK (("channel" = ANY (ARRAY['cfpb'::"text", 'state_ag'::"text"]))),
    CONSTRAINT "escalations_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'ready'::"text", 'filed'::"text", 'responded'::"text", 'closed'::"text"]))),
    CONSTRAINT "escalations_track_check" CHECK (("track" = ANY (ARRAY['furnisher'::"text", 'bureau'::"text"])))
);


ALTER TABLE "public"."escalations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."furnisher_addresses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "furnisher_key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "address_line1" "text" NOT NULL,
    "address_line2" "text",
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "zip" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."furnisher_addresses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "name" "text",
    "email" "text",
    "phone" "text",
    "chat_summary" "text",
    "status" "text" DEFAULT 'new'::"text"
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."letters" (
    "id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_name" "text" NOT NULL,
    "furnisher" "text" NOT NULL,
    "account_id" "text",
    "phase" "text" DEFAULT 'Phase 1'::"text",
    "type" "text",
    "saved_at" timestamp with time zone DEFAULT "now"(),
    "date" "text" NOT NULL,
    "html" "text" NOT NULL,
    "mailed_date" "text",
    "response_outcome" "text",
    "response_date" "text",
    "created_by" "uuid",
    "lob_id" "text",
    "tracking_number" "text",
    "tracking_status" "text",
    "delivered_at" timestamp with time zone,
    "notifications_sent" "jsonb" DEFAULT '[]'::"jsonb",
    "summary" "text",
    "covered_furnishers" "jsonb" DEFAULT '[]'::"jsonb",
    "phase2_analysis" "jsonb",
    "phase2_analyzed_at" timestamp with time zone,
    "return_receipt_url" "text",
    "response_file_url" "text",
    "enclosure_parse_blocked" boolean DEFAULT false NOT NULL,
    "enclosure_parse_issues" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "dispute_basis" "text",
    "client_account_id" "uuid",
    "client_id" "uuid",
    "bureau_review_status" "text" DEFAULT 'not_reviewed'::"text" NOT NULL,
    "bureau_next_action" "text",
    "bureau_review_notes" "text",
    "bureau_reviewed_at" timestamp with time zone,
    CONSTRAINT "letters_bureau_review_status_check" CHECK (("bureau_review_status" = ANY (ARRAY['not_reviewed'::"text", 'resolved'::"text", 'follow_up'::"text", 'needs_documents'::"text", 'escalated'::"text"]))),
    CONSTRAINT "letters_dispute_basis_check" CHECK ((("dispute_basis" IS NULL) OR ("dispute_basis" = ANY (ARRAY['FCRA_DIRECT'::"text", 'FDCPA'::"text"]))))
);


ALTER TABLE "public"."letters" OWNER TO "postgres";


COMMENT ON COLUMN "public"."letters"."dispute_basis" IS 'Basis of the underlying dispute: FCRA_DIRECT or FDCPA. Gates XB retention analysis (CRRG Dec. 2024 Exhibit 8).';



CREATE TABLE IF NOT EXISTS "public"."lob_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_key" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "lob_id" "text" NOT NULL,
    "letter_id" "text",
    "event_occurred_at" timestamp with time zone,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lob_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lpoa_audit_log" (
    "client_id" "uuid",
    "client_name" "text" NOT NULL,
    "document_hash" "text" NOT NULL,
    "document_url" "text",
    "signer_name" "text",
    "ip" "text",
    "user_agent" "text",
    "lpoa_type" "text" DEFAULT 'standard'::"text" NOT NULL,
    "signed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lpoa_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mail_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "letter_id" "text" NOT NULL,
    "lob_id" "text" NOT NULL,
    "artifact_type" "text" NOT NULL,
    "storage_bucket" "text" DEFAULT 'documents'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "content_type" "text",
    "byte_size" bigint,
    "sha256" "text",
    "status" "text" DEFAULT 'archived'::"text" NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mail_artifacts_artifact_type_check" CHECK (("artifact_type" = ANY (ARRAY['mailpiece_pdf'::"text", 'return_receipt'::"text"]))),
    CONSTRAINT "mail_artifacts_status_check" CHECK (("status" = ANY (ARRAY['archived'::"text", 'unavailable'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."mail_artifacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mail_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "letter_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "requested_by" "uuid",
    "idempotency_key" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "lob_id" "text",
    "tracking_number" "text",
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_attempt_at" timestamp with time zone,
    "submitted_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mail_submissions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'submitted'::"text", 'failed'::"text", 'accepted_unreconciled'::"text"])))
);


ALTER TABLE "public"."mail_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phase2_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "letter_id" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "files" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "stage" "text",
    "pct" numeric,
    "tokens" integer DEFAULT 0 NOT NULL,
    "result" "jsonb",
    "usage" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    CONSTRAINT "phase2_jobs_kind_check" CHECK (("kind" = ANY (ARRAY['response'::"text", 'non_response'::"text"]))),
    CONSTRAINT "phase2_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'done'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."phase2_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."phase4_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "escalation_id" "uuid" NOT NULL,
    "stage" "text",
    "pct" numeric,
    "tokens" integer DEFAULT 0 NOT NULL,
    "result" "jsonb",
    "usage" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    CONSTRAINT "phase4_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'done'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."phase4_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text",
    "role" "text" DEFAULT 'auditor'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."progress_updates" (
    "id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_name" "text" NOT NULL,
    "from_audit_id" "text",
    "to_audit_id" "text",
    "from_report_date" "date",
    "to_report_date" "date",
    "diff" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "narrative" "text",
    "narrative_generated_at" timestamp with time zone,
    "narrative_model" "text",
    "emailed_at" timestamp with time zone,
    "client_id" "uuid"
);


ALTER TABLE "public"."progress_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_intake_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ip" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."public_intake_attempts" OWNER TO "postgres";


ALTER TABLE ONLY "public"."affiliates"
    ADD CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ag_directory"
    ADD CONSTRAINT "ag_directory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_jobs"
    ADD CONSTRAINT "audit_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audits"
    ADD CONSTRAINT "audits_pkey" PRIMARY KEY ("user_id", "id");



ALTER TABLE ONLY "public"."business_expenses"
    ADD CONSTRAINT "business_expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_accounts"
    ADD CONSTRAINT "client_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_email_unique" UNIQUE ("email");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."client_sensitive_data"
    ADD CONSTRAINT "client_sensitive_data_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."client_sensitive_data"
    ADD CONSTRAINT "client_sensitive_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_sign_token_key" UNIQUE ("sign_token");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_user_id_name_key" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."commission_payouts"
    ADD CONSTRAINT "commission_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deletions"
    ADD CONSTRAINT "deletions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_user_client_type" UNIQUE ("user_id", "client_name", "doc_type");



ALTER TABLE ONLY "public"."escalations"
    ADD CONSTRAINT "escalations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."furnisher_addresses"
    ADD CONSTRAINT "furnisher_addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."furnisher_addresses"
    ADD CONSTRAINT "furnisher_addresses_user_id_furnisher_key_key" UNIQUE ("user_id", "furnisher_key");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."letters"
    ADD CONSTRAINT "letters_pkey" PRIMARY KEY ("user_id", "id");



ALTER TABLE ONLY "public"."lob_webhook_events"
    ADD CONSTRAINT "lob_webhook_events_event_key_key" UNIQUE ("event_key");



ALTER TABLE ONLY "public"."lob_webhook_events"
    ADD CONSTRAINT "lob_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mail_artifacts"
    ADD CONSTRAINT "mail_artifacts_lob_id_artifact_type_key" UNIQUE ("lob_id", "artifact_type");



ALTER TABLE ONLY "public"."mail_artifacts"
    ADD CONSTRAINT "mail_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mail_submissions"
    ADD CONSTRAINT "mail_submissions_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."mail_submissions"
    ADD CONSTRAINT "mail_submissions_letter_id_key" UNIQUE ("letter_id");



ALTER TABLE ONLY "public"."mail_submissions"
    ADD CONSTRAINT "mail_submissions_lob_id_key" UNIQUE ("lob_id");



ALTER TABLE ONLY "public"."mail_submissions"
    ADD CONSTRAINT "mail_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phase2_jobs"
    ADD CONSTRAINT "phase2_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."phase4_jobs"
    ADD CONSTRAINT "phase4_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."progress_updates"
    ADD CONSTRAINT "progress_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_intake_attempts"
    ADD CONSTRAINT "public_intake_attempts_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "ag_directory_state_agency_idx" ON "public"."ag_directory" USING "btree" ("state", "agency_name");



CREATE INDEX "audit_jobs_user_created_idx" ON "public"."audit_jobs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "audits_user_client_idx" ON "public"."audits" USING "btree" ("user_id", "client_id");



CREATE INDEX "client_accounts_client_id_idx" ON "public"."client_accounts" USING "btree" ("user_id", "client_id");



CREATE INDEX "client_accounts_client_idx" ON "public"."client_accounts" USING "btree" ("user_id", "client_name");



CREATE INDEX "client_profiles_client_id_idx" ON "public"."client_profiles" USING "btree" ("client_id");



CREATE UNIQUE INDEX "documents_user_client_doctype_idx" ON "public"."documents" USING "btree" ("user_id", "client_id", "doc_type");



CREATE INDEX "escalations_client_id_idx" ON "public"."escalations" USING "btree" ("client_id");



CREATE INDEX "escalations_user_id_idx" ON "public"."escalations" USING "btree" ("user_id");



CREATE INDEX "furnisher_addresses_key_idx" ON "public"."furnisher_addresses" USING "btree" ("user_id", "furnisher_key");



CREATE INDEX "letters_user_client_idx" ON "public"."letters" USING "btree" ("user_id", "client_id");



CREATE INDEX "lob_webhook_events_letter_idx" ON "public"."lob_webhook_events" USING "btree" ("letter_id", "received_at" DESC);



CREATE INDEX "lob_webhook_events_lob_idx" ON "public"."lob_webhook_events" USING "btree" ("lob_id", "received_at" DESC);



CREATE INDEX "lpoa_audit_log_client_idx" ON "public"."lpoa_audit_log" USING "btree" ("client_id", "signed_at" DESC);



CREATE INDEX "mail_artifacts_client_id_idx" ON "public"."mail_artifacts" USING "btree" ("client_id");



CREATE INDEX "mail_artifacts_letter_id_idx" ON "public"."mail_artifacts" USING "btree" ("letter_id");



CREATE INDEX "mail_submissions_client_idx" ON "public"."mail_submissions" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "mail_submissions_status_idx" ON "public"."mail_submissions" USING "btree" ("status", "updated_at");



CREATE INDEX "phase2_jobs_user_created_idx" ON "public"."phase2_jobs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "phase4_jobs_user_created_idx" ON "public"."phase4_jobs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "progress_updates_user_client_idx" ON "public"."progress_updates" USING "btree" ("user_id", "client_id");



CREATE INDEX "public_intake_attempts_ip_created_idx" ON "public"."public_intake_attempts" USING "btree" ("ip", "created_at" DESC);



CREATE OR REPLACE TRIGGER "trg_protect_client_columns" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."protect_client_columns"();



ALTER TABLE ONLY "public"."affiliates"
    ADD CONSTRAINT "affiliates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."audit_jobs"
    ADD CONSTRAINT "audit_jobs_selected_client_id_fkey" FOREIGN KEY ("selected_client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_jobs"
    ADD CONSTRAINT "audit_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audits"
    ADD CONSTRAINT "audits_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audits"
    ADD CONSTRAINT "audits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."audits"
    ADD CONSTRAINT "audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."business_expenses"
    ADD CONSTRAINT "business_expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_accounts"
    ADD CONSTRAINT "client_accounts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_sensitive_data"
    ADD CONSTRAINT "client_sensitive_data_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "public"."affiliates"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commission_payouts"
    ADD CONSTRAINT "commission_payouts_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id");



ALTER TABLE ONLY "public"."commission_payouts"
    ADD CONSTRAINT "commission_payouts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."commission_payouts"
    ADD CONSTRAINT "commission_payouts_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."deletions"
    ADD CONSTRAINT "deletions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."deletions"
    ADD CONSTRAINT "deletions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."escalations"
    ADD CONSTRAINT "escalations_client_account_id_fkey" FOREIGN KEY ("client_account_id") REFERENCES "public"."client_accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."escalations"
    ADD CONSTRAINT "escalations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."furnisher_addresses"
    ADD CONSTRAINT "furnisher_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."letters"
    ADD CONSTRAINT "letters_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."letters"
    ADD CONSTRAINT "letters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."letters"
    ADD CONSTRAINT "letters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lpoa_audit_log"
    ADD CONSTRAINT "lpoa_audit_log_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mail_artifacts"
    ADD CONSTRAINT "mail_artifacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mail_artifacts"
    ADD CONSTRAINT "mail_artifacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mail_submissions"
    ADD CONSTRAINT "mail_submissions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mail_submissions"
    ADD CONSTRAINT "mail_submissions_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mail_submissions"
    ADD CONSTRAINT "mail_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phase2_jobs"
    ADD CONSTRAINT "phase2_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phase4_jobs"
    ADD CONSTRAINT "phase4_jobs_escalation_id_fkey" FOREIGN KEY ("escalation_id") REFERENCES "public"."escalations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."phase4_jobs"
    ADD CONSTRAINT "phase4_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."progress_updates"
    ADD CONSTRAINT "progress_updates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



CREATE POLICY "Admin manages deletions" ON "public"."deletions" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can manage affiliates" ON "public"."affiliates" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



CREATE POLICY "Affiliate select for auth lookup" ON "public"."affiliates" FOR SELECT USING (true);



CREATE POLICY "Affiliates can read own record" ON "public"."affiliates" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Affiliates can update own user_id" ON "public"."affiliates" FOR UPDATE USING (("email" = (( SELECT "users"."email"
   FROM "auth"."users"
  WHERE ("users"."id" = "auth"."uid"())
 LIMIT 1))::"text")) WITH CHECK (("email" = (( SELECT "users"."email"
   FROM "auth"."users"
  WHERE ("users"."id" = "auth"."uid"())
 LIMIT 1))::"text"));



CREATE POLICY "Client sees own deletions" ON "public"."deletions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "admin_update_profiles" ON "public"."profiles" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'admin'::"text")))));



ALTER TABLE "public"."affiliates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ag_directory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_jobs_insert_own" ON "public"."audit_jobs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "audit_jobs_select_own" ON "public"."audit_jobs" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."audits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "business_expenses_staff_all" ON "public"."business_expenses" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



ALTER TABLE "public"."client_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_insert_own_documents" ON "public"."documents" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."client_profiles" "cp"
  WHERE (("cp"."user_id" = "auth"."uid"()) AND ((("cp"."client_id" IS NOT NULL) AND ("cp"."client_id" = "documents"."client_id")) OR ("cp"."full_name" = "documents"."client_name"))))));



ALTER TABLE "public"."client_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_profiles_insert_own_or_staff" ON "public"."client_profiles" FOR INSERT WITH CHECK ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"])))))));



CREATE POLICY "client_profiles_select_own_or_staff" ON "public"."client_profiles" FOR SELECT USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"])))))));



CREATE POLICY "client_profiles_update_own_or_staff" ON "public"."client_profiles" FOR UPDATE USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))))) WITH CHECK ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"])))))));



CREATE POLICY "client_read_own_audits" ON "public"."audits" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."client_profiles" "cp"
  WHERE (("cp"."user_id" = "auth"."uid"()) AND ((("cp"."client_id" IS NOT NULL) AND ("cp"."client_id" = "audits"."client_id")) OR ("cp"."full_name" = "audits"."client_name"))))));



CREATE POLICY "client_read_own_documents" ON "public"."documents" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."client_profiles" "cp"
  WHERE (("cp"."user_id" = "auth"."uid"()) AND ((("cp"."client_id" IS NOT NULL) AND ("cp"."client_id" = "documents"."client_id")) OR ("cp"."full_name" = "documents"."client_name"))))));



CREATE POLICY "client_read_own_letters" ON "public"."letters" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."client_profiles" "cp"
  WHERE (("cp"."user_id" = "auth"."uid"()) AND ((("cp"."client_id" IS NOT NULL) AND ("cp"."client_id" = "letters"."client_id")) OR ("cp"."full_name" = "letters"."client_name"))))));



CREATE POLICY "client_read_own_meta" ON "public"."clients" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."client_profiles" "cp"
  WHERE (("cp"."user_id" = "auth"."uid"()) AND ("cp"."full_name" = "clients"."name")))));



CREATE POLICY "client_read_own_progress" ON "public"."progress_updates" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."client_profiles" "cp"
  WHERE (("cp"."user_id" = "auth"."uid"()) AND ((("cp"."client_id" IS NOT NULL) AND ("cp"."client_id" = "progress_updates"."client_id")) OR ("cp"."full_name" = "progress_updates"."client_name"))))));



ALTER TABLE "public"."client_sensitive_data" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_update_own_meta" ON "public"."clients" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."client_profiles" "cp"
  WHERE (("cp"."user_id" = "auth"."uid"()) AND ("cp"."full_name" = "clients"."name")))));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_payouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deletions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."escalations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."furnisher_addresses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "furnisher_addresses_staff_all" ON "public"."furnisher_addresses" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



CREATE POLICY "insert_own_profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."letters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lob_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lpoa_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mail_artifacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mail_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."phase2_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phase2_jobs_insert_own" ON "public"."phase2_jobs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "phase2_jobs_select_own" ON "public"."phase2_jobs" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."phase4_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phase4_jobs_insert_own" ON "public"."phase4_jobs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "phase4_jobs_select_own" ON "public"."phase4_jobs" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."progress_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."public_intake_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_all_profiles" ON "public"."profiles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "staff_all_audits" ON "public"."audits" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (("p"."role" = 'admin'::"text") OR ("audits"."user_id" = "p"."id"))))));



CREATE POLICY "staff_all_client_accounts" ON "public"."client_accounts" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



CREATE POLICY "staff_all_clients" ON "public"."clients" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (("p"."role" = 'admin'::"text") OR ("clients"."user_id" = "p"."id"))))));



CREATE POLICY "staff_all_commission_payouts" ON "public"."commission_payouts" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



CREATE POLICY "staff_all_documents" ON "public"."documents" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (("p"."role" = 'admin'::"text") OR ("documents"."user_id" = "p"."id"))))));



CREATE POLICY "staff_all_escalations" ON "public"."escalations" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (("p"."role" = 'admin'::"text") OR ("escalations"."user_id" = "p"."id"))))));



CREATE POLICY "staff_all_letters" ON "public"."letters" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (("p"."role" = 'admin'::"text") OR ("letters"."user_id" = "p"."id"))))));



CREATE POLICY "staff_all_progress" ON "public"."progress_updates" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (("p"."role" = 'admin'::"text") OR ("progress_updates"."user_id" = "p"."id"))))));



CREATE POLICY "staff_read_ag_directory" ON "public"."ag_directory" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



CREATE POLICY "staff_read_lob_webhook_events" ON "public"."lob_webhook_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



CREATE POLICY "staff_read_lpoa_audit_log" ON "public"."lpoa_audit_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."clients" "c"
     JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("c"."id" = "lpoa_audit_log"."client_id") AND (("p"."role" = 'admin'::"text") OR ("c"."user_id" = "p"."id"))))));



CREATE POLICY "staff_read_mail_artifacts" ON "public"."mail_artifacts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



CREATE POLICY "staff_read_mail_submissions" ON "public"."mail_submissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



CREATE POLICY "staff_update_ag_directory" ON "public"."ag_directory" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'admin'::"text")))));



CREATE POLICY "staff_update_mail_artifacts" ON "public"."mail_artifacts" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"text", 'auditor'::"text"]))))));



CREATE POLICY "staff_write_ag_directory" ON "public"."ag_directory" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'admin'::"text")))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_client_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_client_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_client_columns"() TO "service_role";


















GRANT ALL ON TABLE "public"."affiliates" TO "anon";
GRANT ALL ON TABLE "public"."affiliates" TO "authenticated";
GRANT ALL ON TABLE "public"."affiliates" TO "service_role";



GRANT ALL ON TABLE "public"."ag_directory" TO "anon";
GRANT ALL ON TABLE "public"."ag_directory" TO "authenticated";
GRANT ALL ON TABLE "public"."ag_directory" TO "service_role";



GRANT ALL ON TABLE "public"."audit_jobs" TO "anon";
GRANT ALL ON TABLE "public"."audit_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."audits" TO "anon";
GRANT ALL ON TABLE "public"."audits" TO "authenticated";
GRANT ALL ON TABLE "public"."audits" TO "service_role";



GRANT ALL ON TABLE "public"."business_expenses" TO "anon";
GRANT ALL ON TABLE "public"."business_expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."business_expenses" TO "service_role";



GRANT ALL ON TABLE "public"."client_accounts" TO "anon";
GRANT ALL ON TABLE "public"."client_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."client_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."client_profiles" TO "anon";
GRANT ALL ON TABLE "public"."client_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."client_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."client_sensitive_data" TO "anon";
GRANT ALL ON TABLE "public"."client_sensitive_data" TO "authenticated";
GRANT ALL ON TABLE "public"."client_sensitive_data" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."commission_payouts" TO "anon";
GRANT ALL ON TABLE "public"."commission_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."deletions" TO "anon";
GRANT ALL ON TABLE "public"."deletions" TO "authenticated";
GRANT ALL ON TABLE "public"."deletions" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."escalations" TO "anon";
GRANT ALL ON TABLE "public"."escalations" TO "authenticated";
GRANT ALL ON TABLE "public"."escalations" TO "service_role";



GRANT ALL ON TABLE "public"."furnisher_addresses" TO "anon";
GRANT ALL ON TABLE "public"."furnisher_addresses" TO "authenticated";
GRANT ALL ON TABLE "public"."furnisher_addresses" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."letters" TO "anon";
GRANT ALL ON TABLE "public"."letters" TO "authenticated";
GRANT ALL ON TABLE "public"."letters" TO "service_role";



GRANT ALL ON TABLE "public"."lob_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."lob_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."lob_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."lpoa_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."lpoa_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."lpoa_audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."mail_artifacts" TO "anon";
GRANT ALL ON TABLE "public"."mail_artifacts" TO "authenticated";
GRANT ALL ON TABLE "public"."mail_artifacts" TO "service_role";



GRANT ALL ON TABLE "public"."mail_submissions" TO "anon";
GRANT ALL ON TABLE "public"."mail_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."mail_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."phase2_jobs" TO "anon";
GRANT ALL ON TABLE "public"."phase2_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."phase2_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."phase4_jobs" TO "anon";
GRANT ALL ON TABLE "public"."phase4_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."phase4_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."progress_updates" TO "anon";
GRANT ALL ON TABLE "public"."progress_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."progress_updates" TO "service_role";



GRANT ALL ON TABLE "public"."public_intake_attempts" TO "anon";
GRANT ALL ON TABLE "public"."public_intake_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."public_intake_attempts" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
