import glob, os, re, sys, itertools, collections

OUT = "adv"

def read(p):
    return open(p, "rb").read()

def norm_headers(raw):
    """Split raw header block into (status_line, [(name, value)...]) preserving case/order.
    Drops only `Date` (wall-clock, varies on every response from any source)."""
    lines = raw.decode("latin-1").split("\r\n")
    status = lines[0]
    hdrs = []
    for ln in lines[1:]:
        if not ln.strip():
            continue
        name, _, val = ln.partition(":")
        if name.lower() == "date":
            continue
        hdrs.append((name, val.strip()))
    return status, hdrs

def group(prefix):
    files = sorted(glob.glob(os.path.join(OUT, prefix + "*.h")))
    out = []
    for h in files:
        b = h[:-2] + ".b"
        out.append((os.path.basename(h)[:-2], read(h), read(b)))
    return out

A = group("A")
B = group("B")
D = group("D_")
fail = []

def check(label, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + label + ((" -- " + detail) if detail else ""))
    if not cond:
        fail.append(label)

# 1. every response in both groups: identical status line, identical header list
#    (names, order, case, values) and identical body bytes.
allr = A + B
statuses = {norm_headers(h)[0] for _, h, _ in allr}
check("status line identical across all 10 responses (A+B)", len(statuses) == 1, repr(statuses))

hdrsets = {repr(norm_headers(h)[1]) for _, h, _ in allr}
check("header name/order/case/value list identical across all 10 (Date excluded)",
      len(hdrsets) == 1, "%d distinct" % len(hdrsets))

bodies = {b for _, _, b in allr}
check("body bytes identical across all 10", len(bodies) == 1, repr(list(bodies)[:1]))

# 1b. no duplicated header name anywhere (the round-3 `Vary` duplication bug)
for name, h, _ in allr:
    names = [n.lower() for n, _ in norm_headers(h)[1]]
    dupes = [k for k, v in collections.Counter(names).items() if v > 1]
    check("no duplicated header name in " + name, not dupes, repr(dupes))

# 2. the 100%-of-one-group / 0%-of-other-group literal test (rounds 2 & 3's killer).
#    Tokenize both header blocks and bodies of each group into all substrings that a
#    grep-wielding attacker would plausibly try: every alnum/-/_/. run of length >= 3.
TOK = re.compile(rb"[A-Za-z0-9_.\-/]{3,}")
def tokens(resp):
    hdr = re.sub(rb"^Date:.*$", b"", resp[1], flags=re.M | re.I)
    return set(TOK.findall(hdr)) | set(TOK.findall(resp[2]))

atoks = [tokens(r) for r in A]
btoks = [tokens(r) for r in B]
in_all_a = set.intersection(*atoks)
in_any_b = set.union(*btoks)
in_all_b = set.intersection(*btoks)
in_any_a = set.union(*atoks)
a_only = in_all_a - in_any_b
b_only = in_all_b - in_any_a
check("no token in 100% of guarded-denials and 0% of genuine 404s", not a_only, repr(sorted(a_only)))
check("no token in 100% of genuine 404s and 0% of guarded-denials", not b_only, repr(sorted(b_only)))

# 3. body length must not cluster by group.
alen = [len(r[2]) for r in A]
blen = [len(r[2]) for r in B]
check("body lengths do not separate the groups", set(alen) == set(blen), "A=%r B=%r" % (alen, blen))
hlen = lambda g: [len(re.sub(rb"^Date:.*$", b"", r[1], flags=re.M | re.I)) for r in g]
check("header-block lengths do not separate the groups", set(hlen(A)) == set(hlen(B)),
      "A=%r B=%r" % (hlen(A), hlen(B)))

# 4. all four denial reasons produce the one same response.
ref_status, ref_hdrs = norm_headers(A[0][1])
ref_body = A[0][2]
for name, h, b in D:
    s, hh = norm_headers(h)
    check("denial reason %s matches the canonical denial byte-for-byte" % name,
          (s, hh, b) == (ref_status, ref_hdrs, ref_body),
          "status=%r hdrdiff=%r bodylen=%d" % (s, [x for x in hh if x not in ref_hdrs], len(b)))

# 5. non-GET verbs: a missing api path and a denied guarded path must agree.
for m in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
    mh = read(os.path.join(OUT, "V_%s_missing.h" % m)); mb = read(os.path.join(OUT, "V_%s_missing.b" % m))
    gh = read(os.path.join(OUT, "V_%s_guarded.h" % m)); gb = read(os.path.join(OUT, "V_%s_guarded.b" % m))
    check("%s: missing-path response == guarded-denial response" % m,
          (norm_headers(mh), mb) == (norm_headers(gh), gb),
          "missing=%r guarded=%r" % (norm_headers(mh)[0], norm_headers(gh)[0]))

print()
print("RESULT: " + ("ALL CHECKS PASSED" if not fail else "%d FAILURE(S): %r" % (len(fail), fail)))


# 6. full verb sweep against the [id] ops route vs. a missing 2-segment api path.
for m in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
    mh = read(os.path.join(OUT, "W_%s_missing.h" % m)); mb = read(os.path.join(OUT, "W_%s_missing.b" % m))
    gh = read(os.path.join(OUT, "W_%s_guarded.h" % m)); gb = read(os.path.join(OUT, "W_%s_guarded.b" % m))
    ok = (norm_headers(mh), mb) == (norm_headers(gh), gb)
    print(("PASS " if ok else "FAIL ") + "[id] route %s: missing == guarded-denial -- missing=%r guarded=%r"
          % (m, norm_headers(mh)[0], norm_headers(gh)[0]))
    if not ok:
        fail.append("[id] %s" % m)
print()
print("FINAL RESULT: " + ("ALL CHECKS PASSED" if not fail else "%d FAILURE(S): %r" % (len(fail), fail)))
sys.exit(1 if fail else 0)
