CREATE TABLE "room_players" (
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"game_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "room_players_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"host_user_id" text NOT NULL,
	"difficulty" text NOT NULL,
	"goal" text NOT NULL,
	"start" text NOT NULL,
	"forbidden_inputs" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_players" ADD CONSTRAINT "room_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_code_live_uq" ON "rooms" USING btree ("code") WHERE status <> 'finished';--> statement-breakpoint
CREATE INDEX "rooms_created_at_idx" ON "rooms" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;