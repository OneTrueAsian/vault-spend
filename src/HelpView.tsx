import { Fragment, ReactNode, useState } from "react";

/** One filterable unit of help content. `tags` drives search — always
 * include the entry's own visible name/heading among them (so searching
 * "dashboard" still finds the Dashboard tab bullet) plus enough synonyms
 * that a search doesn't have to guess the exact wording used on the page. */
type HelpEntry = {
  tags: string[];
  node: ReactNode;
};

function matchesQuery(tags: string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return tags.some((tag) => tag.toLowerCase().includes(q));
}

// "Getting started" and "Importing transactions"/"Bulk setup-data
// import/export" are each a single ordered walkthrough — splitting them
// into individually-filterable steps would let search show "step 3"
// without "step 1 and 2", which reads as broken instructions. Each of
// those stays one whole-card entry instead; only the list-style sections
// below (independent, any-order items) filter at the individual-item level.

const GETTING_STARTED: HelpEntry = {
  tags: ["getting started", "onboarding", "first steps", "new user", "add account", "set up budget"],
  node: (
    <ol>
      <li>
        <strong>Add an account</strong> — from the Accounts tab
        ("Add account…"), or you'll be prompted automatically the first
        time you import a file. Checking, savings, credit card, loan,
        investment, and "other" are all supported.
      </li>
      <li>
        <strong>Get your transactions in</strong>, either by importing a
        CSV from your bank (see below) or entering them by hand in
        Transactions.
      </li>
      <li>
        <strong>Set up your budget</strong> in the Budget tab — add a
        monthly amount per category, grouped as Income / Fixed / Flexible /
        Non-Monthly.
      </li>
      <li>
        From there, the Dashboard and Cash Flow tabs summarize everything
        automatically — there's nothing else to configure.
      </li>
    </ol>
  ),
};

const TAB_TOUR_ENTRIES: HelpEntry[] = [
  {
    tags: [
      "dashboard",
      "net worth",
      "insights",
      "budget alerts",
      "spending",
      "what changed",
      "customize",
      "pin widget",
      "add widget",
      "pin account",
      "pin goal",
      "pin investment",
      "layout",
      "save layout",
      "custom layout",
      "named layout",
      "bills focus",
      "investor focus",
      "quick actions",
      "get started",
      "checklist",
      "ask the vault",
    ],
    node: (
      <li>
        <strong>Dashboard</strong> — a row of <strong>Quick
        actions</strong> (add a transaction or account, jump to Budget or
        Goals) sits above net worth, cash, debt, and investments at a
        glance (click any of the four for a breakdown of{" "}
        <strong>what changed</strong> and which accounts drove it), this
        month's spending by category, recent transactions, and an{" "}
        <strong>Insights</strong> feed that surfaces things worth a look on
        its own: a category on pace to go over budget, a month-over-month
        jump, an unusually large charge — and good news too, like a
        category you meaningfully cut back on. The layout is yours:
        pin/unpin widgets, drag to reorder, or use{" "}
        <strong>"+ Add widget…"</strong> to pin one specific account, goal,
        or investment account, not just the fixed catalog. Pick a built-in
        preset — Default, Bills Focus, Investor Focus — from the{" "}
        <strong>Layout</strong> dropdown, or, once you've customized the
        layout yourself, <strong>"+ Save as…"</strong> to name and keep
        your own arrangement right alongside them — switch back to it any
        time from the same dropdown, or delete it when you no longer need
        it. New here also see a <strong>Get started</strong> checklist and
        the <strong>Ask the Vault</strong> question box (see FAQ below).
      </li>
    ),
  },
  {
    tags: [
      "accounts",
      "net worth",
      "assets",
      "liabilities",
      "what changed",
      "account type",
      "credit",
      "loan",
      "investment",
      "institution",
    ],
    node: (
      <li>
        <strong>Accounts</strong> — every account grouped by type (cash,
        credit, loan, investment, other), with running totals for Total
        Assets, Total Liabilities, and Net Worth — click any of those for a
        breakdown of <strong>what changed</strong> and which accounts drove
        it. Add, edit, or delete an account here, including its
        institution, last-4 digits, and which family member it belongs to.
      </li>
    ),
  },
  {
    tags: ["ledger", "transactions", "filter", "split", "tag", "bulk tag", "debt payment", "family member", "manage family members"],
    node: (
      <li>
        <strong>Transactions</strong> — every transaction, filterable by
        account/category/tag/family member, with inline category
        correction and tagging — either one at a time or, after selecting
        several rows, in bulk — splitting a transaction across multiple
        categories, applying a payment toward a debt account, and — for
        households tracking more than one person — assigning any account,
        transaction, goal, asset, or recurring item to a family member
        via <strong>"Manage family members…"</strong>.
      </li>
    ),
  },
  {
    tags: ["budget", "budgeted", "actual", "drag", "reorder", "category"],
    node: (
      <li>
        <strong>Budget</strong> — this month's budgeted vs. actual per
        category, with prev/next month navigation and reordering (drag a
        row, or use the ↑/↓ buttons next to it). Click any category name to
        see every transaction behind that number and fix any that are
        miscategorized, right from that screen.
      </li>
    ),
  },
  {
    tags: [
      "goals",
      "savings goal",
      "target amount",
      "contribution",
      "icon",
      "color",
      "auto-contribute",
      "sinking fund",
      "family member",
    ],
    node: (
      <li>
        <strong>Goals</strong> — savings goals with a target amount/date,
        optionally linked to an account and, for households, a family
        member, with a running total and contribution history. Pick a
        custom <strong>icon</strong> and <strong>color</strong> for each
        one, and set an optional <strong>"Auto-contribute
        monthly"</strong> amount for something like insurance or gifts
        that only comes due once a year (see FAQ).
      </li>
    ),
  },
  {
    tags: ["cash flow", "income", "expenses", "forecast", "debt payoff planner", "top categories", "top merchants", "year over year"],
    node: (
      <li>
        <strong>Cash Flow</strong> — income vs. expenses over a 3 or 6
        month window (with an optional year-over-year comparison); click a
        bar to see that month's spending by category and any unusually
        large charges. "Top categories"/"Top merchants" below are scoped to
        a single month (defaulting to the current one, with a picker to
        look back further) and show a month-over-month trend per category.
        Further down, a <strong>Forecast</strong> projects your
        checking/savings balance 30, 60, or 90 days out, and the{" "}
        <strong>Debt Payoff Planner</strong> shows how fast your credit
        cards and loans clear under a snowball or avalanche strategy.
      </li>
    ),
  },
  {
    tags: ["recurring", "bills", "subscriptions", "suggested"],
    node: (
      <li>
        <strong>Recurring</strong> — a maintained list of recurring
        bills/income, each showing its next expected date and editable in
        place. A <strong>Suggested</strong> section above it auto-detects
        merchant/amount pairs in your transactions that look recurring but aren't
        tracked yet, so you can add them with one click instead of typing
        them in by hand.
      </li>
    ),
  },
  {
    tags: [
      "investments",
      "holdings",
      "shares",
      "cost basis",
      "gain loss",
      "what changed",
      "goal projection",
      "live prices",
      "stocks",
      "alpha vantage",
      "finnhub",
      "twelve data",
    ],
    node: (
      <li>
        <strong>Investments</strong> — holdings per account (shares, price,
        cost basis) with computed value and gain/loss. Click{" "}
        <strong>"Total gain/loss"</strong> or <strong>"Today's
        gain/loss"</strong> to see which holdings are driving it. Also
        includes a <strong>goal projection</strong> calculator that
        projects a future balance from a starting amount, a monthly
        contribution, and an assumed annual return. Prices are manual by
        default; optionally turn on live pricing (Settings tab) to
        auto-fill a new holding's price by symbol and keep existing ones
        current automatically.
      </li>
    ),
  },
  {
    tags: [
      "household",
      "family",
      "spending by person",
      "income by person",
      "net worth by person",
      "budget by person",
      "unassigned",
    ],
    node: (
      <li>
        <strong>Household</strong> — spending and income broken down by
        family member for whichever month you're viewing, net worth by
        person (always as of today — it isn't a monthly figure the way the
        cards above it are), and a budget grid split by category and
        person. Anything not assigned to a specific person lands under
        "Unassigned" — see the Transactions tab's <strong>"Manage family
        members…"</strong> to start attributing accounts and transactions.
      </li>
    ),
  },
  {
    tags: ["reports", "net worth", "property", "valuables", "csv", "pdf", "setup import", "savings rate", "goals overview"],
    node: (
      <li>
        <strong>Reports</strong> — total saved, all-time income, spending
        by tag, a savings-rate trend, <strong>Property &
        Valuables</strong> (manually tracked assets like a home or a
        vehicle, folded into your net worth), net worth by family member,
        quick summaries linking back to Goals and Budget, and the CSV/PDF
        export and setup-data import/export tools described below. Account
        balances and net worth by <em>account</em> live on the Accounts tab
        instead.
      </li>
    ),
  },
  {
    tags: [
      "settings",
      "profiles",
      "data file",
      "backups",
      "live stock prices",
      "move data file",
      "appearance",
      "theme",
      "dark mode",
      "light mode",
      "slate",
      "futuristic",
    ],
    node: (
      <li>
        <strong>Settings</strong> — separate profiles (completely
        independent data files you can create, switch, rename, and delete
        — see FAQ), where your data file lives (and a button to move it),
        your backup history with a manual "Back up now" and per-backup
        restore, an optional live stock-price integration for the
        Investments tab, and <strong>appearance</strong>: Light/Dark/System
        plus two visual styles — Slate and Futuristic (see FAQ).
      </li>
    ),
  },
];

const IMPORTING_ENTRY: HelpEntry = {
  tags: ["import", "csv", "ofx", "qfx", "qif", "bank", "duplicate", "auto-categorized"],
  node: (
    <>
      <p>
        From the <strong>Transactions</strong> tab, click <strong>"Import
        transactions…"</strong>:
      </p>
      <ol>
        <li>
          Pick which account the file belongs to (or create a new one on
          the spot).
        </li>
        <li>
          Choose the file exported from your bank or credit card — CSV,
          OFX/QFX, or QIF are all supported.
        </li>
        <li>
          Confirm which way the amounts go. Vault Spend's convention is
          <em> negative = money out</em> for a checking/savings/investment
          account; if your file shows charges as positive numbers (common
          for credit card exports), choose "Flip the signs" — otherwise
          "Keep as-is." For a credit card or loan account specifically,
          the convention is the other way around — a payment is
          <em> positive</em> (it reduces what's owed) and a charge or new
          debt is negative — so check a payment row's sign in the preview
          before confirming.
        </li>
        <li>
          You'll see a preview of every row before anything is saved. Rows
          that look like duplicates of something already in your transactions are
          unchecked by default (see the FAQ below) — check or uncheck any
          row, or override which account a specific row should land in.
        </li>
        <li>
          Confirm the import. Each new transaction is auto-categorized
          where possible; anything it can't confidently place is left
          Uncategorized for you to set yourself.
        </li>
      </ol>
    </>
  ),
};

const BULK_SETUP_ENTRY: HelpEntry = {
  tags: [
    "bulk",
    "setup template",
    "csv",
    "excel",
    "accounts",
    "categories",
    "budgets",
    "goals",
    "holdings",
    "investments",
    "import setup data",
  ],
  node: (
    <>
      <p>
        If you'd rather set up accounts, categories, budgets, goals, and
        investment holdings in bulk instead of one at a time through the
        UI, use the two buttons on the <strong>Reports</strong> tab:
      </p>
      <ul>
        <li>
          <strong>"Download setup template…"</strong> saves one CSV file
          with a section for each of Accounts / Categories / Budgets /
          Goals / Holdings, with one example row in each section to show
          the expected columns. Opens and saves fine in Excel.
        </li>
        <li>
          Open it, delete the example rows, fill in your own (keep the
          section titles and column headers as they are), and save.
        </li>
        <li>
          <strong>"Import setup data…"</strong> reads the file back in and
          shows you a review screen — anything that already exists is
          flagged, and you choose what to actually apply before anything is
          written.
        </li>
        <li>A blank "Period" on a budget row defaults to the current month.</li>
        <li>
          A Holdings row's Account must match an existing account's name
          exactly (case-insensitive) — a row whose account isn't found is
          flagged on the review screen and skipped, not partially created.
        </li>
      </ul>
    </>
  ),
};

const EXPORT_ENTRIES: HelpEntry[] = [
  {
    tags: ["export", "csv", "reports"],
    node: (
      <li>
        <strong>"Export CSV…"</strong> (Reports tab) exports whatever rows
        are currently visible/filtered.
      </li>
    ),
  },
  {
    tags: ["export", "pdf", "print"],
    node: (
      <li>
        <strong>"Print / Save as PDF…"</strong> opens your system print
        dialog against the current Reports view — choose "Save as PDF" as
        the destination if you want a file instead of a physical printout.
      </li>
    ),
  },
];

type FaqEntry = {
  question: string;
  tags: string[];
  answer: ReactNode;
};

const FAQ_ENTRIES: FaqEntry[] = [
  {
    question: "Is my data private?",
    tags: ["privacy", "data", "local", "cloud", "security", "offline", "account"],
    answer: (
      <p>
        Yes. Everything is stored in one file on your own computer, created
        fresh the first time you launch the app. There's no account, no
        server, and nothing is ever uploaded — a fresh install on someone
        else's computer starts completely empty, never with your data.
      </p>
    ),
  },
  {
    question: 'I got a "Windows protected your PC" warning — is this safe?',
    tags: ["windows", "smartscreen", "warning", "install", "security", "unsigned"],
    answer: (
      <p>
        That's Windows SmartScreen, and it appears because this installer
        isn't signed with a certificate Microsoft already recognizes — it
        doesn't mean anything is actually wrong. Click "More info," then
        "Run anyway."
      </p>
    ),
  },
  {
    question: "Will I get a reminder before a bill is due?",
    tags: ["reminder", "notification", "bill", "recurring", "due date", "alert"],
    answer: (
      <p>
        If a recurring bill (Recurring tab) is due within 3 days, Vault
        Spend shows a native Windows notification — but only when you
        actually open the app. This isn't a background reminder service; it
        doesn't run, and can't notify you, while the app is closed.
      </p>
    ),
  },
  {
    question: "What happens if I import the same file twice?",
    tags: ["import", "duplicate", "fingerprint", "csv", "re-import"],
    answer: (
      <p>
        Every transaction is fingerprinted from its date, description,
        amount, and account. An exact repeat is flagged as a likely
        duplicate in the import preview and left unchecked by default, so
        re-importing the same statement won't create doubled entries unless
        you explicitly check it back in.
      </p>
    ),
  },
  {
    question: "How does auto-categorization work?",
    tags: ["categorization", "category", "rules", "learning", "classifier", "auto", "uncategorized"],
    answer: (
      <p>
        New transactions are matched against rules first — an exact
        merchant match, or a pattern Vault Spend has learned from a category
        you've corrected before. Once you've made at least 10 corrections, a
        lightweight classifier also kicks in for transactions the rules
        don't cover. Anything neither can confidently place is left
        Uncategorized rather than guessing — setting it yourself teaches the
        app for next time.
      </p>
    ),
  },
  {
    question: "How does Vault Spend suggest recurring items?",
    tags: ["recurring", "suggested", "bills", "subscriptions", "auto-detect"],
    answer: (
      <p>
        The Recurring tab's "Suggested" section looks for a merchant and
        amount that's repeated at least 3 times on a roughly consistent
        schedule (weekly, biweekly, monthly, or annual) but isn't tracked
        yet. Add it with one click to start it, or dismiss it if it's not
        actually recurring — a dismissed suggestion won't reappear.
      </p>
    ),
  },
  {
    question: "Can I fix a transaction's category after the fact?",
    tags: ["category", "correct", "fix", "recategorize", "bulk edit"],
    answer: (
      <p>
        Yes, several ways: the category dropdown on any Transactions row;
        selecting several rows and using the Transactions tab's bulk-edit bar to
        recategorize them all at once; or, from the Budget page, clicking a
        category name to see every transaction behind that month's number
        and fixing any of them right there (individually or in bulk).
      </p>
    ),
  },
  {
    question: "How do budgets carry forward month to month?",
    tags: ["budget", "carry forward", "monthly", "rollover", "cap"],
    answer: (
      <p>
        A new month starts from whatever the closest earlier month had set
        for each category, so you don't need to re-enter every line every
        month. Changing the current month's amount never changes a past
        month's numbers. This copy happens the first time you open a given
        month — so if you browse ahead to a future month before finishing
        your edits (amount, group, or the 90% "Cap" toggle) in the current
        one, that future month locks in whatever the current month looked
        like at that moment and won't retroactively pick up later changes.
        Finish editing the current month first, then move forward.
      </p>
    ),
  },
  {
    question: "What does a goal's \"Auto-contribute monthly\" do?",
    tags: ["auto-contribute", "sinking fund", "goal", "monthly", "automatic", "insurance", "gifts"],
    answer: (
      <p>
        It turns the goal into a sinking fund for an irregular annual cost —
        insurance, gifts, an annual subscription — that's easier to save for
        a little at a time than all at once. The next time you open the app
        after a new calendar month starts, Vault Spend logs that amount as a
        contribution automatically (you'll see a one-time notice naming
        which goal(s) it applied to) — at most once per goal per month, and
        independently of any manual contribution you also log that month,
        so the two never skip or double up on each other.
      </p>
    ),
  },
  {
    question: "Can I split one transaction across multiple categories?",
    tags: ["split", "transaction", "categories"],
    answer: (
      <p>
        Yes — the Transactions tab's "Split →" control on any transaction lets you
        divide it into as many category/amount lines as you need, each with
        an optional note.
      </p>
    ),
  },
  {
    question: "Does it support credit cards and loans, not just checking/savings?",
    tags: ["credit card", "loan", "debt", "account types", "balance"],
    answer: (
      <p>
        Yes — each account type tracks its balance the way that type
        actually works: a credit card's balance is available credit, a
        loan's is what's still owed, and a checking/savings/investment/other
        account's is a literal balance. For both credit and loan accounts,
        a payment is entered as a <em>positive</em> amount and reduces what's
        owed; a charge or new borrowing is negative and increases it — the
        same convention for both account types.
      </p>
    ),
  },
  {
    question: "How is the cash-flow forecast calculated?",
    tags: ["forecast", "cash flow", "projection", "trend"],
    answer: (
      <p>
        It's based on your actual history, not your listed recurring bills:
        it takes your average daily net cash flow (income minus spending)
        over roughly the last 90 days and projects that trend forward from
        your current checking/savings balance. It's meant to answer "am I
        trending up or down," not to predict any specific upcoming bill.
      </p>
    ),
  },
  {
    question: "Can I exclude a debt from the payoff planner?",
    tags: ["debt", "payoff", "exclude", "snowball", "avalanche", "planner"],
    answer: (
      <p>
        Yes — uncheck "Include" on that debt's row. It's meant for something
        like a credit card you pay off in full every month, which isn't
        really debt to pay down and would otherwise distort the plan.
      </p>
    ),
  },
  {
    question: "Does net worth include my property and valuables?",
    tags: ["net worth", "assets", "property", "valuables", "trend chart"],
    answer: (
      <p>
        Yes — whatever you've entered under Property & Valuables (Reports
        tab) is included in the current net worth figure everywhere it's
        shown. One caveat on the Dashboard's net worth <em>trend</em>{" "}
        chart specifically: since a manual asset only carries a value as of
        today, past points on that chart apply today's value throughout
        rather than tracking what it was actually worth back then.
      </p>
    ),
  },
  {
    question: "Can I save my own Dashboard layout?",
    tags: ["dashboard", "layout", "save layout", "custom layout", "named layout", "preset", "customize", "delete layout"],
    answer: (
      <p>
        Yes — customize the layout (pin/unpin widgets, drag to reorder,
        or "+ Add widget…" to pin a specific account/goal/investment
        account) until the Layout dropdown shows "Custom (unsaved)," then
        click <strong>"+ Save as…"</strong> and give it a name. It's saved
        right alongside the built-in Default/Bills Focus/Investor Focus
        presets — pick it from the same dropdown any time to switch back,
        or select it and click <strong>"Delete"</strong> to remove it.
        Saving under a name you've already used replaces that layout
        rather than creating a second copy.
      </p>
    ),
  },
  {
    question: "How do automatic backups work, and can I restore one?",
    tags: ["backup", "restore", "automatic", "data safety"],
    answer: (
      <p>
        Vault Spend backs up your data file automatically once a day when
        you open it, keeping the most recent 15 (Settings tab — also has a
        manual "Back up now"). Restoring one first backs up your current
        data (so restoring is itself reversible), then loads the restored
        data immediately — no restart needed.
      </p>
    ),
  },
  {
    question: "Can I change how Vault Spend looks?",
    tags: ["appearance", "theme", "dark mode", "light mode", "slate", "futuristic", "style", "color"],
    answer: (
      <p>
        Yes — the Settings tab has an Appearance section with a Light/Dark/
        System toggle (now in the header) plus two visual styles:{" "}
        <strong>Slate</strong> (the default look) and{" "}
        <strong>Futuristic</strong> (a neon style with its own type and
        sidebar icons). Both follow the Light/Dark/System toggle. Switching
        is instant and purely visual — nothing about your data changes.
      </p>
    ),
  },
  {
    question: "Can I move my data file to a different folder?",
    tags: ["move", "relocate", "data file", "folder", "location"],
    answer: (
      <p>
        Yes — "Move data file…" on the Settings tab copies your live
        database to a new folder you pick and starts using it right away.
        The old file is left behind untouched, in case you want it back.
      </p>
    ),
  },
  {
    question: "Can Vault Spend track spending for multiple people?",
    tags: ["family", "family members", "profiles", "household", "multiple people", "multi-user", "shared"],
    answer: (
      <>
        <p>Two different ways, depending on what you actually want:</p>
        <ul>
          <li>
            <strong>Family members</strong> — tag any account, transaction,
            goal, asset, or recurring item with who it belongs to, then
            filter down to just one person wherever a member filter appears.
            Everyone still shares the same file and sees the same data;
            it's attribution, not separation. Manage them from the Transactions
            tab's "Manage family members…" button.
          </li>
          <li>
            <strong>Profiles</strong> — completely separate, independent
            data files, one per person, with nothing shared between them.
            Switch profiles from the indicator in the sidebar, or manage
            them fully (create, rename, delete) from the Settings tab.
          </li>
        </ul>
        <p>
          Use family members for one combined household view with
          who-spent-what attribution. Use profiles for genuinely separate
          finances under one install — roommates, or keeping a side
          business apart from personal spending, for example.
        </p>
      </>
    ),
  },
  {
    question: "Can holding prices update automatically?",
    tags: [
      "investments",
      "stocks",
      "live prices",
      "alpha vantage",
      "finnhub",
      "twelve data",
      "api key",
      "auto-fill",
      "refresh",
    ],
    answer: (
      <p>
        Optionally — off by default, so nothing changes unless you turn it
        on. In Settings, pick a provider (Alpha Vantage, Finnhub, or Twelve
        Data) and add its free API key to enable it: new holdings can
        auto-fill their price by symbol, and existing ones refresh
        automatically when the app opens and every 2 hours it stays open
        (one request per distinct symbol you hold, not per holding). Turn
        it off any time and prices go back to fully manual. Alpha Vantage's
        free tier is capped at 25 requests/day, which comfortably covers
        casual use; Twelve Data's free tier raises that to 800 requests/day
        for a larger portfolio; Finnhub's free tier allows 60
        requests/minute instead, so there's no daily limit to track at all.
      </p>
    ),
  },
  {
    question: "Can I ask questions about my spending in plain English?",
    tags: ["ask the vault", "question", "search", "natural language", "query", "dashboard"],
    answer: (
      <p>
        Yes — the "Ask the Vault" box at the top of the Dashboard answers
        questions like "how much did I spend on dining out in July" or
        "what's my net worth" directly from your own data, with no internet
        connection or account required. It matches a set of question shapes
        rather than truly understanding free-form English, so it works best
        one question at a time, using the exact category, account, goal,
        or merchant names you use elsewhere in the app. Click "Tips &amp;
        examples" on the box itself for phrasing guidance and the full list
        of what it understands.
      </p>
    ),
  },
];

/** Static, in-app version of the project README — no backend calls, just
 * the same tour/instructions/FAQ so a user never has to leave the app (or
 * find a separate file) to look something up. Keep this in sync with
 * README.md when a feature changes.
 *
 * The search box at the top filters every section on the page at once —
 * see `HelpEntry`/`matchesQuery` above — rather than being scoped to just
 * the FAQ, since this page keeps growing a section at a time as new
 * features ship. */
export function HelpView() {
  const [query, setQuery] = useState("");

  const gettingStartedVisible = matchesQuery(GETTING_STARTED.tags, query);
  const tabTourVisible = TAB_TOUR_ENTRIES.filter((e) => matchesQuery(e.tags, query));
  const importingVisible = matchesQuery(IMPORTING_ENTRY.tags, query);
  const bulkSetupVisible = matchesQuery(BULK_SETUP_ENTRY.tags, query);
  const exportVisible = EXPORT_ENTRIES.filter((e) => matchesQuery(e.tags, query));
  const faqVisible = FAQ_ENTRIES.filter((e) => matchesQuery(e.tags, query) || e.question.toLowerCase().includes(query.trim().toLowerCase()));

  const nothingMatched =
    query.trim() !== "" &&
    !gettingStartedVisible &&
    tabTourVisible.length === 0 &&
    !importingVisible &&
    !bulkSetupVisible &&
    exportVisible.length === 0 &&
    faqVisible.length === 0;

  return (
    <div className="reports-view help-view">
      <div className="page-top">
        <div>
          <h1 className="view-title">Help</h1>
          <p className="view-sub">Search across every topic below, or just browse.</p>
        </div>
      </div>
      <input
        type="search"
        className="help-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the help page… (e.g. backup, profiles, duplicate)"
      />

      {nothingMatched && (
        <div className="card">
          <p className="modal-message-secondary">No results for "{query}" — try a different word.</p>
        </div>
      )}

      {gettingStartedVisible && (
        <div className="card">
          <h2 className="reports-section-title">Getting started</h2>
          {GETTING_STARTED.node}
        </div>
      )}

      {tabTourVisible.length > 0 && (
        <div className="card">
          <h2 className="reports-section-title">A tour of the tabs</h2>
          <ul className="tour-list">
            {tabTourVisible.map((e, i) => (
              <Fragment key={i}>{e.node}</Fragment>
            ))}
          </ul>
        </div>
      )}

      {importingVisible && (
        <div className="card">
          <h2 className="reports-section-title">Importing transactions</h2>
          {IMPORTING_ENTRY.node}
        </div>
      )}

      {bulkSetupVisible && (
        <div className="card">
          <h2 className="reports-section-title">Bulk setup-data import/export</h2>
          {BULK_SETUP_ENTRY.node}
        </div>
      )}

      {exportVisible.length > 0 && (
        <div className="card">
          <h2 className="reports-section-title">Exporting your data</h2>
          <ul>
            {exportVisible.map((e, i) => (
              <Fragment key={i}>{e.node}</Fragment>
            ))}
          </ul>
        </div>
      )}

      {faqVisible.length > 0 && (
        <div className="card">
          <h2 className="reports-section-title">FAQ</h2>
          {faqVisible.map((entry) => (
            <div key={entry.question} className="help-faq-entry">
              <h3>{entry.question}</h3>
              {entry.answer}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
