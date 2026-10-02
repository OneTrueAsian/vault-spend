import type { MetricId } from "./types";

/** What each comparison setup field asks for, shown in its InfoTip. One place, so the wording can be
 * reviewed (and kept consistent) without reading the forms. Written for anyone, including people new to
 * money terms: plain words, no app jargon such as "tracked" or "published". */
export const FIELD_TIPS = {
  compare:
    "Choose My household to add up the money of everyone who shares your finances and compare the total. Savings, investments and debt can only be compared this way. Choose One person to compare a single person's income, which is the only figure available for a single person.",
  subjectHousehold:
    "The national figures are grouped by age. For a household, the age used is that of the person who owns or rents your home. Choose that person.",
  subjectIndividual:
    "The person whose income is compared. The national figures are grouped by age, so this person's age decides which group they are compared with.",
  shares:
    "Tick this for a partner or family member who shares money with you, for example through a joint bank account or shared bills. Their income and accounts are then counted too. Leave it unticked for a roommate who handles their own money.",
  age: "Only used to compare you with people of a similar age (for example 25 to 29). If you would rather not give an exact age, choose Age range. The range must fit inside one of those age groups.",
  incomeMethod:
    "Enter one yearly amount for the whole household, or enter each person's income and let the app add them up. Either way, use income before tax is taken out.",
  income:
    "How much is earned in a year before tax is taken out. Count wages or salary, money from your own business, interest, dividends, rent you receive, Social Security and pensions. Last year's tax return, or the year-to-date total on your latest pay stub, are good places to find it.",
  measuredOn:
    "The date this amount was correct, such as the date on your pay stub or bank statement. The app uses it to remind you when the amount may be out of date.",
  sourceNote: 'Optional. A note to remind yourself where the amount came from, like "2025 W-2". It appears in the comparison details.',
  spendingComplete:
    "Tick this only if every account you spend from, including credit cards, has been in Vault Spend for each of the last 12 full months. If some spending is missing, the app's total would be too low, so it is not used.",
  spendingAccounts: "Choose which accounts' spending is added up. If you tick none, all checking, savings and credit card accounts are used.",
  annualSpending:
    "How much your household spends in a year, including purchases made with credit cards. Do not count money moved between your own accounts or credit card bill payments, because the purchases are already counted. Fill this in if Vault Spend has less than 12 months of your history.",
  savings:
    'Checking and savings accounts count as savings unless you change it here. Choose "Count as savings" for money kept somewhere else, such as a money market account. Choose "Leave out" to skip this account.',
  investments:
    "Tells the app what kind of investment this is, so it is compared with the right national figure. Retirement: a 401(k), IRA or 403(b). Taxable investment: a regular brokerage account holding stocks or funds. Education: a 529 college savings plan. Only retirement and taxable investments can be compared.",
  debtType:
    "Tells the app what kind of debt this is, so it is compared with the right national figure: mortgage, credit card, student loan, vehicle loan or other. Default goes by the account's type in Vault Spend.",
  debtLeaveOut: "Leaves this account out of the debt comparison only. Nothing else in the app changes.",
  accountShares:
    "For an account owned by more than one person, such as a joint account: how much of it belongs to each person, adding up to 100%. Leave it blank if one person owns all of it.",
  confirmBalances:
    "Balances are only compared once you tell the app that all your accounts of that kind are in Vault Spend and their balances are up to date. Confirm again whenever you update them.",
  /** One per "your own total" field: each says where the app's own total comes from when it is left empty. */
  manualTotal: {
    savings:
      "Leave this empty and the app adds up the balances of your checking and savings accounts in Vault Spend. Type an amount only if that total would be wrong, for example because you have savings in an account you have not added to the app. Your amount is used instead until you delete it.",
    investments:
      "Leave this empty and the app adds up the balances of your investment accounts in Vault Spend, such as a 401(k), IRA or brokerage account. Type an amount only if that total would be wrong, for example because you have an investment account you have not added to the app. Your amount is used instead until you delete it.",
    debt: "Leave this empty and the app adds up what you owe on the credit cards and loans in Vault Spend. Type an amount only if that total would be wrong, for example because you have a loan you have not added to the app. Your amount is used instead until you delete it.",
    spending:
      "Leave this empty and the app adds up your spending over the last 12 full months from your accounts in Vault Spend. Type an amount only if that total would be wrong, for example because you also spend from an account you have not added to the app. Your amount is used instead until you delete it.",
  } satisfies Record<Exclude<MetricId, "income">, string>,
} as const;
