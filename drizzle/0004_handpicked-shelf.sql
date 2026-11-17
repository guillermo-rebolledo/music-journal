INSERT INTO "album" ("id", "title", "credited_artist", "original_year") VALUES
  ('6e335887-60ba-38f0-95af-fae7774336bf', 'In Rainbows', 'Radiohead', 2007),
  ('b248d212-aace-3c3e-a23d-e13aaac1f87a', 'Getz / Gilberto', 'Stan Getz / João Gilberto featuring Antônio Carlos Jobim', 1964),
  ('48117b90-a16e-34ca-a514-19c702df1158', 'Discovery', 'Daft Punk', 2001)
ON CONFLICT ("id") DO NOTHING;
