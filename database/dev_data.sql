BEGIN;

WITH upsert_tenant AS (
    INSERT INTO tenants (name)
    VALUES ('NoMa Klíma- és Hűtéstechnikai Kft.')
    ON CONFLICT (name) DO UPDATE
    SET name = EXCLUDED.name
    RETURNING id
)
INSERT INTO users (tenant_id, full_name, email, email_verified_at)
SELECT
    upsert_tenant.id,
    'Surányi Domonkos',
    'floomatik@nomahutes.hu',
    NOW()
FROM upsert_tenant
ON CONFLICT (tenant_id, email) DO UPDATE
SET
    full_name = EXCLUDED.full_name,
    email_verified_at = EXCLUDED.email_verified_at;

WITH tenant_and_user AS (
    SELECT
        t.id AS tenant_id,
        u.id AS user_id
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id
    WHERE t.name = 'NoMa Klíma- és Hűtéstechnikai Kft.'
      AND u.email = 'floomatik@nomahutes.hu'
),
building_seed(name, address) AS (
    VALUES
        ('NoMa Központ', '1138 Budapest, Váci út 144-150.'),
        ('NoMa Raktár', '2000 Szentendre, Ipari park 5.'),
        ('NoMa Szervizpont', '1117 Budapest, Fehérvári út 84/A')
)
INSERT INTO buildings (tenant_id, name, address, created_by)
SELECT
    tau.tenant_id,
    seed.name,
    seed.address,
    tau.user_id
FROM tenant_and_user tau
CROSS JOIN building_seed seed
WHERE NOT EXISTS (
    SELECT 1
    FROM buildings b
    WHERE b.tenant_id = tau.tenant_id
      AND b.name = seed.name
);

WITH tenant_and_user AS (
    SELECT
        t.id AS tenant_id,
        u.id AS user_id
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id
    WHERE t.name = 'NoMa Klíma- és Hűtéstechnikai Kft.'
      AND u.email = 'floomatik@nomahutes.hu'
),
location_seed AS (
    SELECT
        'NoMa Központ'::text AS building_name,
        '2'::text AS floor,
        'A'::text AS wing,
        '204'::text AS room,
        'Open office melletti mennyezeti egyseg'::text AS location_description
    UNION ALL
    SELECT
        'NoMa Központ',
        '3',
        'B',
        '311',
        'Targyalo melletti belteri egyseg'
    UNION ALL
    SELECT
        'NoMa Raktár',
        '0',
        'A',
        'G-07',
        'Raktari kiszolgalo ter'
    UNION ALL
    SELECT
        'NoMa Raktár',
        'TETŐ',
        'R1',
        NULL,
        'Kondenzator a nyugati tetoszakaszon'
    UNION ALL
    SELECT
        'NoMa Szervizpont',
        '1',
        'SZ',
        '112',
        'Szerviziroda hatso helyiseg'
),
resolved_locations AS (
    SELECT
        tau.tenant_id,
        tau.user_id,
        b.id AS building_id,
        seed.floor,
        seed.wing,
        seed.room,
        seed.location_description
    FROM tenant_and_user tau
    JOIN location_seed seed ON TRUE
    JOIN buildings b
      ON b.tenant_id = tau.tenant_id
     AND b.name = seed.building_name
)
INSERT INTO site_locations (
    tenant_id,
    building_id,
    floor,
    wing,
    room,
    location_description,
    created_by
)
SELECT
    rl.tenant_id,
    rl.building_id,
    rl.floor,
    rl.wing,
    rl.room,
    rl.location_description,
    rl.user_id
FROM resolved_locations rl
WHERE NOT EXISTS (
    SELECT 1
    FROM site_locations sl
    WHERE sl.tenant_id = rl.tenant_id
      AND sl.building_id = rl.building_id
      AND sl.floor IS NOT DISTINCT FROM rl.floor
      AND sl.wing IS NOT DISTINCT FROM rl.wing
      AND sl.room IS NOT DISTINCT FROM rl.room
      AND sl.location_description IS NOT DISTINCT FROM rl.location_description
);

WITH tenant_and_user AS (
    SELECT
        t.id AS tenant_id,
        u.id AS user_id
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id
    WHERE t.name = 'NoMa Klíma- és Hűtéstechnikai Kft.'
      AND u.email = 'floomatik@nomahutes.hu'
),
device_seed AS (
    SELECT
        'NoMa Központ'::text AS building_name,
        '2'::text AS floor,
        'A'::text AS wing,
        '204'::text AS room,
        'Open office melletti mennyezeti egyseg'::text AS location_description,
        'FAN_COIL_UNIT'::device_kind AS kind,
        'Daikin'::text AS brand,
        'FXFQ50A'::text AS model,
        'Eszakkeleti zona fan-coil egyseg'::text AS additional_info
    UNION ALL
    SELECT
        'NoMa Központ',
        '3',
        'B',
        '311',
        'Targyalo melletti belteri egyseg',
        'INDOOR_UNIT'::device_kind,
        'Mitsubishi Electric',
        'MSZ-AP35VG',
        'Targyaloi split belteri egyseg'
    UNION ALL
    SELECT
        'NoMa Raktár',
        '0',
        'A',
        'G-07',
        'Raktari kiszolgalo ter',
        'AIR_HANDLER_UNIT'::device_kind,
        'Systemair',
        'Topvex SR09',
        'Raktari kezeloegyseg'
    UNION ALL
    SELECT
        'NoMa Raktár',
        'TETŐ',
        'R1',
        NULL,
        'Kondenzator a nyugati tetoszakaszon',
        'CONDENSER'::device_kind,
        'Daikin',
        'RXYQ10U',
        'Kulteri VRV kondenzator'
    UNION ALL
    SELECT
        'NoMa Szervizpont',
        '1',
        'SZ',
        '112',
        'Szerviziroda hatso helyiseg',
        'FAN'::device_kind,
        'Systemair',
        'K 160 EC',
        'Szellozesi elszivo ventilator'
),
resolved_devices AS (
    SELECT
        tau.tenant_id,
        tau.user_id,
        sl.id AS location_id,
        seed.kind,
        seed.brand,
        seed.model,
        seed.additional_info
    FROM tenant_and_user tau
    JOIN device_seed seed ON TRUE
    JOIN buildings b
      ON b.tenant_id = tau.tenant_id
     AND b.name = seed.building_name
    JOIN site_locations sl
      ON sl.tenant_id = tau.tenant_id
     AND sl.building_id = b.id
     AND sl.floor IS NOT DISTINCT FROM seed.floor
     AND sl.wing IS NOT DISTINCT FROM seed.wing
     AND sl.room IS NOT DISTINCT FROM seed.room
     AND sl.location_description IS NOT DISTINCT FROM seed.location_description
)
INSERT INTO devices (
    tenant_id,
    location_id,
    kind,
    additional_info,
    brand,
    model,
    created_by
)
SELECT
    rd.tenant_id,
    rd.location_id,
    rd.kind,
    rd.additional_info,
    rd.brand,
    rd.model,
    rd.user_id
FROM resolved_devices rd
WHERE NOT EXISTS (
    SELECT 1
    FROM devices d
    WHERE d.tenant_id = rd.tenant_id
      AND d.location_id IS NOT DISTINCT FROM rd.location_id
      AND d.kind = rd.kind
      AND d.brand IS NOT DISTINCT FROM rd.brand
      AND d.model IS NOT DISTINCT FROM rd.model
      AND d.additional_info IS NOT DISTINCT FROM rd.additional_info
);

-- Google sign-in requires the real Google "sub" claim as provider_subject.
-- Add this after the first successful Google login flow is wired up:
--
-- INSERT INTO auth_identities (user_id, provider, provider_subject)
-- SELECT
--     u.id,
--     'GOOGLE',
--     '<google-provider-subject>'
-- FROM users u
-- JOIN tenants t ON t.id = u.tenant_id
-- WHERE t.name = 'NoMa Klíma- és Hűtéstechnikai Kft.'
--   AND u.email = 'floomatik@nomahutes.hu'
-- ON CONFLICT (user_id, provider) DO UPDATE
-- SET provider_subject = EXCLUDED.provider_subject;

COMMIT;
