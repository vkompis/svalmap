-- Proximity Alert Detection Query
-- Detects vessels within 5 nautical miles of restricted areas in the last 5 minutes
-- Used for real-time monitoring and alerting

WITH recent_positions AS (
  SELECT 
    vp.mmsi,
    vp.coordinates,
    vp.timestamp,
    vp.speed,
    vp.course,
    v.name,
    v.vessel_type,
    v.is_military,
    v.is_research,
    v.flag
  FROM `svalmap.marine_osint.vessel_positions` vp
  JOIN `svalmap.marine_osint.vessels` v ON vp.mmsi = v.mmsi
  WHERE vp.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
    AND vp.partition_date = CURRENT_DATE()
),

proximity_alerts AS (
  SELECT 
    rp.mmsi,
    rp.name,
    rp.vessel_type,
    rp.is_military,
    rp.is_research,
    rp.flag,
    rp.coordinates as vessel_coordinates,
    rp.timestamp,
    rp.speed,
    ra.id as area_id,
    ra.name as area_name,
    ra.type as area_type,
    ra.coordinates as area_coordinates,
    ra.description as area_description,
    ST_DISTANCE(rp.coordinates, ra.coordinates) as distance_meters,
    ST_DISTANCE(rp.coordinates, ra.coordinates) / 1852.0 as distance_nautical_miles
  FROM recent_positions rp
  CROSS JOIN `svalmap.marine_osint.restricted_areas` ra
  WHERE ST_DISTANCE(rp.coordinates, ra.coordinates) <= 9260 -- 5 nautical miles in meters
    AND rp.is_military = FALSE -- Exclude military vessels from proximity alerts
)

SELECT 
  mmsi,
  name,
  vessel_type,
  is_military,
  is_research,
  flag,
  vessel_coordinates,
  timestamp,
  speed,
  area_id,
  area_name,
  area_type,
  area_description,
  distance_meters,
  ROUND(distance_nautical_miles, 2) as distance_nautical_miles,
  CASE 
    WHEN distance_nautical_miles <= 1 THEN 'critical'
    WHEN distance_nautical_miles <= 2 THEN 'high'
    WHEN distance_nautical_miles <= 3 THEN 'medium'
    ELSE 'low'
  END as alert_severity,
  CONCAT(
    'Vessel ', COALESCE(name, mmsi), ' (', vessel_type, ') ',
    'is within ', ROUND(distance_nautical_miles, 1), ' NM of ',
    area_name, ' (', area_type, ')'
  ) as alert_message
FROM proximity_alerts
ORDER BY distance_nautical_miles ASC, timestamp DESC;
