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
    VALUES
        ('NoMa Központ', '1', 'A', '101', 'Recepció feletti beltéri egység'),
        ('NoMa Központ', '1', 'A', '103', 'Ügyféltér oldalfali egység'),
        ('NoMa Központ', '2', 'A', '204', 'Open office melletti mennyezeti egység'),
        ('NoMa Központ', '2', 'A', '208', 'Konyha melletti fan-coil sor'),
        ('NoMa Központ', '2', 'B', '215', 'Szerverterem előtere'),
        ('NoMa Központ', '3', 'B', '311', 'Tárgyaló melletti beltéri egység'),
        ('NoMa Központ', '3', 'B', '315', 'Igazgatói iroda déli oldala'),
        ('NoMa Központ', '4', 'C', '402', 'Bemutatóterem északi zóna'),
        ('NoMa Központ', '4', 'C', '409', 'Raktárkapcsolati folyosó'),
        ('NoMa Központ', 'TETŐ', 'R1', NULL, 'Tetőszinti kültéri sor'),
        ('NoMa Raktár', '0', 'A', 'G-01', 'Áruátvételi zóna'),
        ('NoMa Raktár', '0', 'A', 'G-03', 'Komissiózó tér'),
        ('NoMa Raktár', '0', 'A', 'G-07', 'Raktári kiszolgáló tér'),
        ('NoMa Raktár', '0', 'B', 'G-11', 'Hűtött tároló előtere'),
        ('NoMa Raktár', '1', 'B', 'M-02', 'Mezanin iroda'),
        ('NoMa Raktár', '1', 'B', 'M-06', 'Műhely melletti pihenő'),
        ('NoMa Raktár', '1', 'C', 'M-09', 'Akkumulátoros töltőhelyiség'),
        ('NoMa Raktár', 'TETŐ', 'R1', NULL, 'Kondenzátor a nyugati tetőszakaszon'),
        ('NoMa Raktár', 'TETŐ', 'R2', NULL, 'Kondenzátor a keleti tetőszakaszon'),
        ('NoMa Raktár', '-1', 'P', 'B-02', 'Gépészeti tér északi oldal'),
        ('NoMa Szervizpont', '0', 'SZ', '012', 'Fogadótér mennyezeti egység'),
        ('NoMa Szervizpont', '0', 'SZ', '018', 'Alkatrészraktár belépő zóna'),
        ('NoMa Szervizpont', '1', 'SZ', '112', 'Szerviziroda hátsó helyiség'),
        ('NoMa Szervizpont', '1', 'SZ', '118', 'Szerszámkiadó pult mögött'),
        ('NoMa Szervizpont', '1', 'K', '125', 'Képzőterem nyugati fal'),
        ('NoMa Szervizpont', '2', 'K', '206', 'Nyitott irodarész középzóna'),
        ('NoMa Szervizpont', '2', 'K', '212', 'Próbaüzemi labor'),
        ('NoMa Szervizpont', '2', 'K', '219', 'Alkatrészvizsgáló műhely'),
        ('NoMa Szervizpont', 'TETŐ', 'R1', NULL, 'Szervizpont tető kültéri egységei'),
        ('NoMa Szervizpont', '-1', 'G', 'B-04', 'Gépészeti csatornatér')
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
    VALUES
        ('NoMa Központ', '1', 'A', '101', 'Recepció feletti beltéri egység', 'INDOOR_UNIT'::device_kind, 'Daikin', 'FTXM25R', 'Recepciós oldali split beltéri'),
        ('NoMa Központ', '1', 'A', '103', 'Ügyféltér oldalfali egység', 'INDOOR_UNIT'::device_kind, 'Mitsubishi Electric', 'MSZ-AY35VGK', 'Ügyféltér nyugati oldali egység'),
        ('NoMa Központ', '2', 'A', '204', 'Open office melletti mennyezeti egység', 'FAN_COIL_UNIT'::device_kind, 'Daikin', 'FXFQ50A', 'Open office északkeleti zóna'),
        ('NoMa Központ', '2', 'A', '204', 'Open office melletti mennyezeti egység', 'FAN_COIL_UNIT'::device_kind, 'Daikin', 'FXFQ32A', 'Open office délkeleti zóna'),
        ('NoMa Központ', '2', 'A', '208', 'Konyha melletti fan-coil sor', 'FAN_COIL_UNIT'::device_kind, 'Galletti', 'ESTRO 12', 'Konyha előtti első fan-coil'),
        ('NoMa Központ', '2', 'A', '208', 'Konyha melletti fan-coil sor', 'FAN_COIL_UNIT'::device_kind, 'Galletti', 'ESTRO 15', 'Konyha előtti második fan-coil'),
        ('NoMa Központ', '2', 'B', '215', 'Szerverterem előtere', 'AIR_HANDLER_UNIT'::device_kind, 'Systemair', 'Topvex FR08', 'Szerverterem előtér légkezelő'),
        ('NoMa Központ', '2', 'B', '215', 'Szerverterem előtere', 'FAN'::device_kind, 'Systemair', 'K 200 EC', 'Szerverterem előtér elszívó'),
        ('NoMa Központ', '3', 'B', '311', 'Tárgyaló melletti beltéri egység', 'INDOOR_UNIT'::device_kind, 'Mitsubishi Electric', 'MSZ-AP35VG', 'Tárgyalói split beltéri'),
        ('NoMa Központ', '3', 'B', '311', 'Tárgyaló melletti beltéri egység', 'FAN'::device_kind, 'Soler & Palau', 'Silent 300', 'Tárgyalói frisslevegős ventilátor'),
        ('NoMa Központ', '3', 'B', '315', 'Igazgatói iroda déli oldala', 'INDOOR_UNIT'::device_kind, 'Daikin', 'Perfera 35', 'Igazgatói iroda belső egység'),
        ('NoMa Központ', '3', 'B', '315', 'Igazgatói iroda déli oldala', 'FAN_COIL_UNIT'::device_kind, 'Gree', 'U-Match 5.0', 'Igazgatói iroda tartalék fan-coil'),
        ('NoMa Központ', '4', 'C', '402', 'Bemutatóterem északi zóna', 'AIR_HANDLER_UNIT'::device_kind, 'Swegon', 'GOLD RX 04', 'Bemutatótermi légkezelő'),
        ('NoMa Központ', '4', 'C', '402', 'Bemutatóterem északi zóna', 'FAN'::device_kind, 'Systemair', 'KVK 125', 'Bemutatóterem befúvó ventilátor'),
        ('NoMa Központ', '4', 'C', '409', 'Raktárkapcsolati folyosó', 'FAN'::device_kind, 'Helios', 'RR 160', 'Folyosói elszívó ventilátor'),
        ('NoMa Központ', '4', 'C', '409', 'Raktárkapcsolati folyosó', 'INDOOR_UNIT'::device_kind, 'Fujitsu', 'ASYG12KM', 'Folyosói oldalfali beltéri'),
        ('NoMa Központ', 'TETŐ', 'R1', NULL, 'Tetőszinti kültéri sor', 'CONDENSER'::device_kind, 'Daikin', 'RZQSG100', 'Tető kültéri 01'),
        ('NoMa Központ', 'TETŐ', 'R1', NULL, 'Tetőszinti kültéri sor', 'CONDENSER'::device_kind, 'Daikin', 'RZQSG125', 'Tető kültéri 02'),
        ('NoMa Központ', 'TETŐ', 'R1', NULL, 'Tetőszinti kültéri sor', 'VRF_OUTDOOR_UNIT'::device_kind, 'Daikin', 'RXYQ10U', 'Tető VRF kültéri'),
        ('NoMa Központ', 'TETŐ', 'R1', NULL, 'Tetőszinti kültéri sor', 'CHILLER'::device_kind, 'Trane', 'CGAM 020', 'Tető folyadékhűtő'),

        ('NoMa Raktár', '0', 'A', 'G-01', 'Áruátvételi zóna', 'AIR_HANDLER_UNIT'::device_kind, 'Systemair', 'Topvex SR06', 'Áruátvételi légkezelő'),
        ('NoMa Raktár', '0', 'A', 'G-01', 'Áruátvételi zóna', 'FAN'::device_kind, 'Systemair', 'K 160 XL', 'Áruátvételi elszívó'),
        ('NoMa Raktár', '0', 'A', 'G-03', 'Komissiózó tér', 'FAN_COIL_UNIT'::device_kind, 'Galletti', 'ESTRO 18', 'Komissiózó 1. zóna'),
        ('NoMa Raktár', '0', 'A', 'G-03', 'Komissiózó tér', 'FAN_COIL_UNIT'::device_kind, 'Galletti', 'ESTRO 20', 'Komissiózó 2. zóna'),
        ('NoMa Raktár', '0', 'A', 'G-07', 'Raktári kiszolgáló tér', 'AIR_HANDLER_UNIT'::device_kind, 'Systemair', 'Topvex SR09', 'Raktári kezelőegység'),
        ('NoMa Raktár', '0', 'A', 'G-07', 'Raktári kiszolgáló tér', 'FAN'::device_kind, 'Systemair', 'KVK 315', 'Raktári befúvó ventilátor'),
        ('NoMa Raktár', '0', 'B', 'G-11', 'Hűtött tároló előtere', 'INDOOR_UNIT'::device_kind, 'Midea', 'Mission 26', 'Előtéri split beltéri'),
        ('NoMa Raktár', '0', 'B', 'G-11', 'Hűtött tároló előtere', 'CONDENSER'::device_kind, 'Midea', 'MOX330', 'Előtéri split kültéri párja'),
        ('NoMa Raktár', '1', 'B', 'M-02', 'Mezanin iroda', 'INDOOR_UNIT'::device_kind, 'Daikin', 'Comfora 35', 'Mezanin iroda beltéri'),
        ('NoMa Raktár', '1', 'B', 'M-02', 'Mezanin iroda', 'FAN'::device_kind, 'Helios', 'MiniVent M1', 'Mezanin iroda elszívó'),
        ('NoMa Raktár', '1', 'B', 'M-06', 'Műhely melletti pihenő', 'INDOOR_UNIT'::device_kind, 'Gree', 'Comfort X', 'Pihenő split beltéri'),
        ('NoMa Raktár', '1', 'B', 'M-06', 'Műhely melletti pihenő', 'FAN_COIL_UNIT'::device_kind, 'Sabiana', 'Carisma 34', 'Pihenő fan-coil'),
        ('NoMa Raktár', '1', 'C', 'M-09', 'Akkumulátoros töltőhelyiség', 'FAN'::device_kind, 'Soler & Palau', 'TD-800', 'Töltőhelyiség elszívó'),
        ('NoMa Raktár', '1', 'C', 'M-09', 'Akkumulátoros töltőhelyiség', 'AIR_HANDLER_UNIT'::device_kind, 'Komfovent', 'Domekt R 400', 'Töltőhelyiség frisslevegős gép'),
        ('NoMa Raktár', '-1', 'P', 'B-02', 'Gépészeti tér északi oldal', 'CHILLER'::device_kind, 'Carrier', '30RB 040', 'Gépészeti tér folyadékhűtő'),
        ('NoMa Raktár', '-1', 'P', 'B-02', 'Gépészeti tér északi oldal', 'FAN'::device_kind, 'Ziehl-Abegg', 'FN063', 'Gépészeti tér segédventilátor'),
        ('NoMa Raktár', 'TETŐ', 'R1', NULL, 'Kondenzátor a nyugati tetőszakaszon', 'CONDENSER'::device_kind, 'Daikin', 'RXYQ10U', 'Nyugati tető kültéri 01'),
        ('NoMa Raktár', 'TETŐ', 'R1', NULL, 'Kondenzátor a nyugati tetőszakaszon', 'CONDENSER'::device_kind, 'Daikin', 'RXYQ12U', 'Nyugati tető kültéri 02'),
        ('NoMa Raktár', 'TETŐ', 'R2', NULL, 'Kondenzátor a keleti tetőszakaszon', 'VRF_OUTDOOR_UNIT'::device_kind, 'Mitsubishi Electric', 'PUHY-P250', 'Keleti tető VRF kültéri'),
        ('NoMa Raktár', 'TETŐ', 'R2', NULL, 'Kondenzátor a keleti tetőszakaszon', 'CONDENSER'::device_kind, 'Mitsubishi Electric', 'PUHZ-ZRP140', 'Keleti tető split kültéri'),

        ('NoMa Szervizpont', '0', 'SZ', '012', 'Fogadótér mennyezeti egység', 'FAN_COIL_UNIT'::device_kind, 'Gree', 'U-Match 7.0', 'Fogadótér 1. zóna'),
        ('NoMa Szervizpont', '0', 'SZ', '012', 'Fogadótér mennyezeti egység', 'FAN_COIL_UNIT'::device_kind, 'Gree', 'U-Match 5.0', 'Fogadótér 2. zóna'),
        ('NoMa Szervizpont', '0', 'SZ', '018', 'Alkatrészraktár belépő zóna', 'INDOOR_UNIT'::device_kind, 'Fujitsu', 'ASYG14KM', 'Alkatrészraktár split beltéri'),
        ('NoMa Szervizpont', '0', 'SZ', '018', 'Alkatrészraktár belépő zóna', 'FAN'::device_kind, 'Helios', 'RRK 125', 'Alkatrészraktár elszívó'),
        ('NoMa Szervizpont', '1', 'SZ', '112', 'Szerviziroda hátsó helyiség', 'FAN'::device_kind, 'Systemair', 'K 160 EC', 'Szellőzési elszívó ventilátor'),
        ('NoMa Szervizpont', '1', 'SZ', '112', 'Szerviziroda hátsó helyiség', 'INDOOR_UNIT'::device_kind, 'Daikin', 'FTXM20R', 'Szerviziroda split beltéri'),
        ('NoMa Szervizpont', '1', 'SZ', '118', 'Szerszámkiadó pult mögött', 'AIR_HANDLER_UNIT'::device_kind, 'Swegon', 'GOLD RX 03', 'Szerszámkiadó légkezelő'),
        ('NoMa Szervizpont', '1', 'SZ', '118', 'Szerszámkiadó pult mögött', 'FAN'::device_kind, 'Systemair', 'KVK Slim 200', 'Szerszámkiadó elszívó'),
        ('NoMa Szervizpont', '1', 'K', '125', 'Képzőterem nyugati fal', 'INDOOR_UNIT'::device_kind, 'Mitsubishi Electric', 'MSZ-EF35', 'Képzőterem oldalfali egység 1'),
        ('NoMa Szervizpont', '1', 'K', '125', 'Képzőterem nyugati fal', 'INDOOR_UNIT'::device_kind, 'Mitsubishi Electric', 'MSZ-EF42', 'Képzőterem oldalfali egység 2'),
        ('NoMa Szervizpont', '2', 'K', '206', 'Nyitott irodarész középzóna', 'FAN_COIL_UNIT'::device_kind, 'Sabiana', 'Carisma 44', 'Nyitott iroda fan-coil 1'),
        ('NoMa Szervizpont', '2', 'K', '206', 'Nyitott irodarész középzóna', 'FAN_COIL_UNIT'::device_kind, 'Sabiana', 'Carisma 34', 'Nyitott iroda fan-coil 2'),
        ('NoMa Szervizpont', '2', 'K', '212', 'Próbaüzemi labor', 'AIR_HANDLER_UNIT'::device_kind, 'Systemair', 'Topvex FC06', 'Próbalabor légkezelő'),
        ('NoMa Szervizpont', '2', 'K', '212', 'Próbaüzemi labor', 'FAN'::device_kind, 'Ziehl-Abegg', 'RH35M', 'Próbalabor elszívó'),
        ('NoMa Szervizpont', '2', 'K', '219', 'Alkatrészvizsgáló műhely', 'FAN'::device_kind, 'Soler & Palau', 'CADB 800', 'Műhely frisslevegős ventilátor'),
        ('NoMa Szervizpont', '2', 'K', '219', 'Alkatrészvizsgáló műhely', 'INDOOR_UNIT'::device_kind, 'Daikin', 'Comfora 25', 'Műhely split beltéri'),
        ('NoMa Szervizpont', '-1', 'G', 'B-04', 'Gépészeti csatornatér', 'CHILLER'::device_kind, 'Clivet', 'WSAN-XEE 41', 'Pincei folyadékhűtő'),
        ('NoMa Szervizpont', '-1', 'G', 'B-04', 'Gépészeti csatornatér', 'FAN'::device_kind, 'Systemair', 'RVK 315', 'Pincei légcsatorna ventilátor'),
        ('NoMa Szervizpont', 'TETŐ', 'R1', NULL, 'Szervizpont tető kültéri egységei', 'CONDENSER'::device_kind, 'Daikin', 'RZAG71', 'Tető split kültéri 01'),
        ('NoMa Szervizpont', 'TETŐ', 'R1', NULL, 'Szervizpont tető kültéri egységei', 'VRF_OUTDOOR_UNIT'::device_kind, 'Daikin', 'RXYQ8U', 'Tető VRF kültéri')
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
