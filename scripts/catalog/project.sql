INSERT INTO catalog.artist (generation, mbid, name, disambiguation, artist_type)
SELECT current_setting('catalog_import.generation')::int, a.gid, a.name, nullif(a.comment, ''), t.name
FROM pg_temp.artist a
LEFT JOIN pg_temp.artist_type t ON t.id = a.type;

WITH first_date AS (
  SELECT DISTINCT ON (r.release_group) r.release_group, d.date_year, d.date_month, d.date_day
  FROM (
    SELECT release, date_year, date_month, date_day FROM pg_temp.release_country
    UNION ALL
    SELECT release, date_year, date_month, date_day FROM pg_temp.release_unknown_country
  ) d
  JOIN pg_temp.release r ON r.id = d.release
  WHERE r.status IS DISTINCT FROM 6
    AND (d.date_year IS NOT NULL OR d.date_month IS NOT NULL OR d.date_day IS NOT NULL)
  ORDER BY r.release_group, d.date_year NULLS LAST, d.date_month NULLS LAST, d.date_day NULLS LAST
),
release_status AS (
  SELECT release_group, bool_or(status IN (1, 5) OR status IS NULL) AS website_default
  FROM pg_temp.release GROUP BY release_group
),
secondary_types AS (
  SELECT j.release_group, array_agg(t.name ORDER BY t.name) AS names
  FROM pg_temp.release_group_secondary_type_join j
  JOIN pg_temp.release_group_secondary_type t ON t.id = j.secondary_type
  GROUP BY j.release_group
),
credits AS (
  SELECT artist_credit, string_agg(name || join_phrase, '' ORDER BY position) AS display
  FROM pg_temp.artist_credit_name GROUP BY artist_credit
)
INSERT INTO catalog.album (
  generation, mbid, title, credited_artist, release_year, release_month, release_day, secondary_types, website_default
)
SELECT current_setting('catalog_import.generation')::int, g.gid, g.name, c.display,
  d.date_year, d.date_month, d.date_day, coalesce(t.names, '{}'), coalesce(s.website_default, true)
FROM pg_temp.release_group g
JOIN credits c ON c.artist_credit = g.artist_credit
LEFT JOIN first_date d ON d.release_group = g.id
LEFT JOIN release_status s ON s.release_group = g.id
LEFT JOIN secondary_types t ON t.release_group = g.id
WHERE g.type = 1;

INSERT INTO catalog.album_credit (generation, album_mbid, position, artist_mbid, name, join_phrase)
SELECT current_setting('catalog_import.generation')::int, g.gid, n.position, a.gid, n.name, n.join_phrase
FROM pg_temp.release_group g
JOIN pg_temp.artist_credit_name n ON n.artist_credit = g.artist_credit
JOIN pg_temp.artist a ON a.id = n.artist
WHERE g.type = 1;

INSERT INTO catalog.album_redirect (generation, old_mbid, mbid)
SELECT current_setting('catalog_import.generation')::int, r.gid, g.gid
FROM pg_temp.release_group_gid_redirect r JOIN pg_temp.release_group g ON g.id = r.new_id
WHERE g.type = 1;

INSERT INTO catalog.artist_redirect (generation, old_mbid, mbid)
SELECT current_setting('catalog_import.generation')::int, r.gid, a.gid
FROM pg_temp.artist_gid_redirect r JOIN pg_temp.artist a ON a.id = r.new_id;

WITH terms AS (
  SELECT a.gid AS mbid, 'canonical' AS source, a.name AS term FROM pg_temp.artist a
  UNION ALL
  SELECT a.gid, 'alias', n.name FROM pg_temp.artist_alias n JOIN pg_temp.artist a ON a.id = n.owner
  UNION ALL
  SELECT DISTINCT a.gid, 'credit', n.name
  FROM pg_temp.artist_credit_name n JOIN pg_temp.artist a ON a.id = n.artist
  WHERE n.name <> a.name
),
normalized AS (
  SELECT mbid, source, term, catalog.normalize_term(term) AS match_key FROM terms
)
INSERT INTO catalog.artist_term (generation, mbid, source, term, match_key, compact_key)
SELECT current_setting('catalog_import.generation')::int, mbid, source, term, match_key, replace(match_key, ' ', '')
FROM normalized WHERE match_key <> '';

WITH terms AS (
  SELECT a.mbid, word.source, word.term
  FROM catalog.album a
  CROSS JOIN LATERAL (VALUES
    ('canonical', a.title), ('credit', a.credited_artist),
    ('title_credit', a.title || ' ' || a.credited_artist),
    ('credit_title', a.credited_artist || ' ' || a.title)
  ) word(source, term)
  WHERE a.generation = current_setting('catalog_import.generation')::int
  UNION ALL
  SELECT a.mbid, word.source, word.term
  FROM pg_temp.release_group_alias n
  JOIN pg_temp.release_group g ON g.id = n.owner
  JOIN catalog.album a ON a.generation = current_setting('catalog_import.generation')::int AND a.mbid = g.gid
  CROSS JOIN LATERAL (VALUES
    ('alias', n.name),
    ('alias_credit', n.name || ' ' || a.credited_artist),
    ('credit_alias', a.credited_artist || ' ' || n.name)
  ) word(source, term)
  WHERE g.type = 1
),
normalized AS (
  SELECT mbid, source, term, catalog.normalize_term(term) AS match_key FROM terms
)
INSERT INTO catalog.album_term (generation, mbid, source, term, match_key, compact_key)
SELECT current_setting('catalog_import.generation')::int, mbid, source, term, match_key, replace(match_key, ' ', '')
FROM normalized WHERE match_key <> '';
