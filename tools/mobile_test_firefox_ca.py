"""Import a disposable CA into one test Firefox NSS database, never Windows trust.

NSS public ABI: mozilla/nss lib/pk11wrap/pk11pub.h and lib/certdb/cert.h.
The caller must close Firefox first. Reject paths outside our disposable fixture.
"""
import base64
import ctypes as c
import os
from pathlib import Path
import sys
import tempfile

profile, browser, certificate = (Path(value).resolve() for value in sys.argv[1:4])
mode = sys.argv[4] if len(sys.argv) == 5 else "import"
if mode not in ("import", "remove"):
    raise ValueError("Expected import or remove")
directory = profile.parent
temporary = Path(tempfile.gettempdir()).resolve()
if directory.parent != temporary or not directory.name.startswith("vault-mobile-trusted-firefox-"):
    raise ValueError("Only a disposable mobile Firefox profile may be modified")
if browser.parent != directory or certificate.parent != directory or not profile.is_dir():
    raise ValueError("All inputs must belong to the same disposable fixture")

class Trust(c.Structure):
    _fields_ = [("ssl", c.c_uint), ("email", c.c_uint), ("object", c.c_uint)]

with os.add_dll_directory(str(browser)):
    nss = c.CDLL(str(browser / "nss3.dll"))
    def function(name, result, arguments):
        fn = getattr(nss, name)
        fn.restype, fn.argtypes = result, arguments
        return fn
    init = function("NSS_InitReadWrite", c.c_int, [c.c_char_p])
    get_db = function("CERT_GetDefaultCertDB", c.c_void_p, [])
    get_slot = function("PK11_GetInternalKeySlot", c.c_void_p, [])
    decode_cert = function("CERT_DecodeCertFromPackage", c.c_void_p, [c.c_char_p, c.c_int])
    import_cert = function("PK11_ImportCert", c.c_int, [c.c_void_p, c.c_void_p, c.c_ulong, c.c_char_p, c.c_int])
    find = function("CERT_FindCertByNickname", c.c_void_p, [c.c_void_p, c.c_char_p])
    decode_trust = function("CERT_DecodeTrustString", c.c_int, [c.POINTER(Trust), c.c_char_p])
    change_trust = function("CERT_ChangeCertTrust", c.c_int, [c.c_void_p, c.c_void_p, c.POINTER(Trust)])
    destroy_cert = function("CERT_DestroyCertificate", None, [c.c_void_p])
    free_slot = function("PK11_FreeSlot", None, [c.c_void_p])
    shutdown = function("NSS_Shutdown", c.c_int, [])
    def check(result, action):
        if result != 0:
            raise RuntimeError(f"NSS test-profile {action} failed")
    check(init(("sql:" + str(profile)).encode()), "initialization")
    slot, cert = None, None
    try:
        pem = certificate.read_text(encoding="ascii")
        der = base64.b64decode("".join(line for line in pem.splitlines() if not line.startswith("---")), validate=True)
        slot = get_slot()
        if not slot:
            raise RuntimeError("NSS test-profile slot unavailable")
        nickname = b"Vault Spend disposable TLS fixture"
        db = get_db()
        cert = decode_cert(der, len(der)) if mode == "import" else find(db, nickname)
        if not cert:
            raise RuntimeError("NSS test-profile certificate decode failed")
        if mode == "import":
            check(import_cert(slot, cert, 0, nickname, 0), "certificate import")
        if not cert:
            raise RuntimeError("NSS test-profile certificate lookup failed")
        trust = Trust()
        check(decode_trust(c.byref(trust), b"C,," if mode == "import" else b",,"), "trust decode")
        check(change_trust(db, cert, c.byref(trust)), "website trust")
    finally:
        if cert:
            destroy_cert(cert)
        if slot:
            free_slot(slot)
        check(shutdown(), "shutdown")
print(f"Disposable Firefox profile website trust {mode} complete; Windows trust untouched.")
