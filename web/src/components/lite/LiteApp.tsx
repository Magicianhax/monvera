"use client";

// Monvera app shell — a small screen router that mirrors the design's go(screen,
// params) orchestrator (app.jsx) while wiring the REAL hooks end to end.
//
// Invest loop (Vera):
//   home → goal → thinking → plan → placing → success
//   • goal "Build my plan"  -> useInvest.allocate (POST /api/allocate)
//   • plan nudge chips        -> re-run allocate() with an adjusted riskTolerance
//   • plan "Invest $X · free" -> useInvest.invest (per-leg Arcus quotes +
//                                Permit2 signs, one sponsored UserOp); <Placing> follows real phase
//   • success                 -> confetti + holdings + Blockscout receipt
//
// Browse / own / trade (Pro depth, always available here):
//   portfolio · market → asset → trade → receipt · activity · vera
//
// Navigation keeps a small history stack so go(-1) returns to the prior screen.
// The bottom TabBar lives here (the design owns its own chrome).
import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useQueryClient } from "@tanstack/react-query";
import { useInvest } from "@/hooks/useInvest";
import { Spinner } from "./screens/primitives";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useWatchlistSync } from "@/hooks/useWatchlistSync";
import { haptic } from "@/lib/haptics";
import { TabBar, type TabId, useToast } from "@/components/design";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { HomeScreen } from "./screens/HomeScreen";
import { GoalScreen } from "./screens/GoalScreen";
import { ThinkingScreen } from "./screens/ThinkingScreen";
import { PlanScreen } from "./screens/PlanScreen";
import { ConfirmScreen } from "./screens/ConfirmScreen";
import { PlacingScreen } from "./screens/PlacingScreen";
import { SuccessScreen } from "./screens/SuccessScreen";
import { PortfolioScreen } from "./screens/PortfolioScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { MarketScreen } from "./screens/MarketScreen";
import { MoversScreen } from "./screens/MoversScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { ScreenerScreen } from "./screens/ScreenerScreen";
import { DiscoverScreen } from "./screens/DiscoverScreen";
import { AssetDetailScreen } from "./screens/AssetDetailScreen";
import { TradeScreen } from "./screens/TradeScreen";
import { ReceiptScreen } from "./screens/ReceiptScreen";
import { VeraScreen } from "./screens/VeraScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ActivityScreen } from "./screens/ActivityScreen";
import { HelpScreen } from "./screens/HelpScreen";
import { WalletScreen } from "./screens/WalletScreen";
import { SendScreen } from "./screens/SendScreen";
import { AutopilotScreen } from "./screens/AutopilotScreen";
import { SellScreen } from "./screens/SellScreen";
import { SellingScreen } from "./screens/SellingScreen";
import { SoldScreen } from "./screens/SoldScreen";
import { TokenScreen } from "./screens/TokenScreen";
import { TokenSwapSuccessScreen } from "./screens/TokenSwapSuccessScreen";
import { ScanScreen } from "./screens/ScanScreen";
import type { MonveraSwapResult } from "@/hooks/useMonveraSwap";
import type { AllocateResult } from "@/lib/invest-types";
import { useSellAll, type SellSelection } from "@/hooks/useSellAll";

gsap.registerPlugin(useGSAP);

type Screen =
  | "home"
  | "wallet"
  | "send"
  | "autopilot"
  | "goal"
  | "thinking"
  | "plan"
  | "confirm"
  | "placing"
  | "success"
  | "sellall"
  | "selling"
  | "sold"
  | "portfolio"
  | "review"
  | "market"
  | "movers"
  | "notifications"
  | "screener"
  | "discover"
  | "asset"
  | "trade"
  | "receipt"
  | "vera"
  | "settings"
  | "activity"
  | "help"
  | "token"
  | "tokendone"
  | "scan";

type Tone = "balanced" | "safer" | "bolder" | "simple";
type Params = Record<string, unknown>;

interface Route {
  screen: Screen;
  params: Params;
}

const TONE_RISK: Record<Tone, "conservative" | "balanced" | "aggressive"> = {
  balanced: "balanced",
  safer: "conservative",
  bolder: "aggressive",
  simple: "conservative",
};
const TONE_HINT: Record<Tone, string> = {
  balanced: "",
  safer: " (lean safer — protect my money first)",
  bolder: " (be bolder — I can handle bigger swings for more growth)",
  simple: " (keep it simple — just a couple of broad, easy holdings)",
};

// Which tab is highlighted for a given screen.
function tabFor(screen: Screen): TabId {
  if (screen === "portfolio" || screen === "review" || screen === "asset") return "portfolio";
  if (screen === "market") return "market";
  if (screen === "vera") return "vera";
  return "home";
}

export function LiteApp({ demoPlay = null }: { demoPlay?: "invest" | "vera" | null }) {
  const invest = useInvest();
  const sell = useSellAll();
  const { address } = useSmartAccount();
  const { notify } = useToast();
  // Keep the device-local watchlist reconciled with the server for this wallet.
  useWatchlistSync();

  const [stack, setStack] = useState<Route[]>([{ screen: "home", params: {} }]);
  const current = stack[stack.length - 1];
  const { screen, params } = current;

  const [goal, setGoal] = useState("");
  const [amount, setAmount] = useState(0);
  const [tone, setTone] = useState<Tone>("balanced");
  const [rethinking, setRethinking] = useState(false);

  // Navigation direction drives the screen transition (push / pop / fade).
  const [dir, setDir] = useState<"push" | "pop" | "fade">("fade");
  // Live edge-swipe-back drag offset.
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; active: boolean } | null>(null);

  // GSAP screen transition. The outer keyed div re-mounts on every navigation
  // (key={screen}), which is exactly when this effect re-runs. We animate ONLY
  // that outer div — the inner div carries the live swipe-back translateX and
  // pull-to-refresh translateY transforms and must stay untouched. gsap.from()
  // means that under reduced motion (no tween) the screen is simply visible.
  const screenRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const el = screenRef.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // Transform-only on push/pop (opacity on a full screen forces the whole
        // tree through compositing); short durations keep navigation snappy.
        const from =
          dir === "push" ? { x: 36 } : dir === "pop" ? { x: -26 } : { y: 8, opacity: 0 };
        gsap.from(el, {
          ...from,
          duration: dir === "fade" ? 0.22 : 0.2,
          ease: "power3.out",
          clearProps: "transform,opacity",
        });
      });
      return () => mm.revert();
    },
    { scope: screenRef, dependencies: [screen] },
  );

  const goalRef = useRef(goal);
  const amountRef = useRef(amount);
  goalRef.current = goal;
  amountRef.current = amount;

  // go(target, params) pushes a route; go(-1) pops back; tab roots reset history.
  const go = useCallback(
    (target: string | number, p: Params = {}) => {
      // Back.
      if (typeof target === "number") {
        setDir("pop");
        setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
        return;
      }
      const next = target as Screen;

      // Scan to Buy: the scanned connections ARE the plan — adopt them directly
      // (no allocate model call) and drop into the normal confirm → placing →
      // success pipeline, signed recommendation and all.
      if (target === "scanbuy") {
        const alloc = p.allocation as AllocateResult | undefined;
        const a = Number(p.amt ?? 0);
        if (!alloc || !(a > 0)) return;
        invest.adopt(alloc);
        setGoal(alloc.summary);
        setAmount(a);
        setTone("balanced");
        setDir("push");
        setStack((s) => [...s, { screen: "confirm", params: {} }]);
        return;
      }

      if (next === "thinking") {
        setDir("push");
        const g = String(p.goal ?? "");
        const a = Number(p.amt ?? 0);
        setGoal(g);
        setAmount(a);
        setTone("balanced");
        setStack((s) => [...s, { screen: "thinking", params: {} }]);
        void invest.allocate(g, a, "balanced").then((res) => {
          setStack((s) => {
            // Replace the thinking route with plan (or fall back to goal).
            const base = s.filter((r) => r.screen !== "thinking");
            return [...base, { screen: res ? "plan" : "goal", params: {} }];
          });
        });
        return;
      }

      // Tab roots / home reset the stack to a single route.
      const ROOTS: Screen[] = ["home", "portfolio", "market", "vera"];
      if (ROOTS.includes(next)) {
        setDir("fade");
        if (next === "home") invest.reset();
        setStack([{ screen: next, params: p }]);
        return;
      }

      setDir("push");
      setStack((s) => [...s, { screen: next, params: p }]);
    },
    [invest],
  );

  // Nudge Vera: re-run allocate with adjusted risk + goal hint; plan rebuilds.
  const onNudge = useCallback(
    (t: Tone) => {
      if (t === tone || rethinking) return;
      haptic.select();
      setTone(t);
      setRethinking(true);
      const adjustedGoal = goalRef.current + TONE_HINT[t];
      void invest.allocate(adjustedGoal, amountRef.current, TONE_RISK[t]).then(() => {
        setRethinking(false);
      });
    },
    [tone, rethinking, invest],
  );

  // Invest → choose how to place it (Vera signs vs approve each).
  const onInvest = useCallback(() => {
    if (!invest.allocation || !address) {
      notify("Loading your account, try again in a moment", "info");
      return;
    }
    haptic.medium();
    setDir("push");
    setStack((s) => [...s, { screen: "confirm", params: {} }]);
  }, [invest.allocation, address, notify]);

  // Placement mode chosen → run it.
  const onPlace = useCallback(
    (mode: "auto" | "manual") => {
      if (!invest.allocation || !address) return;
      setDir("push");
      setStack((s) => [...s.filter((r) => r.screen !== "confirm"), { screen: "placing", params: {} }]);
      void invest.invest(invest.allocation, amount, address, mode);
    },
    [invest, address, amount],
  );

  // Sell-all: the SellScreen builds the selections + mode, then we run it and
  // swap in the live "selling" progress screen (mirrors invest's onPlace).
  const onSellStart = useCallback(
    (selections: SellSelection[], mode: "auto" | "manual") => {
      if (selections.length === 0) return;
      sell.reset();
      setDir("push");
      setStack((s) => [...s.filter((r) => r.screen !== "sellall"), { screen: "selling", params: {} }]);
      void sell.sellAll(selections, mode);
    },
    [sell],
  );

  // Latest handlers for the demo autoplay driver (avoids stale closures).
  const goRef = useRef(go);
  goRef.current = go;
  const onInvestRef = useRef(onInvest);
  onInvestRef.current = onInvest;

  // Demo autoplay for the landing phones. Loops a scripted walkthrough; fully
  // inert in the real app (demoPlay is null) and cancels cleanly on unmount.
  useEffect(() => {
    if (!demoPlay) return;
    // Respect reduced-motion: leave the preview static instead of auto-playing.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const run = async () => {
      await wait(1400); // settle on home first
      while (!cancelled) {
        if (demoPlay === "invest") {
          goRef.current("thinking", { goal: "Grow $300, mostly big names, keep some safe", amt: 300 });
          await wait(3400);
          if (cancelled) break;
          onInvestRef.current(); // plan -> placing -> success
          await wait(3800);
          if (cancelled) break;
          await wait(2600); // dwell on the success screen
          goRef.current("home");
          await wait(2600);
        } else {
          goRef.current("vera");
          await wait(4200);
          if (cancelled) break;
          goRef.current("thinking", { goal: "Put $250 into AI companies", amt: 250 });
          await wait(3600); // watch Vera build + sign the plan
          if (cancelled) break;
          goRef.current("vera");
          await wait(3800);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [demoPlay]);

  // Liquid Glass: the specular sheen on buttons tracks the pointer.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>(".btn");
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty("--gx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      btn.style.setProperty("--gy", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Drive screen from the real invest phase.
  useEffect(() => {
    if (invest.phase === "done" && invest.success) {
      setDir("push");
      setStack((s) => {
        const base = s.filter((r) => r.screen !== "placing");
        return [...base, { screen: "success", params: {} }];
      });
    }
    if (invest.phase === "error" && screen === "placing") {
      // Invest error bounces back to the plan with the inline message.
      setDir("pop");
      setStack((s) => s.filter((r) => r.screen !== "placing"));
    }
  }, [invest.phase, invest.success, screen]);

  // Drive screen from the real sell-all phase. Gate on being ON the selling
  // screen so the completion push can't re-fire once we've moved to "sold".
  useEffect(() => {
    if (sell.phase === "done" && sell.success && screen === "selling") {
      setDir("push");
      setStack((s) => [...s.filter((r) => r.screen !== "selling"), { screen: "sold", params: {} }]);
    }
    if (sell.phase === "error" && screen === "selling") {
      if (sell.error) notify(sell.error, "info");
      setDir("pop");
      setStack((s) => s.filter((r) => r.screen !== "selling"));
    }
  }, [sell.phase, sell.success, sell.error, screen, notify]);

  // Each screen names the browser tab (e.g. "Market · Monvera").
  useEffect(() => {
    const NAMES: Record<Screen, string> = {
      home: "Your money",
      wallet: "Wallet",
      send: "Send",
      autopilot: "Autopilot",
      goal: "New plan",
      thinking: "Building your plan",
      plan: "Vera's plan",
      confirm: "Place your plan",
      placing: "Securing your investment",
      success: "Invested",
      sellall: "Sell holdings",
      selling: "Cashing out",
      sold: "Sold",
      portfolio: "What you own",
      review: "Portfolio review",
      market: "Market",
      movers: "Movers",
      notifications: "Notifications",
      screener: "Screener",
      discover: "Discover",
      asset: "Asset",
      trade: "Trade",
      receipt: "Receipt",
      vera: "Vera",
      settings: "Settings",
      activity: "Activity",
      help: "Help",
      token: "$MONVERA",
      tokendone: "$MONVERA",
      scan: "Scan to Buy",
    };
    document.title = `${NAMES[screen] ?? "Monvera"} · Monvera`;
  }, [screen]);

  const onTab = (id: TabId) => {
    haptic.select();
    if (id === "invest") go("goal");
    else go(id === "market" ? "market" : id === "portfolio" ? "portfolio" : id === "vera" ? "vera" : "home");
  };

  // Tabs visible only on the root browse screens.
  const showTabs =
    screen === "home" || screen === "portfolio" || screen === "market" || screen === "vera";

  // Pull-to-refresh (root screens): drag down from the top of the scroll to
  // refetch everything (react-query invalidate), with a springy release.
  const qc = useQueryClient();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pullY, setPullY] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef<{ y: number; engaged: boolean } | null>(null);
  const canRefresh = showTabs || screen === "wallet";

  // Left-edge swipe-to-go-back (iOS-style). Active only when there's a screen to
  // return to; vertical-dominant gestures fall through to normal scrolling. The
  // screen follows the finger live, then the pop transition completes the back.
  const canBack = stack.length > 1;
  const onTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    if (canBack && t.clientX <= 28) {
      dragRef.current = { x: t.clientX, y: t.clientY, active: false };
      return;
    }
    // Arm pull-to-refresh only when the screen's scroll sits at the very top.
    if (canRefresh && !refreshing) {
      const sc = wrapRef.current?.querySelector<HTMLElement>(".screen");
      if (sc && sc.scrollTop <= 0) pullRef.current = { y: t.clientY, engaged: false };
    }
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    const d = dragRef.current;
    if (d) {
      const dx = t.clientX - d.x;
      const dy = t.clientY - d.y;
      if (!d.active) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          dragRef.current = null; // vertical intent → let the screen scroll
          return;
        }
        d.active = true;
        setDragging(true);
      }
      setDragX(Math.max(0, Math.min(dx, 320)));
      return;
    }
    const p = pullRef.current;
    if (!p) return;
    const dy = t.clientY - p.y;
    if (!p.engaged) {
      if (dy < -4) {
        pullRef.current = null; // scrolling up — not a pull
        return;
      }
      if (dy < 12) return;
      p.engaged = true;
      setPulling(true);
    }
    // Resistance curve: the further you pull, the heavier it gets.
    setPullY(Math.min(Math.max(dy - 12, 0) * 0.45, 108));
  };
  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (d?.active && dragX > 78) {
      setDragX(0);
      go(-1);
    } else {
      setDragX(0); // snap back
    }
    // Pull release: past the threshold → hold with a spinner and refetch all data.
    const p = pullRef.current;
    pullRef.current = null;
    setPulling(false);
    if (p?.engaged) {
      if (pullY > 58) {
        haptic.medium();
        setRefreshing(true);
        setPullY(52);
        void qc.invalidateQueries();
        window.setTimeout(() => {
          setRefreshing(false);
          setPullY(0);
        }, 950);
      } else {
        setPullY(0);
      }
    }
  };

  let view: React.ReactNode;
  switch (screen) {
    case "wallet":
      view = <WalletScreen go={go} />;
      break;
    case "send":
      view = <SendScreen go={go} symbol={params.symbol as string | undefined} />;
      break;
    case "autopilot":
      view = <AutopilotScreen go={go} />;
      break;
    case "goal":
      view = <GoalScreen go={go} />;
      break;
    case "thinking":
      view = <ThinkingScreen />;
      break;
    case "plan":
      view = invest.allocation ? (
        <PlanScreen
          go={go}
          allocation={invest.allocation}
          amount={amount}
          tone={tone}
          rethinking={rethinking}
          busy={invest.busy}
          onNudge={onNudge}
          onInvest={onInvest}
        />
      ) : (
        <GoalScreen go={go} />
      );
      break;
    case "confirm":
      view = invest.allocation ? (
        <ConfirmScreen
          amount={amount}
          holdings={invest.allocation.allocations.filter((a) => a.weightPct > 0).length}
          onChoose={onPlace}
          onBack={() => go(-1)}
        />
      ) : (
        <GoalScreen go={go} />
      );
      break;
    case "placing": {
      // Ordered legs (symbol + its dollar slice) power the conveyor + queue rail.
      const legs = invest.allocation
        ? invest.allocation.allocations
            .filter((a) => a.weightPct > 0)
            .map((a) => ({ symbol: a.symbol, usd: (amount * a.weightPct) / 100 }))
        : undefined;
      view = <PlacingScreen phase={invest.phase} progress={invest.progress} legs={legs} />;
      break;
    }
    case "success":
      view = invest.success ? (
        <SuccessScreen success={invest.success} onDone={() => go("home")} />
      ) : (
        <HomeScreen go={go} />
      );
      break;
    case "sellall":
      view = <SellScreen onBack={() => go(-1)} onSell={onSellStart} />;
      break;
    case "selling":
      view = <SellingScreen progress={sell.progress} />;
      break;
    case "sold":
      view = sell.success ? (
        <SoldScreen
          success={sell.success}
          onDone={() => {
            // Land on Wallet WITHOUT leaving "sold" (or the sell-flow screens)
            // underneath — otherwise Back from Wallet returns to the receipt.
            setDir("pop");
            setStack([
              { screen: "home", params: {} },
              { screen: "wallet", params: {} },
            ]);
            sell.reset();
          }}
        />
      ) : (
        <WalletScreen go={go} />
      );
      break;
    case "portfolio":
      view = <PortfolioScreen go={go} />;
      break;
    case "review":
      view = <ReviewScreen go={go} />;
      break;
    case "market":
      view = <MarketScreen go={go} initialFilter={params.filter as string | undefined} />;
      break;
    case "movers":
      view = <MoversScreen go={go} />;
      break;
    case "notifications":
      view = <NotificationsScreen go={go} />;
      break;
    case "screener":
      view = <ScreenerScreen go={go} />;
      break;
    case "discover":
      view = <DiscoverScreen go={go} />;
      break;
    case "asset":
      view = <AssetDetailScreen go={go} symbol={String(params.symbol ?? "")} />;
      break;
    case "trade":
      view = (
        <TradeScreen
          go={go}
          symbol={String(params.symbol ?? "")}
          initialSide={params.side === "sell" ? "sell" : "buy"}
        />
      );
      break;
    case "receipt":
      view = (
        <ReceiptScreen
          go={go}
          title={params.title as string | undefined}
          amount={params.amount as number | undefined}
          txHash={params.txHash as string | undefined}
          ref={params.ref as string | undefined}
          date={params.date as string | undefined}
          kind={params.kind as "buy" | "sell" | "send" | "receive" | undefined}
          symbol={params.symbol as string | undefined}
          assetAmount={params.assetAmount as number | undefined}
          usdgAmount={params.usdgAmount as number | undefined}
          counterparty={params.counterparty as string | undefined}
          ts={params.ts as number | undefined}
          pending={params.pending as boolean | undefined}
        />
      );
      break;
    case "vera":
      view = <VeraScreen go={go} />;
      break;
    case "settings":
      view = <SettingsScreen go={go} />;
      break;
    case "activity":
      view = <ActivityScreen go={go} />;
      break;
    case "help":
      view = <HelpScreen go={go} />;
      break;
    case "token":
      view = <TokenScreen go={go} />;
      break;
    case "tokendone":
      view = <TokenSwapSuccessScreen go={go} result={params.result as MonveraSwapResult | undefined} />;
      break;
    case "scan":
      view = <ScanScreen go={go} />;
      break;
    case "home":
    default:
      view = <HomeScreen go={go} />;
  }

  return (
    <>
      <div key={screen} ref={screenRef} style={{ position: "absolute", inset: 0 }}>
        {/* pull-to-refresh indicator — fades/rotates in with the pull, spins while refreshing */}
        {pullY > 0 && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 4,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              zIndex: 70,
              opacity: Math.min(pullY / 52, 1),
              transform: `translateY(${Math.max(pullY - 36, 0)}px) rotate(${refreshing ? 0 : pullY * 2.4}deg) scale(${Math.min(0.5 + pullY / 80, 1)})`,
              transition: pulling ? "none" : "transform .5s cubic-bezier(.34,1.56,.64,1), opacity .3s var(--ease-out)",
              pointerEvents: "none",
            }}
          >
            <Spinner small />
          </div>
        )}
        <div
          ref={wrapRef}
          style={{
            position: "absolute",
            inset: 0,
            transform: dragX
              ? `translateX(${dragX}px)`
              : pullY
                ? `translateY(${pullY}px)`
                : undefined,
            // Release springs back with a slight overshoot (the bouncy feel);
            // horizontal back-swipe keeps its clean ease-out.
            transition:
              dragging || pulling
                ? "none"
                : dragX
                  ? "transform 0.3s var(--ease-out)"
                  : "transform .55s cubic-bezier(.34,1.56,.64,1)",
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={endDrag}
          onTouchCancel={endDrag}
        >
          {/* Inline error from the invest flow — surfaced on the plan/goal screens. */}
        {invest.error && (screen === "plan" || screen === "goal") && (
          <div
            role="button"
            aria-label="Dismiss error"
            className="anim-rise tap"
            style={{
              position: "absolute",
              top: 58,
              left: 16,
              right: 16,
              zIndex: 60,
              display: "flex",
              gap: 9,
              alignItems: "center",
              background: "color-mix(in srgb, var(--neg) 14%, var(--surface))",
              color: "var(--neg)",
              padding: "12px 14px",
              borderRadius: "var(--rr)",
              fontSize: 14,
              fontWeight: 500,
              boxShadow: "var(--shadow)",
              cursor: "pointer",
            }}
            onClick={invest.clearError}
          >
            {invest.error}
          </div>
        )}
          {view}
        </div>
      </div>
      {showTabs && <TabBar active={tabFor(screen)} onNav={onTab} pro />}
      <InstallPrompt />
    </>
  );
}
