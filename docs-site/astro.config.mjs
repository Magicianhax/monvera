// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightUtils from '@lorenzo_lewis/starlight-utils';

const SITE = 'https://docs.monvera.best';
const TAGLINE =
  'An AI broker for real tokenized stocks and funds on Robinhood Chain. Tell Vera a goal and an amount, she builds a diversified basket of real companies, each with a reason and a plain risk read, and one tap invests it. Gasless, non-custodial, from $1.';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  integrations: [
    starlight({
      title: 'Monvera Docs',
      description: TAGLINE,
      logo: { src: './src/assets/monvera-icon.png', alt: 'Monvera' },
      favicon: '/favicon.png',
      customCss: ['./src/styles/brand.css'],
      // Starlight ships no og:image; DocsHead adds a per-page card.
      components: { Head: './src/components/DocsHead.astro' },
      social: [{ icon: 'x.com', label: 'Monvera on X', href: 'https://x.com/monvera_best' }],
      // no "edit this page" link: the docs repo is private
      lastUpdated: true,
      plugins: [
        // Topic tabs in the header: each top-level sidebar group becomes a
        // horizontal tab, and the sidebar shows only that topic's pages.
        starlightUtils({ multiSidebar: { switcherStyle: 'horizontalList' } }),
        starlightLlmsTxt({
          projectName: 'Monvera',
          description: TAGLINE,
          details:
            'Vera is registered on-chain agent #1 and signs a risk assessment that is recorded on-chain with every trade. Not available in the US, Canada, the UK, or Switzerland. Nothing here is investment advice. Backtests are history, not promises.',
        }),
      ],
      sidebar: [
        {
          label: 'Start',
          items: [
            'start/what-monvera-is',
            'start/where-its-available',
            'start/what-you-need',
            'start/try-the-demo',
            'start/the-monvera-token',
          ],
        },
        {
          label: 'Guide',
          collapsed: true,
          items: [
            'use/make-your-first-plan',
            'use/read-your-plan',
            'use/invest-in-one-tap',
            'use/review-your-portfolio',
            'use/add-money',
            'use/buy-or-sell-a-single-stock',
            'use/tweak-a-plan-before-you-invest',
            'use/explore-whats-available',
            'use/build-a-watchlist',
            'use/use-the-screener',
            'use/set-a-price-alert',
            'use/autopilot',
            'use/set-and-revoke-autopilot-limits',
            'use/withdraw-your-money',
          ],
        },
        {
          label: 'Safety',
          collapsed: true,
          items: [
            'safety/can-i-lose-money',
            'safety/what-it-costs',
            'safety/your-account-and-recovery',
            'safety/export-your-private-key',
            'safety/is-this-investment-advice',
            'safety/backtests-are-history-not-promises',
            'safety/taxes',
            'safety/staying-safe-from-scams',
            'safety/get-help',
          ],
        },
        {
          label: 'How it works',
          collapsed: true,
          items: [
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
            'dev/quickstart',
            'dev/authenticated-quickstart',
            'dev/authentication',
            'dev/conventions',
            'dev/errors',
            'dev/verify-vera',
            'dev/network-and-addresses',
          ],
        },
        {
          label: 'API',
          collapsed: true,
          items: [{ autogenerate: { directory: 'dev/api' } }],
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
