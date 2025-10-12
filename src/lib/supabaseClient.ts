// src/lib/supabaseClient.ts
"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase"; // 生成した型

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

declare global {
  var __supabase__: SupabaseClient<Database> | undefined;
}

export const supabase: SupabaseClient<Database> =
  globalThis.__supabase__ ?? createClient<Database>(url, anon);

globalThis.__supabase__ = supabase;
