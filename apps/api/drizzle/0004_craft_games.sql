CREATE TABLE IF NOT EXISTS "craft_games" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "difficulty" text NOT NULL,
  "goal" text NOT NULL,
  "start" text NOT NULL,
  "current" text NOT NULL,
  "current_rank" integer NOT NULL,
  "turn" integer DEFAULT 0 NOT NULL,
  "combo" integer DEFAULT 0 NOT NULL,
  "combo_enabled" boolean DEFAULT true NOT NULL,
  "goal_bias_enabled" boolean DEFAULT true NOT NULL,
  "previous_similarity" real,
  "active_set_id" uuid,
  "active_options" jsonb,
  "history" text[] NOT NULL,
  "status" text DEFAULT 'playing' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "craft_games_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS "craft_games_user_created" ON "craft_games" ("user_id", "created_at");
