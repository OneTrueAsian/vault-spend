# Renderer network test boundaries

Desktop source coverage starts at `src/main.tsx`, following local runtime
imports, re-exports and literal dynamic imports. Type-only imports and inert
assets are excluded. A mobile module imported into the desktop runtime becomes
part of this guard automatically; mobile's legitimate browser network calls
are not indiscriminately scanned as desktop code.

The TypeScript AST guard rejects acquiring fetch, XMLHttpRequest, WebSocket,
EventSource, WebTransport or sendBeacon, not just spelling a direct call.
Fixtures cover aliases, bind, destructuring, literal bracket access/escapes,
constructor aliases, computed browser-object access and Reflect.get. It is
intentionally conservative about capability names, ignores comments/string
contents and type references, and fails unresolved/nonliteral runtime imports.
It is a source regression guard, not an arbitrary-JavaScript security sandbox
or proof against all obfuscation. External packages, workers and injected
scripts are governed by separate dependency, build, asset and CSP checks.

Tauri's package-owned IPC transport is legitimate and outside the local source
graph; local code uses typed invoke adapters rather than a direct fetch
exception. Desktop CSP continues to permit only IPC connections and local
assets. Existing remote-origin, script/frame and bundled-font guards remain.

MobileConnection intentionally uses same-origin HTTP. Its public API tests
verify the complete route set: status, pairing redeem/complete, logout and
hex-validated snapshot profile identifiers. Credentials are same-origin,
redirects are rejected, caching is disabled and referrers omitted. Invalid path
identifiers fail before HTTP; auth/redirect/oversize/timeouts never replace a
saved snapshot. These tests complement the compiled HTTPS authorization and
mobile asset/browser boundaries; they do not establish physical-phone trust,
all locale/platform acceptance, or immunity to arbitrary compromised scripts.
