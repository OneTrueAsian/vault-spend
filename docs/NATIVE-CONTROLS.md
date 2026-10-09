# Native integration inventory — October 9, 2026

There are no production `<select>` or `<datalist>` elements. EditableCombobox,
MenuSelect and the specialized row/icon controls own their popup styling.
Browser/OS calendar and file/print popups remain native integrations, with no
promise to recolor them.

Ten DateField call sites retain native date editing/calendar behavior:

| File | Use |
|---|---|
| AccountDetailView | Statement ending date |
| BucketsView | New goal and existing goal target date |
| LedgerTable | Transaction date edit |
| Modal | Manual transaction date |
| MoreFiltersPopover | From and to dates |
| RecurringView | New bill and existing bill next due date |
| comparisons/AmountEditor | Date measured |

One MonthField in AccumulationSection retains a native month picker for Withdraw
month. Both fields share themed resting presentation; their popup remains native.

Twelve file/folder/save call sites remain:

| File | Integration | Routing |
|---|---|---|
| App | Second backup folder | nativeDialog |
| App | Relocate data folder | nativeDialog |
| App | Export database/protected package | nativeDialog |
| App | Import database | nativeDialog |
| App | Import protected package folder | nativeDialog |
| App | Import bank transactions | nativeDialog |
| App | Save setup template | nativeDialog |
| App | Import setup template | nativeDialog |
| App | Reports CSV | nativeDialog |
| transactionExport | Transactions CSV | nativeDialog |
| LaunchErrorScreen | Locate existing data file | Direct plugin |
| MobileSettings | Export public mobile certificate | Direct plugin |

Reports' print action calls `window.print()`. It remains an OS print dialog.

The ten wrapped calls notify `note_native_dialog_state` on entry and in `finally`
on success, cancellation and error. Notifications are best effort. This prevents
an owned dialog's focus transition from being treated as an ordinary focus-loss
lock when notifications succeed. It does not suppress workstation lock/suspend.
LaunchErrorScreen is a startup recovery flow; MobileSettings runs in an active
profile. The two direct calls have no equivalent wrapper bookkeeping. They
must receive a separate focus/autolock behavior review before rerouting; this
checkpoint changes no routing or native dialog implementation. Existing wrapper
unit cases and affected compiled scenarios cover their stated boundaries, not
physical manipulation of every OS dialog on all platforms.
