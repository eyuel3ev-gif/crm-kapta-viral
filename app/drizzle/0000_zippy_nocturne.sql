CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"old_values" jsonb,
	"new_values" jsonb,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"lead_id" uuid,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "form_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_text_snapshot" text NOT NULL,
	"answer_text" text,
	"answer_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "form_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"question_text" text NOT NULL,
	"field_type" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"options" jsonb
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_version_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text,
	"idempotency_key" text,
	CONSTRAINT "form_submissions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "forms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "launch_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"launch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"event_type" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'launch' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"timezone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"offer_name" text,
	"ticket_cents" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_attribution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"touch" text DEFAULT 'first' NOT NULL,
	"source" text DEFAULT 'unknown' NOT NULL,
	"medium" text,
	"campaign_id" text,
	"campaign_name" text,
	"adset_id" text,
	"adset_name" text,
	"ad_id" text,
	"ad_name" text,
	"creative_id" text,
	"creative_name" text,
	"placement" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"fbclid" text,
	"fbp" text,
	"fbc" text,
	"landing_url" text,
	"referrer_url" text,
	"raw_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_merge_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_a_id" uuid NOT NULL,
	"lead_b_id" uuid NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"method" text NOT NULL,
	"reasons" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"launch_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"full_name" text NOT NULL,
	"phone_raw" text,
	"phone_normalized" text,
	"email_raw" text,
	"email_normalized" text,
	"city" text,
	"country" char(2) DEFAULT 'ES' NOT NULL,
	"channel" text DEFAULT 'form' NOT NULL,
	"instagram_username" text,
	"external_contact_id" text,
	"conversation_url" text,
	"status" text DEFAULT 'new' NOT NULL,
	"contact_status" text DEFAULT 'not_attempted' NOT NULL,
	"qualification_status" text DEFAULT 'not_assessed' NOT NULL,
	"interest_level" text,
	"live_confirmation" text,
	"webinar_attended" boolean,
	"eligible_for_setter" boolean DEFAULT false NOT NULL,
	"assigned_setter_id" uuid,
	"assigned_closer_id" uuid,
	"next_action_type" text,
	"next_action_at" timestamp with time zone,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualified_at" timestamp with time zone,
	"won_at" timestamp with time zone,
	"lost_at" timestamp with time zone,
	"merged_into_lead_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "loss_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "loss_reasons_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "meeting_schedule_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"old_scheduled_at" timestamp with time zone NOT NULL,
	"new_scheduled_at" timestamp with time zone NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"closer_id" uuid,
	"launch_id" uuid NOT NULL,
	"meeting_number" integer NOT NULL,
	"external_provider" text,
	"external_booking_id" text,
	"event_type_id" text,
	"timezone_original" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"commercial_result" text DEFAULT 'pending' NOT NULL,
	"confirmation_24h_status" text,
	"notes" text,
	"phantom_url" text,
	"recording_url" text,
	"follow_up_reason" text,
	"follow_up_at" timestamp with time zone,
	"next_action" text,
	"loss_reason_id" uuid,
	"loss_reason_notes" text,
	"cancelled_at" timestamp with time zone,
	"no_show_marked_at" timestamp with time zone,
	"manual_review_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objection_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "objection_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"installment_number" integer,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"meeting_id" uuid,
	"closer_id" uuid,
	"launch_id" uuid NOT NULL,
	"source" text DEFAULT 'crm' NOT NULL,
	"external_id" text,
	"amount_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"payment_method" text NOT NULL,
	"financing_status" text DEFAULT 'not_applicable' NOT NULL,
	"financing_provider" text,
	"installments" integer,
	"installment_cents" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"idempotency_key" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "setter_call_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"setter_call_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_text_snapshot" text NOT NULL,
	"answer_text" text,
	"answer_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "setter_call_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_type" text NOT NULL,
	"code" text NOT NULL,
	"question_text" text NOT NULL,
	"field_type" text DEFAULT 'textarea' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setter_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"setter_id" uuid NOT NULL,
	"launch_id" uuid NOT NULL,
	"call_type" text NOT NULL,
	"call_group_id" uuid NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"parent_call_id" uuid,
	"meeting_id" uuid,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"answered" boolean,
	"result_code" text,
	"interest_level" text,
	"qualification" text,
	"disqualification_reason" text,
	"attendance_intent" text,
	"meeting_confirmation" text,
	"notes" text,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"launch_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"reason" text,
	"task_type" text NOT NULL,
	"category" text DEFAULT 'commercial' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"impact" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"automation_rule_code" text,
	"dedupe_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"assignee_id" uuid,
	"created_by_id" uuid,
	"related_lead_id" uuid,
	"related_meeting_id" uuid,
	"related_setter_call_id" uuid,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"completion_outcome" text,
	"cancelled_reason" text,
	"superseded_by_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	CONSTRAINT "user_roles_user_id_role_code_pk" PRIMARY KEY("user_id","role_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'Europe/Madrid' NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_assigned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text,
	"payload" jsonb NOT NULL,
	"payload_hash" text,
	"status" text DEFAULT 'received' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_question_id_form_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."form_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_questions" ADD CONSTRAINT "form_questions_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_version_id_form_versions_id_fk" FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_events" ADD CONSTRAINT "launch_events_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activity" ADD CONSTRAINT "lead_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_attribution" ADD CONSTRAINT "lead_attribution_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_merge_candidates" ADD CONSTRAINT "lead_merge_candidates_lead_a_id_leads_id_fk" FOREIGN KEY ("lead_a_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_merge_candidates" ADD CONSTRAINT "lead_merge_candidates_lead_b_id_leads_id_fk" FOREIGN KEY ("lead_b_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_merge_candidates" ADD CONSTRAINT "lead_merge_candidates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tokens" ADD CONSTRAINT "lead_tokens_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_setter_id_users_id_fk" FOREIGN KEY ("assigned_setter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_closer_id_users_id_fk" FOREIGN KEY ("assigned_closer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_schedule_history" ADD CONSTRAINT "meeting_schedule_history_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_schedule_history" ADD CONSTRAINT "meeting_schedule_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_closer_id_users_id_fk" FOREIGN KEY ("closer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_closer_id_users_id_fk" FOREIGN KEY ("closer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setter_call_answers" ADD CONSTRAINT "setter_call_answers_setter_call_id_setter_calls_id_fk" FOREIGN KEY ("setter_call_id") REFERENCES "public"."setter_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setter_call_answers" ADD CONSTRAINT "setter_call_answers_question_id_setter_call_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."setter_call_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setter_calls" ADD CONSTRAINT "setter_calls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setter_calls" ADD CONSTRAINT "setter_calls_setter_id_users_id_fk" FOREIGN KEY ("setter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setter_calls" ADD CONSTRAINT "setter_calls_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_related_lead_id_leads_id_fk" FOREIGN KEY ("related_lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_related_meeting_id_meetings_id_fk" FOREIGN KEY ("related_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_related_setter_call_id_setter_calls_id_fk" FOREIGN KEY ("related_setter_call_id") REFERENCES "public"."setter_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "domain_events_pending_idx" ON "domain_events" USING btree ("processed_at","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_lead_idx" ON "domain_events" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "form_answers_submission_idx" ON "form_answers" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_questions_uq" ON "form_questions" USING btree ("form_version_id","code");--> statement-breakpoint
CREATE INDEX "form_submissions_lead_idx" ON "form_submissions" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_versions_uq" ON "form_versions" USING btree ("form_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "launch_events_launch_code_uq" ON "launch_events" USING btree ("launch_id","code");--> statement-breakpoint
CREATE INDEX "lead_activity_lead_idx" ON "lead_activity" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_attribution_lead_touch_uq" ON "lead_attribution" USING btree ("lead_id","touch");--> statement-breakpoint
CREATE INDEX "lead_attribution_campaign_idx" ON "lead_attribution" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "lead_attribution_ad_idx" ON "lead_attribution" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX "lead_tokens_lead_idx" ON "lead_tokens" USING btree ("lead_id","purpose");--> statement-breakpoint
CREATE INDEX "leads_launch_registered_idx" ON "leads" USING btree ("launch_id","registered_at");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone_normalized");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_setter_idx" ON "leads" USING btree ("assigned_setter_id","next_action_at");--> statement-breakpoint
CREATE INDEX "leads_closer_idx" ON "leads" USING btree ("assigned_closer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_external_contact_uq" ON "leads" USING btree ("external_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_lead_number_uq" ON "meetings" USING btree ("lead_id","meeting_number");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_external_uq" ON "meetings" USING btree ("external_provider","external_booking_id");--> statement-breakpoint
CREATE INDEX "meetings_closer_idx" ON "meetings" USING btree ("closer_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "meetings_lead_idx" ON "meetings" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "meetings_status_idx" ON "meetings" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "payments_sale_idx" ON "payments" USING btree ("sale_id","due_at");--> statement-breakpoint
CREATE INDEX "sales_closer_idx" ON "sales" USING btree ("closer_id","closed_at");--> statement-breakpoint
CREATE INDEX "sales_lead_idx" ON "sales" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_external_uq" ON "sales" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "setter_call_answers_call_idx" ON "setter_call_answers" USING btree ("setter_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setter_call_questions_uq" ON "setter_call_questions" USING btree ("call_type","code","version");--> statement-breakpoint
CREATE UNIQUE INDEX "setter_calls_group_attempt_uq" ON "setter_calls" USING btree ("call_group_id","attempt_number");--> statement-breakpoint
CREATE INDEX "setter_calls_lead_idx" ON "setter_calls" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "setter_calls_setter_idx" ON "setter_calls" USING btree ("setter_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_lead_idx" ON "tasks" USING btree ("related_lead_id");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_uq" ON "webhook_events" USING btree ("provider","external_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status","received_at");