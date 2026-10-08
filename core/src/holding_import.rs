//! Bounded current-position imports. Quantities stay exact decimals, never floats.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const MAX_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_ROWS: usize = 5_000;
const MAX_COLUMNS: usize = 50;

/// Reject a total that Decimal would round while aligning unequal scales.
pub fn add_values(left: Decimal, right: Decimal) -> Result<Decimal, String> {
    if left.is_sign_negative() || right.is_sign_negative() {
        return Err("Holding values cannot be negative.".into());
    }
    let a = left.normalize();
    let b = right.normalize();
    let mut scale = a.scale().max(b.scale());
    let aligned = |v: Decimal| (v.mantissa() as u128).checked_mul(10u128.pow(scale - v.scale()));
    let mut mantissa = aligned(a)
        .and_then(|n| aligned(b).and_then(|m| n.checked_add(m)))
        .ok_or("The total needs too many digits.")?;
    while scale > 0 && mantissa % 10 == 0 {
        mantissa /= 10;
        scale -= 1;
    }
    if mantissa > (1u128 << 96) - 1 {
        return Err("The total needs too many digits.".into());
    }
    left.checked_add(right).ok_or_else(|| "The total is too large.".into())
}

#[derive(Clone)]
pub struct Source {
    pub headers: Vec<String>,
    pub rows: Vec<(usize, Vec<String>)>,
}

#[derive(Clone, Deserialize)]
pub struct Mapping {
    pub symbol: usize,
    pub name: Option<usize>,
    pub shares: usize,
    pub price: usize,
    pub cost_basis: usize,
    pub asset_class: Option<usize>,
}

#[derive(Clone, Debug, Serialize)]
pub struct HoldingInput {
    pub symbol: String,
    pub name: String,
    pub shares: String,
    pub price: String,
    pub cost_basis: String,
    pub asset_class: Option<String>,
}

impl HoldingInput {
    pub fn value(&self) -> Result<Decimal, String> {
        let (shares, price, _) = self.amounts()?;
        // Decimal multiplication can silently round a result that needs more than
        // 96 mantissa bits / 28 decimal places. Reduce only exact powers of ten
        // before checking capacity, including powers formed across both factors.
        let mut left = shares.mantissa().unsigned_abs();
        let mut right = price.mantissa().unsigned_abs();
        let mut scale = shares.scale() + price.scale();
        while scale > 0 {
            if left % 10 == 0 {
                left /= 10;
            } else if right % 10 == 0 {
                right /= 10;
            } else if left % 2 == 0 && right % 5 == 0 {
                left /= 2;
                right /= 5;
            } else if left % 5 == 0 && right % 2 == 0 {
                left /= 5;
                right /= 2;
            } else {
                break;
            }
            scale -= 1;
        }
        if scale > 28 || left.checked_mul(right).is_none_or(|n| n > (1u128 << 96) - 1) {
            return Err("This holding's value needs too many digits. Reduce the amount or decimal places.".into());
        }
        shares.checked_mul(price).ok_or_else(|| "This holding's value is too large.".into())
    }

    pub fn amounts(&self) -> Result<(Decimal, Decimal, Decimal), String> {
        let shares = normalize_decimal(&self.shares, "Shares")?;
        let price = normalize_decimal(&self.price, "Price")?;
        let cost = normalize_decimal(&self.cost_basis, "What you paid")?;
        if shares <= Decimal::ZERO {
            return Err("Shares must be greater than zero.".into());
        }
        if price <= Decimal::ZERO {
            return Err("Price must be greater than zero.".into());
        }
        if cost < Decimal::ZERO {
            return Err("What you paid cannot be negative.".into());
        }
        Ok((shares, price, cost))
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.symbol.is_empty() || self.symbol.len() > 64 || self.name.len() > 256 || self.asset_class.as_ref().is_some_and(|s| s.len() > 128) {
            return Err("Enter a symbol (up to 64 characters), name (up to 256), and asset class (up to 128).".into());
        }
        if self.symbol.chars().any(|c| c.is_whitespace() || c.is_control()) || self.name.chars().any(|c| c.is_control() && c != '\n') {
            return Err("The symbol cannot contain spaces or control characters.".into());
        }
        self.value()?;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ImportRow {
    pub row_number: usize,
    pub holding: Option<HoldingInput>,
    pub error: Option<String>,
    pub repeated: bool,
    pub already_exists: bool,
    pub value: Option<String>,
}

pub fn parse_source(content: &str, format: &str) -> Result<Source, String> {
    if content.len() > MAX_BYTES {
        return Err("This file is larger than 5 MB. Split it into smaller files.".into());
    }
    let delimiter = match format {
        "csv" => b',',
        "tsv" => b'\t',
        _ => return Err("Choose CSV or tab-separated rows.".into()),
    };
    let content = content.trim_start_matches('\u{feff}');
    let mut reader = csv::ReaderBuilder::new().delimiter(delimiter).from_reader(content.as_bytes());
    let headers = reader
        .headers()
        .map_err(|_| "Could not read the column headings.".to_string())?
        .iter()
        .map(|s| s.trim().to_string())
        .collect::<Vec<_>>();
    if headers.is_empty() || headers.len() > MAX_COLUMNS || headers.iter().any(|s| s.len() > 256) {
        return Err("Use a heading row with at most 50 columns and short column names.".into());
    }
    let mut rows = Vec::new();
    let mut counted_offset = 0;
    let mut row_number = 1;
    for record in reader.records() {
        let record = record.map_err(|e| {
            format!(
                "Could not read row {}. Check its quotes and column count.",
                e.position().map(|p| p.line()).unwrap_or(0)
            )
        })?;
        if record.iter().all(|s| s.trim().is_empty()) {
            continue;
        }
        if rows.len() == MAX_ROWS {
            return Err("Import at most 5,000 holdings at a time. Split this file.".into());
        }
        if record.iter().any(|s| s.len() > 1024) {
            return Err("A cell is longer than 1,024 characters. Shorten it before importing.".into());
        }
        let offset = record.position().map(|p| p.byte() as usize).unwrap_or(0);
        let offset = offset + content.as_bytes()[offset..].iter().take_while(|&&b| b == b'\r' || b == b'\n').count();
        let segment = &content.as_bytes()[counted_offset..offset];
        row_number += segment
            .iter()
            .enumerate()
            .filter(|&(i, &b)| b == b'\n' || (b == b'\r' && segment.get(i + 1) != Some(&b'\n')))
            .count();
        counted_offset = offset;
        rows.push((row_number, record.iter().map(str::to_string).collect()));
    }
    if rows.is_empty() {
        return Err("No holdings found. Include column headings and at least one row.".into());
    }
    Ok(Source { headers, rows })
}

pub fn normalize_decimal(input: &str, label: &str) -> Result<Decimal, String> {
    let text = input.trim().strip_prefix('$').unwrap_or(input.trim()).trim();
    if text.is_empty() {
        return Err(format!("Enter {label}. Unknown values cannot be treated as zero."));
    }
    let unsigned = text.strip_prefix('-').or_else(|| text.strip_prefix('+')).unwrap_or(text);
    let pieces = unsigned.split('.').collect::<Vec<_>>();
    if pieces.len() > 2 || pieces[0].is_empty() || pieces.get(1).is_some_and(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit())) {
        return Err(format!("{label} must be a number using a decimal point."));
    }
    let groups = pieces[0].split(',').collect::<Vec<_>>();
    if groups.iter().any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
        || (groups.len() > 1 && (groups[0].len() > 3 || groups[1..].iter().any(|s| s.len() != 3)))
    {
        return Err(format!("{label} must be a number such as 1234.50; comma decimals are not supported."));
    }
    let normalized = text.replace(',', "");
    // rust_decimal's permissive parser can round excessive fractional precision.
    let value = Decimal::from_str_exact(&normalized).map_err(|_| format!("{label} has too many digits or is not a supported number."))?;
    Ok(value)
}

pub fn map_rows(source: &Source, mapping: &Mapping) -> Result<Vec<ImportRow>, String> {
    let columns = [
        Some(mapping.symbol),
        mapping.name,
        Some(mapping.shares),
        Some(mapping.price),
        Some(mapping.cost_basis),
        mapping.asset_class,
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    if columns.iter().any(|&i| i >= source.headers.len()) || columns.iter().copied().collect::<HashSet<_>>().len() != columns.len() {
        return Err("Choose a different source column for each field.".into());
    }
    let mut rows = Vec::new();
    let mut counts = HashMap::<String, usize>::new();
    for (row_number, cells) in &source.rows {
        let field = |index: usize| cells[index].trim();
        let optional = |index: Option<usize>| index.map(field).filter(|s| !s.is_empty()).map(str::to_string);
        let symbol = field(mapping.symbol).to_uppercase();
        let result = (|| {
            let holding = HoldingInput {
                name: optional(mapping.name).unwrap_or_else(|| symbol.clone()),
                symbol: symbol.clone(),
                shares: normalize_decimal(field(mapping.shares), "Shares")?.to_string(),
                price: normalize_decimal(field(mapping.price), "Price")?.to_string(),
                cost_basis: normalize_decimal(field(mapping.cost_basis), "What you paid")?.to_string(),
                asset_class: optional(mapping.asset_class),
            };
            holding.validate()?;
            Ok::<_, String>(holding)
        })();
        *counts.entry(symbol).or_default() += 1;
        let (holding, error, value) = match result {
            Ok(h) => {
                let value = h.value()?.to_string();
                (Some(h), None, Some(value))
            }
            Err(error) => (None, Some(error), None),
        };
        rows.push(ImportRow {
            row_number: *row_number,
            holding,
            error,
            repeated: false,
            already_exists: false,
            value,
        });
    }
    for row in &mut rows {
        row.repeated = row.holding.as_ref().is_some_and(|h| counts[&h.symbol] > 1);
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping() -> Mapping {
        Mapping {
            symbol: 0,
            name: Some(1),
            shares: 2,
            price: 3,
            cost_basis: 4,
            asset_class: Some(5),
        }
    }

    #[test]
    fn csv_bom_quotes_fractional_shares_and_optional_fields() {
        let source = parse_source(
            "\u{feff}Ticker,Name,Quantity,Price,Total Cost,Class\r\nvti,\"Fund, total\",0.125,100.10,10,\r\n",
            "csv",
        )
        .unwrap();
        let rows = map_rows(&source, &mapping()).unwrap();
        let h = rows[0].holding.as_ref().unwrap();
        assert_eq!(
            (
                h.symbol.as_str(),
                h.name.as_str(),
                h.shares.as_str(),
                h.value().unwrap().to_string().as_str()
            ),
            ("VTI", "Fund, total", "0.125", "12.51250")
        );
        assert_eq!(h.asset_class, None);
        assert_eq!(rows[0].row_number, 2);
    }

    #[test]
    fn tsv_and_blank_name_preserve_unknown_class() {
        let source = parse_source("Symbol\tName\tShares\tPrice\tCost\tClass\nabc\t\t2\t10\t0\t\n", "tsv").unwrap();
        let row = map_rows(&source, &mapping()).unwrap().remove(0);
        let holding = row.holding.unwrap();
        assert_eq!(holding.name, "ABC");
        assert_eq!(holding.cost_basis, "0");
    }

    #[test]
    fn invalid_rows_are_visible_with_source_numbers() {
        let source = parse_source("S,N,Q,P,C,A\na,,0,10,1,\nb,,1,NaN,1,\nc,,1,10,,\nd,,1,10,-1,\n", "csv").unwrap();
        let rows = map_rows(&source, &mapping()).unwrap();
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|r| r.error.is_some() && r.holding.is_none()));
        assert_eq!(rows[3].row_number, 5);
    }

    #[test]
    fn repeated_symbols_are_flagged_after_normalization() {
        let source = parse_source("S,N,Q,P,C,A\nvti,,1,10,1,\n VTI ,,2,10,2,\n", "csv").unwrap();
        assert!(map_rows(&source, &mapping()).unwrap().iter().all(|r| r.repeated));
    }

    #[test]
    fn mapping_cannot_reuse_a_column_or_reference_a_missing_one() {
        let source = parse_source("S,N,Q,P,C,A\na,,1,10,1,\n", "csv").unwrap();
        let mut m = mapping();
        m.shares = m.price;
        assert!(map_rows(&source, &m).is_err());
        m = mapping();
        m.symbol = 100;
        assert!(map_rows(&source, &m).is_err());
    }

    #[test]
    fn oversize_sources_and_malformed_rows_are_refused() {
        assert!(parse_source(&"x".repeat(MAX_BYTES + 1), "csv").is_err());
        assert!(parse_source("a,b\n1,2,3\n", "csv").is_err());
        assert!(parse_source("a,b\n1,2\n", "xlsx").is_err());
    }

    #[test]
    fn currency_grouping_is_explicit_and_ambiguous_decimals_are_rejected() {
        assert_eq!(normalize_decimal("$1,234.50", "Price").unwrap().to_string(), "1234.50");
        assert!(normalize_decimal("12,34", "Price").is_err());
        assert!(normalize_decimal("1e3", "Shares").is_err());
    }

    #[test]
    fn overflowing_position_values_are_refused() {
        let source = parse_source("S,N,Q,P,C,A\na,,79228162514264337593543950335,2,1,\n", "csv").unwrap();
        assert!(map_rows(&source, &mapping()).unwrap()[0].error.is_some());
    }

    #[test]
    fn position_value_cannot_silently_round_or_underflow() {
        for (shares, price) in [("0.0000000000000000000000000001", "0.1"), ("100000000000000.1", "100000000000000.1")] {
            let source = parse_source(&format!("S,N,Q,P,C,A\na,,{shares},{price},0,\n"), "csv").unwrap();
            assert!(map_rows(&source, &mapping()).unwrap()[0].error.is_some());
        }
        let source = parse_source("S,N,Q,P,C,A\na,,0.0000000000000000000000000002,0.5,0,\n", "csv").unwrap();
        assert_eq!(
            map_rows(&source, &mapping()).unwrap()[0].value.as_deref(),
            Some("0.0000000000000000000000000001")
        );
    }

    #[test]
    fn totals_cannot_silently_drop_fractional_holdings() {
        assert!(add_values(Decimal::MAX, Decimal::new(1, 1)).is_err());
        assert_eq!(add_values(Decimal::new(5, 3), Decimal::new(5, 3)).unwrap().to_string(), "0.010");
    }

    #[test]
    fn row_ids_follow_physical_lines_for_cr_only_and_quoted_multiline_files() {
        for text in ["S,N,Q,P,C,A\ra,,1,1,1,\rb,,1,1,1,\r", "S,N,Q,P,C,A\na,,1,1,1,\nb,,1,1,1,\n"] {
            let source = parse_source(text, "csv").unwrap();
            assert_eq!(source.rows.iter().map(|(n, _)| *n).collect::<Vec<_>>(), vec![2, 3]);
        }
        let source = parse_source("S,N,Q,P,C,A\r\na,\"two\r\nlines\",1,1,1,\r\nb,,1,1,1,\r\n", "csv").unwrap();
        assert_eq!(source.rows.iter().map(|(n, _)| *n).collect::<Vec<_>>(), vec![2, 4]);
    }

    #[test]
    fn row_limit_accepts_a_full_batch_and_rejects_the_next_row() {
        let mut text = "S,N,Q,P,C,A\n".to_string() + &"a,,1,1,1,\n".repeat(MAX_ROWS);
        assert_eq!(parse_source(&text, "csv").unwrap().rows.len(), MAX_ROWS);
        text.push_str("a,,1,1,1,\n");
        assert!(parse_source(&text, "csv").is_err());
    }
}
