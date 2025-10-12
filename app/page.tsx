"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { User, Session, AuthChangeEvent, RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { Tables, TablesInsert, TablesUpdate } from "@/types/supabase";

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
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Magic Link
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  // Profile form state
  const [nickname, setNickname] = useState<string>("");
  const [level, setLevel] = useState<number | "">("");
  const [areaCode, setAreaCode] = useState<string>("");
  const [gender, setGender] = useState<Gender | "">("");
  const [hand, setHand] = useState<Hand | "">("");
  const [playingStyle, setPlayingStyle] = useState<PlayingStyle | "">("");
  const [years, setYears] = useState<number | "">("");
  const [purpose, setPurpose] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [profileColumns, setProfileColumns] = useState<string[]>([]); // 存在列の検出用（将来の互換保持）

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
          setProfile(pf);
          setProfileColumns(Object.keys(pf));
          hydrateFormFromProfile(pf);
          await Promise.all([fetchSlots(data.session.user), fetchProfiles(data.session.user), fetchMatches(data.session.user)]);
        }
      } catch (e) { console.error("[AUTH] init error:", e); }
    })();

    const { data: sub } = sb.auth.onAuthStateChange(async (_event: AuthChangeEvent, sess: Session | null) => {
      setSession(sess);
      const u = sess?.user ?? null;
      setUser(u);
      if (u) {
        const pf = await ensureProfile(u);
        setProfile(pf);
        setProfileColumns(Object.keys(pf));
        hydrateFormFromProfile(pf);
        await Promise.all([fetchSlots(u), fetchProfiles(u), fetchMatches(u)]);
      } else {
        setProfile(null); setProfileColumns([]); resetForm();
        setSlots([]); setAllUsers([]); setMatches([]); setActiveMatchId(null); setMessages([]);
      }
    });
    return () => { try { sub.subscription?.unsubscribe(); } catch {} mounted = false; };
  }, [sb]);

  const hydrateFormFromProfile = (pf: ProfileRow) => {
    setNickname(pf.nickname ?? "");
    setLevel((pf.level as number | null) ?? "");
    setAreaCode(pf.area_code ?? "");
    setGender(pf.gender ?? "");
    setHand(pf.hand ?? "");
    setPlayingStyle(pf.play_style ?? "");
    setYears((pf.years as number | null) ?? "");
    setPurpose((pf.purpose ?? []).join(","));
    setAvatarUrl(pf.avatar_url ?? "");
  };
  const resetForm = () => {
    setNickname(""); setLevel(""); setAreaCode(""); setGender(""); setHand(""); setPlayingStyle("");
    setYears(""); setPurpose(""); setAvatarUrl("");
  };

  const fetchProfiles = async (u: User) => {
    const { data, error } = await sb.from("profiles").select("*").neq("user_id", u.id).limit(50);
    if (!error && data) setAllUsers(data);
  };

  const fetchSlots = async (u: User) => {
    const { data, error } = await sb
      .from("availability_slots").select("*").eq("user_id", u.id).order("start_at", { ascending: true });
    if (!error && data) setSlots(data);
  };

  const fetchMatches = async (u: User) => {
    const { data, error } = await sb
      .from("matches")
      .select("*")
      .or(`user_a.eq.${u.id},user_b.eq.${u.id}`)
      .order("start_at", { ascending: true });
    if (!error && data) setMatches(data);
  };

  const fetchMessages = async (matchId: NonNullable<MatchRow["id"]>) => {
    const { data, error } = await sb
      .from("messages")
      .select("*")
      .eq("match_id", matchId) // ← number で検索
      .order("sent_at", { ascending: true });
    if (!error && data) setMessages(data);
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
    } catch (e: any) { setMsg("空き時間の追加に失敗: " + (e?.message ?? String(e))); }
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
    } catch (e: any) { setMsg("削除に失敗: " + (e?.message ?? String(e))); }
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
        gender: (gender as Gender) || null,
        hand: (hand as Hand) || null,
        play_style: (playingStyle as PlayingStyle) || null,
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
      if (data) { setProfile(data); setProfileColumns(Object.keys(data as any)); hydrateFormFromProfile(data); setMsg("プロフィールを保存しました。"); }
    } catch (e: any) { setMsg("プロフィール保存に失敗: " + (e?.message ?? String(e))); }
    finally { setBusy(false); }
  };

  // --- Matches & Messages ---
  const [proposalStart, setProposalStart] = useState<string>("");
  const [proposalEnd, setProposalEnd] = useState<string>("");
  const [proposalVenue, setProposalVenue] = useState<string>("");

  const handleProposeMatch = async (toUserId: string) => {
    if (!user) return;
    if (!proposalStart || !proposalEnd) { setMsg("提案には開始/終了が必要です"); return; }
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
      const { data, error } = await sb.from("matches").insert([payload]).select().maybeSingle();
      if (error) throw error;
      if (data) {
        setMatches((prev) => [...prev, data].sort((a, b) => (a.start_at ?? "").localeCompare(b.start_at ?? "")));
        setMsg("対戦提案を作成しました。");
      }
    } catch (e: any) { setMsg("提案の作成に失敗: " + (e?.message ?? String(e))); }
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
    } catch (e: any) { setMsg("ステータス更新に失敗: " + (e?.message ?? String(e))); }
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
        (payload) => {
          setMessages((prev) => [...prev, payload.new as MessageRow]);
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
      if (data) {
        setMessages((prev) => [...prev, data]);
        setChatBody("");
      }
    } catch (e: any) { setMsg("メッセージ送信に失敗: " + (e?.message ?? String(e))); }
    finally { setBusy(false); }
  };

  const handleGoogleLogin = async () => {
    try {
      setBusy(true);
      const redirectTo = process.env.NODE_ENV === "development" ? "http://localhost:3000/" : new URL("/", window.location.origin).toString();
      const { data, error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
      if (error) { setMsg("Googleログイン失敗: " + error.message); return; }
      if (data?.url) window.location.assign(data.url); else setMsg("ログインURLの取得に失敗しました。");
    } catch (e: any) { setMsg("Googleログイン例外: " + (e?.message ?? String(e))); }
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
    } catch (e: any) {
      setMsg("Magic Link の送信に失敗: " + (e?.message ?? String(e)));
    } finally { setBusy(false); }
  };

  const handleLogout = async () => {
    try {
      setBusy(true);
      const { error } = await sb.auth.signOut({ scope: "global" as const });
      if (error) { console.warn("[AUTH] global signOut failed, fallback to local", error); await sb.auth.signOut({ scope: "local" as const }); }
    } catch (e) { console.error("[AUTH] signOut error", e); }
    finally {
      try {
        if (typeof window !== "undefined") {
          Object.keys(window.localStorage).filter(k => k.startsWith("sb-") || k.includes("supabase") || k.includes("auth")).forEach(k => window.localStorage.removeItem(k));
        }
      } catch {}
      setSession(null); setUser(null); setProfile(null); setProfileColumns([]);
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

  return (
    <main style={{ maxWidth: 1100, margin: "24px auto", padding: "0 16px" }}>
      <h1>卓球マッチング Webプロト — Stage 3: Matches & Messages</h1>

      {!user ? (
        <section style={{ marginTop: 16 }}>
          <p>ログインしてください。</p>

          {/* OAuth */}
          <button onClick={handleGoogleLogin} disabled={busy} style={{ padding: "8px 12px" }}>
            Googleでログイン
          </button>

          {/* Magic Link */}
          <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 8 }}>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>または、メールでログイン（Magic Link）</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ flex: 1 }}
              />
              <button onClick={handleSendMagicLink} disabled={busy || !email.trim()} style={{ padding: "8px 12px" }}>
                リンクを送る
              </button>
            </div>
            {emailSent && <div style={{ marginTop: 8, color: "#0a0" }}>送信しました。メール内のリンクをクリックしてください。</div>}
          </div>

          {msg && <p style={{ marginTop: 8, color: "crimson", whiteSpace: "pre-wrap" }}>{msg}</p>}
        </section>
      ) : (
        <>
          <section style={{ marginTop: 16 }}>
            <p><strong>ログイン中:</strong> {user.email ?? user.id}</p>
            {msg && <p style={{ marginTop: 8, color: msg.includes("失敗") ? "crimson" : "green" }}>{msg}</p>}
            <button onClick={handleLogout} disabled={busy} style={{ padding: "6px 10px" }}>ログアウト</button>
          </section>

          {/* Profile */}
          <section style={{ marginTop: 24, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <h2 style={{ marginTop: 0 }}>プロフィール編集</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column" }}>ニックネーム
                <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>レベル（数値）
                <input type="number" value={level} onChange={(e) => setLevel(e.target.value === "" ? "" : Number(e.target.value))} />
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>エリアコード
                <input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>性別
                <select value={gender as string | ""} onChange={(e) => setGender((e.target.value || "") as Gender | "")}>
                  <option value="">未設定</option><option value="male">male</option><option value="female">female</option><option value="other">other</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>利き手
                <select value={hand as string | ""} onChange={(e) => setHand((e.target.value || "") as Hand | "")}>
                  <option value="">未設定</option><option value="right">right</option><option value="left">left</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>プレースタイル
                <select value={playingStyle as string | ""} onChange={(e) => setPlayingStyle((e.target.value || "") as PlayingStyle | "")}>
                  <option value="">未設定</option><option value="shake">shake</option><option value="pen">pen</option><option value="others">others</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>経験年数（数値）
                <input type="number" value={years} onChange={(e) => setYears(e.target.value === "" ? "" : Number(e.target.value))} />
              </label>
              <label style={{ gridColumn: "1 / span 2", display: "flex", flexDirection: "column" }}>目的（カンマ区切り）
                <input placeholder="ラリー, 試合, フットワーク練習 など" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
              </label>
              <label style={{ gridColumn: "1 / span 2", display: "flex", flexDirection: "column" }}>アバターURL
                <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
              </label>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button onClick={handleSaveProfile} disabled={busy} style={{ padding: "8px 12px" }}>保存</button>
            </div>
          </section>

          {/* Availability */}
          <section style={{ marginTop: 24, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <h2 style={{ marginTop: 0 }}>空き時間（availability）</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column" }}>開始日時
                <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>終了日時
                <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>エリアコード
                <input value={slotArea} onChange={(e) => setSlotArea(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>会場メモ
                <input value={venueHint} onChange={(e) => setVenueHint(e.target.value)} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />繰り返し
              </label>
            </div>
            <div style={{ marginTop: 12 }}>
              <button onClick={handleAddSlot} disabled={busy} style={{ padding: "8px 12px" }}>追加</button>
            </div>
            <div style={{ marginTop: 16 }}>
              {slots.length === 0 ? <p>まだ登録がありません。</p> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>開始</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>終了</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>エリア</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>会場メモ</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>繰り返し</th>
                    <th style={{ borderBottom: "1px solid #ddd" }}></th>
                  </tr></thead>
                  <tbody>
                    {slots.map((s) => (
                      <tr key={String(s.id)}>
                        <td style={{ padding: 6 }}>{fmtDate(s.start_at)}</td>
                        <td style={{ padding: 6 }}>{fmtDate(s.end_at)}</td>
                        <td style={{ padding: 6 }}>{s.area_code}</td>
                        <td style={{ padding: 6 }}>{s.venue_hint ?? ""}</td>
                        <td style={{ padding: 6 }}>{s.is_recurring ? "Yes" : "No"}</td>
                        <td style={{ padding: 6 }}>
                          <button onClick={() => handleDeleteSlot(s.id!)} disabled={busy || s.id == null}>削除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* Propose & Matches */}
          <section style={{ marginTop: 24, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <h2 style={{ marginTop: 0 }}>相手を探して提案</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <label style={{ display: "flex", flexDirection: "column" }}>開始（提案）
                <input type="datetime-local" value={proposalStart} onChange={(e)=>setProposalStart(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>終了（提案）
                <input type="datetime-local" value={proposalEnd} onChange={(e)=>setProposalEnd(e.target.value)} />
              </label>
              <label style={{ display: "flex", flexDirection: "column" }}>会場候補
                <input value={proposalVenue} onChange={(e)=>setProposalVenue(e.target.value)} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input placeholder="ニックネーム/エリアで絞り込み" value={userFilter} onChange={(e)=>setUserFilter(e.target.value)} />
              <span style={{ color: "#666" }}>候補: {filteredUsers.length}人</span>
            </div>
            <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
              {filteredUsers.length === 0 ? <p>候補が見つかりません。</p> : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>ニックネーム</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>エリア</th>
                    <th style={{ borderBottom: "1px solid #ddd" }}></th>
                  </tr></thead>
                  <tbody>
                    {filteredUsers.map(u => (
                      <tr key={u.user_id}>
                        <td style={{ padding: 6 }}>{u.nickname ?? u.user_id.slice(0,8)}</td>
                        <td style={{ padding: 6 }}>{u.area_code ?? "-"}</td>
                        <td style={{ padding: 6 }}>
                          <button onClick={()=>handleProposeMatch(u.user_id)} disabled={busy}>提案</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* My Matches */}
          <section style={{ marginTop: 24, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <h2 style={{ marginTop: 0 }}>自分のマッチ</h2>
            {matches.length === 0 ? <p>まだマッチがありません。</p> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>相手</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>開始</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>終了</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>会場</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 6 }}>ステータス</th>
                  <th style={{ borderBottom: "1px solid #ddd" }}></th>
                </tr></thead>
                <tbody>
                  {matches.map(m => {
                    const opponentId = m.user_a === user!.id ? m.user_b : m.user_a; // string | null の可能性
                    const opponent = opponentId ? allUsers.find(u => u.user_id === opponentId) : undefined;
                    return (
                      <tr key={String(m.id)}>
                        <td style={{ padding: 6 }}>{opponent?.nickname ?? (opponentId ? opponentId.slice(0,8) : "-")}</td>
                        <td style={{ padding: 6 }}>{fmtDate(m.start_at)}</td>
                        <td style={{ padding: 6 }}>{fmtDate(m.end_at)}</td>
                        <td style={{ padding: 6 }}>{m.venue_text ?? ""}</td>
                        <td style={{ padding: 6 }}>{m.status}</td>
                        <td style={{ padding: 6, display: "flex", gap: 6 }}>
                          {m.status === "pending" && (
                            <>
                              <button onClick={()=>handleMatchStatus(m.id!, "confirmed")} disabled={busy || m.id == null}>承諾</button>
                              <button onClick={()=>handleMatchStatus(m.id!, "cancelled")} disabled={busy || m.id == null}>辞退</button>
                            </>
                          )}
                          <button onClick={()=>openChat(m.id!)} disabled={busy || m.id == null}>チャット</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* Chat */}
          <section style={{ marginTop: 24, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
            <h2 style={{ marginTop: 0 }}>チャット</h2>
            {!activeMatchId ? (
              <p>マッチの「チャット」を押すと、この下にスレッドが表示されます。</p>
            ) : (
              <div>
                <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
                  <button onClick={()=>activeMatchId != null && fetchMessages(activeMatchId)} disabled={busy}>更新</button>
                  <button onClick={()=>{ try { chatChannelRef.current?.unsubscribe(); } catch {}; setActiveMatchId(null); }} disabled={busy}>閉じる</button>
                </div>
                <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
                  {messages.length === 0 ? <p>メッセージはまだありません。</p> : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                      {messages.map((m) => (
                        <li key={String(m.id)} style={{ padding: "6px 0", borderBottom: "1px dashed #eee" }}>
                          <div style={{ fontSize: 12, color: "#666" }}>{fmtDate(m.sent_at)} — {m.sender_id === user!.id ? "あなた" : "相手"}</div>
                          <div>{m.body}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <input value={chatBody} onChange={(e)=>setChatBody(e.target.value)} placeholder="メッセージを入力…" style={{ flex: 1 }} />
                  <button onClick={handleSendMessage} disabled={busy || !chatBody.trim()}>送信</button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      <hr style={{ margin: "24px 0" }} />
      <p style={{ color: "#555" }}>※ Stage 3：matches/messages を使った提案＆チャット。RLS は「自分が当事者の match と messages のみ」読み書きできる想定です。</p>
    </main>
  );
}
