BEGIN;

DO $$
DECLARE
    building_count INTEGER;
    device_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO building_count
    FROM buildings
    WHERE lower(name) = lower('Kálmán Tömb');

    IF building_count <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one building named "Kálmán Tömb", found %', building_count;
    END IF;

    SELECT COUNT(*)
    INTO device_count
    FROM devices d
    JOIN site_locations sl
      ON sl.tenant_id = d.tenant_id
     AND sl.id = d.location_id
    JOIN buildings b
      ON b.tenant_id = sl.tenant_id
     AND b.id = sl.building_id
    WHERE lower(b.name) = lower('Kálmán Tömb');

    IF device_count < 15 THEN
        RAISE EXCEPTION 'Expected at least 15 devices in "Kálmán Tömb", found %', device_count;
    END IF;
END $$;

WITH barcode_seed(seq, code) AS (
    VALUES
        (1, '002208'),
        (2, '003304'),
        (3, '011584'),
        (4, '008199'),
        (5, '013428'),
        (6, '013076'),
        (7, '007782'),
        (8, '007846'),
        (9, '001300'),
        (10, '010399'),
        (11, '016597'),
        (12, '008408'),
        (13, '010947'),
        (14, '000142'),
        (15, '013980')
),
target_building AS (
    SELECT tenant_id, id AS building_id
    FROM buildings
    WHERE lower(name) = lower('Kálmán Tömb')
),
target_devices AS (
    SELECT
        d.tenant_id,
        d.id AS device_id,
        ROW_NUMBER() OVER (
            ORDER BY
                CASE sl.floor
                    WHEN 'pince' THEN 0
                    WHEN 'földszint' THEN 1
                    WHEN '1. emelet' THEN 2
                    WHEN '2. emelet' THEN 3
                    WHEN '3. emelet' THEN 4
                    WHEN '4. emelet' THEN 5
                    WHEN '5. emelet' THEN 6
                    WHEN '6. emelet' THEN 7
                    WHEN 'Tetőtér' THEN 8
                    ELSE 999
                END,
                sl.floor,
                sl.wing,
                sl.room,
                sl.location_description,
                d.kind,
                d.brand,
                d.model,
                d.serial_number,
                d.id
        ) AS seq
    FROM devices d
    JOIN site_locations sl
      ON sl.tenant_id = d.tenant_id
     AND sl.id = d.location_id
    JOIN target_building tb
      ON tb.tenant_id = sl.tenant_id
     AND tb.building_id = sl.building_id
),
barcode_assignments AS (
    SELECT
        td.tenant_id,
        td.device_id,
        bs.code
    FROM target_devices td
    JOIN barcode_seed bs
      ON bs.seq = td.seq
),
created_by_user AS (
    SELECT
        tb.tenant_id,
        COALESCE(
            (
                SELECT u.id
                FROM users u
                WHERE u.tenant_id = tb.tenant_id
                  AND u.email = 'floomatik@nomahutes.hu'
                LIMIT 1
            ),
            (
                SELECT u.id
                FROM users u
                WHERE u.tenant_id = tb.tenant_id
                ORDER BY u.created_at, u.id
                LIMIT 1
            )
        ) AS user_id
    FROM target_building tb
),
deactivated_existing AS (
    UPDATE barcodes b
    SET deactivated_at = NOW()
    FROM barcode_assignments ba
    WHERE b.tenant_id = ba.tenant_id
      AND b.device_id = ba.device_id
      AND b.deactivated_at IS NULL
      AND b.code <> ba.code
    RETURNING b.id
)
INSERT INTO barcodes (
    tenant_id,
    code,
    device_id,
    deactivated_at,
    created_by
)
SELECT
    ba.tenant_id,
    ba.code,
    ba.device_id,
    NULL,
    cbu.user_id
FROM barcode_assignments ba
JOIN created_by_user cbu
  ON cbu.tenant_id = ba.tenant_id
ON CONFLICT (tenant_id, code) DO UPDATE
SET
    device_id = EXCLUDED.device_id,
    deactivated_at = NULL,
    created_by = EXCLUDED.created_by;

COMMIT;
