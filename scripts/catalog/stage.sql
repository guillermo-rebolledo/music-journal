-- Schema sequence 31 COPY column order. Only core tables used in the projection
-- are loaded. Unused fields preserve their slots in the native dump format.
CREATE TEMP TABLE artist (
  id integer PRIMARY KEY, gid uuid NOT NULL UNIQUE, name text NOT NULL, sort_name text,
  begin_year smallint, begin_month smallint, begin_day smallint,
  end_year smallint, end_month smallint, end_day smallint,
  type integer, area integer, gender integer, comment text NOT NULL, edits_pending integer,
  last_updated timestamptz, ended boolean, begin_area integer, end_area integer
) ON COMMIT DROP;

CREATE TEMP TABLE artist_credit (
  id integer PRIMARY KEY, name text NOT NULL, artist_count smallint NOT NULL,
  ref_count integer, created timestamptz, edits_pending integer, gid uuid
) ON COMMIT DROP;

CREATE TEMP TABLE artist_credit_name (
  artist_credit integer NOT NULL, position smallint NOT NULL, artist integer NOT NULL,
  name text NOT NULL, join_phrase text NOT NULL, PRIMARY KEY (artist_credit, position)
) ON COMMIT DROP;

CREATE TEMP TABLE release_group (
  id integer PRIMARY KEY, gid uuid NOT NULL UNIQUE, name text NOT NULL,
  artist_credit integer NOT NULL, type integer, comment text, edits_pending integer,
  last_updated timestamptz
) ON COMMIT DROP;

CREATE TEMP TABLE release (
  id integer PRIMARY KEY, gid uuid NOT NULL UNIQUE, name text, artist_credit integer NOT NULL,
  release_group integer NOT NULL, status integer, packaging integer, language integer,
  script integer, barcode text, comment text, edits_pending integer, quality smallint,
  last_updated timestamptz
) ON COMMIT DROP;

CREATE TEMP TABLE release_country (
  release integer NOT NULL, country integer NOT NULL, date_year smallint,
  date_month smallint, date_day smallint, PRIMARY KEY (release, country)
) ON COMMIT DROP;

CREATE TEMP TABLE release_unknown_country (
  release integer PRIMARY KEY, date_year smallint, date_month smallint, date_day smallint
) ON COMMIT DROP;

CREATE TEMP TABLE release_group_secondary_type_join (
  release_group integer NOT NULL, secondary_type integer NOT NULL, created timestamptz,
  PRIMARY KEY (release_group, secondary_type)
) ON COMMIT DROP;

CREATE TEMP TABLE artist_alias (
  id integer PRIMARY KEY, owner integer NOT NULL, name text NOT NULL, locale text,
  edits_pending integer, last_updated timestamptz, type integer, sort_name text,
  begin_year smallint, begin_month smallint, begin_day smallint,
  end_year smallint, end_month smallint, end_day smallint, primary_for_locale boolean, ended boolean
) ON COMMIT DROP;

CREATE TEMP TABLE release_group_alias (LIKE pg_temp.artist_alias INCLUDING INDEXES) ON COMMIT DROP;

CREATE TEMP TABLE artist_gid_redirect (
  gid uuid PRIMARY KEY, new_id integer NOT NULL, created timestamptz
) ON COMMIT DROP;

CREATE TEMP TABLE release_group_gid_redirect (LIKE pg_temp.artist_gid_redirect INCLUDING INDEXES) ON COMMIT DROP;

CREATE TEMP TABLE artist_type (
  id integer PRIMARY KEY, name text NOT NULL, parent integer, child_order integer, description text, gid uuid
) ON COMMIT DROP;

CREATE TEMP TABLE release_group_primary_type (LIKE pg_temp.artist_type INCLUDING INDEXES) ON COMMIT DROP;
CREATE TEMP TABLE release_group_secondary_type (LIKE pg_temp.artist_type INCLUDING INDEXES) ON COMMIT DROP;
CREATE TEMP TABLE release_status (LIKE pg_temp.artist_type INCLUDING INDEXES) ON COMMIT DROP;
