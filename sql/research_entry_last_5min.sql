-- Research Vessel Monitoring Query
-- Tracks research vessel activities and detects unusual behavior in the last 5 minutes
-- Used for monitoring scientific research activities in sensitive areas

WITH research_vessels AS (
  SELECT 
    v.mmsi,
    v.name,
    v.vessel_type,
    v.is_research,
    v.flag,
    v.length,
    v.width,
    v.call_sign,
    v.imo,
    
    -- Current position and status
    vp.coordinates as current_coordinates,
    vp.timestamp as current_timestamp,
    vp.speed as current_speed,
    vp.course as current_course,
    vp.heading as current_heading,
    vp.status as current_status,
    
    -- Previous position for movement analysis
    LAG(vp.coordinates) OVER (PARTITION BY v.mmsi ORDER BY vp.timestamp) as prev_coordinates,
    LAG(vp.timestamp) OVER (PARTITION BY v.mmsi ORDER BY vp.timestamp) as prev_timestamp,
    LAG(vp.speed) OVER (PARTITION BY v.mmsi ORDER BY vp.timestamp) as prev_speed,
    LAG(vp.course) OVER (PARTITION BY v.mmsi ORDER BY vp.timestamp) as prev_course
    
  FROM `svalmap.marine_osint.vessels` v
  JOIN (
    -- Get recent positions for research vessels
    SELECT 
      mmsi,
      coordinates,
      timestamp,
      speed,
      course,
      heading,
      status,
      ROW_NUMBER() OVER (PARTITION BY mmsi ORDER BY timestamp DESC) as rn
    FROM `svalmap.marine_osint.vessel_positions`
    WHERE partition_date = CURRENT_DATE()
      AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
  ) vp ON v.mmsi = vp.mmsi AND vp.rn = 1
  
  WHERE v.is_research = TRUE
    OR v.vessel_type = 'research'
    OR LOWER(v.name) LIKE '%research%'
    OR LOWER(v.name) LIKE '%survey%'
    OR LOWER(v.name) LIKE '%oceanographic%'
    OR LOWER(v.name) LIKE '%hydrographic%'
),

research_activity_analysis AS (
  SELECT 
    mmsi,
    name,
    vessel_type,
    is_research,
    flag,
    length,
    width,
    call_sign,
    imo,
    current_coordinates,
    current_timestamp,
    current_speed,
    current_course,
    current_heading,
    current_status,
    
    -- Movement analysis
    CASE 
      WHEN prev_coordinates IS NOT NULL THEN ST_DISTANCE(current_coordinates, prev_coordinates)
      ELSE 0
    END as distance_moved_meters,
    
    CASE 
      WHEN prev_timestamp IS NOT NULL THEN TIMESTAMP_DIFF(current_timestamp, prev_timestamp, MINUTE)
      ELSE NULL
    END as time_between_positions_minutes,
    
    -- Calculate effective speed
    CASE 
      WHEN prev_timestamp IS NOT NULL AND prev_coordinates IS NOT NULL THEN
        ST_DISTANCE(current_coordinates, prev_coordinates) / (TIMESTAMP_DIFF(current_timestamp, prev_timestamp, SECOND) / 3600.0)
      ELSE NULL
    END as effective_speed_knots,
    
    -- Movement pattern classification
    CASE 
      WHEN current_speed < 1 THEN 'stationary'
      WHEN current_speed < 3 THEN 'slow_moving'
      WHEN current_speed < 8 THEN 'cruising'
      WHEN current_speed < 15 THEN 'transiting'
      ELSE 'high_speed'
    END as movement_pattern
    
  FROM research_vessels
),

research_area_analysis AS (
  SELECT 
    r.mmsi,
    r.name,
    r.vessel_type,
    r.is_research,
    r.flag,
    r.length,
    r.width,
    r.current_coordinates,
    r.current_timestamp,
    r.current_speed,
    r.current_course,
    r.current_heading,
    r.current_status,
    r.distance_moved_meters,
    r.time_between_positions_minutes,
    r.effective_speed_knots,
    r.movement_pattern,
    
    -- Check proximity to restricted areas
    (SELECT MIN(ST_DISTANCE(r.current_coordinates, ra.coordinates))
     FROM `svalmap.marine_osint.restricted_areas` ra
     WHERE ra.type IN ('military', 'environmental')
    ) as distance_to_restricted_area_meters,
    
    -- Check proximity to cable routes
    (SELECT MIN(ST_DISTANCE(r.current_coordinates, cr.coordinates))
     FROM `svalmap.marine_osint.cable_routes` cr
     WHERE cr.criticality IN ('high', 'medium')
    ) as distance_to_cable_route_meters,
    
    -- Check if in Svalbard EEZ
    CASE 
      WHEN ST_X(r.current_coordinates) BETWEEN 10.0 AND 35.0 
        AND ST_Y(r.current_coordinates) BETWEEN 74.0 AND 84.0 THEN TRUE
      ELSE FALSE
    END as in_svalbard_eez,
    
    -- Check if in Barents Sea
    CASE 
      WHEN ST_X(r.current_coordinates) BETWEEN 10.0 AND 45.0 
        AND ST_Y(r.current_coordinates) BETWEEN 67.0 AND 82.0 THEN TRUE
      ELSE FALSE
    END as in_barents_sea
    
  FROM research_activity_analysis r
),

research_behavior_assessment AS (
  SELECT 
    mmsi,
    name,
    vessel_type,
    is_research,
    flag,
    length,
    width,
    current_coordinates,
    current_timestamp,
    current_speed,
    current_course,
    current_heading,
    current_status,
    distance_moved_meters,
    time_between_positions_minutes,
    effective_speed_knots,
    movement_pattern,
    distance_to_restricted_area_meters,
    distance_to_cable_route_meters,
    in_svalbard_eez,
    in_barents_sea,
    
    -- Behavior assessment
    CASE 
      -- Stationary research behavior (normal)
      WHEN movement_pattern = 'stationary' AND in_svalbard_eez = TRUE THEN 'normal_research'
      
      -- Slow moving research behavior (normal)
      WHEN movement_pattern = 'slow_moving' AND in_svalbard_eez = TRUE THEN 'normal_research'
      
      -- High speed in sensitive areas (suspicious)
      WHEN movement_pattern = 'high_speed' AND in_svalbard_eez = TRUE THEN 'suspicious_behavior'
      
      -- Very close to restricted areas (concerning)
      WHEN distance_to_restricted_area_meters IS NOT NULL 
        AND distance_to_restricted_area_meters < 5000 THEN 'near_restricted_area'
      
      -- Very close to cable routes (concerning)
      WHEN distance_to_cable_route_meters IS NOT NULL 
        AND distance_to_cable_route_meters < 2000 THEN 'near_cable_route'
      
      -- Unusual movement patterns
      WHEN movement_pattern = 'high_speed' AND in_barents_sea = TRUE THEN 'unusual_movement'
      
      -- Normal research activity
      ELSE 'normal_research'
    END as behavior_assessment,
    
    -- Risk level calculation
    CASE 
      WHEN behavior_assessment = 'suspicious_behavior' THEN 'high'
      WHEN behavior_assessment = 'near_restricted_area' THEN 'high'
      WHEN behavior_assessment = 'near_cable_route' THEN 'high'
      WHEN behavior_assessment = 'unusual_movement' THEN 'medium'
      WHEN behavior_assessment = 'normal_research' THEN 'low'
      ELSE 'low'
    END as risk_level,
    
    -- Flag risk assessment
    CASE 
      WHEN flag IN ('RU', 'CN') THEN 'high_risk_flag'
      WHEN flag IN ('NO', 'SE', 'FI', 'DK') THEN 'low_risk_flag'
      ELSE 'medium_risk_flag'
    END as flag_risk
    
  FROM research_area_analysis
)

SELECT 
  mmsi,
  name,
  vessel_type,
  is_research,
  flag,
  length,
  width,
  current_coordinates,
  current_timestamp,
  current_speed,
  current_course,
  current_heading,
  current_status,
  ROUND(distance_moved_meters / 1852.0, 2) as distance_moved_nautical_miles,
  time_between_positions_minutes,
  ROUND(effective_speed_knots, 2) as effective_speed_knots,
  movement_pattern,
  ROUND(distance_to_restricted_area_meters / 1852.0, 2) as distance_to_restricted_area_nautical_miles,
  ROUND(distance_to_cable_route_meters / 1852.0, 2) as distance_to_cable_route_nautical_miles,
  in_svalbard_eez,
  in_barents_sea,
  behavior_assessment,
  risk_level,
  flag_risk,
  
  -- Enhanced risk level considering flag risk
  CASE 
    WHEN risk_level = 'high' OR flag_risk = 'high_risk_flag' THEN 'critical'
    WHEN risk_level = 'medium' OR flag_risk = 'medium_risk_flag' THEN 'high'
    ELSE 'low'
  END as enhanced_risk_level,
  
  -- Alert message
  CONCAT(
    'Research vessel activity: ', COALESCE(name, mmsi), ' (', vessel_type, ') ',
    'is ', movement_pattern, ' at ', ROUND(current_speed, 1), ' knots ',
    CASE 
      WHEN in_svalbard_eez = TRUE THEN 'within Svalbard EEZ'
      WHEN in_barents_sea = TRUE THEN 'in Barents Sea'
      ELSE 'outside monitoring area'
    END,
    CASE 
      WHEN distance_to_restricted_area_meters IS NOT NULL AND distance_to_restricted_area_meters < 10000 THEN
        CONCAT(' - ', ROUND(distance_to_restricted_area_meters / 1852.0, 1), ' NM from restricted area')
      ELSE ''
    END,
    ' - Behavior: ', behavior_assessment, ' - Risk: ', enhanced_risk_level
  ) as alert_message,
  
  -- Recommended monitoring level
  CASE 
    WHEN enhanced_risk_level = 'critical' THEN 'Continuous monitoring required'
    WHEN enhanced_risk_level = 'high' THEN 'Enhanced monitoring recommended'
    WHEN enhanced_risk_level = 'medium' THEN 'Standard monitoring'
    ELSE 'Routine monitoring'
  END as monitoring_recommendation,
  
  -- Time since last update
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), current_timestamp, MINUTE) as minutes_since_update
  
FROM research_behavior_assessment
ORDER BY enhanced_risk_level DESC, current_timestamp DESC;
