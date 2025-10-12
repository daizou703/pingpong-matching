'use client';

// page.tsx - cleaned v0.3.0 (profile fields expanded, types fixed)
import React, { useEffect, useMemo, useState } from 'react';
import { createClient, type Session, type User as SupaUser } from '@supabase/supabase-js';
import type { AuthChangeEvent } from '@supabase/supabase-js';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { MessageSquare, Filter, MapPin, Star, Clock, ArrowLeft, CheckCircle2 } from 'lucide-react';

// ---- Supabase Client（クライアント側） ----
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string | undefined;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase env is missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
}
export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '');
// simple wrapper to align with code paths expecting getSupabase
export function getSupabase() { return supabase; }

// ---- Type definitions ----
export type View = 'home' | 'detail' | 'proposal' | 'chat' | 'summary' | 'availability' | 'profile' | 'register';
export type Filters = { distance: number; levelDiff: number; times: string[]; prefs: string[] };
export type UserRow = {
  id: string;
  name: string;
  level: string;
  rating: number;
  style: string;
  years: number;
  prefs: string[];
  distanceMinWalk: number;
  slot: string;
  area: string;
  intro: string;
};

// プロフィール（拡張版）
export type ProfileRow = {
  user_id: string;
  nickname: string | null;
  level: number | null;      // 1-6
  area_code: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  hand?: 'right' | 'left' | null;
  play_style?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  years?: number | null;
  purpose?: string[] | null;
};


// 可用時間スロットの型（編集/一覧で使用）
export type SlotRow = {
  id: number;
  user_id: string;
  start_at: string; // ISO string
  end_at: string;   // ISO string
  area_code: string | null;
  venue_hint: string | null;
  is_recurring: boolean | null;
  recur_dow?: number | null;     // 0=Sun ... 6=Sat
  recur_start?: string | null;   // 'HH:MM'
  recur_end?: string | null;     // 'HH:MM'
  created_at?: string;
};

const SAMPLE_USERS: UserRow[] = [
  {
    id: 'u1',
    name: 'たろう',
    level: '中級',
    rating: 4.8,
    style: '右シェーク/ドライブ',
    years: 5,
    prefs: ['多球', 'ゲーム'],
    distanceMinWalk: 12,
    slot: '10/24 19:00-21:00',
    area: '横浜駅±5km',
    intro: '○○区で週2練習しています。台確保はお任せください。',
  },
  {
    id: 'u2',
    name: 'はなこ',
    level: '初中級',
    rating: 4.6,
    style: '右ペン/前陣速攻',
    years: 2,
    prefs: ['サーブ', '基礎'],
    distanceMinWalk: 8,
    slot: '10/27 09:00-11:00',
    area: '横浜駅±5km',
    intro: '基礎練多めでお願いします。',
  },
];

function App() {
  const [view, setView] = useState<View>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace(/^#/, '');
      const saved = window.sessionStorage.getItem('lastView') ?? '';
      const candidate = (hash || saved) as View;
      const views: View[] = ['home','detail','proposal','chat','summary','availability','profile','register'];
      if (views.includes(candidate)) return candidate;
    }
    return 'home';
  });
  const [selected, setSelected] = useState<UserRow>(SAMPLE_USERS[0]);
  const [filters, setFilters] = useState<Filters>({ distance: 5, levelDiff: 1, times: ['平日夜'], prefs: ['多球', 'ゲーム'] });
  const [proposal, setProposal] = useState({ datetime: '10/24 19:00-21:00', place: '××卓球場 第2卓', memo: 'よろしくお願いします！' });
  const [messages, setMessages] = useState<{ who: 'me' | 'partner'; text: string }[]>([
    { who: 'partner', text: '10/24 19:00-21:00 どうですか？' },
    { who: 'me', text: 'OKです。会場は××卓球場で。' },
  ]);
  const [input, setInput] = useState('');

  const [session, setSession] = useState<Session | null>(null);
  const [supaUser, setSupaUser] = useState<SupaUser | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;

    // 初期セッション復元
    (async () => {
      const { data } = await sb.auth.getSession();
      setSession(data.session);
      setSupaUser(data.session?.user ?? null);
      if (data.session?.user) await ensureProfile(data.session.user);
    })();

    // 以後の変化を購読
    const { data: sub } = sb.auth.onAuthStateChange(async (_event: AuthChangeEvent, sess: Session | null) => {
      setSession(sess);
      setSupaUser(sess?.user ?? null);

      if (sess?.user) {
        const created = await ensureProfile(sess.user);
        const fromRegister = typeof window !== 'undefined' ? window.localStorage.getItem('fromRegister') : null;

        // 新規はプロフィールへ。登録フロー経由は home。それ以外は画面維持。
        setView((prev) => {
          if (created) return 'profile';
          if (prev === 'register' || fromRegister === '1') return 'home';
          return prev;
        });

        if (fromRegister) {
          try { window.localStorage.removeItem('fromRegister'); } catch {}
        }
      } else {
    // ★ 追加：セッションが無い＝ログアウト時はホームへ
    setView('home');
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []); // ← 依存は空


  // Guard: すでにセッションがあるのに register に居続けないようにする
  useEffect(() => {
    if (session && view === 'register') setView('profile');
  }, [session, view]);

    // ★ 追加: 画面状態をURLハッシュ & sessionStorageに同期
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // URLの #hash を現在の view に合わせる（履歴を汚さない）
    const url = new URL(window.location.href);
    url.hash = view;
    window.history.replaceState(null, '', url.toString());
    // 直前の view を sessionStorage にも保持（念のため）
    try {
      window.sessionStorage.setItem('lastView', view);
    } catch {}
  }, [view]);

  // ★ 追加: 初回マウント時に #hash or sessionStorage から view を復元
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hash = window.location.hash.replace(/^#/, '');
    const saved = window.sessionStorage.getItem('lastView') ?? '';
    // 許可されている view 一覧
    const views: View[] = [
      'home', 'detail', 'proposal', 'chat', 'summary', 'availability', 'profile', 'register'
    ];

    const candidate = (hash || saved) as View;
    if (views.includes(candidate) && candidate !== view) {
      setView(candidate);
    }
  // 初回のみ
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- robust logout (with fallback) ---
  async function handleLogout() {
    try {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase not initialized');
      // Try global sign-out first (revokes refresh tokens on server)
      const { error } = await sb.auth.signOut({ scope: 'global' as const });
      if (error) {
        console.warn('global signOut failed, fallback to local', error);
        await sb.auth.signOut({ scope: 'local' as const });
      }
    } catch (e) {
      console.error('signOut error', e);
      // Hard fallback: purge local auth tokens (key format: sb-*-auth-token)
      try {
        if (typeof window !== 'undefined') {
          Object.keys(window.localStorage)
            .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
            .forEach((k) => window.localStorage.removeItem(k));
        }
      } catch {}
    } finally {
      setSession(null);
      setSupaUser(null);
      setProfile(null);
      setView('home'); // ★ 追加：必ずホームへ
    }
  }

  // 既存の ensureProfile を拡張
  async function ensureProfile(user: SupaUser): Promise<boolean> {
    const sb = getSupabase();
    if (!sb) return false;
    setLoadingProfile(true);
    let created = false;

    const { data: existing } = await sb
      .from('profiles')
      .select('user_id,nickname,level,area_code,gender,hand,play_style,bio,avatar_url,years,purpose')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!existing) {
      const seed: ProfileRow = {
        user_id: user.id,
        nickname: user.email?.split('@')[0] ?? 'no-name',
        level: 3,
        area_code: 'yokohama',
        gender: null,
        hand: null,
        play_style: null,
        bio: null,
        avatar_url: null,
        years: null,
        purpose: null,
      };
      const { data: up, error: upErr } = await sb
        .from('profiles')
        .upsert(seed, { onConflict: 'user_id' })
        .select()
        .maybeSingle();
      if (!upErr) {
        setProfile((up as ProfileRow) ?? seed);
        created = true;
      }
    } else {
      setProfile(existing as ProfileRow);
    }

    setLoadingProfile(false);
    return created;
  }

    // --- account deletion (退会) ---
  async function handleDeleteAccount() {
    if (!supaUser) return;
    if (!confirm('退会します。プロフィールと可用時間などの登録情報を削除します。よろしいですか？この操作は元に戻せません。')) return;

    const sb = getSupabase();
    try {
  // 1) 可用時間を削除
      const { error: errSlots } = await sb
        .from('availability_slots')
        .delete()
        .eq('user_id', supaUser.id);
      if (errSlots) throw errSlots;

      // 2) プロフィールを削除（自分の1件想定。存在しない可能性もあるのでそのままOK）
      const { error: errProf } = await sb
        .from('profiles')
        .delete()
        .eq('user_id', supaUser.id);
      if (errProf) throw errProf;

      // 3) ローカル状態クリア → サインアウト → ホームへ
      setProfile(null);
      await handleLogout();
      alert('退会処理が完了しました。ご利用ありがとうございました。');
      setView('home');
    } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    }
  }

  const sortedUsers = useMemo(() => SAMPLE_USERS.slice().sort((a, b) => b.rating - a.rating), []);

  const Header = (
    <div className="flex items-center justify-between p-4 border-b">
      <div className="flex items-center gap-2">
        {view !== 'home' && (
          <Button variant="ghost" size="icon" onClick={() => setView('home')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div className="font-semibold">卓球マッチング</div>
      </div>
      <div className="flex items-center gap-2">
        <Select defaultValue="yokohama">
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="エリア" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="yokohama">横浜駅±5km</SelectItem>
            <SelectItem value="shinagawa">品川駅±5km</SelectItem>
            <SelectItem value="tokyo">東京駅±5km</SelectItem>
          </SelectContent>
        </Select>
        <FilterSheet filters={filters} setFilters={setFilters} />
        <Button variant="outline" onClick={() => setView('availability')}>可用時間</Button>
        {!session ? (
          <div className="flex items-center gap-2">
            <Button onClick={() => setView('register')}>会員登録</Button>
            <LoginButtons />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{profile?.nickname ?? supaUser?.email}</Badge>
            <Button variant="secondary" onClick={() => setView('profile')}>プロフィール</Button>
            <Button onClick={handleLogout}>ログアウト</Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {Header}
      {view === 'home' && <HomeList users={sortedUsers} onOpen={(u) => { setSelected(u); setView('detail'); }} />}
      {view === 'detail' && selected && <ProfileDetail user={selected} onPropose={() => setView('proposal')} onChat={() => setView('chat')} />}
      {view === 'proposal' && <ProposalEditor proposal={proposal} setProposal={setProposal} onSend={() => setView('chat')} />}
      {view === 'chat' && (
        <ChatView
          user={selected}
          messages={messages}
          input={input}
          setInput={setInput}
          onSend={() => {
            if (!input.trim()) return;
            setMessages([...messages, { who: 'me', text: input }]);
            setInput('');
          }}
          onAgree={() => setView('summary')}
        />
      )}
      {view === 'summary' && <SummaryCard user={selected} proposal={proposal} onCalendar={() => alert('端末カレンダー登録のモック')} />}
      {view === 'availability' && <Availability onBack={() => setView('home')} supaUser={supaUser} />}
      {view === 'register' && <RegisterPage />}
      {view === 'profile' && (
        <ProfileEditor
          loading={loadingProfile}
          profile={profile}
          onSave={async (next) => {
            if (!supaUser) return;
            const { error } = await supabase.from('profiles').upsert({
              user_id: supaUser.id,
              nickname: next.nickname,
              level: next.level,
              area_code: next.area_code,
              gender: next.gender,
              hand: next.hand,
              play_style: next.play_style,
              bio: next.bio,
              avatar_url: next.avatar_url,
              years: next.years ?? null,
              purpose: next.purpose ?? null,
            });
            if (error) {
              alert('保存に失敗しました: ' + error.message);
            } else {
              setProfile((prev) => ({
                user_id: supaUser!.id,
                nickname: next.nickname ?? prev?.nickname ?? null,
                level:    next.level    ?? prev?.level    ?? null,
                area_code: next.area_code ?? prev?.area_code ?? null,
                // 既存の詳細属性は「前の値を保持」
                gender:     prev?.gender ?? null,
                hand:       prev?.hand ?? null,
                play_style: prev?.play_style ?? null,
                bio:        prev?.bio ?? null,
                avatar_url: prev?.avatar_url ?? null,
                // 新規追加の2項目も保持
                years:   prev?.years ?? null,
                purpose: prev?.purpose ?? null,
              }));
              alert('保存しました');
              setView('home');
            }
          }}
          onCancel={() => setView('home')}
          onDeleteAccount={handleDeleteAccount}
        />
      )}
    </div>
  );
}
import dynamic from 'next/dynamic';
export default dynamic(() => Promise.resolve(App), { ssr: false });

function LoginButtons() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input placeholder="メールでログイン（Magic Link）" value={email} onChange={(e) => setEmail(e.target.value)} className="w-[240px]" />
      <Button
        disabled={sending || !email}
        onClick={async () => {
          setSending(true);
          window.localStorage?.setItem('fromRegister', '1');
          const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
          setSending(false);
          if (error) alert('送信失敗: ' + error.message);
          else alert('ログイン用リンクを送信しました。メールをご確認ください。');
        }}
      >
        送信
      </Button>
      <Button
        variant="secondary"
        onClick={async () => {
          window.localStorage?.setItem('fromRegister', '1');
          const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
          if (error) alert('Googleログイン失敗: ' + error.message);
        }}
      >
        Googleでログイン
      </Button>
    </div>
  );
}

function HomeList({ users, onOpen }: { users: UserRow[]; onOpen: (u: UserRow) => void }) {
  return (
    <div className="max-w-3xl mx-auto p-4">
      <Tabs defaultValue="recommend">
        <TabsList>
          <TabsTrigger value="recommend">おすすめ</TabsTrigger>
          <TabsTrigger value="near">近い順</TabsTrigger>
          <TabsTrigger value="level">レベル近い順</TabsTrigger>
        </TabsList>
        <TabsContent value="recommend">
          <div className="grid gap-4 mt-4">
            {users.map((u: UserRow) => (
              <Card key={u.id} className="shadow-sm">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        {u.name}（{u.level}）
                        <span className="inline-flex items-center text-sm opacity-80"><Star className="h-4 w-4 mr-1" />{u.rating}</span>
                      </div>
                      <div className="text-sm opacity-80">戦型: {u.style}｜年数: {u.years}年｜目的: {u.prefs.join('・')}</div>
                      <div className="flex items-center gap-3 mt-2 text-sm">
                        <span className="inline-flex items-center"><Clock className="h-4 w-4 mr-1" />{u.slot}</span>
                        <span className="inline-flex items-center"><MapPin className="h-4 w-4 mr-1" />徒歩{u.distanceMinWalk}分</span>
                        <Badge>相性 87</Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => onOpen(u)}>詳細</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FilterSheet({ filters, setFilters }: { filters: Filters; setFilters: React.Dispatch<React.SetStateAction<Filters>> }) {
  const practiceOptions = ['多球', 'サーブ', 'ゲーム', '基礎'];
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline"><Filter className="h-4 w-4 mr-1" />フィルタ</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>フィルタ</SheetTitle>
        </SheetHeader>
        <div className="space-y-6 mt-4">
          <div>
            <div className="text-sm mb-2">距離 (km)</div>
            <Slider defaultValue={[filters.distance]} max={20} step={1} onValueChange={(v) => setFilters({ ...filters, distance: v[0] })} />
          </div>
          <div>
            <div className="text-sm mb-2">レベル差 許容</div>
            <Select value={String(filters.levelDiff)} onValueChange={(v) => setFilters({ ...filters, levelDiff: Number(v) })}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">±0</SelectItem>
                <SelectItem value="1">±1</SelectItem>
                <SelectItem value="2">±2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-sm mb-2">目的</div>
            <div className="flex gap-2 flex-wrap">
              {practiceOptions.map((p: string) => (
                <Badge
                  key={p}
                  variant={filters.prefs.includes(p) ? 'default' : 'secondary'}
                  className="cursor-pointer"
                  onClick={() => {
                    const exists = filters.prefs.includes(p);
                    setFilters({
                      ...filters,
                      prefs: exists ? filters.prefs.filter((x: string) => x !== p) : [...filters.prefs, p],
                    });
                  }}
                >
                  {p}
                </Badge>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setFilters({ distance: 5, levelDiff: 1, times: ['平日夜'], prefs: ['多球', 'ゲーム'] })}>クリア</Button>
            <Button onClick={() => (document.activeElement as HTMLElement)?.blur()}>適用</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ProfileDetail({ user, onPropose, onChat }: { user: UserRow; onPropose: () => void; onChat: () => void }) {
  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-semibold">{user.name}（{user.level}）</div>
            <div className="text-sm inline-flex items-center opacity-80"><Star className="h-4 w-4 mr-1" />{user.rating}</div>
          </div>
          <div className="text-sm opacity-80">利き手: 右 / 戦型: {user.style} / 年数: {user.years}年</div>
          <div className="text-sm">エリア: {user.area} / 目的: {user.prefs.join('・')}</div>
          <div className="text-sm">自己紹介: {user.intro}</div>
          <div className="flex gap-2 pt-2">
            <Badge variant="secondary">共通: {user.slot}</Badge>
            <Badge>相性 87</Badge>
          </div>
          <div className="flex gap-2 pt-3">
            <Button onClick={onPropose}>提案を作る</Button>
            <Button variant="secondary" onClick={onChat}><MessageSquare className="h-4 w-4 mr-1"/>チャット</Button>
          </div>
        </CardContent>
      </Card>
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="font-semibold mb-2">レビュー</div>
          <ul className="list-disc ml-5 text-sm space-y-1">
            <li>マナーが良い</li>
            <li>多球うまい</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function ChatView({ user, messages, input, setInput, onSend, onAgree }: { user: UserRow; messages: { who: 'me' | 'partner'; text: string }[]; input: string; setInput: (v: string) => void; onSend: () => void; onAgree: () => void }) {
  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="text-sm opacity-70 mb-2">相手: {user.name}（{user.level}）</div>
      <div className="border rounded-lg bg-white p-4 h-[360px] overflow-y-auto space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={m.who === 'me' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={m.who === 'me' ? 'rounded-2xl px-3 py-2 text-sm bg-gray-900 text-white' : 'rounded-2xl px-3 py-2 text-sm bg-gray-100'}>{m.text}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Input placeholder="メッセージ…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }} />
        <Button onClick={onSend}>送信</Button>
        <Button variant="secondary" onClick={onAgree}><CheckCircle2 className="h-4 w-4 mr-1"/>合意する</Button>
      </div>
    </div>
  );
}

function ProposalEditor({ proposal, setProposal, onSend }: { proposal: { datetime: string; place: string; memo: string }; setProposal: (v: { datetime: string; place: string; memo: string }) => void; onSend: () => void }) {
  return (
    <div className="max-w-xl mx-auto p-4 space-y-3">
      <div className="text-lg font-semibold">提案を作る</div>
      <div className="space-y-2">
        <div className="text-sm">日時</div>
        <Input value={proposal.datetime} onChange={(e) => setProposal({ ...proposal, datetime: e.target.value })} />
      </div>
      <div className="space-y-2">
        <div className="text-sm">場所</div>
        <Input value={proposal.place} onChange={(e) => setProposal({ ...proposal, place: e.target.value })} />
      </div>
      <div className="space-y-2">
        <div className="text-sm">メモ</div>
        <Textarea value={proposal.memo} onChange={(e) => setProposal({ ...proposal, memo: e.target.value })} />
      </div>
      <div className="pt-2">
        <Button onClick={onSend}>送信</Button>
      </div>
    </div>
  );
}

function SummaryCard({ user, proposal, onCalendar }: { user: UserRow; proposal: { datetime: string; place: string; memo: string }; onCalendar: () => void }) {
  return (
    <div className="max-w-xl mx-auto p-6">
      <Card className="shadow-sm">
        <CardContent className="p-6 text-center space-y-2">
          <CheckCircle2 className="h-8 w-8 mx-auto" />
          <div className="text-lg font-semibold">合意が成立しました！</div>
          <div className="text-sm">相手: {user.name}（{user.level}）｜相性: 87</div>
          <div className="text-sm">日時: {proposal.datetime}</div>
          <div className="text-sm">場所: {proposal.place}</div>
          <div className="flex gap-2 justify-center pt-3">
            <Button onClick={onCalendar}>端末カレンダーに追加</Button>
            <Button variant="secondary">リマインドを受け取る</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RegisterPage() {
  return (
    <div className="max-w-xl mx-auto p-6 space-y-4">
      <div className="text-xl font-semibold">会員登録</div>
      <div className="text-sm opacity-80">以下のいずれかの方法で登録できます。登録後にプロフィールを設定します。</div>
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium">登録方法</div>
          <LoginButtons />
          <div className="text-xs opacity-70">※ Google でも登録できます。Magic Link はメールに届くリンクをクリックして完了します。</div>
        </CardContent>
      </Card>
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-2 text-xs opacity-70">
          <div>・登録後は「プロフィール編集」画面が開きます。ニックネーム/レベル/エリアを設定してください。</div>
          <div>・利用規約/プライバシーポリシーに同意のうえご利用ください。</div>
        </CardContent>
      </Card>
    </div>
  );
}

function Availability({ onBack, supaUser }: { onBack: () => void; supaUser: SupaUser | null }) {
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // 追加/編集フォーム用のローカル状態
  const [start, setStart] = useState<string>(''); // datetime-local
  const [end, setEnd] = useState<string>('');
  const [area, setArea] = useState<string>('yokohama');
  const [venue, setVenue] = useState<string>('');

  // 編集行の管理
  const [editId, setEditId] = useState<number | null>(null);
  const [editStart, setEditStart] = useState<string>('');
  const [editEnd, setEditEnd] = useState<string>('');
  const [editArea, setEditArea] = useState<string>('yokohama');
  const [editVenue, setEditVenue] = useState<string>('');

  useEffect(() => {
    if (!supaUser?.id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('availability_slots')
        .select('id,user_id,start_at,end_at,area_code,venue_hint,is_recurring,created_at')
        .eq('user_id', supaUser.id)
        .order('start_at', { ascending: true });
      if (error) console.error('load slots error', error);
      setSlots((data ?? []) as SlotRow[]);
      setLoading(false);
    })();
  }, [supaUser?.id]); // ★ ここを supaUser から supaUser?.id に

  // 表示用
  function fmt(dt: string) {
    if (!dt) return '';
    const d = new Date(dt);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${dd} ${hh}:${mm}`;
  }
  // ISO -> input(datetime-local)
  function toInput(dt: string) {
    if (!dt) return '';
    const d = new Date(dt);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${dd}T${hh}:${mm}`;
  }

  async function addSlot() {
    if (!supaUser) { alert('ログインしてください'); return; }
    if (!start || !end) { alert('開始/終了を入力してください'); return; }
    const startIso = new Date(start).toISOString();
    const endIso = new Date(end).toISOString();
    if (new Date(endIso) <= new Date(startIso)) { alert('終了は開始より後にしてください'); return; }

    setSaving(true);
    const { data, error } = await supabase
      .from('availability_slots')
      .insert({
        user_id: supaUser.id,
        start_at: startIso,
        end_at: endIso,
        area_code: area,
        venue_hint: venue || null,
        is_recurring: false,
      })
      .select();
    setSaving(false);

    if (error) { alert('追加に失敗: ' + error.message); return; }
    setSlots([...(slots ?? []), ...(data as SlotRow[])]);
    setStart(''); setEnd(''); setVenue('');
  }

  async function removeSlot(id: number) {
    if (!confirm('このスロットを削除しますか？')) return;
    const { error } = await supabase.from('availability_slots').delete().eq('id', id);
    if (error) { alert('削除に失敗: ' + error.message); return; }
    setSlots(slots.filter(s => s.id !== id));
  }

  function beginEdit(s: SlotRow) {
    setEditId(s.id);
    setEditStart(toInput(s.start_at));
    setEditEnd(toInput(s.end_at));
    setEditArea(s.area_code ?? 'yokohama');
    setEditVenue(s.venue_hint ?? '');
  }
  function cancelEdit() {
    setEditId(null);
    setEditStart('');
    setEditEnd('');
    setEditArea('yokohama');
    setEditVenue('');
  }
  async function saveEdit() {
    if (!supaUser || editId === null) return;
    if (!editStart || !editEnd) { alert('開始/終了を入力してください'); return; }
    const startIso = new Date(editStart).toISOString();
    const endIso = new Date(editEnd).toISOString();
    if (new Date(endIso) <= new Date(startIso)) { alert('終了は開始より後にしてください'); return; }

    setSaving(true);
    const { error } = await supabase
      .from('availability_slots')
      .update({
        start_at: startIso,
        end_at: endIso,
        area_code: editArea,
        venue_hint: editVenue || null,
      })
      .eq('id', editId);
    setSaving(false);

    if (error) { alert('更新に失敗: ' + error.message); return; }
    setSlots(slots.map(s => s.id === editId ? { ...s, start_at: startIso, end_at: endIso, area_code: editArea, venue_hint: editVenue || null } : s));
    cancelEdit();
  }

  if (!supaUser) {
    return (
      <div className="max-w-xl mx-auto p-4 space-y-4">
        <div className="text-lg font-semibold">可用時間</div>
        <div className="text-sm text-red-600">ログインすると可用時間を編集できます。</div>
        <div><Button onClick={onBack}>戻る</Button></div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <div className="text-lg font-semibold">可用時間</div>

      {/* 追加フォーム */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-medium">スロットを追加</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs mb-1">開始</div>
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <div className="text-xs mb-1">終了</div>
              <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div>
              <div className="text-xs mb-1">エリア</div>
              <Select value={area} onValueChange={(v) => setArea(v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yokohama">横浜駅±5km</SelectItem>
                  <SelectItem value="shinagawa">品川駅±5km</SelectItem>
                  <SelectItem value="tokyo">東京駅±5km</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-xs mb-1">会場メモ</div>
              <Input placeholder="○○卓球場 第2卓 など" value={venue} onChange={(e) => setVenue(e.target.value)} />
            </div>
          </div>
          <div className="pt-1">
            <Button onClick={addSlot} disabled={saving}>追加</Button>
          </div>
        </CardContent>
      </Card>

      {/* 一覧＋編集 */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="text-sm font-medium mb-2">登録済みスロット</div>
          {loading ? (
            <div>読み込み中...</div>
          ) : slots.length === 0 ? (
            <div className="text-sm opacity-70">まだ登録がありません</div>
          ) : (
            <div className="space-y-2">
              {slots.map((s) => (
                <div key={s.id} className="border rounded-lg p-2 bg-white">
                  {editId === s.id ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                      <div>
                        <div className="text-xs mb-1">開始</div>
                        <Input type="datetime-local" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                      </div>
                      <div>
                        <div className="text-xs mb-1">終了</div>
                        <Input type="datetime-local" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
                      </div>
                      <div>
                        <div className="text-xs mb-1">エリア</div>
                        <Select value={editArea} onValueChange={(v) => setEditArea(v)}>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="yokohama">横浜駅±5km</SelectItem>
                            <SelectItem value="shinagawa">品川駅±5km</SelectItem>
                            <SelectItem value="tokyo">東京駅±5km</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <div className="text-xs mb-1">会場メモ</div>
                        <Input value={editVenue} onChange={(e) => setEditVenue(e.target.value)} />
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={saveEdit} disabled={saving}>保存</Button>
                        <Button variant="secondary" onClick={cancelEdit}>キャンセル</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="text-sm">
                        <div>{fmt(s.start_at)} - {fmt(s.end_at)}</div>
                        <div className="opacity-70">エリア: {s.area_code ?? '-'}／会場: {s.venue_hint ?? '-'}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">ID {s.id}</Badge>
                        <Button variant="secondary" onClick={() => beginEdit(s)}>編集</Button>
                        <Button variant="secondary" onClick={() => removeSlot(s.id)}>削除</Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="pt-2">
        <Button onClick={onBack}>戻る</Button>
      </div>
    </div>
  );
}

// 拡張版プロフィールエディタ
function ProfileEditor({
  loading,
  profile,
  onSave,
  onCancel,
  onDeleteAccount,
}: {
  loading: boolean;
  profile: ProfileRow | null;
  onSave: (p: {
    nickname: string | null;
    level: number | null;
    area_code: string | null;
    gender?: 'male' | 'female' | 'other' | null;
    hand?: 'right' | 'left' | null;
    play_style?: string | null;
    bio?: string | null;
    avatar_url?: string | null;
    years?: number | null;
    purpose?: string[] | null;
  }) => void;
  onCancel: () => void;
  onDeleteAccount?: () => void;
}) {

  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [level, setLevel] = useState<number>(profile?.level ?? 3);
  const [area, setArea] = useState<string>(profile?.area_code ?? 'yokohama');
  const [years, setYears] = useState<number>(profile?.years ?? 0);
  const [purpose, setPurpose] = useState<string[]>(profile?.purpose ?? []);
  const practiceOptions = ['多球', 'サーブ', 'ゲーム', '基礎'];

  // 追加フィールド（空文字は使わず 'unset' を採用）
  const [gender, setGender] = useState<'unset' | 'male' | 'female' | 'other'>(
    (profile?.gender ?? 'unset') as 'unset' | 'male' | 'female' | 'other'
  );
  const [hand, setHand] = useState<'unset' | 'right' | 'left'>(
    (profile?.hand ?? 'unset') as 'unset' | 'right' | 'left'
  );
  const [playStyle, setPlayStyle] = useState<string>(profile?.play_style ?? 'unset');
  const [bio, setBio] = useState<string>(profile?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string>(profile?.avatar_url ?? '');

  useEffect(() => {
    setNickname(profile?.nickname ?? '');
    setLevel(profile?.level ?? 3);
    setArea(profile?.area_code ?? 'yokohama');
    setGender((profile?.gender ?? 'unset') as 'unset' | 'male' | 'female' | 'other');
    setHand((profile?.hand ?? 'unset') as 'unset' | 'right' | 'left');
    setPlayStyle(profile?.play_style ?? 'unset');
    setBio(profile?.bio ?? '');
    setAvatarUrl(profile?.avatar_url ?? '');
    setYears(profile?.years ?? 0);
    setPurpose(profile?.purpose ?? []);
  }, [profile]);

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <div className="text-lg font-semibold">プロフィール編集</div>
      {loading ? (
        <div>読み込み中…</div>
      ) : (
        <>
          {/* 基本 */}
          <div className="space-y-2">
            <div className="text-sm">ニックネーム</div>
            <Input value={nickname ?? ''} onChange={(e) => setNickname(e.target.value)} />
          </div>

          <div className="space-y-2">
            <div className="text-sm">レベル（1 最弱 〜 6 最強）</div>
            <Select value={String(level)} onValueChange={(v) => setLevel(Number(v))}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="6">6</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-sm">活動エリア</div>
            <Select value={area} onValueChange={(v) => setArea(v)}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yokohama">横浜駅±5km</SelectItem>
                <SelectItem value="shinagawa">品川駅±5km</SelectItem>
                <SelectItem value="tokyo">東京駅±5km</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* 追加フィールド */}
          <div className="space-y-2">
            <div className="text-sm">性別</div>
            <Select
              value={gender}
              onValueChange={(v) => setGender(v as 'unset' | 'male' | 'female' | 'other')}
            >
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="未設定" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">未設定</SelectItem>
                <SelectItem value="male">男性</SelectItem>
                <SelectItem value="female">女性</SelectItem>
                <SelectItem value="other">その他</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-sm">利き手</div>
            <Select
              value={hand}
              onValueChange={(v) => setHand(v as 'unset' | 'right' | 'left')}
            >
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="未設定" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">未設定</SelectItem>
                <SelectItem value="right">右</SelectItem>
                <SelectItem value="left">左</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-sm">戦型</div>
            <Select value={playStyle} onValueChange={(v) => setPlayStyle(v)}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="未設定" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">未設定</SelectItem>
                <SelectItem value="shake_drive">シェーク/ドライブ</SelectItem>
                <SelectItem value="pen_fast">ペン/前陣速攻</SelectItem>
                <SelectItem value="chopper">カットマン</SelectItem>
                <SelectItem value="two_wing">両ハンドドライブ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* ここまでが既存: 活動エリア */}

          {/* 追加1: 卓球経験年数 */}
          <div className="space-y-2">
            <div className="text-sm">卓球歴（年数）</div>
            <div className="flex items-center gap-3">
              <Select
                value={String(years)}
                onValueChange={(v) => setYears(Number(v))}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 年（はじめたばかり）</SelectItem>
                  <SelectItem value="1">1 年</SelectItem>
                  <SelectItem value="2">2 年</SelectItem>
                  <SelectItem value="3">3 年</SelectItem>
                  <SelectItem value="4">4 年</SelectItem>
                  <SelectItem value="5">5 年</SelectItem>
                  <SelectItem value="6">6 年</SelectItem>
                  <SelectItem value="7">7 年</SelectItem>
                  <SelectItem value="8">8 年</SelectItem>
                  <SelectItem value="9">9 年</SelectItem>
                  <SelectItem value="10">10 年以上</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs opacity-70">※ ざっくりでOK</div>
            </div>
          </div>

          {/* 追加2: 目的（複数選択可） */}
          <div className="space-y-2">
            <div className="text-sm">目的（複数選択可）</div>
            <div className="flex gap-2 flex-wrap">
              {practiceOptions.map((p) => {
                const active = purpose.includes(p);
                return (
                  <Badge
                    key={p}
                    variant={active ? 'default' : 'secondary'}
                    className="cursor-pointer"
                    onClick={() =>
                      setPurpose((prev) =>
                        prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
                      )
                    }
                  >
                    {p}
                  </Badge>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm">自己紹介（最大500文字）</div>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 500))}
              placeholder="例：週2回練習。ゲーム/多球歓迎。台の確保可など"
            />
            <div className="text-xs opacity-60 text-right">{bio.length}/500</div>
          </div>

          <div className="space-y-2">
            <div className="text-sm">プロフィール画像（URL）</div>
            <Input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="例：https://..."
            />
            <div className="text-xs opacity-60">※ 画像アップロードは後で実装予定。まずは URL で表示します。</div>
          </div>

          {/* アクション */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={() =>
                onSave({
                  nickname,
                  level,
                  area_code: area,
                  gender: gender === 'unset' ? null : gender,
                  hand: hand === 'unset' ? null : hand,
                  play_style: playStyle === 'unset' ? null : playStyle,
                  bio: bio || null,
                  avatar_url: avatarUrl || null,
                  // ↓↓↓ 足す（stateが無ければ profile?.years / profile?.purpose を使ってOK）
                  years: typeof years === 'number' ? years : (profile?.years ?? null),
                  purpose: Array.isArray(purpose) ? purpose : (profile?.purpose ?? null),
                })
              }
            >
              保存
            </Button>
            <Button variant="secondary" onClick={onCancel}>キャンセル</Button>
          </div>

          {onDeleteAccount && (
            <div className="pt-3">
              <Button variant="destructive" onClick={onDeleteAccount}>
                退会する（データ削除）
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
