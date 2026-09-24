-- Shadow Entry Detection Query
-- Identifies vessels that have stopped transmitting AIS signals in the last 5 minutes
-- Used for detecting vessels that may be trying to avoid detection

WITH vessel_activity AS (
  SELECT 
    v.mmsi,
    v.name,
    v.vessel_type,
    v.is_military,
    v.is_research,
    v.flag,
    v.length,
    v.width,
    
    -- Last known position and time
    vp.coordinates as last_coordinates,
    vp.timestamp as last_transmission,
    vp.speed as last_speed,
    vp.course as last_course,
    vp.heading as last_heading,
    vp.status as last_status,
    
    -- Previous position and time
    LAG(vp.coordinates) OVER (PARTITION BY v.mmsi ORDER BY vp.timestamp) as prev_coordinates,
    LAG(vp.timestamp) OVER (PARTITION BY v.mmsi ORDER BY vp.timestamp) as prev_transmission,
    LAG(vp.speed) OVER (PARTITION BY v.mmsi ORDER BY vp.timestamp) as prev_speed,
    LAG(vp.course) OVER (PARTITION BY v.mmsi ORDER BY vp.timestamp) as prev_course,
    
    -- Calculate time since last transmission
    TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), vp.timestamp, MINUTE) as minutes_since_last_transmission,
    
    -- Calculate expected next transmission time (based on vessel type and speed)
    CASE 
      WHEN v.vessel_type = 'fishing' THEN 10 -- Fishing vessels typically transmit every 10 minutes
      WHEN v.vessel_type = 'cargo' THEN 5   -- Cargo vessels typically transmit every 5 minutes
      WHEN v.vessel_type = 'tanker' THEN 5  -- Tanker vessels typically transmit every 5 minutes
      WHEN v.vessel_type = 'passenger' THEN 3 -- Passenger vessels typically transmit every 3 minutes
      WHEN v.is_military = TRUE THEN 15     -- Military vessels may have longer intervals
      WHEN v.is_research = TRUE THEN 10     -- Research vessels typically transmit every 10 minutes
      ELSE 5 -- Default to 5 minutes
    END as expected_transmission_interval_minutes
    
  FROM `svalmap.marine_osint.vessels` v
  JOIN (
    -- Get the most recent position for each vessel
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
  ) vp ON v.mmsi = vp.mmsi AND vp.rn = 1
  
  WHERE vp.timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
),

shadow_detection AS (
  SELECT 
    mmsi,
    name,
    vessel_type,
    is_military,
    is_research,
    flag,
    length,
    width,
    last_coordinates,
    last_transmission,
    last_speed,
    last_course,
    last_heading,
    last_status,
    prev_coordinates,
    prev_transmission,
    prev_speed,
    prev_course,
    minutes_since_last_transmission,
    expected_transmission_interval_minutes,
    
    -- Determine if vessel is likely shadowing (turned off AIS)
    CASE 
      WHEN minutes_since_last_transmission > expected_transmission_interval_minutes * 2 THEN 'likely_shadowing'
      WHEN minutes_since_last_transmission > expected_transmission_interval_minutes * 1.5 THEN 'possibly_shadowing'
      WHEN minutes_since_last_transmission > expected_transmission_interval_minutes THEN 'delayed_transmission'
      ELSE 'normal'
    END as shadow_status,
    
    -- Calculate movement before going dark
    CASE 
      WHEN prev_coordinates IS NOT NULL THEN ST_DISTANCE(last_coordinates, prev_coordinates)
      ELSE 0
    END as distance_moved_before_dark_meters,
    
    -- Calculate time between last two transmissions
    CASE 
      WHEN prev_transmission IS NOT NULL THEN TIMESTAMP_DIFF(last_transmission, prev_transmission, MINUTE)
      ELSE NULL
    END as time_between_transmissions_minutes,
    
    -- Calculate effective speed before going dark
    CASE 
      WHEN prev_transmission IS NOT NULL AND prev_coordinates IS NOT NULL THEN
        ST_DISTANCE(last_coordinates, prev_coordinates) / (TIMESTAMP_DIFF(last_transmission, prev_transmission, SECOND) / 3600.0)
      ELSE NULL
    END as effective_speed_before_dark_knots
    
  FROM vessel_activity
),

shadow_analysis AS (
  SELECT 
    mmsi,
    name,
    vessel_type,
    is_military,
    is_research,
    flag,
    length,
    width,
    last_coordinates,
    last_transmission,
    last_speed,
    last_course,
    last_heading,
    last_status,
    minutes_since_last_transmission,
    expected_transmission_interval_minutes,
    shadow_status,
    distance_moved_before_dark_meters,
    time_between_transmissions_minutes,
    effective_speed_before_dark_knots,
    
    -- Risk assessment for shadowing
    CASE 
      WHEN is_military = TRUE THEN 'high'
      WHEN is_research = TRUE THEN 'medium'
      WHEN vessel_type IN ('fishing', 'cargo', 'tanker') THEN 'medium'
      WHEN flag IN ('RU', 'CN', 'IR', 'KP') THEN 'high'
      ELSE 'low'
    END as base_risk_level,
    
    -- Enhanced risk based on shadowing behavior
    CASE 
      WHEN shadow_status = 'likely_shadowing' AND base_risk_level = 'high' THEN 'critical'
      WHEN shadow_status = 'likely_shadowing' AND base_risk_level = 'medium' THEN 'high'
      WHEN shadow_status = 'likely_shadowing' AND base_risk_level = 'low' THEN 'medium'
      WHEN shadow_status = 'possibly_shadowing' AND base_risk_level = 'high' THEN 'high'
      WHEN shadow_status = 'possibly_shadowing' AND base_risk_level = 'medium' THEN 'medium'
      WHEN shadow_status = 'possibly_shadowing' AND base_risk_level = 'low' THEN 'low'
      ELSE 'minimal'
    END as shadow_risk_level,
    
    -- Calculate estimated position based on last known movement
    CASE 
      WHEN last_course IS NOT NULL AND effective_speed_before_dark_knots IS NOT NULL THEN
        ST_GEOGPOINT(
          ST_X(last_coordinates) + (effective_speed_before_dark_knots * 0.514444 * minutes_since_last_transmission / 60.0 * SIN(RADIANS(last_course))),
          ST_Y(last_coordinates) + (effective_speed_before_dark_knots * 0.514444 * minutes_since_last_transmission / 60.0 * COS(RADIANS(last_course)))
        )
      ELSE last_coordinates
    END as estimated_current_position,
    
    -- Calculate estimated radius of uncertainty
    CASE 
      WHEN effective_speed_before_dark_knots IS NOT NULL THEN
        (effective_speed_before_dark_knots * 0.514444 * minutes_since_last_transmission / 60.0) + 1000 -- Add 1km buffer
      ELSE 5000 -- Default 5km uncertainty if no speed data
    END as uncertainty_radius_meters
    
  FROM shadow_detection
  WHERE shadow_status IN ('likely_shadowing', 'possibly_shadowing')
)

SELECT 
  mmsi,
  name,
  vessel_type,
  is_military,
  is_research,
  flag,
  length,
  width,
  last_coordinates,
  last_transmission,
  last_speed,
  last_course,
  last_heading,
  last_status,
  minutes_since_last_transmission,
  expected_transmission_interval_minutes,
  shadow_status,
  ROUND(distance_moved_before_dark_meters / 1852.0, 2) as distance_moved_before_dark_nautical_miles,
  time_between_transmissions_minutes,
  ROUND(effective_speed_before_dark_knots, 2) as effective_speed_before_dark_knots,
  base_risk_level,
  shadow_risk_level,
  estimated_current_position,
  ROUND(uncertainty_radius_meters / 1852.0, 2) as uncertainty_radius_nautical_miles,
  
  -- Alert message
  CONCAT(
    'Shadow entry detected: ', COALESCE(name, mmsi), ' (', vessel_type, ') ',
    'has not transmitted AIS for ', minutes_since_last_transmission, ' minutes ',
    'after moving ', ROUND(distance_moved_before_dark_meters / 1852.0, 1), ' NM ',
    'at ', ROUND(effective_speed_before_dark_knots, 1), ' knots ',
    '- Risk: ', shadow_risk_level
  ) as alert_message,
  
  -- Urgency indicator
  CASE 
    WHEN shadow_risk_level = 'critical' THEN 'immediate'
    WHEN shadow_risk_level = 'high' THEN 'urgent'
    WHEN shadow_risk_level = 'medium' THEN 'high'
    WHEN shadow_risk_level = 'low' THEN 'normal'
    ELSE 'minimal'
  END as urgency_level,
  
  -- Recommended action
  CASE 
    WHEN shadow_risk_level = 'critical' THEN 'Immediate investigation required'
    WHEN shadow_risk_level = 'high' THEN 'Investigate within 1 hour'
    WHEN shadow_risk_level = 'medium' THEN 'Monitor and investigate within 4 hours'
    WHEN shadow_risk_level = 'low' THEN 'Continue monitoring'
    ELSE 'No action required'
  END as recommended_action
  
FROM shadow_analysis
ORDER BY shadow_risk_level DESC, minutes_since_last_transmission DESC;
