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
  const [purpose, setPurpose] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");

  // Availability state
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [startAt, setStartAt] = useState<string>("");
  const [endAt, setEndAt] = useState<string>("");
  const [slotArea, setSlotArea] = useState<string>("");
  const [venueHint, setVenueHint] = useState<string>("");
  const [isRecurring, setIsRecurring] = useState<boolean>(false);

  // Browse users for proposal
  const [allUsers, setAllUsers] = useState<ProfileRow[]>([]);
  const [userFilter, setUserFilter] = useState<string>("");

  // Matches & messages
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [activeMatchId, setActiveMatchId] = useState<MatchRow["id"] | null>(null); // ← number想定（生成型に追従）
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [chatBody, setChatBody] = useState<string>("");
  const chatChannelRef = useRef<RealtimeChannel | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  
  // 追加: メッセージIDで重複追加を防ぐ
  const messageIdsRef = useRef<Set<string>>(new Set());

  // ▼ 追加：matches の Realtime チャンネル
  const matchesChannelRef = useRef<RealtimeChannel | null>(null);

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
    setPurpose((pf.purpose ?? []).join(","));
    setAvatarUrl(pf.avatar_url ?? "");
  };
  const resetForm = () => {
    setNickname(""); setLevel(""); setAreaCode(""); setGender(null); setHand(null); setPlayingStyle(null);
    setYears(""); setPurpose(""); setAvatarUrl("");
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

  // OAuth コールバック交換＋URLクリーン
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const url = new URL(window.location.href);
        const hasCode = url.searchParams.get("code") && url.searchParams.get("state");
        if (hasCode) {
          const { error } = await sb.auth.exchangeCodeForSession(window.location.href);
          if (error) console.error("[AUTH] exchange error:", error);
          url.search = "";
          window.history.replaceState({}, "", url.toString());
        }
        const { data } = await sb.auth.getSession();
        if (!mounted) return;
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
        if (data.session?.user) {
          const pf = await ensureProfile(data.session.user);
          if (!mounted) return;
          hydrateFormFromProfile(pf);
          await Promise.all([
            fetchSlots(data.session.user.id),
            fetchProfiles(data.session.user.id),
            fetchMatches(data.session.user.id),
          ]);
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
        await Promise.all([fetchSlots(u.id), fetchProfiles(u.id), fetchMatches(u.id)]);
      } else {
        resetForm();
        setSlots([]); setAllUsers([]); setMatches([]); setActiveMatchId(null); setMessages([]);
      }
    });
    return () => { try { sub.subscription?.unsubscribe(); } catch {} mounted = false; };
  }, [sb, fetchProfiles, fetchSlots, fetchMatches]);

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
        purpose: purpose.trim() === "" ? null : purpose.split(",").map((s) => s.trim()).filter(Boolean),
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

  const handleProposeMatch = async (toUserId: string) => {
    if (!user) return;
    if (!proposalStart || !proposalEnd) {
      setMsg("提案には開始/終了が必要です");
      if (!proposalStart) { toast.error("開始（提案）を入力してください"); proposalStartRef.current?.focus(); }
      else { toast.error("終了（提案）を入力してください"); proposalEndRef.current?.focus(); }
      return;
    }
    setBusy(true); setMsg(null);
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
      }
    } catch (e: unknown) { setMsg("提案の作成に失敗: " + toErrMsg(e)); }
    finally { setBusy(false); }
  };

  const handleMatchStatus = async (matchId: MatchRow["id"], status: MatchStatus) => {
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
        setMatches((prev) => prev.map((m) => m.id === matchId ? data : m));
        setMsg(`ステータスを ${status} に更新しました。`);
      }
    } catch (e: unknown) { setMsg("ステータス更新に失敗: " + toErrMsg(e)); }
    finally { setBusy(false); }
  };

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


  const handleSendMessage = async () => {
    if (!user || activeMatchId == null || !chatBody.trim()) return;
    setBusy(true);
    try {
      const payload: MessageInsert = {
        match_id: activeMatchId as NonNullable<MessageInsert["match_id"]>, // number
        sender_id: user.id,
        body: chatBody.trim(),
        // sent_at に default があれば省略可
      };
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
  };
  
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
      const { data, error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (error) { setMsg("Googleログイン失敗: " + error.message); return; }
      if (data?.url) window.location.assign(data.url); else setMsg("ログインURLの取得に失敗しました。");
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
      setMsg("Magic Link を送信しました。メールを確認してください。");
    } catch (e: unknown) {
      setMsg("Magic Link の送信に失敗: " + toErrMsg(e));
    } finally { setBusy(false); }
  };

  const handleLogout = async () => {
    try {
      setBusy(true);
      const { error } = await sb.auth.signOut({ scope: "global" as const });
      if (error) { console.warn("[AUTH] global signOut failed, fallback to local", error); await sb.auth.signOut({ scope: "local" as const }); }
    } catch (e: unknown) { console.error("[AUTH] signOut error", e); }
    finally {
      try {
        if (typeof window !== "undefined") {
          Object.keys(window.localStorage).filter(k => k.startsWith("sb-") || k.includes("supabase") || k.includes("auth")).forEach(k => window.localStorage.removeItem(k));
        }
      } catch {}
      setSession(null); setUser(null);
      resetForm(); setSlots([]); setAllUsers([]); setMatches([]); setActiveMatchId(null); setMessages([]);
      setBusy(false);
    }
  };

  const filteredUsers = allUsers.filter((u) =>
    userFilter ? (u.nickname ?? "").includes(userFilter) || (u.area_code ?? "").includes(userFilter) : true
  );

  useEffect(() => {
    return () => {
      try { chatChannelRef.current?.unsubscribe(); } catch {}
    };
  }, []);

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

  return (
    <main style={{ maxWidth: 1100, margin: "24px auto", padding: "0 16px" }}>
      <h1>卓球練習相手マッチングアプリ（プロトタイプ）</h1>

      {!user ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>ログイン</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleGoogleLogin} disabled={busy}>Googleでログイン</Button>
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
                <Button onClick={handleSendMagicLink} disabled={busy || !email.trim()}>
                  リンクを送る
                </Button>
              </div>
              {emailSent && <p className="text-green-600 text-sm">送信しました。メール内のリンクをクリックしてください。</p>}
            </div>

            {msg && <p className="text-red-600 text-sm whitespace-pre-wrap">{msg}</p>}
          </CardContent>
        </Card>
      ) : (
        <>
          <section style={{ marginTop: 16 }}>
            <p><strong>ログイン中:</strong> {user.email ?? user.id}</p>
            {msg && <p style={{ marginTop: 8, color: msg.includes("失敗") ? "crimson" : "green" }}>{msg}</p>}
            <button onClick={handleLogout} disabled={busy} style={{ padding: "6px 10px" }}>ログアウト</button>
          </section>

          {/* Profile */}
          <Card className="mt-6">
            <CardHeader>
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
                        <SelectItem value="male">male</SelectItem>
                        <SelectItem value="female">female</SelectItem>
                        <SelectItem value="other">other</SelectItem>
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
                        <SelectItem value="right">right</SelectItem>
                        <SelectItem value="left">left</SelectItem>
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
                        <SelectItem value="shake">shake</SelectItem>
                        <SelectItem value="pen">pen</SelectItem>
                        <SelectItem value="others">others</SelectItem>
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
                  <Label>目的（カンマ区切り）</Label>
                  <Input
                    placeholder="ラリー, 試合, フットワーク練習 など"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                  />
                </div>

                <div className="md:col-span-2 space-y-1">
                  <Label>アバターURL</Label>
                  <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveProfile} disabled={busy}>保存</Button>
              </div>
            </CardContent>
          </Card>

          {/* Availability */}
          <Card className="mt-6">
            <CardHeader><CardTitle>空き時間（availability）</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>開始日時</Label>
                  <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>終了日時</Label>
                  <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
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
              <Button onClick={handleAddSlot} disabled={busy}>追加</Button>

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
          <Card className="mt-6">
            <CardHeader><CardTitle>相手を探して提案</CardTitle></CardHeader>
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

              <div className="flex items-center gap-3">
                <Input
                  placeholder="ニックネーム/エリアで絞り込み"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">候補: {filteredUsers.length}人</span>
              </div>

              <div className="max-h-56 overflow-auto border rounded-md p-2">
                {filteredUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">候補が見つかりません。</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2">ニックネーム</th>
                        <th className="text-left py-2">エリア</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.user_id} className="border-b">
                          <td className="py-2">{u.nickname ?? u.user_id.slice(0, 8)}</td>
                          <td className="py-2">{u.area_code ?? "-"}</td>
                          <td className="py-2">
                          <Button
                            onClick={() => handleProposeMatch(u.user_id)}
                            disabled={busy || !proposalStart || !proposalEnd}
                          >
                            {busy ? "送信中…" : "提案"}
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

          {/* My Matches */}
          <Card className="mt-6">
            <CardHeader><CardTitle>自分のマッチ</CardTitle></CardHeader>
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
                            {m.status === "pending" && (
                              <>
                                <Button variant="default" onClick={() => handleMatchStatus(m.id!, "confirmed")} disabled={busy || m.id == null}>承諾</Button>
                                <Button variant="secondary" onClick={() => handleMatchStatus(m.id!, "cancelled")} disabled={busy || m.id == null}>辞退</Button>
                              </>
                            )}
                            <Button variant="outline" onClick={() => openChat(m.id!)} disabled={busy || m.id == null}>チャット</Button>
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
          <Card className="mt-6">
            <CardHeader><CardTitle>チャット</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!activeMatchId ? (
                <p className="text-sm text-muted-foreground">マッチの「チャット」を押すと、この下にスレッドが表示されます。</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => activeMatchId != null && fetchMessages(activeMatchId)} disabled={busy}>更新</Button>
                    <Button variant="secondary" onClick={() => { try { chatChannelRef.current?.unsubscribe(); } catch {}; setActiveMatchId(null); }} disabled={busy}>閉じる</Button>
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
                    <Button onClick={handleSendMessage} disabled={busy || !chatBody.trim()}>送信</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <hr style={{ margin: "24px 0" }} />
    </main>
  );
}
