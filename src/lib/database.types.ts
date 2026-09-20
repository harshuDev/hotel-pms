export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          property_id: string
          summary: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json
          property_id: string
          summary: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json
          property_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_property_id_fkey"
            columns: ["actor_id", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "activity_log_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_room_nights: {
        Row: {
          booking_room_id: string
          created_at: string
          discount_cents: number
          id: string
          property_id: string
          room_rate_cents: number
          status: Database["public"]["Enums"]["booking_status"]
          stay_date: string
          tax_cents: number
          updated_at: string
        }
        Insert: {
          booking_room_id: string
          created_at?: string
          discount_cents?: number
          id?: string
          property_id: string
          room_rate_cents?: number
          status?: Database["public"]["Enums"]["booking_status"]
          stay_date: string
          tax_cents?: number
          updated_at?: string
        }
        Update: {
          booking_room_id?: string
          created_at?: string
          discount_cents?: number
          id?: string
          property_id?: string
          room_rate_cents?: number
          status?: Database["public"]["Enums"]["booking_status"]
          stay_date?: string
          tax_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_room_nights_booking_room_id_property_id_fkey"
            columns: ["booking_room_id", "property_id"]
            isOneToOne: false
            referencedRelation: "booking_rooms"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "booking_room_nights_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_rooms: {
        Row: {
          adults: number
          booking_id: string
          check_in: string
          check_out: string
          children: number
          created_at: string
          id: string
          property_id: string
          rate_plan_id: string | null
          room_id: string | null
          room_type_id: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          adults?: number
          booking_id: string
          check_in: string
          check_out: string
          children?: number
          created_at?: string
          id?: string
          property_id: string
          rate_plan_id?: string | null
          room_id?: string | null
          room_type_id: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          adults?: number
          booking_id?: string
          check_in?: string
          check_out?: string
          children?: number
          created_at?: string
          id?: string
          property_id?: string
          rate_plan_id?: string | null
          room_id?: string | null
          room_type_id?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_rooms_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id", "property_id"]
          },
          {
            foreignKeyName: "booking_rooms_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "booking_rooms_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_rooms_rate_plan_fkey"
            columns: ["rate_plan_id", "property_id"]
            isOneToOne: false
            referencedRelation: "rate_plans"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "booking_rooms_room_id_property_id_fkey"
            columns: ["room_id", "property_id"]
            isOneToOne: false
            referencedRelation: "room_house_states"
            referencedColumns: ["room_id", "property_id"]
          },
          {
            foreignKeyName: "booking_rooms_room_id_property_id_fkey"
            columns: ["room_id", "property_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "booking_rooms_room_type_id_property_id_fkey"
            columns: ["room_type_id", "property_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      booking_waitlist: {
        Row: {
          adults: number
          check_in: string
          check_out: string
          children: number
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          converted_booking_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          notes: string | null
          property_id: string
          room_type_id: string | null
          status: Database["public"]["Enums"]["waitlist_status"]
        }
        Insert: {
          adults?: number
          check_in: string
          check_out: string
          children?: number
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          converted_booking_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          property_id: string
          room_type_id?: string | null
          status?: Database["public"]["Enums"]["waitlist_status"]
        }
        Update: {
          adults?: number
          check_in?: string
          check_out?: string
          children?: number
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          converted_booking_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          property_id?: string
          room_type_id?: string | null
          status?: Database["public"]["Enums"]["waitlist_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booking_waitlist_converted_booking_id_property_id_fkey"
            columns: ["converted_booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id", "property_id"]
          },
          {
            foreignKeyName: "booking_waitlist_converted_booking_id_property_id_fkey"
            columns: ["converted_booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "booking_waitlist_created_by_property_id_fkey"
            columns: ["created_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "booking_waitlist_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customer_stats"
            referencedColumns: ["customer_id", "property_id"]
          },
          {
            foreignKeyName: "booking_waitlist_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "booking_waitlist_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_waitlist_room_type_id_property_id_fkey"
            columns: ["room_type_id", "property_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      bookings: {
        Row: {
          adults: number
          arrival_time: string | null
          booked_at: string
          channel_id: string
          check_in: string
          check_out: string
          children: number
          created_at: string
          created_by: string | null
          customer_id: string
          departure_time: string | null
          external_payload: Json | null
          external_reference: string | null
          guest_notes: string | null
          id: string
          internal_notes: string | null
          promotion_id: string | null
          property_id: string
          reference: string
          settlement: Database["public"]["Enums"]["booking_settlement"]
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          adults?: number
          arrival_time?: string | null
          booked_at?: string
          channel_id: string
          check_in: string
          check_out: string
          children?: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          departure_time?: string | null
          external_payload?: Json | null
          external_reference?: string | null
          guest_notes?: string | null
          id?: string
          internal_notes?: string | null
          promotion_id?: string | null
          property_id: string
          reference: string
          settlement?: Database["public"]["Enums"]["booking_settlement"]
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          adults?: number
          arrival_time?: string | null
          booked_at?: string
          channel_id?: string
          check_in?: string
          check_out?: string
          children?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          departure_time?: string | null
          external_payload?: Json | null
          external_reference?: string | null
          guest_notes?: string | null
          id?: string
          internal_notes?: string | null
          promotion_id?: string | null
          property_id?: string
          reference?: string
          settlement?: Database["public"]["Enums"]["booking_settlement"]
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_channel_id_property_id_fkey"
            columns: ["channel_id", "property_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "bookings_created_by_property_id_fkey"
            columns: ["created_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "bookings_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customer_stats"
            referencedColumns: ["customer_id", "property_id"]
          },
          {
            foreignKeyName: "bookings_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "bookings_promotion_fk"
            columns: ["promotion_id", "property_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      business_dates: {
        Row: {
          business_date: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          opened_at: string
          opened_by: string | null
          property_id: string
          status: Database["public"]["Enums"]["business_date_status"]
        }
        Insert: {
          business_date: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          opened_by?: string | null
          property_id: string
          status?: Database["public"]["Enums"]["business_date_status"]
        }
        Update: {
          business_date?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          opened_by?: string | null
          property_id?: string
          status?: Database["public"]["Enums"]["business_date_status"]
        }
        Relationships: [
          {
            foreignKeyName: "business_dates_closed_by_property_id_fkey"
            columns: ["closed_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "business_dates_opened_by_property_id_fkey"
            columns: ["opened_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "business_dates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          note_date: string
          property_id: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          note_date: string
          property_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note_date?: string
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_notes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_policies: {
        Row: {
          created_at: string
          description: string | null
          free_cancellation_days: number | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["cancellation_policy_kind"]
          name: string
          property_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          free_cancellation_days?: number | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["cancellation_policy_kind"]
          name: string
          property_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          free_cancellation_days?: number | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["cancellation_policy_kind"]
          name?: string
          property_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_policies_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount_cents: number
          approved_by: string | null
          business_date_id: string
          category: Database["public"]["Enums"]["paid_out_category"] | null
          created_at: string
          created_by: string
          direction: Database["public"]["Enums"]["cash_movement_direction"]
          id: string
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          payee: string | null
          property_id: string
          reason: string
          recharge_folio_item_id: string | null
          reference: string | null
          shift_id: string
        }
        Insert: {
          amount_cents: number
          approved_by?: string | null
          business_date_id: string
          category?: Database["public"]["Enums"]["paid_out_category"] | null
          created_at?: string
          created_by: string
          direction: Database["public"]["Enums"]["cash_movement_direction"]
          id?: string
          movement_type: Database["public"]["Enums"]["cash_movement_type"]
          payee?: string | null
          property_id: string
          reason: string
          recharge_folio_item_id?: string | null
          reference?: string | null
          shift_id: string
        }
        Update: {
          amount_cents?: number
          approved_by?: string | null
          business_date_id?: string
          category?: Database["public"]["Enums"]["paid_out_category"] | null
          created_at?: string
          created_by?: string
          direction?: Database["public"]["Enums"]["cash_movement_direction"]
          id?: string
          movement_type?: Database["public"]["Enums"]["cash_movement_type"]
          payee?: string | null
          property_id?: string
          reason?: string
          recharge_folio_item_id?: string | null
          reference?: string | null
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_approved_by_property_id_fkey"
            columns: ["approved_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "cash_movements_business_date_id_property_id_fkey"
            columns: ["business_date_id", "property_id"]
            isOneToOne: false
            referencedRelation: "business_dates"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "cash_movements_created_by_property_id_fkey"
            columns: ["created_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "cash_movements_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_recharge_folio_item_fk"
            columns: ["recharge_folio_item_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folio_item_lines"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "cash_movements_recharge_folio_item_fk"
            columns: ["recharge_folio_item_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folio_items"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "cash_movements_shift_id_property_id_fkey"
            columns: ["shift_id", "property_id"]
            isOneToOne: false
            referencedRelation: "cashier_shift_summaries"
            referencedColumns: ["shift_id", "property_id"]
          },
          {
            foreignKeyName: "cash_movements_shift_id_property_id_fkey"
            columns: ["shift_id", "property_id"]
            isOneToOne: false
            referencedRelation: "cashier_shifts"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      cashier_shifts: {
        Row: {
          business_date_id: string
          cashier_id: string
          closed_at: string | null
          closing_notes: string | null
          counted_cash_cents: number | null
          created_at: string
          expected_cash_at_close_cents: number | null
          id: string
          opened_at: string
          opening_balance_cents: number
          opening_notes: string | null
          property_id: string
          status: Database["public"]["Enums"]["cashier_shift_status"]
          updated_at: string
          variance_cents: number | null
        }
        Insert: {
          business_date_id: string
          cashier_id: string
          closed_at?: string | null
          closing_notes?: string | null
          counted_cash_cents?: number | null
          created_at?: string
          expected_cash_at_close_cents?: number | null
          id?: string
          opened_at?: string
          opening_balance_cents: number
          opening_notes?: string | null
          property_id: string
          status?: Database["public"]["Enums"]["cashier_shift_status"]
          updated_at?: string
          variance_cents?: number | null
        }
        Update: {
          business_date_id?: string
          cashier_id?: string
          closed_at?: string | null
          closing_notes?: string | null
          counted_cash_cents?: number | null
          created_at?: string
          expected_cash_at_close_cents?: number | null
          id?: string
          opened_at?: string
          opening_balance_cents?: number
          opening_notes?: string | null
          property_id?: string
          status?: Database["public"]["Enums"]["cashier_shift_status"]
          updated_at?: string
          variance_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cashier_shifts_business_date_id_property_id_fkey"
            columns: ["business_date_id", "property_id"]
            isOneToOne: false
            referencedRelation: "business_dates"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "cashier_shifts_cashier_id_property_id_fkey"
            columns: ["cashier_id", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "cashier_shifts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          code: string
          commission_bps: number
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["channel_kind"]
          name: string
          property_id: string
        }
        Insert: {
          code: string
          commission_bps?: number
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["channel_kind"]
          name: string
          property_id: string
        }
        Update: {
          code?: string
          commission_bps?: number
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["channel_kind"]
          name?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          company_name: string | null
          country: string | null
          created_at: string
          customer_number: number
          date_of_birth: string | null
          email: string | null
          exclude_from_email: boolean
          first_name: string | null
          id: string
          kind: Database["public"]["Enums"]["customer_kind"]
          last_name: string | null
          merged_into_id: string | null
          national_id_number: string | null
          nationality: string | null
          passport_expiry: string | null
          passport_number: string | null
          phone: string | null
          property_id: string
        }
        Insert: {
          company_name?: string | null
          country?: string | null
          created_at?: string
          customer_number?: number
          date_of_birth?: string | null
          email?: string | null
          exclude_from_email?: boolean
          first_name?: string | null
          id?: string
          kind: Database["public"]["Enums"]["customer_kind"]
          last_name?: string | null
          merged_into_id?: string | null
          national_id_number?: string | null
          nationality?: string | null
          passport_expiry?: string | null
          passport_number?: string | null
          phone?: string | null
          property_id: string
        }
        Update: {
          company_name?: string | null
          country?: string | null
          created_at?: string
          customer_number?: number
          date_of_birth?: string | null
          email?: string | null
          exclude_from_email?: boolean
          first_name?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["customer_kind"]
          last_name?: string | null
          merged_into_id?: string | null
          national_id_number?: string | null
          nationality?: string | null
          passport_expiry?: string | null
          passport_number?: string | null
          phone?: string | null
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_merged_into_id_property_id_fkey"
            columns: ["merged_into_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customer_stats"
            referencedColumns: ["customer_id", "property_id"]
          },
          {
            foreignKeyName: "customers_merged_into_id_property_id_fkey"
            columns: ["merged_into_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "customers_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      folio_items: {
        Row: {
          amount_cents: number
          booking_id: string | null
          booking_room_night_id: string | null
          business_date: string
          created_at: string
          description: string
          folio_id: string
          id: string
          item_type: Database["public"]["Enums"]["folio_item_type"]
          net_amount_cents: number
          posted_at: string
          posted_by: string | null
          property_id: string
          quantity: number
          reverses_id: string | null
          signed_amount_cents: number | null
          signed_net_amount_cents: number | null
          signed_tax_amount_cents: number | null
          tax_amount_cents: number
          tax_rate_id: string | null
          unit_amount_cents: number
        }
        Insert: {
          amount_cents: number
          booking_id?: string | null
          booking_room_night_id?: string | null
          business_date: string
          created_at?: string
          description: string
          folio_id: string
          id?: string
          item_type: Database["public"]["Enums"]["folio_item_type"]
          net_amount_cents: number
          posted_at?: string
          posted_by?: string | null
          property_id: string
          quantity?: number
          reverses_id?: string | null
          signed_amount_cents?: number | null
          signed_net_amount_cents?: number | null
          signed_tax_amount_cents?: number | null
          tax_amount_cents?: number
          tax_rate_id?: string | null
          unit_amount_cents: number
        }
        Update: {
          amount_cents?: number
          booking_id?: string | null
          booking_room_night_id?: string | null
          business_date?: string
          created_at?: string
          description?: string
          folio_id?: string
          id?: string
          item_type?: Database["public"]["Enums"]["folio_item_type"]
          net_amount_cents?: number
          posted_at?: string
          posted_by?: string | null
          property_id?: string
          quantity?: number
          reverses_id?: string | null
          signed_amount_cents?: number | null
          signed_net_amount_cents?: number | null
          signed_tax_amount_cents?: number | null
          tax_amount_cents?: number
          tax_rate_id?: string | null
          unit_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "folio_items_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_booking_room_night_id_property_id_fkey"
            columns: ["booking_room_night_id", "property_id"]
            isOneToOne: false
            referencedRelation: "booking_room_nights"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_folio_id_property_id_fkey"
            columns: ["folio_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folio_balances"
            referencedColumns: ["folio_id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_folio_id_property_id_fkey"
            columns: ["folio_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_posted_by_property_id_fkey"
            columns: ["posted_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_items_reverses_id_property_id_fkey"
            columns: ["reverses_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folio_item_lines"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_reverses_id_property_id_fkey"
            columns: ["reverses_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folio_items"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_tax_rate_id_property_id_fkey"
            columns: ["tax_rate_id", "property_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      folios: {
        Row: {
          booking_id: string | null
          closed_at: string | null
          created_at: string
          currency: string
          customer_id: string | null
          folio_number: number
          id: string
          is_primary: boolean
          kind: Database["public"]["Enums"]["folio_kind"]
          opened_at: string
          property_id: string
          status: Database["public"]["Enums"]["folio_status"]
          updated_at: string
        }
        Insert: {
          booking_id?: string | null
          closed_at?: string | null
          created_at?: string
          currency: string
          customer_id?: string | null
          folio_number?: number
          id?: string
          is_primary?: boolean
          kind?: Database["public"]["Enums"]["folio_kind"]
          opened_at?: string
          property_id: string
          status?: Database["public"]["Enums"]["folio_status"]
          updated_at?: string
        }
        Update: {
          booking_id?: string | null
          closed_at?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          folio_number?: number
          id?: string
          is_primary?: boolean
          kind?: Database["public"]["Enums"]["folio_kind"]
          opened_at?: string
          property_id?: string
          status?: Database["public"]["Enums"]["folio_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "folios_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id", "property_id"]
          },
          {
            foreignKeyName: "folios_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folios_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customer_stats"
            referencedColumns: ["customer_id", "property_id"]
          },
          {
            foreignKeyName: "folios_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folios_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_room_bookings: {
        Row: {
          comments: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          ends_on: string
          event_name: string
          folio_id: string | null
          guest_count: number
          id: string
          meeting_room_id: string
          property_id: string
          reference: string
          starts_on: string
          status: Database["public"]["Enums"]["meeting_room_booking_status"]
          updated_at: string
        }
        Insert: {
          comments?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          ends_on: string
          event_name: string
          folio_id?: string | null
          guest_count: number
          id?: string
          meeting_room_id: string
          property_id: string
          reference: string
          starts_on: string
          status?: Database["public"]["Enums"]["meeting_room_booking_status"]
          updated_at?: string
        }
        Update: {
          comments?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          ends_on?: string
          event_name?: string
          folio_id?: string | null
          guest_count?: number
          id?: string
          meeting_room_id?: string
          property_id?: string
          reference?: string
          starts_on?: string
          status?: Database["public"]["Enums"]["meeting_room_booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_room_bookings_created_by_property_id_fkey"
            columns: ["created_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "meeting_room_bookings_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customer_stats"
            referencedColumns: ["customer_id", "property_id"]
          },
          {
            foreignKeyName: "meeting_room_bookings_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "meeting_room_bookings_folio_id_property_id_fkey"
            columns: ["folio_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folio_balances"
            referencedColumns: ["folio_id", "property_id"]
          },
          {
            foreignKeyName: "meeting_room_bookings_folio_id_property_id_fkey"
            columns: ["folio_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "meeting_room_bookings_meeting_room_id_property_id_fkey"
            columns: ["meeting_room_id", "property_id"]
            isOneToOne: false
            referencedRelation: "meeting_rooms"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "meeting_room_bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_rooms: {
        Row: {
          capacity: number | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          property_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          property_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          property_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_rooms_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          affects_drawer: boolean
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["payment_method_kind"]
          name: string
          property_id: string
        }
        Insert: {
          affects_drawer?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["payment_method_kind"]
          name: string
          property_id: string
        }
        Update: {
          affects_drawer?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["payment_method_kind"]
          name?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          authorization_reference: string | null
          booking_id: string | null
          business_date: string
          created_at: string
          currency: string
          external_reference: string | null
          folio_id: string
          id: string
          paid_at: string
          payment_method_id: string
          property_id: string
          received_by: string | null
          reverses_id: string | null
          shift_id: string | null
          signed_amount_cents: number | null
          status: Database["public"]["Enums"]["payment_status"]
        }
        Insert: {
          amount_cents: number
          authorization_reference?: string | null
          booking_id?: string | null
          business_date: string
          created_at?: string
          currency: string
          external_reference?: string | null
          folio_id: string
          id?: string
          paid_at?: string
          payment_method_id: string
          property_id: string
          received_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          signed_amount_cents?: number | null
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Update: {
          amount_cents?: number
          authorization_reference?: string | null
          booking_id?: string | null
          business_date?: string
          created_at?: string
          currency?: string
          external_reference?: string | null
          folio_id?: string
          id?: string
          paid_at?: string
          payment_method_id?: string
          property_id?: string
          received_by?: string | null
          reverses_id?: string | null
          shift_id?: string | null
          signed_amount_cents?: number | null
          status?: Database["public"]["Enums"]["payment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id", "property_id"]
          },
          {
            foreignKeyName: "payments_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "payments_folio_id_property_id_fkey"
            columns: ["folio_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folio_balances"
            referencedColumns: ["folio_id", "property_id"]
          },
          {
            foreignKeyName: "payments_folio_id_property_id_fkey"
            columns: ["folio_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "payments_payment_method_id_property_id_fkey"
            columns: ["payment_method_id", "property_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "payments_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_by_property_id_fkey"
            columns: ["received_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "payments_reverses_id_property_id_fkey"
            columns: ["reverses_id", "property_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "payments_shift_property_fk"
            columns: ["shift_id", "property_id"]
            isOneToOne: false
            referencedRelation: "cashier_shift_summaries"
            referencedColumns: ["shift_id", "property_id"]
          },
          {
            foreignKeyName: "payments_shift_property_fk"
            columns: ["shift_id", "property_id"]
            isOneToOne: false
            referencedRelation: "cashier_shifts"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      promotion_rate_plans: {
        Row: {
          promotion_id: string
          property_id: string
          rate_plan_id: string
        }
        Insert: {
          promotion_id: string
          property_id: string
          rate_plan_id: string
        }
        Update: {
          promotion_id?: string
          property_id?: string
          rate_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_rate_plans_promotion_id_property_id_fkey"
            columns: ["promotion_id", "property_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "promotion_rate_plans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_rate_plans_rate_plan_id_property_id_fkey"
            columns: ["rate_plan_id", "property_id"]
            isOneToOne: false
            referencedRelation: "rate_plans"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      promotion_room_types: {
        Row: {
          promotion_id: string
          property_id: string
          room_type_id: string
        }
        Insert: {
          promotion_id: string
          property_id: string
          room_type_id: string
        }
        Update: {
          promotion_id?: string
          property_id?: string
          room_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_room_types_promotion_id_property_id_fkey"
            columns: ["promotion_id", "property_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "promotion_room_types_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_room_types_room_type_id_property_id_fkey"
            columns: ["room_type_id", "property_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      promotions: {
        Row: {
          amount_off_cents: number | null
          arrival_days_of_week: number[] | null
          code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          free_nights: number | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["promotion_kind"]
          max_advance_days: number | null
          max_nights: number | null
          min_advance_days: number | null
          min_nights: number | null
          name: string
          paid_nights: number | null
          percent_bps: number | null
          priority: number
          property_id: string
          sell_from: string | null
          sell_to: string | null
          stay_from: string | null
          stay_to: string | null
          updated_at: string
        }
        Insert: {
          amount_off_cents?: number | null
          arrival_days_of_week?: number[] | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          free_nights?: number | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["promotion_kind"]
          max_advance_days?: number | null
          max_nights?: number | null
          min_advance_days?: number | null
          min_nights?: number | null
          name: string
          paid_nights?: number | null
          percent_bps?: number | null
          priority?: number
          property_id: string
          sell_from?: string | null
          sell_to?: string | null
          stay_from?: string | null
          stay_to?: string | null
          updated_at?: string
        }
        Update: {
          amount_off_cents?: number | null
          arrival_days_of_week?: number[] | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          free_nights?: number | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["promotion_kind"]
          max_advance_days?: number | null
          max_nights?: number | null
          min_advance_days?: number | null
          min_nights?: number | null
          name?: string
          paid_nights?: number | null
          percent_bps?: number | null
          priority?: number
          property_id?: string
          sell_from?: string | null
          sell_to?: string | null
          stay_from?: string | null
          stay_to?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_created_by_property_id_fkey"
            columns: ["created_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "promotions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          check_in_time: string
          check_out_time: string
          created_at: string
          currency: string
          id: string
          is_active: boolean
          name: string
          timezone: string
        }
        Insert: {
          check_in_time: string
          check_out_time: string
          created_at?: string
          currency: string
          id?: string
          is_active?: boolean
          name: string
          timezone: string
        }
        Update: {
          check_in_time?: string
          check_out_time?: string
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name?: string
          timezone?: string
        }
        Relationships: []
      }
      rate_plan_days: {
        Row: {
          closed_to_arrival: boolean
          closed_to_departure: boolean
          id: string
          max_stay: number | null
          min_stay_arrival: number | null
          min_stay_through: number | null
          property_id: string
          rate_cents: number | null
          rate_plan_id: string
          room_type_id: string
          stay_date: string
          stop_sell: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          closed_to_arrival?: boolean
          closed_to_departure?: boolean
          id?: string
          max_stay?: number | null
          min_stay_arrival?: number | null
          min_stay_through?: number | null
          property_id: string
          rate_cents?: number | null
          rate_plan_id: string
          room_type_id: string
          stay_date: string
          stop_sell?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          closed_to_arrival?: boolean
          closed_to_departure?: boolean
          id?: string
          max_stay?: number | null
          min_stay_arrival?: number | null
          min_stay_through?: number | null
          property_id?: string
          rate_cents?: number | null
          rate_plan_id?: string
          room_type_id?: string
          stay_date?: string
          stop_sell?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_plan_days_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_plan_days_rate_plan_id_property_id_fkey"
            columns: ["rate_plan_id", "property_id"]
            isOneToOne: false
            referencedRelation: "rate_plans"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "rate_plan_days_room_type_id_property_id_fkey"
            columns: ["room_type_id", "property_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "rate_plan_days_updated_by_property_id_fkey"
            columns: ["updated_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      rate_plan_meals: {
        Row: {
          created_at: string
          meal: Database["public"]["Enums"]["meal_type"]
          property_id: string
          rate_plan_id: string
          value_cents: number | null
        }
        Insert: {
          created_at?: string
          meal: Database["public"]["Enums"]["meal_type"]
          property_id: string
          rate_plan_id: string
          value_cents?: number | null
        }
        Update: {
          created_at?: string
          meal?: Database["public"]["Enums"]["meal_type"]
          property_id?: string
          rate_plan_id?: string
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_plan_meals_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_plan_meals_rate_plan_id_property_id_fkey"
            columns: ["rate_plan_id", "property_id"]
            isOneToOne: false
            referencedRelation: "rate_plans"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      rate_plans: {
        Row: {
          cancellation_policy_id: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          is_public: boolean
          name: string
          property_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          cancellation_policy_id?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_public?: boolean
          name: string
          property_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          cancellation_policy_id?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_public?: boolean
          name?: string
          property_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_plans_cancellation_policy_id_fkey"
            columns: ["cancellation_policy_id"]
            isOneToOne: false
            referencedRelation: "cancellation_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_plans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      room_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          created_at: string
          id: string
          property_id: string
          room_id: string
          status: Database["public"]["Enums"]["room_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          property_id: string
          room_id: string
          status: Database["public"]["Enums"]["room_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          property_id?: string
          room_id?: string
          status?: Database["public"]["Enums"]["room_status"]
        }
        Relationships: [
          {
            foreignKeyName: "room_status_history_changed_by_property_id_fkey"
            columns: ["changed_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "room_status_history_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_status_history_room_id_property_id_fkey"
            columns: ["room_id", "property_id"]
            isOneToOne: false
            referencedRelation: "room_house_states"
            referencedColumns: ["room_id", "property_id"]
          },
          {
            foreignKeyName: "room_status_history_room_id_property_id_fkey"
            columns: ["room_id", "property_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      room_type_days: {
        Row: {
          allotment: number | null
          close_out: boolean
          id: string
          property_id: string
          room_type_id: string
          stay_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allotment?: number | null
          close_out?: boolean
          id?: string
          property_id: string
          room_type_id: string
          stay_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allotment?: number | null
          close_out?: boolean
          id?: string
          property_id?: string
          room_type_id?: string
          stay_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_type_days_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_type_days_room_type_id_property_id_fkey"
            columns: ["room_type_id", "property_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "room_type_days_updated_by_property_id_fkey"
            columns: ["updated_by", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      room_types: {
        Row: {
          base_occupancy: number
          code: string
          created_at: string
          id: string
          max_occupancy: number
          name: string
          property_id: string
          sort_order: number
        }
        Insert: {
          base_occupancy: number
          code: string
          created_at?: string
          id?: string
          max_occupancy: number
          name: string
          property_id: string
          sort_order?: number
        }
        Update: {
          base_occupancy?: number
          code?: string
          created_at?: string
          id?: string
          max_occupancy?: number
          name?: string
          property_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_types_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          floor: number | null
          id: string
          number: string
          photo_path: string | null
          property_id: string
          room_type_id: string
          status: Database["public"]["Enums"]["room_status"]
        }
        Insert: {
          created_at?: string
          floor?: number | null
          id?: string
          number: string
          photo_path?: string | null
          property_id: string
          room_type_id: string
          status?: Database["public"]["Enums"]["room_status"]
        }
        Update: {
          created_at?: string
          floor?: number | null
          id?: string
          number?: string
          photo_path?: string | null
          property_id?: string
          room_type_id?: string
          status?: Database["public"]["Enums"]["room_status"]
        }
        Relationships: [
          {
            foreignKeyName: "rooms_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_room_type_id_property_id_fkey"
            columns: ["room_type_id", "property_id"]
            isOneToOne: false
            referencedRelation: "room_types"
            referencedColumns: ["id", "property_id"]
          },
        ]
      }
      seasons: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          name: string
          property_id: string
          starts_on: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          name: string
          property_id: string
          starts_on: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          name?: string
          property_id?: string
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "seasons_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_users: {
        Row: {
          activity_seen_at: string | null
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          property_id: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          activity_seen_at?: string | null
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          property_id: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          activity_seen_at?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          property_id?: string
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: [
          {
            foreignKeyName: "staff_users_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          created_at: string
          id: string
          inclusion: Database["public"]["Enums"]["tax_inclusion"]
          is_active: boolean
          name: string
          property_id: string
          rate_bps: number
        }
        Insert: {
          created_at?: string
          id?: string
          inclusion?: Database["public"]["Enums"]["tax_inclusion"]
          is_active?: boolean
          name: string
          property_id: string
          rate_bps: number
        }
        Update: {
          created_at?: string
          id?: string
          inclusion?: Database["public"]["Enums"]["tax_inclusion"]
          is_active?: boolean
          name?: string
          property_id?: string
          rate_bps?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      booking_totals: {
        Row: {
          adults: number | null
          balance_cents: number | null
          booked_at: string | null
          booked_on: string | null
          booking_id: string | null
          channel_name: string | null
          check_in: string | null
          check_out: string | null
          children: number | null
          customer_id: string | null
          customer_name: string | null
          nights: number | null
          property_id: string | null
          reference: string | null
          room_count: number | null
          room_number: string | null
          room_type_name: string | null
          settlement: Database["public"]["Enums"]["booking_settlement"] | null
          status: Database["public"]["Enums"]["booking_status"] | null
          total_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customer_stats"
            referencedColumns: ["customer_id", "property_id"]
          },
          {
            foreignKeyName: "bookings_customer_id_property_id_fkey"
            columns: ["customer_id", "property_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      cashier_shift_summaries: {
        Row: {
          adjustments_cents: number | null
          business_date: string | null
          business_date_id: string | null
          cash_added_cents: number | null
          cash_drops_cents: number | null
          cash_payments_cents: number | null
          cashier_id: string | null
          closed_at: string | null
          counted_cash_cents: number | null
          expected_cash_at_close_cents: number | null
          expected_cash_cents: number | null
          opened_at: string | null
          opening_balance_cents: number | null
          paid_outs_cents: number | null
          property_id: string | null
          shift_id: string | null
          status: Database["public"]["Enums"]["cashier_shift_status"] | null
          variance_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cashier_shifts_cashier_id_property_id_fkey"
            columns: ["cashier_id", "property_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "cashier_shifts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_stats: {
        Row: {
          balance_cents: number | null
          booking_count: number | null
          customer_id: string | null
          customer_number: number | null
          email: string | null
          exclude_from_email: boolean | null
          kind: Database["public"]["Enums"]["customer_kind"] | null
          last_booking_date: string | null
          name: string | null
          national_id_number: string | null
          phone: string | null
          property_id: string | null
          total_revenue_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      folio_balances: {
        Row: {
          booking_id: string | null
          folio_id: string | null
          outstanding_cents: number | null
          property_id: string | null
          settlement_status: string | null
          total_charges_cents: number | null
          total_payments_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "folios_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id", "property_id"]
          },
          {
            foreignKeyName: "folios_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folios_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      folio_item_lines: {
        Row: {
          booking_id: string | null
          business_date: string | null
          description: string | null
          effective_item_type:
            | Database["public"]["Enums"]["folio_item_type"]
            | null
          folio_id: string | null
          id: string | null
          is_discount: boolean | null
          is_reversal: boolean | null
          posted_at: string | null
          posted_item_type:
            | Database["public"]["Enums"]["folio_item_type"]
            | null
          property_id: string | null
          quantity: number | null
          signed_amount_cents: number | null
          signed_net_amount_cents: number | null
          signed_tax_amount_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "folio_items_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "booking_totals"
            referencedColumns: ["booking_id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_booking_id_property_id_fkey"
            columns: ["booking_id", "property_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_folio_id_property_id_fkey"
            columns: ["folio_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folio_balances"
            referencedColumns: ["folio_id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_folio_id_property_id_fkey"
            columns: ["folio_id", "property_id"]
            isOneToOne: false
            referencedRelation: "folios"
            referencedColumns: ["id", "property_id"]
          },
          {
            foreignKeyName: "folio_items_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_outstanding: {
        Row: {
          open_folio_count: number | null
          outstanding_cents: number | null
          property_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folios_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      room_house_states: {
        Row: {
          business_date: string | null
          floor: number | null
          guest_name: string | null
          housekeeping_status: Database["public"]["Enums"]["room_status"] | null
          nights_left: number | null
          number: string | null
          property_id: string | null
          room_id: string | null
          room_type_name: string | null
          state: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accounting_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          code: string
          gross_cents: number
          label: string
          net_cents: number
          section: string
          tax_cents: number
        }[]
      }
      activity_feed: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          created_at: string
          emphasis: string[]
          id: string
          kind: string
          summary: string
          unread: boolean
        }[]
      }
      add_to_waitlist: {
        Args: {
          p_adults?: number
          p_check_in: string
          p_check_out: string
          p_children?: number
          p_contact_email?: string
          p_contact_name?: string
          p_contact_phone?: string
          p_customer_id?: string
          p_notes?: string
          p_room_type_id?: string
        }
        Returns: string
      }
      apply_tax_rate: {
        Args: { p_amount_cents: number; p_tax_rate_id: string }
        Returns: {
          gross_cents: number
          net_cents: number
          tax_cents: number
        }[]
      }
      assign_room: {
        Args: { p_booking_room_id: string; p_room_id: string }
        Returns: undefined
      }
      available_rooms_for_booking_room: {
        Args: { p_booking_room_id: string }
        Returns: {
          floor: number
          number: string
          room_id: string
          room_type_name: string
        }[]
      }
      best_promotion: {
        Args: {
          p_booked_on?: string
          p_check_in: string
          p_check_out: string
          p_code?: string
          p_rate_plan_id: string
          p_room_type_id: string
        }
        Returns: {
          code: string
          kind: Database["public"]["Enums"]["promotion_kind"]
          name: string
          promotion_id: string
          total_discount_cents: number
        }[]
      }
      book_meeting_room: {
        Args: {
          p_comments?: string
          p_customer_id?: string
          p_ends_on: string
          p_event_name: string
          p_guest_count: number
          p_meeting_room_id: string
          p_starts_on: string
          p_status?: Database["public"]["Enums"]["meeting_room_booking_status"]
        }
        Returns: {
          booking_id: string
          reference: string
        }[]
      }
      bookable_room_types: {
        Args: { p_from: string; p_to: string }
        Returns: {
          available: number
          base_occupancy: number
          code: string
          max_occupancy: number
          name: string
          room_type_id: string
          total_rooms: number
        }[]
      }
      booking_activity: {
        Args: { p_booking_id: string }
        Returns: {
          action: string
          activity_id: string
          actor: string
          created_at: string
          summary: string
        }[]
      }
      booking_cancellation_terms: {
        Args: { p_booking_id: string }
        Returns: {
          free_cancellation_days: number
          free_until: string
          has_no_policy: boolean
          is_free_now: boolean
          is_mixed: boolean
          kind: Database["public"]["Enums"]["cancellation_policy_kind"]
          policy_name: string
        }[]
      }
      booking_detail: {
        Args: { p_booking_id: string }
        Returns: {
          adults: number
          arrival_time: string
          balance_cents: number
          booked_by: string
          booked_on: string
          booking_id: string
          business_date: string
          channel_id: string
          channel_name: string
          charges_cents: number
          check_in: string
          check_out: string
          children: number
          customer_email: string
          customer_id: string
          customer_name: string
          customer_phone: string
          departure_time: string
          external_reference: string
          guest_notes: string
          internal_notes: string
          nights: number
          payments_cents: number
          reference: string
          reservation_value_cents: number
          room_count: number
          rooms_assigned: number
          settlement: Database["public"]["Enums"]["booking_settlement"]
          status: Database["public"]["Enums"]["booking_status"]
        }[]
      }
      booking_folio_lines: {
        Args: { p_booking_id: string }
        Returns: {
          amount_cents: number
          business_date: string
          description: string
          folio_id: string
          folio_number: number
          is_reversal: boolean
          item_type: Database["public"]["Enums"]["folio_item_type"]
          kind: string
          line_id: string
          posted_at: string
        }[]
      }
      booking_nights: {
        Args: { p_booking_id: string }
        Returns: {
          booking_room_id: string
          charged: boolean
          discount_cents: number
          room_number: string
          room_rate_cents: number
          room_type_name: string
          status: Database["public"]["Enums"]["booking_status"]
          stay_date: string
          tax_cents: number
        }[]
      }
      booking_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          booked_on: string
          booking_id: string
          channel_kind: Database["public"]["Enums"]["channel_kind"]
          channel_name: string
          check_in: string
          check_out: string
          guest_name: string
          nights: number
          reference: string
          room_count: number
          room_nights: number
          settlement: Database["public"]["Enums"]["booking_settlement"]
          status: Database["public"]["Enums"]["booking_status"]
          value_cents: number
        }[]
      }
      booking_report_by_channel: {
        Args: { p_from: string; p_to: string }
        Returns: {
          booking_count: number
          canceled_count: number
          channel_kind: Database["public"]["Enums"]["channel_kind"]
          channel_name: string
          commission_bps: number
          room_nights: number
          value_cents: number
        }[]
      }
      booking_room_lines: {
        Args: { p_booking_id: string }
        Returns: {
          adults: number
          booking_room_id: string
          check_in: string
          check_out: string
          children: number
          discount_cents: number
          nights: number
          nights_charged: number
          room_id: string
          room_number: string
          room_type_id: string
          room_type_name: string
          status: Database["public"]["Enums"]["booking_status"]
          tax_cents: number
          value_cents: number
        }[]
      }
      booking_rooms_for_assignment: {
        Args: { p_booking_id: string }
        Returns: {
          booking_room_id: string
          check_in: string
          check_out: string
          room_id: string
          room_number: string
          room_type_name: string
        }[]
      }
      booking_waitlist_report: {
        Args: {
          p_from: string
          p_status?: Database["public"]["Enums"]["waitlist_status"]
          p_to: string
        }
        Returns: {
          adults: number
          check_in: string
          check_out: string
          children: number
          contact_email: string
          contact_phone: string
          converted_reference: string
          created_at: string
          created_by_name: string
          guest_name: string
          id: string
          nights: number
          notes: string
          room_type_name: string
          status: string
        }[]
      }
      bookings_page: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_q?: string
          p_status?: Database["public"]["Enums"]["booking_status"]
        }
        Returns: {
          adults: number
          balance_cents: number
          booked_at: string
          booked_on: string
          booking_id: string
          channel_name: string
          check_in: string
          check_out: string
          children: number
          customer_id: string
          customer_name: string
          nights: number
          reference: string
          room_count: number
          room_number: string
          room_type_name: string
          settlement: Database["public"]["Enums"]["booking_settlement"]
          status: Database["public"]["Enums"]["booking_status"]
          total_cents: number
          total_count: number
        }[]
      }
      calendar_availability: {
        Args: { p_days?: number; p_from: string }
        Returns: {
          available: number
          out_of_order: number
          room_type_code: string
          room_type_id: string
          room_type_name: string
          sellable: number
          sold: number
          stay_date: string
          total_rooms: number
        }[]
      }
      calendar_bookings: {
        Args: {
          p_days?: number
          p_from: string
          p_include_canceled?: boolean
          p_max_per_type?: number
        }
        Returns: {
          booking_id: string
          booking_room_id: string
          check_in: string
          check_out: string
          guest_name: string
          guests: number
          has_notes: boolean
          reference: string
          room_number: string
          room_type_id: string
          status: Database["public"]["Enums"]["booking_status"]
          type_total: number
          value_cents: number
        }[]
      }
      calendar_notes_for: {
        Args: { p_days?: number; p_from: string }
        Returns: {
          author: string
          body: string
          created_at: string
          id: string
          note_date: string
          updated_at: string
        }[]
      }
      calendar_room_bars: {
        Args: { p_from: string; p_nights: number; p_unassigned_cap?: number }
        Returns: {
          booking_id: string
          booking_room_id: string
          check_in: string
          check_out: string
          guest_name: string
          guests: number
          has_notes: boolean
          is_assigned: boolean
          rate_plan_name: string
          reference: string
          room_id: string
          room_type_id: string
          status: Database["public"]["Enums"]["booking_status"]
          unassigned_total: number
          value_cents: number
        }[]
      }
      calendar_rooms: {
        Args: never
        Returns: {
          floor: string
          room_id: string
          room_number: string
          room_status: Database["public"]["Enums"]["room_status"]
          room_type_id: string
          room_type_name: string
          sort_order: number
        }[]
      }
      calendar_seasons: {
        Args: { p_days?: number; p_from: string }
        Returns: {
          ends_on: string
          id: string
          name: string
          starts_on: string
        }[]
      }
      can_see_drawer_total: { Args: never; Returns: boolean }
      can_see_money_reports: { Args: never; Returns: boolean }
      cancel_booking: {
        Args: { p_booking_id: string; p_no_show?: boolean; p_reason?: string }
        Returns: number
      }
      cancel_meeting_room_booking: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: number
      }
      cancellation_policies_list: {
        Args: never
        Returns: {
          description: string
          free_cancellation_days: number
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["cancellation_policy_kind"]
          name: string
          rate_plan_count: number
          sort_order: number
        }[]
      }
      cancellation_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          booked_on: string
          booking_id: string
          cancelled_on: string
          channel_name: string
          check_in: string
          check_out: string
          guest_name: string
          lost_value_cents: number
          nights: number
          reference: string
          room_count: number
          room_nights: number
          status: Database["public"]["Enums"]["booking_status"]
        }[]
      }
      cashier_shift_expected: {
        Args: { p_shift_id: string }
        Returns: {
          adjustments_cents: number
          cash_added_cents: number
          cash_drops_cents: number
          cash_payments_cents: number
          expected_cash_cents: number
          opening_balance_cents: number
          paid_outs_cents: number
        }[]
      }
      cashier_shift_expected_for_viewer: {
        Args: { p_shift_id: string }
        Returns: {
          adjustments_cents: number
          cash_added_cents: number
          cash_drops_cents: number
          cash_payments_cents: number
          expected_cash_cents: number
          opening_balance_cents: number
          paid_outs_cents: number
        }[]
      }
      cashier_shift_paid_outs: {
        Args: { p_shift_id: string }
        Returns: {
          amount_cents: number
          category: Database["public"]["Enums"]["paid_out_category"]
          created_at: string
          movement_id: string
          payee: string
          reason: string
          recharge_booking_reference: string
        }[]
      }
      cashier_shift_payments: {
        Args: { p_shift_id: string }
        Returns: {
          affects_drawer: boolean
          amount_cents: number
          booking_reference: string
          guest_name: string
          method_name: string
          paid_at: string
          payment_id: string
          payment_method_id: string
        }[]
      }
      channel_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          booking_count: number
          channel_kind: Database["public"]["Enums"]["channel_kind"]
          channel_name: string
          commission_bps: number
          commission_cents: number
          net_revenue_cents: number
          room_nights: number
          room_revenue_cents: number
        }[]
      }
      charge_meeting_room_booking: {
        Args: {
          p_amount_cents: number
          p_booking_id: string
          p_description?: string
          p_tax_rate_id?: string
        }
        Returns: string
      }
      check_in_booking: {
        Args: { p_booking_id: string }
        Returns: {
          rooms_occupied: number
        }[]
      }
      check_out_booking: {
        Args: { p_booking_id: string }
        Returns: {
          outstanding_cents: number
          rooms_released: number
        }[]
      }
      close_business_date: {
        Args: never
        Returns: {
          closed_date: string
          next_date: string
          no_show_fees_cents: number
          no_shows_marked: number
          room_charges_cents: number
          room_charges_posted: number
        }[]
      }
      close_cashier_shift: {
        Args: {
          p_closing_notes?: string
          p_counted_cash_cents: number
          p_shift_id: string
        }
        Returns: {
          expected_cash_cents: number
          variance_cents: number
        }[]
      }
      close_folio: {
        Args: { p_cancel?: boolean; p_folio_id: string }
        Returns: undefined
      }
      confirm_booking: { Args: { p_booking_id: string }; Returns: undefined }
      country_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          bookings: number
          country: string
          guests: number
          revenue_cents: number
          room_nights: number
        }[]
      }
      create_booking: {
        Args: {
          p_adults?: number
          p_allow_overbook?: boolean
          p_channel_id: string
          p_check_in: string
          p_check_out: string
          p_children?: number
          p_customer?: Json
          p_customer_id?: string
          p_external_reference?: string
          p_guest_notes?: string
          p_ignore_restrictions?: boolean
          p_internal_notes?: string
          p_promotion_code?: string
          p_rate_plan_id?: string
          p_rooms: Json
          p_settlement?: Database["public"]["Enums"]["booking_settlement"]
          p_status?: Database["public"]["Enums"]["booking_status"]
          p_tax_rate_id?: string
        }
        Returns: {
          booking_id: string
          discount_cents: number
          promotion_name: string
          reference: string
        }[]
      }
      create_folio: {
        Args: {
          p_booking_id: string
          p_is_primary?: boolean
          p_kind?: Database["public"]["Enums"]["folio_kind"]
        }
        Returns: string
      }
      create_public_booking: {
        Args: {
          p_adults?: number
          p_check_in: string
          p_check_out: string
          p_children?: number
          p_email: string
          p_first_name: string
          p_last_name: string
          p_notes?: string
          p_phone?: string
          p_property_id: string
          p_rate_plan_id: string
          p_room_type_id: string
        }
        Returns: {
          booking_id: string
          reference: string
        }[]
      }
      create_rate_plan: {
        Args: {
          p_code: string
          p_description?: string
          p_is_default?: boolean
          p_name: string
        }
        Returns: string
      }
      create_rooms: {
        Args: {
          p_first: number
          p_floor?: number
          p_last: number
          p_prefix?: string
          p_room_type_id: string
        }
        Returns: number
      }
      current_cashier_shift: {
        Args: never
        Returns: {
          business_date: string
          cashier_id: string
          cashier_name: string
          opened_at: string
          opening_balance_cents: number
          shift_id: string
          status: Database["public"]["Enums"]["cashier_shift_status"]
        }[]
      }
      current_property_id: { Args: never; Returns: string }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      customer_display_name: {
        Args: { p_customer: Database["public"]["Tables"]["customers"]["Row"] }
        Returns: string
      }
      customer_for_edit: {
        Args: { p_id: string }
        Returns: {
          company_name: string
          country: string
          date_of_birth: string
          email: string
          exclude_from_email: boolean
          first_name: string
          id: string
          kind: Database["public"]["Enums"]["customer_kind"]
          last_name: string
          national_id_number: string
          nationality: string
          passport_expiry: string
          passport_number: string
          phone: string
        }[]
      }
      customers_page: {
        Args: {
          p_kind?: Database["public"]["Enums"]["customer_kind"]
          p_limit?: number
          p_offset?: number
          p_q?: string
        }
        Returns: {
          balance_cents: number
          booking_count: number
          customer_id: string
          customer_number: number
          email: string
          exclude_from_email: boolean
          kind: Database["public"]["Enums"]["customer_kind"]
          last_booking_date: string
          name: string
          national_id_number: string
          phone: string
          total_count: number
          total_revenue_cents: number
        }[]
      }
      daily_checkout_report: {
        Args: { p_date: string }
        Returns: {
          booking_id: string
          channel_name: string
          charges_cents: number
          check_in: string
          check_out: string
          guest_name: string
          nights: number
          outstanding_cents: number
          payments_cents: number
          reference: string
          room_numbers: string
        }[]
      }
      dashboard_arrivals: {
        Args: { p_date: string }
        Returns: {
          adults: number | null
          balance_cents: number | null
          booked_at: string | null
          booked_on: string | null
          booking_id: string | null
          channel_name: string | null
          check_in: string | null
          check_out: string | null
          children: number | null
          customer_id: string | null
          customer_name: string | null
          nights: number | null
          property_id: string | null
          reference: string | null
          room_count: number | null
          room_number: string | null
          room_type_name: string | null
          settlement: Database["public"]["Enums"]["booking_settlement"] | null
          status: Database["public"]["Enums"]["booking_status"] | null
          total_cents: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "booking_totals"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      dashboard_departures: {
        Args: { p_date: string }
        Returns: {
          adults: number | null
          balance_cents: number | null
          booked_at: string | null
          booked_on: string | null
          booking_id: string | null
          channel_name: string | null
          check_in: string | null
          check_out: string | null
          children: number | null
          customer_id: string | null
          customer_name: string | null
          nights: number | null
          property_id: string | null
          reference: string | null
          room_count: number | null
          room_number: string | null
          room_type_name: string | null
          settlement: Database["public"]["Enums"]["booking_settlement"] | null
          status: Database["public"]["Enums"]["booking_status"] | null
          total_cents: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "booking_totals"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      debtors_report: {
        Args: never
        Returns: {
          booking_id: string
          charges_cents: number
          check_in: string
          check_out: string
          customer_name: string
          days_overdue: number
          kind: string
          outstanding_cents: number
          payments_cents: number
          reference: string
          status: Database["public"]["Enums"]["booking_status"]
        }[]
      }
      delete_calendar_note: { Args: { p_id: string }; Returns: undefined }
      delete_room: { Args: { p_room_id: string }; Returns: undefined }
      delete_season: { Args: { p_id: string }; Returns: undefined }
      deposit_report: {
        Args: never
        Returns: {
          booking_id: string
          charges_cents: number
          check_in: string
          check_out: string
          days_to_arrival: number
          deposit_cents: number
          guest_name: string
          nights: number
          reference: string
          status: string
          stay_value_cents: number
        }[]
      }
      eligible_promotions: {
        Args: {
          p_booked_on?: string
          p_check_in: string
          p_check_out: string
          p_code?: string
          p_rate_plan_id: string
          p_room_type_id: string
        }
        Returns: {
          amount_off_cents: number | null
          arrival_days_of_week: number[] | null
          code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          free_nights: number | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["promotion_kind"]
          max_advance_days: number | null
          max_nights: number | null
          min_advance_days: number | null
          min_nights: number | null
          name: string
          paid_nights: number | null
          percent_bps: number | null
          priority: number
          property_id: string
          sell_from: string | null
          sell_to: string | null
          stay_from: string | null
          stay_to: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "promotions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      end_of_day_report: {
        Args: { p_date: string }
        Returns: {
          arrivals: number
          business_date: string
          closed_at: string
          closed_by: string
          date_status: string
          departures: number
          drawer_cents: number
          in_house: number
          no_shows: number
          occupancy_pct: number
          other_revenue_cents: number
          payments_cents: number
          room_revenue_cents: number
          rooms_sold: number
          sellable_rooms: number
          shifts_open: number
          tax_cents: number
        }[]
      }
      extras_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          gross_cents: number
          item_count: number
          item_type: Database["public"]["Enums"]["folio_item_type"]
          net_cents: number
          reversal_count: number
          tax_cents: number
        }[]
      }
      financial_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          business_date: string
          charges_cents: number
          discounts_cents: number
          drawer_payments_cents: number
          extras_revenue_cents: number
          payments_cents: number
          room_revenue_cents: number
          tax_cents: number
        }[]
      }
      folio_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          balance_cents: number
          charges_cents: number
          closed_at: string
          folio_id: string
          folio_number: number
          guest_name: string
          kind: string
          opened_at: string
          payments_cents: number
          reference: string
          status: string
        }[]
      }
      get_folio_balance: {
        Args: { p_folio_id: string }
        Returns: {
          outstanding_cents: number
          settlement_status: string
          total_charges_cents: number
          total_payments_cents: number
        }[]
      }
      global_search: {
        Args: { p_limit?: number; p_q: string }
        Returns: {
          id: string
          kind: string
          meta: string
          subtitle: string
          title: string
        }[]
      }
      house_summary: {
        Args: never
        Returns: {
          adr_cents: number
          arriving_rooms: number
          business_date: string
          drawer_cents: number
          due_out_rooms: number
          expected_arrivals: number
          expected_departures: number
          occupancy_pct: number
          occupied_rooms: number
          ooo_rooms: number
          outstanding_cents: number
          sellable_rooms: number
          total_rooms: number
          vacant_clean_rooms: number
          vacant_dirty_rooms: number
        }[]
      }
      housekeeping_rooms: {
        Args: {
          p_floor?: number
          p_limit?: number
          p_offset?: number
          p_state?: string
        }
        Returns: {
          floor: number
          guest_name: string
          housekeeping_status: Database["public"]["Enums"]["room_status"]
          nights_left: number
          number: string
          room_id: string
          room_type_name: string
          state: string
          total_count: number
        }[]
      }
      housekeeping_summary: {
        Args: never
        Returns: {
          arriving: number
          due_out: number
          floor: number
          occupied: number
          ooo: number
          room_count: number
          vacant_clean: number
          vacant_dirty: number
        }[]
      }
      immigration_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          booking_id: string
          check_in: string
          check_out: string
          country: string
          date_of_birth: string
          guest_name: string
          is_complete: boolean
          national_id_number: string
          nationality: string
          nights: number
          passport_expiry: string
          passport_number: string
          reference: string
          room_number: string
        }[]
      }
      in_house_report: {
        Args: never
        Returns: {
          adults: number
          balance_cents: number
          booking_id: string
          channel_name: string
          check_in: string
          check_out: string
          children: number
          guest_name: string
          nights: number
          nights_left: number
          nights_stayed: number
          reference: string
          room_number: string
          room_type_name: string
        }[]
      }
      inventory_grid: {
        Args: { p_days?: number; p_from: string; p_rate_plan_id: string }
        Returns: {
          allotment: number
          close_out: boolean
          closed_to_arrival: boolean
          closed_to_departure: boolean
          max_stay: number
          min_stay_arrival: number
          min_stay_through: number
          out_of_order: number
          physical_rooms: number
          rate_cents: number
          room_type_code: string
          room_type_id: string
          room_type_name: string
          sellable: number
          sold: number
          stay_date: string
          stop_sell: boolean
        }[]
      }
      inventory_guard: {
        Args: { p_from: string; p_rate_plan_id: string; p_to: string }
        Returns: string
      }
      inventory_rates_grid: {
        Args: { p_days?: number; p_from: string }
        Returns: {
          date: string
          rate_cents: number
          rate_plan_code: string
          rate_plan_id: string
          rate_plan_is_default: boolean
          rate_plan_name: string
          rate_plan_sort: number
          room_type_code: string
          room_type_id: string
          room_type_name: string
          room_type_sort: number
        }[]
      }
      inventory_target_dates: {
        Args: { p_days_of_week: number[]; p_from: string; p_to: string }
        Returns: string[]
      }
      is_front_office_staff: { Args: never; Returns: boolean }
      is_revenue_staff: { Args: never; Returns: boolean }
      manager_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          adr_cents: number
          arrivals: number
          business_date: string
          departures: number
          occupancy_pct: number
          other_revenue_cents: number
          payments_cents: number
          revpar_cents: number
          room_revenue_cents: number
          rooms_sold: number
          sellable_rooms: number
          total_revenue_cents: number
        }[]
      }
      mark_activity_seen: { Args: never; Returns: string }
      meal_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          adult_covers: number
          child_covers: number
          meal: Database["public"]["Enums"]["meal_type"]
          service_date: string
          total_covers: number
        }[]
      }
      meeting_room_booking_detail: {
        Args: { p_booking_id: string }
        Returns: {
          balance_cents: number
          booked_by: string
          booking_id: string
          charges_cents: number
          comments: string
          created_at: string
          customer_id: string
          customer_name: string
          days: number
          ends_on: string
          event_name: string
          folio_id: string
          folio_number: number
          guest_count: number
          meeting_room_id: string
          meeting_room_name: string
          payments_cents: number
          reference: string
          starts_on: string
          status: Database["public"]["Enums"]["meeting_room_booking_status"]
        }[]
      }
      meeting_room_calendar: {
        Args: { p_days?: number; p_from: string }
        Returns: {
          booking_id: string
          capacity: number
          customer_name: string
          ends_on: string
          event_name: string
          guest_count: number
          is_first_day: boolean
          meeting_room_id: string
          meeting_room_name: string
          reference: string
          starts_on: string
          status: Database["public"]["Enums"]["meeting_room_booking_status"]
          stay_date: string
        }[]
      }
      merge_customers: {
        Args: { p_keep_id: string; p_merge_ids: string[] }
        Returns: {
          bookings_moved: number
          customers_merged: number
          folios_moved: number
          meeting_rooms_moved: number
        }[]
      }
      next_booking_reference: { Args: never; Returns: string }
      next_meeting_room_reference: { Args: never; Returns: string }
      occupancy_forecast: {
        Args: { p_days?: number; p_from: string }
        Returns: {
          occupancy_pct: number
          series_date: string
        }[]
      }
      occupancy_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          adr_cents: number
          occupancy_pct: number
          revpar_cents: number
          room_revenue_cents: number
          rooms_sold: number
          sellable_rooms: number
          stay_date: string
        }[]
      }
      occupancy_report_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          adr_cents: number
          nights: number
          occupancy_pct: number
          revpar_cents: number
          room_nights_available: number
          room_revenue_cents: number
          rooms_sold: number
        }[]
      }
      open_business_date: { Args: { p_property_id: string }; Returns: string }
      open_cashier_shift: {
        Args: { p_opening_balance_cents: number; p_opening_notes?: string }
        Returns: string
      }
      payments_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          affects_drawer: boolean
          amount_cents: number
          booking_id: string
          business_date: string
          external_reference: string
          guest_name: string
          is_reversal: boolean
          method_kind: Database["public"]["Enums"]["payment_method_kind"]
          method_name: string
          paid_at: string
          payment_id: string
          received_by: string
          reference: string
        }[]
      }
      payments_report_by_method: {
        Args: { p_from: string; p_to: string }
        Returns: {
          affects_drawer: boolean
          method_kind: Database["public"]["Enums"]["payment_method_kind"]
          method_name: string
          net_cents: number
          payment_count: number
          reversal_count: number
        }[]
      }
      post_charge: {
        Args: {
          p_business_date?: string
          p_description: string
          p_folio_id: string
          p_item_type: Database["public"]["Enums"]["folio_item_type"]
          p_quantity?: number
          p_tax_amount_cents?: number
          p_tax_rate_id?: string
          p_unit_amount_cents: number
        }
        Returns: string
      }
      post_discount: {
        Args: {
          p_amount_cents: number
          p_description: string
          p_folio_item_id: string
        }
        Returns: string
      }
      post_room_charge: {
        Args: {
          p_booking_room_night_id: string
          p_business_date?: string
          p_folio_id: string
        }
        Returns: string
      }
      promotion_night_discounts: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_promotion_id: string
          p_rate_plan_id: string
          p_room_type_id: string
        }
        Returns: {
          discount_cents: number
          rate_cents: number
          stay_date: string
        }[]
      }
      promotions_list: {
        Args: never
        Returns: {
          amount_off_cents: number
          arrival_days_of_week: number[]
          bookings_taken: number
          code: string
          description: string
          discount_given_cents: number
          free_nights: number
          is_active: boolean
          kind: Database["public"]["Enums"]["promotion_kind"]
          max_advance_days: number
          max_nights: number
          min_advance_days: number
          min_nights: number
          name: string
          paid_nights: number
          percent_bps: number
          priority: number
          promotion_id: string
          rate_plan_names: string
          room_type_names: string
          sell_from: string
          sell_to: string
          stay_from: string
          stay_to: string
        }[]
      }
      public_property: {
        Args: { p_property_id: string }
        Returns: {
          check_in_time: string
          check_out_time: string
          currency: string
          name: string
          property_id: string
          timezone: string
        }[]
      }
      public_rate_plans: {
        Args: { p_property_id: string }
        Returns: {
          cancellation_description: string
          cancellation_free_days: number
          cancellation_kind: Database["public"]["Enums"]["cancellation_policy_kind"]
          cancellation_name: string
          code: string
          description: string
          name: string
          rate_plan_id: string
        }[]
      }
      public_room_types: {
        Args: {
          p_from: string
          p_property_id: string
          p_rate_plan_id: string
          p_to: string
        }
        Returns: {
          available: number
          base_occupancy: number
          code: string
          max_occupancy: number
          name: string
          nights: number
          room_type_id: string
          total_cents: number
          unavailable_reason: string
        }[]
      }
      rate_plan_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          adr_cents: number
          bookings: number
          discount_cents: number
          gross_cents: number
          is_public: boolean
          net_cents: number
          plan_name: string
          rate_plan_id: string
          room_nights: number
        }[]
      }
      record_cash_movement: {
        Args: {
          p_amount_cents: number
          p_direction?: Database["public"]["Enums"]["cash_movement_direction"]
          p_movement_type: Database["public"]["Enums"]["cash_movement_type"]
          p_reason: string
          p_reference?: string
          p_shift_id: string
        }
        Returns: string
      }
      record_paid_out: {
        Args: {
          p_amount_cents: number
          p_category: Database["public"]["Enums"]["paid_out_category"]
          p_payee?: string
          p_reason: string
          p_recharge_booking_id?: string
          p_shift_id: string
        }
        Returns: string
      }
      record_payment: {
        Args: {
          p_amount_cents: number
          p_authorization_reference?: string
          p_business_date?: string
          p_external_reference?: string
          p_folio_id: string
          p_payment_method_id: string
          p_shift_id?: string
        }
        Returns: string
      }
      require_financial_staff: { Args: never; Returns: undefined }
      require_guest_identity_reports: { Args: never; Returns: undefined }
      require_money_reports: { Args: never; Returns: undefined }
      reservations_report: {
        Args: { p_from: string; p_to: string }
        Returns: {
          adults: number
          arrival_date: string
          booking_count: number
          children: number
          pending_count: number
          room_count: number
          room_nights: number
          value_cents: number
        }[]
      }
      restore_booking: {
        Args: { p_allow_overbook?: boolean; p_booking_id: string }
        Returns: undefined
      }
      revenue_series: {
        Args: { p_days?: number; p_from: string }
        Returns: {
          revenue_cents: number
          series_date: string
        }[]
      }
      reverse_charge: {
        Args: { p_description?: string; p_folio_item_id: string }
        Returns: string
      }
      reverse_payment: {
        Args: { p_external_reference?: string; p_payment_id: string }
        Returns: string
      }
      room_status_by_type: {
        Args: never
        Returns: {
          occupied: number
          out_of_order: number
          room_type_id: string
          total_rooms: number
          vacant_clean: number
          vacant_dirty: number
        }[]
      }
      rooms_for_settings: {
        Args: { p_limit?: number; p_offset?: number; p_q?: string }
        Returns: {
          floor: number
          has_bookings: boolean
          number: string
          photo_path: string
          room_id: string
          room_type_id: string
          room_type_name: string
          status: Database["public"]["Enums"]["room_status"]
          total_count: number
        }[]
      }
      rooms_page: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_q?: string
          p_state?: string
        }
        Returns: {
          floor: number
          guest_name: string
          nights_left: number
          number: string
          room_id: string
          room_type_name: string
          state: string
          total_count: number
        }[]
      }
      save_calendar_note: {
        Args: { p_body: string; p_id?: string; p_note_date: string }
        Returns: string
      }
      save_cancellation_policy: {
        Args: {
          p_description?: string
          p_free_cancellation_days?: number
          p_id?: string
          p_is_active?: boolean
          p_kind: Database["public"]["Enums"]["cancellation_policy_kind"]
          p_name: string
          p_sort_order?: number
        }
        Returns: string
      }
      save_channel: {
        Args: {
          p_code: string
          p_commission_bps?: number
          p_id?: string
          p_is_active?: boolean
          p_kind: Database["public"]["Enums"]["channel_kind"]
          p_name: string
        }
        Returns: string
      }
      save_customer: {
        Args: {
          p_company_name?: string
          p_country?: string
          p_date_of_birth?: string
          p_email?: string
          p_exclude_from_email?: boolean
          p_first_name?: string
          p_id?: string
          p_kind: Database["public"]["Enums"]["customer_kind"]
          p_last_name?: string
          p_national_id_number?: string
          p_nationality?: string
          p_passport_expiry?: string
          p_passport_number?: string
          p_phone?: string
        }
        Returns: string
      }
      save_meeting_room: {
        Args: {
          p_capacity?: number
          p_description?: string
          p_id?: string
          p_is_active?: boolean
          p_name: string
          p_sort_order?: number
        }
        Returns: string
      }
      save_own_profile: { Args: { p_full_name: string }; Returns: string }
      save_payment_method: {
        Args: {
          p_id?: string
          p_is_active?: boolean
          p_kind: Database["public"]["Enums"]["payment_method_kind"]
          p_name: string
        }
        Returns: string
      }
      save_promotion: {
        Args: {
          p_amount_off_cents?: number
          p_arrival_days_of_week?: number[]
          p_code?: string
          p_description?: string
          p_free_nights?: number
          p_id?: string
          p_is_active?: boolean
          p_kind: Database["public"]["Enums"]["promotion_kind"]
          p_max_advance_days?: number
          p_max_nights?: number
          p_min_advance_days?: number
          p_min_nights?: number
          p_name: string
          p_paid_nights?: number
          p_percent_bps?: number
          p_priority?: number
          p_rate_plan_ids?: string[]
          p_room_type_ids?: string[]
          p_sell_from?: string
          p_sell_to?: string
          p_stay_from?: string
          p_stay_to?: string
        }
        Returns: string
      }
      save_property: {
        Args: {
          p_check_in_time?: string
          p_check_out_time?: string
          p_currency: string
          p_name: string
          p_timezone: string
        }
        Returns: undefined
      }
      save_rate_plan: {
        Args: {
          p_code: string
          p_description?: string
          p_id?: string
          p_is_active?: boolean
          p_is_default?: boolean
          p_name: string
        }
        Returns: string
      }
      save_room: {
        Args: {
          p_floor?: number
          p_id?: string
          p_number: string
          p_room_type_id: string
        }
        Returns: string
      }
      save_room_type: {
        Args: {
          p_base_occupancy?: number
          p_code: string
          p_id?: string
          p_max_occupancy?: number
          p_name: string
          p_sort_order?: number
        }
        Returns: string
      }
      save_season: {
        Args: {
          p_ends_on: string
          p_id?: string
          p_name: string
          p_starts_on: string
        }
        Returns: string
      }
      save_staff_user: {
        Args: {
          p_full_name: string
          p_id: string
          p_is_active?: boolean
          p_role: Database["public"]["Enums"]["staff_role"]
        }
        Returns: string
      }
      save_tax_rate: {
        Args: {
          p_id?: string
          p_inclusion: Database["public"]["Enums"]["tax_inclusion"]
          p_is_active?: boolean
          p_name: string
          p_rate_bps: number
        }
        Returns: string
      }
      set_allotment: {
        Args: {
          p_allotment?: number
          p_days_of_week?: number[]
          p_from: string
          p_room_type_ids: string[]
          p_to: string
        }
        Returns: number
      }
      set_booking_room_rate: {
        Args: {
          p_booking_room_id: string
          p_from?: string
          p_rate_cents: number
          p_tax_rate_id?: string
          p_to?: string
        }
        Returns: number
      }
      set_close_out: {
        Args: {
          p_close_out?: boolean
          p_days_of_week?: number[]
          p_from: string
          p_room_type_ids: string[]
          p_to: string
        }
        Returns: number
      }
      set_closed_to_arrival: {
        Args: {
          p_closed_to_arrival?: boolean
          p_days_of_week?: number[]
          p_from: string
          p_rate_plan_id: string
          p_room_type_ids: string[]
          p_to: string
        }
        Returns: number
      }
      set_closed_to_departure: {
        Args: {
          p_closed_to_departure?: boolean
          p_days_of_week?: number[]
          p_from: string
          p_rate_plan_id: string
          p_room_type_ids: string[]
          p_to: string
        }
        Returns: number
      }
      set_customer_exclude_from_email: {
        Args: { p_id: string; p_value: boolean }
        Returns: undefined
      }
      set_max_stay: {
        Args: {
          p_days_of_week?: number[]
          p_from: string
          p_max_stay?: number
          p_rate_plan_id: string
          p_room_type_ids: string[]
          p_to: string
        }
        Returns: number
      }
      set_min_stay_arrival: {
        Args: {
          p_days_of_week?: number[]
          p_from: string
          p_min_stay_arrival?: number
          p_rate_plan_id: string
          p_room_type_ids: string[]
          p_to: string
        }
        Returns: number
      }
      set_min_stay_through: {
        Args: {
          p_days_of_week?: number[]
          p_from: string
          p_min_stay_through?: number
          p_rate_plan_id: string
          p_room_type_ids: string[]
          p_to: string
        }
        Returns: number
      }
      set_rate_plan_cancellation_policy: {
        Args: { p_cancellation_policy_id?: string; p_rate_plan_id: string }
        Returns: undefined
      }
      set_rate_plan_meal_value: {
        Args: {
          p_meal: Database["public"]["Enums"]["meal_type"]
          p_rate_plan_id: string
          p_value_cents?: number
        }
        Returns: number
      }
      set_rate_plan_meals: {
        Args: {
          p_meals: Database["public"]["Enums"]["meal_type"][]
          p_rate_plan_id: string
        }
        Returns: number
      }
      set_rate_plan_public: {
        Args: { p_is_public: boolean; p_rate_plan_id: string }
        Returns: boolean
      }
      set_rates: {
        Args: {
          p_days_of_week?: number[]
          p_from: string
          p_rate_cents?: number
          p_rate_plan_id: string
          p_room_type_ids: string[]
          p_to: string
        }
        Returns: number
      }
      set_room_photo: {
        Args: { p_photo_path?: string; p_room_id: string }
        Returns: undefined
      }
      set_room_status: {
        Args: {
          p_room_id: string
          p_status: Database["public"]["Enums"]["room_status"]
        }
        Returns: undefined
      }
      set_stop_sell: {
        Args: {
          p_days_of_week?: number[]
          p_from: string
          p_rate_plan_id: string
          p_room_type_ids: string[]
          p_stop_sell?: boolean
          p_to: string
        }
        Returns: number
      }
      set_waitlist_status: {
        Args: {
          p_booking_id?: string
          p_id: string
          p_status: Database["public"]["Enums"]["waitlist_status"]
        }
        Returns: undefined
      }
      stay_rule_violation: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_rate_plan_id: string
          p_room_type_id: string
        }
        Returns: string
      }
      stay_rule_violation_for: {
        Args: {
          p_check_in: string
          p_check_out: string
          p_property_id: string
          p_rate_plan_id: string
          p_room_type_id: string
        }
        Returns: string
      }
      unassign_room: { Args: { p_booking_room_id: string }; Returns: undefined }
      update_booking: {
        Args: {
          p_adults?: number
          p_allow_overbook?: boolean
          p_arrival_time?: string
          p_booking_id: string
          p_channel_id?: string
          p_check_in?: string
          p_check_out?: string
          p_children?: number
          p_departure_time?: string
          p_external_reference?: string
          p_guest_notes?: string
          p_internal_notes?: string
          p_settlement?: Database["public"]["Enums"]["booking_settlement"]
        }
        Returns: undefined
      }
    }
    Enums: {
      booking_settlement: "at_property" | "prepaid_to_channel" | "virtual_card"
      booking_status:
        | "pending"
        | "confirmed"
        | "checked_in"
        | "checked_out"
        | "canceled"
        | "no_show"
      business_date_status: "open" | "closed"
      cancellation_policy_kind: "flexible" | "non_refundable"
      cash_movement_direction: "in" | "out"
      cash_movement_type:
        | "paid_out"
        | "cash_drop"
        | "cash_added"
        | "cash_adjustment"
        | "correction"
      cashier_shift_status: "open" | "closing" | "closed"
      channel_kind: "direct" | "ota" | "wholesaler" | "gds" | "offline"
      customer_kind: "personal" | "company"
      folio_item_type:
        | "room_charge"
        | "tax"
        | "food_beverage"
        | "laundry"
        | "minibar"
        | "transport"
        | "miscellaneous"
        | "discount"
        | "adjustment"
        | "reversal"
      folio_kind: "guest" | "company"
      folio_status: "open" | "closed" | "cancelled"
      meal_type: "breakfast" | "lunch" | "dinner"
      meeting_room_booking_status: "pending" | "confirmed" | "canceled"
      paid_out_category:
        | "taxi"
        | "guest_purchase"
        | "medical"
        | "supplies"
        | "staff_advance"
        | "other"
      payment_method_kind:
        | "cash"
        | "card"
        | "bank_transfer"
        | "upi"
        | "ota_prepaid"
        | "virtual_card"
        | "complimentary"
        | "other"
      payment_status: "posted"
      promotion_kind: "percent_off" | "amount_off" | "free_nights"
      room_status: "vacant_clean" | "vacant_dirty" | "occupied" | "ooo"
      staff_role:
        | "admin"
        | "manager"
        | "front_desk"
        | "cashier"
        | "housekeeping"
      tax_inclusion: "inclusive" | "exclusive"
      waitlist_status:
        | "waiting"
        | "offered"
        | "converted"
        | "expired"
        | "canceled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      booking_settlement: ["at_property", "prepaid_to_channel", "virtual_card"],
      booking_status: [
        "pending",
        "confirmed",
        "checked_in",
        "checked_out",
        "canceled",
        "no_show",
      ],
      business_date_status: ["open", "closed"],
      cancellation_policy_kind: ["flexible", "non_refundable"],
      cash_movement_direction: ["in", "out"],
      cash_movement_type: [
        "paid_out",
        "cash_drop",
        "cash_added",
        "cash_adjustment",
        "correction",
      ],
      cashier_shift_status: ["open", "closing", "closed"],
      channel_kind: ["direct", "ota", "wholesaler", "gds", "offline"],
      customer_kind: ["personal", "company"],
      folio_item_type: [
        "room_charge",
        "tax",
        "food_beverage",
        "laundry",
        "minibar",
        "transport",
        "miscellaneous",
        "discount",
        "adjustment",
        "reversal",
      ],
      folio_kind: ["guest", "company"],
      folio_status: ["open", "closed", "cancelled"],
      meal_type: ["breakfast", "lunch", "dinner"],
      meeting_room_booking_status: ["pending", "confirmed", "canceled"],
      paid_out_category: [
        "taxi",
        "guest_purchase",
        "medical",
        "supplies",
        "staff_advance",
        "other",
      ],
      payment_method_kind: [
        "cash",
        "card",
        "bank_transfer",
        "upi",
        "ota_prepaid",
        "virtual_card",
        "complimentary",
        "other",
      ],
      payment_status: ["posted"],
      promotion_kind: ["percent_off", "amount_off", "free_nights"],
      room_status: ["vacant_clean", "vacant_dirty", "occupied", "ooo"],
      staff_role: ["admin", "manager", "front_desk", "cashier", "housekeeping"],
      tax_inclusion: ["inclusive", "exclusive"],
      waitlist_status: [
        "waiting",
        "offered",
        "converted",
        "expired",
        "canceled",
      ],
    },
  },
} as const
