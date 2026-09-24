// Geographic types
export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

// Vessel types
export interface Vessel {
  mmsi: string;
  name: string;
  callSign?: string;
  imo?: string;
  vesselType: VesselType;
  length?: number;
  width?: number;
  flag?: string;
  isMilitary: boolean;
  isResearch: boolean;
}

export type VesselType = 
  | 'cargo'
  | 'tanker'
  | 'passenger'
  | 'fishing'
  | 'military'
  | 'research'
  | 'unknown';

// Position and movement types
export interface VesselPosition {
  mmsi: string;
  timestamp: Date;
  coordinates: Coordinates;
  speed: number; // knots
  course: number; // degrees
  heading: number; // degrees
  status: NavigationStatus;
}

export type NavigationStatus = 
  | 'underway'
  | 'anchored'
  | 'moored'
  | 'aground'
  | 'not_under_command'
  | 'restricted_maneuverability'
  | 'unknown';

// Incident types
export interface Incident {
  id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  timestamp: Date;
  vessels: string[]; // MMSI numbers
  coordinates: Coordinates;
  description: string;
  status: IncidentStatus;
  metadata: Record<string, unknown>;
}

export type IncidentType = 
  | 'proximity_alert'
  | 'rendezvous_detected'
  | 'loitering_detected'
  | 'sanctions_violation'
  | 'shadow_tracking'
  | 'restricted_area_breach';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type IncidentStatus = 'active' | 'acknowledged' | 'resolved' | 'false_positive';

// Area types
export interface RestrictedArea {
  id: string;
  name: string;
  type: 'military' | 'environmental' | 'infrastructure';
  coordinates: Coordinates[];
  description: string;
  restrictions: string[];
}

export interface CableRoute {
  id: string;
  name: string;
  coordinates: Coordinates[];
  description: string;
  criticality: 'high' | 'medium' | 'low';
}

// API types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Filter and query types
export interface VesselFilter {
  vesselTypes?: VesselType[];
  flags?: string[];
  isMilitary?: boolean;
  isResearch?: boolean;
  boundingBox?: BoundingBox;
  timeRange?: {
    start: Date;
    end: Date;
  };
}

export interface IncidentFilter {
  types?: IncidentType[];
  severities?: IncidentSeverity[];
  statuses?: IncidentStatus[];
  timeRange?: {
    start: Date;
    end: Date;
  };
  boundingBox?: BoundingBox;
}

// Real-time types
export interface RealTimeUpdate {
  type: 'vessel_position' | 'incident' | 'alert';
  data: VesselPosition | Incident | Alert;
  timestamp: Date;
}

export interface Alert {
  id: string;
  type: 'proximity' | 'rendezvous' | 'loitering' | 'sanctions' | 'shadow';
  severity: IncidentSeverity;
  message: string;
  timestamp: Date;
  coordinates: Coordinates;
  vesselMmsi: string;
}
