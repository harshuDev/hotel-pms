-- 0080 let the public `hotel-assets` bucket take SVG. An SVG can carry
-- script, and in a PUBLIC bucket anyone opening the object's URL directly
-- would run it. An <img> never executes it, which is all the invoice does,
-- but a raster logo loses nothing -- so the bucket takes only the three
-- raster types, as room-photos does.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'hotel-assets';
