import carInsurance from "../assets/icons/car-insurance.png";
import checking from "../assets/icons/checking.png";
import creditCard from "../assets/icons/credit-card.png";
import electric from "../assets/icons/electric.png";
import fuel from "../assets/icons/fuel.png";
import giftGoal from "../assets/icons/gift-goal.png";
import groceries from "../assets/icons/groceries.png";
import homeGoal from "../assets/icons/home-goal.png";
import internet from "../assets/icons/internet.png";
import investment from "../assets/icons/investment.png";
import laptopGoal from "../assets/icons/laptop-goal.png";
import loan from "../assets/icons/loan.png";
import music from "../assets/icons/music.png";
import phone from "../assets/icons/phone.png";
import rent from "../assets/icons/rent.png";
import restaurant from "../assets/icons/restaurant.png";
import salary from "../assets/icons/salary.png";
import savings from "../assets/icons/savings.png";
import shopping from "../assets/icons/shopping.png";
import streaming from "../assets/icons/streaming.png";
import subscription from "../assets/icons/subscription.png";
import transport from "../assets/icons/transport.png";
import travelGoal from "../assets/icons/travel-goal.png";
import water from "../assets/icons/water.png";

/** Every bundled Noun Project icon this app actually uses, in one place —
 * the asset itself and its attribution live on the same entry, so there's
 * no way for one to exist without the other (the old split between
 * accountIcons.tsx/categoryIcons.tsx/bucketIcons.tsx each importing their
 * own PNGs, and a separately hand-maintained credits list, made it easy to
 * add or remove an icon in one place and forget the other). Each is
 * licensed CC BY 3.0 (thenounproject.com's "creative-commons-attribution"
 * tier), which requires crediting the work and its creator — see
 * `credits.ts`, which derives Settings ▸ Icon credits from this list
 * directly instead of keeping its own copy.
 *
 * `accountIcons.tsx`/`categoryIcons.tsx`/`bucketIcons.tsx` reference these
 * by id rather than importing PNGs themselves — this is the only file in
 * the app that touches `assets/icons/*.png` directly. Adding a new bundled
 * icon means adding one entry here (asset + credit together) and then
 * wiring its id into whichever of those three lookup tables wants it.
 *
 * These are all monochrome (Noun Project's free CC BY 3.0 tier ships plain
 * black glyphs, not colored artwork) — see `flatIcons.ts` for the separate,
 * full-color set used where the user specifically picked icons for their
 * color. */
export type NounIconId =
  | "car-insurance"
  | "checking"
  | "credit-card"
  | "electric"
  | "fuel"
  | "gift-goal"
  | "groceries"
  | "home-goal"
  | "internet"
  | "investment"
  | "laptop-goal"
  | "loan"
  | "music"
  | "phone"
  | "rent"
  | "restaurant"
  | "salary"
  | "savings"
  | "shopping"
  | "streaming"
  | "subscription"
  | "transport"
  | "travel-goal"
  | "water";

export type NounIcon = {
  src: string;
  /** Plain-language description of the icon's subject, e.g. "grocery cart"
   * — shown in Settings ▸ Icon credits, not related to where it's used. */
  description: string;
  nounProjectId: string;
  author: string;
};

export const NOUN_ICONS: Record<NounIconId, NounIcon> = {
  "car-insurance": { src: carInsurance, description: "car insurance", nounProjectId: "773642", author: "Gregor Cresnar" },
  checking: { src: checking, description: "bank account", nounProjectId: "8453773", author: "Arkinasi" },
  "credit-card": { src: creditCard, description: "Credit Card", nounProjectId: "8013675", author: "MBR" },
  electric: { src: electric, description: "Lightning Bolt", nounProjectId: "5628461", author: "Jasmine" },
  fuel: { src: fuel, description: "gas pump", nounProjectId: "6563145", author: "archer7" },
  "gift-goal": { src: giftGoal, description: "Gift", nounProjectId: "8112521", author: "Andi wiyanto" },
  groceries: { src: groceries, description: "grocery cart", nounProjectId: "4747051", author: "popcornarts" },
  "home-goal": { src: homeGoal, description: "home improvement", nounProjectId: "7899801", author: "Icon Designer" },
  internet: { src: internet, description: "wifi", nounProjectId: "8289480", author: "SAADI ALA" },
  investment: { src: investment, description: "investment", nounProjectId: "8473137", author: "Ilyas Aji Furqon" },
  "laptop-goal": { src: laptopGoal, description: "Laptop", nounProjectId: "8451274", author: "diyah farida" },
  loan: { src: loan, description: "loan", nounProjectId: "8464725", author: "waqiahtul mukarromah" },
  music: { src: music, description: "Music Note", nounProjectId: "683649", author: "Knockout Prezo" },
  phone: { src: phone, description: "phone bill", nounProjectId: "8082807", author: "huijae Jang" },
  rent: { src: rent, description: "house payment", nounProjectId: "8191685", author: "Ahmad Roaayala" },
  restaurant: { src: restaurant, description: "Restaurant", nounProjectId: "8464669", author: "LUTFI GANI AL ACHMAD" },
  salary: { src: salary, description: "paycheck", nounProjectId: "8402884", author: "Amir Ali" },
  savings: { src: savings, description: "Piggy Bank", nounProjectId: "6970888", author: "Waldiz Production" },
  shopping: { src: shopping, description: "shopping", nounProjectId: "8464010", author: "Romaldon" },
  streaming: { src: streaming, description: "play video", nounProjectId: "8437681", author: "Graphtend" },
  subscription: { src: subscription, description: "recurring payment", nounProjectId: "8451671", author: "rendicon" },
  transport: { src: transport, description: "Transportation", nounProjectId: "8455785", author: "Junaid Ali" },
  "travel-goal": { src: travelGoal, description: "travel suitcase", nounProjectId: "8220482", author: "Chaiconator" },
  water: { src: water, description: "Water Bill", nounProjectId: "8438023", author: "Ahmad Roaayala" },
};
