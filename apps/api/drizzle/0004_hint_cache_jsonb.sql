-- ヒントが「語」から「語 + 混ぜる比率」になったので hints を jsonb にする。
-- 旧形式（text[]）のキャッシュは比率を持たないため、捨てて再計算させるのが正しい。
TRUNCATE TABLE "hint_cache";--> statement-breakpoint
ALTER TABLE "hint_cache" ALTER COLUMN "hints" SET DATA TYPE jsonb USING to_jsonb("hints");
