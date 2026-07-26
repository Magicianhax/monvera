"use client";

// PublicStake — staking outside the app, for anyone.
//
// ONE way in: Privy. Its modal already covers email, Google, X *and*
// connecting an existing EOA (MetaMask, Rabby, WalletConnect…), so a separate
// "browser wallet" path was redundant plumbing. Whatever the user brings,
// useActiveWallet resolves to a single signing address: the embedded wallet if
// Monvera made one, otherwise their own EOA — never a second account, never a
// smart account created just to stake. That's the same address the app itself
// uses, so signing in here with the same email lands on the same wallet.
//
// Privy mounts HERE rather than in the root layout so marketing pages keep
// their light bundle, and with showWalletUIs on so the user's wallet shows its
// own confirmation after ours.
import Link from "next/link";
import { useState } from "react";
import { Web3Providers } from "@/components/Web3Providers";
import { CHAT_STYLE_CSS, CHAT_THEME_CSS, ChatMark, PIcon } from "@/components/chat/chatKit";
import { STAKING_CSS, StakingPanel, Z } from "@/components/staking/StakingPanel";
import { usePrivyStakingWallet } from "@/hooks/useStakingWallet";
import { SEASON_POOL, STAKING_TESTNET } from "@/lib/staking";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** Ledger radii (4-8px) and solid surfaces — see DESIGN.md. The one serif
 *  moment is the hero headline, which is brand identity, not a UI label. */
const navLink: React.CSSProperties = {
  height: 36, padding: "0 13px", borderRadius: 6, border: "1px solid var(--line)",
  display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600,
  color: "var(--ink-2)", textDecoration: "none", background: "transparent",
};

function StakeSurface() {
  const wallet = usePrivyStakingWallet({ walletUIs: true });
  const [menu, setMenu] = useState(false);
  const connected = !!wallet.address;

  const connectSlot = (
    <button
      className="mvbtn mvbtn-primary"
      onClick={wallet.login}
      disabled={!wallet.ready}
      style={{ height: 42, padding: "0 22px", borderRadius: 6, background: "var(--primary)", color: "var(--primary-ink)", fontSize: 14, fontWeight: 700, border: "1px solid transparent" }}
    >
      {wallet.ready ? "Connect" : "Loading…"}
    </button>
  );

  return (
    <div
      className="mvc mvs"
      data-mode="dark"
      data-style="emerald"
      style={{ minHeight: "100dvh", background: "var(--bg)", color: "var(--ink)", fontFamily: "var(--font-ui)", fontSize: 15 }}
    >
      <style dangerouslySetInnerHTML={{ __html: CHAT_THEME_CSS + CHAT_STYLE_CSS + STAKING_CSS }} />

      {/* ── header (solid, hairline-bottomed — no blur; see DESIGN.md Material) ── */}
      <header className="mvs-hd" style={{ position: "sticky", top: 0, zIndex: Z.sticky, display: "flex", alignItems: "center", gap: 10, padding: "13px 24px", borderBottom: "1px solid var(--line)", background: "var(--bg)" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--ink)", textDecoration: "none" }}>
          <ChatMark size={20} />
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.02em" }}>Monvera</span>
        </Link>
        {STAKING_TESTNET && (
          <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700, border: "1px solid var(--line)", color: "var(--ink-3)" }}>Testnet</span>
        )}
        <div style={{ flex: 1 }} />

        {connected ? (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setMenu((v) => !v)}
              aria-expanded={menu}
              className="tnum mvbtn mvbtn-quiet"
              style={{ ...navLink, gap: 8 }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--primary)" }} />
              {short(wallet.address!)}
              <PIcon name="ph-caret-down" size={11} weight="bold" />
            </button>
            {menu && (
              <div style={{ position: "absolute", right: 0, top: 42, zIndex: Z.dropdown, minWidth: 196, padding: 5, borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel)" }}>
                <div style={{ padding: "8px 10px", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.4 }}>
                  {wallet.embedded ? "Monvera wallet" : `Connected with ${wallet.label}`}
                </div>
                <Link href="/app" className="mvrow" style={{ display: "block", padding: "8px 10px", borderRadius: 5, fontSize: 13, fontWeight: 600, color: "var(--ink-2)", textDecoration: "none" }}>
                  Open the app
                </Link>
                {/* Never gated on `authenticated`: a user who connected their own
                    EOA was never "authenticated", so gating hid the only way out. */}
                <button
                  onClick={() => { setMenu(false); void wallet.disconnect(); }}
                  className="mvrow"
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 5, fontSize: 13, fontWeight: 600, color: "var(--ink-2)", background: "none", border: "none" }}
                >
                  {wallet.embedded ? "Sign out" : "Disconnect"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <Link href="/app" className="mvbtn mvbtn-quiet mvs-hd-app" style={navLink}>
              Open app <PIcon name="ph-arrow-up-right" size={13} weight="bold" />
            </Link>
            <button
              onClick={wallet.login}
              disabled={!wallet.ready}
              className="mvbtn mvbtn-primary"
              style={{ height: 36, padding: "0 16px", borderRadius: 6, background: "var(--primary)", color: "var(--primary-ink)", fontSize: 13, fontWeight: 700, border: "1px solid transparent" }}
            >
              {wallet.ready ? "Connect" : "Loading…"}
            </button>
          </>
        )}
      </header>

      {/* ── hero — the page's one serif moment (brand identity, not a UI label) ── */}
      <section className="mvs-wrap" style={{ maxWidth: 880, margin: "0 auto", padding: "64px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-3)" }}>
          <span style={{ width: 5, height: 5, borderRadius: 99, background: "var(--primary)" }} />
          Season 1 · {SEASON_POOL.toLocaleString()} $MONVERA · 90 epochs
        </div>
        <h1
          className="serif"
          style={{ fontSize: "clamp(36px, 5.5vw, 56px)", fontWeight: 600, letterSpacing: "-.035em", lineHeight: 1.04, margin: "14px 0 14px", textWrap: "balance" }}
        >
          Stake $MONVERA<span style={{ color: "var(--primary)" }}>.</span>
        </h1>
        {/* No ch-based measure here. 76ch resolves to ~540px against this font,
            well under the 832px column, so the copy folded into a ragged block
            with dead space beside it and split "on-chain" across lines. Letting
            it run the full column also lines its edges up with the panels. */}
        <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.65, textWrap: "pretty" }}>
          Stake $MONVERA and earn a slice of the season pool every epoch. Each epoch is 24 hours: when it closes your share is credited to your address, only ever goes up, and becomes claimable on-chain when the season ends. Stake more, hold longer, earn more.
        </p>
        {/* No CTA here — the header Connect and the one in "Your position"
            already cover it; a third button made the hero shout. */}
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 16 }}>
          Email, Google, X, or connect a wallet you already own.
        </div>
        {STAKING_TESTNET && (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 8 }}>
            Testnet only. Tokens here carry no value; this is for trying the full flow before mainnet.
          </div>
        )}
      </section>

      {/* ── the panel ── */}
      <main className="mvs-wrap" style={{ maxWidth: 880, margin: "0 auto", padding: "48px 24px 40px", minWidth: 0 }}>
        <StakingPanel wallet={wallet} connectSlot={connectSlot} />
      </main>

      {/* ── footer ── */}
      <footer style={{ borderTop: "1px solid var(--line)", marginTop: 24 }}>
        <div className="mvs-wrap" style={{ maxWidth: 880, margin: "0 auto", padding: "24px 24px 44px", display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 18, fontSize: 12.5 }}>
            {[["/groves", "Groves"], ["/app", "App"], ["/terms", "Terms"]].map(([href, label]) => (
              <Link key={href} href={href} className="mvlink" style={{ color: "var(--ink-3)", textDecoration: "none", transition: "color 160ms ease" }}>{label}</Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

export function PublicStake() {
  return (
    <Web3Providers showWalletUIs>
      <StakeSurface />
    </Web3Providers>
  );
}
