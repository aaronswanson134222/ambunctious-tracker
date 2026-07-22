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
      price_history: {
        Row: {
          checked_at: string
          currency: string | null
          id: number
          price: number
          price_gbp: number | null
          product_id: string
        }
        Insert: {
          checked_at?: string
          currency?: string | null
          id?: number
          price: number
          price_gbp?: number | null
          product_id: string
        }
        Update: {
          checked_at?: string
          currency?: string | null
          id?: number
          price?: number
          price_gbp?: number | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "tracked_products"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_products: {
        Row: {
          created_at: string
          currency: string | null
          id: string
          label: string
          last_checked_at: string | null
          last_error: string | null
          last_price: number | null
          last_price_gbp: number | null
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          id?: string
          label: string
          last_checked_at?: string | null
          last_error?: string | null
          last_price?: number | null
          last_price_gbp?: number | null
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          id?: string
          label?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_price?: number | null
          last_price_gbp?: number | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      tracked_roblox_entities: {
        Row: {
          baselined_scan_types: string[]
          created_at: string
          entity_id: number
          entity_type: string
          id: string
          known_item_keys: Json
          label: string
          last_checked_at: string | null
          last_error: string | null
          lookback_days: number
          scan_types: string[]
          updated_at: string
        }
        Insert: {
          baselined_scan_types?: string[]
          created_at?: string
          entity_id: number
          entity_type: string
          id?: string
          known_item_keys?: Json
          label: string
          last_checked_at?: string | null
          last_error?: string | null
          lookback_days?: number
          scan_types?: string[]
          updated_at?: string
        }
        Update: {
          baselined_scan_types?: string[]
          created_at?: string
          entity_id?: number
          entity_type?: string
          id?: string
          known_item_keys?: Json
          label?: string
          last_checked_at?: string | null
          last_error?: string | null
          lookback_days?: number
          scan_types?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      tracked_roblox_experiences: {
        Row: {
          created_at: string
          id: string
          items: Json
          known_item_keys: string[]
          label: string
          last_checked_at: string | null
          last_error: string | null
          lookback_days: number
          place_id: number
          universe_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          items?: Json
          known_item_keys?: string[]
          label: string
          last_checked_at?: string | null
          last_error?: string | null
          lookback_days?: number
          place_id: number
          universe_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          known_item_keys?: string[]
          label?: string
          last_checked_at?: string | null
          last_error?: string | null
          lookback_days?: number
          place_id?: number
          universe_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      tracked_websites: {
        Row: {
          created_at: string
          id: string
          label: string
          last_checked_at: string | null
          last_error: string | null
          last_item_title: string | null
          last_item_url: string | null
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          last_checked_at?: string | null
          last_error?: string | null
          last_item_title?: string | null
          last_item_url?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_item_title?: string | null
          last_item_url?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      tracked_x_accounts: {
        Row: {
          created_at: string
          handle: string
          id: string
          last_checked_at: string | null
          last_error: string | null
          last_post_text: string | null
          last_post_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          handle: string
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_post_text?: string | null
          last_post_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          handle?: string
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_post_text?: string | null
          last_post_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tracker_api_releases: {
        Row: {
          changes: Json
          created_at: string
          notified_at: string
          title: string
          version: string
        }
        Insert: {
          changes?: Json
          created_at?: string
          notified_at?: string
          title: string
          version: string
        }
        Update: {
          changes?: Json
          created_at?: string
          notified_at?: string
          title?: string
          version?: string
        }
        Relationships: []
      }
      tracker_discord_status: {
        Row: {
          message_id: string | null
          singleton: boolean
          updated_at: string
        }
        Insert: {
          message_id?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          message_id?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      tracker_notification_events: {
        Row: {
          created_at: string
          fingerprint: string
          id: string
          sent_at: string | null
          source_id: string
          source_type: string
        }
        Insert: {
          created_at?: string
          fingerprint: string
          id?: string
          sent_at?: string | null
          source_id: string
          source_type: string
        }
        Update: {
          created_at?: string
          fingerprint?: string
          id?: string
          sent_at?: string | null
          source_id?: string
          source_type?: string
        }
        Relationships: []
      }
      tracker_pin_attempts: {
        Row: {
          failed_attempts: number
          id: boolean
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          failed_attempts?: number
          id?: boolean
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          failed_attempts?: number
          id?: boolean
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tracker_run_state: {
        Row: {
          last_started_at: string
          lock_until: string
          singleton: boolean
        }
        Insert: {
          last_started_at?: string
          lock_until?: string
          singleton?: boolean
        }
        Update: {
          last_started_at?: string
          lock_until?: string
          singleton?: boolean
        }
        Relationships: []
      }
      tracker_scan_runs: {
        Row: {
          created_at: string
          error_count: number
          id: number
          price_drops: number
          products_checked: number
          roblox_checked: number
          roblox_new_items: number
          website_updates: number
          websites_checked: number
          x_checked: number
          x_new_posts: number
        }
        Insert: {
          created_at?: string
          error_count?: number
          id?: never
          price_drops?: number
          products_checked?: number
          roblox_checked?: number
          roblox_new_items?: number
          website_updates?: number
          websites_checked?: number
          x_checked?: number
          x_new_posts?: number
        }
        Update: {
          created_at?: string
          error_count?: number
          id?: never
          price_drops?: number
          products_checked?: number
          roblox_checked?: number
          roblox_new_items?: number
          website_updates?: number
          websites_checked?: number
          x_checked?: number
          x_new_posts?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_tracker_run_lock: { Args: never; Returns: boolean }
      authenticate_tracker_pin: {
        Args: { candidate: string }
        Returns: {
          internal_password: string
          owner_email: string
        }[]
      }
      get_roblox_open_cloud_key: { Args: never; Returns: string }
      has_roblox_open_cloud_key: { Args: never; Returns: boolean }
      is_tracker_owner: { Args: never; Returns: boolean }
      release_tracker_run_lock: { Args: never; Returns: boolean }
      set_roblox_open_cloud_key: {
        Args: { candidate: string }
        Returns: boolean
      }
      tracker_is_owner: { Args: never; Returns: boolean }
      verify_tracker_cron_secret: {
        Args: { candidate: string }
        Returns: boolean
      }
      verify_tracker_owner_email: {
        Args: { candidate: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
