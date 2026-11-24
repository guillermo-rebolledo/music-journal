-- Any returned category rejects the generation. Native redirects point directly
-- to current integer IDs. A redirect UUID that is also current is invalid,
-- which excludes ambiguous paths, including cycles.
SELECT category
FROM (
  SELECT 'invalid-reference' AS category WHERE EXISTS (
    SELECT 1 FROM pg_temp.artist a LEFT JOIN pg_temp.artist_type t ON t.id = a.type
      WHERE a.type IS NOT NULL AND t.id IS NULL
    UNION ALL
    SELECT 1 FROM pg_temp.artist_credit_name n
      LEFT JOIN pg_temp.artist a ON a.id = n.artist
      LEFT JOIN pg_temp.artist_credit c ON c.id = n.artist_credit
      WHERE a.id IS NULL OR c.id IS NULL
    UNION ALL
    SELECT 1 FROM pg_temp.artist_alias a LEFT JOIN pg_temp.artist owner ON owner.id = a.owner WHERE owner.id IS NULL
    UNION ALL
    SELECT 1 FROM pg_temp.release_group_alias a LEFT JOIN pg_temp.release_group g ON g.id = a.owner WHERE g.id IS NULL
    UNION ALL
    SELECT 1 FROM pg_temp.release_group g
      LEFT JOIN pg_temp.artist_credit c ON c.id = g.artist_credit
      LEFT JOIN pg_temp.release_group_primary_type t ON t.id = g.type
      WHERE c.id IS NULL OR (g.type IS NOT NULL AND t.id IS NULL)
    UNION ALL
    SELECT 1 FROM pg_temp.release_group_secondary_type_join j
      LEFT JOIN pg_temp.release_group g ON g.id = j.release_group
      LEFT JOIN pg_temp.release_group_secondary_type t ON t.id = j.secondary_type
      WHERE g.id IS NULL OR t.id IS NULL
    UNION ALL
    SELECT 1 FROM pg_temp.release r
      LEFT JOIN pg_temp.release_group g ON g.id = r.release_group
      LEFT JOIN pg_temp.artist_credit c ON c.id = r.artist_credit
      LEFT JOIN pg_temp.release_status s ON s.id = r.status
      WHERE g.id IS NULL OR c.id IS NULL OR (r.status IS NOT NULL AND s.id IS NULL)
    UNION ALL
    SELECT 1 FROM pg_temp.release_country d LEFT JOIN pg_temp.release r ON r.id = d.release WHERE r.id IS NULL
    UNION ALL
    SELECT 1 FROM pg_temp.release_unknown_country d LEFT JOIN pg_temp.release r ON r.id = d.release WHERE r.id IS NULL
    UNION ALL
    SELECT 1 FROM pg_temp.artist_gid_redirect r LEFT JOIN pg_temp.artist a ON a.id = r.new_id
      LEFT JOIN pg_temp.artist old ON old.gid = r.gid WHERE a.id IS NULL OR old.id IS NOT NULL
    UNION ALL
    SELECT 1 FROM pg_temp.release_group_gid_redirect r LEFT JOIN pg_temp.release_group g ON g.id = r.new_id
      LEFT JOIN pg_temp.release_group old ON old.gid = r.gid WHERE g.id IS NULL OR old.id IS NOT NULL
  )
  UNION ALL
  SELECT 'invalid-credit' WHERE EXISTS (
    -- A native snapshot can contain unused credits without artist-name rows.
    SELECT c.id FROM pg_temp.artist_credit c
      LEFT JOIN pg_temp.artist_credit_name n ON n.artist_credit = c.id
      WHERE c.id IN (SELECT g.artist_credit FROM pg_temp.release_group g WHERE g.type = 1)
      GROUP BY c.id
      HAVING c.artist_count < 1 OR count(n.position) <> c.artist_count OR min(n.position) <> 0
        OR max(n.position) <> c.artist_count - 1
  )
  UNION ALL
  SELECT 'invalid-date' WHERE EXISTS (
    SELECT * FROM (
      SELECT date_year, date_month, date_day FROM pg_temp.release_country
      UNION ALL
      SELECT date_year, date_month, date_day FROM pg_temp.release_unknown_country
    ) d
    WHERE date_year NOT BETWEEN 1 AND 9999 OR date_month NOT BETWEEN 1 AND 12 OR date_day NOT BETWEEN 1 AND 31
  )
  UNION ALL
  SELECT 'invalid-source-types' WHERE
    NOT EXISTS (SELECT 1 FROM pg_temp.release_group_primary_type WHERE id = 1 AND name = 'Album')
    OR NOT EXISTS (SELECT 1 FROM pg_temp.release_status WHERE id = 1 AND name = 'Official')
) validation
LIMIT 1;
