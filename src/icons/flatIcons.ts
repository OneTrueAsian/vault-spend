import accountAvatarProfile1 from "../assets/icons/account-avatar-profile-1.svg";
import accountAvatarProfile2 from "../assets/icons/account-avatar-profile-2.svg";
import accountAvatarProfile3 from "../assets/icons/account-avatar-profile-3.svg";
import accountAvatarProfile4 from "../assets/icons/account-avatar-profile-4.svg";
import accountAvatarProfile5 from "../assets/icons/account-avatar-profile-5.svg";
import accountAvatarProfile6 from "../assets/icons/account-avatar-profile-6.svg";
import accountAvatarProfile7 from "../assets/icons/account-avatar-profile-7.svg";
import accountAvatarProfile8 from "../assets/icons/account-avatar-profile-user-8.svg";
import accountAvatarProfile9 from "../assets/icons/account-avatar-profile-9.svg";
import accountAvatarProfile10 from "../assets/icons/account-avatar-profile-10.svg";
import accountAvatarProfile11 from "../assets/icons/account-avatar-profile-11.svg";
import accountAvatarProfile12 from "../assets/icons/account-avatar-profile-12.svg";
import accountAvatarProfile13 from "../assets/icons/account-avatar-profile-13.svg";
import accountAvatarProfile14 from "../assets/icons/account-avatar-profile-14.svg";
import accountAvatarProfile15 from "../assets/icons/account-avatar-profile-15.svg";
import beautyCategory from "../assets/icons/beauty-category.svg";
import beautyGoal from "../assets/icons/beauty-goals.svg";
import businessCategory from "../assets/icons/business-category.svg";
import carGoal from "../assets/icons/car-goal.svg";
import cashDash from "../assets/icons/cash-dash.svg";
import computerGoal from "../assets/icons/computer-goals.svg";
import creditCardAcct from "../assets/icons/credit-card-acct.svg";
import debtDash from "../assets/icons/debt-dash.svg";
import dogCategory from "../assets/icons/dog-category.svg";
import entertainmentCategory from "../assets/icons/entertainment-category.svg";
import gasCategory from "../assets/icons/gas-category.svg";
import giftsCategory from "../assets/icons/gifts-category.svg";
import groceriesCategory from "../assets/icons/groceries-category.svg";
import healthCategory from "../assets/icons/health-category.svg";
import houseCategory from "../assets/icons/house-category.svg";
import incomeCategory from "../assets/icons/income-category.svg";
import investmentAcct from "../assets/icons/investment-acct.svg";
import moneyCheckingsAcct from "../assets/icons/money-checkings-acct.svg";
import mortgageCategory from "../assets/icons/mortgage-category.svg";
import netWorthDash from "../assets/icons/net-worth-dash.svg";
import realEstateRentCategory from "../assets/icons/real-estate-rent-category.svg";
import restaurantsCategory from "../assets/icons/restaurants-category.svg";
import savingsMoneyAcct from "../assets/icons/savings-money-acct.svg";
import shoppingCategory from "../assets/icons/shopping-category.svg";
import subscriptionCategory from "../assets/icons/subscription-category.svg";
import transferCategory from "../assets/icons/transfer-category.svg";
import travelCategory from "../assets/icons/travel-category.svg";
import utiltyCategory from "../assets/icons/utilty-category.svg";
import warningIcon from "../assets/icons/warning-icon.svg";

/** The full-color icon set the user hand-picked (from svgrepo.com, dropped
 * in `C:\Users\...\Downloads\new Icons`) — kept separate from `nounIcons.ts`
 * because these are a different source with different licensing (no CC BY
 * attribution info is embedded per-file, unlike the Noun Project set, so
 * these are deliberately left out of Settings ▸ Icon credits rather than
 * guessing at an attribution) and, more importantly, a different rendering
 * treatment: `nounIconEntry`'s images get forced to monochrome
 * (`.icon-img`'s `brightness(0)` filter) since that's all the Noun Project
 * assets ever had; these are genuinely multi-color artwork, so
 * `flatIconEntry` renders them via `.icon-img-color` instead — no filter,
 * original colors intact.
 *
 * Each id is the file's own name (already self-documenting: a
 * `<subject>-<where it's used>` scheme — `-category` for transaction/budget
 * categories, `-acct` for account types, `-goal` for savings goals, `-dash`
 * for a Dashboard stat card, `account-avatar-profile-<n>` for the set of
 * generic person-avatar pictures offered as an account icon). */
export type FlatIconId =
  | "account-avatar-profile-1"
  | "account-avatar-profile-2"
  | "account-avatar-profile-3"
  | "account-avatar-profile-4"
  | "account-avatar-profile-5"
  | "account-avatar-profile-6"
  | "account-avatar-profile-7"
  | "account-avatar-profile-8"
  | "account-avatar-profile-9"
  | "account-avatar-profile-10"
  | "account-avatar-profile-11"
  | "account-avatar-profile-12"
  | "account-avatar-profile-13"
  | "account-avatar-profile-14"
  | "account-avatar-profile-15"
  | "beauty-category"
  | "beauty-goal"
  | "business-category"
  | "car-goal"
  | "cash-dash"
  | "computer-goal"
  | "credit-card-acct"
  | "debt-dash"
  | "dog-category"
  | "entertainment-category"
  | "gas-category"
  | "gifts-category"
  | "groceries-category"
  | "health-category"
  | "house-category"
  | "income-category"
  | "investment-acct"
  | "money-checkings-acct"
  | "mortgage-category"
  | "net-worth-dash"
  | "real-estate-rent-category"
  | "restaurants-category"
  | "savings-money-acct"
  | "shopping-category"
  | "subscription-category"
  | "transfer-category"
  | "travel-category"
  | "utilty-category"
  | "warning-icon";

export type FlatIcon = {
  src: string;
  /** Plain-language description of the icon's subject, shown in a swatch's
   * `title`/`aria-label` — not related to where it's used. */
  description: string;
};

export const FLAT_ICONS: Record<FlatIconId, FlatIcon> = {
  "account-avatar-profile-1": { src: accountAvatarProfile1, description: "profile avatar 1 (blue)" },
  "account-avatar-profile-2": { src: accountAvatarProfile2, description: "profile avatar 2 (yellow)" },
  "account-avatar-profile-3": { src: accountAvatarProfile3, description: "profile avatar 3 (green)" },
  "account-avatar-profile-4": { src: accountAvatarProfile4, description: "profile avatar 4 (purple)" },
  "account-avatar-profile-5": { src: accountAvatarProfile5, description: "profile avatar 5 (yellow)" },
  "account-avatar-profile-6": { src: accountAvatarProfile6, description: "profile avatar 6 (blue)" },
  "account-avatar-profile-7": { src: accountAvatarProfile7, description: "profile avatar 7 (teal)" },
  "account-avatar-profile-8": { src: accountAvatarProfile8, description: "profile avatar 8 (slate)" },
  "account-avatar-profile-9": { src: accountAvatarProfile9, description: "profile avatar 9 (purple)" },
  "account-avatar-profile-10": { src: accountAvatarProfile10, description: "profile avatar 10 (teal)" },
  "account-avatar-profile-11": { src: accountAvatarProfile11, description: "profile avatar 11 (slate)" },
  "account-avatar-profile-12": { src: accountAvatarProfile12, description: "profile avatar 12 (red)" },
  "account-avatar-profile-13": { src: accountAvatarProfile13, description: "profile avatar 13 (blue)" },
  "account-avatar-profile-14": { src: accountAvatarProfile14, description: "profile avatar 14 (red)" },
  "account-avatar-profile-15": { src: accountAvatarProfile15, description: "profile avatar 15 (green)" },
  "beauty-category": { src: beautyCategory, description: "lipstick" },
  "beauty-goal": { src: beautyGoal, description: "makeup palette" },
  "business-category": { src: businessCategory, description: "briefcase" },
  "car-goal": { src: carGoal, description: "car" },
  "cash-dash": { src: cashDash, description: "money bag" },
  "computer-goal": { src: computerGoal, description: "laptop computer" },
  "credit-card-acct": { src: creditCardAcct, description: "credit card" },
  "debt-dash": { src: debtDash, description: "bar chart" },
  "dog-category": { src: dogCategory, description: "dog" },
  "entertainment-category": { src: entertainmentCategory, description: "popcorn" },
  "gas-category": { src: gasCategory, description: "gas pump" },
  "gifts-category": { src: giftsCategory, description: "gift box" },
  "groceries-category": { src: groceriesCategory, description: "grocery bag" },
  "health-category": { src: healthCategory, description: "medical cross" },
  "house-category": { src: houseCategory, description: "house" },
  "income-category": { src: incomeCategory, description: "coin with arrow" },
  "investment-acct": { src: investmentAcct, description: "portfolio folder" },
  "money-checkings-acct": { src: moneyCheckingsAcct, description: "cash bills" },
  "mortgage-category": { src: mortgageCategory, description: "house with refinance arrows" },
  "net-worth-dash": { src: netWorthDash, description: "balance scale" },
  "real-estate-rent-category": { src: realEstateRentCategory, description: "rent tag" },
  "restaurants-category": { src: restaurantsCategory, description: "fries" },
  "savings-money-acct": { src: savingsMoneyAcct, description: "piggy bank" },
  "shopping-category": { src: shoppingCategory, description: "shopping cart" },
  "subscription-category": { src: subscriptionCategory, description: "calendar" },
  "transfer-category": { src: transferCategory, description: "exchange arrows" },
  "travel-category": { src: travelCategory, description: "suitcase" },
  "utilty-category": { src: utiltyCategory, description: "utility meter" },
  "warning-icon": { src: warningIcon, description: "warning triangle" },
};
