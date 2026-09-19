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
      "safe to spend",
      "payday",
      "to do",
      "needs a look",
      "month-end review",
      "hide amounts",
      "privacy",
      "command palette",
      "keyboard shortcuts",
      "ctrl+k",
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
        it. <strong>Safe to spend</strong> shows what's left of your
        cash after the Recurring bills due before your next paycheck (with an
        optional buffer you choose to keep), and <strong>Needs a look</strong>{" "}
        opens with a <strong>To do</strong> list — uncategorized transactions,
        bills due in the next 3 days, everyday accounts with no activity for
        30+ days, Recurring bills that look missed or changed price, and a
        finished month waiting for its <strong>month-end review</strong> —
        each row jumping to where it's fixed. New here also see a{" "}
        <strong>Get started</strong> checklist and the{" "}
        <strong>Ask the Vault</strong> question box (see FAQ below). The
        header's <strong>Hide amounts</strong> button covers every dollar
        figure with •••• for when someone's looking over your shoulder, and{" "}
        <strong>Ctrl+K</strong> opens a command palette that jumps to any tab,
        account, goal, or transaction (press <strong>?</strong> for the
        shortcut list).
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
      "details",
      "reconcile",
      "reconciliation",
      "statement",
      "cleared",
      "balance history",
      "property",
      "valuables",
    ],
    node: (
      <li>
        <strong>Accounts</strong> — every account grouped by type (cash,
        credit, loan, investment, other), with running totals for Total
        Assets, Total Liabilities, and Net Worth — click any of those for a
        breakdown of <strong>what changed</strong> and which accounts drove
        it. Add an account here, or click <strong>Edit</strong> on any card to
        change its type, institution, last-4 digits, and which family member
        it belongs to — or delete it. Click a balance to correct it. Click{" "}
        <strong>Details</strong> on a card for that account's own page: a
        balance-history chart, its transactions, and — for checking and
        savings accounts — <strong>Reconcile</strong>, which checks your
        records against a statement's ending balance (see FAQ).{" "}
        <strong>Property &amp; Valuables</strong> — a home or a vehicle,
        counted in your net worth — are managed at the bottom of this tab.
      </li>
    ),
  },
  {
    tags: [
      "ledger",
      "transactions",
      "filter",
      "split",
      "tag",
      "bulk tag",
      "debt payment",
      "family member",
      "manage family members",
      "density",
      "compact",
      "comfortable",
      "transfer",
      "link",
      "unlink",
      "possible transfers",
      "review inbox",
      "inbox",
    ],
    node: (
      <li>
        <strong>Transactions</strong> — every transaction, filterable by
        account/category/tag/family member, with inline category
        correction and tagging — either one at a time or, after selecting
        several rows, in bulk — splitting a transaction across multiple
        categories, applying a payment toward a debt account, and — for
        households tracking more than one person — assigning any account,
        transaction, goal, asset, or recurring item to a family member
        via <strong>"Manage family members…"</strong>. Rows are{" "}
        <strong>compact</strong> by default (switch to Comfortable with the
        toggle above the table). Money moving between your own accounts can
        be <strong>linked as a transfer</strong>: Vault Spend suggests likely
        pairs ("N possible transfers — review"), or tick two rows and choose
        "Link as transfer". A linked pair shows as one row and never counts
        as income or spending. After an import (and any time from{" "}
        <strong>Review inbox</strong>), a review dialog lists transactions
        worth a second look — uncategorized, a low-confidence guess, a
        possible duplicate, or an unusually large charge — with a suggested
        category you can accept, change, or skip.
      </li>
    ),
  },
  {
    tags: [
      "budget",
      "budgeted",
      "actual",
      "drag",
      "reorder",
      "category",
      "unallocated",
      "pace",
      "warn at 90%",
      "suggest",
      "3-month average",
      "rollover",
      "roll over unspent",
      "month-end review",
    ],
    node: (
      <li>
        <strong>Budget</strong> — this month's budgeted vs. actual per
        category, with prev/next month navigation and reordering (drag a
        row, or use the ↑/↓ buttons next to it). Click any category name to
        see every transaction behind that number and fix any that are
        miscategorized, right from that screen. A line under the summary shows
        how much of your budgeted income no expense line has claimed yet, and
        on the current month each expense bar carries a tick marking how far
        through the month you are — a bar filled past the tick is running
        ahead of an even pace. <strong>"Suggest from 3-month average"</strong>{" "}
        proposes an amount per category from your recent spending, which you
        accept line by line. Tick <strong>"Roll over unspent"</strong> on a
        category to carry what's left into next month's budget (see FAQ), and
        use <strong>"Month-end review"</strong> on a finished month for a
        short walk through how it went — what ran over, what's still
        uncategorized, and how your goals moved.
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
      "pace",
      "on track",
      "behind",
      "projection",
      "track account balance",
      "add contribution",
    ],
    node: (
      <li>
        <strong>Goals</strong> — savings goals with a target amount/date,
        optionally linked to an account and, for households, a family
        member, with a running total and contribution history. Pick a
        custom <strong>icon</strong> and <strong>color</strong> for each
        one, and set an optional <strong>"Auto-contribute
        monthly"</strong> amount for something like insurance or gifts
        that only comes due once a year (see FAQ). A goal with a target date
        shows its <strong>monthly pace</strong> — what you've actually been
        adding over the last three months — and whether that gets it there
        on time (on track or behind). A goal linked to an
        account can <strong>follow that account's balance</strong> so its
        progress updates by itself, and <strong>"+ Add"</strong> on a card
        logs a contribution without leaving the page.
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
        checking/savings balance 30, 60, or 90 days out — with each Recurring
        bill and paycheck landing on its due date, the lowest balance called
        out, and a "Coming up" list — and the{" "}
        <strong>Debt Payoff Planner</strong> shows how fast your credit
        cards and loans clear under a snowball or avalanche strategy.
      </li>
    ),
  },
  {
    tags: ["recurring", "bills", "subscriptions", "suggested", "matched", "paid", "missed", "price change", "price increase"],
    node: (
      <li>
        <strong>Recurring</strong> — a maintained list of recurring
        bills/income, each showing its next expected date and editable in
        place. A <strong>Suggested</strong> section above it auto-detects
        merchant/amount pairs in your transactions that look recurring but aren't
        tracked yet, so you can add them with one click instead of typing
        them in by hand. Each bill is also checked against your transactions:
        it shows when a matching charge has posted, flags a bill that looks{" "}
        <strong>missed</strong>, and calls out a <strong>price change</strong>{" "}
        when a charge comes in different after a steady run (see FAQ).
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
      "portfolio history",
      "allocation",
      "target allocation",
      "drift",
      "rebalance",
      "save as goal",
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
        current automatically. Vault Spend records your portfolio's value
        each day you open it or refresh prices, so a{" "}
        <strong>history chart</strong> builds up over time; set a{" "}
        <strong>Target allocation</strong> by asset class to see how far each
        has drifted from where you want it; and <strong>"Save as goal…"</strong>{" "}
        turns a goal projection into a real goal.
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
    tags: [
      "reports",
      "net worth",
      "csv",
      "pdf",
      "savings rate",
      "date range",
      "year to date",
      "last 12 months",
      "last month",
      "category by month",
      "spending by member",
      "spending by tag",
      "year by year",
      "sankey",
      "income flow",
      "heatmap",
      "daily spending",
      "calendar",
    ],
    node: (
      <li>
        <strong>Reports</strong> — pick a range (Year to date, Last 12
        months, Last 6 months, or Last month) and see income, spending, net,
        and savings rate for it, a Sankey diagram of income flowing to your
        biggest spending categories (with a "Left over" or "Shortfall" flow
        depending on which side won), a table of where the money went by
        category and month, a daily-spending heatmap, spending by family
        member and by tag, a year-by-year comparison, a savings-rate trend,
        and net worth by family member — with the CSV and PDF export
        described below. Property &amp; Valuables is now on the Accounts
        tab, and the setup-data import/export is in Settings.
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
      "transparent",
      "rules",
      "categorization rules",
      "privacy",
      "hide amounts",
      "second backup",
      "backup copy",
      "background reminders",
      "tray",
      "start with windows",
      "setup data",
      "data",
      "feature toggles",
      "rollover unspent",
    ],
    node: (
      <li>
        <strong>Settings</strong> — separate profiles (completely
        independent data files you can create, switch, rename, and delete
        — see FAQ), your <strong>categorization rules</strong> (see FAQ), an
        optional live stock-price integration for the Investments tab, and{" "}
        <strong>appearance</strong>: Light/Dark/System plus three visual
        styles — Slate, Futuristic, and Transparent (see FAQ).{" "}
        <strong>Privacy</strong> can also hide your amounts whenever the
        window loses focus, and <strong>Background reminders</strong> keeps
        Vault Spend in the system tray (optionally starting when you sign in)
        so bill reminders arrive with the window closed. One{" "}
        <strong>Data</strong> section holds everything about your data: where
        your data file lives (and a button to move it), your backup history
        with a manual "Back up now", per-backup restore and an optional{" "}
        <strong>second copy</strong> of every backup in another folder, and
        the bulk <strong>setup data</strong> template download and import.
        <strong> Feature toggles</strong> can hide Apply to Debt, Split,
        Envelope Caps and <strong>Rollover unspent</strong> (see FAQ)
        everywhere they appear.
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
        <li>
          A <strong>Review transactions</strong> dialog then lists the ones
          worth a look — uncategorized, a low-confidence guess, a possible
          duplicate, or an unusually large charge — with a suggested category
          to accept, change, or skip. Close it any time; it's one click away
          under <strong>Review inbox</strong> on the Transactions tab.
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
        UI, use the two buttons in <strong>Settings → Data → Setup data</strong>:
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
    tags: ["reminder", "notification", "bill", "recurring", "due date", "alert", "tray", "background", "startup", "autostart"],
    answer: (
      <p>
        If a recurring bill (Recurring tab) is due within 3 days, Vault
        Spend shows a native Windows notification when you open the app.
        To get them while the window is closed, turn on{" "}
        <strong>Settings → Background reminders → "Keep Vault Spend running
        in the tray"</strong>: closing the window then hides it to the
        system tray instead of quitting (the tray icon's menu opens it again
        or quits for real), and you can also have it start hidden when you
        sign in to Windows. It's off by default, and with it off nothing
        runs — or can notify you — while the app is closed.
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
        app for next time. Every rule, built-in and learned, is listed in{" "}
        <strong>Settings → Categorization rules</strong>, where you can add,
        edit, or delete them; before a new rule is saved you'll see how many
        existing transactions it would change and can apply it to them right
        there. A rule never overrides a category you set yourself. After you
        fix one transaction's category, you'll be offered to apply the rule
        to other identical transactions too.
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
    question: "What is a linked transfer, and why link one?",
    tags: ["transfer", "link", "unlink", "savings", "credit card payment", "between accounts", "double count"],
    answer: (
      <p>
        Moving $500 from checking to savings creates two transactions — one
        out, one in. Left alone they'd count as $500 of spending <em>and</em>{" "}
        $500 of income. Linking them tells Vault Spend they're one move
        between your own accounts, so neither counts (whatever category they
        carry), and they show as a single "A → B" row. Vault Spend suggests
        pairs with equal amounts, opposite directions, in different accounts,
        within 3 days of each other; you can also tick any two rows and
        choose "Link as transfer", and unlink from the row at any time.
        Anything categorized "Transfer" is treated the same way.
      </p>
    ),
  },
  {
    question: 'What does "Safe to spend" mean?',
    tags: ["safe to spend", "payday", "paycheck", "buffer", "bills", "dashboard", "recurring"],
    answer: (
      <p>
        It's your checking and savings balance, minus every Recurring bill
        due between now and your next Recurring paycheck (a bill due today or
        on payday counts), minus an optional buffer you choose to keep. It
        needs your bills and paycheck on the Recurring tab — without a
        paycheck it counts every bill in the next 45 days instead. It's a
        planning guide, not a guarantee: it doesn't know about a one-off
        expense that isn't on your Recurring list.
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
    question: 'What does "Roll over unspent" do on a budget line?',
    tags: ["rollover", "roll over unspent", "carry", "envelope", "unspent", "budget", "leftover"],
    answer: (
      <>
      <p>
        Tick it on a category and whatever you don't spend there in a month
        is added to that category's budget the next month — a $400 grocery
        line with $100 left over gives you $500 to spend the month after,
        and the row shows "+ $100.00 rolled in". Going over doesn't carry a
        debt forward; the carry is never below zero. Turning it on starts
        fresh from the current month rather than reaching back into old
        ones, and Budget alerts and the month-end review count the rolled-in
        amount as part of the budget.
      </p>
      <p>
        Settings → Feature toggles has a master <strong>Rollover
        unspent</strong> switch, on by default. Turn it off and nothing
        carries into a later month — the per-category checkboxes and
        "rolled in" notes disappear from Budget, and every budget and earlier
        month stays exactly as it was. Each category's own tick is
        remembered, so turning the switch back on picks up where you left
        off.
      </p>
      </>
    ),
  },
  {
    question: "How does Vault Spend know a recurring bill was paid?",
    tags: ["recurring", "matched", "paid", "missed", "price change", "merchant", "match", "subscription"],
    answer: (
      <p>
        It looks for a charge dated from a few days before to about ten days
        after the bill's due date whose description contains the bill's
        merchant name — so name the bill the way it appears on your
        statement (a bill called "Water" won't match a charge that only says
        "CITY BILLING"). A matching charge marks the bill paid; a bill with
        no matching charge once that window has passed is flagged as missed;
        and a charge that comes in at a
        different amount after a steady run of identical ones is called out
        as a price change, on the Recurring tab and in your Dashboard To do.
        The cash-flow forecast doesn't count a bill that has already posted.
      </p>
    ),
  },
  {
    question: "How do I reconcile an account against a statement?",
    tags: ["reconcile", "reconciliation", "statement", "cleared", "balance", "checking", "savings", "account details", "ending balance"],
    answer: (
      <p>
        On Accounts, click <strong>Details</strong> on a checking or savings
        account, enter the statement's ending balance, and start. Tick each
        transaction that appears on the statement; the page shows the
        difference between your cleared balance and the statement, and once
        it reaches $0.00 you can finish and Vault Spend records the
        reconciliation. Ticked rows stay marked as cleared, and a difference
        that won't close usually means a missing, mistyped, or wrongly dated
        transaction.
      </p>
    ),
  },
  {
    question: 'What does "Hide amounts" do?',
    tags: ["privacy", "hide amounts", "mask", "blur", "screen", "over the shoulder", "settings", "auto hide"],
    answer: (
      <p>
        The header's button covers every dollar figure in the app with ••••
        until you press it again, so you can open Vault Spend with someone
        next to you. It hides the numbers, not the shapes of charts or what
        a hover tooltip says. In Settings → Privacy you can also have the
        amounts hidden automatically whenever the window isn't in front.
        It's a screen privacy aid — your data file itself isn't encrypted or
        changed.
      </p>
    ),
  },
  {
    question: "Are there keyboard shortcuts?",
    tags: ["keyboard", "shortcuts", "command palette", "ctrl+k", "search", "jump", "hotkey"],
    answer: (
      <p>
        <strong>Ctrl+K</strong> opens a command palette: type to jump to any
        tab, account, goal, or transaction, or to run an action like adding
        a transaction. Outside a text box, <strong>N</strong> adds a
        transaction, <strong>/</strong> searches transactions,{" "}
        <strong>?</strong> shows the list, and <strong>Esc</strong> closes a
        dialog or the palette.
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
        It starts from the cash in your checking and savings accounts and
        places every active bill and paycheck on your Recurring list on the
        day it's due, so a big bill shows up as a dip on its due date. Your
        everyday spending carries on at your recent average (roughly the last
        90 days, leaving out anything already on your Recurring list and
        transfers between your own accounts, so nothing is counted twice). A
        canceled Recurring item is skipped. With nothing active in Recurring,
        it falls back to a smooth trend of your net cash flow instead.
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
        Yes — whatever you've entered under Property & Valuables (Accounts
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
    tags: ["backup", "restore", "automatic", "data safety", "second copy", "onedrive", "dropbox", "usb", "another folder"],
    answer: (
      <p>
        Vault Spend backs up your data file automatically once a day when
        you open it, keeping the most recent 15 (Settings tab — also has a
        manual "Back up now"). Restoring one first backs up your current
        data (so restoring is itself reversible), then loads the restored
        data immediately — no restart needed. Under Settings → Data → Backups you can also
        choose a <strong>second folder</strong> — one that syncs to OneDrive
        or Dropbox, or a USB drive, and that already exists (Vault Spend won't
        create one from a typed path) — and every backup is copied there too,
        so one failed disk can't take your data and its backups together. If
        that folder isn't reachable, the main backup still happens and
        you're told the copy didn't.
      </p>
    ),
  },
  {
    question: "Can I change how Vault Spend looks?",
    tags: ["appearance", "theme", "dark mode", "light mode", "slate", "futuristic", "transparent", "glass", "style", "color"],
    answer: (
      <p>
        Yes — the Settings tab has an Appearance section with a Light/Dark/
        System toggle (now in the header) plus three visual styles:{" "}
        <strong>Slate</strong> (the default look), <strong>Futuristic</strong>{" "}
        (a neon style with its own type and sidebar icons), and{" "}
        <strong>Transparent</strong> (a frosted-glass style with a
        translucent, blurred sidebar and cards). All three follow the
        Light/Dark/System toggle. Switching is instant and purely visual —
        nothing about your data changes.
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
