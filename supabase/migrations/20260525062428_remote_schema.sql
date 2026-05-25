


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE OR REPLACE FUNCTION "public"."assign_default_avatar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- 如果用户没有头像，分配一个随机默认头像
    IF NEW.avatar_url IS NULL OR NEW.avatar_url = '' THEN
        NEW.avatar_url := get_random_default_avatar();
        NEW.is_default_avatar := true;
    ELSE
        NEW.is_default_avatar := false;
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."assign_default_avatar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_user_record"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_sub RECORD;
    v_limits JSONB;
    v_can_record BOOLEAN;
    v_reason TEXT;
BEGIN
    -- Get subscription
    SELECT * INTO v_sub FROM public.subscriptions WHERE user_id = p_user_id;
    
    -- Define limits by plan
    v_limits := CASE v_sub.plan
        WHEN 'premium' THEN '{"daily_records": -1, "max_seconds": 120, "monthly_minutes": 30}'::JSONB
        WHEN 'pro' THEN '{"daily_records": -1, "max_seconds": 300, "monthly_minutes": 60}'::JSONB
        WHEN 'ultra' THEN '{"daily_records": -1, "max_seconds": 600, "monthly_minutes": 200}'::JSONB
        ELSE '{"daily_records": 3, "max_seconds": 30, "monthly_minutes": 3}'::JSONB
    END;
    
    -- Check limits
    v_can_record := TRUE;
    v_reason := NULL;
    
    -- Check daily limit (free plan only)
    IF v_sub.plan = 'free' OR v_sub.plan IS NULL THEN
        IF v_sub.last_record_date = CURRENT_DATE AND v_sub.records_today >= 3 THEN
            v_can_record := FALSE;
            v_reason := 'Daily recording limit reached';
        END IF;
    END IF;
    
    -- Check monthly minutes
    IF v_sub.minutes_used_this_month >= (v_limits->>'monthly_minutes')::NUMERIC THEN
        v_can_record := FALSE;
        v_reason := 'Monthly minutes limit reached';
    END IF;
    
    RETURN jsonb_build_object(
        'can_record', v_can_record,
        'reason', v_reason,
        'limits', v_limits,
        'used', jsonb_build_object(
            'records_today', COALESCE(v_sub.records_today, 0),
            'minutes_this_month', COALESCE(v_sub.minutes_used_this_month, 0)
        )
    );
END;
$$;


ALTER FUNCTION "public"."can_user_record"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_random_default_avatar"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    random_avatar TEXT;
BEGIN
    SELECT avatar_url INTO random_avatar
    FROM default_avatars
    WHERE is_active = true
    ORDER BY RANDOM()
    LIMIT 1;
    
    RETURN random_avatar;
END;
$$;


ALTER FUNCTION "public"."get_random_default_avatar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    INSERT INTO public.profiles (
      id, email, display_name,
      active_character_id, character_mode, wp, wp_last_updated,
      mode_changed_at, afk_study_seconds, afk_play_seconds,
      selected_character, onboarding_completed, has_completed_onboarding,
      is_guest, subscription_tier
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(COALESCE(NEW.email, 'user'), '@', 1)),
      'char-1', 'play', 0, NOW(),
      NOW(), 0, 0,
      'char-1', false, false,
      false, 'free'
    )
    ON CONFLICT (id) DO UPDATE SET
      email = COALESCE(NULLIF(NEW.email, ''), profiles.email),
      display_name = COALESCE(NULLIF(profiles.display_name, ''), EXCLUDED.display_name);
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
      RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_subscription"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, billing_cycle)
  VALUES (NEW.id, 'free', 'active', 'monthly')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'handle_new_user_subscription error: %', SQLERRM;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user_subscription"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_unread_feedback"("wisdom_id_param" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE wisdoms 
  SET unread_feedback_count = COALESCE(unread_feedback_count, 0) + 1
  WHERE id = wisdom_id_param;
END;
$$;


ALTER FUNCTION "public"."increment_unread_feedback"("wisdom_id_param" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_wisdoms"("query_embedding" "public"."vector", "match_categories" "text"[] DEFAULT NULL::"text"[], "match_count" integer DEFAULT 20, "similarity_threshold" double precision DEFAULT 0.3) RETURNS TABLE("id" "uuid", "user_id" "uuid", "text" "text", "description" "text", "categories" "text"[], "audio_url" "text", "duration_seconds" integer, "is_public" boolean, "listens" integer, "likes" integer, "created_at" timestamp with time zone, "creator_name" "text", "creator_avatar" "text", "similarity" double precision)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id,
    w.user_id,
    w.text,
    w.description,
    w.categories,
    w.audio_url,
    w.duration_seconds,
    w.is_public,
    w.listens,
    w.likes,
    w.created_at,
    w.creator_name,
    w.creator_avatar,
    1 - (w.embedding <=> query_embedding) AS similarity
  FROM wisdoms w
  WHERE 
    w.embedding IS NOT NULL
    AND w.is_public = true
    AND (
      match_categories IS NULL 
      OR w.categories && match_categories
    )
    AND 1 - (w.embedding <=> query_embedding) > similarity_threshold
  ORDER BY w.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


ALTER FUNCTION "public"."match_wisdoms"("query_embedding" "public"."vector", "match_categories" "text"[], "match_count" integer, "similarity_threshold" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_wisdom_usage"("p_user_id" "uuid", "p_duration_seconds" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Update or insert subscription record
    INSERT INTO public.subscriptions (user_id, records_today, last_record_date, minutes_used_this_month)
    VALUES (
        p_user_id,
        1,
        CURRENT_DATE,
        p_duration_seconds / 60.0
    )
    ON CONFLICT (user_id) DO UPDATE SET
        records_today = CASE 
            WHEN subscriptions.last_record_date = CURRENT_DATE THEN subscriptions.records_today + 1
            ELSE 1
        END,
        last_record_date = CURRENT_DATE,
        minutes_used_this_month = CASE
            WHEN DATE_TRUNC('month', subscriptions.current_period_start) = DATE_TRUNC('month', NOW())
            THEN subscriptions.minutes_used_this_month + (p_duration_seconds / 60.0)
            ELSE p_duration_seconds / 60.0
        END,
        updated_at = NOW();
END;
$$;


ALTER FUNCTION "public"."record_wisdom_usage"("p_user_id" "uuid", "p_duration_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_wisdom_likes_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.wisdoms SET likes = likes + 1 WHERE id = NEW.wisdom_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.wisdoms SET likes = likes - 1 WHERE id = OLD.wisdom_id;
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_wisdom_likes_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_wisdom_listens_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.wisdoms SET listens = listens + 1 WHERE id = NEW.wisdom_id;
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_wisdom_listens_count"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "type" "text" DEFAULT 'info'::"text",
    "is_active" boolean DEFAULT true,
    "priority" integer DEFAULT 0,
    "start_at" timestamp with time zone DEFAULT "now"(),
    "end_at" timestamp with time zone,
    "target_users" "text" DEFAULT 'all'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "key" "text" NOT NULL,
    "value" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "text"
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocked_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "blocked_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."blocked_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."book_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "user_email" "text",
    "user_name" "text",
    "order_type" "text" NOT NULL,
    "total_minutes" numeric,
    "wisdom_count" integer,
    "amount" numeric DEFAULT 0,
    "payment_status" "text" DEFAULT 'pending'::"text",
    "status" "text" DEFAULT 'pending'::"text",
    "shipping_info" "jsonb",
    "tracking_number" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "download_url" "text",
    "original_order_id" "uuid",
    "payment_intent_id" "text",
    CONSTRAINT "book_orders_order_type_check" CHECK (("order_type" = ANY (ARRAY['ebook'::"text", 'printed'::"text"]))),
    CONSTRAINT "book_orders_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['free'::"text", 'pending'::"text", 'paid'::"text", 'failed'::"text"]))),
    CONSTRAINT "book_orders_status_check" CHECK (("status" = ANY (ARRAY['pending_payment'::"text", 'pending'::"text", 'processing'::"text", 'completed'::"text", 'shipped'::"text", 'delivered'::"text", 'cancelled'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."book_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."card_keywords" (
    "id" "text" NOT NULL,
    "category" "text" NOT NULL,
    "keyword" "text" NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "front_image" "text",
    "back_image" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."card_keywords" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."card_saves" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "card_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."card_saves" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."character_data" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "character_id" "text" NOT NULL,
    "character_name" "text" DEFAULT ''::"text",
    "level" integer DEFAULT 1,
    "exp" integer DEFAULT 0,
    "total_exp" integer DEFAULT 0,
    "total_recording_seconds" integer DEFAULT 0,
    "total_cards_created" integer DEFAULT 0,
    "current_outfit" integer DEFAULT 1,
    "unlocked_outfits" integer[] DEFAULT '{1}'::integer[],
    "is_unlocked" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."character_data" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "task_text" "text" NOT NULL,
    "task_type" "text" DEFAULT 'wisdom'::"text" NOT NULL,
    "exp_reward" integer DEFAULT 20 NOT NULL,
    "is_completed" boolean DEFAULT false NOT NULL,
    "completed_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "linked_keyword" "text"
);


ALTER TABLE "public"."daily_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."default_avatars" (
    "id" integer NOT NULL,
    "filename" "text" NOT NULL,
    "avatar_url" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."default_avatars" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."default_avatars_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."default_avatars_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."default_avatars_id_seq" OWNED BY "public"."default_avatars"."id";



CREATE TABLE IF NOT EXISTS "public"."default_creators" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "display_name" "text" NOT NULL,
    "avatar_url" "text",
    "total_mins_created" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."default_creators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."force_updates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "version" "text" NOT NULL,
    "message" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."force_updates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "display_name" "text",
    "avatar_url" "text",
    "birthday" "date",
    "zodiac_sign" "text",
    "interests" "text"[] DEFAULT '{}'::"text"[],
    "selected_character" "text" DEFAULT 'cat-1'::"text",
    "onboarding_completed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "has_completed_onboarding" boolean DEFAULT false,
    "selected_interests" "text"[] DEFAULT '{}'::"text"[],
    "custom_categories" "text"[] DEFAULT '{}'::"text"[],
    "is_guest" boolean DEFAULT false,
    "total_mins_created" integer DEFAULT 0,
    "is_default_avatar" boolean DEFAULT true,
    "last_wisdom_created_at" timestamp with time zone,
    "last_report_viewed_at" timestamp with time zone,
    "character_b_message" "text",
    "character_b_message_at" timestamp with time zone,
    "questions_used" integer DEFAULT 0,
    "questions_reset_at" timestamp with time zone,
    "subscription_tier" "text" DEFAULT 'free'::"text",
    "subscription_started_at" timestamp with time zone,
    "last_book_applied_minutes" numeric DEFAULT 0,
    "gacha_date" "date",
    "gacha_count" integer DEFAULT 0,
    "active_character_id" "text" DEFAULT 'char-1'::"text",
    "character_mode" "text" DEFAULT 'play'::"text",
    "wp" integer DEFAULT 0,
    "wp_last_updated" timestamp with time zone DEFAULT "now"(),
    "mode_changed_at" timestamp with time zone DEFAULT "now"(),
    "afk_study_seconds" integer DEFAULT 0,
    "afk_play_seconds" integer DEFAULT 0,
    "last_recording_at" timestamp with time zone,
    "drain_words" "jsonb" DEFAULT '[]'::"jsonb",
    "aspire_words" "jsonb" DEFAULT '[]'::"jsonb",
    "wisdom_portrait" "text" DEFAULT ''::"text",
    "aspire_scores" "jsonb" DEFAULT '{}'::"jsonb",
    "better_self_score" integer DEFAULT 70,
    "community_resonance" integer DEFAULT 0,
    "community_resonance_updated_at" timestamp with time zone,
    "last_report_generated_at" timestamp with time zone,
    "wisdom_share_count" integer DEFAULT 0,
    "people_impacted_display" integer DEFAULT 0,
    "people_impacted_updated_at" timestamp with time zone,
    "ai_consent_at" timestamp with time zone
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'User profile information';



COMMENT ON COLUMN "public"."profiles"."ai_consent_at" IS 'When the user agreed to AI processing of their entries via the in-app consent modal. NULL = not yet agreed. Set once, never unset.';



CREATE TABLE IF NOT EXISTS "public"."wisdoms" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "audio_url" "text" DEFAULT ''::"text",
    "text" "text",
    "description" "text",
    "duration_seconds" integer DEFAULT 0,
    "categories" "text"[] DEFAULT '{}'::"text"[],
    "is_public" boolean DEFAULT true,
    "listens" integer DEFAULT 0,
    "likes" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "embedding" "public"."vector"(768),
    "engagement_boosted" boolean DEFAULT false,
    "creator_name" "text",
    "creator_avatar" "text",
    "default_creator_id" "uuid",
    "weekly_boost_at" timestamp with time zone,
    "unread_feedback_count" integer DEFAULT 0,
    "boost_at" timestamp with time zone,
    "boost_views" integer DEFAULT 0,
    "boost_likes" integer DEFAULT 0,
    "daily_index" "text"
);


ALTER TABLE "public"."wisdoms" OWNER TO "postgres";


COMMENT ON TABLE "public"."wisdoms" IS 'Audio wisdom recordings';



CREATE OR REPLACE VIEW "public"."leaderboard" AS
 SELECT "p"."id" AS "user_id",
    "p"."display_name",
    "p"."avatar_url",
    (COALESCE((("sum"("w"."duration_seconds"))::numeric / 60.0), (0)::numeric))::integer AS "total_minutes",
    ("count"(DISTINCT "w"."id"))::integer AS "total_wisdoms",
    "row_number"() OVER (ORDER BY COALESCE("sum"("w"."duration_seconds"), (0)::bigint) DESC) AS "rank"
   FROM ("public"."profiles" "p"
     LEFT JOIN "public"."wisdoms" "w" ON ((("p"."id" = "w"."user_id") AND ("w"."is_public" = true))))
  WHERE ("p"."onboarding_completed" = true)
  GROUP BY "p"."id", "p"."display_name", "p"."avatar_url"
  ORDER BY ((COALESCE((("sum"("w"."duration_seconds"))::numeric / 60.0), (0)::numeric))::integer) DESC;


ALTER VIEW "public"."leaderboard" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leaderboard_seeds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "avatar_url" "text",
    "total_mins" integer DEFAULT 0 NOT NULL,
    "wisdom_count" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."leaderboard_seeds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."likes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "wisdom_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."likes" OWNER TO "postgres";


COMMENT ON TABLE "public"."likes" IS 'Wisdom likes/favorites';



CREATE TABLE IF NOT EXISTS "public"."listens" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "wisdom_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."listens" OWNER TO "postgres";


COMMENT ON TABLE "public"."listens" IS 'Wisdom play tracking';



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "product_type" "text" NOT NULL,
    "status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text",
    "payment_intent_id" "text",
    "customer_name" "text",
    "customer_email" "text",
    "shipping_name" "text",
    "shipping_address" "text",
    "shipping_city" "text",
    "shipping_state" "text",
    "shipping_zip" "text",
    "shipping_country" "text" DEFAULT 'US'::"text",
    "shipping_phone" "text",
    "selected_card_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "tracking_number" "text",
    "notes" "text",
    "shipped_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "orders_product_type_check" CHECK (("product_type" = ANY (ARRAY['wisdom_book'::"text", 'wisdom_cards'::"text"]))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['pending_payment'::"text", 'pending_selection'::"text", 'paid'::"text", 'processing'::"text", 'shipped'::"text", 'delivered'::"text", 'cancelled'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "report_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "details" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "reviewer_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seek_question_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_id" "uuid" NOT NULL,
    "card_id" "uuid" NOT NULL,
    "contributed_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."seek_question_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seek_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_text" "text" NOT NULL,
    "question_tag" "text" DEFAULT 'Clarity'::"text" NOT NULL,
    "creator_name" "text" DEFAULT 'WisdomSeeker'::"text",
    "creator_avatar" "text" DEFAULT ''::"text",
    "is_published" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "submitted_by_user_id" "uuid",
    "status" "text" DEFAULT 'approved'::"text",
    "rejection_reason" "text",
    "card_count" integer DEFAULT 0
);


ALTER TABLE "public"."seek_questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "billing_cycle" "text" DEFAULT 'monthly'::"text",
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "minutes_used_this_month" numeric(10,2) DEFAULT 0,
    "records_today" integer DEFAULT 0,
    "last_record_date" "date",
    "airwallex_customer_id" "text",
    "airwallex_subscription_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "google_purchase_token" "text",
    "google_product_id" "text",
    "google_subscription_id" "text",
    "google_base_plan_id" "text",
    "google_order_id" "text",
    "google_auto_renewing" boolean,
    "pending_plan" "text",
    "pending_billing_cycle" "text",
    "pending_product_id" "text",
    "pending_base_plan_id" "text",
    "apple_transaction_id" "text",
    "apple_original_transaction_id" "text",
    "apple_product_id" "text",
    CONSTRAINT "subscriptions_billing_cycle_check" CHECK (("billing_cycle" = ANY (ARRAY['monthly'::"text", 'yearly'::"text"]))),
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'premium'::"text", 'pro'::"text", 'ultra'::"text"]))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'cancelled'::"text", 'past_due'::"text", 'trialing'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscriptions" IS 'User subscription and usage tracking';



CREATE TABLE IF NOT EXISTS "public"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "email" "text" NOT NULL,
    "category" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "message" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "admin_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "support_tickets_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'resolved'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."support_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_characters" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "character_id" "text" NOT NULL,
    "unlocked_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_characters" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_characters" IS 'Unlocked companion characters';



CREATE TABLE IF NOT EXISTS "public"."user_liked_defaults" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "wisdom_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_liked_defaults" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_liked_wisdoms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "wisdom_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_liked_wisdoms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_read_announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "announcement_id" "uuid",
    "read_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_read_announcements" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_stats" AS
 SELECT "p"."id" AS "user_id",
    "count"(DISTINCT "w"."id") AS "total_wisdoms",
    COALESCE((("sum"("w"."duration_seconds"))::numeric / 60.0), (0)::numeric) AS "total_minutes",
    COALESCE("sum"("w"."likes"), (0)::bigint) AS "total_likes_received",
    COALESCE("sum"("w"."listens"), (0)::bigint) AS "total_listens",
    ( SELECT "count"(*) AS "count"
           FROM "public"."likes" "l"
          WHERE ("l"."user_id" = "p"."id")) AS "wisdoms_liked",
    ( SELECT "count"(DISTINCT "l2"."user_id") AS "count"
           FROM ("public"."listens" "l2"
             JOIN "public"."wisdoms" "w2" ON (("l2"."wisdom_id" = "w2"."id")))
          WHERE ("w2"."user_id" = "p"."id")) AS "people_helped"
   FROM ("public"."profiles" "p"
     LEFT JOIN "public"."wisdoms" "w" ON (("p"."id" = "w"."user_id")))
  GROUP BY "p"."id";


ALTER VIEW "public"."user_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "report_data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."weekly_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wisdom_blocks" (
    "user_id" "uuid" NOT NULL,
    "wisdom_id" "uuid" NOT NULL,
    "blocked_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wisdom_blocks" OWNER TO "postgres";


COMMENT ON TABLE "public"."wisdom_blocks" IS 'Per-user wisdom block list. Inserting a row hides that wisdom from this user in all listing contexts (seek-question, discover, etc.). Block is permanent until row deleted (no unblock UI in v1).';



CREATE TABLE IF NOT EXISTS "public"."wisdom_card_blocks" (
    "user_id" "uuid" NOT NULL,
    "card_id" "uuid" NOT NULL,
    "blocked_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wisdom_card_blocks" OWNER TO "postgres";


COMMENT ON TABLE "public"."wisdom_card_blocks" IS 'Per-user wisdom_card block list. A row hides that card from this user in all listing contexts (seek-question cards, etc.). Block is permanent until row deleted; no unblock UI in v1.';



CREATE TABLE IF NOT EXISTS "public"."wisdom_card_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "card_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "detail" "text",
    "reported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "text",
    CONSTRAINT "wisdom_card_reports_reason_check" CHECK (("reason" = ANY (ARRAY['spam'::"text", 'inappropriate'::"text", 'harassment'::"text", 'violence'::"text", 'sexual'::"text", 'self_harm'::"text", 'misinformation'::"text", 'other'::"text"]))),
    CONSTRAINT "wisdom_card_reports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'reviewed'::"text", 'dismissed'::"text", 'actioned'::"text"])))
);


ALTER TABLE "public"."wisdom_card_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wisdom_cards" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "wisdom_id" "uuid",
    "user_id" "uuid",
    "card_a" "text" NOT NULL,
    "card_b" "text",
    "card_c" "text",
    "likes" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "creator_name" "text",
    "creator_avatar" "text",
    "keyword_id" "text",
    "card_number" integer,
    "quote_short" "text",
    "insight_full" "text",
    "wisdom_score" integer,
    "wisdom_emotion" "text",
    "saves_count" integer DEFAULT 0,
    "task_1" "text" DEFAULT ''::"text",
    "task_2" "text" DEFAULT ''::"text",
    "aspire_impacts" "jsonb",
    "reframe" "jsonb",
    "reflective_question" "jsonb"
);


ALTER TABLE "public"."wisdom_cards" OWNER TO "postgres";


COMMENT ON TABLE "public"."wisdom_cards" IS 'ABC Wisdom insight cards generated from user recordings';



COMMENT ON COLUMN "public"."wisdom_cards"."aspire_impacts" IS 'AI-returned array of {keyword, direction} for this card. Used by weekly-report POST to compute traitChanges over the last 7 days.';



CREATE TABLE IF NOT EXISTS "public"."wisdom_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "wisdom_id" "uuid",
    "comment_text" "text" NOT NULL,
    "is_ai_generated" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_read" boolean DEFAULT false,
    "comment_type" "text" DEFAULT 'user'::"text",
    "sentiment" "text",
    "is_visible" boolean DEFAULT true,
    "commenter_avatar" "text",
    "commenter_name" "text",
    "visible_at" timestamp with time zone,
    "commenter_id" "uuid"
);


ALTER TABLE "public"."wisdom_comments" OWNER TO "postgres";


ALTER TABLE ONLY "public"."default_avatars" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."default_avatars_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_announcements"
    ADD CONSTRAINT "app_announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blocked_users"
    ADD CONSTRAINT "blocked_users_user_id_blocked_user_id_key" UNIQUE ("user_id", "blocked_user_id");



ALTER TABLE ONLY "public"."book_orders"
    ADD CONSTRAINT "book_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."card_keywords"
    ADD CONSTRAINT "card_keywords_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."card_saves"
    ADD CONSTRAINT "card_saves_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."card_saves"
    ADD CONSTRAINT "card_saves_user_id_card_id_key" UNIQUE ("user_id", "card_id");



ALTER TABLE ONLY "public"."character_data"
    ADD CONSTRAINT "character_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."character_data"
    ADD CONSTRAINT "character_data_user_id_character_id_key" UNIQUE ("user_id", "character_id");



ALTER TABLE ONLY "public"."daily_tasks"
    ADD CONSTRAINT "daily_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."default_avatars"
    ADD CONSTRAINT "default_avatars_filename_key" UNIQUE ("filename");



ALTER TABLE ONLY "public"."default_avatars"
    ADD CONSTRAINT "default_avatars_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."default_creators"
    ADD CONSTRAINT "default_creators_display_name_key" UNIQUE ("display_name");



ALTER TABLE ONLY "public"."default_creators"
    ADD CONSTRAINT "default_creators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."force_updates"
    ADD CONSTRAINT "force_updates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leaderboard_seeds"
    ADD CONSTRAINT "leaderboard_seeds_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."leaderboard_seeds"
    ADD CONSTRAINT "leaderboard_seeds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_user_id_wisdom_id_key" UNIQUE ("user_id", "wisdom_id");



ALTER TABLE ONLY "public"."listens"
    ADD CONSTRAINT "listens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seek_question_cards"
    ADD CONSTRAINT "seek_question_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."seek_questions"
    ADD CONSTRAINT "seek_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_characters"
    ADD CONSTRAINT "user_characters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_characters"
    ADD CONSTRAINT "user_characters_user_id_character_id_key" UNIQUE ("user_id", "character_id");



ALTER TABLE ONLY "public"."user_liked_defaults"
    ADD CONSTRAINT "user_liked_defaults_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_liked_defaults"
    ADD CONSTRAINT "user_liked_defaults_user_id_wisdom_id_key" UNIQUE ("user_id", "wisdom_id");



ALTER TABLE ONLY "public"."user_liked_wisdoms"
    ADD CONSTRAINT "user_liked_wisdoms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_liked_wisdoms"
    ADD CONSTRAINT "user_liked_wisdoms_user_id_wisdom_id_key" UNIQUE ("user_id", "wisdom_id");



ALTER TABLE ONLY "public"."user_read_announcements"
    ADD CONSTRAINT "user_read_announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_read_announcements"
    ADD CONSTRAINT "user_read_announcements_user_id_announcement_id_key" UNIQUE ("user_id", "announcement_id");



ALTER TABLE ONLY "public"."weekly_reports"
    ADD CONSTRAINT "weekly_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_reports"
    ADD CONSTRAINT "weekly_reports_user_id_week_start_key" UNIQUE ("user_id", "week_start");



ALTER TABLE ONLY "public"."wisdom_blocks"
    ADD CONSTRAINT "wisdom_blocks_pkey" PRIMARY KEY ("user_id", "wisdom_id");



ALTER TABLE ONLY "public"."wisdom_card_blocks"
    ADD CONSTRAINT "wisdom_card_blocks_pkey" PRIMARY KEY ("user_id", "card_id");



ALTER TABLE ONLY "public"."wisdom_card_reports"
    ADD CONSTRAINT "wisdom_card_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wisdom_card_reports"
    ADD CONSTRAINT "wisdom_card_reports_user_id_card_id_key" UNIQUE ("user_id", "card_id");



ALTER TABLE ONLY "public"."wisdom_cards"
    ADD CONSTRAINT "wisdom_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wisdom_comments"
    ADD CONSTRAINT "wisdom_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wisdoms"
    ADD CONSTRAINT "wisdoms_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "daily_tasks_uniq_daily_love" ON "public"."daily_tasks" USING "btree" ("user_id", "task_type", ((("created_at" AT TIME ZONE 'UTC'::"text"))::"date")) WHERE ("task_type" = 'daily_love'::"text");



CREATE INDEX "idx_announcements_is_active" ON "public"."app_announcements" USING "btree" ("is_active");



CREATE INDEX "idx_announcements_priority" ON "public"."app_announcements" USING "btree" ("priority" DESC);



CREATE INDEX "idx_announcements_start_at" ON "public"."app_announcements" USING "btree" ("start_at");



CREATE INDEX "idx_blocked_users_blocked" ON "public"."blocked_users" USING "btree" ("blocked_user_id");



CREATE INDEX "idx_blocked_users_user" ON "public"."blocked_users" USING "btree" ("user_id");



CREATE INDEX "idx_book_orders_order_type" ON "public"."book_orders" USING "btree" ("order_type");



CREATE INDEX "idx_book_orders_status" ON "public"."book_orders" USING "btree" ("status");



CREATE INDEX "idx_book_orders_user_id" ON "public"."book_orders" USING "btree" ("user_id");



CREATE INDEX "idx_card_saves_user" ON "public"."card_saves" USING "btree" ("user_id");



CREATE INDEX "idx_character_data_user" ON "public"."character_data" USING "btree" ("user_id");



CREATE INDEX "idx_character_data_user_char" ON "public"."character_data" USING "btree" ("user_id", "character_id");



CREATE INDEX "idx_daily_tasks_user" ON "public"."daily_tasks" USING "btree" ("user_id", "is_completed", "expires_at");



CREATE INDEX "idx_likes_user_id" ON "public"."likes" USING "btree" ("user_id");



CREATE INDEX "idx_likes_wisdom_id" ON "public"."likes" USING "btree" ("wisdom_id");



CREATE INDEX "idx_listens_created_at" ON "public"."listens" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_listens_wisdom_id" ON "public"."listens" USING "btree" ("wisdom_id");



CREATE INDEX "idx_orders_status" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "idx_orders_user_id" ON "public"."orders" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_subscription_tier" ON "public"."profiles" USING "btree" ("subscription_tier");



CREATE INDEX "idx_reports_created_at" ON "public"."reports" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_reports_reporter" ON "public"."reports" USING "btree" ("reporter_id");



CREATE INDEX "idx_reports_reporter_id" ON "public"."reports" USING "btree" ("reporter_id");



CREATE INDEX "idx_reports_status" ON "public"."reports" USING "btree" ("status");



CREATE INDEX "idx_reports_target" ON "public"."reports" USING "btree" ("target_id");



CREATE UNIQUE INDEX "idx_reports_unique" ON "public"."reports" USING "btree" ("reporter_id", "report_type", "target_id");



CREATE INDEX "idx_seek_questions_status" ON "public"."seek_questions" USING "btree" ("status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_seek_questions_submitted_by" ON "public"."seek_questions" USING "btree" ("submitted_by_user_id") WHERE ("submitted_by_user_id" IS NOT NULL);



CREATE INDEX "idx_sqc_question" ON "public"."seek_question_cards" USING "btree" ("question_id");



CREATE INDEX "idx_subscriptions_apple_original_txn" ON "public"."subscriptions" USING "btree" ("apple_original_transaction_id") WHERE ("apple_original_transaction_id" IS NOT NULL);



CREATE INDEX "idx_subscriptions_google_purchase_token" ON "public"."subscriptions" USING "btree" ("google_purchase_token");



CREATE INDEX "idx_subscriptions_google_token" ON "public"."subscriptions" USING "btree" ("google_purchase_token") WHERE ("google_purchase_token" IS NOT NULL);



CREATE INDEX "idx_subscriptions_user_id" ON "public"."subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_support_tickets_created" ON "public"."support_tickets" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_support_tickets_status" ON "public"."support_tickets" USING "btree" ("status");



CREATE INDEX "idx_user_characters_user_id" ON "public"."user_characters" USING "btree" ("user_id");



CREATE INDEX "idx_user_read_announcements_announcement_id" ON "public"."user_read_announcements" USING "btree" ("announcement_id");



CREATE INDEX "idx_user_read_announcements_user_id" ON "public"."user_read_announcements" USING "btree" ("user_id");



CREATE INDEX "idx_weekly_reports_user" ON "public"."weekly_reports" USING "btree" ("user_id", "created_at");



CREATE INDEX "idx_weekly_reports_user_week" ON "public"."weekly_reports" USING "btree" ("user_id", "week_start");



CREATE INDEX "idx_wisdom_blocks_user_id" ON "public"."wisdom_blocks" USING "btree" ("user_id");



CREATE INDEX "idx_wisdom_card_blocks_user_id" ON "public"."wisdom_card_blocks" USING "btree" ("user_id");



CREATE INDEX "idx_wisdom_card_reports_card" ON "public"."wisdom_card_reports" USING "btree" ("card_id");



CREATE INDEX "idx_wisdom_card_reports_status" ON "public"."wisdom_card_reports" USING "btree" ("status", "reported_at" DESC);



CREATE INDEX "idx_wisdom_cards_created_at" ON "public"."wisdom_cards" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_wisdom_cards_keyword" ON "public"."wisdom_cards" USING "btree" ("keyword_id");



CREATE INDEX "idx_wisdom_cards_user" ON "public"."wisdom_cards" USING "btree" ("user_id");



CREATE INDEX "idx_wisdom_cards_user_id" ON "public"."wisdom_cards" USING "btree" ("user_id");



CREATE INDEX "idx_wisdom_cards_user_recent" ON "public"."wisdom_cards" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_wisdom_cards_wisdom_id" ON "public"."wisdom_cards" USING "btree" ("wisdom_id");



CREATE INDEX "idx_wisdom_comments_is_read" ON "public"."wisdom_comments" USING "btree" ("is_read");



CREATE INDEX "idx_wisdom_comments_is_visible" ON "public"."wisdom_comments" USING "btree" ("is_visible");



CREATE INDEX "idx_wisdom_comments_wisdom_id" ON "public"."wisdom_comments" USING "btree" ("wisdom_id");



CREATE INDEX "idx_wisdoms_categories" ON "public"."wisdoms" USING "gin" ("categories");



CREATE INDEX "idx_wisdoms_created_at" ON "public"."wisdoms" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_wisdoms_user_id" ON "public"."wisdoms" USING "btree" ("user_id");



CREATE INDEX "user_liked_defaults_user_id_idx" ON "public"."user_liked_defaults" USING "btree" ("user_id");



CREATE INDEX "user_liked_wisdoms_user_id_idx" ON "public"."user_liked_wisdoms" USING "btree" ("user_id");



CREATE INDEX "user_liked_wisdoms_wisdom_id_idx" ON "public"."user_liked_wisdoms" USING "btree" ("wisdom_id");



CREATE INDEX "wisdom_comments_wisdom_id_idx" ON "public"."wisdom_comments" USING "btree" ("wisdom_id");



CREATE INDEX "wisdoms_categories_idx" ON "public"."wisdoms" USING "gin" ("categories");



CREATE INDEX "wisdoms_created_at_idx" ON "public"."wisdoms" USING "btree" ("created_at" DESC);



CREATE INDEX "wisdoms_embedding_idx" ON "public"."wisdoms" USING "hnsw" ("embedding" "public"."vector_cosine_ops");



CREATE INDEX "wisdoms_is_public_idx" ON "public"."wisdoms" USING "btree" ("is_public");



CREATE OR REPLACE TRIGGER "on_like_change" AFTER INSERT OR DELETE ON "public"."likes" FOR EACH ROW EXECUTE FUNCTION "public"."update_wisdom_likes_count"();



CREATE OR REPLACE TRIGGER "on_listen_insert" AFTER INSERT ON "public"."listens" FOR EACH ROW EXECUTE FUNCTION "public"."update_wisdom_listens_count"();



CREATE OR REPLACE TRIGGER "trigger_assign_default_avatar" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."assign_default_avatar"();



ALTER TABLE ONLY "public"."book_orders"
    ADD CONSTRAINT "book_orders_original_order_id_fkey" FOREIGN KEY ("original_order_id") REFERENCES "public"."book_orders"("id");



ALTER TABLE ONLY "public"."book_orders"
    ADD CONSTRAINT "book_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."card_saves"
    ADD CONSTRAINT "card_saves_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."wisdom_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."card_saves"
    ADD CONSTRAINT "card_saves_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."character_data"
    ADD CONSTRAINT "character_data_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."likes"
    ADD CONSTRAINT "likes_wisdom_id_fkey" FOREIGN KEY ("wisdom_id") REFERENCES "public"."wisdoms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."listens"
    ADD CONSTRAINT "listens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."listens"
    ADD CONSTRAINT "listens_wisdom_id_fkey" FOREIGN KEY ("wisdom_id") REFERENCES "public"."wisdoms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."seek_question_cards"
    ADD CONSTRAINT "seek_question_cards_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."seek_questions"("id");



ALTER TABLE ONLY "public"."seek_questions"
    ADD CONSTRAINT "seek_questions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."support_tickets"
    ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_characters"
    ADD CONSTRAINT "user_characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_liked_defaults"
    ADD CONSTRAINT "user_liked_defaults_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_liked_wisdoms"
    ADD CONSTRAINT "user_liked_wisdoms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_liked_wisdoms"
    ADD CONSTRAINT "user_liked_wisdoms_wisdom_id_fkey" FOREIGN KEY ("wisdom_id") REFERENCES "public"."wisdoms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_read_announcements"
    ADD CONSTRAINT "user_read_announcements_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "public"."app_announcements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_read_announcements"
    ADD CONSTRAINT "user_read_announcements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_reports"
    ADD CONSTRAINT "weekly_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdom_blocks"
    ADD CONSTRAINT "wisdom_blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdom_blocks"
    ADD CONSTRAINT "wisdom_blocks_wisdom_id_fkey" FOREIGN KEY ("wisdom_id") REFERENCES "public"."wisdoms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdom_card_blocks"
    ADD CONSTRAINT "wisdom_card_blocks_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."wisdom_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdom_card_blocks"
    ADD CONSTRAINT "wisdom_card_blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdom_card_reports"
    ADD CONSTRAINT "wisdom_card_reports_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."wisdom_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdom_card_reports"
    ADD CONSTRAINT "wisdom_card_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdom_cards"
    ADD CONSTRAINT "wisdom_cards_keyword_id_fkey" FOREIGN KEY ("keyword_id") REFERENCES "public"."card_keywords"("id");



ALTER TABLE ONLY "public"."wisdom_cards"
    ADD CONSTRAINT "wisdom_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdom_cards"
    ADD CONSTRAINT "wisdom_cards_wisdom_id_fkey" FOREIGN KEY ("wisdom_id") REFERENCES "public"."wisdoms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdom_comments"
    ADD CONSTRAINT "wisdom_comments_wisdom_id_fkey" FOREIGN KEY ("wisdom_id") REFERENCES "public"."wisdoms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wisdoms"
    ADD CONSTRAINT "wisdoms_default_creator_id_fkey" FOREIGN KEY ("default_creator_id") REFERENCES "public"."default_creators"("id");



ALTER TABLE ONLY "public"."wisdoms"
    ADD CONSTRAINT "wisdoms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can insert listens" ON "public"."listens" FOR INSERT WITH CHECK (true);



CREATE POLICY "Anyone can read card keywords" ON "public"."card_keywords" FOR SELECT USING (true);



CREATE POLICY "Anyone can view default cards" ON "public"."wisdom_cards" FOR SELECT USING (("user_id" IS NULL));



CREATE POLICY "Service role can insert cards" ON "public"."wisdom_cards" FOR INSERT WITH CHECK (true);



CREATE POLICY "Service role can manage all subscriptions" ON "public"."subscriptions" USING ((("auth"."jwt"() ->> 'role'::"text") = 'service_role'::"text"));



CREATE POLICY "Service role can manage profiles" ON "public"."profiles" USING (true) WITH CHECK (true);



CREATE POLICY "Users can delete own liked wisdoms" ON "public"."user_liked_wisdoms" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own likes" ON "public"."likes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own saves" ON "public"."card_saves" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own wisdoms" ON "public"."wisdoms" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own characters" ON "public"."user_characters" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own liked wisdoms" ON "public"."user_liked_wisdoms" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own likes" ON "public"."likes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert own saves" ON "public"."card_saves" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own wisdoms" ON "public"."wisdoms" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own characters" ON "public"."character_data" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own liked defaults" ON "public"."user_liked_defaults" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own subscription" ON "public"."subscriptions" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own wisdoms" ON "public"."wisdoms" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own cards" ON "public"."wisdom_cards" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own characters" ON "public"."user_characters" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own liked wisdoms" ON "public"."user_liked_wisdoms" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own likes" ON "public"."likes" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own listens" ON "public"."listens" FOR SELECT USING ((("auth"."uid"() = "user_id") OR ("user_id" IS NULL)));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own reports" ON "public"."weekly_reports" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own saves" ON "public"."card_saves" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own subscription" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own wisdoms" ON "public"."wisdoms" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view public cards" ON "public"."wisdom_cards" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."wisdoms"
  WHERE (("wisdoms"."id" = "wisdom_cards"."wisdom_id") AND ("wisdoms"."is_public" = true)))));



CREATE POLICY "Users can view public wisdoms" ON "public"."wisdoms" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Users delete own blocks" ON "public"."wisdom_blocks" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users delete own card blocks" ON "public"."wisdom_card_blocks" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own blocks" ON "public"."wisdom_blocks" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own card blocks" ON "public"."wisdom_card_blocks" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert own reports" ON "public"."wisdom_card_reports" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users read own card blocks" ON "public"."wisdom_card_blocks" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."app_announcements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blocked_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."book_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."card_keywords" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."card_saves" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."character_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."default_avatars" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."default_creators" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."force_updates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leaderboard_seeds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."listens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seek_question_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seek_questions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."support_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_characters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_liked_defaults" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_liked_wisdoms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_read_announcements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wisdom_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wisdom_card_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wisdom_card_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wisdom_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wisdom_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wisdoms" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."assign_default_avatar"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_default_avatar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_default_avatar"() TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_user_record"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_user_record"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_user_record"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_random_default_avatar"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_random_default_avatar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_random_default_avatar"() TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_subscription"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_subscription"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_subscription"() TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_unread_feedback"("wisdom_id_param" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_unread_feedback"("wisdom_id_param" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_unread_feedback"("wisdom_id_param" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."match_wisdoms"("query_embedding" "public"."vector", "match_categories" "text"[], "match_count" integer, "similarity_threshold" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."match_wisdoms"("query_embedding" "public"."vector", "match_categories" "text"[], "match_count" integer, "similarity_threshold" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_wisdoms"("query_embedding" "public"."vector", "match_categories" "text"[], "match_count" integer, "similarity_threshold" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."record_wisdom_usage"("p_user_id" "uuid", "p_duration_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."record_wisdom_usage"("p_user_id" "uuid", "p_duration_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_wisdom_usage"("p_user_id" "uuid", "p_duration_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_wisdom_likes_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_wisdom_likes_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_wisdom_likes_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_wisdom_listens_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_wisdom_listens_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_wisdom_listens_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";















GRANT ALL ON TABLE "public"."app_announcements" TO "anon";
GRANT ALL ON TABLE "public"."app_announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."app_announcements" TO "service_role";



GRANT ALL ON TABLE "public"."app_config" TO "anon";
GRANT ALL ON TABLE "public"."app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."blocked_users" TO "anon";
GRANT ALL ON TABLE "public"."blocked_users" TO "authenticated";
GRANT ALL ON TABLE "public"."blocked_users" TO "service_role";



GRANT ALL ON TABLE "public"."book_orders" TO "anon";
GRANT ALL ON TABLE "public"."book_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."book_orders" TO "service_role";



GRANT ALL ON TABLE "public"."card_keywords" TO "anon";
GRANT ALL ON TABLE "public"."card_keywords" TO "authenticated";
GRANT ALL ON TABLE "public"."card_keywords" TO "service_role";



GRANT ALL ON TABLE "public"."card_saves" TO "anon";
GRANT ALL ON TABLE "public"."card_saves" TO "authenticated";
GRANT ALL ON TABLE "public"."card_saves" TO "service_role";



GRANT ALL ON TABLE "public"."character_data" TO "anon";
GRANT ALL ON TABLE "public"."character_data" TO "authenticated";
GRANT ALL ON TABLE "public"."character_data" TO "service_role";



GRANT ALL ON TABLE "public"."daily_tasks" TO "anon";
GRANT ALL ON TABLE "public"."daily_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."default_avatars" TO "anon";
GRANT ALL ON TABLE "public"."default_avatars" TO "authenticated";
GRANT ALL ON TABLE "public"."default_avatars" TO "service_role";



GRANT ALL ON SEQUENCE "public"."default_avatars_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."default_avatars_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."default_avatars_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."default_creators" TO "anon";
GRANT ALL ON TABLE "public"."default_creators" TO "authenticated";
GRANT ALL ON TABLE "public"."default_creators" TO "service_role";



GRANT ALL ON TABLE "public"."force_updates" TO "anon";
GRANT ALL ON TABLE "public"."force_updates" TO "authenticated";
GRANT ALL ON TABLE "public"."force_updates" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."wisdoms" TO "anon";
GRANT ALL ON TABLE "public"."wisdoms" TO "authenticated";
GRANT ALL ON TABLE "public"."wisdoms" TO "service_role";



GRANT ALL ON TABLE "public"."leaderboard" TO "anon";
GRANT ALL ON TABLE "public"."leaderboard" TO "authenticated";
GRANT ALL ON TABLE "public"."leaderboard" TO "service_role";



GRANT ALL ON TABLE "public"."leaderboard_seeds" TO "anon";
GRANT ALL ON TABLE "public"."leaderboard_seeds" TO "authenticated";
GRANT ALL ON TABLE "public"."leaderboard_seeds" TO "service_role";



GRANT ALL ON TABLE "public"."likes" TO "anon";
GRANT ALL ON TABLE "public"."likes" TO "authenticated";
GRANT ALL ON TABLE "public"."likes" TO "service_role";



GRANT ALL ON TABLE "public"."listens" TO "anon";
GRANT ALL ON TABLE "public"."listens" TO "authenticated";
GRANT ALL ON TABLE "public"."listens" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."seek_question_cards" TO "anon";
GRANT ALL ON TABLE "public"."seek_question_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."seek_question_cards" TO "service_role";



GRANT ALL ON TABLE "public"."seek_questions" TO "anon";
GRANT ALL ON TABLE "public"."seek_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."seek_questions" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."support_tickets" TO "anon";
GRANT ALL ON TABLE "public"."support_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."support_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."user_characters" TO "anon";
GRANT ALL ON TABLE "public"."user_characters" TO "authenticated";
GRANT ALL ON TABLE "public"."user_characters" TO "service_role";



GRANT ALL ON TABLE "public"."user_liked_defaults" TO "anon";
GRANT ALL ON TABLE "public"."user_liked_defaults" TO "authenticated";
GRANT ALL ON TABLE "public"."user_liked_defaults" TO "service_role";



GRANT ALL ON TABLE "public"."user_liked_wisdoms" TO "anon";
GRANT ALL ON TABLE "public"."user_liked_wisdoms" TO "authenticated";
GRANT ALL ON TABLE "public"."user_liked_wisdoms" TO "service_role";



GRANT ALL ON TABLE "public"."user_read_announcements" TO "anon";
GRANT ALL ON TABLE "public"."user_read_announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."user_read_announcements" TO "service_role";



GRANT ALL ON TABLE "public"."user_stats" TO "anon";
GRANT ALL ON TABLE "public"."user_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."user_stats" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_reports" TO "anon";
GRANT ALL ON TABLE "public"."weekly_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_reports" TO "service_role";



GRANT ALL ON TABLE "public"."wisdom_blocks" TO "anon";
GRANT ALL ON TABLE "public"."wisdom_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."wisdom_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."wisdom_card_blocks" TO "anon";
GRANT ALL ON TABLE "public"."wisdom_card_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."wisdom_card_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."wisdom_card_reports" TO "anon";
GRANT ALL ON TABLE "public"."wisdom_card_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."wisdom_card_reports" TO "service_role";



GRANT ALL ON TABLE "public"."wisdom_cards" TO "anon";
GRANT ALL ON TABLE "public"."wisdom_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."wisdom_cards" TO "service_role";



GRANT ALL ON TABLE "public"."wisdom_comments" TO "anon";
GRANT ALL ON TABLE "public"."wisdom_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."wisdom_comments" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































