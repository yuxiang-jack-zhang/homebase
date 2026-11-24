
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "agent_calls": {
                  Row: {
                    "created_at": string,"error": string | null,"id": string,"input_tokens": number,"latency_ms": number,"model": string,"ok": boolean,"output_tokens": number,"run_id": string,"step": string,"stop_reason": string | null,"target_user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"error"?: string | null,"id"?: string,"input_tokens": number,"latency_ms": number,"model": string,"ok": boolean,"output_tokens": number,"run_id": string,"step": string,"stop_reason"?: string | null,"target_user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"error"?: string | null,"id"?: string,"input_tokens"?: number,"latency_ms"?: number,"model"?: string,"ok"?: boolean,"output_tokens"?: number,"run_id"?: string,"step"?: string,"stop_reason"?: string | null,"target_user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_calls_run_id_fkey"
      columns: ["run_id"]
isOneToOne: false
      referencedRelation: "agent_runs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_calls_target_user_id_fkey"
      columns: ["target_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_runs": {
                  Row: {
                    "core_version": string,"created_at": string,"id": string,"latency_ms": number,"ok": boolean,"question_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "core_version": string,"created_at"?: string,"id"?: string,"latency_ms": number,"ok": boolean,"question_id"?: string | null
                  }
                  Update: {
                    "core_version"?: string,"created_at"?: string,"id"?: string,"latency_ms"?: number,"ok"?: boolean,"question_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_runs_question_id_fkey"
      columns: ["question_id"]
isOneToOne: false
      referencedRelation: "questions"
      referencedColumns: ["id"]
    }
                  ]
                },"ask_admissions": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ask_admissions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"away_blocks": {
                  Row: {
                    "created_at": string,"days_of_week": (number)[],"end_local": string,"household_id": string,"id": string,"label": string | null,"start_local": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"days_of_week": (number)[],"end_local": string,"household_id": string,"id"?: string,"label"?: string | null,"start_local": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"days_of_week"?: (number)[],"end_local"?: string,"household_id"?: string,"id"?: string,"label"?: string | null,"start_local"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "away_blocks_household_id_user_id_fkey"
      columns: ["household_id","user_id"]
isOneToOne: false
      referencedRelation: "household_members"
      referencedColumns: ["household_id","user_id"]
    }
                  ]
                },"household_members": {
                  Row: {
                    "answer_mode": Database["public"]['Enums']["answer_mode"],"home_confirmed_at": string | null,"household_id": string,"joined_at": string | null,"role": Database["public"]['Enums']["member_role"],"status": Database["public"]['Enums']["member_status"],"user_id": string,"visibility": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "answer_mode"?: Database["public"]['Enums']["answer_mode"],"home_confirmed_at"?: string | null,"household_id": string,"joined_at"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["member_status"],"user_id": string,"visibility"?: boolean
                  }
                  Update: {
                    "answer_mode"?: Database["public"]['Enums']["answer_mode"],"home_confirmed_at"?: string | null,"household_id"?: string,"joined_at"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["member_status"],"user_id"?: string,"visibility"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "household_members_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "household_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"households": {
                  Row: {
                    "created_at": string,"created_by": string | null,"home_lat": number,"home_lng": number,"home_radius_m": number,"id": string,"invite_code": string,"name": string,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"home_lat": number,"home_lng": number,"home_radius_m"?: number,"id"?: string,"invite_code": string,"name": string,"timezone": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"home_lat"?: number,"home_lng"?: number,"home_radius_m"?: number,"id"?: string,"invite_code"?: string,"name"?: string,"timezone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "households_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"join_attempts": {
                  Row: {
                    "at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"user_id": string
                  }
                  Update: {
                    "at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "join_attempts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"predictions": {
                  Row: {
                    "about_time": string | null,"confidence": Database["public"]['Enums']["confidence_level"],"created_at": string,"id": string,"kind": Database["public"]['Enums']["question_kind"],"outcome": Database["public"]['Enums']["outcome_kind"] | null,"predicted_state": string | null,"predicted_time": string | null,"question_target_id": string,"scored_at": string | null,"source": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "about_time"?: string | null,"confidence": Database["public"]['Enums']["confidence_level"],"created_at"?: string,"id"?: string,"kind": Database["public"]['Enums']["question_kind"],"outcome"?: Database["public"]['Enums']["outcome_kind"] | null,"predicted_state"?: string | null,"predicted_time"?: string | null,"question_target_id": string,"scored_at"?: string | null,"source": string,"user_id": string
                  }
                  Update: {
                    "about_time"?: string | null,"confidence"?: Database["public"]['Enums']["confidence_level"],"created_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["question_kind"],"outcome"?: Database["public"]['Enums']["outcome_kind"] | null,"predicted_state"?: string | null,"predicted_time"?: string | null,"question_target_id"?: string,"scored_at"?: string | null,"source"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "predictions_question_target_id_fkey"
      columns: ["question_target_id"]
isOneToOne: true
      referencedRelation: "question_targets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "predictions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"presence_events": {
                  Row: {
                    "at": string,"household_id": string,"id": number,"kind": Database["public"]['Enums']["presence_kind"],"user_id": string,"visible": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"household_id": string,"id"?: never,"kind": Database["public"]['Enums']["presence_kind"],"user_id": string,"visible"?: boolean
                  }
                  Update: {
                    "at"?: string,"household_id"?: string,"id"?: never,"kind"?: Database["public"]['Enums']["presence_kind"],"user_id"?: string,"visible"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "presence_events_household_id_user_id_fkey"
      columns: ["household_id","user_id"]
isOneToOne: false
      referencedRelation: "household_members"
      referencedColumns: ["household_id","user_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"id": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"question_targets": {
                  Row: {
                    "created_at": string,"id": string,"question_id": string,"status": Database["public"]['Enums']["target_status"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"question_id": string,"status": Database["public"]['Enums']["target_status"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"question_id"?: string,"status"?: Database["public"]['Enums']["target_status"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "question_targets_question_id_fkey"
      columns: ["question_id"]
isOneToOne: false
      referencedRelation: "questions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "question_targets_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"questions": {
                  Row: {
                    "about_time": string | null,"asker_id": string,"created_at": string,"household_id": string,"id": string,"kind": Database["public"]['Enums']["question_kind"] | null,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "about_time"?: string | null,"asker_id": string,"created_at"?: string,"household_id": string,"id"?: string,"kind"?: Database["public"]['Enums']["question_kind"] | null,"text": string
                  }
                  Update: {
                    "about_time"?: string | null,"asker_id"?: string,"created_at"?: string,"household_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["question_kind"] | null,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "questions_asker_id_fkey"
      columns: ["asker_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "questions_household_id_fkey"
      columns: ["household_id"]
isOneToOne: false
      referencedRelation: "households"
      referencedColumns: ["id"]
    }
                  ]
                },"responses": {
                  Row: {
                    "created_at": string,"draft_claim": Json | null,"feedback": Database["public"]['Enums']["feedback_kind"] | null,"id": string,"question_target_id": string,"source": Database["public"]['Enums']["response_source"],"text": string,"visibility": Database["public"]['Enums']["response_visibility"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"draft_claim"?: Json | null,"feedback"?: Database["public"]['Enums']["feedback_kind"] | null,"id"?: string,"question_target_id": string,"source": Database["public"]['Enums']["response_source"],"text": string,"visibility": Database["public"]['Enums']["response_visibility"]
                  }
                  Update: {
                    "created_at"?: string,"draft_claim"?: Json | null,"feedback"?: Database["public"]['Enums']["feedback_kind"] | null,"id"?: string,"question_target_id"?: string,"source"?: Database["public"]['Enums']["response_source"],"text"?: string,"visibility"?: Database["public"]['Enums']["response_visibility"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "responses_question_target_id_fkey"
      columns: ["question_target_id"]
isOneToOne: false
      referencedRelation: "question_targets"
      referencedColumns: ["id"]
    }
                  ]
                },"target_guesses": {
                  Row: {
                    "guess": string,"question_target_id": string,"visible_after": string
                  }
                  ComputedFields: never
                  Insert: {
                    "guess": string,"question_target_id": string,"visible_after"?: string
                  }
                  Update: {
                    "guess"?: string,"question_target_id"?: string,"visible_after"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "target_guesses_question_target_id_fkey"
      columns: ["question_target_id"]
isOneToOne: true
      referencedRelation: "question_targets"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "current_presence": {
                  Row: {
                    "at": string,"household_id": string,"kind": Database["public"]['Enums']["presence_kind"],"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "presence_events_household_id_user_id_fkey"
      columns: ["household_id","user_id"]
isOneToOne: false
      referencedRelation: "household_members"
      referencedColumns: ["household_id","user_id"]
    }
                  ]
                }
          }
          Functions: {
            "admit_ask":
{ Args: { "p_global_per_day": number,"p_per_day": number,"p_per_hour": number,"p_user_id": string }; Returns: string
                           },
"approve_member":
{ Args: { "p_household_id": string,"p_user_id": string }; Returns: undefined
                           },
"asked_question":
{ Args: { "p_question_id": string }; Returns: boolean
                           },
"can_see_presence":
{ Args: { "p_at": string,"p_household_id": string,"p_user_id": string }; Returns: boolean
                           },
"confirm_home":
{ Args: { "p_household_id": string }; Returns: undefined
                           },
"create_household":
{ Args: { "p_lat": number,"p_lng": number,"p_name": string,"p_radius_m"?: number,"p_timezone": string }; Returns: {
              "created_at": string,
"created_by": string | null,
"home_lat": number,
"home_lng": number,
"home_radius_m": number,
"id": string,
"invite_code": string,
"name": string,
"timezone": string
            }
                          SetofOptions: {
        from: "*"
        to: "households"
        isOneToOne: true
        isSetofReturn: false
      } },
"decline_member":
{ Args: { "p_household_id": string,"p_user_id": string }; Returns: undefined
                           },
"depart_household":
{ Args: { "p_household_id": string,"p_user_id": string }; Returns: undefined
                           },
"household_accuracy":
{ Args: { "p_household_id": string }; Returns: {
              "correct": number,"incorrect": number,"kind": Database["public"]['Enums']["question_kind"],"unscored": number
            }[]
                           },
"is_member":
{ Args: { "p_household_id": string }; Returns: boolean
                           },
"is_owner":
{ Args: { "p_household_id": string }; Returns: boolean
                           },
"join_household":
{ Args: { "p_invite_code": string }; Returns: Json
                           },
"leave_household":
{ Args: { "p_household_id": string }; Returns: undefined
                           },
"my_pending_households":
{ Args: Record<PropertyKey, never>; Returns: {
              "id": string,"name": string,"owner_name": string
            }[]
                           },
"new_invite_code":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"remove_member":
{ Args: { "p_household_id": string,"p_user_id": string }; Returns: undefined
                           },
"rotate_invite_code":
{ Args: { "p_household_id": string }; Returns: string
                           },
"shares_household":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"targeted_by_question":
{ Args: { "p_question_id": string }; Returns: boolean
                           },
"update_home":
{ Args: { "p_household_id": string,"p_lat": number,"p_lng": number,"p_radius_m": number }; Returns: undefined
                           },
"update_my_settings":
{ Args: { "p_answer_mode": Database["public"]['Enums']["answer_mode"],"p_household_id": string,"p_visibility": boolean }; Returns: undefined
                           }
          }
          Enums: {
            "answer_mode": "ask_me"|"auto_when_confident"|"always_auto","confidence_level": "high"|"medium"|"low","feedback_kind": "approved"|"edited"|"rejected","member_role": "owner"|"member","member_status": "pending"|"active","outcome_kind": "correct"|"incorrect"|"unscored","presence_kind": "enter"|"exit","question_kind": "now"|"at_time"|"until_when"|"unclear","response_source": "agent"|"human","response_visibility": "draft"|"sent","target_status": "answered"|"awaiting_reply"|"replied"|"unknown"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "answer_mode": ["ask_me", "auto_when_confident", "always_auto"],"confidence_level": ["high", "medium", "low"],"feedback_kind": ["approved", "edited", "rejected"],"member_role": ["owner", "member"],"member_status": ["pending", "active"],"outcome_kind": ["correct", "incorrect", "unscored"],"presence_kind": ["enter", "exit"],"question_kind": ["now", "at_time", "until_when", "unclear"],"response_source": ["agent", "human"],"response_visibility": ["draft", "sent"],"target_status": ["answered", "awaiting_reply", "replied", "unknown"]
          }
        }
} as const
