// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import starlightLlmsTxt from 'starlight-llms-txt';

const SITE = 'https://docs.monvera.best';
const TAGLINE =
  'An AI broker for real tokenized stocks and funds on Robinhood Chain. Tell Vera a goal and an amount, she builds a diversified basket of real companies, each with a reason and a plain risk read, and one tap invests it. Gasless, non-custodial, from $1.';
const DETAILS =
  'Vera is registered on-chain agent #1 and signs a risk assessment that is recorded on-chain with every trade. Not available in the US, Canada, the UK, or Switzerland. Nothing here is investment advice. Backtests are history, not promises.';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  // Two typefaces, self-hosted: Hanken Grotesk for everything you read, and
  // JetBrains Mono for anything that is a value. Documentation is meant to be
  // read straight — no display serif.
  fonts: [
    {
      name: 'Hanken Grotesk',
      cssVariable: '--font-hanken',
      provider: fontProviders.fontsource(),
      weights: [400, 500, 600, 700],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
    {
      name: 'JetBrains Mono',
      cssVariable: '--font-jetbrains',
      provider: fontProviders.fontsource(),
      weights: [400, 500],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['ui-monospace', 'monospace'],
    },
  ],
  integrations: [
    starlight({
      title: 'Monvera Docs',
      description: TAGLINE,
      logo: { src: './src/assets/monvera-icon.png', alt: 'Monvera' },
      favicon: '/favicon.png',
      // order matters: tokens define the variables the rest consume
      customCss: [
        './src/styles/tokens.css',
        './src/styles/layout.css',
        './src/styles/content.css',
        './src/styles/components.css',
        './src/styles/splash.css',
      ],
      expressiveCode: {
        themes: ['github-dark-default', 'github-light-default'],
        styleOverrides: {
          borderRadius: 'var(--mv-radius)',
          borderColor: 'var(--sl-color-gray-5)',
          borderWidth: '1px',
          codeFontFamily: 'var(--font-jetbrains)',
          codeFontSize: '0.855rem',
          codeLineHeight: '1.62',
          codePaddingBlock: '0.95rem',
          codePaddingInline: '1.1rem',
          uiFontFamily: 'var(--font-hanken)',
          frames: {
            frameBoxShadowCssValue: 'none',
            editorTabBarBackground: 'var(--sl-color-gray-6)',
            editorActiveTabIndicatorBottomColor: 'var(--sl-color-accent)',
            terminalTitlebarBackground: 'var(--sl-color-gray-6)',
          },
        },
      },
      // Starlight ships no og:image; DocsHead adds a per-page card.
      // PageTitle adds the section eyebrow + description subtitle; Sidebar
      // appends the agent entry points.
      components: {
        Head: './src/components/DocsHead.astro',
        Header: './src/components/Header.astro',
        PageTitle: './src/components/PageTitle.astro',
        Sidebar: './src/components/Sidebar.astro',
      },
      social: [{ icon: 'x.com', label: 'Monvera on X', href: 'https://x.com/monvera_best' }],
      // no "edit this page" link: the docs repo is private
      lastUpdated: true,
      plugins: [
        // (sidebar scoping is done directly in src/components/Sidebar.astro —
        // starlight-utils' hidden multiSidebar mode renders every group with
        // the last group's links)
        // Bulk text for agents that need whole pages. The INDEX Vera reads is
        // not this plugin's llms.txt — it cannot list pages (it never reads the
        // content collection), so src/pages/llms.txt.ts owns that route and
        // wins over the injected one. This keeps -small/-full and the two
        // curated sets the index links to.
        starlightLlmsTxt({
          projectName: 'Monvera',
          description: TAGLINE,
          details: DETAILS,
          // drop the "[Section titled …](#…)" line Starlight adds per heading
          customSelectors: { all: ['.sl-anchor-link'] },
          customSets: [
            {
              label: 'Using Monvera',
              paths: ['start/**', 'use/**', 'safety/**'],
              description: 'how to use the product: plans, investing, money in and out, safety',
            },
            {
              label: 'Developer and API',
              paths: ['dev/**'],
              description: 'REST API reference, auth, conventions, addresses, verifying Vera',
            },
          ],
          // keep the abridged set about the product, not the endpoint list
          exclude: ['dev/api/**'],
        }),
      ],
      sidebar: [
        {
          label: 'Start',
          items: ['start', 'start/what-monvera-is', 'start/before-you-invest', 'start/the-monvera-token'],
        },
        {
          // ordered as a first session runs: talk, read the plan, then the
          // things you reach for later
          label: 'Guide',
          collapsed: true,
          items: [
            'use',
            'use/talk-to-vera',
            'use/your-plan',
            'use/your-portfolio',
            'use/find-and-trade',
            { slug: 'use/groves', badge: { text: 'Soon', variant: 'tip' } },
            'use/money-in-and-out',
            'use/watchlist-and-alerts',
            'use/autopilot',
            'use/scan-to-buy',
          ],
        },
        {
          label: 'Safety',
          collapsed: true,
          items: [
            'safety',
            'safety/can-i-lose-money',
            'safety/what-it-costs',
            'safety/your-account-and-recovery',
            'safety/export-your-private-key',
            'safety/is-this-investment-advice',
            'safety/backtests-are-history-not-promises',
            'safety/taxes',
            'safety/scams-and-support',
          ],
        },
        {
          label: 'How it works',
          collapsed: true,
          items: [
            'how',
            'how/accountable-ai',
            'how/how-vera-decides',
            'how/where-prices-come-from',
            'how/open-strategies-and-backtests',
            'how/the-stack',
          ],
        },
        {
          label: 'Developers',
          collapsed: true,
          items: [
            'dev',
            'dev/quickstart',
            'dev/authentication',
            'dev/conventions',
            'dev/verify-vera',
            'dev/network-and-addresses',
            'dev/mcp-server',
            'dev/vera-on-okx-ai',
          ],
        },
        {
          // grouped by what you are trying to do, not alphabetically — an
          // autogenerated flat list of 23 routes is unreadable. `Auth` marks
          // the routes that need a Privy bearer token.
          label: 'API',
          collapsed: true,
          items: [
            'dev/api',
            {
              label: 'Market data',
              items: [
                'dev/api/prices',
                'dev/api/market',
                'dev/api/screener',
                'dev/api/themes',
                'dev/api/strategies',
                'dev/api/backtest',
                'dev/api/tradability',
                'dev/api/groves',
              ],
            },
            {
              label: 'Plans',
              items: [
                { slug: 'dev/api/allocate', badge: { text: 'Auth', variant: 'note' } },
                { slug: 'dev/api/quote', badge: { text: 'Auth', variant: 'note' } },
                { slug: 'dev/api/commit-plan', badge: { text: 'Auth', variant: 'note' } },
              ],
            },
            {
              // badges track the source: portfolio/activity/transactions read
              // public chain data and take no token (verified against
              // verifyRequest usage in web/src/app/api/*/route.ts)
              label: 'Your account',
              items: [
                'dev/api/portfolio',
                'dev/api/balance-history',
                'dev/api/activity',
                'dev/api/transactions',
                { slug: 'dev/api/watchlist', badge: { text: 'Auth', variant: 'note' } },
                { slug: 'dev/api/alerts', badge: { text: 'Auth', variant: 'note' } },
                { slug: 'dev/api/notifications', badge: { text: 'Auth', variant: 'note' } },
              ],
            },
            {
              label: 'Autopilot',
              items: [{ slug: 'dev/api/autopilot', badge: { text: 'Auth', variant: 'note' } }],
            },
            {
              label: 'Agent',
              items: [
                'dev/api/agent-card',
                'dev/api/vera-record',
                { slug: 'dev/api/pimlico', badge: { text: 'Auth', variant: 'note' } },
              ],
            },
          ],
        },
        {
          label: 'Reference',
          items: ['glossary'],
        },
      ],
    }),
    sitemap(),
  ],
});
