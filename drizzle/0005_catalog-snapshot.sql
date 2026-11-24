CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
--> statement-breakpoint
CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE TABLE "catalog"."album_credit" (
	"generation" integer NOT NULL,
	"album_mbid" uuid NOT NULL,
	"position" smallint NOT NULL,
	"artist_mbid" uuid NOT NULL,
	"name" text NOT NULL,
	"join_phrase" text NOT NULL,
	CONSTRAINT "album_credit_generation_album_mbid_position_pk" PRIMARY KEY("generation","album_mbid","position")
);
--> statement-breakpoint
CREATE TABLE "catalog"."album_redirect" (
	"generation" integer NOT NULL,
	"old_mbid" uuid NOT NULL,
	"mbid" uuid NOT NULL,
	CONSTRAINT "album_redirect_generation_old_mbid_pk" PRIMARY KEY("generation","old_mbid"),
	CONSTRAINT "catalog_album_redirect_distinct" CHECK ("catalog"."album_redirect"."old_mbid" <> "catalog"."album_redirect"."mbid")
);
--> statement-breakpoint
CREATE TABLE "catalog"."album_term" (
	"generation" integer NOT NULL,
	"mbid" uuid NOT NULL,
	"source" text NOT NULL,
	"term" text NOT NULL,
	"match_key" text NOT NULL,
	"compact_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."artist_redirect" (
	"generation" integer NOT NULL,
	"old_mbid" uuid NOT NULL,
	"mbid" uuid NOT NULL,
	CONSTRAINT "artist_redirect_generation_old_mbid_pk" PRIMARY KEY("generation","old_mbid"),
	CONSTRAINT "catalog_artist_redirect_distinct" CHECK ("catalog"."artist_redirect"."old_mbid" <> "catalog"."artist_redirect"."mbid")
);
--> statement-breakpoint
CREATE TABLE "catalog"."artist_term" (
	"generation" integer NOT NULL,
	"mbid" uuid NOT NULL,
	"source" text NOT NULL,
	"term" text NOT NULL,
	"match_key" text NOT NULL,
	"compact_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."album" (
	"generation" integer NOT NULL,
	"mbid" uuid NOT NULL,
	"title" text NOT NULL,
	"credited_artist" text NOT NULL,
	"release_year" smallint,
	"release_month" smallint,
	"release_day" smallint,
	"secondary_types" text[] NOT NULL,
	"website_default" boolean NOT NULL,
	CONSTRAINT "album_generation_mbid_pk" PRIMARY KEY("generation","mbid"),
	CONSTRAINT "album_release_date_bounds" CHECK (
    "catalog"."album"."release_year" BETWEEN 1 AND 9999
    AND "catalog"."album"."release_month" BETWEEN 1 AND 12
    AND "catalog"."album"."release_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE "catalog"."artist" (
	"generation" integer NOT NULL,
	"mbid" uuid NOT NULL,
	"name" text NOT NULL,
	"disambiguation" text,
	"artist_type" text,
	CONSTRAINT "artist_generation_mbid_pk" PRIMARY KEY("generation","mbid")
);
--> statement-breakpoint
CREATE TABLE "catalog"."import_run" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "catalog"."import_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"operation" text NOT NULL,
	"source" text,
	"generation" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_category" text,
	"count_review" text
);
--> statement-breakpoint
CREATE TABLE "catalog"."state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"active_generation" integer,
	"previous_generation" integer,
	"latest_generation" integer,
	CONSTRAINT "catalog_state_singleton" CHECK ("catalog"."state"."singleton")
);
--> statement-breakpoint
CREATE TABLE "catalog"."snapshot" (
	"generation" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "catalog"."snapshot_generation_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"version" text NOT NULL,
	"source_timestamp" timestamp with time zone NOT NULL,
	"schema_sequence" integer NOT NULL,
	"replication_sequence" integer NOT NULL,
	"fixture" boolean NOT NULL,
	"validated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"album_count" integer NOT NULL,
	"artist_count" integer NOT NULL,
	"credit_count" integer NOT NULL,
	"redirect_count" integer NOT NULL,
	"term_count" integer NOT NULL,
	CONSTRAINT "snapshot_version_unique" UNIQUE("version"),
	CONSTRAINT "snapshot_source_order" UNIQUE("fixture","source_timestamp")
);
--> statement-breakpoint
ALTER TABLE "catalog"."album_credit" ADD CONSTRAINT "album_credit_generation_album_mbid_album_generation_mbid_fk" FOREIGN KEY ("generation","album_mbid") REFERENCES "catalog"."album"("generation","mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."album_credit" ADD CONSTRAINT "album_credit_generation_artist_mbid_artist_generation_mbid_fk" FOREIGN KEY ("generation","artist_mbid") REFERENCES "catalog"."artist"("generation","mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."album_redirect" ADD CONSTRAINT "album_redirect_generation_mbid_album_generation_mbid_fk" FOREIGN KEY ("generation","mbid") REFERENCES "catalog"."album"("generation","mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."album_term" ADD CONSTRAINT "album_term_generation_mbid_album_generation_mbid_fk" FOREIGN KEY ("generation","mbid") REFERENCES "catalog"."album"("generation","mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."artist_redirect" ADD CONSTRAINT "artist_redirect_generation_mbid_artist_generation_mbid_fk" FOREIGN KEY ("generation","mbid") REFERENCES "catalog"."artist"("generation","mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."artist_term" ADD CONSTRAINT "artist_term_generation_mbid_artist_generation_mbid_fk" FOREIGN KEY ("generation","mbid") REFERENCES "catalog"."artist"("generation","mbid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."album" ADD CONSTRAINT "album_generation_snapshot_generation_fk" FOREIGN KEY ("generation") REFERENCES "catalog"."snapshot"("generation") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."artist" ADD CONSTRAINT "artist_generation_snapshot_generation_fk" FOREIGN KEY ("generation") REFERENCES "catalog"."snapshot"("generation") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."import_run" ADD CONSTRAINT "import_run_generation_snapshot_generation_fk" FOREIGN KEY ("generation") REFERENCES "catalog"."snapshot"("generation") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."state" ADD CONSTRAINT "state_active_generation_snapshot_generation_fk" FOREIGN KEY ("active_generation") REFERENCES "catalog"."snapshot"("generation") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."state" ADD CONSTRAINT "state_previous_generation_snapshot_generation_fk" FOREIGN KEY ("previous_generation") REFERENCES "catalog"."snapshot"("generation") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."state" ADD CONSTRAINT "state_latest_generation_snapshot_generation_fk" FOREIGN KEY ("latest_generation") REFERENCES "catalog"."snapshot"("generation") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_credit_artist_idx" ON "catalog"."album_credit" USING btree ("generation","artist_mbid","album_mbid");--> statement-breakpoint
CREATE INDEX "catalog_album_redirect_target_idx" ON "catalog"."album_redirect" USING btree ("generation","mbid");--> statement-breakpoint
CREATE INDEX "catalog_album_term_entity_idx" ON "catalog"."album_term" USING btree ("generation","mbid","source");--> statement-breakpoint
CREATE INDEX "catalog_album_term_prefix_idx" ON "catalog"."album_term" USING btree ("generation","match_key" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "catalog_album_term_compact_idx" ON "catalog"."album_term" USING btree ("generation","compact_key" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "catalog_album_term_fuzzy_idx" ON "catalog"."album_term" USING gist ("generation" public.gist_int4_ops,"match_key" public.gist_trgm_ops);--> statement-breakpoint
CREATE INDEX "catalog_artist_redirect_target_idx" ON "catalog"."artist_redirect" USING btree ("generation","mbid");--> statement-breakpoint
CREATE INDEX "catalog_artist_term_entity_idx" ON "catalog"."artist_term" USING btree ("generation","mbid","source");--> statement-breakpoint
CREATE INDEX "catalog_artist_term_prefix_idx" ON "catalog"."artist_term" USING btree ("generation","match_key" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "catalog_artist_term_compact_idx" ON "catalog"."artist_term" USING btree ("generation","compact_key" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "catalog_artist_term_fuzzy_idx" ON "catalog"."artist_term" USING gist ("generation" public.gist_int4_ops,"match_key" public.gist_trgm_ops);--> statement-breakpoint
CREATE INDEX "catalog_album_release_idx" ON "catalog"."album" USING btree ("generation","release_year","release_month","release_day","mbid");--> statement-breakpoint
CREATE INDEX "import_run_error_idx" ON "catalog"."import_run" USING btree ("id" DESC NULLS LAST) WHERE "catalog"."import_run"."error_category" IS NOT NULL;
--> statement-breakpoint
INSERT INTO catalog.state DEFAULT VALUES;
--> statement-breakpoint
CREATE FUNCTION catalog.normalize_term(value text) RETURNS text
LANGUAGE sql STABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT left(coalesce(nullif(btrim(regexp_replace(
    public.unaccent('public.unaccent'::regdictionary, normalize(lower(normalize(value, NFKC) COLLATE "und-x-icu"), NFC)),
    '[[:space:][:punct:][:cntrl:]]+', ' ', 'g'
  )), ''), btrim(normalize(lower(value COLLATE "und-x-icu"), NFKC))), 512)
$$;
