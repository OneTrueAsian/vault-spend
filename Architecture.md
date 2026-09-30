flowchart TD

subgraph group_interface["Desktop interface"]
  node_startup["Startup gate<br/>[StartupGate.tsx]"]
  node_app["Application shell<br/>[App.tsx]"]
  node_profile_ui["Profile screens"]
end

subgraph group_finance["Finance workflows"]
  node_dashboard["Dashboard<br/>[DashboardView.tsx]"]
  node_ledger["Accounts and ledger<br/>[AccountsView.tsx]"]
  node_budget["Budget and goals<br/>[BudgetView.tsx]"]
  node_cashflow["Cash flow<br/>[CashFlowView.tsx]"]
  node_recurring["Recurring items<br/>[RecurringView.tsx]"]
  node_investments["Investments"]
  node_household["Household<br/>[HouseholdView.tsx]"]
  node_reports["Reports<br/>[ReportsView.tsx]"]
  node_import_ui["Import inbox"]
  node_query["Ledger queries<br/>[ledgerQuery.ts]"]
end

subgraph group_backend["Desktop backend"]
  node_commands["Tauri commands<br/>[commands.rs]"]
  node_runtime["Application runtime<br/>[runtime.rs]"]
  node_background["Background reminders<br/>[background.rs]"]
  node_price_service["Live price service<br/>[live_prices.rs]"]
end

subgraph group_data["Local data and security"]
  node_profiles["Profile management<br/>[profiles.rs]"]
  node_protection["Protection lifecycle"]
  node_store[("Local database<br/>[store.rs]")]
  node_importers["Statement importers<br/>[importer.rs]"]
  node_rules["Categorization rules<br/>[rules.rs]"]
  node_backups["Backups<br/>[backups.rs]"]
end

subgraph group_integrations["External services"]
  node_github["GitHub update check"]
  node_price_provider["Configured price provider"]
end

node_user(("User"))

node_user -->|"launches"| node_startup
node_startup -->|"opens app"| node_app
node_app -->|"shows profiles"| node_profile_ui
node_app -->|"presents features"| node_dashboard
node_app -->|"presents features"| node_ledger
node_app -->|"presents features"| node_budget
node_app -->|"presents features"| node_cashflow
node_app -->|"presents features"| node_recurring
node_app -->|"presents features"| node_investments
node_app -->|"presents features"| node_household
node_app -->|"presents features"| node_reports
node_ledger -->|"opens review"| node_import_ui
node_app -->|"answers queries"| node_query
node_app -->|"invokes commands"| node_commands
node_profile_ui -->|"invokes commands"| node_commands
node_commands -->|"uses runtime"| node_runtime
node_commands -->|"reads and writes"| node_store
node_commands -->|"imports statements"| node_importers
node_importers -->|"persists records"| node_store
node_commands -->|"applies rules"| node_rules
node_rules -->|"reads and updates"| node_store
node_commands -->|"manages profiles"| node_profiles
node_profiles -->|"changes protection"| node_protection
node_protection -->|"protects profile data"| node_store
node_commands -->|"manages backups"| node_backups
node_app -->|"configures reminders"| node_background
node_investments -.->|"requests prices"| node_price_service
node_price_service -.->|"fetches prices"| node_price_provider
node_startup -.->|"checks releases"| node_github

click node_startup "https://github.com/onetrueasian/vault-spend/blob/main/src/StartupGate.tsx"
click node_app "https://github.com/onetrueasian/vault-spend/blob/main/src/App.tsx"
click node_profile_ui "https://github.com/onetrueasian/vault-spend/blob/main/src/ProfileSelector.tsx"
click node_dashboard "https://github.com/onetrueasian/vault-spend/blob/main/src/DashboardView.tsx"
click node_ledger "https://github.com/onetrueasian/vault-spend/blob/main/src/AccountsView.tsx"
click node_budget "https://github.com/onetrueasian/vault-spend/blob/main/src/BudgetView.tsx"
click node_cashflow "https://github.com/onetrueasian/vault-spend/blob/main/src/CashFlowView.tsx"
click node_recurring "https://github.com/onetrueasian/vault-spend/blob/main/src/RecurringView.tsx"
click node_investments "https://github.com/onetrueasian/vault-spend/blob/main/src/InvestmentsView.tsx"
click node_household "https://github.com/onetrueasian/vault-spend/blob/main/src/HouseholdView.tsx"
click node_reports "https://github.com/onetrueasian/vault-spend/blob/main/src/ReportsView.tsx"
click node_import_ui "https://github.com/onetrueasian/vault-spend/blob/main/src/ImportInboxDialog.tsx"
click node_query "https://github.com/onetrueasian/vault-spend/blob/main/src/ledgerQuery.ts"
click node_commands "https://github.com/onetrueasian/vault-spend/blob/main/src-tauri/src/commands.rs"
click node_runtime "https://github.com/onetrueasian/vault-spend/blob/main/src-tauri/src/runtime.rs"
click node_background "https://github.com/onetrueasian/vault-spend/blob/main/src-tauri/src/background.rs"
click node_price_service "https://github.com/onetrueasian/vault-spend/blob/main/src-tauri/src/live_prices.rs"
click node_profiles "https://github.com/onetrueasian/vault-spend/blob/main/src-tauri/src/profiles.rs"
click node_protection "https://github.com/onetrueasian/vault-spend/blob/main/src-tauri/src/protection_lifecycle.rs"
click node_store "https://github.com/onetrueasian/vault-spend/blob/main/core/src/store.rs"
click node_importers "https://github.com/onetrueasian/vault-spend/blob/main/core/src/importer.rs"
click node_rules "https://github.com/onetrueasian/vault-spend/blob/main/core/src/rules.rs"
click node_backups "https://github.com/onetrueasian/vault-spend/blob/main/src-tauri/src/backups.rs"

classDef toneNeutral fill:#f8fafc,stroke:#334155,stroke-width:1.5px,color:#0f172a
classDef toneBlue fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#172554
classDef toneAmber fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
classDef toneMint fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
classDef toneRose fill:#ffe4e6,stroke:#e11d48,stroke-width:1.5px,color:#881337
classDef toneIndigo fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#312e81
classDef toneTeal fill:#ccfbf1,stroke:#0f766e,stroke-width:1.5px,color:#134e4a
class node_startup,node_app,node_profile_ui,node_user toneBlue
class node_dashboard,node_ledger,node_budget,node_cashflow,node_recurring,node_investments,node_household,node_reports,node_import_ui,node_query toneAmber
class node_commands,node_runtime,node_background,node_price_service toneMint
class node_profiles,node_protection,node_store,node_importers,node_rules,node_backups toneRose
class node_github,node_price_provider toneIndigo