use super::layout::{AmountRules, HoldingRules};
use super::model::StatementHolding;

pub struct HoldingsReader<'l> {
    _rules: &'l HoldingRules,
    _amounts: &'l AmountRules,
}

impl<'l> HoldingsReader<'l> {
    pub fn new(rules: &'l HoldingRules, amounts: &'l AmountRules) -> Self {
        HoldingsReader {
            _rules: rules,
            _amounts: amounts,
        }
    }
    pub fn push_line(&mut self, _index: usize, _text: &str) {}
    pub fn finish(self) -> Vec<StatementHolding> {
        Vec::new()
    }
}
