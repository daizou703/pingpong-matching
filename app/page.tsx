"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { User, Session, AuthChangeEvent, RealtimeChannel } from "@supabase/supabase-js";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert, TablesUpdate } from "@/types/supabase";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

import { useRouter } from "next/navigation";
import { CalendarClock, Users, Handshake, MessageSquare, UserCog, LogIn } from "lucide-react";

// エラーを安全に文字列へ
const toErrMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const dtFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "short",
  timeStyle: "short",
});

/* =========================
   Tables 型（生成型からエイリアス）
   ========================= */
type ProfileRow    = Tables<"profiles">;
type ProfileInsert = TablesInsert<"profiles">;
type ProfileUpdate = TablesUpdate<"profiles">;

type SlotRow       = Tables<"availability_slots">;
type SlotInsert    = TablesInsert<"availability_slots">;

type MatchRow      = Tables<"matches">;
type MatchInsert   = TablesInsert<"matches">;
type MatchStatus   = MatchRow["status"];

type MessageRow    = Tables<"messages">;
type MessageInsert = TablesInsert<"messages">;

// Enum（DBの型に追従）
type Gender        = ProfileRow["gender"];
type Hand          = ProfileRow["hand"];
type PlayingStyle  = ProfileRow["play_style"];

/* =========================
   Helpers
   ========================= */
const fmtDate = (v: string | null | undefined) => (v ? dtFmt.format(new Date(v)) : "-");

// datetime-local 文字列 ←→ ISO 変換ヘルパ
const toLocalInput = (isoLike: string | null | undefined) => {
  if (!isoLike) return "";
  const d = new Date(isoLike);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** プロファイルが無ければ作る */
async function ensureProfile(user: User): Promise<ProfileRow> {
  const { data: found, error: findErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (findErr) throw findErr;
  if (found) return found;

  const payload: ProfileInsert = {
    user_id: user.id,
    nickname: (user.user_metadata?.name as string | undefined) ?? null,
    avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    // Insert に存在しない列は入れない（never/型ズレの原因）
  };

  const { data: insData, error: insErr } = await supabase
    .from("profiles")
    .insert([payload])
    .select()
    .maybeSingle();
  if (insErr) throw insErr;
  if (!insData) throw new Error("Failed to insert profile");
  return insData;
}



/* =========================
   Main Page Component
   ========================= */
export default function Page() {
  const sb = useMemo(() => supabase, []);
  const [, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Magic Link
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  // Profile form state
  const [nickname, setNickname] = useState<string>("");
  const [level, setLevel] = useState<number | "">("");
  const [areaCode, setAreaCode] = useState<string>("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [hand, setHand] = useState<Hand | null>(null);
  const [playingStyle, setPlayingStyle] = useState<PlayingStyle | null>(null);
  const [years, setYears] = useState<number | "">("");
  const [purpose, setPurpose] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string>("");

  // Availability state
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [startAt, setStartAt] = useState<string>("");
  const [endAt, setEndAt] = useState<string>("");
  const [slotArea, setSlotArea] = useState<string>("");
  const [venueHint, setVenueHint] = useState<string>("");
  const [isRecurring, setIsRecurring] = useState<boolean>(false);

  // Availability 入力の妥当性
  const invalidAvailRange = useMemo(() => {
    if (!startAt || !endAt) return false;
    return new Date(startAt).getTime() >= new Date(endAt).getTime();
  }, [startAt, endAt]);
  const pastAvailStart = useMemo(() => {
    if (!startAt) return false;
    return new Date(startAt).getTime() < Date.now();
  }, [startAt]);

  // Browse users for proposal
  const [allUsers, setAllUsers] = useState<ProfileRow[]>([]);
  const [userFilter, setUserFilter] = useState<string>("");
  // 他ユーザーの「直近の空き」マップ（取得列だけに絞った型）
  // Supabaseのスキーマ上 user_id が null 取りうるため、UI側では string に正規化して扱う
  type PublicSlot = {
    user_id: string;
    start_at: string;
    end_at: string;
    area_code: string | null;
    venue_hint: string | null;
  };

  const [nextSlotMap, setNextSlotMap] = useState<Record<string, PublicSlot | null>>({});
  const [loadingNextSlots, setLoadingNextSlots] = useState(false);
  // 表示オプション：重なりありのみ表示する
  const [showOverlapOnly, setShowOverlapOnly] = useState(false);
  // 時間帯の重なり判定（[a,b) と [c,d) が交差するか）
  const hasOverlap = useCallback((aStart: string, aEnd: string, bStart: string, bEnd: string) => {
    // 開始 < 相手の終了 && 相手の開始 < 終了 で重なり
    return new Date(aStart).getTime() < new Date(bEnd).getTime()
        && new Date(bStart).getTime() < new Date(aEnd).getTime();
  }, []);

  // Matches & messages
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [activeMatchId, setActiveMatchId] = useState<MatchRow["id"] | null>(null); // ← number想定（生成型に追従）
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [chatBody, setChatBody] = useState<string>("");
  // 入力の最新値を参照するための ref（useCallback の依存から chatBody を外すため）
  const chatBodyRef = useRef("");
  useEffect(() => { chatBodyRef.current = chatBody; }, [chatBody]);
  const chatChannelRef = useRef<RealtimeChannel | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  
  // 追加: メッセージIDで重複追加を防ぐ
  const messageIdsRef = useRef<Set<string>>(new Set());

  // ▼ 追加：matches の Realtime チャンネル
  const matchesChannelRef = useRef<RealtimeChannel | null>(null);

  const router = useRouter();

  // --- Profile Detail (相手の詳細表示) ---
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailProfile, setDetailProfile] = useState<ProfileRow | null>(null);

  // 日本語ラベル変換
  const STYLE_JP:  Record<NonNullable<PlayingStyle>, string> = { shake: "シェーク", pen: "ペン", others: "その他" };

  const jpStyle  = (s: PlayingStyle | null) => (s ? (STYLE_JP[s as NonNullable<PlayingStyle>] ?? String(s)) : "-");

  // 目的の候補（保存値は英語コード、表示は日本語）
  const PURPOSE_OPTIONS: { value: string; label: string }[] = [
    { value: "multiball", label: "多球" },
    { value: "serve",     label: "サーブ" },
    { value: "match",     label: "ゲーム" },
    { value: "basic",     label: "基礎" },
  ];

  // 汎用ピッカー（value: string[]、onChange で配列を返す）
  function PurposePicker({
    value,
    onChange,
    disabled,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
    disabled?: boolean;
  }) {
    const toggle = (v: string) => {
      const has = value.includes(v);
      onChange(has ? value.filter((x) => x !== v) : [...value, v]);
    };
    return (
      <div className="flex flex-wrap gap-2">
        {PURPOSE_OPTIONS.map((opt) => {
          const active = value.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              disabled={disabled}
              className={[
                "px-3 py-1 rounded-full text-sm transition",
                active
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:opacity-90",
              ].join(" ")}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  // allUsers から見つからなければ profiles 1件フェッチ
  const openProfileDetail = useCallback(async (userId: string) => {
    setDetailOpen(true);
    // キャッシュ優先
    const cached = allUsers.find(u => u.user_id === userId) as ProfileRow | undefined;
    if (cached) { setDetailProfile(cached); return; }
    setDetailLoading(true);
    const { data } = await sb
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    setDetailProfile((data as ProfileRow) ?? null);
    setDetailLoading(false);
  }, [allUsers, sb]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const hydrateFormFromProfile = (pf: ProfileRow) => {
    setNickname(pf.nickname ?? "");
    setLevel((pf.level as number | null) ?? "");
    setAreaCode(pf.area_code ?? "");
    setGender(pf.gender);
    setHand(pf.hand);
    setPlayingStyle(pf.play_style);
    setYears((pf.years as number | null) ?? "");
    setPurpose(
      Array.isArray(pf.purpose)
        ? pf.purpose
        : (pf.purpose
            ? String(pf.purpose).split(",").map(s => s.trim()).filter(Boolean)
            : [])
    );
    setAvatarUrl(pf.avatar_url ?? "");
  };
  const resetForm = () => {
    setNickname(""); setLevel(""); setAreaCode(""); setGender(null); setHand(null); setPlayingStyle(null);
    setYears(""); setPurpose([]); setAvatarUrl("");
  };

  const fetchProfiles = useCallback(async (uid: string) => {
    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .neq("user_id", uid)
      .limit(50);
    if (!error && data) setAllUsers(data);
  }, [sb]);

  const fetchSlots = useCallback(async (uid: string) => {
    const { data, error } = await sb
      .from("availability_slots")
      .select("*")
      .eq("user_id", uid)
      .order("start_at", { ascending: true });
    if (!error && data) setSlots(data);
  }, [sb]);

  const fetchMatches = useCallback(async (uid: string) => {
    const { data, error } = await sb
      .from("matches")
      .select("*")
      .or(`user_a.eq.${uid},user_b.eq.${uid}`)
      .order("start_at", { ascending: true });
    if (!error && data) setMatches(data);
  }, [sb]);

  // 他ユーザーの「直近の空き」を一括取得（現在時刻以降の最も早い1件）
  const fetchNextSlotsForUsers = useCallback(async (userIds: string[]) => {
    try {
      setLoadingNextSlots(true);
      if (!userIds.length) { setNextSlotMap({}); return; }
      const nowIso = new Date().toISOString();
      const { data, error } = await sb
        .from("availability_slots")
        .select("user_id,start_at,end_at,area_code,venue_hint")
        .in("user_id", userIds)
        .gte("start_at", nowIso)
        .order("start_at", { ascending: true });
      console.log("[next-slots] ids:", userIds.length, "rows:", data?.length ?? 0, "err:", error ?? null);
      if (error) throw error;
      // 先頭ヒットが「直近の空き」。ユーザーごとに最初の1件を採用
      const rows = (data ?? []) as Array<{
        user_id: string | null; start_at: string; end_at: string;
        area_code: string | null; venue_hint: string | null;
      }>;
      const map: Record<string, PublicSlot | null> =
        Object.fromEntries(userIds.map(id => [id, null]));
      for (const row of rows) {
        const uid = row.user_id;
        if (!uid) continue; // ← null/空はスキップ（index型エラー対策）
        if (map[uid] == null) {
          map[uid] = {
            user_id: uid,
            start_at: row.start_at,
            end_at: row.end_at,
            area_code: row.area_code,
            venue_hint: row.venue_hint,
          };
        }
      }
      setNextSlotMap(map);
    } finally {
      setLoadingNextSlots(false);
    }
  }, [sb]);

  // 候補ユーザーの一覧が変わったら「直近の空き」を更新
  useEffect(() => {
    const ids = allUsers.map(u => u.user_id);
    void fetchNextSlotsForUsers(ids);
  }, [allUsers, fetchNextSlotsForUsers]);

  // ログイン後にまとめて再読込
  const reloadAppData = useCallback(async () => {
    if (!user?.id) return; // 未ログイン時はスキップ
    await Promise.allSettled([
      fetchProfiles(user.id),
      fetchSlots(user.id),
      fetchMatches(user.id),
    ]);
  }, [fetchProfiles, fetchSlots, fetchMatches, user?.id]);

  // OAuth コールバック交換＋URLクリーン（重複実行ガード＆既存セッション確認つき）
  useEffect(() => {
    let mounted = true;
    let exchanging = false; // ← 二重交換ガード
    (async () => {
      try {
        const url = new URL(window.location.href);
        // 既にセッションがある → 交換不要（戻る/再読込時の誤爆防止）
        const cur = await sb.auth.getSession();
        if (cur.data.session) {
          if (!mounted) return;
          setSession(cur.data.session);
          setUser(cur.data.session.user);
        }
        // OAuth コールバックは code の有無で判定（state が無いケースもありうる）
        const hasCode = !!url.searchParams.get("code");
        // OAuthエラーが付与されている場合は表示
        const oauthErr = url.searchParams.get("error_description") || url.searchParams.get("error");
        if (oauthErr) setMsg("Googleログイン失敗: " + decodeURIComponent(oauthErr));
        if (hasCode && !exchanging) {
          exchanging = true;
          const { data, error } = await sb.auth.exchangeCodeForSession(window.location.href);
          if (error) {
            console.error("[AUTH] exchange error:", error);
            setMsg("Googleログイン失敗: " + error.message);
          } else {
            console.log("[AUTH] exchange ok. user:", data.session?.user?.id);
          }
          url.search = "";
          window.history.replaceState({}, "", url.toString());
          await reloadAppData(); // ← この行を追加
        }
        const { data } = await sb.auth.getSession(); // 最終的なセッション確認
        if (!mounted) return;
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
        if (data.session?.user) {
          const pf = await ensureProfile(data.session.user);
          if (!mounted) return;
          hydrateFormFromProfile(pf);
          await reloadAppData();
        }
      } catch (e: unknown) { console.error("[AUTH] init error:", e); }
    })();

    const { data: sub } = sb.auth.onAuthStateChange(async (_event: AuthChangeEvent, sess: Session | null) => {
      setSession(sess);
      const u = sess?.user ?? null;
      setUser(u);
      if (u) {
        const pf = await ensureProfile(u);
        hydrateFormFromProfile(pf);
        await reloadAppData();
      } else {
        resetForm();
        setSlots([]); setAllUsers([]); setMatches([]); setActiveMatchId(null); setMessages([]);
      }
    });
    return () => { try { sub.subscription?.unsubscribe(); } catch {} mounted = false; };
  }, [sb, reloadAppData]);

  const fetchMessages = async (matchId: NonNullable<MatchRow["id"]>) => {
    const { data, error } = await sb
      .from("messages")
      .select("*")
      .eq("match_id", matchId) // ← number で検索
      .order("sent_at", { ascending: true });
    if (!error && data) {
      setMessages(data);
      // 取得時にIDセットを同期（重複防止の基準）
      const ids = new Set<string>();
      for (const m of data) if (m.id != null) ids.add(String(m.id));
      messageIdsRef.current = ids;
    }
  };

  const handleAddSlot = async () => {
    if (!user) return;
    setBusy(true); setMsg(null);
    try {
      if (!startAt || !endAt || !slotArea) { setMsg("開始/終了日時とエリアは必須です"); return; }
      if (invalidAvailRange) { setMsg("終了は開始より後の日時にしてください"); return; }
      if (pastAvailStart) { setMsg("開始日時が過去です。未来の日時を指定してください"); return; }
      const payload: SlotInsert = {
        user_id: user.id,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        area_code: slotArea,
        venue_hint: venueHint || null,
        is_recurring: !!isRecurring,
      };
      const { data, error } = await sb.from("availability_slots").insert([payload]).select().maybeSingle();
      if (error) throw error;
      if (data) {
        setSlots((prev) => [...prev, data].sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? "")));
        setStartAt(""); setEndAt(""); setSlotArea(""); setVenueHint(""); setIsRecurring(false);
        setMsg("空き時間を追加しました。");
      }
    } catch (e: unknown) { setMsg("空き時間の追加に失敗: " + toErrMsg(e)); }
    finally { setBusy(false); }
  };

  const handleDeleteSlot = async (slotId: SlotRow["id"]) => {
    if (slotId == null || !user) return;
    setBusy(true); setMsg(null);
    try {
      const { error } = await sb.from("availability_slots").delete().eq("id", slotId).eq("user_id", user.id);
      if (error) throw error;
      setSlots((prev) => prev.filter((s) => s.id !== slotId));
      setMsg("削除しました。");
    } catch (e: unknown) { setMsg("削除に失敗: " + toErrMsg(e)); }
    finally { setBusy(false); }
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setBusy(true); setMsg(null);
    try {
      // スキーマにある想定のカラムだけ（intro は送らない）
      const patch: ProfileUpdate = {
        nickname: nickname || null,
        level: typeof level === "number" ? level : level === "" ? null : Number(level),
        area_code: areaCode || null,
        gender,
        hand,
        play_style: playingStyle,
        years: typeof years === "number" ? years : years === "" ? null : Number(years),
        purpose: purpose.length ? purpose : null,
        avatar_url: avatarUrl || null,
      };
      // （列が実DBに無ければ型エラーで気付けます）
      const { data, error } = await sb
        .from("profiles")
        .update(patch)
        .eq("user_id", user.id)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (data) { hydrateFormFromProfile(data); setMsg("プロフィールを保存しました。"); toast.success("保存しました"); }
    } catch (e: unknown) { setMsg("プロフィール保存に失敗: " + toErrMsg(e)); }
    finally { setBusy(false); }
  };

  // --- Matches & Messages ---
  const [proposalStart, setProposalStart] = useState<string>("");
  const [proposalEnd, setProposalEnd] = useState<string>("");
  const [proposalVenue, setProposalVenue] = useState<string>("");
  // 未入力時にフォーカスを当てるための ref
  const proposalStartRef = useRef<HTMLInputElement | null>(null);
  const proposalEndRef   = useRef<HTMLInputElement | null>(null);
  // 提案ボタン専用の"送信中"フラグ（ユーザー単位）
  const [proposing, setProposing] = useState<Record<string, boolean>>({});
  // --- Chat peer display ---
  const [chatPeer, setChatPeer] = useState<{ user_id: string; nickname: string | null } | null>(null);

  const handleProposeMatch = async (toUserId: string) => {
    if (!user) return;
    if (!proposalStart || !proposalEnd) {
      setMsg("提案には開始/終了が必要です");
      if (!proposalStart) { toast.error("開始（提案）を入力してください"); proposalStartRef.current?.focus(); }
      else { toast.error("終了（提案）を入力してください"); proposalEndRef.current?.focus(); }
      return;
    }
    setBusy(true); setMsg(null);
    // この相手へのボタンだけを"送信中"に
    setProposing((prev) => ({ ...prev, [toUserId]: true }));
    try {
      const payload: MatchInsert = {
        user_a: user.id,
        user_b: toUserId,
        start_at: new Date(proposalStart).toISOString(),
        end_at: new Date(proposalEnd).toISOString(),
        venue_text: proposalVenue || null,
        status: "pending",
      };
      // Promise を明示的に作って toast に渡す（UI用）→ 同じ Promise を await して結果を使う
      const p = (async () => {
        const { data, error } = await sb.from("matches").insert([payload]).select().single();
        if (error) throw error;
        return data;
      })();
      toast.promise(p, {
        loading: "提案を送信中…",
        success: "提案を作成しました！",
        error: (e) => `提案に失敗しました: ${e?.message ?? e}`,
      });
      const data = await p;
      if (data) {
        setMatches((prev) => [...prev, data].sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? "")));
        setMsg("対戦提案を作成しました。");
        setActiveMatchId(data.id); // 提案直後にそのマッチを選択
        // チャットのオープンは"待たない"（UIブロック回避）
        // ノンブロッキングで呼び出し、エラーは握りつぶす
        openChat(data.id).catch(() => {});
      }
    } catch (e: unknown) { setMsg("提案の作成に失敗: " + toErrMsg(e)); }
    finally {
      setBusy(false);
      setProposing((prev) => ({ ...prev, [toUserId]: false }));
    }
  };

  // ステータス更新：useCallback で安定化（Hook依存の警告を解消）
  const handleMatchStatus = useCallback(async (matchId: MatchRow["id"], status: MatchStatus) => {
    if (!user || matchId == null) return;
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await sb
        .from("matches")
        .update({ status })
        .eq("id", matchId)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setMatches(prev => prev.map(m => m.id === matchId ? data : m));
        setMsg(`ステータスを ${status} に更新しました。`);
      }
    } catch (e: unknown) { setMsg("ステータス更新に失敗: " + toErrMsg(e)); }
    finally { setBusy(false); }
  }, [sb, user]);

  // 受信者だけ／pending だけを許可する判定（上で定義済みの MatchRow を使用）
  const me = user?.id;
  const isReceiver = useCallback(
    (m: MatchRow) => !!me && m.user_b === me,
    [me]
  );
  const canRespond = useCallback(
    (m: MatchRow) => isReceiver(m) && m.status === "pending",
    [isReceiver]
  );

  // 既存の handleMatchStatus をラップ（不正操作は即エラー）
  const respondMatch = useCallback(
    (m: MatchRow, next: "confirmed" | "cancelled") => {
      if (!canRespond(m)) {
        toast.error("承諾・辞退できるのは提案の受信者（pendingのみ）です");
        return;
      }
      // 既存の更新関数をそのまま使う
      handleMatchStatus(m.id!, next);
    },
    [canRespond, handleMatchStatus]
  );

  const openChat = async (matchId: NonNullable<MatchRow["id"]>) => {
    // 既存購読があれば解除
    try { chatChannelRef.current?.unsubscribe(); } catch {}

    setActiveMatchId(matchId);
    setChatBody("");
    await fetchMessages(matchId); // まず既存ログを取得

    // この match のメッセージ INSERT を購読
    const channel = sb
      .channel(`messages:${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` },
        (payload: RealtimePostgresChangesPayload<MessageRow>) => {
          const row = payload.new as MessageRow | null; // ← 型を明示して安全に取り出す
          if (row) {
            const id = row.id != null ? String(row.id) : null;
            if (!id || !messageIdsRef.current.has(id)) {
              if (id) messageIdsRef.current.add(id);
              setMessages((prev) => [...prev, row]);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // console.log("Subscribed chat:", matchId);
        }
      });

    chatChannelRef.current = channel;
  };


 const userId = user?.id; // ← 追加（コンポーネント内の上の方でOK）

 const handleSendMessage = useCallback(async () => {
   if (!userId || activeMatchId == null) return;
    const body = chatBodyRef.current.trim();
    if (!body) return;
    setBusy(true);
    try {
      const payload: MessageInsert = { match_id: activeMatchId, sender_id: userId, body };
      const { data, error } = await sb.from("messages").insert([payload]).select().maybeSingle();
      if (error) throw error;
      // ★ 即時表示：INSERT応答で返った行をその場で反映（Realtimeは補強用）
      if (data) {
        if (data.id != null) {
          // Realtime到着時の重複を防ぐため、先にIDを記録
          messageIdsRef.current.add(String(data.id));
        }
        setMessages((prev) => [...prev, data]);
      }
      setChatBody("");
    } catch (e: unknown) { setMsg("メッセージ送信に失敗: " + toErrMsg(e)); }
    finally { setBusy(false); }
    }, [sb, userId, activeMatchId]);  // ← 依存は userId に
  
  // Enter=送信 / Shift+Enter=改行（textarea）
  const handleChatKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  }, [handleSendMessage]);


  const handleGoogleLogin = async () => {
    try {
      setBusy(true);
      const redirectTo = process.env.NODE_ENV === "development" ? "http://localhost:3000/" : new URL("/", window.location.origin).toString();
      // 標準フロー（自動リダイレクト）に戻す
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo }  // skipBrowserRedirect は指定しない
      });
      if (error) { setMsg("Googleログイン失敗: " + error.message); }
    } catch (e: unknown) { setMsg("Googleログイン例外: " + toErrMsg(e)); }
    finally { setBusy(false); }
  };

  const handleSendMagicLink = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const emailTrim = email.trim();
      if (!emailTrim) { setMsg("メールアドレスを入力してください。"); return; }
      const redirectTo =
        process.env.NODE_ENV === "development"
          ? "http://localhost:3000/"
          : new URL("/", window.location.origin).toString();

      const { error } = await sb.auth.signInWithOtp({
        email: emailTrim,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      if (error) throw error;

      setEmailSent(true);
    } catch (e: unknown) {
      setMsg("Magic Link の送信に失敗: " + toErrMsg(e));
    } finally { setBusy(false); }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await sb.auth.signOut();

      // ローカル状態をクリア（ここはあなたの state 名に合わせて）
      setSession(null);
      setUser(null);
      setEmailSent(false);
      setMsg(null);

      // データ系のリセット（あれば）
      setMatches([]);
      setActiveMatchId(null);
      setMessages([]);
      // ほか slots / allUsers なども必要なら空に

      // 画面を確実に最新化
      router.refresh(); // app router
      // or: window.location.assign("/") でもOK
    } catch (e) {
      setMsg("ログアウトに失敗: " + toErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!userFilter) return allUsers;
    return allUsers.filter((u) =>
      (u.nickname ?? "").includes(userFilter) || (u.area_code ?? "").includes(userFilter)
    );
  }, [allUsers, userFilter]);

    // 入力の妥当性（開始>=終了）チェック
  const invalidRange = useMemo(() => {
    if (!proposalStart || !proposalEnd) return false;
    return new Date(proposalStart).getTime() >= new Date(proposalEnd).getTime();
  }, [proposalStart, proposalEnd]);

  // 表示用ユーザー（重なりのみトグルに応じてフィルタ）
  const displayUsers = useMemo(() => {
    if (!showOverlapOnly) return filteredUsers;
    if (!proposalStart || !proposalEnd) return filteredUsers;
    return filteredUsers.filter(u => {
      const ns = nextSlotMap[u.user_id] ?? null;
      return !!(ns && hasOverlap(proposalStart, proposalEnd, ns.start_at, ns.end_at));
    });
  }, [showOverlapOnly, filteredUsers, nextSlotMap, proposalStart, proposalEnd, hasOverlap]);

  // 直近スロットが全員分取得できていない（= RLSなどでゼロ件）の気づきやすさ向上
  const noNextSlotsVisible = useMemo(() => {
    if (loadingNextSlots || filteredUsers.length === 0) return false;
    return filteredUsers.every(u => !nextSlotMap[u.user_id]);
  }, [loadingNextSlots, filteredUsers, nextSlotMap]);

  useEffect(() => {
    return () => {
      try { chatChannelRef.current?.unsubscribe(); } catch {}
    };
  }, []);

    // 選択中のマッチ相手（ニックネーム）をヘッダー表示用に取得
  useEffect(() => {
    if (!user?.id || !activeMatchId) { setChatPeer(null); return; }
    const m = matches.find((mm) => mm.id === activeMatchId);
    if (!m) { setChatPeer(null); return; }
    const otherId = m.user_a === user.id ? m.user_b : m.user_a;
    if (!otherId) { setChatPeer(null); return; }
    // まずは allUsers のキャッシュから探す
    const cached = allUsers.find((u) => u.user_id === otherId);
    if (cached) { setChatPeer({ user_id: cached.user_id, nickname: cached.nickname }); return; }
    // 見つからなければ profiles を1件だけフェッチ（保険）
    let cancelled = false;
    (async () => {
      const { data } = await sb
        .from("profiles")
        .select("user_id,nickname")
        .eq("user_id", otherId)
        .maybeSingle();
      if (!cancelled) setChatPeer(data ?? { user_id: otherId, nickname: null });
    })();
    return () => { cancelled = true; };
  }, [sb, user?.id, activeMatchId, matches, allUsers]);

  useEffect(() => {
    if (!user?.id) return;

    // 依存が変わるたびに古い購読を解除
    try { matchesChannelRef.current?.unsubscribe(); } catch {}

    const ch = sb
      .channel(`matches:${user.id}`)
      .on(
        "postgres_changes",
        { schema: "public", table: "matches", event: "*" },
        (payload: RealtimePostgresChangesPayload<MatchRow>) => {
          const rowNew = payload.new as MatchRow | null;
          const rowOld = payload.old as MatchRow | null;
          const row = rowNew ?? rowOld;
          if (!row) return;

          // 自分が当事者でない行は無視
          const involvesMe = row.user_a === user.id || row.user_b === user.id;
          if (!involvesMe) return;

          setMatches((prev /*: MatchRow[] */) => {
            let next = prev.slice();

            switch (payload.eventType) {
              case "INSERT":
                if (rowNew && !next.some((m) => m.id === rowNew.id)) next.push(rowNew);
                break;
              case "UPDATE":
                if (rowNew) next = next.map((m) => (m.id === rowNew.id ? rowNew : m));
                break;
              case "DELETE":
                if (rowOld) next = next.filter((m) => m.id !== rowOld.id);
                break;
            }

            next.sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? ""));
            return next;
          });
        }
      )
      .subscribe();

    matchesChannelRef.current = ch;

    // クリーンアップ
    return () => {
      try { matchesChannelRef.current?.unsubscribe(); } catch {}
    };
  }, [sb, user?.id]);

  // 未ログイン時はグローバルmsgをクリアして、ログインカードに他セクションの文言が出ないようにする
  useEffect(() => {
    if (!user) setMsg(null);
  }, [user]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50">
      <div className="container mx-auto px-4 py-8 max-w-5xl text-gray-700">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">
          卓球練習相手マッチングアプリ（プロトタイプ）
        </h1>

      {!user ? (
        <Card className="mt-4 rounded-2xl border border-gray-100 shadow-md hover:shadow-xl transition-shadow duration-300">
          <CardHeader className="flex items-center gap-2 text-emerald-700">
            <LogIn size={20} />
            <CardTitle>ログイン</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleGoogleLogin} disabled={busy} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white">
              Googleでログイン
            </Button>
            <Separator />
            <div className="space-y-2">
              <Label>または、メールでログイン（Magic Link）</Label>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Button onClick={handleSendMagicLink} disabled={busy || !email.trim()} className="rounded-xl">
                  リンクを送る
                </Button>
              </div>
              {emailSent && <p className="text-green-600 text-sm">送信しました。メール内のリンクをクリックしてください。</p>}
            </div>

            {/* 成功時(emailSent=true)は重複させない。失敗時のみ表示 */}
            {!emailSent && msg && (
              <p className="text-red-600 text-sm whitespace-pre-wrap">{msg}</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="mt-4">
            <p><strong>ログイン中:</strong> {user.email ?? user.id}</p>
            {msg && (
              <p className={["mt-2", msg.includes("失敗") ? "text-red-600" : "text-green-700"].join(" ")}>
                {msg}
              </p>
            )}
            <Button onClick={handleLogout} disabled={busy} variant="outline" className="mt-2 rounded-xl">
              ログアウト
            </Button>
          </section>

          {/* Profile */}
          <Card className="mt-6 rounded-2xl border border-gray-100 shadow-md hover:shadow-xl transition-shadow duration-300">
            <CardHeader className="flex items-center gap-2 text-emerald-700">
              <UserCog size={20} />
              <CardTitle>プロフィール編集</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>ニックネーム</Label>
                  <Input value={nickname} onChange={(e) => setNickname(e.target.value)} />
                </div>

                <div className="space-y-1">
                  <Label>レベル（数値）</Label>
                  <Input
                    type="number"
                    value={level}
                    onChange={(e) => setLevel(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>

                <div className="space-y-1">
                  <Label>エリアコード</Label>
                  <Input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} />
                </div>

                <div className="space-y-1">
                  <Label>性別</Label>
                  <div className="flex gap-2">
                    <Select
                      value={gender ?? undefined} // null のときは undefined を渡す
                      onValueChange={(v) => setGender(v as NonNullable<Gender>)}
                    >
                      <SelectTrigger><SelectValue placeholder="未設定" /></SelectTrigger>
                      <SelectContent>
                        {/* ← 空文字の SelectItem は置かない */}
                        <SelectItem value="male">男</SelectItem>
                        <SelectItem value="female">女</SelectItem>
                        <SelectItem value="other">その他</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="secondary" onClick={() => setGender(null)}>
                      クリア
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>利き手</Label>
                  <div className="flex gap-2">
                    <Select
                      value={hand ?? undefined}
                      onValueChange={(v) => setHand(v as NonNullable<Hand>)}
                    >
                      <SelectTrigger><SelectValue placeholder="未設定" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="right">右</SelectItem>
                        <SelectItem value="left">左</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="secondary" onClick={() => setHand(null)}>
                      クリア
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>プレースタイル</Label>
                  <div className="flex gap-2">
                    <Select
                      value={playingStyle ?? undefined}
                      onValueChange={(v) => setPlayingStyle(v as NonNullable<PlayingStyle>)}
                    >
                      <SelectTrigger><SelectValue placeholder="未設定" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="shake">シェーク</SelectItem>
                        <SelectItem value="pen">ペン</SelectItem>
                        <SelectItem value="others">その他</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="secondary" onClick={() => setPlayingStyle(null)}>
                      クリア
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>経験年数（数値）</Label>
                  <Input
                    type="number"
                    value={years}
                    onChange={(e) => setYears(e.target.value === "" ? "" : Number(e.target.value))}
                  />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <Label>目的（複数選択可）</Label>
                  <PurposePicker value={purpose} onChange={setPurpose} disabled={busy} />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <Label>アバターURL</Label>
                  <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveProfile} disabled={busy} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white">
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Availability */}
          <Card className="mt-6 rounded-2xl border border-gray-100 shadow-md hover:shadow-xl transition-shadow duration-300">
            <CardHeader className="flex items-center gap-2 text-emerald-700">
              <CalendarClock size={20} />
              <CardTitle>空き時間（availability）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>開始日時</Label>
                  <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                {pastAvailStart && (
                  <div className="text-xs text-amber-600">開始が過去です。未来の日時を指定してください。</div>
                )}
                </div>
                <div className="space-y-1">
                  <Label>終了日時</Label>
                  <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
                {invalidAvailRange && (
                  <div className="text-xs text-amber-600">終了は開始より後にしてください。</div>
                )}
                </div>
                <div className="space-y-1">
                  <Label>エリアコード</Label>
                  <Input value={slotArea} onChange={(e) => setSlotArea(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>会場メモ</Label>
                  <Input value={venueHint} onChange={(e) => setVenueHint(e.target.value)} />
                </div>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
                  <span>繰り返し</span>
                </label>
              </div>
              <Button onClick={handleAddSlot} disabled={busy || invalidAvailRange || pastAvailStart} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white">
                追加
              </Button>

              <div>
                {slots.length === 0 ? (
                  <p className="text-sm text-muted-foreground mt-2">まだ登録がありません。</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">開始</th>
                        <th className="text-left py-2">終了</th>
                        <th className="text-left py-2">エリア</th>
                        <th className="text-left py-2">会場メモ</th>
                        <th className="text-left py-2">繰り返し</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {slots.map((s) => (
                        <tr key={String(s.id)} className="border-b">
                          <td className="py-2">{fmtDate(s.start_at)}</td>
                          <td className="py-2">{fmtDate(s.end_at)}</td>
                          <td className="py-2">{s.area_code}</td>
                          <td className="py-2">{s.venue_hint ?? ""}</td>
                          <td className="py-2">{s.is_recurring ? "Yes" : "No"}</td>
                          <td className="py-2">
                            <Button variant="secondary" onClick={() => handleDeleteSlot(s.id!)} disabled={busy || s.id == null}>
                              削除
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Propose & Matches */}
          <Card className="mt-6 rounded-2xl border border-gray-100 shadow-md hover:shadow-xl transition-shadow duration-300">
            <CardHeader className="flex items-center gap-2 text-emerald-700">
              <Handshake size={20} />
              <CardTitle>相手を探して提案</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label>開始（提案）</Label>
                  <Input
                    ref={proposalStartRef}
                    type="datetime-local" value={proposalStart} onChange={(e) => setProposalStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>終了（提案）</Label>
                  <Input
                    ref={proposalEndRef}
                    type="datetime-local" value={proposalEnd} onChange={(e) => setProposalEnd(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>会場候補</Label>
                  <Input value={proposalVenue} onChange={(e) => setProposalVenue(e.target.value)} />
                </div>
              </div>

              {/* 自分の空きからワンクリック反映 */}
              {slots.length > 0 && (
                <div className="rounded-md border p-2">
                  <div className="text-xs text-muted-foreground mb-1">自分の空きから提案時間に反映</div>
                  <div className="max-h-28 overflow-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {slots
                          .filter((s) => !!s.start_at && new Date(s.start_at!).getTime() >= Date.now())
                          .slice(0, 10)
                          .map((s) => (
                            <tr key={String(s.id)} className="border-b">
                              <td className="py-1">{fmtDate(s.start_at)}</td>
                              <td className="py-1">→ {fmtDate(s.end_at)}</td>
                              <td className="py-1">{s.area_code ?? "-"}</td>
                              <td className="py-1 text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setProposalStart(toLocalInput(s.start_at ?? null));
                                    setProposalEnd(toLocalInput(s.end_at ?? null));
                                    setProposalVenue(s.venue_hint ?? "");
                                  }}
                                >反映</Button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2">
                    <Button variant="secondary" size="sm" onClick={() => { setProposalStart(""); setProposalEnd(""); setProposalVenue(""); }}>クリア</Button>
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-3">
                <Input
                  placeholder="ニックネーム/エリアで絞り込み"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">候補: {filteredUsers.length}人</span>
              </div>

              <div className="max-h-56 overflow-auto border rounded-md p-2">
                <div className="mb-2 flex items-center gap-3">
                  <label className="text-sm flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={showOverlapOnly}
                      onChange={(e) => setShowOverlapOnly(e.target.checked)}
                    />
                    重なりのある相手のみ表示
                  </label>
                  {invalidRange && (
                    <span className="text-xs text-amber-600">
                      提案の「開始」は「終了」より前にしてください。
                    </span>
                  )}
                </div>
                {noNextSlotsVisible && (
                  <div className="mb-2 text-xs text-amber-600">
                    他ユーザーの「直近の空き」を取得できていません。RLSポリシー（未来スロットのSELECT許可）やデータ有無をご確認ください。
                  </div>
                )}
                {filteredUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">候補が見つかりません。</p>
                  ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">ニックネーム</th>
                        <th className="text-left py-2">エリア</th>
                        <th className="text-left py-2">直近の空き</th>
                        <th className="text-left py-2">一致</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {displayUsers.map((u) => {
                        const ns = nextSlotMap[u.user_id] ?? null;
                        const overlap =
                          !!(proposalStart && proposalEnd && ns
                            && hasOverlap(proposalStart, proposalEnd, ns.start_at, ns.end_at));
                        return (
                        <tr
                          key={u.user_id}
                          className={`border-b ${overlap ? "bg-emerald-50" : ""}`}
                          aria-label={overlap ? "重なりあり" : "重なりなし"}
                        >
                          <td className="py-2">{u.nickname ?? u.user_id.slice(0, 8)}</td>
                          <td className="py-2">{u.area_code ?? "-"}</td>
                          <td className="py-2">
                            {loadingNextSlots ? (
                              <span className="text-xs text-muted-foreground">読み込み中…</span>
                            ) : ns ? (
                              <div>
                                <div>{fmtDate(ns.start_at)} — {fmtDate(ns.end_at)}</div>
                                <div className="text-xs text-muted-foreground">
                                  {ns.area_code}{ns.venue_hint ? ` / ${ns.venue_hint}` : ""}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="py-2">
                            {proposalStart && proposalEnd ? (
                              overlap ? (
                                <span className="text-emerald-700 font-semibold">◎ 重なりあり</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )
                            ) : (
                              <span className="text-xs text-muted-foreground">（提案時間を選択）</span>
                            )}
                          </td>
                          <td className="py-2">
                          <div className="flex items-center gap-2">
                            <Button variant="outline" onClick={() => openProfileDetail(u.user_id)}>
                              詳細
                            </Button>
                            <Button
                              onClick={() => handleProposeMatch(u.user_id)}
                              disabled={
                                proposing[u.user_id] ||
                                busy ||
                                !proposalStart || !proposalEnd ||
                                invalidRange
                              }
                              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                            >                              {proposing[u.user_id] ? "送信中…" : "提案"}
                            </Button>
                          </div>
                          </td>
                        </tr>
                        );
                      })
                      }
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>

          {/* My Matches */}
          <Card className="mt-6 rounded-2xl border border-gray-100 shadow-md hover:shadow-xl transition-shadow duration-300">
            <CardHeader className="flex items-center gap-2 text-emerald-700">
              <Users size={20} />
              <CardTitle>自分のマッチ</CardTitle>
            </CardHeader>
            <CardContent>
              {matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">まだマッチがありません。</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">相手</th>
                      <th className="text-left py-2">開始</th>
                      <th className="text-left py-2">終了</th>
                      <th className="text-left py-2">会場</th>
                      <th className="text-left py-2">ステータス</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((m) => {
                      const opponentId = m.user_a === user!.id ? m.user_b : m.user_a;
                      const opponent = opponentId ? allUsers.find((u) => u.user_id === opponentId) : undefined;
                      return (
                        <tr key={String(m.id)} className="border-b">
                          <td className="py-2">{opponent?.nickname ?? (opponentId ? opponentId.slice(0, 8) : "-")}</td>
                          <td className="py-2">{fmtDate(m.start_at)}</td>
                          <td className="py-2">{fmtDate(m.end_at)}</td>
                          <td className="py-2">{m.venue_text ?? ""}</td>
                          <td className="py-2">
                            {m.status === "confirmed" && <Badge>confirmed</Badge>}
                            {m.status === "pending" && <Badge variant="secondary">pending</Badge>}
                            {m.status === "cancelled" && <Badge variant="destructive">cancelled</Badge>}
                          </td>
                          <td className="py-2 flex gap-2">
                            {canRespond(m) && (
                              <>
                                <Button
                                  variant="default"
                                  onClick={() => respondMatch(m, "confirmed")}
                                  disabled={busy || m.id == null}
                                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                                >
                                  承諾
                                </Button>

                                <Button
                                  variant="secondary"
                                  onClick={() => respondMatch(m, "cancelled")}
                                  disabled={busy || m.id == null}
                                  className="rounded-xl"
                                >
                                  辞退
                                </Button>
                              </>
                            )}
                            <Button variant="outline" onClick={() => openChat(m.id!)} disabled={busy || m.id == null} className="rounded-xl">
                              チャット
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* Chat */}
          <Card className="mt-6 rounded-2xl border border-gray-100 shadow-md hover:shadow-xl transition-shadow duration-300">
            <CardHeader className="flex items-center gap-2 text-emerald-700">
              <MessageSquare size={20} />
              <CardTitle className="flex items-center">
                チャット
                {chatPeer && (
                  <span className="ml-3 text-base font-normal text-muted-foreground">
                    相手：{chatPeer.nickname ?? chatPeer.user_id.slice(0, 8)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!activeMatchId ? (
                <p className="text-sm text-muted-foreground">マッチの「チャット」を押すと、この下にスレッドが表示されます。</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => activeMatchId != null && fetchMessages(activeMatchId)} disabled={busy} className="rounded-xl">更新</Button>
                    <Button variant="secondary" onClick={() => { try { chatChannelRef.current?.unsubscribe(); } catch {}; setActiveMatchId(null); }} disabled={busy} className="rounded-xl">閉じる</Button>
                  </div>
                  <div className="max-h-60 overflow-auto border rounded-md p-3">
                    {messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">メッセージはまだありません。</p>
                    ) : (
                      <ul className="space-y-2">
                        {messages.map((m) => (
                          <li key={String(m.id)} className="border-b pb-2">
                            <div className="text-xs text-muted-foreground">
                              {fmtDate(m.sent_at)} — {m.sender_id === user!.id ? "あなた" : "相手"}
                            </div>
                            <div>{m.body}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex gap-2">
                    <textarea
                      className="w-full min-h-[40px] max-h-40 resize-y rounded-md border px-3 py-2 text-sm outline-none"
                      placeholder="メッセージを入力…（Enterで送信 / Shift+Enterで改行）"
                      value={chatBody}
                      onChange={(e) => setChatBody(e.target.value)}
                      onKeyDown={handleChatKeyDown}
                    />
                    <Button onClick={handleSendMessage} disabled={busy || !chatBody.trim()} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white">
                      送信
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <hr className="my-6" />

      {/* 相手プロフィールの詳細ダイアログ */}
      <Dialog open={detailOpen} onOpenChange={(o) => { setDetailOpen(o); if (!o) setDetailProfile(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>相手のプロフィール</DialogTitle>
            <DialogDescription>提案前に相手の情報を確認できます。</DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-6 text-sm text-muted-foreground">読み込み中…</div>
          ) : detailProfile ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-base font-medium">
                  {detailProfile.nickname ?? "（ニックネーム未設定）"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {detailProfile.user_id.slice(0, 8)}
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-3 gap-2">
                <div className="text-muted-foreground">レベル</div>
                <div className="col-span-2">{detailProfile.level ?? "-"}</div>
                <div className="text-muted-foreground">エリア</div>
                <div className="col-span-2">{detailProfile.area_code ?? "-"}</div>
                <div className="text-muted-foreground">目的</div>
                <div className="col-span-2">
                  {detailProfile.purpose?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {detailProfile.purpose.map((p, i) => (
                        <Badge key={`${p}-${i}`} variant="secondary">{p}</Badge>
                      ))}
                    </div>
                  ) : (
                    "-"
                  )}
                </div>
                <div className="text-muted-foreground">プレースタイル</div>
                <div className="col-span-2">{jpStyle(detailProfile.play_style)}</div>
              </div>
              <Separator />
              <div>
                <div className="text-muted-foreground mb-1">自己紹介</div>
                <p className="whitespace-pre-wrap">{detailProfile.bio ?? "（未入力）"}</p>
              </div>
            </div>
          ) : (
            <div className="py-6 text-sm text-muted-foreground">プロフィールが見つかりませんでした。</div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </main>
  );
}
