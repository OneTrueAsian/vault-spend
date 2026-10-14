//! A tiny PDF writer for tests, and fictional statements copying the shapes of real layouts. Each line
//! is drawn by its own text operation at its own height, in order, so the PDF's content order is exactly
//! the order given. No real names, institutions, account numbers or amounts appear here.

use super::model::{Period, StatementLine};
use chrono::NaiveDate;

pub fn build_pdf(pages: &[Vec<String>]) -> Vec<u8> {
    let mut objects: Vec<String> = Vec::new();
    let page_ids: Vec<usize> = (0..pages.len()).map(|i| 4 + i * 2).collect();
    objects.push("<< /Type /Catalog /Pages 2 0 R >>".into());
    objects.push(format!(
        "<< /Type /Pages /Kids [{}] /Count {} >>",
        page_ids.iter().map(|id| format!("{id} 0 R")).collect::<Vec<_>>().join(" "),
        pages.len()
    ));
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".into());
    for (i, lines) in pages.iter().enumerate() {
        assert!(lines.len() <= 60, "fixture pages hold at most 60 lines");
        objects.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
            page_ids[i] + 1
        ));
        let mut stream = String::from("BT\n/F1 9 Tf\n");
        for (n, line) in lines.iter().enumerate() {
            let y = 760 - (n as i64) * 12;
            stream.push_str(&format!("1 0 0 1 40 {y} Tm\n({}) Tj\n", escape(line)));
        }
        stream.push_str("ET\n");
        objects.push(format!("<< /Length {} >>\nstream\n{}endstream", stream.len(), stream));
    }
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes());
    out
}

fn escape(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().filter(|c| c.is_ascii() && !c.is_control()) {
        if matches!(c, '(' | ')' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

pub const FIXTURE_NAMES: &[&str] = &[
    "card-a",
    "card-b",
    "card-c",
    "credit-union",
    "mortgage",
    "brokerage",
    "brokerage-quarterly",
    "unknown-bank",
    "unknown-bank-next",
    "unknown-brokerage",
    "unknown-brokerage-next",
];

fn d(s: &str) -> NaiveDate {
    s.parse().expect("fixture dates are valid")
}

fn page(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|s| s.to_string()).collect()
}

/// A fixture's pages (one list of lines per page) and the period it covers.
pub type FixtureStatement = (Vec<Vec<String>>, (NaiveDate, NaiveDate));

pub fn fixture(name: &str) -> Option<FixtureStatement> {
    Some(match name {
        // A card: "Previous/New Balance", MM/DD/YY dates with a posting marker, the amount on its own line.
        "card-a" => (
            vec![
                page(&[
                    "Northwind Card Services",
                    "Closing Date 08/21/26",
                    "New Balance",
                    "$52.36",
                    "Payment Due Date 09/15/26",
                    "Previous Balance $43.08",
                    "Payments/Credits -$43.08",
                ]),
                page(&[
                    "Payments and Credits",
                    "Detail *Indicates posting date",
                    "08/05/26* AUTOPAY PAYMENT RECEIVED - THANK YOU",
                    "Sample Bank Branch",
                    "-$43.08",
                    "New Charges",
                    "07/24/26 STREAMING SERVICE INTERNET CHARGE CA",
                    "MUSIC STORE",
                    "$7.40",
                    "07/27/26 STREAMING SERVICE INTERNET CHARGE CA",
                    "$2.99",
                    "08/17/26 CLOUD STORAGE INTERNET CHARGE CA",
                    "$11.99",
                    "08/20/26 VIDEO SERVICE SANTA MONICA CA",
                    "$19.99",
                    "08/20/26 HOME CAMERA PLAN HAWTHORNE CA",
                    "$9.99",
                    "Total Fees for this Period $0.00",
                    "09/05/26. This date may not be the same date your bank will debit your",
                ]),
            ],
            (d("2026-07-22"), d("2026-08-21")),
        ),
        // A card: MM/DD without a year, amounts without "$", a rewards-points column and order-number lines,
        // plus a rewards section that repeats a purchase and must be skipped.
        "card-b" => (
            vec![page(&[
                "ACCOUNT SUMMARY",
                "Previous Balance $33.33",
                "Payment, Credits -$33.33",
                "New Balance $34.90",
                "Opening/Closing Date 04/27/26 - 05/26/26",
                "ACCOUNT ACTIVITY",
                "PAYMENTS AND OTHER CREDITS",
                "04/30 Payment Thank You - Web -33.33",
                "PURCHASE",
                "05/05 ONLINE MARKET*AB12 Market.example/bill WA 33.91",
                "Order Number 111-2222222-3333333",
                "05/12 AUDIOBOOKS*XY Market.example/bill NJ .99",
                "Order Number D01-4444444-5555555",
                "REWARDS ACTIVITY",
                "04/26 ONLINE MARKET MARKET.EXAMPLE/BILLWA 8.64 864",
            ])],
            (d("2026-04-27"), d("2026-05-26")),
        ),
        // A card: "Mon D Mon D" transaction and posting dates, payments as "- $1,234.56".
        "card-c" => (
            vec![page(&[
                "Previous Balance $3,651.55",
                "Payments - $9,775.23",
                "New Balance = $1,442.49",
                "Jul 25, 2026 - Aug 24, 2026 | 31 days in Billing Cycle",
                "Payments, Credits and Adjustments",
                "Trans Date Post Date Description Amount",
                "Jul 31 Jul 31 ONLINE PAYMENT - $3,975.23",
                "Aug 10 Aug 10 ONLINE PAYMENT - $5,800.00",
                "Transactions",
                "Jul 27 Jul 28 FOOD DELIVERY HELP.EXAMPLE CA $44.90",
                "Jul 30 Jul 31 ADOPTION SERVICES GA $5,798.00",
                "Aug 2 Aug 3 WAREHOUSE CLUB #100 SPRINGFIELD MI $70.54",
                "Aug 4 Aug 4 AI ASSISTANT SUB EXAMPLE.COM CA $20.00",
                "Aug 16 Aug 18 GROCERY STORE #020 SPRINGFIELD MI $142.09",
                "Aug 18 Aug 19 VIDEO PRIME*F48 Market.example/bill WA $1,490.64",
            ])],
            (d("2026-07-25"), d("2026-08-24")),
        ),
        // Several accounts in one statement, brackets for money out, a running balance after each amount.
        "credit-union" => (
            vec![page(&[
                "Statement Period 08/01/2026 - 08/31/2026",
                "MEMBER SAVINGS Share Account ID 00",
                "Aug 01 Beginning Balance $6.44",
                "Aug 31 Ending Balance $6.44",
                "EVERYDAY CHECKING Share Account ID 01",
                "Total Deposits $130.00",
                "Total Withdrawals $41.81",
                "Trans Eff Date Transaction Withdrawal Deposit Balance",
                "Aug 01 Beginning Balance $155.05",
                "Aug 06 Aug 06 Withdrawal Debit Card Debit Card",
                "2400000000000001 CORNER CAFE",
                "MI 08/06/2026",
                "($10.84) $144.21",
                "Aug 07 Aug 07 Deposit ACH EXAMPLE EMPLOYER TYPE: PAYROLL",
                "$65.00 $209.21",
                "Aug 13 Aug 13 Withdrawal Bill Payment MUSIC SERVICE",
                "($0.99) $208.22",
                "Aug 21 Aug 21 Deposit ACH EXAMPLE EMPLOYER TYPE: PAYROLL",
                "$65.00 $273.22",
                "Aug 24 Aug 24 Withdrawal Debit Card Debit Card",
                "2400000000000002 WING PLACE",
                "($29.98) $243.24",
                "Aug 31 Ending Balance $243.24",
            ])],
            (d("2026-08-01"), d("2026-08-31")),
        ),
        // A home loan: an ending principal only, and a payment split into columns with the total last.
        "mortgage" => (
            vec![page(&[
                "HOME LOAN STATEMENT",
                "Payment Due Date 10/01/2026",
                "Principal $356.80",
                "Interest $1,452.18",
                "Regular Monthly Payment $2,405.94",
                "Outstanding Principal $316,840.29",
                "Escrow Balance $2,144.35",
                "Transaction Activity (08/18/2026 to 09/16/2026)",
                "Date Description Principal Interest Escrow Total",
                "09/01/26 Payment $355.17 $1,453.81 $596.96 $2,405.94",
                "09/10/26 Mortgage Insurance",
                "($85.12) ($85.12)",
            ])],
            (d("2026-08-18"), d("2026-09-16")),
        ),
        "brokerage" => (brokerage(false), (d("2026-08-01"), d("2026-08-31"))),
        "brokerage-quarterly" => (brokerage(true), (d("2026-08-01"), d("2026-08-31"))),
        // An unknown bank: day-first dates, money out printed positive, money in marked CR.
        "unknown-bank" => (unknown_bank("08", "1,250.00", "3,132.00"), (d("2026-08-01"), d("2026-08-31"))),
        "unknown-bank-next" => (unknown_bank("09", "3,132.00", "5,014.00"), (d("2026-09-01"), d("2026-09-30"))),
        // An unknown brokerage: cash balances, "Total Market Value", four-decimal quantities, prices with two.
        "unknown-brokerage" => (unknown_brokerage("08"), (d("2026-08-01"), d("2026-08-31"))),
        "unknown-brokerage-next" => (unknown_brokerage("09"), (d("2026-09-01"), d("2026-09-30"))),
        _ => return None,
    })
}

fn brokerage(quarterly: bool) -> Vec<Vec<String>> {
    let mut activity = vec![
        "Activity Summary",
        "Total Additions $53.68 $119.03 $75,063.68",
        "Total Subtractions ($9.98) ($9,559.36) ($73,126.87)",
        "Activity Details",
        "Date Security ID / Description Transaction Amount",
    ];
    if quarterly {
        activity.push("07/16 ABCD ALPHA HOLDINGS INC CL A Bought 10.000 at $43.62 ($436.15)");
        activity.push("07/16 EFGH EXAMPLE INCOME FUND CL I2 Bought 38.528 at $9.59 ($369.48)");
    }
    activity.extend([
        "08/03 EFGH EXAMPLE INCOME FUND CL I2 REINVEST AT 9.470 Dividend Reinvest Quantity 1.054 ($9.98)",
        "08/03 EFGH EXAMPLE INCOME FUND CL I2 073126 251.46900 AS OF",
        "Cash Dividend $9.98",
        "08/05 IJKL CORE BOND ETF 080526 97 Cash Dividend $18.50",
        "08/07 MNOP SHORT BOND ETF 080726 100 Cash Dividend $17.58",
        "08/10 QRST FREE CASH FLOW ETF 081026 50 Cash Dividend $1.67",
        "08/28 UVWX LARGE CAP DIVIDEND ETF 082826 42 Cash Dividend $5.46",
        "08/31 DEPOSIT CASH ACCOUNT 083126 1,936 Interest $0.49",
        "Cash Sweep Activity",
        "Date Description Transaction Amount",
        "08/03 DEPOSIT CASH ACCOUNT Sweep (Deposit) $9.98",
        "08/05 DEPOSIT CASH ACCOUNT Sweep (Deposit) $18.50",
    ]);
    vec![
        page(&[
            "Portfolio Summary August 2026",
            "Starting Value $94,870.66 $0.00",
            "Portfolio Ending Value $95,312.79 $95,312.79",
            "Account Summary",
            "Growth Account",
            "Starting Value $83,349.13 $83,863.17 $0.00",
            "Total Ending Value $84,089.71 $84,089.71 $84,089.71",
            "Account Holdings",
            "Cash and Cash Equivalents",
            "Total Cash and Cash Equivalents $1,936.81",
            "Security ID / Description Quantity Price Market Value",
            "ABCD ALPHA HOLDINGS INC CL A",
            "C",
            "50.000",
            "$339.3500",
            "$16,967.50 $44.00",
            "0.26%",
            "EFGH EXAMPLE INCOME FUND CL",
            "I2",
            "252.523",
            "$9.4700",
            "$2,391.39 $115.00",
            "Total Account Holdings",
            "Market Value",
            "$21,295.70 $159.00",
        ]),
        page(&activity),
        page(&[
            "Account Summary",
            "Income Account",
            "Starting Value $10,951.09 $11,007.49 $0.00",
            "Total Ending Value $11,223.08 $11,223.08 $11,223.08",
            "Account Holdings",
            "YZAB TREASURY ETF",
            "20.000",
            "$50.0000",
            "$1,000.00 $30.00",
            "Total Account Holdings",
            "Market Value",
            "$1,000.00 $30.00",
            "Activity Summary",
            "Total Additions $7.95 $15.29 $13,165.02",
            "Total Subtractions ($1.81) ($714.14) ($12,381.39)",
            "Activity Details",
            "08/15 YZAB TREASURY ETF 081526 20 Cash Dividend $7.95",
            "08/31 ADVISORY FEE ($1.81)",
            "Cash Sweep Activity",
            "08/15 DEPOSIT CASH ACCOUNT Sweep (Deposit) $7.95",
        ]),
    ]
}

fn unknown_bank(month: &str, opening: &str, closing: &str) -> Vec<Vec<String>> {
    let line = |day: &str, rest: &str| format!("{day}/{month}/2026 {rest}");
    vec![vec![
        "Riverbend Mutual Bank".into(),
        "Everyday Account Statement".into(),
        format!("Opening balance {opening}"),
        "Date Details Amount".into(),
        line("03", "Supermarket purchase 54.20"),
        line("05", "Salary EXAMPLE EMPLOYER 2,000.00 CR"),
        line("12", "Electricity bill 120.35"),
        line("19", "Pharmacy 18.45"),
        line("27", "Transfer received 75.00 CR"),
        format!("Closing balance {closing}"),
    ]]
}

fn unknown_brokerage(month: &str) -> Vec<Vec<String>> {
    vec![vec![
        "Harborview Investing".into(),
        "Account Summary".into(),
        "Brokerage Account".into(),
        "Beginning Cash Balance $500.00".into(),
        "Ending Cash Balance $1,212.40".into(),
        "Holdings".into(),
        "Symbol Description Quantity Price Value".into(),
        "QQQZ NASDAQ TRACKER FUND".into(),
        "10.5000 $300.25 $3,152.63".into(),
        "VTIZ TOTAL MARKET FUND".into(),
        "4.0000 $250.10 $1,000.40".into(),
        "Total Market Value $4,153.03".into(),
        "Activity".into(),
        format!("{month}/02/2026 Deposit from bank $1,000.00"),
        format!("{month}/09/2026 Bought QQQZ 1.0000 at $300.10 -$300.10"),
        format!("{month}/20/2026 Dividend VTIZ $12.50"),
    ]]
}

/// The fixture's pages flattened into lines, for parser tests that skip the PDF step.
pub fn fixture_lines(name: &str) -> (Vec<StatementLine>, Period) {
    let (pages, (start, end)) = fixture(name).unwrap_or_else(|| panic!("no fixture {name}"));
    let lines = pages
        .iter()
        .enumerate()
        .flat_map(|(page, lines)| lines.iter().map(move |text| StatementLine { page, text: text.clone() }))
        .collect();
    (lines, Period::new(start, end).expect("fixture periods are valid"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pdf_is_well_formed_enough_to_find_its_cross_reference_table() {
        let pdf = build_pdf(&[vec!["Hello (world)".into(), "Second line".into()]]);
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.4"));
        let startxref: usize = text.rsplit("startxref\n").next().unwrap().lines().next().unwrap().parse().unwrap();
        assert!(text[startxref..].starts_with("xref"));
        assert!(text.contains("(Hello \\(world\\)) Tj"));
    }

    #[test]
    fn every_fixture_has_a_period_and_lines() {
        for name in FIXTURE_NAMES {
            let (lines, period) = fixture_lines(name);
            assert!(!lines.is_empty(), "{name}");
            assert!(period.start <= period.end, "{name}");
        }
        assert!(fixture("no-such-fixture").is_none());
    }
}
