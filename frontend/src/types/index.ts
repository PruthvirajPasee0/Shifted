export type Role = 'employee' | 'admin'
export type UserStatus = 'invited' | 'active' | 'suspended'

export interface User {
  id: string | number
  name: string
  email: string
  phone?: number | null
  role: Role
  status: UserStatus
  org_id: string | number
  photo_url?: string | null
  department?: string | null
  manager?: string | null
  office_location?: string | null
}

export interface Organization {
  id: string | number
  name: string
  domain: string
  address?: string | null
  industry?: string | null
  admin_contact?: string | null
  fuel_cost_per_litre?: number | null
  cost_per_km?: number | null
  travel_cost?: number | null
  currency?: string
}

export interface AdminStats {
  total_employees: number
  registered_vehicles: number
  rides_this_month: number
  pending_documents: number
  suspended_employees: number
  pending_approvals?: number
}

export interface RegisterPendingResponse {
  message: string
  email: string
  status: UserStatus
}

export interface AdminVehicle {
  id: string | number
  owner_id: string | number
  owner_name?: string | null
  model: string
  reg_number: string
  seating_capacity: number
  fuel_type: string
  mileage_kmpl?: number | null
  color?: string | null
  is_active: boolean
}

export interface AuthResponse {
  access_token: string
  user: User
}

export type FuelType = 'petrol' | 'diesel' | 'ev' | 'cng'

export interface Vehicle {
  id: string | number
  owner_id?: string | number
  model: string
  reg_number: string
  seating_capacity: number
  fuel_type: FuelType
  mileage_kmpl?: number | null
  color?: string | null
  is_active: boolean
}

export type DocStatus = 'pending' | 'verified' | 'rejected'

export interface Document {
  id: string | number
  user_id?: string | number
  doc_type: string
  doc_number?: string | null
  file_url?: string | null
  status: DocStatus
  expiry_date?: string | null
  verified_by?: string | null
  verified_at?: string | null
  rejection_reason?: string | null
  uploaded_at?: string | null
}

export interface Place {
  id: string | number
  label: string
  address?: string | null
  lat: number
  lng: number
}

export type RideStatus =
  | 'scheduled'
  | 'started'
  | 'in_progress'
  | 'completed'
  | 'cancelled'

export interface Ride {
  id: string | number
  driver_id: string | number
  vehicle_id: string | number
  parent_ride_id?: string | null
  origin: string
  origin_lat: number
  origin_lng: number
  destination: string
  dest_lat: number
  dest_lng: number
  departure_time: string
  started_at?: string | null
  ended_at?: string | null
  total_seats: number
  available_seats: number
  fare_per_seat: number
  distance_km?: number | null
  route_polyline?: string | null
  is_recurring?: boolean
  recurrence_rule?: string | null
  status: RideStatus
  cancel_reason?: string | null
  created_at?: string | null
}

export interface RideDetail extends Ride {
  driver: User
  vehicle: Vehicle
}

export interface RideMatch {
  ride: Ride
  driver: User
  vehicle: Vehicle
  match_score: number
  origin_distance_km: number
  dest_distance_km: number
}

export type BookingStatus = 'booked' | 'cancelled' | 'completed' | 'pending' | 'rejected'

export type PayMethod = 'cash' | 'card' | 'upi' | 'wallet'
export type SavedPaymentMethodType = 'card' | 'upi'
export type TicketStatus = 'open' | 'in_progress' | 'closed'

export interface Booking {
  id: string | number
  ride_id: string | number
  ride?: Ride | null
  passenger_id: string | number
  passenger?: User | null
  seats: number
  pickup_lat?: number | null
  pickup_lng?: number | null
  drop_lat?: number | null
  drop_lng?: number | null
  fare_amount: number
  status: BookingStatus
  cancelled_at?: string | null
  cancel_reason?: string | null
  booked_at?: string | null
}

export interface RazorpayOrder {
  order_id: string
  amount: number
  currency: string
  key_id: string
  razorpay: boolean
}

export interface Notification {
  id: string | number
  type?: string | null
  title?: string | null
  body?: string | null
  ref_id?: string | null
  is_read: boolean
  created_at?: string | null
}

export type PayStatus = 'pending' | 'success' | 'failed'

export interface Payment {
  id: string | number
  booking_id?: string | number | null
  payer_id: string | number
  payee_id?: string | number | null
  type: string
  amount: number
  method: PayMethod
  status: PayStatus
  gateway_ref?: string | null
  created_at?: string | null
}

export interface SavedPaymentMethod {
  id: string | number
  user_id: string | number
  type: SavedPaymentMethodType
  label?: string | null
  masked_detail?: string | null
  is_default: boolean
  created_at?: string | null
}

export interface SupportTicket {
  id: string | number
  user_id: string | number
  subject: string
  body?: string | null
  status: TicketStatus
  user_name?: string | null
  user_email?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface Rating {
  id: string | number
  ride_id: string | number
  rater_id: string | number
  ratee_id: string | number
  stars: number
  comment?: string | null
}

export interface RatingSummary {
  user_id: string | number
  average_stars: number
  total_ratings: number
}

export interface WalletTxn {
  id: string | number
  wallet_id?: string | number
  type: 'recharge' | 'debit' | 'credit'
  amount: number
  balance_after?: number
  ref_payment_id?: string | null
  created_at?: string | null
}

export interface Wallet {
  balance: number
  currency?: string
  transactions: WalletTxn[]
}

export interface RideLocation {
  id?: string | number
  ride_id?: string | number
  lat: number
  lng: number
  eta?: number | null
  recorded_at?: string | null
}

export interface Message {
  id: string | number
  ride_id?: string | number
  sender_id: string | number
  receiver_id?: string | number
  sender_name?: string | null
  body: string
  is_read?: boolean
  created_at?: string | null
}

/** WebSocket chat frame from `/ws/rides/{id}/chat`. */
export interface ChatWsPacket {
  type: 'ready' | 'message' | 'pong' | 'error' | string
  peer_id?: string | null
  user_id?: string | null
  room?: string | null
  data?: Message | null
  detail?: string | null
}

export interface ReportSummary {
  total_trips: number
  total_distance_km: number
  total_fuel_litres: number
  avg_cost_per_km: number
  co2_saved_kg: number
  utilization_rate: number
  per_vehicle: {
    model: string
    trips: number
    distance: number
    fuel: number
    cost: number
  }[]
  monthly: {
    month: string
    trips: number
    distance_km: number
    fuel_litres: number
    cost: number
  }[]
}
