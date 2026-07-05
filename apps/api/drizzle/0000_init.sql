CREATE TABLE "config_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"created_by_user_id" text,
	"version" integer NOT NULL,
	"summary" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log_cursors" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"log_path" text NOT NULL,
	"file_fingerprint" text,
	"last_byte_offset" bigint DEFAULT 0 NOT NULL,
	"last_line_hash" text,
	"partial_trailing_line" text,
	"last_event_timestamp" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_pack_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"mod_pack_id" text NOT NULL,
	"version" integer NOT NULL,
	"notes" text,
	"mods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"player_id" text NOT NULL,
	"connected_at" timestamp with time zone NOT NULL,
	"disconnected_at" timestamp with time zone,
	"duration_seconds" integer,
	"disconnect_reason" text,
	"source_log_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"external_player_id" text,
	"display_name" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_events" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"player_id" text,
	"player_session_id" text,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_log_path" text NOT NULL,
	"source_line_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"provider_type" text DEFAULT 'pterodactyl' NOT NULL,
	"pterodactyl_server_id" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"max_players" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "config_revisions" ADD CONSTRAINT "config_revisions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_revisions" ADD CONSTRAINT "config_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_cursors" ADD CONSTRAINT "log_cursors_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_pack_revisions" ADD CONSTRAINT "mod_pack_revisions_mod_pack_id_mod_packs_id_fk" FOREIGN KEY ("mod_pack_id") REFERENCES "public"."mod_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_pack_revisions" ADD CONSTRAINT "mod_pack_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_packs" ADD CONSTRAINT "mod_packs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_sessions" ADD CONSTRAINT "player_sessions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_sessions" ADD CONSTRAINT "player_sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_activity" ADD CONSTRAINT "server_activity_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_activity" ADD CONSTRAINT "server_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_events" ADD CONSTRAINT "server_events_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_events" ADD CONSTRAINT "server_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_events" ADD CONSTRAINT "server_events_player_session_id_player_sessions_id_fk" FOREIGN KEY ("player_session_id") REFERENCES "public"."player_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "config_revisions_server_version_unique" ON "config_revisions" USING btree ("server_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "log_cursors_server_path_unique" ON "log_cursors" USING btree ("server_id","log_path");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_pack_revisions_pack_version_unique" ON "mod_pack_revisions" USING btree ("mod_pack_id","version");--> statement-breakpoint
CREATE INDEX "player_sessions_server_open_idx" ON "player_sessions" USING btree ("server_id","disconnected_at");--> statement-breakpoint
CREATE INDEX "player_sessions_player_idx" ON "player_sessions" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_server_external_id_unique" ON "players" USING btree ("server_id","external_player_id");--> statement-breakpoint
CREATE INDEX "players_server_name_idx" ON "players" USING btree ("server_id","display_name");--> statement-breakpoint
CREATE INDEX "server_activity_server_created_idx" ON "server_activity" USING btree ("server_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "server_events_dedupe_unique" ON "server_events" USING btree ("server_id","source_log_path","source_line_hash");--> statement-breakpoint
CREATE INDEX "server_events_server_occurred_idx" ON "server_events" USING btree ("server_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_slug_unique" ON "servers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_discord_id_unique" ON "users" USING btree ("discord_id");