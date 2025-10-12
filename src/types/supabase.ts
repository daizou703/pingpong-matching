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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      availability_slots: {
        Row: {
          area_code: string | null
          created_at: string | null
          end_at: string
          id: number
          is_recurring: boolean | null
          recur_dow: number | null
          recur_end: string | null
          recur_start: string | null
          start_at: string
          user_id: string | null
          venue_hint: string | null
        }
        Insert: {
          area_code?: string | null
          created_at?: string | null
          end_at: string
          id?: number
          is_recurring?: boolean | null
          recur_dow?: number | null
          recur_end?: string | null
          recur_start?: string | null
          start_at: string
          user_id?: string | null
          venue_hint?: string | null
        }
        Update: {
          area_code?: string | null
          created_at?: string | null
          end_at?: string
          id?: number
          is_recurring?: boolean | null
          recur_dow?: number | null
          recur_end?: string | null
          recur_start?: string | null
          start_at?: string
          user_id?: string | null
          venue_hint?: string | null
        }
        Relationships: []
      }
      matches: {
        Row: {
          created_at: string | null
          end_at: string | null
          id: number
          start_at: string | null
          status: string | null
          user_a: string | null
          user_b: string | null
          venue_text: string | null
        }
        Insert: {
          created_at?: string | null
          end_at?: string | null
          id?: number
          start_at?: string | null
          status?: string | null
          user_a?: string | null
          user_b?: string | null
          venue_text?: string | null
        }
        Update: {
          created_at?: string | null
          end_at?: string | null
          id?: number
          start_at?: string | null
          status?: string | null
          user_a?: string | null
          user_b?: string | null
          venue_text?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          body: string
          id: number
          match_id: number | null
          sender_id: string | null
          sent_at: string | null
        }
        Insert: {
          body: string
          id?: number
          match_id?: number | null
          sender_id?: string | null
          sent_at?: string | null
        }
        Update: {
          body?: string
          id?: number
          match_id?: number | null
          sender_id?: string | null
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          area_code: string | null
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          gender: string | null
          hand: string | null
          level: number | null
          nickname: string | null
          play_style: string | null
          purpose: string[] | null
          user_id: string
          years: number | null
        }
        Insert: {
          area_code?: string | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          gender?: string | null
          hand?: string | null
          level?: number | null
          nickname?: string | null
          play_style?: string | null
          purpose?: string[] | null
          user_id: string
          years?: number | null
        }
        Update: {
          area_code?: string | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          gender?: string | null
          hand?: string | null
          level?: number | null
          nickname?: string | null
          play_style?: string | null
          purpose?: string[] | null
          user_id?: string
          years?: number | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          comment: string | null
          created_at: string | null
          id: number
          match_id: number | null
          ratee_id: string | null
          rater_id: string | null
          rating: number | null
          tags: Json | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          id?: number
          match_id?: number | null
          ratee_id?: string | null
          rater_id?: string | null
          rating?: number | null
          tags?: Json | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          id?: number
          match_id?: number | null
          ratee_id?: string | null
          rater_id?: string | null
          rating?: number | null
          tags?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
