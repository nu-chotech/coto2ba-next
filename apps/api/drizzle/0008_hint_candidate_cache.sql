CREATE TABLE "hint_candidate_cache" (
	"goal" text NOT NULL,
	"current" text NOT NULL,
	"hint_version" integer NOT NULL,
	"hints" jsonb NOT NULL,
	CONSTRAINT "hint_candidate_cache_goal_current_hint_version_pk" PRIMARY KEY("goal","current","hint_version")
);
