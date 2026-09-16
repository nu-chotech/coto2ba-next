CREATE TABLE "calc_cache" (
	"goal" text NOT NULL,
	"current" text NOT NULL,
	"input" text NOT NULL,
	"ratio" real NOT NULL,
	"result" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "calc_cache_goal_current_input_ratio_pk" PRIMARY KEY("goal","current","input","ratio")
);
--> statement-breakpoint
CREATE TABLE "daily_challenges" (
	"date" date PRIMARY KEY NOT NULL,
	"goal" text NOT NULL,
	"start" text NOT NULL,
	"difficulty" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"daily_date" date,
	"difficulty" text NOT NULL,
	"goal" text NOT NULL,
	"start" text NOT NULL,
	"current" text NOT NULL,
	"current_rank" integer NOT NULL,
	"move_count" integer DEFAULT 0 NOT NULL,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"perfect" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "goal_pool" (
	"word" text PRIMARY KEY NOT NULL,
	"difficulty" text NOT NULL,
	"bot_moves" real NOT NULL,
	"description" text,
	"review_needed" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hint_cache" (
	"goal" text NOT NULL,
	"current" text NOT NULL,
	"hints" text[] NOT NULL,
	CONSTRAINT "hint_cache_goal_current_pk" PRIMARY KEY("goal","current")
);
--> statement-breakpoint
CREATE TABLE "moves" (
	"game_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"input_word" text NOT NULL,
	"ratio" real NOT NULL,
	"result" text NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moves_game_id_seq_pk" PRIMARY KEY("game_id","seq")
);
--> statement-breakpoint
CREATE TABLE "name_parts" (
	"word" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" text NOT NULL,
	"achievement" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"game_id" uuid,
	CONSTRAINT "user_achievements_user_id_achievement_pk" PRIMARY KEY("user_id","achievement")
);
--> statement-breakpoint
CREATE TABLE "vocab" (
	"word" text PRIMARY KEY NOT NULL,
	"freq_rank" integer NOT NULL,
	"is_input" boolean DEFAULT true NOT NULL,
	"is_output" boolean DEFAULT false NOT NULL,
	"is_common_noun" boolean DEFAULT false NOT NULL,
	"pos" text,
	"w2v" halfvec(200) NOT NULL,
	"pos3" real[]
);
--> statement-breakpoint
CREATE TABLE "word_descriptions" (
	"word" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_encounters" (
	"user_id" text NOT NULL,
	"word" text NOT NULL,
	"source" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_game_id" uuid,
	"first_rank" integer,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "word_encounters_user_id_word_source_pk" PRIMARY KEY("user_id","word","source")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" bigint NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_anonymous" boolean DEFAULT false,
	"display_name" text,
	"best_free_moves" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"booth" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_goal_goal_pool_word_fk" FOREIGN KEY ("goal") REFERENCES "public"."goal_pool"("word") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_challenges" ADD CONSTRAINT "daily_challenges_start_vocab_word_fk" FOREIGN KEY ("start") REFERENCES "public"."vocab"("word") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_pool" ADD CONSTRAINT "goal_pool_word_vocab_word_fk" FOREIGN KEY ("word") REFERENCES "public"."vocab"("word") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_tokens" ADD CONSTRAINT "transfer_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_encounters" ADD CONSTRAINT "word_encounters_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_tokens_user" ON "device_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_user_daily_uq" ON "games" USING btree ("user_id","daily_date");--> statement-breakpoint
CREATE INDEX "games_daily_leaderboard" ON "games" USING btree ("daily_date","move_count","hint_count","cleared_at") WHERE "games"."status" = 'cleared';--> statement-breakpoint
CREATE INDEX "games_user_created" ON "games" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "vocab_output_freq" ON "vocab" USING btree ("freq_rank") WHERE "vocab"."is_output";--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");