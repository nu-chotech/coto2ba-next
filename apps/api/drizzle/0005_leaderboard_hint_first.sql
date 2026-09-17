-- ランキングを ヒント数 → 手数 → クリア時刻 の順にしたので、部分インデックスも並べ替える。
DROP INDEX "games_daily_leaderboard";--> statement-breakpoint
CREATE INDEX "games_daily_leaderboard" ON "games" USING btree ("daily_date","hint_count","move_count","cleared_at") WHERE "games"."status" = 'cleared';