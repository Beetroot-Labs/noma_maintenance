-- One building, two site_locations, ten devices (split 5/5 across the two locations), and
-- one barcode per device. `:short` is substituted by applyPreset() so the building name
-- and barcode codes are unique across tenants in a single suite run. Barcodes follow the
-- format `BC<7-digit zero-padded index>-<8-char tenant short>`, which fits in VARCHAR(18).
--
-- Stacked with users_basic. The `lead_creates_shift` spec depends only on the building
-- existing and being returned by /api/labeling/buildings; future specs may rely on the
-- specific device + barcode counts.

WITH new_building AS (
  INSERT INTO buildings (tenant_id, name, address)
  VALUES (:tenant_id, 'Test Building :short', 'Test Street 1, :short City')
  RETURNING id
),
new_locations AS (
  INSERT INTO site_locations (tenant_id, building_id, floor, wing, room, location_description)
  SELECT :tenant_id, nb.id, locs.floor, locs.wing, locs.room, locs.description
  FROM new_building nb,
       (VALUES
         ('1', 'A', '101', 'Floor 1, Wing A, Room 101'),
         ('2', 'B', '202', 'Floor 2, Wing B, Room 202')
       ) AS locs(floor, wing, room, description)
  RETURNING id, room
),
new_devices AS (
  INSERT INTO devices (tenant_id, location_id, kind, brand, model)
  SELECT :tenant_id,
         nl.id,
         'FAN_COIL'::device_kind,
         'Carrier',
         'Model-' || LPAD(gs.idx::text, 2, '0')
  FROM new_locations nl,
       generate_series(1, 5) AS gs(idx)
  RETURNING id
),
indexed_devices AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM new_devices
)
INSERT INTO barcodes (tenant_id, code, device_id)
SELECT :tenant_id,
       'BC' || LPAD(rn::text, 7, '0') || '-:short',
       id
FROM indexed_devices;
