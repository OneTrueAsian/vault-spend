//! Matching a person's age (or age band) to the age cohorts a source actually published. There is
//! no single "25-34" rule: every source has its own bands, and this module never invents or
//! interpolates one. A substitute cohort is only ever offered as an explicit, flagged result.
use super::types::{AgeInput, Reference};

#[derive(Debug)]
pub enum CohortMatch<'a> {
    /// A published cohort that contains the whole input.
    Exact(&'a Reference),
    /// No cohort contains the input; this is the uniquely nearest one (or the only one that
    /// partly overlaps a band). `distance` is in years to its nearest boundary, 0 for a partial
    /// overlap. The caller must show it as an approximation.
    Nearest { reference: &'a Reference, distance: u32 },
    /// Several cohorts qualify and the person must pick one. `approximate` is true when they are
    /// tied substitutes rather than published cohorts the band genuinely spans.
    ChoiceRequired { options: Vec<&'a Reference>, approximate: bool },
    None,
}

fn upper(r: &Reference) -> u64 {
    r.age_max.map_or(u64::MAX, u64::from)
}

/// Years between a cohort and an age span `[lo, hi]` (`hi == u64::MAX` for open); 0 if they touch.
fn gap(r: &Reference, lo: u64, hi: u64) -> u64 {
    let r_lo = u64::from(r.age_min);
    if hi < r_lo {
        r_lo - hi
    } else if lo > upper(r) {
        lo - upper(r)
    } else {
        0
    }
}

pub fn match_cohort<'a>(candidates: &[&'a Reference], age: AgeInput) -> CohortMatch<'a> {
    if candidates.is_empty() {
        return CohortMatch::None;
    }
    let mut sorted: Vec<&'a Reference> = candidates.to_vec();
    sorted.sort_by_key(|r| (r.age_min, r.age_max));

    let (lo, hi) = age.span();
    let (lo, hi) = (u64::from(lo), hi.map_or(u64::MAX, u64::from));

    let overlapping: Vec<&'a Reference> =
        sorted.iter().copied().filter(|r| u64::from(r.age_min) <= hi && lo <= upper(r)).collect();

    match overlapping.as_slice() {
        [only] => {
            let covers = u64::from(only.age_min) <= lo && upper(only) >= hi;
            return if covers {
                CohortMatch::Exact(only)
            } else {
                CohortMatch::Nearest { reference: only, distance: 0 }
            };
        }
        [] => {}
        many => return CohortMatch::ChoiceRequired { options: many.to_vec(), approximate: false },
    }

    // Nothing overlaps: take the uniquely nearest cohort, or ask when neighbours tie.
    let distances: Vec<u64> = sorted.iter().map(|r| gap(r, lo, hi)).collect();
    let nearest = distances.iter().copied().min().unwrap_or(0);
    let tied: Vec<&'a Reference> =
        sorted.iter().zip(&distances).filter(|(_, d)| **d == nearest).map(|(r, _)| *r).collect();
    match tied.as_slice() {
        [one] => CohortMatch::Nearest { reference: one, distance: nearest as u32 },
        _ => CohortMatch::ChoiceRequired { options: tied, approximate: true },
    }
}
