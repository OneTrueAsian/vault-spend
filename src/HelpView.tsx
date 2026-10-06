import { Fragment, ReactNode, useEffect, useState } from "react";
import type { Tab } from "./appTypes";
import thirdPartyNotices from "../docs/THIRD-PARTY-NOTICES.txt?raw";
import { LegalNoticeHelp } from "./LegalNoticeHelp";

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

/** One page's help: a one-sentence summary, short "How do I…" answers of 2-5 numbered steps, and
 * the other facts about the page as a short list. `tags` drive search, along with the title and
 * the questions; they keep every word the old tour entries were found by. Order follows the
 * sidebar. Each page's ? button (HelpLink) opens its section here. */
type TabHelp = {
  tab: Tab;
  title: string;
  summary: string;
  howTo: { question: string; steps: ReactNode[] }[];
  more?: ReactNode[];
  tags: string[];
};

export const TAB_HELP: TabHelp[] = [
  {
    tab: "dashboard",
    title: "Dashboard",
    summary: "Your money at a glance: net worth, cash, debt and investments first, then what needs you, your spending and recent transactions.",
    howTo: [
      {
        question: "How do I add a transaction, an account, a budget or a goal from here?",
        steps: [
          <>Use the buttons beside the page title: <strong>+ Add transaction</strong>, <strong>+ Add account</strong>, <strong>Set budget</strong> or <strong>Update goals</strong>.</>,
          <>Each opens the same form or page as on its own tab.</>,
        ],
      },
      {
        question: "How do I see what changed in my net worth?",
        steps: [
          <>Click <strong>Net worth</strong>, <strong>Cash</strong>, <strong>Debt</strong> or <strong>Investments</strong>.</>,
          <>A breakdown shows <strong>what changed</strong> and which accounts drove it.</>,
        ],
      },
      {
        question: "How do I change which cards the Dashboard shows?",
        steps: [
          <>Open the <strong>Layout</strong> menu (it reads "Layout: Default") and choose <strong>Customize…</strong> from it.</>,
          <>Pin or unpin cards, drag them to reorder, or use <strong>+ Add widget…</strong> to pin one specific account, goal or investment account.</>,
          <>Choose <strong>Done customizing</strong> from the same menu when you're finished.</>,
        ],
      },
      {
        question: "How do I save my own layout?",
        steps: [
          <>After customizing, the Layout menu shows "Custom (unsaved)".</>,
          <>Click <strong>+ Save as…</strong> and give it a name.</>,
          <>Pick it from the Layout menu any time, next to the built-in Default, Bills Focus and Investor Focus, or select it and click <strong>Delete</strong> to remove it.</>,
        ],
      },
      {
        question: "How do I hide my amounts when someone is looking?",
        steps: [
          <>Click <strong>Hide amounts</strong> at the bottom of the sidebar.</>,
          <>Every dollar figure shows as ••••. Click <strong>Show amounts</strong> to bring them back.</>,
        ],
      },
      {
        question: "How do I see the tab names when the sidebar shows only icons?",
        steps: [
          <>In a window under 1000 pixels wide the sidebar shows icons only. Point at an icon, or move to it with Tab, to see its name.</>,
          <>Click <strong>☰ Show names</strong> at the top of the sidebar to open the full sidebar over the page.</>,
          <>Choosing a tab, pressing Escape or clicking elsewhere closes it again.</>,
        ],
      },
      {
        question: "How do I jump anywhere quickly?",
        steps: [
          <>Press <strong>Ctrl+K</strong> to open the command palette.</>,
          <>Type the name of a tab, account, goal or transaction and press Enter. Press <strong>?</strong> outside a text box for the list of shortcuts.</>,
        ],
      },
    ],
    more: [
      <>The <strong>To do</strong> card, right under the four money cards, lists what needs you: uncategorized transactions, bills due in the next 3 days, everyday accounts with no activity for 30+ days, Recurring bills that look missed or changed price, and a finished month waiting for its <strong>month-end review</strong>. Each row jumps to where it's fixed.</>,
      <><strong>Safe to spend</strong> shows what's left of your cash after the Recurring bills due before your next paycheck, with an optional buffer you choose to keep (see FAQ).</>,
      <>The ring shows how many months of expenses your cash and savings cover, at your average spending over the last 90 days, against a goal of 6 months.</>,
      <>This month's spending by category, your recent transactions, and an <strong>Insights</strong> feed that surfaces things worth a look on its own: a category on pace to go over budget, a month-over-month jump, an unusually large charge, and good news too, like a category you meaningfully cut back on.</>,
      <>The <strong>Ask the Vault</strong> question box sits right under the page title (see FAQ), and people who are new here also see a <strong>Get started</strong> checklist.</>,
    ],
    tags: [
      "dashboard", "net worth", "insights", "budget alerts", "spending", "what changed", "customize", "pin widget", "add widget",
      "pin account", "pin goal", "pin investment", "layout", "save layout", "custom layout", "named layout", "bills focus",
      "investor focus", "quick actions", "get started", "checklist", "ask the vault", "safe to spend", "payday", "to do",
      "needs a look", "month-end review", "hide amounts", "privacy", "command palette", "keyboard shortcuts", "ctrl+k",
      "runway", "sidebar", "show names", "icons", "narrow window",
    ],
  },
  {
    tab: "accounts",
    title: "Accounts",
    summary: "Every account grouped by type, with running totals for what you own, what you owe and your net worth.",
    howTo: [
      {
        question: "How do I add or change an account?",
        steps: [
          <>Click <strong>Add account…</strong> beside the page title. Checking, savings, credit card, loan, investment and other are all supported.</>,
          <>To change one, open the <strong>⋯</strong> menu on its row and choose <strong>Edit…</strong>: its type, institution, last-4 digits and which family member it belongs to, or delete it.</>,
        ],
      },
      {
        question: "How do I correct a balance?",
        steps: [
          <>Click the account's balance (or, on a credit card, its limit).</>,
          <>Type the right amount and press Enter. Escape leaves it as it was.</>,
        ],
      },
      {
        question: "How do I open an account's own page?",
        steps: [
          <>Click anywhere on the account's row, or choose <strong>Details</strong> in its <strong>⋯</strong> menu.</>,
          <>Its page shows a balance-history chart and its transactions.</>,
        ],
      },
      {
        question: "How do I reconcile an account against a statement?",
        steps: [
          <>Open a checking or savings account's page.</>,
          <>Under <strong>Reconcile with a statement</strong>, enter the statement's ending balance and tick each transaction that appears on it.</>,
          <>Finish once the difference reaches $0.00 (see FAQ).</>,
        ],
      },
      {
        question: "How do I see what changed in my net worth?",
        steps: [
          <>Click <strong>What you own</strong>, <strong>What you owe</strong> or <strong>Net worth</strong>.</>,
          <>A breakdown shows <strong>what changed</strong> and which accounts drove it.</>,
        ],
      },
      {
        question: "How do I add a home or a vehicle?",
        steps: [
          <>Scroll to <strong>Property &amp; Valuables</strong> at the bottom of this tab.</>,
          <>Add it with its value. It counts in your net worth.</>,
        ],
      },
    ],
    more: [<>Accounts are grouped as cash, credit, loan, investment and other.</>],
    tags: [
      "accounts", "net worth", "assets", "liabilities", "what changed", "account type", "credit", "loan", "investment",
      "institution", "details", "reconcile", "reconciliation", "statement", "cleared", "balance history", "property",
      "valuables", "edit account", "credit limit", "correct balance",
    ],
  },
  {
    tab: "ledger",
    title: "Transactions",
    summary: "Every transaction, with filters, categories, tags, splits, notes, family members and transfers between your own accounts.",
    howTo: [
      {
        question: "How do I add a transaction by hand?",
        steps: [
          <>Click <strong>Add transaction…</strong> beside the page title. The <strong>Add to</strong> menu next to it picks the account it starts on.</>,
          <>Fill in the date, the description and the amount, without a minus sign.</>,
          <>Choose <strong>Money out</strong> or <strong>Money in</strong>. On a credit card or loan the choice reads <strong>Charge</strong> or <strong>Payment</strong>.</>,
          <>Leave Category on Auto-categorize, or pick one, and click <strong>Add transaction</strong>.</>,
        ],
      },
      {
        question: "How do I fix a transaction's category?",
        steps: [
          <>Click the category on its row. A red <strong>Needs a category</strong> means it has none yet.</>,
          <>Pick the right one.</>,
          <>To see only the ones without a category, click <strong>Review</strong> on the line above the table that counts them.</>,
        ],
      },
      {
        question: "How do I split, tag, note or delete a transaction?",
        steps: [
          <>Open the <strong>⋯</strong> menu at the end of its row.</>,
          <>Choose <strong>Split…</strong> (or Edit splits…), <strong>Add tag…</strong>, <strong>Add note…</strong> (or Edit note…), <strong>Apply to a debt…</strong> or <strong>Delete…</strong> from the list.</>,
          <>A split divides it into as many category and amount lines as you need, each with an optional note.</>,
        ],
      },
      {
        question: "How do I change many transactions at once?",
        steps: [
          <>Tick the rows, or the box at the top of the table for every matching row.</>,
          <>Use the bar above the table to set the category or tags for all of them at once (see FAQ for the limit of 250).</>,
        ],
      },
      {
        question: "How do I link a transfer between my own accounts?",
        steps: [
          <>Use the "N possible transfers — review" suggestion, or tick two rows and choose <strong>Link as transfer</strong>.</>,
          <>A linked pair shows as one row and never counts as income or spending.</>,
          <>Don't want a pair suggested again? Choose <strong>Dismiss</strong> on it (or Dismiss selected / Dismiss all). It stops that pair being suggested for good without changing either transaction, and Link still works on it any time.</>,
        ],
      },
      {
        question: "How do I review new or unusual transactions?",
        steps: [
          <>After an import, or any time from <strong>Review inbox</strong>, a dialog lists transactions worth a second look: uncategorized, a low-confidence guess, a possible duplicate, or an unusually large charge.</>,
          <>Accept, change or skip the suggested category for each.</>,
        ],
      },
      {
        question: "How do I record who a transaction belongs to?",
        steps: [
          <>Open the <strong>⋯</strong> More actions menu beside the page title and choose <strong>Manage family members…</strong> to add people.</>,
          <>Pick the person on any account, transaction, goal, asset or recurring item. The member column appears once there are two people.</>,
        ],
      },
    ],
    more: [
      <>Filter by account, category, tag or family member. The table shows rows a few at a time; use <strong>Show 50 more</strong> under it.</>,
      <>Prefer not to review transfers one by one? Turn on <strong>Link matching transfers automatically</strong> in Settings; the pairs it links are listed under "N auto-linked — review". A linked transfer's ⋯ menu has <strong>Unlink transfer…</strong> and one note action per leg, since each side is still its own transaction.</>,
      <>On a loan account, <strong>Split principal…</strong> takes the place of Apply to a debt…, and a payment applied to a debt shows under its description, with Undo.</>,
      <>Rows are <strong>compact</strong> by default; switch to Comfortable with the toggle above the table.</>,
      <>The line under the title counts your transactions and how many were sorted automatically or by you.</>,
    ],
    tags: [
      "ledger", "transactions", "filter", "split", "tag", "bulk tag", "debt payment", "family member", "manage family members",
      "density", "compact", "comfortable", "transfer", "link", "unlink", "possible transfers", "dismiss", "auto-link",
      "auto-linked", "review inbox", "inbox", "note", "notes", "annotate", "add transaction", "money out", "money in",
      "charge", "payment", "needs a category", "uncategorized", "apply to a debt", "split principal", "delete transaction",
      "row menu",
    ],
  },
  {
    tab: "recurring",
    title: "Recurring",
    summary: "Your regular bills and income, when each is next due, and whether it was paid.",
    howTo: [
      {
        question: "How do I add a recurring bill or income?",
        steps: [
          <>Click <strong>Add recurring…</strong> under the list.</>,
          <>Name it the way it appears on your statement, then give its amount, how often it comes (Weekly, Every 2 weeks, Monthly or Yearly) and its next date.</>,
        ],
      },
      {
        question: "How do I add one Vault Spend found for me?",
        steps: [
          <>The <strong>Suggested</strong> section above the list shows merchant and amount pairs in your transactions that look recurring but aren't on your list yet.</>,
          <>Click <strong>Add</strong> to put one on your list without typing it in, or <strong>Dismiss</strong> to hide it.</>,
        ],
      },
      {
        question: "How do I change or stop a recurring item?",
        steps: [
          <>Click <strong>Edit</strong> on its row to change it in place.</>,
          <>Mark it <strong>Keep</strong>, <strong>Reviewing</strong> or <strong>Canceled</strong>.</>,
        ],
      },
      {
        question: "How do I see my bills by date or by cost?",
        steps: [
          <>Switch from <strong>List</strong> to <strong>Calendar</strong> to see what's due on each day of a month.</>,
          <>Choose <strong>Audit</strong> to see what each item costs a month, to decide what to keep.</>,
        ],
      },
    ],
    more: [
      <>The two totals at the top, <strong>Bills</strong> and <strong>Income</strong>, show a month in large text and a year underneath; income is an estimate.</>,
      <>Each bill is checked against your transactions: it shows when a matching charge has posted, flags a bill that looks <strong>missed</strong>, and calls out a <strong>price change</strong> when a charge comes in different after a steady run (see FAQ). A bill due within 3 days says <strong>Due soon</strong>.</>,
    ],
    tags: [
      "recurring", "bills", "subscriptions", "suggested", "matched", "paid", "missed", "price change", "price increase",
      "add recurring", "yearly", "every 2 weeks", "weekly", "monthly", "calendar", "audit", "keep", "canceled", "due soon",
    ],
  },
  {
    tab: "budget",
    title: "Budget",
    summary: "This month's plan per category: what you budgeted, what you've spent and what's left, with other months a click away.",
    howTo: [
      {
        question: "How do I set a category's budget?",
        steps: [
          <>Type the amount into the category's <strong>Budget</strong> field.</>,
          <>Press Enter or Tab to save. Escape puts back the old amount. With Hide amounts on, click the hidden amount to change it.</>,
        ],
      },
      {
        question: "How do I change a category's settings?",
        steps: [
          <>Open the <strong>⋯</strong> menu at the end of its row.</>,
          <>Tick <strong>Roll over unspent</strong> (see FAQ) or <strong>Warn at 90%</strong>, choose <strong>Move to</strong> another group, <strong>Move up</strong> or <strong>Move down</strong>, or <strong>Delete…</strong> to remove it.</>,
          <>The row then says "Rolls over" or "Warns at 90%" so you can see it at a glance. You can also drag a row by its ⠿ handle.</>,
        ],
      },
      {
        question: "How do I see the transactions behind a number?",
        steps: [
          <>Click the category's name.</>,
          <>Every transaction behind it is listed; fix any that are miscategorized right there.</>,
        ],
      },
      {
        question: "How do I get suggested amounts?",
        steps: [
          <>Click <strong>Suggest from 3-month average</strong>.</>,
          <>Accept the proposed amount for each category, line by line.</>,
        ],
      },
      {
        question: "How do I look back at a finished month?",
        steps: [
          <>Move to it with the month arrows.</>,
          <>Choose <strong>Month-end review</strong> for a short walk through how it went: what ran over, what's still uncategorized, and how your goals moved.</>,
        ],
      },
    ],
    more: [
      <>The summary at the top shows <strong>Planned spending</strong>, <strong>Spent so far</strong>, <strong>Left to spend</strong> and <strong>Money left after income</strong>.</>,
      <>Categories are grouped as Income, Fixed, Flexible and Non-Monthly. Each group's heading shows its progress, such as "$2,300.00 of $3,607.00 · 64% used", or how much income has been received.</>,
      <>A line shows how much of your budgeted income no expense line has claimed yet. On the current month each expense bar carries a tick for how far through the month you are; a bar filled past the tick is running ahead of an even pace.</>,
      <>Red means over budget. A category spent exactly to its budget says "Used in full".</>,
    ],
    tags: [
      "budget", "budgeted", "actual", "drag", "reorder", "category", "unallocated", "pace", "warn at 90%", "suggest",
      "3-month average", "rollover", "roll over unspent", "month-end review", "planned spending", "spent so far",
      "left to spend", "used in full", "rolls over", "move to", "group",
    ],
  },
  {
    tab: "buckets",
    title: "Goals",
    summary: "Savings goals with a target amount and date, showing how much you've put aside and whether you're on track.",
    howTo: [
      {
        question: "How do I create a goal?",
        steps: [
          <>On an empty Goals page click <strong>Create a goal</strong>, or one of the examples (Emergency fund, Holiday, New car) to start with that name. Once you have goals, use the <strong>+ New goal…</strong> tile.</>,
          <>Add an optional target amount and date, link an account or a family member, and pick an <strong>icon</strong> and <strong>color</strong>.</>,
          <>Click <strong>Create</strong>.</>,
        ],
      },
      {
        question: "How do I add money to a goal?",
        steps: [
          <>Click <strong>+ Add</strong> on the goal's card.</>,
          <>Enter the amount (a negative amount takes money out) and an optional note, then click <strong>Add</strong>.</>,
        ],
      },
      {
        question: "How do I make a goal follow an account's balance?",
        steps: [
          <>Click <strong>Edit</strong> on the goal and link it to an account.</>,
          <>Tick <strong>Progress follows this account's balance</strong>. Its progress then updates by itself.</>,
        ],
      },
      {
        question: "How do I save a little every month for a yearly cost?",
        steps: [
          <>Set <strong>Auto-contribute monthly</strong> on the goal, for something like insurance or gifts that only comes due once a year.</>,
          <>Vault Spend adds that amount once each month (see FAQ).</>,
        ],
      },
    ],
    more: [
      <>Each goal keeps a running total and its contribution history.</>,
      <>A goal with a target date shows its <strong>monthly pace</strong>, what you've actually been adding over the last three months, and whether that gets it there on time (on track or behind).</>,
    ],
    tags: [
      "goals", "savings goal", "target amount", "contribution", "icon", "color", "auto-contribute", "sinking fund",
      "family member", "pace", "on track", "behind", "projection", "track account balance", "add contribution",
      "create a goal", "new goal", "emergency fund",
    ],
  },
  {
    tab: "cashflow",
    title: "Cash Flow",
    summary: "Money in and out over recent months, a forecast of your balance, and a plan for paying off your debts.",
    howTo: [
      {
        question: "How do I see one month's spending?",
        steps: [
          <>Choose a 3 or 6 month window, and tick <strong>Compare to last year</strong> to set each month against the year before.</>,
          <>Click a month's bar to see its spending by category and any unusually large charges.</>,
        ],
      },
      {
        question: "How do I see where my balance is heading?",
        steps: [
          <>Scroll to <strong>Forecast</strong> and pick 30, 60 or 90 days.</>,
          <>Your checking and savings balance is projected with each Recurring bill and paycheck landing on its due date, the lowest balance called out, and a "Coming up" list (see FAQ).</>,
        ],
      },
      {
        question: "How do I plan paying off my debts?",
        steps: [
          <>Scroll to the <strong>Debt Payoff Planner</strong>.</>,
          <>Choose snowball or avalanche to see how fast your credit cards and loans clear. Untick Include to leave one out (see FAQ).</>,
        ],
      },
    ],
    more: [
      <>"Top categories" and "Top merchants" cover a single month (this one, with a picker to look back further) and show a month-over-month trend per category.</>,
    ],
    tags: ["cash flow", "income", "expenses", "forecast", "debt payoff planner", "top categories", "top merchants", "year over year", "compare to last year", "snowball", "avalanche"],
  },
  {
    tab: "investments",
    title: "Investments",
    summary: "Your holdings in each account, what they're worth and how they've done, and where they're headed.",
    howTo: [
      {
        question: "How do I add a holding?",
        steps: [
          <>Click <strong>Add holding…</strong> and enter its shares, price and cost basis.</>,
          <>Prices are yours to keep up to date, unless you turn on live prices in Settings: then a new holding fills in its price by symbol and existing ones stay current by themselves (see FAQ).</>,
        ],
      },
      {
        question: "How do I see what's driving my gains or losses?",
        steps: [
          <>Click <strong>Total gain/loss</strong> or <strong>Today's gain/loss</strong>.</>,
          <>See which holdings are driving it.</>,
        ],
      },
      {
        question: "How do I check my mix of investments?",
        steps: [
          <>Set a <strong>Target allocation</strong> by asset class.</>,
          <>See how far each has drifted from where you want it.</>,
        ],
      },
      {
        question: "How do I project a future balance?",
        steps: [
          <>In the <strong>goal projection</strong> calculator, enter a starting amount, a monthly contribution and an assumed yearly return.</>,
          <>Click <strong>Save as goal…</strong> to turn the projection into a real goal.</>,
        ],
      },
      {
        question: "How do I plan an account's contributions and withdraw date?",
        steps: [
          <>Open the investment account's page (click its row on Accounts).</>,
          <>Set its plan. Its <strong>Accumulation &amp; projection</strong> card shows the cash put in, what it's worth now, and where it's headed by its withdraw date (see FAQ).</>,
        ],
      },
    ],
    more: [
      <>Each holding shows its computed value and gain or loss.</>,
      <>Vault Spend records your portfolio's value each day you open it or refresh prices, so a <strong>history chart</strong> builds up over time.</>,
    ],
    tags: [
      "investments", "holdings", "shares", "cost basis", "gain loss", "what changed", "goal projection", "live prices",
      "stocks", "alpha vantage", "finnhub", "twelve data", "portfolio history", "allocation", "target allocation", "drift",
      "rebalance", "save as goal", "accumulation", "projection", "roth", "529", "contributions", "withdraw", "add holding",
    ],
  },
  {
    tab: "household",
    title: "Household",
    summary: "Spending, income, net worth and the budget, broken down by family member.",
    howTo: [
      {
        question: "How do I start splitting things by person?",
        steps: [
          <>On Transactions, open the <strong>⋯</strong> More actions menu and choose <strong>Manage family members…</strong> to add people.</>,
          <>Assign accounts, transactions and more to them. Anything not assigned to anyone shows under "Unassigned".</>,
        ],
      },
      {
        question: "How do I look at another month?",
        steps: [
          <>Use the month arrows at the top.</>,
          <>Spending and income follow the month you're viewing. Net worth by person is always as of today; it isn't a monthly figure the way the cards above it are.</>,
        ],
      },
    ],
    more: [<>A budget grid splits each category's budget by person.</>],
    tags: ["household", "family", "spending by person", "income by person", "net worth by person", "budget by person", "unassigned"],
  },
  {
    tab: "reports",
    title: "Reports",
    summary: "Income, spending, savings rate and where your money went over a period you choose, with charts and exports.",
    howTo: [
      {
        question: "How do I pick the period?",
        steps: [
          <>Choose <strong>Year to date</strong>, <strong>Last 12 months</strong>, <strong>Last 6 months</strong> or <strong>Last month</strong>.</>,
          <>Income, spending, net and savings rate update for it.</>,
        ],
      },
      {
        question: "How do I see where the money went?",
        steps: [
          <>Follow the Sankey diagram from your income to your biggest spending categories, with a "Left over" or "Shortfall" flow depending on which side won.</>,
          <>Use the table of spending by category and month below it.</>,
          <>In the daily-spending heatmap, darker days are bigger spending days. Point at a day, or move to it with Tab, for its total. One big bill like rent doesn't wash the rest out.</>,
        ],
      },
      {
        question: "How do I save a report as a file?",
        steps: [
          <>Use the CSV or PDF export on this page.</>,
          <>See Exporting your data below for what each holds.</>,
        ],
      },
      {
        question: "How do I compare my household with others my age?",
        steps: [
          <>Open <strong>Reports → Comparisons</strong>.</>,
          <>Fill in <strong>Your details</strong>. Nothing you enter leaves your computer (see FAQ).</>,
        ],
      },
    ],
    more: [
      <>Also here: spending by family member and by tag, a year-by-year comparison, a savings-rate trend, and net worth by family member.</>,
      <>Property &amp; Valuables is on the Accounts tab, and the setup-data import and export is in Settings.</>,
    ],
    tags: [
      "reports", "net worth", "csv", "pdf", "savings rate", "date range", "year to date", "last 12 months", "last month",
      "category by month", "spending by member", "spending by tag", "year by year", "sankey", "income flow", "heatmap",
      "daily spending", "calendar", "comparisons", "age",
    ],
  },
  {
    tab: "settings",
    title: "Settings",
    summary: "How Vault Spend looks, your profiles and passwords, rules, privacy, reminders, and everything about your data.",
    howTo: [
      {
        question: "How do I switch between light and dark?",
        steps: [
          <>Choose <strong>Light, Dark or System</strong> in <strong>Settings → Appearance</strong>, or at the bottom of the sidebar. Both do the same thing.</>,
          <>System follows your computer's own setting.</>,
        ],
      },
      {
        question: "How do I change the style?",
        steps: [
          <>In <strong>Settings → Appearance</strong>, click the picture of <strong>Default</strong>, <strong>Futuristic</strong> or <strong>Retro</strong>.</>,
          <>With Futuristic you can also pick its glow color and how strongly it glows. <strong>Reduce motion</strong> turns off sliding and fading in every style (see FAQ).</>,
        ],
      },
      {
        question: "How do I keep separate data for separate people?",
        steps: [
          <>Under <strong>Profiles</strong>, create a profile: a completely independent data file.</>,
          <>Switch, rename or delete profiles there, or switch from the indicator in the sidebar (see FAQ).</>,
        ],
      },
      {
        question: "How do I back up, restore or move my data?",
        steps: [
          <>In the <strong>Data</strong> section, see your backup history, click <strong>Back up now</strong>, or restore any backup.</>,
          <>Choose a <strong>second copy</strong> folder to keep every backup in another place too.</>,
          <>Use <strong>Move data file…</strong> to keep your data file in another folder, and the <strong>setup data</strong> template to fill in a lot at once (see FAQ).</>,
        ],
      },
      {
        question: "How do I get bill reminders with the window closed?",
        steps: [
          <>Turn on <strong>Background reminders</strong> to keep Vault Spend in the system tray.</>,
          <>Optionally start it when you sign in, so reminders arrive with the window closed.</>,
        ],
      },
    ],
    more: [
      <>Your <strong>categorization rules</strong> live here (see FAQ), with an optional live stock-price integration for the Investments tab.</>,
      <><strong>Privacy</strong> can also hide your amounts whenever the window isn't in front.</>,
      <><strong>Feature toggles</strong> can hide Apply to Debt, Split, Envelope Caps and <strong>Rollover unspent</strong> (see FAQ) everywhere they appear, and turn on linking transfers automatically.</>,
    ],
    tags: [
      "settings", "profiles", "data file", "backups", "live stock prices", "move data file", "appearance", "theme",
      "dark mode", "light mode", "default", "futuristic", "transparent", "retro", "rules", "categorization rules",
      "privacy", "hide amounts", "second backup", "backup copy", "background reminders", "tray", "start with windows",
      "setup data", "data", "feature toggles", "rollover unspent", "style", "light", "dark", "system",
    ],
  },
];

function tabHelpMatches(help: TabHelp, query: string): boolean {
  return matchesQuery([help.title, ...help.tags, ...help.howTo.map((h) => h.question)], query);
}

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
          before confirming. Each account remembers your answer and offers
          it again on its next import, and for a credit card whose file is
          mostly positive amounts, "Flip the signs" is suggested. Imported
          them the wrong way already? Select those rows on the Transactions
          tab and choose "Flip signs…" (choosing it again undoes it).
        </li>
        <li>
          A review of every row opens in a window over the page before
          anything is saved. Rows
          that look like duplicates of something already in your transactions are
          unchecked by default (see the FAQ below) — check or uncheck any
          row, or override which account a specific row should land in.
        </li>
        <li>
          The preview also sorts out categories before anything is saved.
          Each row is filed by your rules and past choices where the app is
          at least half sure. Any row it isn't sure about appears under{" "}
          <strong>Pick a category</strong>: pick a category for it, or
          choose "Leave uncategorized." <strong>"Leave the rest
          uncategorized"</strong> does that for every row still waiting.
          The import button stays off until every checked row has a choice.
        </li>
        <li>
          Confirm the import. Choosing a category for a row also teaches the
          app that merchant, so it can file it on its own next time.
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
    question: "How do I set up mobile snapshots on my phone?",
    tags: ["mobile snapshots", "phone", "pairing", "qr", "wifi", "wi-fi", "certificate", "trust", "local address"],
    answer: <>
      <p>Start on your computer: open <strong>Settings → Mobile snapshots → Set up a phone</strong>. Choose iPhone or Android and follow the guide. Keep Vault Spend open and your phone on the same private home network; the computer can use Ethernet.</p>
      <p>Scan the setup QR with your phone Camera to open the certificate instructions. Download the public certificate, then verify the actual file against the full fingerprint shown on your computer before installing it. A matching name or text on the download page is not proof. If your phone cannot show the fingerprint, use <strong>Export certificate for direct transfer</strong> in the guide and a transfer method you control instead.</p>
      <p>Install the verified certificate in phone Settings. iPhone also needs its trust switch enabled under General → About → Certificate Trust Settings. The guide gives the phone-specific steps. Trusting this certificate lets your browser trust certificates signed by this Vault Spend installation; remove it from phone Settings when you stop using it.</p>
      <p>Open the secure viewer without a certificate warning. If using a home-screen shortcut, add and open it before pairing; it may have separate saved data. On the computer, create the pairing QR. Request access from your phone, then approve that phone and choose its profiles on the computer. Wait for the first saved snapshot and <strong>Ready offline</strong>.</p>
      <p>The guided address ends in .local and can keep the same browser location when the computer's address changes on its selected network. Some networks block local discovery. Changing the viewer name or port, or moving from an old IP address, creates a separate saved-data location: pair and download again. Do not bypass a certificate warning or turn off router security to force a connection.</p>
    </>,
  },
  {
    question: "Can I use mobile snapshots away from my computer?",
    tags: ["mobile snapshots", "phone", "offline", "saved snapshot", "ready offline", "timestamp", "refresh", "remember access"],
    answer: <>
      <p>Yes, after a snapshot is saved and the phone says <strong>Ready offline</strong>. Open the same browser or home-screen shortcut to see that saved copy. Check its saved date and time; it is not a live balance when you are away from the desktop.</p>
      <p>To refresh, connect both devices to the same private home network and keep Vault Spend open with the requested profile active and unlocked. The phone cannot unlock or switch desktop profiles. To refresh another profile, open it on the desktop first. A failed refresh keeps the previous saved copy and its timestamp.</p>
      <p>The lightweight viewer has Overview, Accounts, Budget, Reports and Calculators. It shows account balances, investment totals and gains or losses, your full saved budget and report summaries. It does not include the full transaction list or individual holdings. Calculator inputs stay on the phone and do not change desktop finances.</p>
      <p>Access is remembered in the browser you paired. Someone using your unlocked phone may be able to read its saved data. The saved snapshots are encrypted, but this does not add a separate phone password prompt. Private browsing, clearing website data, removing a shortcut or browser storage cleanup can remove saved copies. If data is lost, reconnect, pair if needed and save again. Check offline reopening before relying on it.</p>
    </>,
  },
  {
    question: "How do I stop phone access or remove mobile snapshots?",
    tags: ["mobile snapshots", "phone", "revoke", "forget this phone", "remove profile", "disable mobile access", "remove certificate"],
    answer: <>
      <p>On the desktop, <strong>Disable mobile access</strong> stops connections. <strong>Revoke phone</strong> blocks that phone from future downloads; <strong>Remove profile access</strong> blocks future downloads of just that profile. None of these can erase a copy already saved on a phone.</p>
      <p>On the phone, <strong>Forget this phone</strong> removes its saved snapshots, encryption keys and remembered access. If the desktop is reachable, it also revokes the browser connection. If you forget while offline, revoke the phone on the desktop too. Removing one saved profile only removes that profile's local copy; it does not revoke its desktop permission.</p>
      <p>Locking the desktop profile prevents refresh until it is unlocked. Changing its password does not revoke an approved phone; use Revoke phone to stop future downloads. Neither action erases an approved offline phone copy. No desktop control can remotely erase that copy. If a phone is lost, revoke its future access and use your phone's own lost-device controls.</p>
      <p>When you stop using the viewer, remove this installation's certificate from phone Settings too. On iPhone, remove its profile under General → VPN &amp; Device Management. Android names vary; remove only the Vault Spend certificate from user credentials. Forgetting website data does not remove the certificate. <strong>Reset mobile trust</strong> on the computer revokes all phones and creates a new installation identity; every phone must trust the replacement and pair again.</p>
    </>,
  },

  {
    question: "How does password protection work?",
    tags: [
      "password",
      "protection",
      "password protection",
      "recovery key",
      "recover",
      "locked",
      "lock",
      "encryption",
      "encrypt",
      "profile",
      "backup",
      "export",
      "change password",
      "regenerate",
      "remove protection",
      "vaultspend package",
      "portable",
      "move to another computer",
    ],
    answer: (
      <>
        <p>
          Password protection encrypts a profile&apos;s data on disk and asks for its password whenever you open it.
          Each profile is protected on its own, so you can protect some and leave others as they are. Turn it on under{" "}
          <strong>Settings → Password protection</strong> (<strong>Turn on password protection…</strong>), or tick the
          protection box when you add a new profile. Setup shows a one-time recovery key and only finishes once you
          have typed two of its groups back, so you know it was saved. Profile names and icons stay visible so you can
          choose which profile to unlock.
        </p>
        <p>
          Lock a profile any time with <strong>Lock profile</strong> in the profile switcher (or the command palette);
          it can also lock itself, see &quot;When does a protected profile lock automatically?&quot; below. Under
          Settings → Password protection you can change the password (which issues a new recovery key), regenerate the
          recovery key, or remove protection.
        </p>
        <p>
          A protected profile exports as a <strong>.vaultspend</strong> folder: the encrypted data, its key file and a
          manifest. On any computer running Vault Spend, Windows or macOS, choose <strong>Use existing file</strong>{" "}
          when adding a profile, pick that folder and enter the password. Keep the files in the folder together.
          Protection secures stored data, but it cannot protect information while the profile is unlocked from
          malware, an administrator, or someone viewing the screen. Versions of Vault Spend before 1.2.8 can&apos;t
          open a protected profile.
        </p>
      </>
    ),
  },
  {
    question: "What if I forget my password or lose my recovery key?",
    tags: ["forgot password", "forgotten password", "lost recovery key", "recovery key", "recover", "reset password", "locked out", "password protection"],
    answer: (
      <>
        <p>
          On the lock screen, choose <strong>Forgot your password?</strong> and enter your recovery key to choose a
          new password; a new recovery key is issued at the same time, so save that one. The password and the recovery key are each enough
          to get in, and nothing else is: Vault Spend cannot reset either for you, and there is no back door.
        </p>
        <p>
          If you have lost the recovery key but can still unlock the profile, regenerate it under{" "}
          <strong>Settings → Password protection</strong>. If you have neither the password nor the recovery key, the
          profile&apos;s data can&apos;t be read, and the profile can only be removed from the profile list. That
          removes the list entry only; its files stay on disk untouched, so deleting them is up to you.
        </p>
      </>
    ),
  },
  {
    question: "Which copies of my data stay unencrypted?",
    tags: ["plaintext copies", "plaintext", "unencrypted", "csv", "export", "second copy", "second folder", "leftover", "original file", "safety copy", "password protection"],
    answer: (
      <>
        <p>
          Turning protection on makes a new encrypted file and leaves the original, unprotected file and its older
          backups where they were, still readable by anyone with access to this computer. Settings then shows a{" "}
          <strong>Plaintext files left behind</strong> card with <strong>Delete plaintext copies now</strong> and{" "}
          <strong>Keep for now</strong>. Older unprotected copies in your second backup folder are only deleted if you
          tick the box for them.
        </p>
        <p>
          Before turning protection on, you may want a separate plaintext safety copy of your data (for example an
          export) kept somewhere private, and you should never delete the only backup you can open. Backups and Vault
          Spend package exports made after protection stay encrypted, including copies in the second backup folder,
          which travel with their key file. CSV exports are always plain text, so Vault Spend warns before creating
          one, and any plain file you make or keep yourself is outside protection.
        </p>
      </>
    ),
  },
  {
    question: "Can I restore an old backup after changing my password?",
    tags: ["old password", "older password", "restore", "backup", "change password", "restore backup", "protected backup"],
    answer: (
      <p>
        It depends where the backup is. Changing the password re-protects the backups in the profile&apos;s own
        backups folder, so those open with the new password. A backup copy you kept somewhere else, or set aside
        before the change, still needs the older password it was made under: restoring it asks for that password, and
        once restored, that older password is the profile&apos;s current password again, with the recovery key that
        came with it. Restoring first backs up your current data, so it can be undone.
      </p>
    ),
  },
  {
    question: "When does a protected profile lock automatically?",
    tags: [
      "automatic lock",
      "automatic locking",
      "auto-lock",
      "auto lock",
      "idle",
      "inactivity",
      "timeout",
      "tray",
      "focus",
      "windows session",
      "windows lock",
      "sleep",
      "suspend",
      "lock screen",
    ],
    answer: (
      <>
        <p>
          Automatic locking is set for each protected profile under{" "}
          <strong>Settings → Password protection → Automatic locking</strong>. By default a profile locks after 15
          minutes without activity (choose Off, 1, 5, 15, 30 or 60 minutes). A 10-second warning appears first with a{" "}
          <strong>Stay unlocked</strong> button; when the lock happens, anything you were typing but hadn&apos;t saved
          is discarded.
        </p>
        <p>
          Two more triggers are on by default: <strong>Lock when hidden to the tray</strong> (when the tray option is
          on) and <strong>Lock when Windows locks or sleeps</strong>. <strong>Lock when the window loses focus</strong>{" "}
          is off by default; turn it on if switching to another app should lock the profile. macOS has no equivalent
          of the Windows lock/sleep trigger, so that option is Windows-only. Locking closes the profile&apos;s data connection and returns to the password
          screen, taking a backup first if one is due.
        </p>
      </>
    ),
  },
  {
    question: "Which open-source components does Vault Spend include?",
    tags: ["third-party notices", "notices", "license", "licenses", "open source", "sqlcipher", "openssl", "encryption library", "credits"],
    answer: (
      <>
        <p>
          Vault Spend encrypts protected profiles with SQLCipher, which is built on SQLite and uses OpenSSL. Their
          license and copyright notices are included here in full, so you can read them offline. Icon credits are in
          Settings.
        </p>
        <details className="third-party-notices">
          <summary>Read third-party notices</summary>
          <pre>{thirdPartyNotices}</pre>
        </details>
      </>
    ),
  },
  {
    question: "Where can I read the legal notice?",
    tags: ["legal notice", "legal", "disclaimer", "terms", "conditions", "warranty", "liability", "privacy", "license", "mit", "advice", "estimates"],
    answer: <LegalNoticeHelp />,
  },
  {
    question: "Do bill reminders work while a profile is locked?",
    tags: ["reminders", "reminder", "bill reminders", "locked", "notification", "privacy", "tray", "quit", "maintenance", "recurring"],
    answer: (
      <>
        <p>
          Reminders need Vault Spend to be running. With the tray option on, closing the window keeps it running, and
          choosing Quit from the tray menu stops reminders. While a protected profile is locked, or no profile is
          open, a reminder only says &quot;A bill is due soon in&quot; that profile&apos;s name: no bill name and no
          amount. It comes from the upcoming bills Vault Spend already knew about the last time that profile was
          open, so it does not work out new recurrences while locked.
        </p>
        <p>
          When a profile is open, an unprotected one names the bill; a protected one does so only if you turn on{" "}
          <strong>Show bill names in reminders</strong> in Settings. Routine housekeeping, such as rolling a month
          forward, a goal's automatic monthly contribution and the daily portfolio snapshot, also waits until you unlock
          and then runs.
        </p>
      </>
    ),
  },
  {
    question: "How do the age-based comparisons in Reports work?",
    tags: ["comparisons", "compare", "age", "peers", "benchmark", "income", "savings", "investments", "debt", "spending", "census", "survey", "gross", "take-home", "median", "unavailable"],
    answer: (
      <>
        <p>
          <strong>Reports → Comparisons</strong> lines your income, savings, investments, debt and household spending up
          against official figures from public surveys for people your age. You enter an exact age or an age range once; each card then
          says which survey age group and which people it describes, because every survey draws its own groups. Where
          your range covers several survey age groups you pick the one to compare with, and where none matches a
          closely-related group is used only with a clear Approximate warning.
        </p>
        <p>
          <strong>Income is before tax.</strong> The official incomes are before tax too, so you type your own; Vault Spend never
          guesses it from your take-home pay. Savings, investments and debt come from your accounts in Vault Spend once you
          confirm they are complete, and you can classify accounts or enter a total yourself in the{" "}
          <strong>Your details</strong> panel under the cards on that same page.
        </p>
        <p>
          <strong>Each person&apos;s income.</strong> Everything is compared for your household as a whole. If you enter
          income separately for each person, the Income card&apos;s Explore view also shows each person&apos;s own pay next
          to the typical pay of people their age.
        </p>
        <p>
          The official figures are middle values or averages from past surveys, brought up to the latest prices on file. The
          difference shown is how far you are from that figure, not where you rank. Some official figures only describe
          people who hold the item (a retirement account, a mortgage), and those are labelled; if you hold none, the
          card says it is not comparable instead of comparing you with zero. When the reference data has no figure for a
          comparison, its card says so and nothing is substituted. Everything is calculated on your computer; nothing you enter is uploaded to an online service, and Hide amounts covers these figures too.
        </p>
        <p>
          <strong>Spending</strong> is compared with the U.S. Bureau of Labor Statistics&apos;
          average yearly spending for households whose main earner is your age. It is an average, not a median, so a
          few high spenders pull it up, and it counts insurance and pension contributions as spending. Use the yearly
          total you track here, or type one in <strong>Your details</strong>.
        </p>
      </>
    ),
  },
  {
    question: "Is my data private?",
    tags: ["privacy", "data", "local", "cloud", "security", "offline", "account", "network", "internet", "updates", "live prices"],
    answer: (
      <p>
        Yes. Each profile&apos;s data is stored in files on your own computer, created fresh the first time you
        launch the app. No financial data is uploaded to an online service, so a fresh install on someone else&apos;s computer
        starts completely empty. There is no online service account. If you enable mobile snapshots, approved phones receive read-only copies directly over your private local network. The phone viewer uses local files and makes no cloud or CDN requests. Separately, desktop internet requests do not carry your transactions, balances or account names: it loads its typefaces from
        Google Fonts when it opens, it checks GitHub for a newer version when it opens, and it fetches live
        investment prices only if you set up a price provider. The legal notice lists them in full. You can also
        password-protect any profile (see above).
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
        app for next time. Rules compare merchant names, ignoring store numbers, punctuation and card-processor prefixes such as "SQ *", so a rule learned from one Speedway also covers the others. If a merchant has been filed under more than one category, its rule still suggests your most recent choice but marks it Unsure, so it lands in the review inbox instead of being applied silently. Every rule, built-in and learned, is listed in{" "}
        <strong>Settings → Categorization rules</strong>, where you can add,
        edit, or delete them; before a new rule is saved you'll see how many
        existing transactions it would change and can apply it to them right
        there. The list scrolls inside its own box and can be sorted by any
        column and narrowed by text or by category. A rule never overrides a
        category you set yourself. After you fix one transaction's category,
        you'll be offered to apply the rule to other identical transactions
        too. Importing a file that has its own Category column never adds
        categories on its own: any name you don't already have is listed on
        the review screen, where you can use one of your own categories for
        it, add it as a new one, or let the app guess from your rules. When
        you use one of your own categories for a name, the app remembers
        that choice for your next import, from any account; you can change it
        there each time.
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
        schedule (weekly, biweekly, monthly, or annual) but isn't on
        your list yet. Add it with one click to start it, or dismiss it if it's not
        actually recurring — a dismissed suggestion won't reappear.
      </p>
    ),
  },
  {
    question: "What is a linked transfer, and why link one?",
    tags: ["transfer", "link", "unlink", "savings", "credit card payment", "between accounts", "double count", "auto-link", "automatic"],
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
    question: "Can Vault Spend link transfers for me?",
    tags: ["transfer", "link", "auto-link", "automatic", "auto-linked", "review", "unlink", "looks right"],
    answer: (
      <p>
        Yes, if you turn it on: Settings → Feature toggles → "Link matching
        transfers automatically" (off by default). It only links a pair that
        is clear-cut — equal amounts, opposite directions, different accounts,
        within 3 days, and no other possible match for either side. Anything
        ambiguous (say, one $500 out and two $500 deposits) stays in "possible
        transfers" for you to decide. Turning it on also links the clear-cut
        pairs already in your ledger, and it runs after every import and every
        transaction you add. Each automatic link appears under "N auto-linked
        — review" on Transactions: choose "Looks right" to clear it from the
        list (the link stays) or Unlink if it isn't a transfer — that pair
        won't be linked automatically again, though it can still be linked by
        hand.
      </p>
    ),
  },
  {
    question: "How do the accumulation & projection numbers for a Roth or 529 work?",
    tags: [
      "accumulation",
      "projection",
      "roth",
      "ira",
      "529",
      "contributions",
      "cash invested",
      "worth now",
      "growth",
      "withdraw",
      "withdraw month",
      "return",
      "inflation",
      "today's dollars",
      "spread",
      "drawdown",
      "investment account",
    ],
    answer: (
      <>
        <p>
          Open an investment account's own page (click its row on the Accounts
          tab, or the account's name in the "Accumulation & projection" card on
          the Investments tab). <strong>Cash invested</strong> is the deposits
          you've logged on that account — every money-in counts, and money out
          is shown separately and lowers the net. <strong>Worth now</strong> is
          the same figure the Accounts tab shows, and <strong>Growth</strong>{" "}
          is worth minus what you put in. "What was counted" lists it month by
          month; a month with no deposit shows $0.00.
        </p>
        <p>
          The plan below it has a monthly amount (it starts at your average over
          the last 6 complete months — fewer if the account is newer; type
          another figure to override it, or choose "Reset to average"), an
          assumed annual return %, and a withdraw month. Vault Spend keeps
          investing that flat amount, compounding monthly, and shows what the
          account would be worth at the withdraw month as a dashed line on the
          chart. Fill in "Spread over" a number of years to see the yearly
          withdrawals instead of one lump (each year takes the balance divided
          by the years left). Turn on "Show projected figures in today's
          dollars" to discount the projection by the inflation % — one setting
          shared by every account, 3% to start.
        </p>
        <p>
          The Worth line on the chart only starts the first day Vault Spend
          recorded the account's value (it records it each day you open the
          app), so earlier months aren't drawn and nothing is estimated. The
          projection is an estimate from the numbers you give it, not a
          promise; try a lower return to see how much it moves.
        </p>
      </>
    ),
  },  {
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
    question: "How do I change lots of transactions at once?",
    tags: ["select all", "bulk", "many", "250", "show more", "load more", "batch"],
    answer: (
      <p>
        On the Transactions tab, filter to the rows you want, then tick the box at the top of the
        table. That selects every matching row, including ones further down that aren&apos;t shown
        yet. A change can apply to at most 250 transactions at a time, so with more than that it
        selects the first 250 and says so: make your change, then tick the box again for the next
        250. The table shows rows a few at a time; use <strong>Show 50 more</strong> under it (or
        pick 25, 50 or 100 at a time) to see further down.
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
        your edits (amount, group, or "Warn at 90%") in the current
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
        It sets money aside for the goal every month, for a cost that comes
        once a year or so — insurance, gifts, an annual subscription — and is
        easier to save for a little at a time than all at once. The next time you open the app
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
        Turn it on in a category's ⋯ menu (the row then says "Rolls over")
        and whatever you don't spend there in a month
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
        carries into a later month — the per-category setting and
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
        On Accounts, click a checking or savings account's row (or choose
        Details in its ⋯ menu), enter the statement's ending balance under
        Reconcile with a statement, and start. Tick each
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
        The button at the bottom of the sidebar covers every dollar figure in the app with ••••
        until you press it again, so you can open Vault Spend with someone
        next to you. It hides the numbers, not the shapes of charts or what
        a hover tooltip says. In Settings → Privacy you can also have the
        amounts hidden automatically whenever the window isn't in front.
        Hide amounts changes only what is shown on screen. Use password
        protection to encrypt a profile's stored data.
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
        Yes — on the Transactions tab, choose <strong>Split…</strong> in a transaction's ⋯ menu
        to divide it into as many category/amount lines as you need, each with an optional
        note. <strong>Edit splits…</strong> in the same menu changes them later.
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
        a payment is a <em>positive</em> amount and reduces what's owed; a
        charge or new borrowing is negative and increases it — the same
        convention for both account types. When you add one by hand you don't
        type a sign: choose <strong>Payment</strong> or <strong>Charge</strong> in
        the Add transaction dialog.
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
        Yes — choose <strong>Customize…</strong> from the Layout menu
        and change the layout (pin/unpin widgets, drag to reorder, or
        "+ Add widget…" to pin a specific account/goal/investment
        account) until the Layout menu shows "Custom (unsaved)," then
        click <strong>"+ Save as…"</strong> and give it a name. It's saved
        right alongside the built-in Default/Bills Focus/Investor Focus
        presets — pick it from the same menu any time to switch back,
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
    tags: ["appearance", "theme", "dark mode", "light mode", "default", "futuristic", "transparent", "glass", "retro", "style", "color", "accent", "glow", "neon", "motion", "animation"],
    answer: (
      <p>
        Yes — the Settings tab has an Appearance section with a Light, Dark or
        System switch (also at the bottom of the sidebar) plus three visual styles, each shown
        as a picture you click:{" "}
        <strong>Default</strong> (a frosted-glass look with a translucent,
        blurred sidebar and cards), <strong>Futuristic</strong> (a neon
        style on deep navy with its own type and sidebar icons; pick its
        accent color, Ion Cyan, Rebel Pink, or Ultraviolet, and turn its glow
        up or down with Neon intensity), and{" "}
        <strong>Retro</strong> (gray raised and sunken controls, square
        corners, and navy selection; its Dark mode is a modern adaptation of
        the same look). All three follow the Light/Dark/System toggle. Switching is instant and purely visual —
        nothing about your data changes. <strong>Reduce motion</strong>, in
        the same section, turns off sliding and fading effects in every
        style.
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
            it's attribution, not separation. Manage them with "Manage family
            members…" in the ⋯ More actions menu on the Transactions tab.
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
export function HelpView({ focusTab = null }: { focusTab?: Tab | null }) {
  const [query, setQuery] = useState("");
  // Sections the person opened by hand (or the one a page's ? button asked for). While searching,
  // every matching section is open instead.
  const [openTabs, setOpenTabs] = useState<Set<Tab>>(() => new Set(focusTab ? [focusTab] : []));

  useEffect(() => {
    if (!focusTab) return;
    setOpenTabs((open) => (open.has(focusTab) ? open : new Set(open).add(focusTab)));
    document.getElementById(`help-${focusTab}`)?.scrollIntoView({ block: "start" });
  }, [focusTab]);

  const searching = query.trim() !== "";
  const gettingStartedVisible = matchesQuery(GETTING_STARTED.tags, query);
  const tabHelpVisible = TAB_HELP.filter((h) => tabHelpMatches(h, query));
  const importingVisible = matchesQuery(IMPORTING_ENTRY.tags, query);
  const bulkSetupVisible = matchesQuery(BULK_SETUP_ENTRY.tags, query);
  const exportVisible = EXPORT_ENTRIES.filter((e) => matchesQuery(e.tags, query));
  const faqVisible = FAQ_ENTRIES.filter((e) => matchesQuery(e.tags, query) || e.question.toLowerCase().includes(query.trim().toLowerCase()));

  const nothingMatched =
    searching &&
    !gettingStartedVisible &&
    tabHelpVisible.length === 0 &&
    !importingVisible &&
    !bulkSetupVisible &&
    exportVisible.length === 0 &&
    faqVisible.length === 0;

  function setTabOpen(tab: Tab, open: boolean) {
    setOpenTabs((current) => {
      if (current.has(tab) === open) return current;
      const next = new Set(current);
      if (open) next.add(tab);
      else next.delete(tab);
      return next;
    });
  }

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

      {tabHelpVisible.length > 0 && (
        <div className="card">
          <h2 className="reports-section-title">Help for each page</h2>
          <p className="modal-message-secondary">Open a page's section here, or press the ? beside any page's title.</p>
          <div className="help-tab-list">
            {tabHelpVisible.map((help) => (
              <details
                key={help.tab}
                id={`help-${help.tab}`}
                className="help-tab"
                open={searching || openTabs.has(help.tab)}
                onToggle={(e) => {
                  if (!searching) setTabOpen(help.tab, e.currentTarget.open);
                }}
              >
                <summary>{help.title}</summary>
                <div className="help-tab-body">
                  <p className="help-tab-summary">{help.summary}</p>
                  {help.howTo.map((h) => (
                    <div key={h.question} className="help-howto">
                      <h3>{h.question}</h3>
                      <ol>
                        {h.steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                  {help.more && help.more.length > 0 && (
                    <div className="help-tab-more">
                      <h3>Also on this page</h3>
                      <ul>
                        {help.more.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
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
