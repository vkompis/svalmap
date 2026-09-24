-- Rendezvous Detection Query
-- Detects vessels that have been within 2 nautical miles of each other in the last 24 hours
-- Used for identifying suspicious vessel meetings

WITH vessel_pairs AS (
  SELECT 
    vp1.mmsi as mmsi_1,
    v1.name as name_1,
    v1.vessel_type as type_1,
    v1.is_military as military_1,
    v1.is_research as research_1,
    v1.flag as flag_1,
    vp1.coordinates as coords_1,
    vp1.timestamp as time_1,
    vp1.speed as speed_1,
    
    vp2.mmsi as mmsi_2,
    v2.name as name_2,
    v2.vessel_type as type_2,
    v2.is_military as military_2,
    v2.is_research as research_2,
    v2.flag as flag_2,
    vp2.coordinates as coords_2,
    vp2.timestamp as time_2,
    vp2.speed as speed_2,
    
    ST_DISTANCE(vp1.coordinates, vp2.coordinates) as distance_meters,
    ST_DISTANCE(vp1.coordinates, vp2.coordinates) / 1852.0 as distance_nautical_miles,
    
    ABS(TIMESTAMP_DIFF(vp1.timestamp, vp2.timestamp, MINUTE)) as time_diff_minutes
    
  FROM `svalmap.marine_osint.vessel_positions` vp1
  JOIN `svalmap.marine_osint.vessels` v1 ON vp1.mmsi = v1.mmsi
  JOIN `svalmap.marine_osint.vessel_positions` vp2 ON vp1.mmsi < vp2.mmsi -- Avoid duplicate pairs
  JOIN `svalmap.marine_osint.vessels` v2 ON vp2.mmsi = v2.mmsi
  
  WHERE vp1.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
    AND vp2.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
    AND vp1.partition_date = CURRENT_DATE()
    AND vp2.partition_date = CURRENT_DATE()
    AND vp1.mmsi != vp2.mmsi
),

rendezvous_events AS (
  SELECT 
    mmsi_1,
    name_1,
    type_1,
    military_1,
    research_1,
    flag_1,
    coords_1,
    time_1,
    speed_1,
    
    mmsi_2,
    name_2,
    type_2,
    military_2,
    research_2,
    flag_2,
    coords_2,
    time_2,
    speed_2,
    
    distance_meters,
    distance_nautical_miles,
    time_diff_minutes,
    
    -- Calculate rendezvous center point
    ST_CENTROID(ST_MAKELINE(coords_1, coords_2)) as rendezvous_coordinates,
    
    -- Determine if this is a suspicious rendezvous
    CASE 
      WHEN distance_nautical_miles <= 1 AND time_diff_minutes <= 30 THEN 'suspicious'
      WHEN distance_nautical_miles <= 2 AND time_diff_minutes <= 60 THEN 'moderate'
      ELSE 'normal'
    END as rendezvous_type,
    
    -- Risk assessment
    CASE 
      WHEN military_1 = TRUE OR military_2 = TRUE THEN 'high'
      WHEN research_1 = TRUE OR research_2 = TRUE THEN 'medium'
      WHEN flag_1 != flag_2 THEN 'medium'
      ELSE 'low'
    END as risk_level
    
  FROM vessel_pairs
  WHERE distance_nautical_miles <= 2 -- 2 nautical miles threshold
    AND time_diff_minutes <= 120 -- Within 2 hours
)

SELECT 
  mmsi_1,
  name_1,
  type_1,
  military_1,
  research_1,
  flag_1,
  
  mmsi_2,
  name_2,
  type_2,
  military_2,
  research_2,
  flag_2,
  
  ROUND(distance_nautical_miles, 2) as distance_nautical_miles,
  time_diff_minutes,
  rendezvous_type,
  risk_level,
  rendezvous_coordinates,
  
  -- Alert message
  CONCAT(
    'Rendezvous detected: ', COALESCE(name_1, mmsi_1), ' (', type_1, ') and ',
    COALESCE(name_2, mmsi_2), ' (', type_2, ') ',
    'within ', ROUND(distance_nautical_miles, 1), ' NM ',
    'at ', FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', rendezvous_coordinates),
    ' - Risk: ', risk_level
  ) as alert_message,
  
  -- Timestamp for the rendezvous (average of both vessel times)
  TIMESTAMP_ADD(time_1, INTERVAL (time_diff_minutes / 2) MINUTE) as rendezvous_timestamp
  
FROM rendezvous_events
WHERE rendezvous_type IN ('suspicious', 'moderate')
ORDER BY risk_level DESC, distance_nautical_miles ASC, time_diff_minutes ASC;
