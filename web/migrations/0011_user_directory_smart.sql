-- The user's ERC-4337 smart account, alongside their EOA. Grove buys deliver to
-- the smart account (GroveManager keys positions on msg.sender), so the hourly
-- balance-snapshot cron needs BOTH addresses to value a user fully — snapshots
-- taken with only the EOA miss grove baskets and grove-exit USDG entirely.
--
-- The address is deterministic (CREATE2 from the EOA) but only the client
-- derives it today (lib/aa.ts), so it is reported by the client through the
-- same authed touch points that already record the EOA, never derived here.
-- NULL = not reported yet; the cron then values the EOA alone, as before.
ALTER TABLE user_directory ADD COLUMN smart_address TEXT;
