//! Holdings entries: a line starting with a ticker, then name text and the numbers in the layout's
//! order (quantity, price, market value). Subtotal lines ("Total …") and one- or two-letter markers
//! are ignored. An entry is complete once its market value is read.

use super::layout::{AmountRules, HoldingField, HoldingRules};
use super::model::StatementHolding;
use super::text::contains_phrase;
use super::tokens::{money_token, parse_number_token};
use rust_decimal::Decimal;

pub fn is_ticker(word: &str) -> bool {
    let mut chars = word.chars();
    let Some(first) = chars.next() else { return false };
    word.len() <= 6 && first.is_ascii_uppercase() && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '.' || c == '-')
}

struct Pending {
    line: usize,
    symbol: String,
    name: Vec<String>,
    next: usize,
    shares: Option<Decimal>,
    price: Option<Decimal>,
    /// Every money amount seen after the quantity, in the order printed. When the price is printed after
    /// the market value, the market value is the amount that equals quantity times price.
    monies: Vec<Decimal>,
}

pub struct HoldingsReader<'l> {
    rules: &'l HoldingRules,
    amounts: &'l AmountRules,
    numeric: Vec<HoldingField>,
    /// The price is printed after the market value, so an entry stays open until its price is read.
    price_after_value: bool,
    pending: Option<Pending>,
    done: Vec<StatementHolding>,
}

impl<'l> HoldingsReader<'l> {
    pub fn new(rules: &'l HoldingRules, amounts: &'l AmountRules) -> Self {
        let numeric: Vec<HoldingField> = rules
            .order
            .iter()
            .copied()
            .filter(|f| matches!(f, HoldingField::Quantity | HoldingField::Price | HoldingField::MarketValue))
            .collect();
        let at = |f: HoldingField| numeric.iter().position(|x| *x == f);
        let price_after_value = matches!((at(HoldingField::MarketValue), at(HoldingField::Price)), (Some(v), Some(p)) if v < p);
        HoldingsReader {
            rules,
            amounts,
            numeric,
            price_after_value,
            pending: None,
            done: Vec::new(),
        }
    }

    pub fn push_line(&mut self, index: usize, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        // A column heading or a subtotal ends the table above it: an entry already holding its amounts is
        // kept, and a description's leftover word is not a new holding.
        let lower = text.to_ascii_lowercase();
        if self.rules.headers.iter().any(|h| contains_phrase(text, h)) || lower.starts_with("total") {
            self.close_pending();
            return;
        }
        let words: Vec<&str> = text.split_whitespace().collect();
        // While an entry waits for its price, a line starting with a ticker and holding more than one word
        // is the next entry; a lone word is the rest of a description.
        if self.pending.as_ref().is_some_and(|p| self.waiting_for_price(p)) && words.len() > 1 && is_ticker(words[0]) {
            self.close_pending();
        }
        if self.pending.is_none() {
            let Some(first) = words.first() else { return };
            if !is_ticker(first) {
                return;
            }
            self.pending = Some(Pending {
                line: index,
                symbol: first.to_string(),
                name: Vec::new(),
                next: 0,
                shares: None,
                price: None,
                monies: Vec::new(),
            });
            let rest = text[first.len()..].to_string();
            self.consume(&rest);
            return;
        }
        self.consume(text);
    }

    fn waiting_for_price(&self, p: &Pending) -> bool {
        self.price_after_value && !p.monies.is_empty() && p.price.is_none()
    }

    /// Ends the entry being read: kept when it already has a quantity and a market value, else dropped.
    fn close_pending(&mut self) {
        if let Some(p) = self.pending.take() {
            self.complete(p);
        }
    }

    fn complete(&mut self, p: Pending) {
        let Some(shares) = p.shares else { return };
        let Some(first) = p.monies.first().copied() else { return };
        let value = match p.price {
            Some(price) => p
                .monies
                .iter()
                .copied()
                .min_by_key(|m| (*m - shares * price).abs())
                .filter(|m| (*m - shares * price).abs() <= (shares * price).abs() / Decimal::from(100))
                .unwrap_or(first),
            None => first,
        };
        self.done.push(StatementHolding {
            line: p.line,
            symbol: p.symbol,
            name: p.name.join(" "),
            shares,
            price: p.price,
            market_value: value,
        });
    }

    fn consume(&mut self, text: &str) {
        for tok in text.split_whitespace() {
            let Some(p) = self.pending.as_mut() else { return };
            match self.numeric.get(p.next) {
                Some(HoldingField::Quantity) if p.shares.is_none() => {
                    if let Some(v) = parse_number_token(tok, self.amounts, self.rules.quantity_decimals) {
                        p.shares = Some(v);
                        p.next += 1;
                        continue;
                    }
                }
                Some(HoldingField::Price) => {
                    if let Some(v) = parse_number_token(tok, self.amounts, self.rules.price_decimals) {
                        p.price = Some(v);
                        p.next += 1;
                        if self.price_after_value && !p.monies.is_empty() {
                            let done = self.pending.take().expect("checked above");
                            self.complete(done);
                            return;
                        }
                        continue;
                    }
                    if self.price_after_value
                        && !p.monies.is_empty()
                        && let Some((v, _)) = money_token(tok, self.amounts)
                    {
                        p.monies.push(v);
                        continue;
                    }
                }
                Some(HoldingField::MarketValue) => {
                    if let Some((v, _)) = money_token(tok, self.amounts) {
                        p.monies.push(v);
                        if self.price_after_value {
                            p.next += 1;
                            continue;
                        }
                        let done = self.pending.take().expect("checked above");
                        self.complete(done);
                        return;
                    }
                }
                _ => {}
            }
            if p.shares.is_none() && tok.len() > 2 && tok.chars().any(|c| c.is_alphabetic()) {
                p.name.push(tok.to_string());
            }
        }
    }

    pub fn finish(mut self) -> Vec<StatementHolding> {
        self.close_pending();
        self.done
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statement::fixture_pdf::fixture_lines;
    use crate::statement::layout::{GENERAL_INVESTMENT_ID, HoldingField, built_in_layouts};
    use crate::statement::sections::read_statement;
    use rust_decimal_macros::dec;

    fn investment() -> crate::statement::layout::StatementLayout {
        built_in_layouts().into_iter().find(|l| l.id == GENERAL_INVESTMENT_ID).unwrap()
    }

    #[test]
    fn holdings_entries_span_several_lines_and_skip_markers() {
        let (lines, period) = fixture_lines("brokerage");
        let s = &read_statement(&lines, &investment(), &period)[0];
        assert_eq!(s.holdings.len(), 2);
        assert_eq!(
            (
                s.holdings[0].symbol.as_str(),
                s.holdings[0].name.as_str(),
                s.holdings[0].shares,
                s.holdings[0].price,
                s.holdings[0].market_value
            ),
            ("ABCD", "ALPHA HOLDINGS INC", dec!(50.000), Some(dec!(339.35)), dec!(16967.50))
        );
        assert_eq!(s.holdings_cash, Some(dec!(1936.81)));
        assert_eq!(s.holdings_total, Some(dec!(21295.70)));
    }

    #[test]
    fn a_leftover_word_before_a_subtotal_is_not_a_holding_and_prose_after_it_adds_nothing() {
        let lpl = built_in_layouts().into_iter().find(|l| l.id == "lpl").unwrap();
        let (rules, amounts) = (lpl.holdings.unwrap(), lpl.amounts);
        assert!(rules.headers.iter().any(|h| h == "Market Value"));
        let mut reader = HoldingsReader::new(&rules, &amounts);
        for (i, line) in [
            "ABCD ALPHA 10.000 $500.00 $50.0000 1.00%",
            "FUND",
            "$1.0000 2.00%",
            "Total $500.00 $1.00",
            "NOTE Dividends are paid in cash.",
            "Description Price Market Value",
            "5.000 $60.00",
        ]
        .iter()
        .enumerate()
        {
            reader.push_line(i, line);
        }
        let holdings = reader.finish();
        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].symbol, "ABCD");
    }

    #[test]
    fn a_different_decimal_count_reads_nothing_until_taught() {
        let (lines, period) = fixture_lines("unknown-brokerage");
        let mut layout = investment();
        let s = &read_statement(&lines, &layout, &period)[0];
        assert!(s.holdings.is_empty());
        assert_eq!(s.holdings_total, Some(dec!(4153.03)));

        let h = layout.holdings.as_mut().unwrap();
        h.quantity_decimals = 4;
        h.price_decimals = 2;
        h.order = vec![
            HoldingField::Symbol,
            HoldingField::Name,
            HoldingField::Quantity,
            HoldingField::Price,
            HoldingField::MarketValue,
        ];
        let s = &read_statement(&lines, &layout, &period)[0];
        assert_eq!(
            s.holdings.iter().map(|h| (h.symbol.as_str(), h.shares)).collect::<Vec<_>>(),
            vec![("QQQZ", dec!(10.5)), ("VTIZ", dec!(4))]
        );
    }

    #[test]
    fn tickers_look_like_tickers() {
        assert!(is_ticker("ABCD") && is_ticker("BRK.B") && is_ticker("C"));
        assert!(!is_ticker("Mutual") && !is_ticker("DEPOSIT") && !is_ticker("50.000") && !is_ticker("$9.47"));
    }
}
